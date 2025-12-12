/// <reference types="chrome" />
/**
 * Chrome Storage Bridge Module
 * 用于在扩展的不同页面间传递文章数据
 * 
 * @module storage/chrome-storage-bridge
 */

/**
 * 存储在 Chrome Storage 中的文章数据结构
 */
export interface SyncCasterArticle {
  /** 文章唯一标识符 */
  id: string;
  /** 文章标题 */
  title: string;
  /** Markdown 格式的文章内容 */
  content: string;
  /** 文章采集来源 URL（可选） */
  sourceUrl?: string;
  /** 最后更新时间戳（毫秒） */
  updatedAt: number;
}

/** Chrome Storage Key */
const STORAGE_KEY = 'synccaster_current_article';

/**
 * 检测是否在 Chrome 扩展环境中
 */
function isChromeExtension(): boolean {
  return typeof chrome !== 'undefined' && 
         typeof chrome.storage !== 'undefined' && 
         typeof chrome.storage.local !== 'undefined';
}

/**
 * Chrome Storage 桥接类
 * 用于在扩展的不同页面间传递文章数据
 */
export class ChromeStorageBridge {
  private static readonly STORAGE_KEY = STORAGE_KEY;

  /**
   * 保存文章到 Chrome Storage
   * @param article - 要保存的文章数据
   * @throws Error 如果不在 Chrome 扩展环境中
   */
  static async saveArticle(article: SyncCasterArticle): Promise<void> {
    if (!isChromeExtension()) {
      throw new Error('Chrome Storage API is not available');
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(
        { [ChromeStorageBridge.STORAGE_KEY]: article },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * 从 Chrome Storage 读取文章
   * @returns 存储的文章数据，如果不存在则返回 null
   * @throws Error 如果不在 Chrome 扩展环境中
   */
  static async loadArticle(): Promise<SyncCasterArticle | null> {
    if (!isChromeExtension()) {
      throw new Error('Chrome Storage API is not available');
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get([ChromeStorageBridge.STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          const article = result[ChromeStorageBridge.STORAGE_KEY] as SyncCasterArticle | undefined;
          resolve(article ?? null);
        }
      });
    });
  }

  /**
   * 清除存储的文章
   * @throws Error 如果不在 Chrome 扩展环境中
   */
  static async clearArticle(): Promise<void> {
    if (!isChromeExtension()) {
      throw new Error('Chrome Storage API is not available');
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([ChromeStorageBridge.STORAGE_KEY], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 监听文章变化
   * @param callback - 当文章数据变化时调用的回调函数
   * @returns 取消监听的函数
   * @throws Error 如果不在 Chrome 扩展环境中
   */
  static onArticleChange(
    callback: (article: SyncCasterArticle | null) => void
  ): () => void {
    if (!isChromeExtension()) {
      throw new Error('Chrome Storage API is not available');
    }

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && ChromeStorageBridge.STORAGE_KEY in changes) {
        const change = changes[ChromeStorageBridge.STORAGE_KEY];
        const newValue = change.newValue as SyncCasterArticle | undefined;
        callback(newValue ?? null);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    // 返回取消监听的函数
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  /**
   * 获取存储键名（用于测试和调试）
   */
  static getStorageKey(): string {
    return ChromeStorageBridge.STORAGE_KEY;
  }
}
