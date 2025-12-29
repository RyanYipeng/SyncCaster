import type { PlatformId, CanonicalPost, Account, AuthSession, AssetRef, LogEntry } from '@synccaster/core';

/**
 * 适配器类型（发布模式）
 */
export type AdapterKind = 'dom' | 'metaweblog' | 'restApi';

/**
 * 会话状态
 */
export interface SessionStatus {
  loggedIn: boolean;
  username?: string;
  userId?: string;
  needsReauth?: boolean;
  meta?: Record<string, any>;
}

/**
 * 平台能力描述
 */
export interface PlatformCapabilities {
  api?: boolean;
  domAutomation?: boolean;
  supportsMarkdown?: boolean;
  supportsHtml?: boolean;
  supportsTags?: boolean;
  supportsCategories?: boolean;
  supportsCover?: boolean;
  supportsSchedule?: boolean;
  imageUpload: 'api' | 'dom' | 'paste';
  rateLimit?: {
    rpm: number;
    concurrent: number;
  };
  requiresBackend?: boolean;
}

/**
 * 远程资源引用
 */
export interface AssetRemoteRef {
  url?: string;
  remoteId?: string;
  platform: string;
}

/**
 * 平台载体
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
 * 发布上下文
 */
export interface PublishContext {
  account: Account;
  auth: AuthSession;
  assets: AssetRef[];
  signal?: AbortSignal;
  logger: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

/**
 * 发布结果
 */
export interface PublishResult {
  url?: string;
  remoteId?: string;
  draftId?: string;
  editUrl?: string;
  meta?: Record<string, any>;
}

/**
 * DOM 自动化配置
 */
export interface DOMAutomation {
  matchers: string[];
  /** 动态获取编辑器 URL（支持需要用户ID的平台） */
  getEditorUrl?: (accountId?: string) => string | Promise<string>;
  fillAndPublish: (
    payload: PlatformPayload,
    options?: any
  ) => Promise<PublishResult>;
}

/**
 * 平台适配器接口
 */
export interface PlatformAdapter {
  id: PlatformId;
  name: string;
  kind: AdapterKind;
  icon?: string;
  capabilities: PlatformCapabilities;

  /**
   * 检测会话状态（可选）
   */
  detectSession?(): Promise<SessionStatus>;

  /**
   * 确保认证有效
   */
  ensureAuth(ctx: { account: Account }): Promise<AuthSession>;

  /**
   * 内容转换
   */
  transform(
    post: CanonicalPost,
    ctx: { config?: any }
  ): Promise<PlatformPayload>;

  /**
   * 上传资源
   */
  uploadAsset?(
    file: File | Blob,
    meta: { kind: 'image' | 'video' | 'file' },
    ctx: PublishContext
  ): Promise<AssetRemoteRef>;

  /**
   * 创建草稿
   */
  createDraft?(
    payload: PlatformPayload,
    ctx: PublishContext
  ): Promise<PublishResult>;

  /**
   * 发布
   */
  publish(
    payloadOrDraftId: PlatformPayload | string,
    ctx: PublishContext
  ): Promise<PublishResult>;

  /**
   * DOM 自动化
   */
  dom?: DOMAutomation;
}

/**
 * 适配器注册表
 */
export class AdapterRegistry {
  private adapters = new Map<PlatformId, PlatformAdapter>();

  register(adapter: PlatformAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: PlatformId): PlatformAdapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(id: PlatformId): boolean {
    return this.adapters.has(id);
  }
}

export const registry = new AdapterRegistry();

/**
 * 获取适配器
 */
export function getAdapter(id: PlatformId): PlatformAdapter {
  const adapter = registry.get(id);
  if (!adapter) {
    throw new Error(`Adapter for platform "${id}" not found`);
  }
  return adapter;
}
