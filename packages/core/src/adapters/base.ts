/**
 * 平台适配器基类
 */
import type { Root as MdastRoot } from 'mdast';
import type {
  PlatformCapability,
  AdaptedContent,
  AssetManifest,
  URLMapping,
} from '../types/ast';
import type { CanonicalPost } from '../types';

/**
 * 适配器选项
 */
export interface AdapterOptions {
  /** URL 映射（原始 URL → CDN URL） */
  urlMapping?: URLMapping;
  /** 是否启用图片优化 */
  optimizeImages?: boolean;
  /** 自定义配置 */
  config?: Record<string, any>;
}

/**
 * 平台适配器抽象类
 */
export abstract class PlatformAdapter {
  constructor(
    protected platform: PlatformCapability,
    protected options: AdapterOptions = {}
  ) {}

  /**
   * 适配内容到目标平台
   */
  abstract adapt(
    post: CanonicalPost,
    manifest: AssetManifest
  ): Promise<AdaptedContent>;

  /**
   * 获取平台 ID
   */
  getPlatformId(): string {
    return this.platform.id;
  }

  /**
   * 获取平台名称
   */
  getPlatformName(): string {
    return this.platform.name;
  }

  /**
   * 检查平台是否支持某功能
   */
  supports(feature: keyof PlatformCapability['support']): boolean {
    return this.platform.support[feature];
  }

  /**
   * 获取策略配置
   */
  getStrategy<K extends keyof PlatformCapability['strategy']>(
    key: K
  ): PlatformCapability['strategy'][K] {
    return this.platform.strategy[key];
  }

  /**
   * 替换图片 URL
   */
  protected replaceImageUrls(
    content: string,
    manifest: AssetManifest
  ): string {
    let result = content;
    const { urlMapping = {} } = this.options;

    for (const image of manifest.images) {
      const newUrl = urlMapping[image.originalUrl] || image.proxyUrl || image.originalUrl;
      
      // Markdown 格式: ![alt](url)
      result = result.replace(
        new RegExp(`!\\[([^\\]]*)\\]\\(${this.escapeRegex(image.originalUrl)}\\)`, 'g'),
        `![$1](${newUrl})`
      );

      // HTML 格式: <img src="url">
      result = result.replace(
        new RegExp(`<img([^>]*?)src="${this.escapeRegex(image.originalUrl)}"`, 'g'),
        `<img$1src="${newUrl}"`
      );
    }

    return result;
  }

  /**
   * 转义正则表达式特殊字符
   */
  protected escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 过滤图片（根据平台限制）
   */
  protected filterImages(manifest: AssetManifest): AssetManifest['images'] {
    const { limits } = this.platform;
    let images = [...manifest.images];

    // 过滤格式
    if (limits.allowedImageFormats) {
      images = images.filter((img) =>
        limits.allowedImageFormats!.includes(img.metadata.format)
      );
    }

    // 过滤大小
    if (limits.maxImageSize) {
      images = images.filter((img) => img.metadata.size <= limits.maxImageSize!);
    }

    // 限制数量
    if (limits.maxImageCount) {
      images = images.slice(0, limits.maxImageCount);
    }

    return images;
  }

  /**
   * 分类图片（需上传 vs 外链）
   */
  protected categorizeImages(manifest: AssetManifest): {
    toUpload: AssetManifest['images'];
    external: AssetManifest['images'];
  } {
    const filtered = this.filterImages(manifest);
    const imageSource = this.getStrategy('imageSource');

    if (imageSource === 'upload' || !this.supports('externalImages')) {
      return { toUpload: filtered, external: [] };
    } else {
      return { toUpload: [], external: filtered };
    }
  }
}
