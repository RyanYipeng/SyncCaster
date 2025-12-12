/**
 * 平台标识
 */
export type PlatformId =
  | 'wechat'      // 微信公众号
  | 'zhihu'       // 知乎
  | 'juejin'      // 掘金
  | 'csdn'        // CSDN
  | 'jianshu'     // 简书
  | 'cnblogs'     // 博客园
  | 'oschina'     // 开源中国
  | '51cto'       // 51CTO
  | 'tencent-cloud' // 腾讯云开发者社区
  | 'aliyun'      // 阿里云开发者社区
  | 'segmentfault' // 思否
  | 'bilibili'    // 哔哩哔哩
  | 'medium'      // Medium（国际）
  | 'toutiao';    // 头条号

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
 * 内联公式节点
 */
export interface InlineMathNode {
  type: 'inlineMath';
  latex: string;
  originalFormat?: string; // 原始格式，如 "$...$" 或 "\\(...\\)"
}

/**
 * 块级公式节点
 */
export interface BlockMathNode {
  type: 'blockMath';
  latex: string;
  originalFormat?: string; // 原始格式，如 "$$...$$" 或 "\\[...\\]"
}

/**
 * 图片节点（语义化）
 */
export interface ImageNode {
  type: 'image';
  assetId?: string; // 对应 assets 数组中的 id
  url: string;
  alt?: string;
  title?: string;
}

/**
 * 代码块节点
 */
export interface CodeBlockNode {
  type: 'codeBlock';
  language: string;
  code: string;
}

/**
 * 内容块节点（段落/标题等）
 */
export interface ContentBlockNode {
  type: 'paragraph' | 'heading' | 'list' | 'blockquote' | 'table';
  level?: number; // for heading
  content: string | (InlineMathNode | ImageNode | string)[]; // 支持混合内容
  meta?: Record<string, any>;
}

/**
 * AST 节点类型联合
 */
export type ASTNode = InlineMathNode | BlockMathNode | ImageNode | CodeBlockNode | ContentBlockNode;

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
  
  // 原始 Markdown（向后兼容）
  body_md: string;
  
  // 微信公众号专用 HTML（懒加载，按需生成）
  body_wechat_html?: string;
  
  // 语义化 AST（可选，逐步迁移）
  ast?: ASTNode[];
  
  // 公式提取（便于平台差异处理）
  formulas?: (InlineMathNode | BlockMathNode)[];
  
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

// 导出其他模块
export * from './platforms';
export * from './adapter';
export * from './ast';
