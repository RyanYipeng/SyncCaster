/**
 * Canonical AST Schema - 富语义内容抽象语法树
 * 
 * 设计原则：
 * 1. 语义完整：能表达常见平台的所有结构（图片、公式、表格、代码、嵌入等）
 * 2. 信息无损：从 DOM 到 AST 不丢失关键信息
 * 3. 平台无关：AST 是中间层，输出时才做平台适配
 * 4. 资产分离：图片等资源通过 assetId 引用，不直接存 URL
 */

// ========== 基础类型 ==========

export interface Position {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

export interface BaseNode {
  position?: Position;
  data?: Record<string, unknown>;
}

// ========== 内联节点 (Inline Nodes) ==========

export interface TextNode extends BaseNode {
  type: 'text';
  value: string;
}

export interface EmphasisNode extends BaseNode {
  type: 'emphasis';
  children: InlineNode[];
}

export interface StrongNode extends BaseNode {
  type: 'strong';
  children: InlineNode[];
}

export interface DeleteNode extends BaseNode {
  type: 'delete';
  children: InlineNode[];
}

export interface InlineCodeNode extends BaseNode {
  type: 'inlineCode';
  value: string;
}

export interface LinkNode extends BaseNode {
  type: 'link';
  url: string;
  title?: string;
  children: InlineNode[];
}

export interface ImageInlineNode extends BaseNode {
  type: 'imageInline';
  assetId: string;        // 引用 AssetManifest 中的图片
  alt?: string;
  title?: string;
  // 原始 URL 仅用于调试/回退
  originalUrl?: string;
}

export interface MathInlineNode extends BaseNode {
  type: 'mathInline';
  tex: string;            // LaTeX 源码
  engine?: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml';
}

export interface BreakNode extends BaseNode {
  type: 'break';
}

export interface HtmlInlineNode extends BaseNode {
  type: 'htmlInline';
  value: string;          // 原始 HTML（兜底）
}

export interface FootnoteRefNode extends BaseNode {
  type: 'footnoteRef';
  identifier: string;
  label?: string;
}

export type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | DeleteNode
  | InlineCodeNode
  | LinkNode
  | ImageInlineNode
  | MathInlineNode
  | BreakNode
  | HtmlInlineNode
  | FootnoteRefNode;

// ========== 块级节点 (Block Nodes) ==========

export interface ParagraphNode extends BaseNode {
  type: 'paragraph';
  children: InlineNode[];
}

export interface HeadingNode extends BaseNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

export interface BlockquoteNode extends BaseNode {
  type: 'blockquote';
  children: BlockNode[];
}

export interface ListNode extends BaseNode {
  type: 'list';
  ordered: boolean;
  start?: number;         // 有序列表起始数字
  spread?: boolean;       // 是否松散列表
  children: ListItemNode[];
}

export interface ListItemNode extends BaseNode {
  type: 'listItem';
  checked?: boolean | null; // 任务列表：true/false/null
  spread?: boolean;
  children: BlockNode[];
}

export interface CodeBlockNode extends BaseNode {
  type: 'codeBlock';
  lang?: string;
  meta?: string;          // 如 ```js {1,3-5} 中的 {1,3-5}
  value: string;
}

export interface MathBlockNode extends BaseNode {
  type: 'mathBlock';
  tex: string;
  engine?: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml';
}

export interface ThematicBreakNode extends BaseNode {
  type: 'thematicBreak';
}

export interface ImageBlockNode extends BaseNode {
  type: 'imageBlock';
  assetId: string;
  alt?: string;
  title?: string;
  caption?: InlineNode[];
  originalUrl?: string;
}

// ========== 表格节点 ==========

export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TableNode extends BaseNode {
  type: 'table';
  align?: TableAlign[];
  children: TableRowNode[];
  // 复杂表格信息
  hasRowspan?: boolean;
  hasColspan?: boolean;
  caption?: InlineNode[];
}

export interface TableRowNode extends BaseNode {
  type: 'tableRow';
  children: TableCellNode[];
}

export interface TableCellNode extends BaseNode {
  type: 'tableCell';
  header?: boolean;
  align?: TableAlign;
  rowspan?: number;
  colspan?: number;
  children: InlineNode[];
}

// ========== 特殊块节点 ==========

export interface HtmlBlockNode extends BaseNode {
  type: 'htmlBlock';
  value: string;          // 原始 HTML（兜底）
}

export interface EmbedBlockNode extends BaseNode {
  type: 'embedBlock';
  embedType: 'video' | 'audio' | 'iframe' | 'card' | 'tweet' | 'codepen' | 'other';
  url?: string;
  html?: string;          // 原始嵌入 HTML
  provider?: string;      // 如 'youtube', 'bilibili', 'twitter'
  meta?: Record<string, unknown>;
}

export interface FootnoteDefNode extends BaseNode {
  type: 'footnoteDef';
  identifier: string;
  label?: string;
  children: BlockNode[];
}

export interface TocNode extends BaseNode {
  type: 'toc';
  // TOC 节点，某些平台有 [TOC] 标记
}

export interface FrontmatterNode extends BaseNode {
  type: 'frontmatter';
  value: string;          // YAML 内容
}

export interface CustomBlockNode extends BaseNode {
  type: 'customBlock';
  name: string;           // 自定义块类型名
  props?: Record<string, unknown>;
  html?: string;          // 原始 HTML
  children?: BlockNode[];
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | CodeBlockNode
  | MathBlockNode
  | ThematicBreakNode
  | ImageBlockNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | HtmlBlockNode
  | EmbedBlockNode
  | FootnoteDefNode
  | TocNode
  | FrontmatterNode
  | CustomBlockNode;

// ========== 根节点 ==========

export interface RootNode extends BaseNode {
  type: 'root';
  children: BlockNode[];
}

// ========== 所有节点类型 ==========

export type CanonicalNode = RootNode | BlockNode | InlineNode;

// ========== 资产清单（与 AST 配合使用） ==========

export interface ImageAssetEntry {
  id: string;             // 唯一标识，AST 中通过 assetId 引用
  originalUrl: string;    // 原始 URL
  proxyUrl?: string;      // CDN/代理 URL
  localBlob?: Blob;       // 本地缓存
  base64?: string;        // Base64 数据（用于上传）
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  alt?: string;
  title?: string;
  status: 'pending' | 'downloading' | 'ready' | 'uploaded' | 'failed';
  uploadedUrls?: Record<string, string>; // 平台 → 上传后 URL
  error?: string;
}

export interface FormulaAssetEntry {
  id: string;
  tex: string;
  display: boolean;
  engine?: string;
  rendered?: {
    svg?: string;
    png?: { url: string; base64?: string };
    mathml?: string;
  };
}

export interface CanonicalAssetManifest {
  images: ImageAssetEntry[];
  formulas: FormulaAssetEntry[];
  embeds?: Array<{
    id: string;
    type: string;
    url?: string;
    html?: string;
  }>;
}

// ========== 完整的 Canonical 内容结构 ==========

export interface CanonicalContent {
  ast: RootNode;
  assets: CanonicalAssetManifest;
  meta?: {
    title?: string;
    summary?: string;
    cover?: string;       // assetId
    tags?: string[];
    categories?: string[];
    sourceUrl?: string;
    collectedAt?: string;
    wordCount?: number;
    readingTime?: number;
  };
}

// ========== 类型守卫 ==========

export function isInlineNode(node: CanonicalNode): node is InlineNode {
  return [
    'text', 'emphasis', 'strong', 'delete', 'inlineCode',
    'link', 'imageInline', 'mathInline', 'break', 'htmlInline', 'footnoteRef'
  ].includes(node.type);
}

export function isBlockNode(node: CanonicalNode): node is BlockNode {
  return [
    'paragraph', 'heading', 'blockquote', 'list', 'listItem',
    'codeBlock', 'mathBlock', 'thematicBreak', 'imageBlock',
    'table', 'tableRow', 'tableCell', 'htmlBlock', 'embedBlock',
    'footnoteDef', 'toc', 'frontmatter', 'customBlock'
  ].includes(node.type);
}

export function isRootNode(node: CanonicalNode): node is RootNode {
  return node.type === 'root';
}
