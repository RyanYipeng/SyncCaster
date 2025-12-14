import Dexie, { Table } from 'dexie';
import type {
  CanonicalPost,
  AssetRef,
  Job,
  PlatformPostMap,
  Account,
  Secret,
  Template,
  AppConfig,
  LogEntry,
} from '../types';

/**
 * SyncCaster 数据库
 */
export class SyncCasterDB extends Dexie {
  posts!: Table<CanonicalPost, string>;
  assets!: Table<AssetRef, string>;
  jobs!: Table<Job, string>;
  platformMaps!: Table<PlatformPostMap, string>;
  accounts!: Table<Account, string>;
  secrets!: Table<Secret, string>;
  templates!: Table<Template, string>;
  config!: Table<AppConfig, string>;
  logs!: Table<LogEntry, string>;

  constructor() {
    super('synccaster');

    this.version(1).stores({
      posts: 'id, updatedAt, createdAt, title',
      assets: 'id, hash, type, createdAt',
      jobs: 'id, postId, state, scheduleAt, createdAt, updatedAt',
      platformMaps: 'id, [postId+platform], postId, platform, accountId, status, lastSyncAt',
      accounts: 'id, platform, enabled, createdAt',
      secrets: 'id, accountId',
      templates: 'id, name, createdAt',
      config: 'id, key',
      logs: 'id, timestamp, level',
    });

    // Version 2: Add account status fields
    this.version(2).stores({
      posts: 'id, updatedAt, createdAt, title',
      assets: 'id, hash, type, createdAt',
      jobs: 'id, postId, state, scheduleAt, createdAt, updatedAt',
      platformMaps: 'id, [postId+platform], postId, platform, accountId, status, lastSyncAt',
      accounts: 'id, platform, enabled, createdAt, status, lastCheckAt',
      secrets: 'id, accountId',
      templates: 'id, name, createdAt',
      config: 'id, key',
      logs: 'id, timestamp, level',
    });
  }
}

// 全局数据库实例
export const db = new SyncCasterDB();

/**
 * 数据访问层辅助函数
 */
export const dbHelpers = {
  /**
   * 获取文章的所有平台映射
   */
  async getPostMappings(postId: string) {
    return db.platformMaps.where('postId').equals(postId).toArray();
  },

  /**
   * 获取平台的所有账号
   */
  async getPlatformAccounts(platform: string) {
    return db.accounts.where('platform').equals(platform).toArray();
  },

  /**
   * 获取启用的账号
   */
  async getEnabledAccounts() {
    return db.accounts.where('enabled').equals(1).toArray();
  },

  /**
   * 获取待执行的任务
   */
  async getPendingJobs() {
    const now = Date.now();
    return db.jobs
      .where('state')
      .equals('PENDING')
      .and((job) => !job.scheduleAt || job.scheduleAt <= now)
      .toArray();
  },

  /**
   * 清理旧日志
   */
  async cleanOldLogs(daysToKeep = 30) {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    await db.logs.where('timestamp').below(cutoff).delete();
  },

  /**
   * 获取任务日志
   */
  async getJobLogs(jobId: string) {
    const job = await db.jobs.get(jobId);
    return job?.logs || [];
  },
};
