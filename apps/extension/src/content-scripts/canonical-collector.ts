/**
 * Content Script - Canonical AST 采集器
 * 
 * 新架构：DOM → Canonical AST → Markdown/HTML
 * 
 * 核心改进：
 * 1. 直接从 DOM 构建 AST，不经过 Markdown 中间层
 * 2. 图片、公式等资源在转换时收集到 AssetManifest
 * 3. 所有清洗操作在 AST 层完成
 */

import { Readability } from '@mozilla/readability';
import type {
  RootNode,
  BlockNode,
  InlineNode,
  CanonicalAssetManifest,
  ImageAssetEntry,
} from '@synccaster/core';

// ========== 类型定义 ==========

export interface CanonicalCollectionResult {
  success: boolean;
  data?: {
    title: string;
    url: string;
    summary: string;
    body_md: string;
    body_html: string;
    ast: RootNode;
    assets: CanonicalAssetManifest;
    metrics: CollectionMetrics;
  };
  error?: string;
}

export interface CollectionMetrics {
  images: number;
  formulas: number;
  tables: number;
  codeBlocks: number;
  wordCount: number;
  processingTime: number;
}

// ========== 转换上下文 ==========

class ConversionContext {
  public assets: CanonicalAssetManifest = {
    images: [],
    formulas: [],
    embeds: [],
  };

  
  private imageIdCounter = 0;
  private formulaIdCounter = 0;
  private seenImageUrls = new Set<string>();
  
  constructor(public baseUrl: string = '') {}
  
  registerImage(url: string, meta?: Partial<ImageAssetEntry>): string {
    const resolvedUrl = this.resolveUrl(url);
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
  
  registerFormula(tex: string, display: boolean, engine?: string): string {
    const id = `formula-${this.formulaIdCounter++}`;
    this.assets.formulas.push({ id, tex, display, engine });
    return id;
  }
  
  resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    try {
      return new URL(url, this.baseUrl || document.baseURI).href;
    } catch {
      return url;
    }
  }
}

// ========== DOM → AST 转换 ==========

function domToCanonicalAst(root: Element, ctx: ConversionContext): RootNode {
  const children = convertChildren(root, ctx, 'block') as BlockNode[];
  const mergedChildren = mergeEmptyParagraphs(children);
  return { type: 'root', children: mergedChildren };
}

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


function convertNode(
  node: Node,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (!text.trim()) return null;
    // 检查文本中是否包含 LaTeX 公式（$...$ 或 $$...$$）
    return parseTextWithFormulas(text, ctx);
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return convertElement(node as Element, ctx, expectedType);
  }
  return null;
}

/**
 * 解析文本中的 LaTeX 公式
 * 支持 $...$ (行内) 和 $$...$$ (块级) 格式
 */
function parseTextWithFormulas(text: string, ctx: ConversionContext): InlineNode | InlineNode[] | null {
  // 正则匹配公式：$$...$$ 或 $...$（非贪婪）
  // 注意：需要避免匹配 \$ 转义的美元符号
  const formulaRegex = /(\$\$[\s\S]+?\$\$|\$(?!\$)(?:[^$\\]|\\.)+?\$)/g;
  
  const parts: InlineNode[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = formulaRegex.exec(text)) !== null) {
    // 添加公式前的普通文本
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      if (beforeText) {
        parts.push({ type: 'text', value: beforeText });
      }
    }
    
    const formula = match[1];
    const isBlock = formula.startsWith('$$');
    const tex = isBlock 
      ? formula.slice(2, -2).trim()  // 去掉 $$
      : formula.slice(1, -1).trim(); // 去掉 $
    
    if (tex) {
      ctx.registerFormula(tex, isBlock, 'latex-text');
      if (isBlock) {
        parts.push({ type: 'mathInline', tex } as any); // 在行内上下文中，块级公式也作为行内处理
      } else {
        parts.push({ type: 'mathInline', tex });
      }
    }
    
    lastIndex = match.index + formula.length;
  }
  
  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      parts.push({ type: 'text', value: remainingText });
    }
  }
  
  // 如果没有找到公式，返回原始文本节点
  if (parts.length === 0) {
    return { type: 'text', value: text };
  }
  
  // 如果只有一个节点，直接返回
  if (parts.length === 1) {
    return parts[0];
  }
  
  return parts;
}

function convertElement(
  el: Element,
  ctx: ConversionContext,
  expectedType: 'block' | 'inline'
): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  const tagName = el.tagName.toLowerCase();
  
  // 检查是否是公式相关元素（需要完全跳过其子元素）
  if (isMathRelatedElement(el)) {
    const mathNode = tryConvertMath(el, ctx);
    if (mathNode) return mathNode;
    // 如果是公式相关元素但无法提取，跳过整个元素
    return null;
  }
  
  // 嵌入内容检测
  const embedNode = tryConvertEmbed(el, ctx);
  if (embedNode) return embedNode;
  
  switch (tagName) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return convertHeading(el, ctx);
    case 'p':
      return convertParagraph(el, ctx);
    case 'blockquote':
      return convertBlockquote(el, ctx);
    case 'ul': case 'ol':
      return convertList(el, ctx);
    case 'li':
      return convertListItem(el, ctx);
    case 'pre':
      return convertCodeBlock(el, ctx);
    case 'table':
      return convertTable(el, ctx);
    case 'hr':
      return { type: 'thematicBreak' };
    case 'figure':
      return convertFigure(el, ctx);
    case 'img':
      return convertImage(el, ctx, expectedType);
    case 'strong': case 'b':
      return { type: 'strong', children: convertChildren(el, ctx, 'inline') as InlineNode[] };
    case 'em': case 'i':
      return { type: 'emphasis', children: convertChildren(el, ctx, 'inline') as InlineNode[] };
    case 'del': case 's': case 'strike':
      return { type: 'delete', children: convertChildren(el, ctx, 'inline') as InlineNode[] };
    case 'code':
      // 检查是否在 pre 内部（代码块），如果不是则为行内代码
      if (el.parentElement?.tagName.toLowerCase() !== 'pre') {
        return { type: 'inlineCode', value: el.textContent || '' };
      }
      return null;
    case 'a':
      return convertLink(el, ctx);
    case 'br':
      return { type: 'break' };
    case 'div': case 'section': case 'article': case 'main': case 'span':
      return convertContainer(el, ctx, expectedType);
    case 'script': case 'style': case 'noscript': case 'nav': case 'footer':
    case 'aside': case 'header': case 'form': case 'button': case 'input':
      return null;
    default:
      return convertContainer(el, ctx, expectedType);
  }
}

/**
 * 检查元素是否是公式相关元素
 * 这些元素需要作为整体处理，不应该递归处理其子元素
 */
function isMathRelatedElement(el: Element): boolean {
  const tagName = el.tagName.toLowerCase();
  // 安全获取 className，确保是字符串
  const className = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
  
  // KaTeX 相关 - 只匹配顶层 .katex 元素
  if (el.classList.contains('katex') || el.classList.contains('katex-display')) return true;
  
  // MathJax 相关
  if (tagName === 'mjx-container') return true;
  if (tagName.startsWith('mjx-')) return true;
  if (el.classList.contains('MathJax') || el.classList.contains('MathJax_Display')) return true;
  
  // MathML
  if (tagName === 'math') return true;
  
  // 通用公式标记
  if (el.hasAttribute('data-sync-math')) return true;
  if (el.classList.contains('tex-math')) return true;
  
  // script type="math/tex"
  if (tagName === 'script') {
    const type = el.getAttribute('type') || '';
    if (type.includes('math/tex')) return true;
  }
  
  return false;
}


// ========== 块级元素转换 ==========

function convertHeading(el: Element, ctx: ConversionContext): BlockNode {
  const depth = parseInt(el.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'heading', depth, children };
}

function convertParagraph(el: Element, ctx: ConversionContext): BlockNode | null {
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  if (children.length === 0) return null;
  return { type: 'paragraph', children };
}

function convertBlockquote(el: Element, ctx: ConversionContext): BlockNode {
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  return { type: 'blockquote', children };
}

function convertList(el: Element, ctx: ConversionContext): BlockNode {
  const ordered = el.tagName.toLowerCase() === 'ol';
  const start = ordered ? parseInt(el.getAttribute('start') || '1') : undefined;
  const items: any[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === 'li') {
      const item = convertListItem(child, ctx);
      if (item) items.push(item);
    }
  }
  return { type: 'list', ordered, start, children: items };
}

function convertListItem(el: Element, ctx: ConversionContext): BlockNode {
  const checkbox = el.querySelector('input[type="checkbox"]');
  let checked: boolean | null = null;
  if (checkbox) {
    checked = (checkbox as HTMLInputElement).checked;
    checkbox.remove();
  }
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  const wrappedChildren = wrapInlineAsBlock(children);
  return { type: 'listItem', checked, children: wrappedChildren };
}

function convertCodeBlock(el: Element, ctx: ConversionContext): BlockNode {
  const codeEl = el.querySelector('code') || el;
  const langMatch = codeEl.className.match(/language-(\w+)/);
  const lang = langMatch?.[1] || codeEl.getAttribute('data-lang') || '';
  const value = codeEl.textContent || '';
  return { type: 'codeBlock', lang: lang || undefined, value };
}

function convertTable(el: Element, ctx: ConversionContext): BlockNode {
  const rows: any[] = [];
  let hasRowspan = false;
  let hasColspan = false;
  
  const thead = el.querySelector('thead');
  if (thead) {
    for (const tr of Array.from(thead.querySelectorAll('tr'))) {
      const row = convertTableRow(tr, ctx, true);
      if (row.children.some((c: any) => c.rowspan && c.rowspan > 1)) hasRowspan = true;
      if (row.children.some((c: any) => c.colspan && c.colspan > 1)) hasColspan = true;
      rows.push(row);
    }
  }
  
  const tbody = el.querySelector('tbody') || el;
  for (const tr of Array.from(tbody.querySelectorAll(':scope > tr'))) {
    const row = convertTableRow(tr, ctx, false);
    if (row.children.some((c: any) => c.rowspan && c.rowspan > 1)) hasRowspan = true;
    if (row.children.some((c: any) => c.colspan && c.colspan > 1)) hasColspan = true;
    rows.push(row);
  }
  
  return { type: 'table', align: [], children: rows, hasRowspan, hasColspan };
}

function convertTableRow(tr: Element, ctx: ConversionContext, isHeader: boolean): any {
  const cells: any[] = [];
  for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
    const isHeaderCell = cell.tagName.toLowerCase() === 'th' || isHeader;
    const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
    const colspan = parseInt(cell.getAttribute('colspan') || '1');
    const children = convertChildren(cell, ctx, 'inline') as InlineNode[];
    cells.push({
      type: 'tableCell',
      header: isHeaderCell,
      rowspan: rowspan > 1 ? rowspan : undefined,
      colspan: colspan > 1 ? colspan : undefined,
      children,
    });
  }
  return { type: 'tableRow', children: cells };
}


function convertFigure(el: Element, ctx: ConversionContext): BlockNode | null {
  const img = el.querySelector('img');
  const figcaption = el.querySelector('figcaption');
  
  if (img) {
    const src = getImageSrc(img);
    if (!src) return null;
    const assetId = ctx.registerImage(src, {
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
    });
    const caption = figcaption ? convertChildren(figcaption, ctx, 'inline') as InlineNode[] : undefined;
    return {
      type: 'imageBlock',
      assetId,
      alt: img.getAttribute('alt') || undefined,
      title: img.getAttribute('title') || undefined,
      caption,
      originalUrl: src,
    };
  }
  
  const children = convertChildren(el, ctx, 'block') as BlockNode[];
  return children.length === 1 ? children[0] : null;
}

function convertImage(el: Element, ctx: ConversionContext, expectedType: 'block' | 'inline'): BlockNode | InlineNode | null {
  const img = el as HTMLImageElement;
  const src = getImageSrc(img);
  if (!src) return null;
  
  const assetId = ctx.registerImage(src, {
    alt: img.getAttribute('alt') || undefined,
    title: img.getAttribute('title') || undefined,
  });
  
  if (expectedType === 'block') {
    return { type: 'imageBlock', assetId, alt: img.getAttribute('alt') || undefined, title: img.getAttribute('title') || undefined, originalUrl: src };
  } else {
    return { type: 'imageInline', assetId, alt: img.getAttribute('alt') || undefined, title: img.getAttribute('title') || undefined, originalUrl: src };
  }
}

function convertLink(el: Element, ctx: ConversionContext): InlineNode {
  const href = el.getAttribute('href') || '';
  const title = el.getAttribute('title') || undefined;
  const children = convertChildren(el, ctx, 'inline') as InlineNode[];
  return { type: 'link', url: ctx.resolveUrl(href), title, children };
}

function convertContainer(el: Element, ctx: ConversionContext, expectedType: 'block' | 'inline'): BlockNode | InlineNode | (BlockNode | InlineNode)[] | null {
  const children = convertChildren(el, ctx, expectedType);
  if (children.length === 1) return children[0];
  if (children.length > 1) return children;
  return null;
}


// ========== 公式转换 ==========

/**
 * 尝试从元素中提取 LaTeX 公式
 * 支持 KaTeX、MathJax v2/v3、MathML 等格式
 */
function tryConvertMath(el: Element, ctx: ConversionContext): BlockNode | InlineNode | null {
  const tagName = el.tagName.toLowerCase();
  
  // KaTeX 渲染的公式 (.katex 或 .katex-display)
  if (el.classList.contains('katex') || el.classList.contains('katex-display')) {
    // 从 annotation 标签获取原始 LaTeX
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      const tex = annotation.textContent || '';
      if (tex.trim()) {
        const display = el.classList.contains('katex-display') || 
                        el.closest('.katex-display') !== null;
        ctx.registerFormula(tex, display, 'katex');
        return display
          ? { type: 'mathBlock', tex, engine: 'katex' }
          : { type: 'mathInline', tex, engine: 'katex' };
      }
    }
    // KaTeX 元素但无法提取 LaTeX，返回空文本节点而不是 null
    // 这样可以避免整个内容被跳过
    return { type: 'text', value: '' } as any;
  }
  
  // MathJax v2 (script type="math/tex")
  if (tagName === 'script') {
    const type = el.getAttribute('type') || '';
    if (type.includes('math/tex')) {
      const tex = el.textContent || '';
      if (tex.trim()) {
        const display = type.includes('mode=display');
        ctx.registerFormula(tex, display, 'mathjax2');
        return display
          ? { type: 'mathBlock', tex, engine: 'mathjax2' }
          : { type: 'mathInline', tex, engine: 'mathjax2' };
      }
    }
    return null;
  }
  
  // MathJax v3 (mjx-container)
  if (tagName === 'mjx-container' || tagName.startsWith('mjx-')) {
    // 尝试多种方式获取原始 LaTeX
    let tex = '';
    
    // 方式1：从 annotation 获取
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      tex = annotation.textContent || '';
    }
    
    // 方式2：从 mjx-assistive-mml 获取
    if (!tex) {
      const assistive = el.querySelector('mjx-assistive-mml annotation');
      if (assistive) {
        tex = assistive.textContent || '';
      }
    }
    
    // 方式3：从 data-latex 属性获取
    if (!tex) {
      tex = el.getAttribute('data-latex') || el.getAttribute('data-tex') || '';
    }
    
    if (tex.trim()) {
      const display = el.classList.contains('MJXc-display') || 
                      el.hasAttribute('display') ||
                      el.getAttribute('display') === 'true' ||
                      el.closest('[display="true"]') !== null;
      ctx.registerFormula(tex, display, 'mathjax3');
      return display
        ? { type: 'mathBlock', tex, engine: 'mathjax3' }
        : { type: 'mathInline', tex, engine: 'mathjax3' };
    }
    // MathJax 元素但无法提取 LaTeX，返回空文本节点
    return { type: 'text', value: '' } as any;
  }
  
  // MathJax 相关类名
  if (el.classList.contains('MathJax') || el.classList.contains('MathJax_Display')) {
    // 尝试从 data 属性获取
    const tex = el.getAttribute('data-latex') || el.getAttribute('data-tex') || '';
    if (tex.trim()) {
      const display = el.classList.contains('MathJax_Display') || el.closest('.MathJax_Display') !== null;
      ctx.registerFormula(tex, display, 'mathjax2');
      return display
        ? { type: 'mathBlock', tex, engine: 'mathjax2' }
        : { type: 'mathInline', tex, engine: 'mathjax2' };
    }
    // MathJax 元素但无法提取 LaTeX，返回空文本节点
    return { type: 'text', value: '' } as any;
  }
  
  // 原生 MathML
  if (tagName === 'math') {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    const tex = annotation?.textContent || '';
    if (tex.trim()) {
      const display = el.getAttribute('display') === 'block';
      ctx.registerFormula(tex, display, 'mathml');
      return display
        ? { type: 'mathBlock', tex, engine: 'mathml' }
        : { type: 'mathInline', tex, engine: 'mathml' };
    }
    // MathML 元素但无法提取 LaTeX，返回空文本节点
    return { type: 'text', value: '' } as any;
  }
  
  // 自定义标记 (data-sync-math)
  if (el.hasAttribute('data-sync-math')) {
    const tex = el.getAttribute('data-tex') || el.textContent || '';
    if (tex.trim()) {
      const display = el.getAttribute('data-display') === 'true';
      ctx.registerFormula(tex, display, 'custom');
      return display
        ? { type: 'mathBlock', tex }
        : { type: 'mathInline', tex };
    }
    return { type: 'text', value: '' } as any;
  }
  
  // tex-math 类名
  if (el.classList.contains('tex-math')) {
    const tex = el.getAttribute('data-tex') || '';
    if (tex.trim()) {
      const display = el.classList.contains('display') || el.classList.contains('block');
      ctx.registerFormula(tex, display, 'custom');
      return display
        ? { type: 'mathBlock', tex }
        : { type: 'mathInline', tex };
    }
    return { type: 'text', value: '' } as any;
  }
  
  return null;
}

// ========== 嵌入内容转换 ==========

function tryConvertEmbed(el: Element, ctx: ConversionContext): BlockNode | null {
  const tagName = el.tagName.toLowerCase();
  
  if (tagName === 'iframe') {
    const src = el.getAttribute('src') || '';
    return { type: 'embedBlock', embedType: 'iframe', url: src, html: el.outerHTML, provider: detectProvider(src) };
  }
  
  if (tagName === 'video') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    return { type: 'embedBlock', embedType: 'video', url: src, html: el.outerHTML };
  }
  
  if (tagName === 'audio') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    return { type: 'embedBlock', embedType: 'audio', url: src, html: el.outerHTML };
  }
  
  if (el.classList.contains('link-card') || el.classList.contains('embed-card')) {
    const link = el.querySelector('a');
    const url = link?.getAttribute('href') || '';
    return { type: 'embedBlock', embedType: 'card', url, html: el.outerHTML };
  }
  
  return null;
}

function detectProvider(url: string): string | undefined {
  if (!url) return undefined;
  const providers: Record<string, RegExp> = {
    youtube: /youtube\.com|youtu\.be/,
    bilibili: /bilibili\.com/,
    vimeo: /vimeo\.com/,
    twitter: /twitter\.com|x\.com/,
  };
  for (const [provider, regex] of Object.entries(providers)) {
    if (regex.test(url)) return provider;
  }
  return undefined;
}


// ========== 辅助函数 ==========

function getImageSrc(img: Element): string {
  const el = img as HTMLImageElement;
  let src = el.getAttribute('src') || '';
  
  if (!src || src.startsWith('data:image/svg+xml')) {
    const srcset = el.getAttribute('srcset');
    if (srcset) src = parseSrcset(srcset);
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

function isInlineNodeType(node: any): boolean {
  return ['text', 'emphasis', 'strong', 'delete', 'inlineCode', 'link', 'imageInline', 'mathInline', 'break', 'htmlInline', 'footnoteRef'].includes(node.type);
}

function mergeEmptyParagraphs(nodes: BlockNode[]): BlockNode[] {
  return nodes.filter((node) => {
    if (node.type !== 'paragraph') return true;
    const para = node as any;
    if (para.children.length === 0) return false;
    if (para.children.length === 1 && para.children[0].type === 'text') {
      const text = para.children[0].value;
      if (!text.trim()) return false;
    }
    return true;
  });
}


// ========== AST 序列化为 Markdown ==========

function serializeAstToMarkdown(ast: RootNode, assets: CanonicalAssetManifest): string {
  const lines: string[] = [];
  for (const node of ast.children) {
    const result = serializeBlockToMd(node, assets);
    if (result) lines.push(result);
  }
  return lines.join('\n\n').trim();
}

function serializeBlockToMd(node: BlockNode, assets: CanonicalAssetManifest): string {
  switch (node.type) {
    case 'paragraph':
      return serializeInlinesToMd((node as any).children, assets);
    case 'heading': {
      const h = node as any;
      const prefix = '#'.repeat(h.depth);
      return `${prefix} ${serializeInlinesToMd(h.children, assets)}`;
    }
    case 'blockquote': {
      const bq = node as any;
      const content = bq.children.map((c: BlockNode) => serializeBlockToMd(c, assets)).join('\n');
      return content.split('\n').map((line: string) => `> ${line}`).join('\n');
    }
    case 'list': {
      const list = node as any;
      return list.children.map((item: any, i: number) => {
        const marker = list.ordered ? `${(list.start || 1) + i}.` : '-';
        const content = item.children.map((c: BlockNode) => serializeBlockToMd(c, assets)).join('\n');
        return `${marker} ${content}`;
      }).join('\n');
    }
    case 'codeBlock': {
      const cb = node as any;
      return '```' + (cb.lang || '') + '\n' + cb.value + '\n```';
    }
    case 'mathBlock':
      // 块级公式使用 $$ 包裹
      return '$$\n' + (node as any).tex + '\n$$';
    case 'thematicBreak':
      return '---';
    case 'imageBlock': {
      const img = node as any;
      const url = resolveImageUrl(img.assetId, img.originalUrl, assets);
      return `![${img.alt || ''}](${url})`;
    }
    case 'table':
      return serializeTableToMd(node as any, assets);
    case 'htmlBlock':
      return (node as any).value;
    case 'embedBlock': {
      const embed = node as any;
      if (embed.url) return `[${embed.provider || 'embed'}](${embed.url})`;
      return embed.html || '';
    }
    default:
      return '';
  }
}

function serializeInlinesToMd(nodes: InlineNode[], assets: CanonicalAssetManifest): string {
  return nodes.map(node => serializeInlineToMd(node, assets)).join('');
}

function serializeInlineToMd(node: InlineNode, assets: CanonicalAssetManifest): string {
  switch (node.type) {
    case 'text':
      return (node as any).value;
    case 'emphasis':
      return `_${serializeInlinesToMd((node as any).children, assets)}_`;
    case 'strong':
      return `**${serializeInlinesToMd((node as any).children, assets)}**`;
    case 'delete':
      return `~~${serializeInlinesToMd((node as any).children, assets)}~~`;
    case 'inlineCode':
      return '`' + (node as any).value + '`';
    case 'link': {
      const link = node as any;
      return `[${serializeInlinesToMd(link.children, assets)}](${link.url})`;
    }
    case 'imageInline': {
      const img = node as any;
      const url = resolveImageUrl(img.assetId, img.originalUrl, assets);
      return `![${img.alt || ''}](${url})`;
    }
    case 'mathInline':
      // 行内公式使用 $ 包裹
      return '$' + (node as any).tex + '$';
    case 'break':
      return '  \n';
    case 'htmlInline':
      return (node as any).value;
    default:
      return '';
  }
}


function serializeTableToMd(table: any, assets: CanonicalAssetManifest): string {
  if (table.hasRowspan || table.hasColspan) {
    return serializeTableToHtml(table, assets);
  }
  
  const lines: string[] = [];
  const colCount = table.children[0]?.children.length || 0;
  
  const headerRow = table.children[0];
  if (headerRow) {
    const cells = headerRow.children.map((cell: any) => serializeInlinesToMd(cell.children, assets));
    lines.push(`| ${cells.join(' | ')} |`);
    lines.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
  }
  
  for (let i = 1; i < table.children.length; i++) {
    const row = table.children[i];
    const cells = row.children.map((cell: any) => serializeInlinesToMd(cell.children, assets));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  
  return lines.join('\n');
}

function serializeTableToHtml(table: any, assets: CanonicalAssetManifest): string {
  const lines: string[] = ['<table>'];
  for (const row of table.children) {
    lines.push('<tr>');
    for (const cell of row.children) {
      const tag = cell.header ? 'th' : 'td';
      const attrs: string[] = [];
      if (cell.rowspan && cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
      if (cell.colspan && cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
      const content = serializeInlinesToMd(cell.children, assets);
      lines.push(`<${tag}${attrStr}>${content}</${tag}>`);
    }
    lines.push('</tr>');
  }
  lines.push('</table>');
  return lines.join('\n');
}

function resolveImageUrl(assetId: string, originalUrl: string | undefined, assets: CanonicalAssetManifest): string {
  const asset = assets.images.find(img => img.id === assetId);
  if (asset) {
    if (asset.proxyUrl) return asset.proxyUrl;
    return asset.originalUrl;
  }
  return originalUrl || '';
}


// ========== 主采集函数 ==========

/**
 * 尝试使用平台特定选择器获取内容
 */
function tryGetContentBySelector(): Element | null {
  // 常见平台的内容选择器（按优先级排序）
  const selectors = [
    // 掘金
    '.markdown-body',
    '.article-content',
    // 知乎
    '.Post-RichText',
    '.RichText',
    // CSDN
    '#content_views',
    '.article_content',
    // 简书
    '.article',
    '.show-content',
    // 微信公众号
    '#js_content',
    '.rich_media_content',
    // 博客园
    '#cnblogs_post_body',
    // 通用
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.content',
  ];
  
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 100) {
      console.log('[canonical-collector] 使用选择器找到内容:', selector);
      return el;
    }
  }
  
  return null;
}

/**
 * 比较两个内容元素，返回内容更完整的那个
 */
function compareContent(el1: Element | null, el2: Element | null): Element | null {
  if (!el1) return el2;
  if (!el2) return el1;
  
  const text1 = el1.textContent || '';
  const text2 = el2.textContent || '';
  
  // 计算内容指标
  const score1 = text1.length + (el1.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 100);
  const score2 = text2.length + (el2.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 100);
  
  console.log('[canonical-collector] 内容比较:', { 
    el1Score: score1, 
    el2Score: score2,
    el1Len: text1.length,
    el2Len: text2.length
  });
  
  return score1 >= score2 ? el1 : el2;
}

export async function collectContentCanonical(): Promise<CanonicalCollectionResult> {
  const startTime = Date.now();
  
  try {
    console.log('[canonical-collector] 开始采集', { url: window.location.href });
    
    const url = window.location.href;
    const ctx = new ConversionContext(url);
    
    // 1. 尝试多种方式获取内容
    
    // 方式1：使用平台特定选择器
    const selectorContent = tryGetContentBySelector();
    
    // 方式2：使用 Readability 提取
    const cloned = document.cloneNode(true) as Document;
    const article = new Readability(cloned, {
      keepClasses: true,
      charThreshold: 50,  // 降低阈值，避免丢失短内容
      nbTopCandidates: 10,
    }).parse();
    
    let readabilityContent: Element | null = null;
    if (article) {
      const container = document.createElement('div');
      container.innerHTML = article.content;
      readabilityContent = container;
    }
    
    // 比较两种方式的结果，选择更完整的
    let contentElement = compareContent(selectorContent, readabilityContent);
    
    // 如果都没有找到，回退到 body
    if (!contentElement) {
      console.log('[canonical-collector] 回退到 body');
      contentElement = document.body;
    }
    
    // 获取标题
    let title = document.title || '未命名';
    if (article?.title) {
      title = article.title;
    } else {
      // 尝试从页面中获取标题
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent) {
        title = h1.textContent.trim();
      }
    }
    
    console.log('[canonical-collector] 内容元素:', {
      tagName: contentElement.tagName,
      className: contentElement.className,
      textLength: (contentElement.textContent || '').length,
    });
    
    // 2. DOM → Canonical AST
    const ast = domToCanonicalAst(contentElement, ctx);
    
    // 3. 序列化为 Markdown
    const body_md = serializeAstToMarkdown(ast, ctx.assets);
    
    // 4. 计算指标
    const metrics = computeMetrics(ast, ctx.assets, startTime);
    
    // 5. 生成摘要（从纯文本提取，不包含图片链接）
    const summary = extractSummary(ast, 200);
    
    console.log('[canonical-collector] 采集完成', {
      title,
      images: metrics.images,
      formulas: metrics.formulas,
      tables: metrics.tables,
      wordCount: metrics.wordCount,
    });
    
    return {
      success: true,
      data: {
        title,
        url,
        summary,
        body_md,
        body_html: contentElement.innerHTML,
        ast,
        assets: ctx.assets,
        metrics,
      },
    };
  } catch (error: any) {
    console.error('[canonical-collector] 采集失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '采集失败',
    };
  }
}

function computeMetrics(ast: RootNode, assets: CanonicalAssetManifest, startTime: number): CollectionMetrics {
  let tables = 0;
  let codeBlocks = 0;
  let wordCount = 0;
  
  const countNodes = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === 'table') tables++;
      if (node.type === 'codeBlock') codeBlocks++;
      if (node.type === 'text') wordCount += (node.value || '').length;
      if (node.children && Array.isArray(node.children)) {
        countNodes(node.children);
      }
    }
  };
  
  countNodes(ast.children);
  
  return {
    images: assets.images.length,
    formulas: assets.formulas.length,
    tables,
    codeBlocks,
    wordCount,
    processingTime: Date.now() - startTime,
  };
}

function extractSummary(ast: RootNode, maxLength: number): string {
  const texts: string[] = [];
  
  // 需要跳过的节点类型
  const skipTypes = new Set([
    'mathBlock', 'mathInline',
    'imageBlock', 'imageInline',
    'codeBlock', 'inlineCode',
    'htmlBlock', 'htmlInline',
    'embedBlock',
    'table', 'tableRow', 'tableCell',
  ]);
  
  const extractText = (nodes: any[]) => {
    for (const node of nodes) {
      if (texts.join('').length >= maxLength * 1.5) break; // 多提取一些，后面再截断
      
      // 跳过特殊节点
      if (skipTypes.has(node.type)) continue;
      
      // 只提取纯文本
      if (node.type === 'text') {
        const text = (node.value || '').trim();
        if (text) {
          texts.push(text);
        }
      }
      
      // 递归处理子节点
      if (node.children && Array.isArray(node.children)) {
        extractText(node.children);
      }
    }
  };
  
  extractText(ast.children);
  
  let summary = texts.join(' ').trim();
  
  // 清理多余空白和特殊字符
  summary = summary
    .replace(/\s+/g, ' ')           // 多空格合并
    .replace(/[#*_~`\[\]()]/g, '')  // 移除 markdown 格式字符
    .replace(/\s+/g, ' ')           // 再次合并空格
    .trim();
  
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength);
    // 尝试在句子边界截断
    const lastPeriod = summary.lastIndexOf('。');
    const lastComma = summary.lastIndexOf('，');
    const lastSpace = summary.lastIndexOf(' ');
    const cutPoint = Math.max(lastPeriod, lastComma, lastSpace);
    if (cutPoint > maxLength * 0.6) {
      summary = summary.substring(0, cutPoint + 1);
    }
  }
  
  return summary;
}
