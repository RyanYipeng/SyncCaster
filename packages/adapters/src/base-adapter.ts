/**
 * 统一适配器基类
 * 参考 Wechatsync 的 BaseAdapter 设计
 */
import type {
  PlatformId,
  CanonicalPost,
  Account,
  AuthSession,
  AssetRef,
  LogEntry,
} from '@synccaster/core';

/**
 * 用户元数据
 */
export interface UserMeta {
  loggedIn: boolean;
  userId?: string;
  username?: string;
  nickname?: string;
  avatar?: string;
  meta?: Record<string, any>;
}

/**
 * 平台载荷（发布内容）
 */
export interface PlatformPayload {
  title: string;
  content?: string;
  contentHtml?: string;
  contentMarkdown?: string;
  contentCss?: string;
  cover?: AssetRef;
  tags?: string[];
  categories?: string[];
  summary?: string;
  canonicalUrl?: string;
  author?: string;
  meta?: Record<string, any>;
}

/**
 * 发布结果
 */
export interface PublishResult {
  success: boolean;
  url?: string;
  remoteId?: string;
  draftId?: string;
  editUrl?: string;
  error?: string;
  meta?: Record<string, any>;
}

/**
 * 发布进度
 */
export interface PublishProgress {
  stage: PublishStage;
  progress: number; // 0-100
  message: string;
  detail?: string;
}

/**
 * 发布阶段
 */
export type PublishStage =
  | 'init'
  | 'auth'
  | 'transform'
  | 'upload_images'
  | 'create_draft'
  | 'fill_content'
  | 'submit'
  | 'wait_redirect'
  | 'complete'
  | 'error';

/**
 * 发布上下文
 */
export interface PublishContext {
  account: Account;
  auth: AuthSession;
  assets: AssetRef[];
  signal?: AbortSignal;
  onProgress?: (progress: PublishProgress) => void;
  logger: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

/**
 * 平台能力描述
 */
export interface PlatformCapabilities {
  /** 是否支持 API 发布 */
  api?: boolean;
  /** 是否支持 DOM 自动化 */
  domAutomation?: boolean;
  /** 是否支持 Markdown */
  supportsMarkdown?: boolean;
  /** 是否支持 HTML */
  supportsHtml?: boolean;
  /** 是否支持标签 */
  supportsTags?: boolean;
  /** 是否支持分类 */
  supportsCategories?: boolean;
  /** 是否支持封面 */
  supportsCover?: boolean;
  /** 是否支持定时发布 */
  supportsSchedule?: boolean;
  /** 图片上传方式 */
  imageUpload: 'api' | 'dom' | 'paste' | 'none';
  /** 速率限制 */
  rateLimit?: {
    rpm: number;
    concurrent: number;
  };
  /** 是否需要后端服务 */
  requiresBackend?: boolean;
}

/**
 * DOM 自动化配置
 */
export interface DOMAutomation {
  /** URL 匹配规则 */
  matchers: string[];
  /** 动态获取编辑器 URL（支持需要用户ID的平台） */
  getEditorUrl?: (accountId?: string) => string | Promise<string>;
  /** 填充并发布 */
  fillAndPublish: (payload: PlatformPayload, options?: any) => Promise<PublishResult>;
}


/**
 * 适配器基类
 */
export abstract class BaseAdapter {
  abstract id: PlatformId;
  abstract name: string;
  abstract icon?: string;
  abstract capabilities: PlatformCapabilities;

  /**
   * 获取用户元数据（验证登录状态）
   */
  abstract getMetaData(account: Account): Promise<UserMeta>;

  /**
   * 确保认证有效
   */
  abstract ensureAuth(ctx: { account: Account }): Promise<AuthSession>;

  /**
   * 内容预处理（转换为平台格式）
   */
  abstract preEditPost(
    post: CanonicalPost,
    ctx: { config?: any }
  ): Promise<PlatformPayload>;

  /**
   * 发布文章
   */
  abstract publish(
    payload: PlatformPayload,
    ctx: PublishContext
  ): Promise<PublishResult>;

  /**
   * DOM 自动化配置（可选）
   */
  dom?: DOMAutomation;

  /**
   * 上传图片（可选，API 模式）
   */
  async uploadImage?(
    file: File | Blob,
    postId: string,
    ctx: PublishContext
  ): Promise<{ url: string; id?: string }>;

  /**
   * 创建草稿（可选，API 模式）
   */
  async createDraft?(
    payload: PlatformPayload,
    ctx: PublishContext
  ): Promise<{ draftId: string }>;

  /**
   * 更新文章（可选，API 模式）
   */
  async updatePost?(
    postId: string,
    payload: PlatformPayload,
    ctx: PublishContext
  ): Promise<PublishResult>;

  /**
   * 报告进度
   */
  protected reportProgress(
    ctx: PublishContext,
    stage: PublishStage,
    progress: number,
    message: string,
    detail?: string
  ) {
    ctx.onProgress?.({
      stage,
      progress,
      message,
      detail,
    });
    ctx.logger({
      level: 'info',
      step: stage,
      message,
      meta: { progress, detail },
    });
  }

  /**
   * 等待指定时间
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 检查是否被取消
   */
  protected checkAborted(ctx: PublishContext) {
    if (ctx.signal?.aborted) {
      throw new Error('发布已取消');
    }
  }
}

/**
 * 进度阶段权重（用于计算总进度）
 */
export const STAGE_WEIGHTS: Record<PublishStage, { start: number; end: number }> = {
  init: { start: 0, end: 5 },
  auth: { start: 5, end: 10 },
  transform: { start: 10, end: 20 },
  upload_images: { start: 20, end: 50 },
  create_draft: { start: 50, end: 60 },
  fill_content: { start: 60, end: 80 },
  submit: { start: 80, end: 90 },
  wait_redirect: { start: 90, end: 98 },
  complete: { start: 98, end: 100 },
  error: { start: 0, end: 0 },
};

/**
 * 计算总进度
 */
export function calculateProgress(stage: PublishStage, stageProgress: number): number {
  const weight = STAGE_WEIGHTS[stage];
  return weight.start + (weight.end - weight.start) * (stageProgress / 100);
}
