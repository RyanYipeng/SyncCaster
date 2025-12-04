/**
 * 内容采集器
 * 负责从网页提取文章内容并转换为统一格式
 * 
 * 新架构：DOM → Canonical AST → 各格式输出
 * 旧架构（保留兼容）：HTML → Markdown → AST
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { CanonicalPost, AssetRef } from '../types';

// 导出新的 Canonical 采集器
export * from './canonical-collector';
// 导出平台规则
export * from './platform-rules';

export interface CollectionResult {
  success: boolean;
  post?: CanonicalPost;
  error?: string;
}

export interface CollectionOptions {
  /** 是否下载图片到本地 */
  downloadImages?: boolean;
  /** 图片最大大小（字节） */
  maxImageSize?: number;
  /** 是否提取代码块 */
  extractCode?: boolean;
  /** 自定义标题（覆盖原标题） */
  customTitle?: string;
}

/**
 * 内容采集器类
 */
export class ContentCollector {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      bulletListMarker: '-',
    });

    // 使用 GFM 插件支持表格、删除线等
    this.turndownService.use(gfm);

    // 自定义规则：处理图片
    this.turndownService.addRule('images', {
      filter: 'img',
      replacement: (content, node) => {
        const img = node as HTMLImageElement;
        const alt = img.alt || '';
        const src = img.src || img.getAttribute('data-src') || '';
        const title = img.title ? ` "${img.title}"` : '';
        return `![${alt}](${src}${title})`;
      },
    });

    // 自定义规则：保留代码块语言
    this.turndownService.addRule('codeBlocks', {
      filter: (node) => {
        return node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE';
      },
      replacement: (content, node) => {
        const codeNode = node.firstChild as HTMLElement;
        const language = codeNode.className?.match(/language-(\w+)/)?.[1] || '';
        return `\n\`\`\`${language}\n${codeNode.textContent || ''}\n\`\`\`\n`;
      },
    });
  }

  /**
   * 从当前页面采集内容
   */
  async collectFromCurrentPage(options: CollectionOptions = {}): Promise<CollectionResult> {
    try {
      // 克隆文档以避免修改原页面
      const documentClone = document.cloneNode(true) as Document;

      // 使用 Readability 提取正文
      const reader = new Readability(documentClone, {
        keepClasses: true,
        charThreshold: 100, // 最少字符数
      });

      const article = reader.parse();

      if (!article) {
        return {
          success: false,
          error: '无法提取文章内容，可能不是文章页面',
        };
      }

      // 转换为 Markdown
      const bodyMarkdown = this.turndownService.turndown(article.content);

      // 提取图片
      const assets = await this.extractAssets(article.content, options);

      // 生成封面（取第一张图片）
      const cover = assets.find((a) => a.type === 'image');

      // 提取标签（从 meta 标签）
      const tags = this.extractTags();

      // 生成文章对象
      const post: CanonicalPost = {
        id: this.generateId(),
        title: options.customTitle || article.title || document.title,
        body_md: bodyMarkdown,
        summary: article.excerpt || this.generateSummary(bodyMarkdown),
        cover,
        tags,
        assets,
        source_url: window.location.href,
        collected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return {
        success: true,
        post,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 从 HTML 字符串采集内容
   */
  async collectFromHTML(
    html: string,
    url: string,
    options: CollectionOptions = {}
  ): Promise<CollectionResult> {
    try {
      // 创建临时 DOM
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 使用 Readability
      const reader = new Readability(doc);
      const article = reader.parse();

      if (!article) {
        return {
          success: false,
          error: '无法解析 HTML 内容',
        };
      }

      // 转换为 Markdown
      const bodyMarkdown = this.turndownService.turndown(article.content);

      // 提取资源
      const assets = await this.extractAssets(article.content, options);

      const post: CanonicalPost = {
        id: this.generateId(),
        title: options.customTitle || article.title || 'Untitled',
        body_md: bodyMarkdown,
        summary: article.excerpt || this.generateSummary(bodyMarkdown),
        cover: assets.find((a) => a.type === 'image'),
        assets,
        source_url: url,
        collected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return {
        success: true,
        post,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 提取资源（图片、视频等）
   */
  private async extractAssets(
    htmlContent: string,
    options: CollectionOptions
  ): Promise<AssetRef[]> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const assets: AssetRef[] = [];

    // 提取图片
    const images = doc.querySelectorAll('img');
    for (const img of Array.from(images)) {
      const src = img.src || img.getAttribute('data-src');
      if (!src) continue;

      const asset: AssetRef = {
        id: this.generateId(),
        type: 'image',
        url: this.resolveUrl(src),
        alt: img.alt || undefined,
        title: img.title || undefined,
      };

      // 如果需要下载图片
      if (options.downloadImages) {
        try {
          const blob = await this.downloadImage(asset.url, options.maxImageSize);
          if (blob) {
            asset.blobUrl = URL.createObjectURL(blob);
            asset.size = blob.size;
            asset.mimeType = blob.type;
          }
        } catch (error) {
          console.warn(`Failed to download image: ${asset.url}`, error);
        }
      }

      assets.push(asset);
    }

    return assets;
  }

  /**
   * 下载图片
   */
  private async downloadImage(url: string, maxSize?: number): Promise<Blob | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const blob = await response.blob();

      // 检查大小限制
      if (maxSize && blob.size > maxSize) {
        console.warn(`Image too large: ${blob.size} bytes > ${maxSize} bytes`);
        return null;
      }

      return blob;
    } catch (error) {
      console.error('Failed to download image:', error);
      return null;
    }
  }

  /**
   * 提取标签
   */
  private extractTags(): string[] {
    const tags: string[] = [];

    // 从 meta keywords 提取
    const keywords = document.querySelector('meta[name="keywords"]');
    if (keywords) {
      const content = keywords.getAttribute('content');
      if (content) {
        tags.push(...content.split(',').map((t) => t.trim()));
      }
    }

    // 从文章标签提取（常见类名）
    const tagSelectors = ['.tag', '.tags a', '.article-tags a', '[rel="tag"]'];
    for (const selector of tagSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        const tag = el.textContent?.trim();
        if (tag && !tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }

    return tags.slice(0, 10); // 最多10个标签
  }

  /**
   * 生成摘要
   */
  private generateSummary(markdown: string, maxLength: number = 200): string {
    // 移除标题、代码块、图片等
    let text = markdown
      .replace(/^#{1,6}\s+/gm, '') // 标题
      .replace(/```[\s\S]*?```/g, '') // 代码块
      .replace(/`[^`]+`/g, '') // 行内代码
      .replace(/!\[.*?\]\(.*?\)/g, '') // 图片
      .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // 链接
      .replace(/[*_~]/g, '') // 格式符号
      .trim();

    // 截断
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }

    return text;
  }

  /**
   * 解析相对 URL 为绝对 URL
   */
  private resolveUrl(url: string): string {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出单例
export const contentCollector = new ContentCollector();
