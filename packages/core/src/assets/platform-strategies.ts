/**
 * Platform image upload strategies.
 *
 * These configs describe how each platform prefers to receive images.
 */
import type { ImageUploadStrategy, PlatformImageConstraints } from './image-pipeline';

// ========== Common constraints ==========

const DEFAULT_CONSTRAINTS: PlatformImageConstraints = {
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
  maxSizeMB: 5,
};

const WEBP_CONSTRAINTS: PlatformImageConstraints = {
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  maxSizeMB: 10,
};

// ========== Strategies ==========

/**
 * Platform image upload strategy map
 */
export const platformImageStrategies: Record<string, ImageUploadStrategy> = {
  /**
   * Juejin: prefer DOM paste to let the site handle ImageX.
   */
  juejin: {
    mode: 'domPasteUpload',
    constraints: {
      acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/gif'],
      maxSizeMB: 5,
    },
    domPasteConfig: {
      editorUrl: 'https://juejin.cn/editor/drafts/new?v=2',
      // Placeholder selectors; adjust after inspecting the live editor DOM.
      editorSelector:
        ".markdown-body[contenteditable='true'], .bytemd-editor textarea, .CodeMirror textarea, .ql-editor",
      timeoutMs: 30000,
    },
  },

  /**
   * CSDN
   */
  csdn: {
    mode: 'binaryUpload',
    constraints: {
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      maxSizeMB: 5,
    },
    requirePostIdBeforeUpload: false,
    uploadUrl: 'https://imgservice.csdn.net/direct/v1.0/image/upload',
    method: 'POST',
    fileFieldName: 'file',
    extraFields: {
      type: 'blog',
    },
    responseParser: (data) => ({
      url: data.data?.url || data.url,
    }),
  },

  /**
   * Zhihu
   */
  zhihu: {
    mode: 'binaryUpload',
    constraints: WEBP_CONSTRAINTS,
    uploadUrl: 'https://www.zhihu.com/api/v4/images',
    method: 'POST',
    fileFieldName: 'file',
    extraFields: {
      source: 'article',
    },
    csrfToken: {
      type: 'cookie',
      name: '_xsrf',
      headerName: 'x-xsrftoken',
    },
    responseParser: (data) => ({
      url: data.url || data.original_url,
      id: data.id,
    }),
  },

  /**
   * WeChat Official Account
   */
  wechat: {
    mode: 'binaryUpload',
    constraints: {
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      maxSizeMB: 2,
      maxWidth: 1440,
    },
    requirePostIdBeforeUpload: false,
    uploadUrl: 'https://mp.weixin.qq.com/cgi-bin/filetransfer',
    method: 'POST',
    fileFieldName: 'file',
    extraFields: {
      action: 'upload_material',
      f: 'json',
      scene: '1',
      writetype: 'doublewrite',
    },
    responseParser: (data) => ({
      url: data.cdn_url || data.url,
      id: data.media_id,
    }),
  },

  /**
   * Jianshu
   */
  jianshu: {
    // 简书的图片上传依赖站内编辑器环境（token/防盗链等），优先用“站内粘贴/拖拽上传”生成可识别 URL。
    mode: 'domPasteUpload',
    constraints: WEBP_CONSTRAINTS,
    domPasteConfig: {
      editorUrl: 'https://www.jianshu.com/writer',
      editorSelector: '.CodeMirror textarea, .CodeMirror, .kalamu-area, [contenteditable="true"]',
      timeoutMs: 40000,
    },
  },

  /**
   * CNBlogs
   */
  cnblogs: {
    mode: 'binaryUpload',
    constraints: WEBP_CONSTRAINTS,
    uploadUrl: 'https://upload.cnblogs.com/imageuploader/CorsUpload',
    method: 'POST',
    fileFieldName: 'upload',
    responseParser: (data) => ({
      url: data.message || data.url,
    }),
  },

  /**
   * 51CTO
   */
  '51cto': {
    mode: 'binaryUpload',
    constraints: DEFAULT_CONSTRAINTS,
    uploadUrl: 'https://blog.51cto.com/api/upload/image',
    method: 'POST',
    fileFieldName: 'file',
    responseParser: (data) => ({
      url: data.data?.url || data.url,
    }),
  },

  /**
   * Tencent Cloud developer community
   * 
   * 腾讯云开发者社区的图片上传 API 需要登录状态和 CSRF token，
   * 使用 domPasteUpload 模式可以利用用户在页面的登录状态，
   * 通过模拟粘贴的方式上传图片，更加稳定可靠。
   */
  'tencent-cloud': {
    mode: 'domPasteUpload',
    constraints: WEBP_CONSTRAINTS,
    domPasteConfig: {
      editorUrl: 'https://cloud.tencent.com/developer/article/write-new',
      editorSelector: '.CodeMirror textarea, .CodeMirror, textarea, [contenteditable="true"]',
      timeoutMs: 40000,
    },
  },

  /**
   * Aliyun developer community
   */
  aliyun: {
    // 阿里云不接受大多数外链图（例如 CSDN 图床防盗链），优先使用站内“粘贴上传”让平台生成可用 URL
    mode: 'domPasteUpload',
    constraints: WEBP_CONSTRAINTS,
    domPasteConfig: {
      editorUrl: 'https://developer.aliyun.com/article/new#/',
      // 兼容：mditor/CodeMirror/Bytemd 等实现（textarea 或 contenteditable）
      editorSelector:
        '.mditor textarea, .mditor .CodeMirror textarea, .bytemd-editor textarea, .CodeMirror textarea, [contenteditable="true"]',
      timeoutMs: 40000,
    },
  },

  /**
   * SegmentFault
   */
  segmentfault: {
    mode: 'binaryUpload',
    constraints: DEFAULT_CONSTRAINTS,
    uploadUrl: 'https://segmentfault.com/api/image',
    method: 'POST',
    fileFieldName: 'file',
    responseParser: (data) => ({
      url: data.data?.url || data.url,
    }),
  },

  /**
   * Bilibili columns
   */
  bilibili: {
    // 专栏编辑器为 Quill 富文本，外链图片经常无法展示；使用“站内粘贴上传”生成 B 站可用 URL。
    mode: 'domPasteUpload',
    constraints: WEBP_CONSTRAINTS,
    domPasteConfig: {
      editorUrl: 'https://member.bilibili.com/platform/upload/text/edit',
      editorSelector: '.ql-editor, .ProseMirror, [contenteditable="true"]',
      timeoutMs: 40000,
    },
  },

  /**
   * OSChina
   */
  oschina: {
    mode: 'binaryUpload',
    constraints: DEFAULT_CONSTRAINTS,
    uploadUrl: 'https://my.oschina.net/action/ajax/upload_img',
    method: 'POST',
    fileFieldName: 'upload',
    responseParser: (data) => ({
      url: data.url || data.imgUrl,
    }),
  },
};

// ========== Helpers ==========

/**
 * Get platform image upload strategy.
 */
export function getImageStrategy(platformId: string): ImageUploadStrategy | null {
  return platformImageStrategies[platformId] || null;
}

/**
 * Whether the platform supports image upload.
 */
export function supportsImageUpload(platformId: string): boolean {
  const strategy = platformImageStrategies[platformId];
  return strategy !== undefined && strategy.mode !== 'externalUrlOnly';
}

/**
 * Get platform image limits.
 */
export function getImageLimits(platformId: string): PlatformImageConstraints | null {
  const strategy = platformImageStrategies[platformId];
  if (!strategy) return null;
  return strategy.constraints || DEFAULT_CONSTRAINTS;
}

/**
 * Check image compatibility for a platform.
 */
export function checkImageCompatibility(
  mimeType: string,
  sizeBytes: number,
  platformId: string,
): { compatible: boolean; reason?: string } {
  const constraints = getImageLimits(platformId);
  if (!constraints) {
    return { compatible: true };
  }

  // Format check
  if (!constraints.acceptedMimeTypes.includes(mimeType)) {
    return {
      compatible: false,
      reason: `格式 ${mimeType} 不被 ${platformId} 支持，需要转换为 ${constraints.acceptedMimeTypes.join('/')}`,
    };
  }

  // Size check
  if (constraints.maxSizeMB) {
    const sizeMB = sizeBytes / (1024 * 1024);
    if (sizeMB > constraints.maxSizeMB) {
      return {
        compatible: false,
        reason: `文件大小 ${sizeMB.toFixed(2)}MB 超过 ${platformId} 限制：${constraints.maxSizeMB}MB`,
      };
    }
  }

  return { compatible: true };
}
