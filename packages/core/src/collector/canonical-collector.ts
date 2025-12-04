/**
 * Canonical 内容采集器
 * 
 * 新架构：DOM → Canonical AST → 各格式输出
 * 
 * 核心改进：
 * 1. 直接从 DOM 构建 AST，不经过 Markdown 中间层
 * 2. 图片、公式等资源在转换时收集到 AssetManifest
 * 3. 所有清洗操作在 AST 层完成
 * 4. Markdown 作为输出格式之一
 */

import { Readability } from '@mozilla/readability';
import {
  type RootNode,
  type CanonicalAssetManifest,
} from '../ast/canonical-ast';
import {
  htmlToCanonicalAst,
  domToCanonicalAst,
} from '../ast/dom-to-ast';
import {
  serializeAst,
  type SerializeOptions,
} from '../ast/ast-serializer';
import {
  standardCleanupPipeline,
  extractImageAssetIds,
} from '../ast/ast-transformer';
import type { CanonicalPost, AssetRef } from '../types';

// CanonicalContent 类型定义
interface CanonicalContent {
  ast: RootNode;
  assets: CanonicalAssetManifest;
}

// ========== 采集配置 ==========

export interface CanonicalCollectorOptions {
  /** 基础 URL */
  baseUrl?: string;
  /** 是否使用 Readability 提取正文 */
  useReadability?: boolean;
  /** 自定义内容选择器 */
  contentSelector?: string;
  /** 是否执行清洗 */
  cleanup?: boolean;
  /** 是否保留未知 HTML */
  preserveUnknownHtml?: boolean;
}

export interface CollectionResult {
  success: boolean;
  post?: CanonicalPost;
  content?: CanonicalContent;
  error?: string;
  metrics?: CollectionMetrics;
}

export interface CollectionMetrics {
  images: number;
  formulas: number;
  tables: number;
  codeBlocks: number;
  wordCount: number;
  processingTime: number;
}


// ========== 主采集类 ==========

export class CanonicalCollector {
  private options: CanonicalCollectorOptions;
  
  constructor(options: CanonicalCollectorOptions = {}) {
    this.options = {
      useReadability: true,
      cleanup: true,
      preserveUnknownHtml: true,
      ...options,
    };
  }
  
  /**
   * 从 HTML 字符串采集内容
   */
  async collectFromHtml(
    html: string,
    url?: string
  ): Promise<CollectionResult> {
    const startTime = Date.now();
    
    try {
      // 解析 HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      return this.collectFromDocument(doc, url, startTime);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '采集失败',
      };
    }
  }
  
  /**
   * 从 Document 对象采集内容
   */
  async collectFromDocument(
    doc: Document,
    url?: string,
    startTime?: number
  ): Promise<CollectionResult> {
    const start = startTime || Date.now();
    
    try {
      let contentElement: Element;
      let title = doc.title || '未命名';
      
      // 1. 提取正文区域
      if (this.options.contentSelector) {
        // 使用自定义选择器
        const el = doc.querySelector(this.options.contentSelector);
        if (!el) {
          return { success: false, error: `未找到内容: ${this.options.contentSelector}` };
        }
        contentElement = el;
      } else if (this.options.useReadability) {
        // 使用 Readability
        const cloned = doc.cloneNode(true) as Document;
        const article = new Readability(cloned, {
          keepClasses: true,
          charThreshold: 100,
        }).parse();
        
        if (!article) {
          return { success: false, error: '无法提取文章内容' };
        }
        
        title = article.title || title;
        
        // 创建临时容器
        const container = doc.createElement('div');
        container.innerHTML = article.content;
        contentElement = container;
      } else {
        // 使用 body
        contentElement = doc.body;
      }
      
      // 2. DOM → Canonical AST
      const canonicalContent = domToCanonicalAst(contentElement, {
        baseUrl: url || this.options.baseUrl,
        preserveUnknownHtml: this.options.preserveUnknownHtml,
      });
      
      // 3. AST 清洗
      let ast = canonicalContent.ast;
      if (this.options.cleanup) {
        ast = standardCleanupPipeline(ast);
      }
      
      // 4. 序列化为 Markdown
      const bodyMd = serializeAst(ast, {
        format: 'markdown',
        assets: canonicalContent.assets,
      });
      
      // 5. 计算指标
      const metrics = this.computeMetrics(ast, canonicalContent.assets, start);
      
      // 6. 构建 CanonicalPost
      const post = this.buildCanonicalPost({
        title,
        ast,
        assets: canonicalContent.assets,
        bodyMd,
        url,
        metrics,
      });
      
      return {
        success: true,
        post,
        content: { ...canonicalContent, ast },
        metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '采集失败',
      };
    }
  }
  
  /**
   * 从当前页面采集（用于 content script）
   */
  async collectFromCurrentPage(): Promise<CollectionResult> {
    return this.collectFromDocument(document, window.location.href);
  }

  
  /**
   * 计算采集指标
   */
  private computeMetrics(
    ast: RootNode,
    assets: CanonicalAssetManifest,
    startTime: number
  ): CollectionMetrics {
    let tables = 0;
    let codeBlocks = 0;
    let wordCount = 0;
    
    const countNodes = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === 'table') tables++;
        if (node.type === 'codeBlock') codeBlocks++;
        if (node.type === 'text') {
          wordCount += (node.value || '').length;
        }
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
  
  /**
   * 构建 CanonicalPost
   */
  private buildCanonicalPost(params: {
    title: string;
    ast: RootNode;
    assets: CanonicalAssetManifest;
    bodyMd: string;
    url?: string;
    metrics: CollectionMetrics;
  }): CanonicalPost {
    const { title, ast, assets, bodyMd, url, metrics } = params;
    
    // 转换资产格式
    const assetRefs: AssetRef[] = assets.images.map(img => ({
      id: img.id,
      type: 'image' as const,
      url: img.originalUrl,
      alt: img.alt,
      title: img.title,
      width: img.width,
      height: img.height,
    }));
    
    // 生成摘要（从 AST 提取纯文本）
    const summary = this.extractSummary(ast, 200);
    
    // 获取封面（第一张图片）
    const cover = assetRefs.length > 0 ? assetRefs[0] : undefined;
    
    const now = Date.now();
    
    return {
      id: this.generateId(),
      title,
      body_md: bodyMd,
      summary,
      cover,
      assets: assetRefs,
      source_url: url,
      collected_at: new Date().toISOString(),
      createdAt: now,
      updatedAt: now,
      // 存储 AST 供后续使用
      ast: ast.children as any,
      // 存储公式信息
      formulas: assets.formulas.map(f => ({
        type: f.display ? 'blockMath' : 'inlineMath',
        latex: f.tex,
      })) as any,
      meta: {
        metrics,
        hasComplexTables: assets.images.some(img => img.id.startsWith('table-')),
      },
    };
  }
  
  /**
   * 从 AST 提取摘要
   */
  private extractSummary(ast: RootNode, maxLength: number): string {
    const texts: string[] = [];
    
    const extractText = (nodes: any[]) => {
      for (const node of nodes) {
        if (texts.join('').length >= maxLength) break;
        
        if (node.type === 'text') {
          texts.push(node.value || '');
        }
        if (node.children && Array.isArray(node.children)) {
          extractText(node.children);
        }
      }
    };
    
    extractText(ast.children);
    
    let summary = texts.join('').trim();
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength) + '...';
    }
    
    return summary;
  }
  
  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ========== 便捷函数 ==========

/**
 * 快速采集 HTML 内容
 */
export async function collectHtml(
  html: string,
  options?: CanonicalCollectorOptions
): Promise<CollectionResult> {
  const collector = new CanonicalCollector(options);
  return collector.collectFromHtml(html);
}

/**
 * 快速采集当前页面
 */
export async function collectCurrentPage(
  options?: CanonicalCollectorOptions
): Promise<CollectionResult> {
  const collector = new CanonicalCollector(options);
  return collector.collectFromCurrentPage();
}

// CanonicalCollector 已通过 export class 导出
