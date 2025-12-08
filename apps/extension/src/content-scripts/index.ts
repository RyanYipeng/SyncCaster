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
  const rawText = mathml.textContent || '';
  if (!rawText) return '';
  
  // 清理空白字符（换行、多余空格等）
  const text = rawText.replace(/\s+/g, '').trim();
  if (!text) return '';
  
  // 查找包含反斜杠的 LaTeX 部分
  const firstBackslash = text.indexOf('\\');
  if (firstBackslash !== -1) {
    // 向前查找可能的 LaTeX 开始位置
    let start = firstBackslash;
    for (let i = firstBackslash - 1; i >= 0; i--) {
      const char = text[i];
      if (/[a-zA-Z0-9_^{}()\[\]=+\-*/<>.,;:!?']/.test(char)) {
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
  
  // 方法4：简单公式（无反斜杠），格式为 "渲染文本 + LaTeX"
  // 例如 "dd" -> "d", "xx" -> "x"
  const len = text.length;
  if (len >= 2 && len % 2 === 0) {
    const half = len / 2;
    const firstHalf = text.substring(0, half);
    const secondHalf = text.substring(half);
    if (firstHalf === secondHalf) {
      return secondHalf;
    }
  }
  
  // 方法5：三段式格式 "渲染1 + LaTeX + 渲染2"
  if (len >= 3) {
    for (let prefixLen = 1; prefixLen < len / 2; prefixLen++) {
      const prefix = text.substring(0, prefixLen);
      if (text.endsWith(prefix)) {
        const middle = text.substring(prefixLen, len - prefixLen);
        if (middle && middle.length > 0) {
          return middle;
        }
      }
    }
  }
  
  // 方法6：短文本可能是简单变量
  if (len <= 3 && /^[a-zA-Z0-9\u0391-\u03C9]+$/.test(text)) {
    return len >= 2 ? text.substring(Math.floor(len / 2)) : text;
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
    const hostname = window.location.hostname;

    // 从原始 DOM 提取公式
    const formulaMap = extractFormulasFromOriginalDom();
    logInfo('collect', '从原始 DOM 提取公式', { count: formulaMap.size });

    // 平台专用内容选择器
    const getPlatformContent = (): HTMLElement | null => {
      // CSDN 专用选择器 - 只选择正文内容区域
      if (hostname.includes('csdn.net')) {
        const csdnContent = document.querySelector('#content_views') as HTMLElement;
        if (csdnContent) return csdnContent;
        const articleContent = document.querySelector('.article_content') as HTMLElement;
        if (articleContent) return articleContent;
      }
      
      // 知乎专用选择器
      if (hostname.includes('zhihu.com')) {
        const zhihuContent = document.querySelector('.Post-RichTextContainer') as HTMLElement;
        if (zhihuContent) return zhihuContent;
      }
      
      // 掘金专用选择器
      if (hostname.includes('juejin.cn')) {
        const juejinContent = document.querySelector('.article-content') as HTMLElement;
        if (juejinContent) return juejinContent;
      }
      
      return null;
    };

    // 清理平台特定的无关元素
    const cleanPlatformContent = (container: HTMLElement) => {
      // CSDN 清理
      if (hostname.includes('csdn.net')) {
        // 移除版权声明
        container.querySelectorAll('.article-copyright, .copyright-box, .blog-tags-box').forEach(el => el.remove());
        // 移除文章信息栏（点赞、收藏等）
        container.querySelectorAll('.article-info-box, .article-bar-top, .article-bar-bottom').forEach(el => el.remove());
        // 移除推荐阅读
        container.querySelectorAll('.recommend-box, .recommend-item-box').forEach(el => el.remove());
        // 移除评论区
        container.querySelectorAll('.comment-box, #comment').forEach(el => el.remove());
        // 移除广告
        container.querySelectorAll('.adsbygoogle, [class*="ad-"]').forEach(el => el.remove());
        // 移除 CSDN 特有的图标图片（点赞、收藏等小图标）
        container.querySelectorAll('img[src*="csdnimg.cn/release/blogv2/dist/pc/img/"]').forEach(el => el.remove());
        // 移除隐藏的元素
        container.querySelectorAll('[style*="display: none"], [style*="display:none"]').forEach(el => el.remove());
      }
      
      // 知乎清理
      if (hostname.includes('zhihu.com')) {
        container.querySelectorAll('.RichContent-actions, .ContentItem-actions').forEach(el => el.remove());
      }
      
      // 掘金清理
      if (hostname.includes('juejin.cn')) {
        container.querySelectorAll('.article-suspended-panel, .comment-box').forEach(el => el.remove());
      }
      
      // 通用清理 - 移除常见的无关元素
      container.querySelectorAll('script, style, noscript, iframe[src*="ad"], .ad, .ads, .advertisement').forEach(el => el.remove());
    };

    // 优先使用平台专用选择器
    const platformContent = getPlatformContent();
    let body_html = '';
    let title = '';

    if (platformContent) {
      // 使用平台专用选择器
      const contentClone = platformContent.cloneNode(true) as HTMLElement;
      cleanPlatformContent(contentClone);
      replaceFormulasWithPlaceholders(contentClone, formulaMap);
      body_html = contentClone.innerHTML;
      
      // 获取标题
      const titleEl = document.querySelector('h1.title-article, h1[class*="title"], .article-title, h1') as HTMLElement;
      title = titleEl?.textContent?.trim() || document.title || '未命名标题';
      
      logInfo('collect', '使用平台专用选择器', { platform: hostname });
    } else {
      // 回退到 Readability
      const cloned = document.cloneNode(true) as Document;
      replaceFormulasWithPlaceholders(cloned.body, formulaMap);
      const article = new Readability(cloned, COLLECT_CONFIG.readability).parse();
      
      title = article?.title || document.title || '未命名标题';
      body_html = article?.content || '';
      
      logInfo('collect', '使用 Readability 提取');
    }

    const initialMetrics = computeMetrics(body_html);

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
