/// <reference types="chrome" />
/**
 * SyncCaster Adapter
 * 用于 md-editor 与 SyncCaster 扩展的集成
 * 
 * @module utils/synccaster-adapter
 */

/**
 * 存储在 Chrome Storage 中的文章数据结构
 * 与 packages/core/src/storage/chrome-storage-bridge.ts 中的定义保持一致
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

/** Chrome Storage Key - 与 ChromeStorageBridge 保持一致 */
const STORAGE_KEY = 'synccaster_current_article';

/**
 * SyncCaster 适配器
 * 用于 md-editor 与 SyncCaster 扩展的集成
 */
export class SyncCasterAdapter {
  /**
   * 检测是否在 SyncCaster 扩展环境中运行
   * 通过检查 URL 参数和 Chrome Storage API 可用性来判断
   */
  static isInExtension(): boolean {
    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const fromSyncCaster = urlParams.get('from') === 'synccaster';
    
    // 检查 Chrome Storage API 是否可用
    const hasChromeStorage = typeof chrome !== 'undefined' && 
                             typeof chrome.storage !== 'undefined' && 
                             typeof chrome.storage.local !== 'undefined';
    
    // 检查是否在 Chrome 扩展页面中（chrome-extension:// 协议）
    const isExtensionProtocol = window.location.protocol === 'chrome-extension:';
    
    return (fromSyncCaster || isExtensionProtocol) && hasChromeStorage;
  }

  /**
   * 从 Chrome Storage 加载文章内容
   * @returns 文章标题和内容，如果不存在则返回 null
   */
  static async loadFromExtension(): Promise<{ title: string; content: string } | null> {
    if (!this.isInExtension()) {
      console.warn('[SyncCasterAdapter] Not in extension environment');
      return null;
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[SyncCasterAdapter] Load error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const article = result[STORAGE_KEY] as SyncCasterArticle | undefined;
        if (article) {
          resolve({
            title: article.title,
            content: article.content,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * 保存内容到 Chrome Storage
   * @param title - 文章标题
   * @param content - Markdown 内容
   */
  static async saveToExtension(title: string, content: string): Promise<void> {
    if (!this.isInExtension()) {
      console.warn('[SyncCasterAdapter] Not in extension environment, skip saving');
      return;
    }

    return new Promise((resolve, reject) => {
      // 先读取现有数据以保留 id 和 sourceUrl
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[SyncCasterAdapter] Read error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const existingArticle = result[STORAGE_KEY] as SyncCasterArticle | undefined;
        
        const article: SyncCasterArticle = {
          id: existingArticle?.id || 'md-editor-temp',
          title,
          content,
          sourceUrl: existingArticle?.sourceUrl,
          updatedAt: Date.now(),
        };

        chrome.storage.local.set({ [STORAGE_KEY]: article }, () => {
          if (chrome.runtime.lastError) {
            console.error('[SyncCasterAdapter] Save error:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * 返回 SyncCaster 编辑器
   * 关闭当前标签页或导航回扩展的 options 页面
   */
  static navigateBack(): void {
    if (!this.isInExtension()) {
      console.warn('[SyncCasterAdapter] Not in extension environment');
      return;
    }

    // 尝试获取扩展的 options 页面 URL
    const extensionId = chrome.runtime?.id;
    if (extensionId) {
      // 导航到扩展的 options 页面（正确路径是 src/ui/options/index.html）
      const optionsUrl = `chrome-extension://${extensionId}/src/ui/options/index.html#/editor`;
      
      // 尝试关闭当前标签页并打开 options 页面
      // 如果无法关闭（例如这是唯一的标签页），则直接导航
      if (typeof chrome.tabs !== 'undefined' && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent((tab) => {
          if (tab?.id) {
            // 先打开 options 页面，然后关闭当前标签页
            chrome.tabs.create({ url: optionsUrl }, () => {
              chrome.tabs.remove(tab.id!);
            });
          } else {
            // 无法获取当前标签页，直接导航
            window.location.href = optionsUrl;
          }
        });
      } else {
        // tabs API 不可用，直接导航
        window.location.href = optionsUrl;
      }
    } else {
      // 无法获取扩展 ID，尝试关闭窗口
      window.close();
    }
  }

  /**
   * 监听文章变化
   * @param callback - 当文章数据变化时调用的回调函数
   * @returns 取消监听的函数
   */
  static onArticleChange(
    callback: (article: { title: string; content: string } | null) => void
  ): () => void {
    if (!this.isInExtension()) {
      return () => {};
    }

    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && STORAGE_KEY in changes) {
        const change = changes[STORAGE_KEY];
        const newValue = change.newValue as SyncCasterArticle | undefined;
        if (newValue) {
          callback({
            title: newValue.title,
            content: newValue.content,
          });
        } else {
          callback(null);
        }
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }
}
