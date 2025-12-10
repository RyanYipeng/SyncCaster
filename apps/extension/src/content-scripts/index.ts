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
  const hostname = window.location.hostname;
  const isZhihu = hostname.includes('zhihu.com');
  
  // 知乎专用公式提取
  if (isZhihu) {
    // 知乎使用 data-tex 属性存储 LaTeX
    document.querySelectorAll('[data-tex]').forEach((node) => {
      if (processed.has(node)) return;
      processed.add(node);
      
      const tex = node.getAttribute('data-tex')?.trim();
      if (tex) {
        const id = 'formula-' + (index++);
        (node as HTMLElement).setAttribute('data-formula-id', id);
        // 知乎的块级公式通常在 figure 或 p 标签内，或者有 display 类
        const isDisplay = !!node.closest('figure') || 
                          node.classList.contains('ztext-math') ||
                          node.tagName === 'IMG';
        formulaMap.set(id, { tex, isDisplay });
        console.log('[math:zhihu] Found formula via data-tex:', tex.substring(0, 50), 'display:', isDisplay);
      }
    });
    
    // 知乎的 ztext-math 公式图片
    document.querySelectorAll('img.ztext-math, img[data-formula]').forEach((node) => {
      if (processed.has(node)) return;
      processed.add(node);
      
      const tex = node.getAttribute('data-tex') || 
                  node.getAttribute('data-formula') ||
                  node.getAttribute('alt');
      if (tex && tex.trim()) {
        const id = 'formula-' + (index++);
        (node as HTMLElement).setAttribute('data-formula-id', id);
        const isDisplay = !!node.closest('figure');
        formulaMap.set(id, { tex: tex.trim(), isDisplay });
        console.log('[math:zhihu] Found formula via img:', tex.substring(0, 50));
      }
    });
    
    // 知乎的 MathJax 渲染（如果有）
    document.querySelectorAll('.MathJax, .MathJax_Display, mjx-container').forEach((node) => {
      if (processed.has(node)) return;
      processed.add(node);
      
      const tex = node.getAttribute('data-tex') || 
                  node.getAttribute('data-latex') ||
                  extractMathJaxAnnotation(node);
      if (tex && tex.trim()) {
        const id = 'formula-' + (index++);
        (node as HTMLElement).setAttribute('data-formula-id', id);
        const isDisplay = node.classList.contains('MathJax_Display') || 
                          node.hasAttribute('display');
        formulaMap.set(id, { tex: tex.trim(), isDisplay });
        console.log('[math:zhihu] Found MathJax formula:', tex.substring(0, 50));
      }
    });
  }
  
  // CSDN 和通用 KaTeX 处理
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
    if (processed.has(script)) return;
    processed.add(script);
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

// 从 MathJax 节点提取 annotation
function extractMathJaxAnnotation(node: Element): string {
  const annotation = node.querySelector('annotation[encoding*="tex"]');
  if (annotation?.textContent) return annotation.textContent.trim();
  
  // 尝试从 outerHTML 提取
  const html = node.outerHTML || '';
  const match = html.match(/<annotation[^>]*encoding=["'][^"']*tex[^"']*["'][^>]*>([\s\S]*?)<\/annotation>/i);
  if (match?.[1]) return match[1].trim();
  
  return '';
}

/**
 * 修复知乎列表结构
 * 知乎的列表可能有非标准的嵌套结构，需要修复以确保正确转换为 Markdown
 */
function fixZhihuListStructure(container: HTMLElement): void {
  // 知乎可能将嵌套列表放在 li 外面，需要修复
  container.querySelectorAll('ul, ol').forEach((list) => {
    const items = list.querySelectorAll(':scope > li');
    items.forEach((li) => {
      // 检查 li 后面是否紧跟着一个 ul/ol（应该在 li 内部）
      const nextSibling = li.nextElementSibling;
      if (nextSibling && (nextSibling.tagName === 'UL' || nextSibling.tagName === 'OL')) {
        // 检查这个嵌套列表是否应该属于当前 li
        // 如果嵌套列表的缩进更深，则移动到 li 内部
        const nestedList = nextSibling;
        // 将嵌套列表移动到 li 内部
        li.appendChild(nestedList);
        console.log('[zhihu] Fixed nested list structure');
      }
    });
  });
  
  // 确保所有 li 都在 ul/ol 内
  container.querySelectorAll('li').forEach((li) => {
    if (li.parentElement && !['UL', 'OL'].includes(li.parentElement.tagName)) {
      // li 不在列表内，创建一个 ul 包裹它
      const ul = document.createElement('ul');
      li.parentElement.insertBefore(ul, li);
      ul.appendChild(li);
      console.log('[zhihu] Wrapped orphan li in ul');
    }
  });
}

function extractLatexFromKatexNode(node: Element, _serializer: XMLSerializer): string {
  const mathml = node.querySelector('.katex-mathml');
  if (!mathml) return '';
  
  // 核心方法：使用 XMLSerializer 序列化原始 MathML，保留 annotation 标签
  // 这是最可靠的方法，因为 innerHTML/outerHTML 可能会丢失 MathML 命名空间内容
  try {
    const serializer = new XMLSerializer();
    const serialized = serializer.serializeToString(mathml);
    console.log('[math] Serialized MathML length:', serialized.length);
    
    // 从序列化的 XML 中提取 annotation
    const annotationMatch = serialized.match(/<(?:m:)?annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/(?:m:)?annotation>/i);
    if (annotationMatch && annotationMatch[1]) {
      const tex = decodeHtmlEntities(annotationMatch[1].trim());
      if (tex && tex.length > 0) {
        console.log('[math] Found LaTeX via XMLSerializer:', tex.substring(0, 80));
        return tex;
      }
    }
    
    // 尝试不带 encoding 属性的 annotation
    const fallbackMatch = serialized.match(/<(?:m:)?annotation[^>]*>([\s\S]*?)<\/(?:m:)?annotation>/i);
    if (fallbackMatch && fallbackMatch[1]) {
      const tex = decodeHtmlEntities(fallbackMatch[1].trim());
      if (tex && /[a-zA-Z\\{}_^]/.test(tex)) {
        console.log('[math] Found LaTeX via XMLSerializer fallback:', tex.substring(0, 80));
        return tex;
      }
    }
  } catch (e) {
    console.log('[math] XMLSerializer failed:', e);
  }
  
  // 方法2：直接从 annotation 元素获取
  const annotationSelectors = [
    'annotation[encoding="application/x-tex"]',
    'annotation',
  ];
  
  for (const sel of annotationSelectors) {
    try {
      const annotation = mathml.querySelector(sel);
      if (annotation && annotation.textContent) {
        const tex = annotation.textContent.trim();
        if (tex && tex.length > 0) {
          console.log('[math] Found LaTeX via querySelector:', sel, tex.substring(0, 80));
          return tex;
        }
      }
    } catch (e) {
      // 选择器可能不支持，继续尝试下一个
    }
  }
  
  // 方法3：从 outerHTML 用正则提取
  const html = mathml.outerHTML || mathml.innerHTML;
  const annotationMatch = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
  if (annotationMatch && annotationMatch[1]) {
    const tex = decodeHtmlEntities(annotationMatch[1].trim());
    console.log('[math] Found LaTeX via outerHTML regex:', tex.substring(0, 80));
    return tex;
  }
  
  // 方法4：尝试从 innerHTML 提取
  const innerHTML = mathml.innerHTML;
  const innerMatch = innerHTML.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/i);
  if (innerMatch && innerMatch[1]) {
    const tex = decodeHtmlEntities(innerMatch[1].trim());
    if (tex && /[a-zA-Z\\]/.test(tex)) {
      console.log('[math] Found LaTeX via innerHTML regex:', tex.substring(0, 80));
      return tex;
    }
  }
  
  // 方法5：遍历所有子元素查找 annotation（处理命名空间问题）
  const allElements = mathml.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    if (el.localName === 'annotation' || el.tagName.toLowerCase().endsWith(':annotation')) {
      const encoding = el.getAttribute('encoding') || '';
      if (encoding.includes('tex') || !encoding) {
        const tex = el.textContent?.trim();
        if (tex && tex.length > 0 && /[a-zA-Z\\{}_^]/.test(tex)) {
          console.log('[math] Found LaTeX via getElementsByTagName:', tex.substring(0, 80));
          return tex;
        }
      }
    }
  }
  
  console.log('[math] No annotation found, falling back to textContent extraction');
  
  // 方法6：CSDN 特殊处理 - 从 textContent 提取（最后手段）
  // KaTeX 的 textContent 格式：渲染文本 + LaTeX 文本（拼接在一起）
  // 例如 "E=mc2E=mc^2"：前半是渲染文本 "E=mc2"，后半是 LaTeX "E=mc^2"
  const rawText = mathml.textContent || '';
  if (!rawText) return '';
  
  // 清理空白字符
  const text = rawText.replace(/\s+/g, '').trim();
  if (!text) return '';
  
  console.log('[math] textContent fallback:', text);
  
  const len = text.length;
  
  // 情况1：简单公式（无特殊字符），格式为 "渲染文本 + LaTeX"（完全重复）
  if (len >= 2 && len % 2 === 0) {
    const half = len / 2;
    const firstHalf = text.substring(0, half);
    const secondHalf = text.substring(half);
    if (firstHalf === secondHalf) {
      console.log('[math] Simple repeated formula:', secondHalf);
      return secondHalf;
    }
  }
  
  // 情况2：包含 LaTeX 特殊字符的复杂公式
  // 策略：找到渲染文本和 LaTeX 的分界点
  const latexSpecialChars = /[_{}\\^]/;
  let firstSpecialIdx = -1;
  for (let i = 0; i < text.length; i++) {
    if (latexSpecialChars.test(text[i])) {
      firstSpecialIdx = i;
      break;
    }
  }
  
  console.log('[math] firstSpecialIdx:', firstSpecialIdx, 'char:', text[firstSpecialIdx]);
  
  if (firstSpecialIdx > 0) {
    // 新策略：从文本开头的字符开始，在 firstSpecialIdx 之前找到它的最后一次出现
    // 这个位置就是 LaTeX 的起始位置
    // 例如 "E=mc2E=mc^2"：startChar='E'，在位置 5 找到第二个 'E'，LaTeX 从位置 5 开始
    
    const startChar = text[0];
    let latexStart = -1;
    
    // 从 firstSpecialIdx 向前搜索，找到 startChar 的最后一次出现
    for (let i = firstSpecialIdx - 1; i > 0; i--) {
      if (text[i] === startChar) {
        const candidate = text.substring(i);
        if (latexSpecialChars.test(candidate)) {
          latexStart = i;
          console.log('[math] Found LaTeX start via startChar search:', latexStart);
          break;
        }
      }
    }
    
    // 如果没找到，尝试前缀匹配
    if (latexStart < 0) {
      const beforeSpecial = text.substring(0, firstSpecialIdx);
      for (let prefixLen = Math.min(beforeSpecial.length - 1, 20); prefixLen >= 1; prefixLen--) {
        const prefix = beforeSpecial.substring(0, prefixLen);
        const secondOccurrence = beforeSpecial.indexOf(prefix, prefixLen);
        if (secondOccurrence > 0) {
          const candidate = text.substring(secondOccurrence);
          if (latexSpecialChars.test(candidate)) {
            latexStart = secondOccurrence;
            console.log('[math] Found LaTeX start via prefix match:', latexStart);
            break;
          }
        }
      }
    }
    
    // 备用策略：半分点搜索
    if (latexStart < 0) {
      const estimatedHalf = Math.floor(len / 2);
      for (let offset = 0; offset <= Math.min(10, estimatedHalf); offset++) {
        for (const delta of [0, -offset, offset]) {
          const candidateStart = estimatedHalf + delta;
          if (candidateStart > 0 && candidateStart < firstSpecialIdx) {
            const candidateLatex = text.substring(candidateStart);
            const renderText = text.substring(0, candidateStart);
            if (candidateLatex.length > 0 && renderText.length > 0) {
              const matchLen = Math.min(3, renderText.length, candidateLatex.length);
              if (renderText.substring(0, matchLen) === candidateLatex.substring(0, matchLen)) {
                latexStart = candidateStart;
                console.log('[math] Found LaTeX start via half-point search:', latexStart);
                break;
              }
            }
          }
        }
        if (latexStart >= 0) break;
      }
    }
    
    // 最后备用：从特殊字符位置向前找开头字符
    if (latexStart < 0) {
      latexStart = firstSpecialIdx;
      for (let i = firstSpecialIdx - 1; i > 0; i--) {
        if (text[i] === startChar) {
          const candidateLatex = text.substring(i);
          if (latexSpecialChars.test(candidateLatex)) {
            latexStart = i;
            console.log('[math] Found LaTeX start via fallback:', latexStart);
            break;
          }
        }
      }
    }
    
    if (latexStart > 0) {
      let latex = text.substring(latexStart);
      
      // 后处理：修复常见的 LaTeX 损坏问题
      // 1. 修复 \command* 应该是 \command_ 的情况（如 \mathbb{E}*{ -> \mathbb{E}_{）
      latex = latex.replace(/(\})\*\{/g, '$1_{');
      latex = latex.replace(/([a-zA-Z])\*\{/g, '$1_{');
      
      // 2. 修复缺少空格的命令（如 \logp -> \log p, \simq -> \sim q）
      // 常见的需要后接空格的命令
      const spacedCommands = ['log', 'ln', 'exp', 'sin', 'cos', 'tan', 'lim', 'sum', 'prod', 'int', 'sim', 'approx', 'equiv', 'neq', 'leq', 'geq', 'in', 'notin', 'subset', 'supset', 'cup', 'cap', 'cdot', 'times', 'div', 'pm', 'mp'];
      for (const cmd of spacedCommands) {
        // \cmd 后面直接跟字母（非命令字符）时，添加空格
        const pattern = new RegExp(`\\\\${cmd}([a-zA-Z])`, 'g');
        latex = latex.replace(pattern, `\\${cmd} $1`);
      }
      
      console.log('[math] Extracted LaTeX (improved):', latex.substring(0, 100));
      return latex;
    }
  }
  
  // 情况3：三段式格式
  if (len >= 3) {
    for (let prefixLen = 1; prefixLen < len / 2; prefixLen++) {
      const prefix = text.substring(0, prefixLen);
      if (text.endsWith(prefix)) {
        const middle = text.substring(prefixLen, len - prefixLen);
        if (middle && middle.length > 0) {
          console.log('[math] Three-part formula:', middle.substring(0, 80));
          return middle;
        }
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
        
        // 知乎列表层级修复：知乎的嵌套列表结构可能不标准
        // 确保嵌套的 ul/ol 在 li 内部
        fixZhihuListStructure(container);
        
        // 知乎图片修复：使用 data-actualsrc 或 data-original 替换 src
        // 知乎的懒加载图片 src 可能是占位符 SVG
        container.querySelectorAll('img').forEach((img) => {
          const actualSrc = img.getAttribute('data-actualsrc') || 
                           img.getAttribute('data-original') ||
                           img.getAttribute('data-src');
          const currentSrc = img.getAttribute('src') || '';
          
          // 如果 src 是 data:image 占位符，使用真实 URL 替换
          if (actualSrc && (currentSrc.startsWith('data:') || !currentSrc)) {
            img.setAttribute('src', actualSrc);
            console.log('[zhihu] Fixed image src:', actualSrc.substring(0, 50));
          }
        });
        
        // 知乎公式图片替换为 LaTeX 占位符
        container.querySelectorAll('img.ztext-math, img[data-tex]').forEach((img) => {
          const tex = img.getAttribute('data-tex') || img.getAttribute('alt') || '';
          if (tex) {
            const isDisplay = !!img.closest('figure');
            const DS = String.fromCharCode(36);
            const placeholder = document.createElement('span');
            placeholder.setAttribute('data-sync-math', 'true');
            placeholder.setAttribute('data-tex', tex);
            placeholder.setAttribute('data-display', String(isDisplay));
            placeholder.textContent = isDisplay ? DS + DS + tex + DS + DS : DS + tex + DS;
            img.replaceWith(placeholder);
          }
        });
      }
      
      // 掘金清理
      if (hostname.includes('juejin.cn')) {
        container.querySelectorAll('.article-suspended-panel, .comment-box').forEach(el => el.remove());
      }
      
      // 通用清理 - 移除常见的无关元素
      container.querySelectorAll('script, style, noscript, iframe[src*="ad"], .ad, .ads, .advertisement').forEach(el => el.remove());
      
      // 通用清理 - 过滤平台搜索链接（将链接替换为纯文本）
      // 这些链接通常是平台自动添加的关键词链接，发布到其他平台会有问题
      const searchLinkPatterns = [
        // CSDN 搜索链接
        /so\.csdn\.net\/so\/search/,
        /blog\.csdn\.net\/.*\/search/,
        // 知乎搜索链接
        /zhihu\.com\/search/,
        /www\.zhihu\.com\/search/,
        // 掘金搜索链接
        /juejin\.cn\/search/,
        // 简书搜索链接
        /jianshu\.com\/search/,
        // 博客园搜索链接
        /cnblogs\.com\/.*\/search/,
        // SegmentFault 搜索链接
        /segmentfault\.com\/search/,
        // 通用搜索参数模式
        /[?&]q=/,
        /[?&]keyword=/,
        /[?&]search=/,
      ];
      
      container.querySelectorAll('a[href]').forEach((link) => {
        const href = link.getAttribute('href') || '';
        const isSearchLink = searchLinkPatterns.some(pattern => pattern.test(href));
        
        if (isSearchLink) {
          // 将搜索链接替换为纯文本，保留链接文字
          const text = link.textContent || '';
          const textNode = document.createTextNode(text);
          link.replaceWith(textNode);
          console.log('[clean] Removed search link:', href, '-> text:', text);
        }
      });
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

initAuthDetector();
