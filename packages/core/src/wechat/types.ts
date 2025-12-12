/**
 * 微信公众号格式化器类型定义
 */

/**
 * 微信格式化选项
 */
export interface WechatFormatOptions {
  /** 主题名称 */
  theme?: 'default' | 'grace' | 'simple';
  /** 主题色 */
  primaryColor?: string;
  /** 字体 */
  fontFamily?: string;
  /** 字号 */
  fontSize?: string;
  /** 是否首行缩进 */
  isUseIndent?: boolean;
  /** 是否两端对齐 */
  isUseJustify?: boolean;
  /** 是否显示引用链接 */
  citeStatus?: boolean;
  /** 是否显示阅读时间 */
  countStatus?: boolean;
  /** 是否显示 Mac 风格代码块 */
  isMacCodeBlock?: boolean;
  /** 是否显示行号 */
  isShowLineNumber?: boolean;
  /** 图片说明格式 */
  legend?: 'alt' | 'title' | 'alt-title';
  /** 作者名称 */
  author?: string;
}

/**
 * 微信格式化结果
 */
export interface WechatFormatResult {
  /** 格式化后的 HTML（可直接粘贴到公众号） */
  html: string;
  /** 内联样式的 CSS */
  css: string;
  /** 提取的元数据 */
  meta?: {
    title?: string;
    description?: string;
    tags?: string[];
    wordCount?: number;
    readingTime?: number;
  };
  /** 脚注列表 */
  footnotes?: Array<{
    index: number;
    title: string;
    link: string;
  }>;
}

/**
 * CSS 变量配置
 */
export interface CSSVariableConfig {
  primaryColor: string;
  fontFamily: string;
  fontSize: string;
  isUseIndent?: boolean;
  isUseJustify?: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_WECHAT_OPTIONS: Required<WechatFormatOptions> = {
  theme: 'default',
  primaryColor: '#3f51b5',
  fontFamily: '-apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
  fontSize: '15px',
  isUseIndent: false,
  isUseJustify: false,
  citeStatus: true,
  countStatus: false,
  isMacCodeBlock: true,
  isShowLineNumber: false,
  legend: 'alt',
  author: '',
};
