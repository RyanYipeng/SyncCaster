/**
 * MDH Core Renderer - 基于 markdown-here 渲染逻辑的核心实现
 *
 * 从 markdown-here 项目提取核心渲染能力，封装为纯函数模块。
 * 特性：
 * - Markdown → HTML 转换
 * - Fenced code block 语法高亮（支持语言识别，不识别则降级）
 * - 输出 HTML 片段（非完整文档）
 * - 安全过滤（sanitize）
 * - 图片资源提取
 *
 * @module renderer/mdh-core
 */

import { Marked, type RendererObject, type Tokens } from 'marked';
import hljs from 'highlight.js';

// ============================================================================
// Types
// ============================================================================

export interface RenderOptions {
  /** 启用 GFM 换行（软换行转 <br>） */
  gfmLineBreaks?: boolean;
  /** 启用智能标点（引号、破折号等） */
  smartypants?: boolean;
  /** 启用表格支持 */
  tables?: boolean;
  /** 代码块语言前缀 */
  langPrefix?: string;
  /** 自定义 CSS 类名前缀 */
  classPrefix?: string;
  /** 是否启用 sanitize（默认 true） */
  sanitize?: boolean;
  /** 额外允许的标签（白名单扩展） */
  allowedTags?: string[];
  /** 额外允许的属性 */
  allowedAttributes?: Record<string, string[]>;
}

export interface RenderResult {
  /** 渲染后的 HTML */
  html: string;
  /** 提取的资源信息 */
  assets?: {
    /** 图片 src 列表 */
    images: string[];
    /** 链接 href 列表 */
    links: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

/** 默认白名单标签 */
const DEFAULT_ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'ul', 'ol', 'li',
  'a', 'img', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'del', 's', 'sup', 'sub', 'span', 'div',
]);

/** 默认允许的属性 */
const DEFAULT_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  code: ['class'],
  pre: ['class'],
  span: ['class'],
  div: ['class'],
  th: ['style'],
  td: ['style'],
};

/** 危险协议 */
const DANGEROUS_PROTOCOLS = ['javascript:', 'vbscript:', 'data:text/html'];

// ============================================================================
// HTML Escape & Sanitize
// ============================================================================

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 检查 URL 是否安全
 */
function isSafeUrl(url: string): boolean {
  const lower = url.toLowerCase().trim();
  return !DANGEROUS_PROTOCOLS.some((p) => lower.startsWith(p));
}

/**
 * 简单的 HTML sanitizer
 * 基于白名单策略，移除危险内容
 */
function sanitizeHtml(
  html: string,
  allowedTags: Set<string>,
  allowedAttributes: Record<string, string[]>
): string {
  // 移除 script 标签及内容
  let result = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 移除 style 标签及内容
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 移除所有 on* 事件属性
  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 处理标签
  result = result.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, tagName, attrs) => {
    const tag = tagName.toLowerCase();

    // 不在白名单中的标签，移除标签但保留内容
    if (!allowedTags.has(tag)) {
      return '';
    }

    // 自闭合标签
    const isSelfClosing = match.startsWith('</');
    if (isSelfClosing) {
      return `</${tag}>`;
    }

    // 过滤属性
    const allowedAttrs = allowedAttributes[tag] || [];
    const filteredAttrs: string[] = [];

    // 解析属性
    const attrRegex = /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

      // 检查属性是否允许
      if (!allowedAttrs.includes(attrName)) {
        continue;
      }

      // 检查 href/src 是否安全
      if ((attrName === 'href' || attrName === 'src') && !isSafeUrl(attrValue)) {
        continue;
      }

      filteredAttrs.push(`${attrName}="${escapeHtml(attrValue)}"`);
    }

    // 处理 class 属性（特殊处理，允许 class 但需要在白名单中）
    const classMatch = attrs.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (classMatch && allowedAttrs.includes('class')) {
      const classValue = classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '';
      if (!filteredAttrs.some((a) => a.startsWith('class='))) {
        filteredAttrs.push(`class="${escapeHtml(classValue)}"`);
      }
    }

    const attrStr = filteredAttrs.length > 0 ? ' ' + filteredAttrs.join(' ') : '';
    return `<${tag}${attrStr}>`;
  });

  return result;
}

// ============================================================================
// Smartypants (from markdown-here)
// ============================================================================

/**
 * 智能标点转换（来自 markdown-here）
 */
function smartypants(text: string): string {
  return (
    text
      // 智能箭头
      .replace(/<-->/g, '\u2194')
      .replace(/<--/g, '\u2190')
      .replace(/-->/g, '\u2192')
      .replace(/<==>/g, '\u21d4')
      .replace(/<==/g, '\u21d0')
      .replace(/==>/g, '\u21d2')
      // em-dashes
      .replace(/--/g, '\u2014')
      // opening singles
      .replace(/(^|[-\u2014/(\[{"\s])'/g, '$1\u2018')
      // closing singles & apostrophes
      .replace(/'/g, '\u2019')
      // opening doubles
      .replace(/(^|[-\u2014/(\[{\u2018\s])"/g, '$1\u201c')
      // closing doubles
      .replace(/"/g, '\u201d')
      // ellipses
      .replace(/\.{3}/g, '\u2026')
  );
}

// ============================================================================
// Code Highlighting
// ============================================================================

/**
 * 代码高亮
 * 能识别语言则高亮，不能识别则降级为纯文本
 */
function highlightCode(code: string, lang: string): string {
  if (!lang) {
    // 无语言标识，尝试自动检测
    try {
      const result = hljs.highlightAuto(code);
      return result.value;
    } catch {
      return escapeHtml(code);
    }
  }

  const language = lang.toLowerCase();

  // 检查语言是否支持
  if (hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }

  // 语言不支持，降级为纯文本
  return escapeHtml(code);
}

// ============================================================================
// Asset Extraction
// ============================================================================

/**
 * 从 HTML 中提取资源
 */
function extractAssets(html: string): { images: string[]; links: string[] } {
  const images: string[] = [];
  const links: string[] = [];

  // 提取图片
  const imgRegex = /<img[^>]+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1] ?? match[2] ?? match[3];
    if (src) images.push(src);
  }

  // 提取链接
  const linkRegex = /<a[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] ?? match[2] ?? match[3];
    if (href && !href.startsWith('#')) links.push(href);
  }

  return { images, links };
}

// ============================================================================
// Marked Renderer
// ============================================================================

/**
 * 创建自定义渲染器
 */
function createRenderer(options: RenderOptions): RendererObject {
  const langPrefix = options.langPrefix ?? 'hljs language-';

  return {
    code({ text, lang }: Tokens.Code): string {
      const language = lang?.split(' ')[0] || '';
      const highlighted = highlightCode(text, language);
      const langClass = language ? `${langPrefix}${language}` : 'hljs';
      return `<pre><code class="${langClass}">${highlighted}</code></pre>\n`;
    },

    codespan({ text }: Tokens.Codespan): string {
      return `<code>${escapeHtml(text)}</code>`;
    },

    heading({ tokens, depth }: Tokens.Heading): string {
      const text = this.parser.parseInline(tokens);
      return `<h${depth}>${text}</h${depth}>\n`;
    },

    paragraph({ tokens }: Tokens.Paragraph): string {
      const text = this.parser.parseInline(tokens);
      return `<p>${text}</p>\n`;
    },

    blockquote({ tokens }: Tokens.Blockquote): string {
      const body = this.parser.parse(tokens);
      return `<blockquote>${body}</blockquote>\n`;
    },

    list({ ordered, items, start }: Tokens.List): string {
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      const body = items.map((item) => this.listitem(item)).join('');
      return `<${tag}${startAttr}>\n${body}</${tag}>\n`;
    },

    listitem(token: Tokens.ListItem): string {
      let content: string;
      if (token.task) {
        const checkbox = token.checked
          ? '<input type="checkbox" checked disabled> '
          : '<input type="checkbox" disabled> ';
        content = checkbox + this.parser.parse(token.tokens);
      } else {
        content = this.parser.parse(token.tokens);
      }
      return `<li>${content}</li>\n`;
    },

    table({ header, rows }: Tokens.Table): string {
      const headerCells = header
        .map((cell) => {
          const align = cell.align ? ` style="text-align:${cell.align}"` : '';
          return `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        })
        .join('');

      const bodyRows = rows
        .map((row) => {
          const cells = row
            .map((cell) => {
              const align = cell.align ? ` style="text-align:${cell.align}"` : '';
              return `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('\n');

      return `<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>\n`;
    },

    hr(): string {
      return '<hr>\n';
    },

    link({ href, title, tokens }: Tokens.Link): string {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      // 安全检查在 sanitize 阶段处理
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    },

    image({ href, title, text }: Tokens.Image): string {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const altAttr = text ? ` alt="${escapeHtml(text)}"` : '';
      return `<img src="${escapeHtml(href)}"${altAttr}${titleAttr}>`;
    },

    strong({ tokens }: Tokens.Strong): string {
      return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    },

    em({ tokens }: Tokens.Em): string {
      return `<em>${this.parser.parseInline(tokens)}</em>`;
    },

    del({ tokens }: Tokens.Del): string {
      return `<del>${this.parser.parseInline(tokens)}</del>`;
    },

    br(): string {
      return '<br>\n';
    },

    text(token: Tokens.Text | Tokens.Escape): string {
      const text = token.text || (token as any).raw || '';
      return options.smartypants ? smartypants(text) : text;
    },
  };
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * 渲染 Markdown 为 HTML
 *
 * @param markdown - Markdown 源文本
 * @param options - 渲染选项
 * @returns 渲染结果，包含 HTML 和资源信息
 */
export function renderMarkdownToHtml(markdown: string, options: RenderOptions = {}): RenderResult {
  const {
    gfmLineBreaks = false,
    smartypants: enableSmartypants = true,
    tables = true,
    sanitize = true,
    allowedTags = [],
    allowedAttributes = {},
  } = options;

  // 预处理
  let md = markdown || '';
  md = md.replace(/\r\n/g, '\n');

  // 创建 marked 实例
  const marked = new Marked({
    gfm: true,
    breaks: gfmLineBreaks,
    pedantic: false,
  });

  // 设置自定义渲染器
  marked.use({
    renderer: createRenderer({ ...options, smartypants: enableSmartypants }),
  });

  // 渲染
  let html = marked.parse(md) as string;

  // Sanitize
  if (sanitize) {
    const tags = new Set([...DEFAULT_ALLOWED_TAGS, ...allowedTags]);
    const attrs = { ...DEFAULT_ALLOWED_ATTRIBUTES };
    for (const [tag, tagAttrs] of Object.entries(allowedAttributes)) {
      attrs[tag] = [...(attrs[tag] || []), ...tagAttrs];
    }
    html = sanitizeHtml(html, tags, attrs);
  }

  // 提取资源
  const assets = extractAssets(html);

  return { html, assets };
}

// ============================================================================
// Export
// ============================================================================

export default renderMarkdownToHtml;
