/**
 * AST 序列化器
 * 将 Canonical AST 转换为 Markdown 或 HTML
 * 
 * 设计原则：
 * 1. Markdown 作为输出格式之一，不是中间格式
 * 2. 根据目标平台能力选择输出格式
 * 3. 复杂结构（如复杂表格）可降级为 HTML
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
  TableCellNode,
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
} from './canonical-ast';

// ========== 序列化配置 ==========

export interface SerializeOptions {
  /** 输出格式 */
  format: 'markdown' | 'html';
  /** 资产清单（用于解析 assetId → URL） */
  assets?: CanonicalAssetManifest;
  /** 目标平台（影响某些格式选择） */
  platform?: string;
  /** 图片 URL 映射（assetId → 平台 URL） */
  imageUrlMap?: Map<string, string>;
  /** 公式渲染方式 */
  mathMode?: 'latex' | 'image' | 'html';
  /** 复杂表格处理方式 */
  complexTableMode?: 'html' | 'simplify' | 'image';
  /** 列表标记 */
  bulletMarker?: '-' | '*' | '+';
  /** 强调标记 */
  emphasisMarker?: '_' | '*';
}

const defaultOptions: SerializeOptions = {
  format: 'markdown',
  mathMode: 'latex',
  complexTableMode: 'html',
  bulletMarker: '-',
  emphasisMarker: '_',
};


// ========== 主序列化函数 ==========

export function serializeAst(
  ast: RootNode,
  options: Partial<SerializeOptions> = {}
): string {
  const opts = { ...defaultOptions, ...options };
  
  if (opts.format === 'html') {
    return serializeToHtml(ast, opts);
  } else {
    return serializeToMarkdown(ast, opts);
  }
}

// ========== Markdown 序列化 ==========

function serializeToMarkdown(ast: RootNode, opts: SerializeOptions): string {
  const lines: string[] = [];
  
  for (const node of ast.children) {
    const result = serializeBlockToMd(node, opts, 0);
    if (result) lines.push(result);
  }
  
  return lines.join('\n\n').trim();
}

function serializeBlockToMd(
  node: BlockNode,
  opts: SerializeOptions,
  depth: number
): string {
  switch (node.type) {
    case 'paragraph':
      return serializeParagraphToMd(node, opts);
    
    case 'heading':
      return serializeHeadingToMd(node, opts);
    
    case 'blockquote':
      return serializeBlockquoteToMd(node, opts, depth);
    
    case 'list':
      return serializeListToMd(node, opts, depth);
    
    case 'listItem':
      return serializeListItemToMd(node, opts, depth);
    
    case 'codeBlock':
      return serializeCodeBlockToMd(node, opts);
    
    case 'mathBlock':
      return serializeMathBlockToMd(node, opts);
    
    case 'thematicBreak':
      return '---';
    
    case 'imageBlock':
      return serializeImageBlockToMd(node, opts);
    
    case 'table':
      return serializeTableToMd(node, opts);
    
    case 'htmlBlock':
      return node.value;
    
    case 'embedBlock':
      return serializeEmbedToMd(node, opts);
    
    default:
      return '';
  }
}

function serializeParagraphToMd(node: ParagraphNode, opts: SerializeOptions): string {
  return serializeInlinesToMd(node.children, opts);
}

function serializeHeadingToMd(node: HeadingNode, opts: SerializeOptions): string {
  const prefix = '#'.repeat(node.depth);
  const content = serializeInlinesToMd(node.children, opts);
  return `${prefix} ${content}`;
}

function serializeBlockquoteToMd(
  node: BlockquoteNode,
  opts: SerializeOptions,
  depth: number
): string {
  const lines: string[] = [];
  
  for (const child of node.children) {
    const content = serializeBlockToMd(child, opts, depth + 1);
    const prefixed = content.split('\n').map(line => `> ${line}`).join('\n');
    lines.push(prefixed);
  }
  
  return lines.join('\n>\n');
}

function serializeListToMd(
  node: ListNode,
  opts: SerializeOptions,
  depth: number
): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  
  node.children.forEach((item, index) => {
    const marker = node.ordered
      ? `${(node.start || 1) + index}.`
      : opts.bulletMarker || '-';
    
    const content = serializeListItemContentToMd(item, opts, depth);
    const firstLine = content.split('\n')[0];
    const restLines = content.split('\n').slice(1);
    
    lines.push(`${indent}${marker} ${firstLine}`);
    
    if (restLines.length > 0) {
      const restIndent = '  '.repeat(depth + 1);
      lines.push(...restLines.map(line => `${restIndent}${line}`));
    }
  });
  
  return lines.join('\n');
}

function serializeListItemContentToMd(
  node: ListItemNode,
  opts: SerializeOptions,
  depth: number
): string {
  const parts: string[] = [];
  
  // 任务列表标记
  if (node.checked !== undefined && node.checked !== null) {
    parts.push(node.checked ? '[x]' : '[ ]');
  }
  
  for (const child of node.children) {
    parts.push(serializeBlockToMd(child, opts, depth + 1));
  }
  
  return parts.join(' ');
}

function serializeListItemToMd(
  node: ListItemNode,
  opts: SerializeOptions,
  depth: number
): string {
  return serializeListItemContentToMd(node, opts, depth);
}


function serializeCodeBlockToMd(node: CodeBlockNode, opts: SerializeOptions): string {
  const lang = node.lang || '';
  const meta = node.meta || '';
  const fence = '```';
  return `${fence}${lang}${meta ? ' ' + meta : ''}\n${node.value}\n${fence}`;
}

function serializeMathBlockToMd(node: MathBlockNode, opts: SerializeOptions): string {
  if (opts.mathMode === 'latex') {
    return `$$\n${node.tex}\n$$`;
  }
  // TODO: 支持图片模式
  return `$$\n${node.tex}\n$$`;
}

function serializeImageBlockToMd(node: ImageBlockNode, opts: SerializeOptions): string {
  const url = resolveImageUrl(node.assetId, node.originalUrl, opts);
  const alt = node.alt || '';
  const title = node.title ? ` "${node.title}"` : '';
  
  let result = `![${alt}](${url}${title})`;
  
  // 如果有 caption，添加在下方
  if (node.caption && node.caption.length > 0) {
    const captionText = serializeInlinesToMd(node.caption, opts);
    result += `\n*${captionText}*`;
  }
  
  return result;
}

function serializeTableToMd(node: TableNode, opts: SerializeOptions): string {
  // 复杂表格（有 rowspan/colspan）降级为 HTML
  if (node.hasRowspan || node.hasColspan) {
    if (opts.complexTableMode === 'html') {
      return serializeTableToHtml(node, opts);
    }
    // simplify 模式：忽略 span，按普通表格处理
  }
  
  const lines: string[] = [];
  const colCount = node.children[0]?.children.length || 0;
  
  // 表头
  const headerRow = node.children[0];
  if (headerRow) {
    const cells = headerRow.children.map(cell => 
      serializeInlinesToMd(cell.children, opts)
    );
    lines.push(`| ${cells.join(' | ')} |`);
    
    // 分隔行
    const alignRow = (node.align || []).map((align, i) => {
      if (align === 'left') return ':---';
      if (align === 'right') return '---:';
      if (align === 'center') return ':---:';
      return '---';
    });
    // 补齐列数
    while (alignRow.length < colCount) alignRow.push('---');
    lines.push(`| ${alignRow.join(' | ')} |`);
  }
  
  // 数据行
  for (let i = 1; i < node.children.length; i++) {
    const row = node.children[i];
    const cells = row.children.map(cell =>
      serializeInlinesToMd(cell.children, opts)
    );
    lines.push(`| ${cells.join(' | ')} |`);
  }
  
  return lines.join('\n');
}

function serializeEmbedToMd(node: EmbedBlockNode, opts: SerializeOptions): string {
  // 嵌入内容：优先使用 URL 作为链接，否则保留 HTML
  if (node.url) {
    const label = node.provider || node.embedType || 'embed';
    return `[${label}](${node.url})`;
  }
  
  if (node.html) {
    return node.html;
  }
  
  return '';
}


// ========== 内联节点 Markdown 序列化 ==========

function serializeInlinesToMd(nodes: InlineNode[], opts: SerializeOptions): string {
  return nodes.map(node => serializeInlineToMd(node, opts)).join('');
}

function serializeInlineToMd(node: InlineNode, opts: SerializeOptions): string {
  switch (node.type) {
    case 'text':
      return escapeMarkdown(node.value);
    
    case 'emphasis': {
      const marker = opts.emphasisMarker || '_';
      const content = serializeInlinesToMd(node.children, opts);
      return `${marker}${content}${marker}`;
    }
    
    case 'strong': {
      const content = serializeInlinesToMd(node.children, opts);
      return `**${content}**`;
    }
    
    case 'delete': {
      const content = serializeInlinesToMd(node.children, opts);
      return `~~${content}~~`;
    }
    
    case 'inlineCode':
      return `\`${node.value}\``;
    
    case 'link': {
      const content = serializeInlinesToMd(node.children, opts);
      const title = node.title ? ` "${node.title}"` : '';
      return `[${content}](${node.url}${title})`;
    }
    
    case 'imageInline': {
      const url = resolveImageUrl(node.assetId, node.originalUrl, opts);
      const alt = node.alt || '';
      const title = node.title ? ` "${node.title}"` : '';
      return `![${alt}](${url}${title})`;
    }
    
    case 'mathInline':
      if (opts.mathMode === 'latex') {
        return `$${node.tex}$`;
      }
      return `$${node.tex}$`;
    
    case 'break':
      return '  \n';
    
    case 'htmlInline':
      return node.value;
    
    case 'footnoteRef':
      return `[^${node.identifier}]`;
    
    default:
      return '';
  }
}

function escapeMarkdown(text: string): string {
  // 转义 Markdown 特殊字符（保守策略，只转义必要的）
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ========== HTML 序列化 ==========

function serializeToHtml(ast: RootNode, opts: SerializeOptions): string {
  const parts: string[] = [];
  
  for (const node of ast.children) {
    const result = serializeBlockToHtml(node, opts);
    if (result) parts.push(result);
  }
  
  return parts.join('\n');
}

function serializeBlockToHtml(node: BlockNode, opts: SerializeOptions): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${serializeInlinesToHtml(node.children, opts)}</p>`;
    
    case 'heading':
      return `<h${node.depth}>${serializeInlinesToHtml(node.children, opts)}</h${node.depth}>`;
    
    case 'blockquote': {
      const content = node.children.map(c => serializeBlockToHtml(c, opts)).join('\n');
      return `<blockquote>\n${content}\n</blockquote>`;
    }
    
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const start = node.ordered && node.start !== 1 ? ` start="${node.start}"` : '';
      const items = node.children.map(item => {
        const content = item.children.map(c => serializeBlockToHtml(c, opts)).join('\n');
        const checkbox = item.checked !== undefined && item.checked !== null
          ? `<input type="checkbox"${item.checked ? ' checked' : ''} disabled> `
          : '';
        return `<li>${checkbox}${content}</li>`;
      }).join('\n');
      return `<${tag}${start}>\n${items}\n</${tag}>`;
    }
    
    case 'codeBlock': {
      const lang = node.lang ? ` class="language-${node.lang}"` : '';
      const escaped = escapeHtml(node.value);
      return `<pre><code${lang}>${escaped}</code></pre>`;
    }
    
    case 'mathBlock':
      return `<div class="math-block">$$${escapeHtml(node.tex)}$$</div>`;
    
    case 'thematicBreak':
      return '<hr>';
    
    case 'imageBlock': {
      const url = resolveImageUrl(node.assetId, node.originalUrl, opts);
      const alt = node.alt ? ` alt="${escapeHtml(node.alt)}"` : '';
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      let html = `<figure><img src="${url}"${alt}${title}>`;
      if (node.caption && node.caption.length > 0) {
        html += `<figcaption>${serializeInlinesToHtml(node.caption, opts)}</figcaption>`;
      }
      html += '</figure>';
      return html;
    }
    
    case 'table':
      return serializeTableToHtml(node, opts);
    
    case 'htmlBlock':
      return node.value;
    
    case 'embedBlock':
      return node.html || `<a href="${node.url}">${node.provider || 'embed'}</a>`;
    
    default:
      return '';
  }
}


function serializeTableToHtml(node: TableNode, opts: SerializeOptions): string {
  const lines: string[] = ['<table>'];
  
  // Caption
  if (node.caption && node.caption.length > 0) {
    lines.push(`<caption>${serializeInlinesToHtml(node.caption, opts)}</caption>`);
  }
  
  // 分离表头和表体
  const headerRows: typeof node.children = [];
  const bodyRows: typeof node.children = [];
  
  for (const row of node.children) {
    const isHeader = row.children.every(cell => cell.header);
    if (isHeader && bodyRows.length === 0) {
      headerRows.push(row);
    } else {
      bodyRows.push(row);
    }
  }
  
  // 表头
  if (headerRows.length > 0) {
    lines.push('<thead>');
    for (const row of headerRows) {
      lines.push(serializeTableRowToHtml(row, opts, true));
    }
    lines.push('</thead>');
  }
  
  // 表体
  if (bodyRows.length > 0) {
    lines.push('<tbody>');
    for (const row of bodyRows) {
      lines.push(serializeTableRowToHtml(row, opts, false));
    }
    lines.push('</tbody>');
  }
  
  lines.push('</table>');
  return lines.join('\n');
}

function serializeTableRowToHtml(
  row: { type: 'tableRow'; children: TableCellNode[] },
  opts: SerializeOptions,
  isHeader: boolean
): string {
  const cells = row.children.map(cell => {
    const tag = cell.header || isHeader ? 'th' : 'td';
    const attrs: string[] = [];
    
    if (cell.rowspan && cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
    if (cell.colspan && cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
    if (cell.align) attrs.push(`style="text-align: ${cell.align}"`);
    
    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    const content = serializeInlinesToHtml(cell.children, opts);
    
    return `<${tag}${attrStr}>${content}</${tag}>`;
  }).join('');
  
  return `<tr>${cells}</tr>`;
}

// ========== 内联节点 HTML 序列化 ==========

function serializeInlinesToHtml(nodes: InlineNode[], opts: SerializeOptions): string {
  return nodes.map(node => serializeInlineToHtml(node, opts)).join('');
}

function serializeInlineToHtml(node: InlineNode, opts: SerializeOptions): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    
    case 'emphasis':
      return `<em>${serializeInlinesToHtml(node.children, opts)}</em>`;
    
    case 'strong':
      return `<strong>${serializeInlinesToHtml(node.children, opts)}</strong>`;
    
    case 'delete':
      return `<del>${serializeInlinesToHtml(node.children, opts)}</del>`;
    
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    
    case 'link': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<a href="${node.url}"${title}>${serializeInlinesToHtml(node.children, opts)}</a>`;
    }
    
    case 'imageInline': {
      const url = resolveImageUrl(node.assetId, node.originalUrl, opts);
      const alt = node.alt ? ` alt="${escapeHtml(node.alt)}"` : '';
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<img src="${url}"${alt}${title}>`;
    }
    
    case 'mathInline':
      return `<span class="math-inline">$${escapeHtml(node.tex)}$</span>`;
    
    case 'break':
      return '<br>';
    
    case 'htmlInline':
      return node.value;
    
    case 'footnoteRef':
      return `<sup><a href="#fn-${node.identifier}">[${node.label || node.identifier}]</a></sup>`;
    
    default:
      return '';
  }
}

// ========== 辅助函数 ==========

function resolveImageUrl(
  assetId: string,
  originalUrl: string | undefined,
  opts: SerializeOptions
): string {
  // 优先使用平台特定 URL 映射
  if (opts.imageUrlMap?.has(assetId)) {
    return opts.imageUrlMap.get(assetId)!;
  }
  
  // 从资产清单查找
  if (opts.assets) {
    const asset = opts.assets.images.find(img => img.id === assetId);
    if (asset) {
      // 优先使用已上传的 URL
      if (asset.uploadedUrls && opts.platform && asset.uploadedUrls[opts.platform]) {
        return asset.uploadedUrls[opts.platform];
      }
      // 其次使用代理 URL
      if (asset.proxyUrl) return asset.proxyUrl;
      // 最后使用原始 URL
      return asset.originalUrl;
    }
  }
  
  // 回退到原始 URL
  return originalUrl || '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// serializeAst 已通过 export function 导出
// serializeToMarkdown 和 serializeToHtml 是内部函数
