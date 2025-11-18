/**
 * 平台能力配置矩阵
 */
import type { PlatformCapability } from '../types/ast';

export const PLATFORM_CONFIGS: Record<string, PlatformCapability> = {
  /**
   * 掘金
   * - 原生 Markdown 编辑器
   * - 支持 KaTeX 数学公式
   * - 接受外链图片
   */
  juejin: {
    id: 'juejin',
    name: '掘金',
    support: {
      markdown: true,
      html: false,
      latex: true,             // 支持 KaTeX 语法
      externalImages: true,
      uploadImages: true,
      richText: false,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,        // 5MB
      maxImageCount: 100,
      allowedImageFormats: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
      maxContentLength: 100000,
    },
    strategy: {
      mathRendering: 'latex',  // 保持 $...$ 语法
      imageSource: 'cdn',      // 使用 CDN URL
      outputFormat: 'markdown',
    },
  },

  /**
   * CSDN
   * - Markdown 编辑器
   * - 支持 MathJax 公式
   * - 接受外链图片
   */
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    support: {
      markdown: true,
      html: true,              // 也支持 HTML
      latex: true,             // MathJax
      externalImages: true,
      uploadImages: true,
      richText: true,
    },
    limits: {
      maxImageSize: 10 * 1024 * 1024,       // 10MB
      allowedImageFormats: ['jpeg', 'jpg', 'png', 'gif'],
    },
    strategy: {
      mathRendering: 'latex',
      imageSource: 'cdn',
      outputFormat: 'markdown',
    },
  },

  /**
   * 知乎
   * - 自研 Markdown 编辑器（部分支持）
   * - 不支持数学公式（需转图片）
   * - 图片需要图床或上传
   */
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    support: {
      markdown: true,          // 部分支持
      html: false,
      latex: false,            // 不支持
      externalImages: false,   // 需要稳定图床
      uploadImages: true,
      richText: false,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,
      maxImageCount: 50,
      allowedImageFormats: ['jpeg', 'jpg', 'png', 'gif'],
    },
    strategy: {
      mathRendering: 'image',  // 公式转图片
      imageSource: 'cdn',      // 使用稳定 CDN
      outputFormat: 'markdown',
    },
  },

  /**
   * 微信公众号
   * - 富文本编辑器
   * - 不支持 Markdown
   * - 图片必须上传
   */
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    support: {
      markdown: false,
      html: true,              // 富文本 HTML
      latex: false,
      externalImages: false,   // 必须上传
      uploadImages: true,
      richText: true,
    },
    limits: {
      maxImageSize: 2 * 1024 * 1024,        // 2MB
      maxImageCount: 30,
      allowedImageFormats: ['jpeg', 'jpg', 'png'],
    },
    strategy: {
      mathRendering: 'image',  // 公式转图片
      imageSource: 'upload',   // 自动化上传
      outputFormat: 'html',
    },
  },

  /**
   * 简书
   * - Markdown 编辑器
   * - 不支持数学公式
   * - 接受外链图片
   */
  jianshu: {
    id: 'jianshu',
    name: '简书',
    support: {
      markdown: true,
      html: false,
      latex: false,
      externalImages: true,
      uploadImages: true,
      richText: false,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,
      allowedImageFormats: ['jpeg', 'jpg', 'png', 'gif'],
    },
    strategy: {
      mathRendering: 'image',
      imageSource: 'cdn',
      outputFormat: 'markdown',
    },
  },

  /**
   * Medium
   * - 富文本编辑器
   * - 不支持 Markdown
   * - 接受外链图片
   */
  medium: {
    id: 'medium',
    name: 'Medium',
    support: {
      markdown: false,
      html: true,
      latex: false,
      externalImages: true,
      uploadImages: true,
      richText: true,
    },
    limits: {
      maxImageSize: 25 * 1024 * 1024,       // 25MB
      allowedImageFormats: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
    },
    strategy: {
      mathRendering: 'image',
      imageSource: 'cdn',
      outputFormat: 'html',
    },
  },

  /**
   * 今日头条
   * - 富文本编辑器
   * - 不支持 Markdown
   * - 图片需要上传
   */
  toutiao: {
    id: 'toutiao',
    name: '今日头条',
    support: {
      markdown: false,
      html: true,
      latex: false,
      externalImages: false,
      uploadImages: true,
      richText: true,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,
      maxImageCount: 50,
      allowedImageFormats: ['jpeg', 'jpg', 'png'],
    },
    strategy: {
      mathRendering: 'image',
      imageSource: 'upload',
      outputFormat: 'html',
    },
  },
};

/**
 * 获取平台配置
 */
export function getPlatformConfig(platformId: string): PlatformCapability | undefined {
  return PLATFORM_CONFIGS[platformId];
}

/**
 * 检查平台是否支持某功能
 */
export function isPlatformSupported(
  platformId: string,
  feature: keyof PlatformCapability['support']
): boolean {
  const config = getPlatformConfig(platformId);
  return config?.support[feature] ?? false;
}

/**
 * 获取所有支持的平台列表
 */
export function getSupportedPlatforms(): PlatformCapability[] {
  return Object.values(PLATFORM_CONFIGS);
}
