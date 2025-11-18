/**
 * 资产代理服务客户端
 * 与云端资产中转服务通信
 */
import type {
  AssetManifest,
  AssetProxyRequest,
  AssetProxyResponse,
  URLMapping,
} from '../types/ast';

export interface ProxyServiceConfig {
  /** API 端点 */
  endpoint: string;
  /** API 密钥 */
  apiKey?: string;
  /** 超时时间 */
  timeout?: number;
  /** 是否启用缓存 */
  useCache?: boolean;
}

/**
 * 资产代理服务客户端
 */
export class AssetProxyClient {
  private readonly config: Required<ProxyServiceConfig>;
  private readonly cache: Map<string, string> = new Map();

  constructor(config: ProxyServiceConfig) {
    this.config = {
      timeout: 60000,
      useCache: true,
      ...config,
    } as Required<ProxyServiceConfig>;
  }

  /**
   * 上传资产清单，获取 CDN URL 映射
   */
  async upload(manifest: AssetManifest): Promise<AssetProxyResponse> {
    // 检查缓存
    if (this.config.useCache) {
      const cached = this.checkCache(manifest);
      if (cached.allCached) {
        return {
          mapping: cached.mapping,
          assets: manifest,
          stats: {
            total: manifest.images.length,
            success: manifest.images.length,
            failed: 0,
            cached: manifest.images.length,
          },
        };
      }
    }

    // 准备请求
    const request: AssetProxyRequest = {
      manifest,
      options: {
        optimize: true,
        formats: ['webp'],
        maxSize: 1920,
      },
    };

    // 发送请求
    const response = await this.fetch<AssetProxyResponse>(
      '/api/proxy-assets',
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    // 更新缓存
    if (this.config.useCache) {
      for (const [original, cdn] of Object.entries(response.mapping)) {
        this.cache.set(original, cdn);
      }
    }

    // 更新资产状态
    for (const image of manifest.images) {
      const proxyUrl = response.mapping[image.originalUrl];
      if (proxyUrl) {
        image.proxyUrl = proxyUrl;
        image.status = 'ready';
      } else {
        image.status = 'failed';
        image.error = 'Proxy failed';
      }
    }

    return response;
  }

  /**
   * 批量上传（仅图片 URL）
   */
  async uploadUrls(urls: string[]): Promise<URLMapping> {
    const manifest: AssetManifest = {
      images: urls.map((url, index) => ({
        id: `temp-${index}`,
        originalUrl: url,
        metadata: {
          format: this.guessFormat(url),
          size: 0,
        },
        status: 'pending',
      })),
      formulas: [],
    };

    const response = await this.upload(manifest);
    return response.mapping;
  }

  /**
   * 检查缓存
   */
  private checkCache(manifest: AssetManifest): {
    allCached: boolean;
    mapping: URLMapping;
  } {
    const mapping: URLMapping = {};
    let cachedCount = 0;

    for (const image of manifest.images) {
      const cached = this.cache.get(image.originalUrl);
      if (cached) {
        mapping[image.originalUrl] = cached;
        cachedCount++;
      }
    }

    return {
      allCached: cachedCount === manifest.images.length,
      mapping,
    };
  }

  /**
   * 通用 HTTP 请求
   */
  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = new URL(path, this.config.endpoint).toString();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeout
    );

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 猜测图片格式
   */
  private guessFormat(url: string): any {
    const ext = url.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'jpeg';
      case 'png':
        return 'png';
      case 'webp':
        return 'webp';
      case 'gif':
        return 'gif';
      case 'svg':
        return 'svg';
      default:
        return 'jpeg';
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * 创建本地代理（无服务端版本）
 * 使用 IndexedDB 存储和 blob URL
 */
export class LocalAssetProxy {
  /**
   * 使用本地 Blob URL
   */
  async createLocalUrls(manifest: AssetManifest): Promise<URLMapping> {
    const mapping: URLMapping = {};

    for (const image of manifest.images) {
      if (image.localBlob) {
        const blobUrl = URL.createObjectURL(image.localBlob);
        mapping[image.originalUrl] = blobUrl;
        image.proxyUrl = blobUrl;
        image.status = 'ready';
      }
    }

    return mapping;
  }

  /**
   * 释放 Blob URL
   */
  revoke(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
