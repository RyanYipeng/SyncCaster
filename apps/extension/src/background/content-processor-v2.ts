/**
 * 内容处理器 v2.0
 * 在 background 使用 unified 架构处理采集的内容
 */
import {
  parseContent,
  mdastToMarkdown,
  createAdapter,
  AssetDownloader,
  type AssetManifest,
  type ContentAST,
} from '@synccaster/core';

interface ProcessOptions {
  /** 是否下载图片 */
  downloadImages?: boolean;
  /** 需要适配的平台 */
  platforms?: string[];
  /** 进度回调 */
  onProgress?: (stage: string, progress: number) => void;
}

interface ProcessResult {
  success: boolean;
  data?: {
    ast: ContentAST;
    manifest: AssetManifest;
    markdown: string;
    adaptedContent: Record<string, any>;
    metadata: {
      wordCount: number;
      imageCount: number;
      formulaCount: number;
    };
  };
  error?: string;
}

/**
 * 处理采集的 HTML 内容
 */
export async function processCollectedHTML(
  html: string,
  metadata: { title: string; url: string },
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  try {
    console.log('[ProcessorV2] Starting processing...');

    // 1. 解析 AST
    options.onProgress?.('parsing', 0.2);
    const { ast, manifest } = await parseContent(html);
    
    console.log('[ProcessorV2] AST parsed:', {
      images: manifest.images.length,
      formulas: manifest.formulas.length,
    });

    // 2. 生成默认 Markdown
    options.onProgress?.('converting', 0.4);
    const markdown = await mdastToMarkdown(ast.mdast);

    // 3. 下载图片（如果需要）
    if (options.downloadImages && manifest.images.length > 0) {
      options.onProgress?.('downloading', 0.5);
      
      const downloader = new AssetDownloader({
        concurrency: 3,
        timeout: 30000,
        maxRetries: 2,
        onProgress: (current, total) => {
          const downloadProgress = 0.5 + (current / total) * 0.3;
          options.onProgress?.('downloading', downloadProgress);
        },
      });

      const { stats } = await downloader.downloadManifest(manifest);
      
      console.log('[ProcessorV2] Images downloaded:', stats);
    }

    // 4. 适配到目标平台
    options.onProgress?.('adapting', 0.8);
    const adaptedContent: Record<string, any> = {};
    const targetPlatforms = options.platforms || ['juejin', 'csdn'];

    for (const platformId of targetPlatforms) {
      try {
        const adapter = createAdapter(platformId);
        adaptedContent[platformId] = await adapter.adapt(
          {
            id: generateId(),
            title: metadata.title,
            body_md: markdown,
            ast,
          } as any,
          manifest
        );

        console.log(`[ProcessorV2] Adapted to ${platformId}`);
      } catch (error) {
        console.warn(`[ProcessorV2] Failed to adapt to ${platformId}:`, error);
      }
    }

    options.onProgress?.('complete', 1.0);

    return {
      success: true,
      data: {
        ast,
        manifest,
        markdown,
        adaptedContent,
        metadata: {
          wordCount: markdown.length,
          imageCount: manifest.images.length,
          formulaCount: manifest.formulas.length,
        },
      },
    };
  } catch (error) {
    console.error('[ProcessorV2] Processing failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 生成 ID
 */
function generateId(): string {
  return `post_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 从 v1.0 采集结果转换
 */
export async function processV1CollectResult(
  v1Result: any,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  // v1.0 的结果包含 body_html
  return processCollectedHTML(
    v1Result.body_html || v1Result.html,
    {
      title: v1Result.title,
      url: v1Result.url,
    },
    options
  );
}
