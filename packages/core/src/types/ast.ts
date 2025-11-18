/**
 * AST 和资产相关类型定义
 */
import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';

// ========== 资产类型 ==========

export interface ImageAsset {
  id: string;                    // SHA-256 哈希
  originalUrl: string;
  proxyUrl?: string;             // CDN URL
  localBlob?: Blob;              // IndexedDB 存储

  metadata: {
    width?: number;
    height?: number;
    format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'svg';
    size: number;
    alt?: string;
    title?: string;
  };

  optimized?: {
    webp?: { url: string; size: number };
    thumbnail?: { url: string; size: number };
  };

  status: 'pending' | 'downloading' | 'ready' | 'failed';
  uploadedTo?: string[];         // 已上传到的平台
  error?: string;
}

export interface FormulaAsset {
  id: string;
  latex: string;
  display: boolean;              // true=block, false=inline

  rendered?: {
    svg?: string;                // KaTeX → SVG
    png?: { url: string; blob?: Blob };  // LaTeX → PNG
    mathml?: string;
  };

  engine: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml';
}

export interface VideoAsset {
  id: string;
  originalUrl: string;
  proxyUrl?: string;
  metadata: {
    duration?: number;
    format: string;
    size: number;
  };
}

export interface FileAsset {
  id: string;
  originalUrl: string;
  proxyUrl?: string;
  metadata: {
    filename: string;
    mimeType: string;
    size: number;
  };
}

export interface AssetManifest {
  images: ImageAsset[];
  formulas: FormulaAsset[];
  videos?: VideoAsset[];
  files?: FileAsset[];
}

// ========== 内容 AST ==========

export interface ContentAST {
  mdast: MdastRoot;              // Markdown AST (主存储)
  hast?: HastRoot;               // HTML AST (缓存)
}

// ========== 平台能力 ==========

export interface PlatformCapability {
  id: string;
  name: string;

  support: {
    markdown: boolean;
    html: boolean;
    latex: boolean;              // 原生数学支持
    externalImages: boolean;     // 接受外链图片
    uploadImages: boolean;       // 支持上传图片
    richText: boolean;           // 富文本编辑器
  };

  limits: {
    maxImageSize?: number;       // 字节
    maxImageCount?: number;
    allowedImageFormats?: string[];
    maxContentLength?: number;
  };

  strategy: {
    mathRendering: 'latex' | 'image' | 'html' | 'none';
    imageSource: 'cdn' | 'upload' | 'local';
    outputFormat: 'markdown' | 'html' | 'custom';
  };
}

// ========== 适配输出 ==========

export interface AdaptedContent {
  platform: string;
  format: 'markdown' | 'html' | 'rich-text';
  content: string;

  assets: {
    toUpload: ImageAsset[];      // 需要上传的图片
    external: ImageAsset[];      // 使用外链的图片
    formulas: FormulaAsset[];    // 公式资产
  };

  meta?: Record<string, any>;
}

// ========== URL 映射 ==========

export interface URLMapping {
  [originalUrl: string]: string; // original → cdn/proxy
}

// ========== 资产中转服务请求/响应 ==========

export interface AssetProxyRequest {
  manifest: AssetManifest;
  options?: {
    optimize?: boolean;          // 是否优化图片
    formats?: string[];          // 生成的格式 ['webp', 'avif']
    maxSize?: number;            // 最大尺寸
  };
}

export interface AssetProxyResponse {
  mapping: URLMapping;
  assets: AssetManifest;         // 更新后的资产（含 proxyUrl）
  stats: {
    total: number;
    success: number;
    failed: number;
    cached: number;              // 使用缓存的数量
  };
  errors?: Array<{ url: string; error: string }>;
}
