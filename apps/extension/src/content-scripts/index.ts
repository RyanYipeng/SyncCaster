/**
 * Content Script - 优化版
 */
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';
import {
  computeMetrics,
  extractFormulas,
  flattenCodeHighlights,
  cleanDOMWithWhitelist,
  extractAndNormalizeImages,
  checkQuality,
  normalizeBlockSpacing,
  normalizeMathInDom,
} from './collector-utils';
import { initAuthDetector, detectLoginState, startLoginPolling } from './auth-detector';
import { collectContentCanonical } from './canonical-collector';

const COLLECT_CONFIG = {
  readability: { keepClasses: true, maxElemsToParse: 10000, nbTopCandidates: 10 },
  quality: { images: 0.3, formulas: 0.5, tables: 0.5 },
};

function logInfo(scope: string, msg: string, extra?: unknown) {
  try { console.log('[content:' + scope + '] ' + msg, extra ?? ''); } catch { /* ignore */ }
}

logInfo('init', 'Content script loaded', { url: window.location.href });

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
  const msg = message as { type: string; data?: unknown };
  handleMessage(msg).then(sendResponse).catch((e: Error) => sendResponse({ error: e.message }));
  return true;
});

async function handleMessage(message: { type: string; data?: unknown }) {
  switch (message.type) {
    case 'COLLECT_CONTENT': return await collectContent();
    case 'COLLECT_CONTENT_CANONICAL': return await collectContentCanonical();
    case 'COLLECT_CONTENT_LEGACY': return await collectContent();
    case 'FILL_AND_PUBLISH': return await fillAndPublish(message.data as { platform: string; payload: unknown });
    case 'PING': return { pong: true };
    case 'CHECK_LOGIN': return await detectLoginState();
    case 'START_LOGIN_POLLING':
      startLoginPolling((state) => chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS', data: state }));
      return { started: true };
    default: throw new Error('Unknown message type: ' + message.type);
  }
}

/**
 * 从原始 DOM 提取公式的 LaTeX
 */
function extractFormulasFromOriginalDom(): Map<string, { tex: string; isDisplay: boolean }> {
  const formulaMap = new Map<string, { tex: string; isDisplay: boolean }>();
  const serializer = new XMLSerializer();
  const processed = new WeakSet<Element>();
  let index = 0;
  
  // 处理块级公式
  document.querySelectorAll('.katex-display, .katex--display').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    node.querySelectorAll('.katex').forEach(k => processed.add(k));
    
    const tex = extractLatexFromKatexNode(node, serializer);
    if (tex) {
      const id = 'formula-' + (index++);
      (node as HTMLElement).setAttribute('data-formula-id', id);
      formulaMap.set(id, { tex, isDisplay: true });
    }
  });
  
  // 处理行内公式
  document.querySelectorAll('.katex').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    
    const tex = extractLatexFromKatexNode(node, serializer);
    if (tex) {
      const id = 'formula-' + (index++);
      (node as HTMLElement).setAttribute('data-formula-id', id);
      formulaMap.set(id, { tex, isDisplay: false });
    }
  });
  
  // 处理 MathJax script
  document.querySelectorAll('script[type*="math/tex"]').forEach((script) => {
    const tex = script.textContent?.trim();
    if (tex) {
      const type = script.getAttribute('type') || '';
      const isDisplay = type.includes('mode=display');
      const id = 'formula-' + (index++);
      (script as HTMLElement).setAttribute('data-formula-id', id);
      formulaMap.set(id, { tex, isDisplay });
    }
  });
  
  return formulaMap;
}

function extractLatexFromKatexNode(node: Element, serializer: XMLSerializer): string {
  const mathml = node.querySelector('.katex-mathml');
  if (!mathml) return '';
  
  // 方法1：标准 annotation 提取
  const xml = serializer.serializeToString(mathml);
  const annotationMatch = xml.match(/<(?:m:)?annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/(?:m:)?annotation>/i);
  if (annotationMatch && annotationMatch[1]) {
    return decodeHtmlEntities(annotationMatch[1].trim());
  }
  
  // 方法2：CSDN 特殊处理 - 文本格式为 "渲染文本 + LaTeX + 渲染文本"
  const text = mathml.textContent || '';
  if (!text) return '';
  
  // 查找包含反斜杠的 LaTeX 部分
  const firstBackslash = text.indexOf('\\');
  if (firstBackslash !== -1) {
    // 向前查找可能的 LaTeX 开始位置
    let start = firstBackslash;
    for (let i = firstBackslash - 1; i >= 0; i--) {
      const char = text[i];
      if (/[a-zA-Z0-9_^{}()\[\]=+\-*/<>.,;:!? ]/.test(char)) {
        start = i;
      } else {
        break;
      }
    }
    
    // 找到最后一个 LaTeX 命令的结束位置
    const lastMatch = text.match(/\\[a-zA-Z]+[^\\]*$/);
    let end = text.length;
    if (lastMatch) {
      const lastPos = text.lastIndexOf(lastMatch[0]);
      end = lastPos + lastMatch[0].length;
    }
    
    const extracted = text.substring(start, end).trim();
    if (extracted && /\\[a-zA-Z]+/.test(extracted)) {
      return extracted;
    }
  }
  
  // 方法3：简单公式（下划线/上标）
  if (text.includes('_') || text.includes('^')) {
    const idx = Math.min(
      text.indexOf('_') >= 0 ? text.indexOf('_') : Infinity,
      text.indexOf('^') >= 0 ? text.indexOf('^') : Infinity
    );
    if (idx > 0 && idx < Infinity) {
      const simple = text.substring(idx - 1).trim();
      if (simple.length < text.length * 0.7) {
        return simple;
      }
    }
  }
  
  return '';
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function replaceFormulasWithPlaceholders(root: HTMLElement, formulaMap: Map<string, { tex: string; isDisplay: boolean }>): void {
  const doc = root.ownerDocument || document;
  const DS = String.fromCharCode(36);
  
  root.querySelectorAll('[data-formula-id]').forEach((node) => {
    const id = node.getAttribute('data-formula-id');
    if (!id) return;
    const formula = formulaMap.get(id);
    if (!formula) return;
    
    const wrapper = doc.createElement('span');
    wrapper.setAttribute('data-sync-math', 'true');
    wrapper.setAttribute('data-tex', formula.tex);
    wrapper.setAttribute('data-display', String(formula.isDisplay));
    wrapper.textContent = formula.isDisplay ? DS + DS + formula.tex + DS + DS : DS + formula.tex + DS;
    node.replaceWith(wrapper);
  });
  
  normalizeMathInDom(root);
}


async function collectContent() {
  try {
    logInfo('collect', '开始采集页面内容', { url: window.location.href });
    const url = window.location.href;

    // 从原始 DOM 提取公式
    const formulaMap = extractFormulasFromOriginalDom();
    logInfo('collect', '从原始 DOM 提取公式', { count: formulaMap.size });

    // 克隆文档
    const cloned = document.cloneNode(true) as Document;
    replaceFormulasWithPlaceholders(cloned.body, formulaMap);
    
    const article = new Readability(cloned, COLLECT_CONFIG.readability).parse();

    const getMainContainer = () =>
      (document.querySelector('article') as HTMLElement) ||
      (document.querySelector('[role="main"]') as HTMLElement) ||
      (document.querySelector('.content') as HTMLElement) ||
      document.body;

    const origContainer = getMainContainer();
    const origClone = origContainer.cloneNode(true) as HTMLElement;
    replaceFormulasWithPlaceholders(origClone, formulaMap);
    const orig_html = origClone.innerHTML;

    const title = article?.title || document.title || '未命名标题';
    const read_html = article?.content || '';

    const initialMetrics = computeMetrics(orig_html);
    const mRead = computeMetrics(read_html);
    const mOrig = computeMetrics(orig_html);
    
    let body_html = (mOrig.images > mRead.images || (mOrig.images === mRead.images && mOrig.textLen > mRead.textLen))
      ? orig_html : read_html || orig_html;

    const container = document.createElement('div');
    container.innerHTML = body_html;

    const formulas = extractFormulas(container);
    flattenCodeHighlights(container);
    cleanDOMWithWhitelist(container);
    const images = extractAndNormalizeImages(container);
    normalizeBlockSpacing(container);

    body_html = container.innerHTML;
    const td = new TurndownService({
      headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_', bulletListMarker: '-', br: '\n',
    });
    td.use(gfm);

    const DS = String.fromCharCode(36);
    
    td.addRule('sync-math', {
      filter: (node: Node) => node.nodeType === 1 && (node as Element).hasAttribute('data-sync-math'),
      replacement: (_content: string, node: Node) => {
        const el = node as Element;
        const tex = el.getAttribute('data-tex') || '';
        const display = el.getAttribute('data-display') === 'true';
        return display ? '\n\n' + DS + DS + '\n' + tex + '\n' + DS + DS + '\n\n' : DS + tex + DS;
      },
    });

    td.addRule('katex-fallback', {
      filter: (node: Node) => {
        if (node.nodeType !== 1) return false;
        const el = node as Element;
        return el.classList.contains('katex') || el.classList.contains('katex-display') || el.classList.contains('katex--display');
      },
      replacement: (_content: string, node: Node) => {
        const el = node as Element;
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation?.textContent?.trim() || '';
        if (!tex) return _content;
        const isDisplay = el.classList.contains('katex-display') || el.classList.contains('katex--display');
        return isDisplay ? '\n\n' + DS + DS + '\n' + tex + '\n' + DS + DS + '\n\n' : DS + tex + DS;
      },
    });

    td.addRule('complex-table', {
      filter: (node: Node) => {
        if (node.nodeName !== 'TABLE') return false;
        return !!(node as HTMLTableElement).querySelector('colgroup, [colspan], [rowspan]');
      },
      replacement: (_content: string, node: Node) => '\n\n' + (node as Element).outerHTML + '\n\n',
    });

    let body_md = td.turndown(body_html || '');
    body_md = body_md.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
    
    const text_len = body_md.length;
    const summary = (container.textContent || '').trim().slice(0, 200);

    const finalMetrics = computeMetrics(body_html);
    const qualityCheck = checkQuality(initialMetrics, finalMetrics, COLLECT_CONFIG.quality);

    logInfo('collect', '采集成功', { title, len: text_len, images: images.length, formulas: formulas.length });

    return {
      success: true,
      data: {
        title, url, summary, body_md, body_html, images,
        formulas: formulas.map(f => ({ type: f.display ? 'blockMath' : 'inlineMath', latex: f.latex, originalFormat: f.originalFormat })),
        wordCount: text_len, imageCount: images.length, formulaCount: formulas.length,
        useHtmlFallback: !qualityCheck.pass, qualityCheck,
      },
    };
  } catch (error: unknown) {
    logInfo('collect', '采集异常', { error });
    return { success: false, error: error instanceof Error ? error.message : '未知错误' };
  }
}

async function fillAndPublish(data: { platform: string; payload: unknown }) {
  switch (data.platform) {
    case 'wechat': return { success: true, url: window.location.href };
    case 'zhihu': return { success: true, url: window.location.href };
    case 'juejin': return { success: true, url: window.location.href };
    default: throw new Error('Unsupported platform: ' + data.platform);
  }
}

function addFloatingButton() {
  const button = document.createElement('button');
  button.textContent = '📤 SyncCaster';
  button.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 99999; padding: 12px 20px; background: #1677ff; color: white; border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); cursor: pointer; font-size: 14px;';
  
  button.addEventListener('click', async () => {
    try {
      button.textContent = '⏳ 采集中...';
      button.disabled = true;
      const result = await collectContent();
      chrome.runtime.sendMessage({ type: 'CONTENT_COLLECTED', data: result });
      button.textContent = '✅ 已采集';
      setTimeout(() => { button.textContent = '📤 SyncCaster'; button.disabled = false; }, 2000);
    } catch {
      button.textContent = '❌ 失败';
      button.disabled = false;
    }
  });
  
  document.body.appendChild(button);
}

initAuthDetector();
if (!window.location.href.includes('mp.weixin.qq.com')) {
  addFloatingButton();
}
