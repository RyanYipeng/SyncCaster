/**
 * 微信公众号适配器
 * 使用专门的微信格式化器生成公众号可用的 HTML
 */

import type { Root as MdastRoot } from 'mdast';
import type {
  AdaptedContent,
  AssetManifest,
  PlatformCapability,
} from '../types/ast';
import type { CanonicalPost } from '../types';
import { PlatformAdapter } from './base';
import { mdToWechatHtml } from '../wechat';
import type { WechatFormatOptions } from '../wechat';

/**
 * 微信公众号适配器
 */
export class WechatAdapter extends PlatformAdapter {
  async adapt(
    post: CanonicalPost,
    manifest: AssetManifest
  ): Promise<AdaptedContent> {
    // 1. 获取 Markdown 内容
    const markdown = post.body_md;

    // 2. 获取微信格式化选项
    const wechatOptions: WechatFormatOptions = {
      theme: this.options.config?.theme || 'default',
      primaryColor: this.options.config?.primaryColor || '#3f51b5',
      fontFamily: this.options.config?.fontFamily,
      fontSize: this.options.config?.fontSize || '15px',
      isUseIndent: this.options.config?.isUseIndent || false,
      isUseJustify: this.options.config?.isUseJustify || false,
      citeStatus: this.options.config?.citeStatus !== false,
      countStatus: this.options.config?.countStatus || false,
      isMacCodeBlock: this.options.config?.isMacCodeBlock !== false,
      isShowLineNumber: this.options.config?.isShowLineNumber || false,
      legend: this.options.config?.legend || 'alt',
    };

    // 3. 转换为微信公众号 HTML
    const result = await mdToWechatHtml(markdown, wechatOptions);

    // 4. 替换图片 URL
    let content = this.replaceImageUrls(result.html, manifest);

    // 5. 分类资产（微信公众号需要上传图片）
    const { toUpload, external } = this.categorizeImages(manifest);

    return {
      platform: this.getPlatformId(),
      format: 'html',
      content,
      assets: {
        toUpload,
        external,
        formulas: manifest.formulas,
      },
      meta: {
        wordCount: result.meta?.wordCount || 0,
        readingTime: result.meta?.readingTime || 0,
        imageCount: manifest.images.length,
        formulaCount: manifest.formulas.length,
        // 额外提供原始 CSS（用于预览）
        rawCss: result.css,
      },
    };
  }
}

/**
 * 创建微信公众号适配器的工厂函数
 */
export function createWechatAdapter(options?: {
  theme?: 'default' | 'grace' | 'simple';
  primaryColor?: string;
  fontSize?: string;
  isUseIndent?: boolean;
  isUseJustify?: boolean;
  citeStatus?: boolean;
}): WechatAdapter {
  // 微信公众号平台能力配置
  const wechatCapability: PlatformCapability = {
    id: 'wechat',
    name: '微信公众号',
    support: {
      markdown: false,
      html: true,
      latex: false,
      externalImages: false,
      uploadImages: true,
      richText: true,
    },
    strategy: {
      mathRendering: 'image',
      imageSource: 'upload',
      outputFormat: 'html',
    },
    limits: {
      maxContentLength: 20000,
      maxImageCount: 20,
      maxImageSize: 10 * 1024 * 1024, // 10MB
      allowedImageFormats: ['jpg', 'jpeg', 'png', 'gif'],
    },
  };

  return new WechatAdapter(wechatCapability, {
    config: options,
  });
}
