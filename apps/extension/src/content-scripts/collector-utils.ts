/**
 * 内容采集工具函数
 * 提供公式提取、图片归一化、DOM清洗等核心功能
 */

// ========== 类型定义 ==========
export interface CollectedImage {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  source?: 'img' | 'picture' | 'noscript' | 'background';
}

export interface CollectedFormula {
  type: 'formula';
  latex: string;
  display: boolean;
  engine: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml' | 'unknown';
  originalFormat?: string;
}

export interface ContentMetrics {
  images: number;
  formulas: number;
  tables: number;
  codeBlocks: number;
  textLen: number;
}

export interface QualityCheck {
  pass: boolean;
  reason?: string;
  initialMetrics: ContentMetrics;
  finalMetrics: ContentMetrics;
  lossRatio: { images: number; formulas: number; tables: number };
}

// ========== 质量指标计算 ==========
export function computeMetrics(html: string): ContentMetrics {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return {
    images: tmp.querySelectorAll('img, picture').length,
    formulas: tmp.querySelectorAll('.katex, mjx-container, math, [data-sync-math]').length,
    tables: tmp.querySelectorAll('table').length,
    codeBlocks: tmp.querySelectorAll('pre > code, pre[class*="language-"]').length,
    textLen: (tmp.textContent || '').trim().length,
  };
}

// ========== 公式提取辅助函数 ==========

/**
 * 从 KaTeX 节点提取原始 LaTeX
 * 关键：MathML 元素在不同命名空间，querySelector 可能无法匹配
 * 解决方案：直接从 innerHTML 用正则提取 annotation 内容
 */
function extractKatexTex(node: Element): string | null {
  // 方法1：尝试从 .katex-mathml 的 innerHTML 中用正则提取
  const mathml = node.querySelector('.katex-mathml');
  if (mathml) {
    const html = mathml.innerHTML;
    console.log('[math] .katex-mathml innerHTML length:', html.length);
    console.log('[math] .katex-mathml innerHTML preview:', html.substring(0, 200));
    
    // 匹配 <annotation encoding="application/x-tex">...</annotation>
    const match = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
    if (match && match[1]) {
      const tex = decodeHtmlEntities(match[1].trim());
      console.log('[math] Extracted LaTeX via regex:', tex.substring(0, 50));
      return tex;
    }
    // 备用：匹配任何 annotation 标签
    const match2 = html.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/i);
    if (match2 && match2[1]) {
      const tex = decodeHtmlEntities(match2[1].trim());
      console.log('[math] Extracted LaTeX via fallback regex:', tex.substring(0, 50));
      return tex;
    }
    console.log('[math] No annotation found in innerHTML');
  } else {
    console.log('[math] No .katex-mathml found');
  }
  
  // 方法2：尝试 querySelector（可能在某些浏览器工作）
  const selectors = [
    'annotation[encoding="application/x-tex"]',
    'annotation',
  ];
  for (const sel of selectors) {
    const el = node.querySelector(sel);
    if (el && el.textContent && el.textContent.trim()) {
      console.log('[math] Found LaTeX via querySelector:', sel);
      return el.textContent.trim();
    }
  }
  
  // 方法3：从 data 属性提取
  const dataTex = node.getAttribute('data-tex') || node.getAttribute('data-latex');
  if (dataTex && dataTex.trim()) {
    console.log('[math] Found LaTeX via data attr');
    return dataTex.trim();
  }
  
  console.log('[math] No LaTeX found in node:', node.className);
  return null;
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * 从 MathJax 节点提取原始 LaTeX
 */
function extractMathJaxTex(node: Element): string | null {
  // 尝试从 innerHTML 用正则提取
  const html = node.innerHTML;
  const match = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
  if (match && match[1]) {
    return decodeHtmlEntities(match[1].trim());
  }
  
  // 尝试 querySelector
  const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation && annotation.textContent) {
    return annotation.textContent.trim();
  }
  
  // 从 data 属性
  const dataTex = node.getAttribute('data-tex') || node.getAttribute('data-latex');
  if (dataTex && dataTex.trim()) return dataTex.trim();
  
  // 从相邻 script 提取
  const prevScript = node.previousElementSibling;
  if (prevScript && prevScript.tagName === 'SCRIPT') {
    const scriptEl = prevScript as HTMLScriptElement;
    if (scriptEl.type && scriptEl.type.startsWith('math/tex')) {
      const tex = scriptEl.textContent;
      if (tex && tex.trim()) return tex.trim();
    }
  }
  
  return null;
}

// ========== 公式 DOM 预处理（核心函数） ==========

export function normalizeMathInDom(root: HTMLElement): void {
  const doc = root.ownerDocument || document;
  const processed = new WeakSet<Element>();
  
  console.log('[math] Starting normalizeMathInDom');
  
  const DS = String.fromCharCode(36); // dollar sign
  
  const createPlaceholder = (tex: string, isDisplay: boolean): HTMLElement => {
    const wrapper = doc.createElement('span');
    wrapper.setAttribute('data-sync-math', 'true');
    wrapper.setAttribute('data-tex', tex);
    wrapper.setAttribute('data-display', String(isDisplay));
    if (isDisplay) {
      wrapper.textContent = DS + DS + tex + DS + DS;
    } else {
      wrapper.textContent = DS + tex + DS;
    }
    return wrapper;
  };
  
  // 1. KaTeX 块级公式
  const displayNodes = root.querySelectorAll('.katex-display, .katex--display');
  console.log('[math] Found display nodes:', displayNodes.length);
  
  displayNodes.forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    node.querySelectorAll('.katex').forEach(k => processed.add(k));
    
    const tex = extractKatexTex(node);
    if (tex) {
      console.log('[math] Replacing display formula');
      node.replaceWith(createPlaceholder(tex, true));
    }
  });
  
  // 2. KaTeX 行内公式
  const inlineNodes = root.querySelectorAll('.katex');
  console.log('[math] Found inline .katex nodes:', inlineNodes.length);
  
  inlineNodes.forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    
    const tex = extractKatexTex(node);
    if (tex) {
      const isDisplay = !!node.closest('.katex-display, .katex--display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 3. MathJax v2 script
  root.querySelectorAll('script[type*="math/tex"]').forEach((script) => {
    if (processed.has(script)) return;
    processed.add(script);
    const tex = script.textContent;
    if (tex && tex.trim()) {
      const type = script.getAttribute('type') || '';
      const isDisplay = type.includes('mode=display');
      script.replaceWith(createPlaceholder(tex.trim(), isDisplay));
    }
  });
  
  // 4. MathJax v3 mjx-container
  root.querySelectorAll('mjx-container').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    const tex = extractMathJaxTex(node);
    if (tex) {
      const isDisplay = node.classList.contains('MJXc-display') || node.hasAttribute('display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 5. MathJax v2 渲染节点
  root.querySelectorAll('.MathJax, .MathJax_Display').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    const tex = (node.getAttribute('data-tex') || node.getAttribute('data-latex') || '').trim();
    if (tex) {
      const isDisplay = node.classList.contains('MathJax_Display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 6. 原生 MathML - 用正则从 innerHTML 提取
  root.querySelectorAll('math').forEach((node) => {
    if (processed.has(node)) return;
    if (node.closest('[data-sync-math]')) return;
    processed.add(node);
    
    const html = node.outerHTML;
    const match = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
    if (match && match[1]) {
      const tex = decodeHtmlEntities(match[1].trim());
      const isDisplay = node.getAttribute('display') === 'block';
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  console.log('[math] normalizeMathInDom completed');
}

// ========== 公式提取器 ==========
export function extractFormulas(container: HTMLElement): CollectedFormula[] {
  const formulas: CollectedFormula[] = [];
  
  normalizeMathInDom(container);
  
  container.querySelectorAll('[data-sync-math]').forEach((el) => {
    const tex = el.getAttribute('data-tex') || '';
    const isDisplay = el.getAttribute('data-display') === 'true';
    
    if (tex) {
      const DS = String.fromCharCode(36);
      formulas.push({
        type: 'formula',
        latex: tex,
        display: isDisplay,
        engine: 'unknown',
        originalFormat: isDisplay ? DS + DS + tex + DS + DS : DS + tex + DS,
      });
    }
  });
  
  console.log('[math] Extracted formulas:', formulas.length);
  return formulas;
}


// ========== 段落空白归一化 ==========
export function normalizeBlockSpacing(container: HTMLElement): void {
  const isEmptyNode = (el: HTMLElement) => {
    const text = (el.textContent || '').replace(/\u00A0/g, ' ').trim();
    if (text) return false;
    if (el.querySelector('img, picture, video, table, pre, code, [data-sync-math]')) return false;
    return true;
  };

  const compressBrs = (node: Element) => {
    const ch = Array.from(node.childNodes);
    let lastWasBr = false;
    for (const n of ch) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if ((n as Element).tagName.toLowerCase() === 'br') {
          if (lastWasBr) { node.removeChild(n); continue; }
          lastWasBr = true;
        } else {
          lastWasBr = false;
          compressBrs(n as Element);
        }
      } else if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent || '';
        if (/^\s+$/.test(t)) {
          const prev = n.previousSibling;
          const next = n.nextSibling;
          if ((prev && (prev as Element).tagName === 'BR') || (next && (next as Element).tagName === 'BR')) {
            node.removeChild(n);
          }
        }
      }
    }
  };

  compressBrs(container);

  container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, section, article').forEach((el) => {
    if (isEmptyNode(el as HTMLElement)) el.remove();
  });

  const trimEdges = (el: HTMLElement) => {
    while (el.firstChild && ((el.firstChild as Element).tagName === 'BR' || (el.firstChild.nodeType === Node.TEXT_NODE && /^\s*$/.test(el.firstChild.textContent || '')))) {
      el.removeChild(el.firstChild);
    }
    while (el.lastChild && ((el.lastChild as Element).tagName === 'BR' || (el.lastChild.nodeType === Node.TEXT_NODE && /^\s*$/.test(el.lastChild.textContent || '')))) {
      el.removeChild(el.lastChild);
    }
  };
  trimEdges(container);
}

// ========== 代码块高亮去壳 ==========
export function flattenCodeHighlights(container: HTMLElement): void {
  container.querySelectorAll('pre > code').forEach((code) => {
    const el = code as HTMLElement;
    const langMatch = el.className.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : el.getAttribute('data-lang') || '';
    const text = el.textContent || '';
    el.innerHTML = '';
    el.textContent = text;
    if (lang) el.className = 'language-' + lang;
  });
}

// ========== DOM 白名单清洗 ==========
const WHITELIST_TAGS = new Set([
  'p', 'div', 'span', 'a', 'strong', 'em', 'b', 'i', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
  'pre', 'code', 'blockquote', 'figure', 'figcaption',
  'img', 'picture', 'source', 'br', 'hr',
]);

export function cleanDOMWithWhitelist(container: HTMLElement): void {
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      if (!WHITELIST_TAGS.has(tagName)) {
        const children = Array.from(el.childNodes);
        children.forEach(child => el.parentNode?.insertBefore(child, el));
        el.remove();
        children.forEach(walk);
        return;
      }
      
      const keepClasses = Array.from(el.classList).filter(c =>
        c.startsWith('katex') || c.startsWith('mjx') || c.includes('math') || c.startsWith('language-') || c.startsWith('hljs')
      );
      el.className = keepClasses.join(' ');
      
      const keepAttrs = ['class', 'src', 'alt', 'title', 'href', 'id', 'data-sync-math', 'data-tex', 'data-display', 'data-lang'];
      Array.from(el.attributes).forEach(attr => {
        if (!keepAttrs.includes(attr.name)) el.removeAttribute(attr.name);
      });
      
      Array.from(el.childNodes).forEach(walk);
    }
  };
  walk(container);
}

// ========== 图片归一化器 ==========
function resolveUrl(src?: string | null, base?: string): string {
  if (!src) return '';
  try { return new URL(src, base || document.baseURI).href; }
  catch { return src; }
}

function parseSrcset(srcset: string | null): string {
  if (!srcset) return '';
  try {
    const candidates = srcset.split(',').map(s => s.trim());
    const parsed = candidates.map(c => {
      const parts = c.split(/\s+/);
      return { u: parts[0], width: parts[1]?.endsWith('w') ? parseInt(parts[1]) : 0 };
    });
    parsed.sort((a, b) => b.width - a.width);
    return parsed[0]?.u || '';
  } catch { return ''; }
}

export function extractAndNormalizeImages(container: HTMLElement): CollectedImage[] {
  const images: CollectedImage[] = [];
  const seen = new Set<string>();
  
  container.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement;
    const src = el.getAttribute('src') || parseSrcset(el.getAttribute('srcset'))
      || el.getAttribute('data-src') || el.getAttribute('data-original')
      || el.getAttribute('data-lazy-src') || el.getAttribute('data-actualsrc');
    const url = resolveUrl(src);
    
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({
        type: 'image', url,
        alt: el.getAttribute('alt') || undefined,
        title: el.getAttribute('title') || undefined,
        width: el.naturalWidth || undefined,
        height: el.naturalHeight || undefined,
        source: 'img',
      });
      el.setAttribute('src', url);
    }
  });
  
  container.querySelectorAll('picture source').forEach((source) => {
    const url = resolveUrl(parseSrcset(source.getAttribute('srcset')));
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({ type: 'image', url, source: 'picture' });
    }
  });
  
  container.querySelectorAll('noscript').forEach((noscript) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = noscript.textContent || '';
    tmp.querySelectorAll('img').forEach((img) => {
      const url = resolveUrl(img.getAttribute('src'));
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push({ type: 'image', url, source: 'noscript' });
      }
    });
  });
  
  return images;
}

// ========== 质量校验 ==========
export function checkQuality(
  initialMetrics: ContentMetrics,
  finalMetrics: ContentMetrics,
  thresholds = { images: 0.3, formulas: 0.5, tables: 0.5 }
): QualityCheck {
  const lossRatio = {
    images: initialMetrics.images > 0 ? (initialMetrics.images - finalMetrics.images) / initialMetrics.images : 0,
    formulas: initialMetrics.formulas > 0 ? (initialMetrics.formulas - finalMetrics.formulas) / initialMetrics.formulas : 0,
    tables: initialMetrics.tables > 0 ? (initialMetrics.tables - finalMetrics.tables) / initialMetrics.tables : 0,
  };
  
  if (lossRatio.images > thresholds.images) {
    return { pass: false, reason: '图片丢失' + (lossRatio.images * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  if (lossRatio.formulas > thresholds.formulas) {
    return { pass: false, reason: '公式丢失' + (lossRatio.formulas * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  if (lossRatio.tables > thresholds.tables) {
    return { pass: false, reason: '表格丢失' + (lossRatio.tables * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  return { pass: true, initialMetrics, finalMetrics, lossRatio };
}
