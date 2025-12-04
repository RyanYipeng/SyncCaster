/**
 * 平台采集规则配置
 * 
 * 为不同平台定义内容选择器和特殊处理规则
 * 这比通用的 Readability 更精确
 */

export interface PlatformRule {
  /** 平台 ID */
  id: string;
  /** 平台名称 */
  name: string;
  /** URL 匹配模式 */
  urlPatterns: RegExp[];
  /** 内容选择器（按优先级排序） */
  contentSelectors: string[];
  /** 标题选择器 */
  titleSelector?: string;
  /** 需要移除的元素选择器 */
  removeSelectors?: string[];
  /** 特殊处理配置 */
  special?: {
    /** 公式引擎 */
    mathEngine?: 'katex' | 'mathjax2' | 'mathjax3';
    /** 代码高亮库 */
    codeHighlight?: 'prism' | 'highlight.js' | 'custom';
    /** 图片懒加载属性 */
    lazyLoadAttr?: string;
  };
}

/**
 * 平台采集规则列表
 */
export const platformRules: PlatformRule[] = [
  {
    id: 'juejin',
    name: '掘金',
    urlPatterns: [/juejin\.cn\/post\//],
    contentSelectors: [
      '.markdown-body',
      '.article-content',
      '[class*="article-content"]',
    ],
    titleSelector: '.article-title, h1.title',
    removeSelectors: [
      '.copy-code-btn',
      '.code-block-extension-header',
      '.article-suspended-panel',
    ],
    special: {
      mathEngine: 'katex',
      codeHighlight: 'prism',
      lazyLoadAttr: 'data-src',
    },
  },
  {
    id: 'csdn',
    name: 'CSDN',
    urlPatterns: [/blog\.csdn\.net\/.*\/article/],
    contentSelectors: [
      '#content_views',
      '.markdown_views',
      '.article_content',
    ],
    titleSelector: '.title-article, h1.title',
    removeSelectors: [
      '.hide-article-box',
      '.blog-tags-box',
      '.recommend-box',
    ],
    special: {
      mathEngine: 'mathjax2',
      codeHighlight: 'highlight.js',
      lazyLoadAttr: 'data-src',
    },
  },
  {
    id: 'zhihu',
    name: '知乎',
    urlPatterns: [/zhihu\.com\/(question|p)\//],
    contentSelectors: [
      '.RichText',
      '.Post-RichText',
      '.ArticleItem-content',
    ],
    titleSelector: '.QuestionHeader-title, .Post-Title',
    removeSelectors: [
      '.ContentItem-actions',
      '.RichContent-actions',
    ],
    special: {
      mathEngine: 'mathjax3',
      lazyLoadAttr: 'data-actualsrc',
    },
  },
  {
    id: 'jianshu',
    name: '简书',
    urlPatterns: [/jianshu\.com\/p\//],
    contentSelectors: [
      '.article',
      '._2rhmJa',
      '[class*="article"]',
    ],
    titleSelector: '.title, h1',
    removeSelectors: [
      '.follow-detail',
      '.support-author',
    ],
  },
  {
    id: 'cnblogs',
    name: '博客园',
    urlPatterns: [/cnblogs\.com\/.*\/p\//],
    contentSelectors: [
      '#cnblogs_post_body',
      '.blogpost-body',
      '.post-body',
    ],
    titleSelector: '.postTitle, #cb_post_title_url',
    removeSelectors: [
      '.postDesc',
      '#blog_post_info',
    ],
    special: {
      mathEngine: 'mathjax2',
    },
  },
  {
    id: 'segmentfault',
    name: '思否',
    urlPatterns: [/segmentfault\.com\/a\//],
    contentSelectors: [
      '.article-content',
      '.article__content',
      '[class*="article-content"]',
    ],
    titleSelector: '.article__title, h1.title',
    removeSelectors: [
      '.article-actions',
    ],
    special: {
      mathEngine: 'katex',
      codeHighlight: 'highlight.js',
    },
  },
  {
    id: 'oschina',
    name: '开源中国',
    urlPatterns: [/oschina\.net\/.*\/blog\//],
    contentSelectors: [
      '.article-detail',
      '.content',
      '.blog-content',
    ],
    titleSelector: '.article-box__title, h1.title',
  },
  {
    id: '51cto',
    name: '51CTO',
    urlPatterns: [/blog\.51cto\.com\//],
    contentSelectors: [
      '.article-content',
      '.blog-content',
      '.content',
    ],
    titleSelector: '.article-title, h1.title',
  },
  {
    id: 'tencent-cloud',
    name: '腾讯云开发者社区',
    urlPatterns: [/cloud\.tencent\.com\/developer\/article/],
    contentSelectors: [
      '.article-content',
      '.J-articleContent',
      '[class*="article-content"]',
    ],
    titleSelector: '.article-title, h1',
  },
  {
    id: 'aliyun',
    name: '阿里云开发者社区',
    urlPatterns: [/developer\.aliyun\.com\/article/],
    contentSelectors: [
      '.article-content',
      '.content-main',
      '[class*="article"]',
    ],
    titleSelector: '.article-title, h1',
  },
  {
    id: 'bilibili',
    name: 'B站专栏',
    urlPatterns: [/bilibili\.com\/read\/cv/],
    contentSelectors: [
      '.article-content',
      '.read-article-box',
      '[class*="article"]',
    ],
    titleSelector: '.title, h1',
    special: {
      lazyLoadAttr: 'data-src',
    },
  },
  {
    id: 'medium',
    name: 'Medium',
    urlPatterns: [/medium\.com\//],
    contentSelectors: [
      'article',
      '.postArticle-content',
      '[class*="post-content"]',
    ],
    titleSelector: 'h1',
  },
];

/**
 * 根据 URL 匹配平台规则
 */
export function matchPlatformRule(url: string): PlatformRule | null {
  for (const rule of platformRules) {
    for (const pattern of rule.urlPatterns) {
      if (pattern.test(url)) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * 根据平台 ID 获取规则
 */
export function getPlatformRule(platformId: string): PlatformRule | null {
  return platformRules.find(r => r.id === platformId) || null;
}
