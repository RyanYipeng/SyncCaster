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
  display: boolean; // true=block, false=inline
  engine: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml' | 'unknown';
}

export interface ContentMetrics {
  images: number;
  formulas: number;
  tables: number;
  codeBlocks: number;
  textLen: number;
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

// ========== 公式提取器 ==========
export function extractFormulas(container: HTMLElement): CollectedFormula[] {
  const formulas: CollectedFormula[] = [];
  
  // 1. KaTeX
  container.querySelectorAll('.katex').forEach((el) => {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      const latex = annotation.textContent || '';
      const display = el.classList.contains('katex-display');
      formulas.push({ type: 'formula', latex, display, engine: 'katex' });
      
      // 替换为占位符
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-sync-math', 'true');
      placeholder.setAttribute('data-tex', latex);
      placeholder.setAttribute('data-display', display.toString());
      el.replaceWith(placeholder);
    }
  });
  
  // 2. MathJax v2 (script type="math/tex")
  container.querySelectorAll('script[type*="math/tex"]').forEach((el) => {
    const latex = el.textContent || '';
    const display = el.getAttribute('type')?.includes('mode=display') || false;
    formulas.push({ type: 'formula', latex, display, engine: 'mathjax2' });
    
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-sync-math', 'true');
    placeholder.setAttribute('data-tex', latex);
    placeholder.setAttribute('data-display', display.toString());
    el.replaceWith(placeholder);
  });
  
  // 3. MathJax v3 (mjx-container)
  container.querySelectorAll('mjx-container').forEach((el) => {
    const mathEl = el.querySelector('math');
    if (mathEl) {
      // 简化：直接取MathML文本作为LaTeX（实际应转换）
      const latex = mathEl.textContent || '';
      const display = el.classList.contains('MJXc-display') || el.hasAttribute('display');
      formulas.push({ type: 'formula', latex, display, engine: 'mathjax3' });
      
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-sync-math', 'true');
      placeholder.setAttribute('data-tex', latex);
      placeholder.setAttribute('data-display', display.toString());
      el.replaceWith(placeholder);
    }
  });
  
  // 4. 原生 MathML
  container.querySelectorAll('math').forEach((el) => {
    if (!el.closest('[data-sync-math]')) {
      const latex = el.textContent || '';
      const display = el.getAttribute('display') === 'block';
      formulas.push({ type: 'formula', latex, display, engine: 'mathml' });
      
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-sync-math', 'true');
      placeholder.setAttribute('data-tex', latex);
      placeholder.setAttribute('data-display', display.toString());
      el.replaceWith(placeholder);
    }
  });
  
  return formulas;
}

// ========== 代码块高亮去壳 ==========
export function flattenCodeHighlights(container: HTMLElement): void {
  container.querySelectorAll('pre > code').forEach((code) => {
    const el = code as HTMLElement;
    
    // 提取语言
    const langMatch = el.className.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : el.getAttribute('data-lang') || '';
    
    // 展平所有嵌套的 span.token
    const text = el.textContent || '';
    el.innerHTML = '';
    el.textContent = text;
    
    // 保留语言class
    if (lang) {
      el.className = `language-${lang}`;
    }
  });
}

// ========== DOM 白名单清洗 ==========
const WHITELIST_TAGS = new Set([
  'p', 'div', 'span', 'a', 'strong', 'em', 'b', 'i', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
  'pre', 'code',
  'blockquote', 'figure', 'figcaption',
  'img', 'picture', 'source',
  'br', 'hr',
]);

const PRESERVE_CLASSES = ['katex', 'mjx', 'math', 'language-', 'hljs', 'token', 'data-sync-math'];

export function cleanDOMWithWhitelist(container: HTMLElement): void {
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      // 保留白名单标签
      if (!WHITELIST_TAGS.has(tagName)) {
        // 保留子节点但移除包裹层
        const children = Array.from(el.childNodes);
        children.forEach(child => el.parentNode?.insertBefore(child, el));
        el.remove();
        children.forEach(walk);
        return;
      }
      
      // 清理属性，但保留关键class
      const classList = Array.from(el.classList);
      const keepClasses = classList.filter(c =>
        PRESERVE_CLASSES.some(prefix => c.startsWith(prefix) || c.includes(prefix))
      );
      el.className = keepClasses.join(' ');
      
      // 保留特定data属性
      const keepDataAttrs = ['data-sync-math', 'data-tex', 'data-display', 'data-lang'];
      const attrs = Array.from(el.attributes);
      attrs.forEach(attr => {
        if (!['class', 'src', 'alt', 'title', 'href', 'id'].includes(attr.name)
          && !keepDataAttrs.includes(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
      
      // 递归处理子节点
      Array.from(el.childNodes).forEach(walk);
    }
  };
  
  walk(container);
}

// ========== 图片归一化器（增强版） ==========
function resolveUrl(src?: string | null, base?: string): string {
  if (!src) return '';
  try {
    return new URL(src, base || document.baseURI).href;
  } catch {
    return src;
  }
}

function parseSrcset(srcset: string | null): string {
  if (!srcset) return '';
  try {
    const candidates = srcset.split(',').map(s => s.trim());
    const parsed = candidates.map(c => {
      const [u, w] = c.split(/\s+/);
      const width = w && w.endsWith('w') ? parseInt(w) : 0;
      return { u, width };
    });
    parsed.sort((a, b) => b.width - a.width);
    return parsed[0]?.u || '';
  } catch {
    return '';
  }
}

export function extractAndNormalizeImages(container: HTMLElement): CollectedImage[] {
  const images: CollectedImage[] = [];
  const seen = new Set<string>();
  
  // 1. 普通 <img>
  container.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement;
    const src = el.getAttribute('src')
      || parseSrcset(el.getAttribute('srcset'))
      || el.getAttribute('data-src')
      || el.getAttribute('data-original')
      || el.getAttribute('data-lazy-src')
      || el.getAttribute('data-actualsrc');
    const url = resolveUrl(src);
    
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({
        type: 'image',
        url,
        alt: el.getAttribute('alt') || undefined,
        title: el.getAttribute('title') || undefined,
        width: el.naturalWidth || undefined,
        height: el.naturalHeight || undefined,
        source: 'img',
      });
      // 写回标准 src
      el.setAttribute('src', url);
    }
  });
  
  // 2. <picture> 的 <source>
  container.querySelectorAll('picture').forEach((pic) => {
    const sources = pic.querySelectorAll('source');
    sources.forEach((source) => {
      const src = parseSrcset(source.getAttribute('srcset'));
      const url = resolveUrl(src);
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push({ type: 'image', url, source: 'picture' });
      }
    });
  });
  
  // 3. <noscript> 中的 <img>
  container.querySelectorAll('noscript').forEach((noscript) => {
    const html = noscript.textContent || '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('img').forEach((img) => {
      const url = resolveUrl(img.getAttribute('src'));
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push({ type: 'image', url, source: 'noscript' });
      }
    });
  });
  
  // 4. 背景图 (style.backgroundImage)
  container.querySelectorAll('[style*="background"]').forEach((el) => {
    const style = (el as HTMLElement).style.backgroundImage;
    const match = style.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (match) {
      const url = resolveUrl(match[1]);
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push({ type: 'image', url, source: 'background' });
      }
    }
  });
  
  return images;
}

// ========== 质量校验 ==========
export interface QualityCheck {
  pass: boolean;
  reason?: string;
  initialMetrics: ContentMetrics;
  finalMetrics: ContentMetrics;
  lossRatio: {
    images: number;
    formulas: number;
    tables: number;
  };
}

export function checkQuality(
  initialMetrics: ContentMetrics,
  finalMetrics: ContentMetrics,
  thresholds = { images: 0.3, formulas: 0.5, tables: 0.5 }
): QualityCheck {
  const lossRatio = {
    images: initialMetrics.images > 0
      ? (initialMetrics.images - finalMetrics.images) / initialMetrics.images
      : 0,
    formulas: initialMetrics.formulas > 0
      ? (initialMetrics.formulas - finalMetrics.formulas) / initialMetrics.formulas
      : 0,
    tables: initialMetrics.tables > 0
      ? (initialMetrics.tables - finalMetrics.tables) / initialMetrics.tables
      : 0,
  };
  
  if (lossRatio.images > thresholds.images) {
    return {
      pass: false,
      reason: `图片丢失${(lossRatio.images * 100).toFixed(1)}%，超过阈值${thresholds.images * 100}%`,
      initialMetrics,
      finalMetrics,
      lossRatio,
    };
  }
  
  if (lossRatio.formulas > thresholds.formulas) {
    return {
      pass: false,
      reason: `公式丢失${(lossRatio.formulas * 100).toFixed(1)}%`,
      initialMetrics,
      finalMetrics,
      lossRatio,
    };
  }
  
  if (lossRatio.tables > thresholds.tables) {
    return {
      pass: false,
      reason: `表格丢失${(lossRatio.tables * 100).toFixed(1)}%`,
      initialMetrics,
      finalMetrics,
      lossRatio,
    };
  }
  
  return { pass: true, initialMetrics, finalMetrics, lossRatio };
}
