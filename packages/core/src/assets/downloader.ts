/**
 * 资产下载器
 * 批量下载图片等资源
 */
import type { ImageAsset, AssetManifest } from '../types/ast';

export interface DownloadOptions {
  /** 最大并发数 */
  concurrency?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  maxRetries?: number;
  /** 进度回调 */
  onProgress?: (current: number, total: number) => void;
}

export interface DownloadResult {
  asset: ImageAsset;
  blob?: Blob;
  success: boolean;
  error?: string;
}

/**
 * 资产下载器
 */
export class AssetDownloader {
  private readonly defaultOptions: Required<DownloadOptions> = {
    concurrency: 5,
    timeout: 30000,
    maxRetries: 3,
    onProgress: () => {},
  };

  constructor(private options: DownloadOptions = {}) {
    this.options = { ...this.defaultOptions, ...options };
  }

  /**
   * 下载单个资产
   */
  async downloadOne(asset: ImageAsset): Promise<DownloadResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.options.maxRetries!; attempt++) {
      try {
        const blob = await this.fetchWithTimeout(
          asset.originalUrl,
          this.options.timeout!
        );

        // 更新资产元数据
        asset.metadata.size = blob.size;
        asset.localBlob = blob;
        asset.status = 'ready';

        return {
          asset,
          blob,
          success: true,
        };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.options.maxRetries!) {
          // 等待后重试
          await this.sleep(1000 * attempt);
        }
      }
    }

    asset.status = 'failed';
    asset.error = lastError?.message || 'Download failed';

    return {
      asset,
      success: false,
      error: lastError?.message,
    };
  }

  /**
   * 批量下载资产
   */
  async downloadAll(assets: ImageAsset[]): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];
    const queue = [...assets];
    let completed = 0;

    // 并发控制
    const workers = Array.from({ length: this.options.concurrency! }, async () => {
      while (queue.length > 0) {
        const asset = queue.shift();
        if (!asset) break;

        asset.status = 'downloading';
        const result = await this.downloadOne(asset);
        results.push(result);

        completed++;
        this.options.onProgress?.(completed, assets.length);
      }
    });

    await Promise.all(workers);

    return results;
  }

  /**
   * 下载清单中的所有图片
   */
  async downloadManifest(manifest: AssetManifest): Promise<{
    results: DownloadResult[];
    stats: {
      total: number;
      success: number;
      failed: number;
    };
  }> {
    const results = await this.downloadAll(manifest.images);

    const stats = {
      total: results.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    return { results, stats };
  }

  /**
   * 带超时的 fetch
   */
  private async fetchWithTimeout(url: string, timeout: number): Promise<Blob> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      return blob;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Download timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 计算 SHA-256 哈希
   */
  async calculateHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
