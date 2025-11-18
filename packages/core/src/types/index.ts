/**
 * 平台标识
 */
export type PlatformId =
  | 'wechat'
  | 'zhihu'
  | 'juejin'
  | 'csdn'
  | 'jianshu'
  | 'medium'
  | 'toutiao';

/**
 * 资源引用
 */
export interface AssetRef {
  id: string;
  type: 'image' | 'video' | 'file';
  url: string;
  alt?: string;
  title?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  blobUrl?: string;
  hash?: string;
  variants?: Record<string, string>;
  width?: number;
  height?: number;
}

/**
 * 统一内容模型（SSOT - Single Source of Truth）
 */
export interface CanonicalPost {
  id: string;
  version?: number;
  title: string;
  slug?: string;
  summary?: string;
  cover?: AssetRef;
  tags?: string[];
  categories?: string[];
  canonicalUrl?: string;
  source_url?: string;
  collected_at?: string;
  created_at?: string;
  updated_at?: string;
  createdAt?: number;
  updatedAt?: number;
  body_md: string;
  assets?: AssetRef[];
  meta?: Record<string, any>;
}

/**
 * 发布目标
 */
export interface PublishTarget {
  platform: PlatformId;
  accountId: string;
  config?: Record<string, any>;
}

/**
 * 任务状态
 */
export type JobState = 'PENDING' | 'RUNNING' | 'PAUSED' | 'FAILED' | 'DONE';

/**
 * 日志条目
 */
export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  step: string;
  message: string;
  meta?: Record<string, any>;
  timestamp: number;
}

/**
 * 发布任务
 */
export interface Job {
  id: string;
  postId: string;
  targets: PublishTarget[];
  state: JobState;
  progress: number;
  attempts: number;
  maxAttempts: number;
  logs: LogEntry[];
  createdAt: number;
  updatedAt: number;
  scheduleAt?: number;
  error?: string;
}

/**
 * 平台文章映射
 */
export interface PlatformPostMap {
  id: string;
  postId: string;
  platform: PlatformId;
  accountId: string;
  remoteId?: string;
  url?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'FAILED';
  lastSyncAt?: number;
  lastError?: string;
  meta?: Record<string, any>;
}

/**
 * 账号信息
 */
export interface Account {
  id: string;
  platform: PlatformId;
  nickname: string;
  avatar?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, any>;
}

/**
 * 认证会话
 */
export interface AuthSession {
  type: string;
  valid: boolean;
  expiresAt?: number;
  token?: string;
  meta?: Record<string, any>;
}

/**
 * 密钥存储
 */
export interface Secret {
  id: string;
  accountId: string;
  encrypted: string;
  iv: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 模板配置
 */
export interface Template {
  id: string;
  name: string;
  content: string;
  variables: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 应用配置
 */
export interface AppConfig {
  id: string;
  key: string;
  value: any;
  updatedAt: number;
}
