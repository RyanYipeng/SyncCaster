/**
 * 图片上传管道 v2
 *
 * 负责：下载、规范化、上传、替换链接
 */
import type { ImageAsset, AssetManifest } from '../types/ast';

// ========== 类型定义 ==========

/**
 * 图片上传模式
 */
export type ImageUploadMode =
  | 'binaryUpload'    // 直接走官方/站内 API
  | 'urlFetch'        // 平台自己去拉取 URL
  | 'domPasteUpload'  // 在站内通过粘贴触发图床
  | 'externalUrlOnly' // 直接使用外链
  | 'proxy';          // 代理/CDN（预留）

/**
 * DOM 粘贴上传配置
 */
export interface DomPasteConfig {
  /** 编辑器所在 URL（用于打开/切换 tab） */
  editorUrl: string;
  /** 编辑器正文区域的 selector */
  editorSelector: string;
  /** 等待图片落地的超时时间 */
  timeoutMs?: number;
}

/**
 * 平台图片约束
 */
export interface PlatformImageConstraints {
  /** 接受的 MIME 类型 */
  acceptedMimeTypes: string[];
  /** 最大文件大小（MB） */
  maxSizeMB?: number;
  /** 最大宽度 */
  maxWidth?: number;
  /** 最大高度 */
  maxHeight?: number;
}

/**
 * 平台图片上传策略配置
 */
export interface ImageUploadStrategy {
  /** 上传模式 */
  mode: ImageUploadMode;
  /** 图片约束 */
  constraints?: PlatformImageConstraints;
  /** 是否需要先拿 postId 才能上传 */
  requirePostIdBeforeUpload?: boolean;
  /** DOM 粘贴上传配置 */
  domPasteConfig?: DomPasteConfig;

  // === binaryUpload 模式配置 ===
  /** 上传接口 URL */
  uploadUrl?: string;
  /** 请求方法 */
  method?: 'POST' | 'PUT';
  /** 文件字段名 */
  fileFieldName?: string;
  /** 额外字段 */
  extraFields?: Record<string, string>;
  /** 需要的 Header */
  headers?: Record<string, string>;
  /** CSRF Token 获取方式 */
  csrfToken?: {
    type: 'cookie' | 'meta' | 'header' | 'localStorage';
    name: string;
    headerName?: string; // 发送时的 header 名称
  };
  /** 响应解析器 */
  responseParser?: (response: any) => { url: string; id?: string };

  // === urlFetch 模式配置 ===
  urlFetchConfig?: {
    /** 抓取接口 URL */
    fetchUrl: string;
    /** URL 字段名 */
    urlFieldName: string;
    /** 额外字段 */
    extraFields?: Record<string, string>;
    /** 响应解析器 */
    responseParser?: (response: any) => { url: string; id?: string };
  };
}

/**
 * 图片上传结果
 */
export interface ImageUploadResult {
  originalUrl: string;
  newUrl: string;
  success: boolean;
  error?: string;
  assetId?: string;
}

/**
 * 图片上传进度
 */
export interface ImageUploadProgress {
  total: number;
  completed: number;
  current?: string;
  stage: 'downloading' | 'uploading' | 'complete';
}

/**
 * 图片管道选项
 */
export interface ImagePipelineOptions {
  /** 并发数 */
  concurrency?: number;
  /** 超时时间 */
  timeout?: number;
  /** 重试次数 */
  maxRetries?: number;
  /** 进度回调 */
  onProgress?: (progress: ImageUploadProgress) => void;
  /** 跳过已上传的图片 */
  skipUploaded?: boolean;
}

// ========== 图片上传管道 ==========

export class ImageUploadPipeline {
  private options: Required<ImagePipelineOptions>;

  constructor(options: ImagePipelineOptions = {}) {
    this.options = {
      concurrency: 3,
      timeout: 30000,
      maxRetries: 2,
      onProgress: () => {},
      skipUploaded: true,
      ...options,
    };
  }

  /**
   * 处理文章中的所有图片
   *
   * @param manifest 资产清单
   * @param strategy 上传策略
   * @param platformId 目标平台 ID
   * @returns 图片 URL 映射表 { originalUrl -> newUrl }
   */
  async processImages(
    manifest: AssetManifest,
    strategy: ImageUploadStrategy,
    platformId: string
  ): Promise<Map<string, string>> {
    const urlMapping = new Map<string, string>();
    const images = manifest.images.filter(img => {
      // 跳过已上传到该平台的图片
      if (this.options.skipUploaded && img.uploadedTo?.includes(platformId)) {
        if (img.proxyUrl) {
          urlMapping.set(img.originalUrl, img.proxyUrl);
        }
        return false;
      }
      return true;
    });

    if (images.length === 0) {
      return urlMapping;
    }

    this.options.onProgress({
      total: images.length,
      completed: 0,
      stage: 'downloading',
    });

    // 1. 下载所有图片
    const downloadedImages = await this.downloadImages(images);

    this.options.onProgress({
      total: images.length,
      completed: 0,
      stage: 'uploading',
    });

    // 2. 根据策略上传图片
    let completed = 0;
    const results: ImageUploadResult[] = [];

    // 并发控制
    const queue = [...downloadedImages];
    const workers = Array.from({ length: this.options.concurrency }, async () => {
      while (queue.length > 0) {
        const image = queue.shift();
        if (!image || !image.localBlob) continue;

        this.options.onProgress({
          total: images.length,
          completed,
          current: image.originalUrl,
          stage: 'uploading',
        });

        try {
          const result = await this.uploadImage(image, strategy);
          results.push(result);

          if (result.success) {
            urlMapping.set(result.originalUrl, result.newUrl);
            // 标记已上传
            image.uploadedTo = image.uploadedTo || [];
            image.uploadedTo.push(platformId);
            image.proxyUrl = result.newUrl;
            console.log(`[ImagePipeline] 上传成功: ${image.originalUrl} -> ${result.newUrl}`);
          } else {
            console.error(`[ImagePipeline] 上传失败: ${image.originalUrl}`, result.error);
          }
        } catch (error) {
          console.error(`[ImagePipeline] 上传异常: ${image.originalUrl}`, error);
          results.push({
            originalUrl: image.originalUrl,
            newUrl: image.originalUrl,
            success: false,
            error: (error as Error).message,
          });
        }

        completed++;
      }
    });

    await Promise.all(workers);

    this.options.onProgress({
      total: images.length,
      completed: images.length,
      stage: 'complete',
    });

    return urlMapping;
  }

  /**
   * 下载图片到内存
   */
  private async downloadImages(images: ImageAsset[]): Promise<ImageAsset[]> {
    const results: ImageAsset[] = [];
    let completed = 0;

    const queue = [...images];
    const workers = Array.from({ length: this.options.concurrency }, async () => {
      while (queue.length > 0) {
        const image = queue.shift();
        if (!image) continue;

        // 如果已经有 blob，跳过下载
        if (image.localBlob) {
          results.push(image);
          completed++;
          continue;
        }

        try {
          const blob = await this.fetchImage(image.originalUrl);
          image.localBlob = blob;
          image.metadata.size = blob.size;
          image.status = 'ready';
          results.push(image);
        } catch (error) {
          console.error(`[ImagePipeline] 下载失败: ${image.originalUrl}`, error);
          image.status = 'failed';
          image.error = (error as Error).message;
        }

        completed++;
        this.options.onProgress({
          total: images.length,
          completed,
          current: image.originalUrl,
          stage: 'downloading',
        });
      }
    });

    await Promise.all(workers);
    return results.filter(img => img.localBlob);
  }

  /**
   * 获取图片 Blob
   */
  private async fetchImage(url: string): Promise<Blob> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      // CORS 失败时，尝试通过 Canvas 获取
      return await this.fetchImageViaCanvas(url);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 通过 Canvas 获取图片（绕过部分 CORS 限制）
   */
  private fetchImageViaCanvas(url: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Canvas toBlob failed'));
              }
            },
            'image/png'
          );
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  }

  /**
   * 上传单张图片
   */
  private async uploadImage(
    image: ImageAsset,
    strategy: ImageUploadStrategy
  ): Promise<ImageUploadResult> {
    const { originalUrl, localBlob } = image;

    if (!localBlob) {
      return {
        originalUrl,
        newUrl: originalUrl,
        success: false,
        error: 'No blob data',
      };
    }

    try {
      // 1. 按平台规格规范化图片
      const normalizedBlob = await this.normalizeForPlatform(localBlob, strategy.constraints);
      image.localBlob = normalizedBlob;

      // 2. 根据模式上传
      switch (strategy.mode) {
        case 'binaryUpload':
          return await this.uploadViaApi(image, strategy);

        case 'urlFetch':
          return await this.uploadViaUrlFetch(image, strategy);

        case 'domPasteUpload':
          // DOM 粘贴上传在站内页面执行，这里只做占位
          return {
            originalUrl,
            newUrl: originalUrl,
            success: false,
            error: 'DOM paste upload should be handled in page context',
          };

        case 'externalUrlOnly':
          // 直接使用原始 URL
          return {
            originalUrl,
            newUrl: originalUrl,
            success: true,
          };

        case 'proxy':
          return {
            originalUrl,
            newUrl: originalUrl,
            success: false,
            error: 'Proxy mode not implemented',
          };

        default:
          return {
            originalUrl,
            newUrl: originalUrl,
            success: false,
            error: `Unsupported upload mode: ${strategy.mode}`,
          };
      }
    } catch (error) {
      return {
        originalUrl,
        newUrl: originalUrl,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 按平台规格规范化图片
   * - 格式转换
   * - 压缩
   * - 缩放
   *
   * 注意：在 Service Worker 中，某些操作（如 Canvas）不可用
   */
  private async normalizeForPlatform(
    blob: Blob,
    constraints?: PlatformImageConstraints
  ): Promise<Blob> {
    if (!constraints) return blob;

    const isServiceWorker = typeof document === 'undefined';
    const { acceptedMimeTypes, maxSizeMB, maxWidth, maxHeight } = constraints;
    let currentBlob = blob;
    let currentMimeType = blob.type;

    // 1. 格式转换：如果当前格式不被接受，转为 JPEG
    if (acceptedMimeTypes && !acceptedMimeTypes.includes(currentMimeType)) {
      if (isServiceWorker) {
        console.log(`[ImagePipeline] Service Worker 中无法转换格式，跳过: ${currentMimeType}`);
      } else {
        currentBlob = await this.convertImageFormat(currentBlob, 'image/jpeg');
        currentMimeType = 'image/jpeg';
      }
    }

    // 2. 检查大小，需要压缩（Service Worker 中跳过）
    const sizeMB = currentBlob.size / (1024 * 1024);
    if (maxSizeMB && sizeMB > maxSizeMB) {
      if (isServiceWorker) {
        console.log(`[ImagePipeline] Service Worker 中无法压缩图片，跳过`);
      } else {
        currentBlob = await this.compressImage(currentBlob, maxSizeMB, maxWidth, maxHeight);
      }
    }

    // 3. 检查尺寸，需要缩放（Service Worker 中跳过）
    if (!isServiceWorker && (maxWidth || maxHeight)) {
      try {
        const dimensions = await this.getImageDimensions(currentBlob);
        if ((maxWidth && dimensions.width > maxWidth) || (maxHeight && dimensions.height > maxHeight)) {
          currentBlob = await this.resizeImage(currentBlob, maxWidth, maxHeight);
        }
      } catch (e) {
        console.log(`[ImagePipeline] 获取图片尺寸失败，跳过缩放`);
      }
    }

    return currentBlob;
  }

  /**
   * 转换图片格式
   */
  private async convertImageFormat(blob: Blob, targetMimeType: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          // 白色背景（对于透明图片转 JPEG）
          if (targetMimeType === 'image/jpeg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(img, 0, 0);

          canvas.toBlob(
            (newBlob) => {
              URL.revokeObjectURL(url);
              if (newBlob) {
                resolve(newBlob);
              } else {
                reject(new Error('Format conversion failed'));
              }
            },
            targetMimeType,
            0.9
          );
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };

      img.src = url;
    });
  }

  /**
   * 压缩图片
   */
  private async compressImage(
    blob: Blob,
    targetSizeMB: number,
    maxWidth?: number,
    maxHeight?: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = async () => {
        try {
          let width = img.naturalWidth;
          let height = img.naturalHeight;

          // 计算缩放比例
          if (maxWidth && width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          if (maxHeight && height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // 逐步降低质量直到满足大小要求
          let quality = 0.9;
          let result: Blob | null = null;

          while (quality > 0.1) {
            result = await new Promise<Blob | null>((res) => {
              canvas.toBlob((b) => res(b), 'image/jpeg', quality);
            });

            if (result && result.size / (1024 * 1024) <= targetSizeMB) {
              break;
            }
            quality -= 0.1;
          }

          URL.revokeObjectURL(url);

          if (result) {
            resolve(result);
          } else {
            reject(new Error('Compression failed'));
          }
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };

      img.src = url;
    });
  }

  /**
   * 缩放图片
   */
  private async resizeImage(blob: Blob, maxWidth?: number, maxHeight?: number): Promise<Blob> {
    return this.compressImage(blob, Infinity, maxWidth, maxHeight);
  }

  /**
   * 获取图片尺寸
   */
  private getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };

      img.src = url;
    });
  }

  /**
   * 通过 URL 抓取模式上传（平台自己从 URL 拉取）
   */
  private async uploadViaUrlFetch(
    image: ImageAsset,
    strategy: ImageUploadStrategy
  ): Promise<ImageUploadResult> {
    const { originalUrl } = image;
    const config = strategy.urlFetchConfig;

    if (!config) {
      throw new Error('URL fetch config not configured');
    }

    // 构建请求体
    const body: Record<string, string> = {
      [config.urlFieldName]: originalUrl,
      ...config.extraFields,
    };

    // 构建 Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...strategy.headers,
    };

    // 获取 CSRF Token
    if (strategy.csrfToken) {
      const token = this.getCsrfToken(strategy.csrfToken);
      if (token) {
        const headerName = strategy.csrfToken.headerName || strategy.csrfToken.name;
        headers[headerName] = token;
      }
    }

    // 发送请求
    const response = await fetch(config.fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`URL fetch upload failed: HTTP ${response.status}`);
    }

    const data = await response.json();

    // 解析响应
    if (config.responseParser) {
      const result = config.responseParser(data);
      return {
        originalUrl,
        newUrl: result.url,
        success: true,
        assetId: result.id,
      };
    }

    // 默认响应解析
    const url = data.url || data.data?.url || data.result?.url;
    if (!url) {
      throw new Error('Cannot parse URL fetch response');
    }

    return {
      originalUrl,
      newUrl: url,
      success: true,
    };
  }

  /**
   * 通过 API 上传图片
   */
  private async uploadViaApi(
    image: ImageAsset,
    strategy: ImageUploadStrategy
  ): Promise<ImageUploadResult> {
    const { originalUrl, localBlob, metadata } = image;

    if (!strategy.uploadUrl) {
      throw new Error('Upload URL not configured');
    }

    // 构建 FormData
    const formData = new FormData();

    // 生成文件名
    const ext = metadata.format || 'png';
    const filename = `image_${Date.now()}.${ext}`;
    const file = new File([localBlob!], filename, { type: localBlob!.type });

    formData.append(strategy.fileFieldName || 'file', file);

    // 添加额外字段
    if (strategy.extraFields) {
      for (const [key, value] of Object.entries(strategy.extraFields)) {
        formData.append(key, value);
      }
    }

    // 构建 Headers
    const headers: Record<string, string> = {
      ...strategy.headers,
    };

    // 获取 CSRF Token
    if (strategy.csrfToken) {
      const token = this.getCsrfToken(strategy.csrfToken);
      if (token) {
        headers[strategy.csrfToken.name] = token;
      }
    }

    // 发送请求
    const response = await fetch(strategy.uploadUrl, {
      method: strategy.method || 'POST',
      headers,
      body: formData,
      credentials: 'include', // 带上 Cookie
    });

    if (!response.ok) {
      throw new Error(`Upload failed: HTTP ${response.status}`);
    }

    const data = await response.json();

    // 解析响应
    if (strategy.responseParser) {
      const result = strategy.responseParser(data);
      return {
        originalUrl,
        newUrl: result.url,
        success: true,
        assetId: result.id,
      };
    }

    // 默认响应解析（尝试常见字段）
    const url = data.url || data.data?.url || data.result?.url ||
                data.imageUrl || data.data?.imageUrl || data.src;

    if (!url) {
      throw new Error('Cannot parse upload response');
    }

    return {
      originalUrl,
      newUrl: url,
      success: true,
    };
  }

  /**
   * 获取 CSRF Token
   * 注意：在 Service Worker 中，document / localStorage 不可用
   */
  private getCsrfToken(config: NonNullable<ImageUploadStrategy['csrfToken']>): string | null {
    const isServiceWorker = typeof document === 'undefined';

    if (isServiceWorker) {
      console.log(`[ImagePipeline] Service Worker 中无法获取 CSRF Token`);
      return null;
    }

    switch (config.type) {
      case 'cookie': {
        const match = document.cookie.match(new RegExp(`${config.name}=([^;]+)`));
        return match ? match[1] : null;
      }
      case 'meta': {
        const meta = document.querySelector(`meta[name="${config.name}"]`);
        return meta?.getAttribute('content') || null;
      }
      case 'localStorage': {
        return localStorage.getItem(config.name);
      }
      case 'header': {
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * 替换内容中的图片链接
   */
  static replaceImageUrls(
    content: string,
    urlMapping: Map<string, string>
  ): string {
    // 修正常见的“图片 URL 被换行/空格打断”问题（例如 `. jpeg`），否则 Markdown 无法识别图片。
    let result = normalizeMarkdownImageLinkDestinations(content);

    for (const [originalUrl, newUrl] of urlMapping) {
      // 替换 Markdown 图片语法
      const mdPattern = new RegExp(
        `!\\[([^\\]]*)\\]\\(\\s*<?${escapeRegExp(originalUrl)}>?\\s*\\)`,
        'g'
      );
      result = result.replace(mdPattern, `![$1](${newUrl})`);

      // 替换 HTML img 标签
      const htmlPattern = new RegExp(
        `<img([^>]*)src=["']${escapeRegExp(originalUrl)}["']([^>]*)>`,
        'gi'
      );
      result = result.replace(htmlPattern, `<img$1src="${newUrl}"$2>`);
    }

    return result;
  }
}

function normalizeMarkdownImageLinkDestinations(markdown: string): string {
  if (!markdown) return markdown;

  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, rawInner: string) => {
    let inner = String(rawInner || '').trim();

    // 处理可选 title（通常从引号开始），避免破坏 title 内的空格
    let titlePart = '';
    const quoteIdx = inner.search(/["']/);
    if (quoteIdx > 0) {
      titlePart = inner.slice(quoteIdx).trim();
      inner = inner.slice(0, quoteIdx).trimEnd();
    }

    // 支持 ![](<url>) 写法：去掉包裹的尖括号
    if (inner.startsWith('<') && inner.endsWith('>')) {
      inner = inner.slice(1, -1);
    }

    // 去除 URL 中的空白（换行/空格/制表符）
    const normalizedUrl = inner.replace(/\s+/g, '');
    return `![${alt}](${normalizedUrl}${titlePart ? ' ' + titlePart : ''})`;
  });
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
