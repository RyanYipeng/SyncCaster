/**
 * DOM → Canonical AST 转换器
 * 
 * 核心原则：
 * 1. 直接从 DOM 构建 AST，不经过 Markdown 中间层
 * 2. 图片、公式等资源在转换时收集到 AssetManifest
 * 3. 保留尽可能多的语义信息
 * 4. 未知结构用 HtmlBlock/CustomBlock 兜底
 */

import type {
  RootNode,
  BlockNode,
  InlineNode,
  TextNode,
  ParagraphNode,
  HeadingNode,
  BlockquoteNode,
  ListNode,
  ListItemNode,
  CodeBlockNode,
  MathBlockNode,
  ThematicBreakNode,
  ImageBlockNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  TableAlign,
  HtmlBlockNode,
  EmbedBlockNode,
  EmphasisNode,
  StrongNode,
  DeleteNode,
  InlineCodeNode,
  LinkNode,
  ImageInlineNode,
  MathInlineNode,
  BreakNode,
  HtmlInlineNode,
  CanonicalAssetManifest,
  ImageAssetEntry,
  FormulaAssetEntry,
  CanonicalContent,
} from './canonical-ast';

// ========== 转换配置 ==========

export interface DomToAstOptions {
  /** 基础 URL，用于解析相对路径 */
  baseUrl?: string;
  /** 是否保留未知 HTML */
  preserveUnknownHtml?: boolean;
  /** 自定义元素处理器 */
  customHandlers?: Record<string, ElementHandler>;
}

export type ElementHandler = (
  el: Element,
  ctx: ConversionContext
) => BlockNode | InlineNode | null;


// ========== 转换上下文 ==========

export class ConversionContext {
  public assets: CanonicalAssetManifest = {
    images: [],
    formulas: [],
    embeds: [],
  };
  
  private imageIdCounter = 0;
  private formulaIdCounter = 0;
  private seenImageUrls = new Set<string>();
  
  constructor(public options: DomToAstOptions = {}) {}
  
  /** 注册图片资产，返回 assetId */
  registerImage(url: string, meta?: Partial<ImageAssetEntry>): string {
    // 解析相对 URL
    const resolvedUrl = this.resolveUrl(url);
    
    // 检查是否已存在
    const existing = this.assets.images.find(img => img.originalUrl === resolvedUrl);
    if (existing) return existing.id;
    
    const id = `img-${this.imageIdCounter++}`;
    this.assets.images.push({
      id,
      originalUrl: resolvedUrl,
      status: 'pending',
      alt: meta?.alt,
      title: meta?.title,
      width: meta?.width,
      height: meta?.height,
    });
    this.seenImageUrls.add(resolvedUrl);
    
    return id;
  }
  
  /** 注册公式资产，返回 assetId */
  registerFormula(tex: string, display: boolean, engine?: string): string {
    const id = `formula-${this.formulaIdCounter++}`;
    this.assets.formulas.push({
      id,
      tex,
      display,
      engine,
    });
    return id;
  }
  
  /** 解析 URL */
  resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    try {
      return new URL(url, this.options.baseUrl || 'https://example.com').href;
    } catch {
      return url;
    }
  }
}


// ========== 主转换函数 ==========

/**
 * 将 HTML 字符串转换为 Canonical AST
 */
export function htmlToCanonicalAst(
  html: string,
  options: DomToAstOptions = {}
): CanonicalContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return domToCanonicalAst(doc.body, options);
}

/**
 * 将 DOM 元素转换为 Canonical AST
 */
export function domToCanonicalAst(
  root: Element,
  options: DomToAstOptions = {}
): CanonicalContent {
  const ctx = new ConversionContext(options);
  
  const children = convertChildren(root, ctx, 'block') as BlockNode[];
  
  // 合并连续的空段落
  const mergedChildren = mergeEmptyParagraphs(children);
  
  const ast: RootNode = {
    type: 'root',
    children: mergedChildren,
  };
  
  return {
    ast,
    assets: ctx.assets,
  };
}

// ========== 子节点转换 ==========

function convertChildren(
  parent: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): (BlockNode | InlineNode)[] {
  const result: (BlockNode | InlineNode)[] = [];
  
  for (const child of Array.from(parent.childNodes)) {
    const converted = convertNode(child, ctx, expectedType);
    if (converted) {
      if (Array.isArray(converted)) {
        result.push(...converted);
      } else {
        result.push(converted);
      }
    }
  }
  
  return result;
}


// ========== 节点转换 ==========

function convertNode(
  node: Node,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  // 文本节点
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (!text.trim()) return null;
    return { type: 'text', value: text } as TextNode;
  }
  
  // 元素节点
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    return convertElement(el, ctx, expectedType);
  }
  
  return null;
}

function convertElement(
  el: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  const tagName = el.tagName.toLowerCase();
  
  // 检查自定义处理器
  if (ctx.options.customHandlers?.[tagName]) {
    return ctx.options.customHandlers[tagName](el, ctx);
  }
  
  // 公式检测（优先处理）
  const mathNode = tryConvertMath(el, ctx);
  if (mathNode) return mathNode;
  
  // 嵌入内容检测
  const embedNode = tryConvertEmbed(el, ctx);
  if (embedNode) return embedNode;
  
  // 按标签类型处理
  switch (tagName) {
    // 标题
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return convertHeading(el, ctx);
    
    // 段落
    case 'p':
      return convertParagraph(el, ctx);
    
    // 引用
    case 'blockquote':
      return convertBlockquote(el, ctx);
    
    // 列表
    case 'ul': case 'ol':
      return convertList(el, ctx);
    case 'li':
      return convertListItem(el, ctx);
    
    // 代码块
    case 'pre':
      return convertCodeBlock(el, ctx);
    
    // 表格
    case 'table':
      return convertTable(el, ctx);
    
    // 分割线
    case 'hr':
      return { type: 'thematicBreak' } as ThematicBreakNode;
    
    // 图片（块级）
    case 'figure':
      return convertFigure(el, ctx);
    case 'img':
      return convertImage(el, ctx, expectedType);
    
    // 内联元素
    case 'strong': case 'b':
      return convertStrong(el, ctx);
    case 'em': case 'i':
      return convertEmphasis(el, ctx);
    case 'del': case 's': case 'strike':
      return convertDelete(el, ctx);
    case 'code':
      return convertInlineCode(el, ctx);
    case 'a':
      return convertLink(el, ctx);
    case 'br':
      return { type: 'break' } as BreakNode;
    
    // 容器元素（透传子节点）
    case 'div': case 'section': case 'article': case 'main': case 'span':
      return convertContainer(el, ctx, expectedType);
    
    // 忽略的元素
    case 'script': case 'style': case 'noscript': case 'nav': case 'footer':
    case 'aside': case 'header': case 'form': case 'button': case 'input':
      return null;
    
    default:
      // 未知元素：尝试透传或保留 HTML
      return convertUnknown(el, ctx, expectedType);
  }
}


// ========== 块级元素转换 ==========

function convertHeading(el: Element, ctx: ConversionContext): HeadingNode {
  const depth = parseInt(el.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'heading', depth, children };
}

function convertParagraph(el: Element, ctx: ConversionContext): ParagraphNode | null {
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  if (children.length === 0) return null;
  return { type: 'paragraph', children };
}

function convertBlockquote(el: Element, ctx: ConversionContext): BlockquoteNode {
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  return { type: 'blockquote', children };
}

function convertList(el: Element, ctx: ConversionContext): ListNode {
  const ordered = el.tagName.toLowerCase() === 'ol';
  const start = ordered ? parseInt(el.getAttribute('start') || '1') : undefined;
  const items: ListItemNode[] = [];
  
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === 'li') {
      const item = convertListItem(child, ctx);
      if (item) items.push(item as ListItemNode);
    }
  }
  
  return { type: 'list', ordered, start, children: items };
}

function convertListItem(el: Element, ctx: ConversionContext): ListItemNode {
  // 检查是否是任务列表项
  const checkbox = el.querySelector('input[type="checkbox"]');
  let checked: boolean | null = null;
  if (checkbox) {
    checked = (checkbox as HTMLInputElement).checked;
    checkbox.remove();
  }
  
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  
  // 如果子节点都是内联的，包装成段落
  const wrappedChildren = wrapInlineAsBlock(children);
  
  return { type: 'listItem', checked, children: wrappedChildren };
}

function convertCodeBlock(el: Element, ctx: ConversionContext): CodeBlockNode {
  const codeEl = el.querySelector('code') || el;
  const langMatch = codeEl.className.match(/language-(\w+)/);
  const lang = langMatch?.[1] || codeEl.getAttribute('data-lang') || '';
  const value = codeEl.textContent || '';
  
  return { type: 'codeBlock', lang: lang || undefined, value };
}

function convertFigure(el: Element, ctx: ConversionContext): ImageBlockNode | BlockNode | null {
  const img = el.querySelector('img');
  const figcaption = el.querySelector('figcaption');
  
  if (img) {
    const src = getImageSrc(img);
    if (!src) return null;
    
    const assetId = ctx.registerImage(src, {
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
      width: img.naturalWidth || parseInt(img.getAttribute('width') || '0') || undefined,
      height: img.naturalHeight || parseInt(img.getAttribute('height') || '0') || undefined,
    });
    
    const caption = figcaption
      ? convertChildren(figcaption, ctx, 'inline') as InlineNode[]
      : undefined;
    
    return {
      type: 'imageBlock',
      assetId,
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
      caption,
      originalUrl: src,
    };
  }
  
  // 非图片 figure，透传内容
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  return children.length === 1 ? children[0] : null;
}


// ========== 表格转换 ==========

function convertTable(el: Element, ctx: ConversionContext): TableNode {
  const rows: TableRowNode[] = [];
  const align: TableAlign[] = [];
  let hasRowspan = false;
  let hasColspan = false;
  
  // 提取对齐信息
  const colgroup = el.querySelector('colgroup');
  if (colgroup) {
    for (const col of Array.from(colgroup.querySelectorAll('col'))) {
      const style = col.getAttribute('style') || '';
      const alignMatch = style.match(/text-align:\s*(left|center|right)/);
      align.push(alignMatch ? alignMatch[1] as TableAlign : null);
    }
  }
  
  // 提取表头
  const thead = el.querySelector('thead');
  if (thead) {
    for (const tr of Array.from(thead.querySelectorAll('tr'))) {
      const row = convertTableRow(tr, ctx, true);
      if (row.children.some(c => c.rowspan && c.rowspan > 1)) hasRowspan = true;
      if (row.children.some(c => c.colspan && c.colspan > 1)) hasColspan = true;
      rows.push(row);
    }
  }
  
  // 提取表体
  const tbody = el.querySelector('tbody') || el;
  for (const tr of Array.from(tbody.querySelectorAll(':scope > tr'))) {
    const row = convertTableRow(tr, ctx, false);
    if (row.children.some(c => c.rowspan && c.rowspan > 1)) hasRowspan = true;
    if (row.children.some(c => c.colspan && c.colspan > 1)) hasColspan = true;
    rows.push(row);
  }
  
  // 如果没有 thead，第一行可能是表头
  if (!thead && rows.length > 0) {
    const firstRow = rows[0];
    const hasThCells = firstRow.children.some(c => c.header);
    if (hasThCells) {
      firstRow.children.forEach(c => c.header = true);
    }
  }
  
  // 提取 caption
  const captionEl = el.querySelector('caption');
  const caption = captionEl
    ? convertChildren(captionEl, ctx, 'inline') as InlineNode[]
    : undefined;
  
  return {
    type: 'table',
    align: align.length > 0 ? align : undefined,
    children: rows,
    hasRowspan,
    hasColspan,
    caption,
  };
}

function convertTableRow(tr: Element, ctx: ConversionContext, isHeader: boolean): TableRowNode {
  const cells: TableCellNode[] = [];
  
  for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
    const isHeaderCell = cell.tagName.toLowerCase() === 'th' || isHeader;
    const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
    const colspan = parseInt(cell.getAttribute('colspan') || '1');
    
    // 提取对齐
    const style = cell.getAttribute('style') || '';
    const alignMatch = style.match(/text-align:\s*(left|center|right)/);
    const align = alignMatch ? alignMatch[1] as TableAlign : null;
    
    const children = convertChildren(cell, ctx, 'inline') as InlineNode[];
    
    cells.push({
      type: 'tableCell',
      header: isHeaderCell,
      align,
      rowspan: rowspan > 1 ? rowspan : undefined,
      colspan: colspan > 1 ? colspan : undefined,
      children,
    });
  }
  
  return { type: 'tableRow', children: cells };
}


// ========== 公式转换 ==========

function tryConvertMath(el: Element, ctx: ConversionContext): MathBlockNode | MathInlineNode | null {
  // 1. KaTeX
  if (el.classList.contains('katex')) {
    const tex = extractLatex(el);
    if (tex) {
      const display = el.classList.contains('katex-display');
      ctx.registerFormula(tex, display, 'katex');
      
      if (display) {
        return { type: 'mathBlock', tex, engine: 'katex' };
      } else {
        return { type: 'mathInline', tex, engine: 'katex' };
      }
    }
    return { type: 'text', value: '' } as any;
  }
  
  // 2. MathJax v2 (script type="math/tex")
  if (el.tagName.toLowerCase() === 'script') {
    const type = el.getAttribute('type') || '';
    if (type.includes('math/tex')) {
      const tex = (el.textContent || '').trim();
      const display = type.includes('mode=display');
      if (tex) {
        ctx.registerFormula(tex, display, 'mathjax2');
        
        if (display) {
          return { type: 'mathBlock', tex, engine: 'mathjax2' };
        } else {
          return { type: 'mathInline', tex, engine: 'mathjax2' };
        }
      }
      return { type: 'text', value: '' } as any;
    }
  }
  
  // 3. MathJax v3 (mjx-container)
  if (el.tagName.toLowerCase() === 'mjx-container') {
    const mathEl = el.querySelector('math');
    const tex = extractLatex(el) || extractLatex(mathEl) || fallbackMathText(mathEl);
    const display = el.classList.contains('MJXc-display') || el.hasAttribute('display');
    if (tex) {
      ctx.registerFormula(tex, display, 'mathjax3');
      
      if (display) {
        return { type: 'mathBlock', tex, engine: 'mathjax3' };
      } else {
        return { type: 'mathInline', tex, engine: 'mathjax3' };
      }
    }
    return { type: 'text', value: '' } as any;
  }
  
  // 4. 原生 MathML
  if (el.tagName.toLowerCase() === 'math') {
    const tex = extractLatex(el) || fallbackMathText(el);
    const display = el.getAttribute('display') === 'block';
    if (tex) {
      ctx.registerFormula(tex, display, 'mathml');
      
      if (display) {
        return { type: 'mathBlock', tex, engine: 'mathml' };
      } else {
        return { type: 'mathInline', tex, engine: 'mathml' };
      }
    }
    return { type: 'text', value: '' } as any;
  }
  
  // 5. 自定义公式标记 (data-sync-math)
  if (el.hasAttribute('data-sync-math')) {
    const tex = (el.getAttribute('data-tex') || el.textContent || '').trim();
    const display = el.getAttribute('data-display') === 'true';
    if (tex) {
      ctx.registerFormula(tex, display, 'custom');
      
      if (display) {
        return { type: 'mathBlock', tex };
      } else {
        return { type: 'mathInline', tex };
      }
    }
    return { type: 'text', value: '' } as any;
  }
  
  return null;
}

function extractLatex(el?: Element | null): string | null {
  if (!el) return null;
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation?.textContent?.trim()) return annotation.textContent.trim();
  const dataTex = el.getAttribute('data-latex') || el.getAttribute('data-tex');
  if (dataTex?.trim()) return dataTex.trim();
  return null;
}

function fallbackMathText(el?: Element | null): string | null {
  if (!el) return null;
  const text = el.textContent?.trim() || '';
  return text ? text : null;
}


// ========== 嵌入内容转换 ==========

function tryConvertEmbed(el: Element, ctx: ConversionContext): EmbedBlockNode | null {
  const tagName = el.tagName.toLowerCase();
  
  // iframe 嵌入
  if (tagName === 'iframe') {
    const src = el.getAttribute('src') || '';
    const provider = detectEmbedProvider(src);
    
    return {
      type: 'embedBlock',
      embedType: 'iframe',
      url: src,
      html: el.outerHTML,
      provider,
    };
  }
  
  // video 嵌入
  if (tagName === 'video') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    
    return {
      type: 'embedBlock',
      embedType: 'video',
      url: src,
      html: el.outerHTML,
    };
  }
  
  // audio 嵌入
  if (tagName === 'audio') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    
    return {
      type: 'embedBlock',
      embedType: 'audio',
      url: src,
      html: el.outerHTML,
    };
  }
  
  // 平台特定卡片（掘金、知乎等）
  if (el.classList.contains('link-card') || el.classList.contains('embed-card')) {
    const link = el.querySelector('a');
    const url = link?.getAttribute('href') || '';
    
    return {
      type: 'embedBlock',
      embedType: 'card',
      url,
      html: el.outerHTML,
    };
  }
  
  return null;
}

function detectEmbedProvider(url: string): string | undefined {
  if (!url) return undefined;
  
  const providers: Record<string, RegExp> = {
    youtube: /youtube\.com|youtu\.be/,
    bilibili: /bilibili\.com/,
    vimeo: /vimeo\.com/,
    twitter: /twitter\.com|x\.com/,
    codepen: /codepen\.io/,
    codesandbox: /codesandbox\.io/,
    jsfiddle: /jsfiddle\.net/,
  };
  
  for (const [provider, regex] of Object.entries(providers)) {
    if (regex.test(url)) return provider;
  }
  
  return undefined;
}


// ========== 内联元素转换 ==========

function convertStrong(el: Element, ctx: ConversionContext): StrongNode {
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'strong', children };
}

function convertEmphasis(el: Element, ctx: ConversionContext): EmphasisNode {
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'emphasis', children };
}

function convertDelete(el: Element, ctx: ConversionContext): DeleteNode {
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'delete', children };
}

function convertInlineCode(el: Element, ctx: ConversionContext): InlineCodeNode {
  return { type: 'inlineCode', value: el.textContent || '' };
}

function convertLink(el: Element, ctx: ConversionContext): LinkNode {
  const href = el.getAttribute('href') || '';
  const title = el.getAttribute('title') || undefined;
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  
  return {
    type: 'link',
    url: ctx.resolveUrl(href),
    title,
    children,
  };
}

function convertImage(
  el: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): ImageBlockNode | ImageInlineNode | null {
  const img = el as HTMLImageElement;
  const src = getImageSrc(img);
  if (!src) return null;
  
  const assetId = ctx.registerImage(src, {
    alt: img.getAttribute('alt') || undefined,
    title: img.getAttribute('title') || undefined,
    width: img.naturalWidth || parseInt(img.getAttribute('width') || '0') || undefined,
    height: img.naturalHeight || parseInt(img.getAttribute('height') || '0') || undefined,
  });
  
  if (expectedType === 'block') {
    return {
      type: 'imageBlock',
      assetId,
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
      originalUrl: src,
    };
  } else {
    return {
      type: 'imageInline',
      assetId,
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
      originalUrl: src,
    };
  }
}


// ========== 容器和未知元素 ==========

function convertContainer(
  el: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  const children = convertChildren(el, ctx, expectedType);
  
  // 如果只有一个子节点，直接返回
  if (children.length === 1) return children[0];
  
  // 多个子节点，返回数组
  if (children.length > 1) return children;
  
  return null;
}

function convertUnknown(
  el: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  // 尝试透传子节点
  const children = convertChildren(el, ctx, expectedType);
  
  if (children.length > 0) {
    return children;
  }
  
  // 如果配置了保留未知 HTML
  if (ctx.options.preserveUnknownHtml) {
    const html = el.outerHTML;
    if (expectedType === 'block') {
      return { type: 'htmlBlock', value: html } as HtmlBlockNode;
    } else {
      return { type: 'htmlInline', value: html } as HtmlInlineNode;
    }
  }
  
  return null;
}

// ========== 辅助函数 ==========

function getImageSrc(img: Element): string {
  const el = img as HTMLImageElement;
  
  // 优先级：src > srcset > data-src > data-original > data-lazy-src
  let src = el.getAttribute('src') || '';
  
  if (!src || src.startsWith('data:image/svg+xml')) {
    // 尝试 srcset
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      src = parseSrcset(srcset);
    }
  }
  
  if (!src) {
    src = el.getAttribute('data-src')
      || el.getAttribute('data-original')
      || el.getAttribute('data-lazy-src')
      || el.getAttribute('data-actualsrc')
      || '';
  }
  
  return src;
}

function parseSrcset(srcset: string): string {
  if (!srcset) return '';
  
  try {
    const candidates = srcset.split(',').map(s => s.trim());
    const parsed = candidates.map(c => {
      const parts = c.split(/\s+/);
      const url = parts[0];
      const descriptor = parts[1] || '';
      const width = descriptor.endsWith('w') ? parseInt(descriptor) : 0;
      return { url, width };
    });
    
    // 选择最大宽度的图片
    parsed.sort((a, b) => b.width - a.width);
    return parsed[0]?.url || '';
  } catch {
    return '';
  }
}

function wrapInlineAsBlock(nodes: (BlockNode | InlineNode)[]): BlockNode[] {
  const result: BlockNode[] = [];
  let inlineBuffer: InlineNode[] = [];
  
  const flushInline = () => {
    if (inlineBuffer.length > 0) {
      result.push({ type: 'paragraph', children: inlineBuffer });
      inlineBuffer = [];
    }
  };
  
  for (const node of nodes) {
    if (isInlineNodeType(node)) {
      inlineBuffer.push(node as InlineNode);
    } else {
      flushInline();
      result.push(node as BlockNode);
    }
  }
  
  flushInline();
  return result;
}

function isInlineNodeType(node: BlockNode | InlineNode): boolean {
  return [
    'text', 'emphasis', 'strong', 'delete', 'inlineCode',
    'link', 'imageInline', 'mathInline', 'break', 'htmlInline', 'footnoteRef'
  ].includes(node.type);
}

function mergeEmptyParagraphs(nodes: BlockNode[]): BlockNode[] {
  return nodes.filter((node, index) => {
    if (node.type !== 'paragraph') return true;
    const para = node as ParagraphNode;
    
    // 检查是否为空段落
    if (para.children.length === 0) return false;
    if (para.children.length === 1 && para.children[0].type === 'text') {
      const text = (para.children[0] as TextNode).value;
      if (!text.trim()) return false;
    }
    
    return true;
  });
}

// 所有函数和类已通过 export 关键字导出
