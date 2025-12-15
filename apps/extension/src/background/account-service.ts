/**
 * 账号服务 - 重构版
 * 
 * 核心改进：
 * 1. 登录检测在 content script 中执行（目标网站页面上下文）
 * 2. background 只负责协调流程，不直接检测登录
 * 3. 通过消息机制获取登录状态
 * 4. 支持直接 API 调用快速刷新（无需打开标签页）
 */
import { db, type Account, AccountStatus } from '@synccaster/core';
import { Logger } from '@synccaster/utils';
import { fetchPlatformUserInfo, fetchMultiplePlatformUserInfo, supportDirectApi, type UserInfo, AuthErrorType } from './platform-api';

const logger = new Logger('account-service');

/**
 * 平台用户信息接口
 */
export interface PlatformUserInfo {
  userId: string;
  nickname: string;
  avatar?: string;
  platform: string;
}

/**
 * 登录状态接口（来自 content script）
 */
export interface LoginState {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatar?: string;
  platform?: string;
  error?: string;
  meta?: {
    level?: number;
    followersCount?: number;
    articlesCount?: number;
    viewsCount?: number;
  };
}

/**
 * 平台配置
 */
interface PlatformConfig {
  id: string;
  name: string;
  loginUrl: string;
  homeUrl: string;  // 登录后的主页，用于检测登录状态
  urlPattern: RegExp;
}

/**
 * 平台配置表
 */
const PLATFORMS: Record<string, PlatformConfig> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    loginUrl: 'https://juejin.cn/login',
    homeUrl: 'https://juejin.cn/',
    urlPattern: /juejin\.cn/,
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    loginUrl: 'https://passport.csdn.net/login',
    // 使用“个人中心”页面便于稳定提取昵称/头像（首页多为公共内容）
    homeUrl: 'https://i.csdn.net/#/user-center/profile',
    urlPattern: /csdn\.net/,
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    homeUrl: 'https://www.zhihu.com/',
    urlPattern: /zhihu\.com/,
  },
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    loginUrl: 'https://mp.weixin.qq.com/',
    homeUrl: 'https://mp.weixin.qq.com/',
    urlPattern: /mp\.weixin\.qq\.com/,
  },
  jianshu: {
    id: 'jianshu',
    name: '简书',
    loginUrl: 'https://www.jianshu.com/sign_in',
    homeUrl: 'https://www.jianshu.com/',
    urlPattern: /jianshu\.com/,
  },
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    loginUrl: 'https://account.cnblogs.com/signin',
    homeUrl: 'https://www.cnblogs.com/',
    urlPattern: /cnblogs\.com/,
  },
  '51cto': {
    id: '51cto',
    name: '51CTO',
    loginUrl: 'https://home.51cto.com/index',
    homeUrl: 'https://home.51cto.com/',
    urlPattern: /51cto\.com/,
  },
  'tencent-cloud': {
    id: 'tencent-cloud',
    name: '腾讯云开发者社区',
    loginUrl: 'https://cloud.tencent.com/login',
    // /developer/user 会在登录后进入个人主页（更容易提取昵称/头像）
    homeUrl: 'https://cloud.tencent.com/developer/user',
    urlPattern: /cloud\.tencent\.com/,
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里云开发者社区',
    // 直接使用开发者社区主页，页面会自动显示登录入口
    // 原登录页面 /user/login 已失效
    loginUrl: 'https://developer.aliyun.com/',
    homeUrl: 'https://developer.aliyun.com/',
    // 只匹配开发者社区域名，避免在 www.aliyun.com 上检测
    urlPattern: /developer\.aliyun\.com/,
  },
  segmentfault: {
    id: 'segmentfault',
    name: '思否',
    loginUrl: 'https://segmentfault.com/user/login',
    homeUrl: 'https://segmentfault.com/',
    urlPattern: /segmentfault\.com/,
  },
  bilibili: {
    id: 'bilibili',
    name: 'B站专栏',
    loginUrl: 'https://passport.bilibili.com/login',
    homeUrl: 'https://www.bilibili.com/',
    urlPattern: /bilibili\.com/,
  },
  oschina: {
    id: 'oschina',
    name: '开源中国',
    loginUrl: 'https://www.oschina.net/home/login',
    homeUrl: 'https://www.oschina.net/',
    urlPattern: /oschina\.net/,
  },
};

/**
 * 平台名称映射
 */
const PLATFORM_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(PLATFORMS).map(p => [p.id, p.name])
);


/**
 * 确保 content script 已注入到标签页
 */
async function ensureContentScriptInjected(tabId: number): Promise<void> {
  try {
    // 先尝试发送 PING 消息检查 content script 是否已存在
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Content script not ready'));
        } else if (response?.pong) {
          resolve();
        } else {
          reject(new Error('Invalid response'));
        }
      });
    });
    logger.info('inject', 'Content script already exists');
  } catch {
    // Content script 不存在，需要注入
    logger.info('inject', 'Injecting content script...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts.js'],
      });
      // 等待 content script 初始化
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info('inject', 'Content script injected successfully');
    } catch (e: any) {
      logger.error('inject', 'Failed to inject content script', { error: e.message });
      throw new Error(`无法注入脚本: ${e.message}`);
    }
  }
}

/**
 * 向指定标签页发送消息并等待响应
 */
async function sendMessageToTab(tabId: number, message: any, timeout = 25000): Promise<any> {
  // 先确保 content script 已注入
  await ensureContentScriptInjected(tabId);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('消息响应超时'));
    }, timeout);
    
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * 等待标签页加载完成
 */
async function waitForTabLoad(tabId: number, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('页面加载超时'));
    }, timeout);
    
    const checkStatus = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          clearTimeout(timer);
          // 额外等待一下让页面渲染
          setTimeout(resolve, 500);
        } else {
          setTimeout(checkStatus, 500);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(new Error('标签页已关闭'));
      }
    };
    
    checkStatus();
  });
}

/**
 * 在指定标签页检测登录状态
 */
async function checkLoginInTab(tabId: number): Promise<LoginState> {
  try {
    // 等待页面加载
    await waitForTabLoad(tabId);
    
    // 发送检测请求到 content script
    const result = await sendMessageToTab(tabId, { type: 'CHECK_LOGIN' });
    logger.info('check-login', '收到登录检测结果', result);
    return result;
  } catch (error: any) {
    logger.error('check-login', '登录检测失败', { error: error.message });
    return { loggedIn: false, error: error.message };
  }
}

/**
 * 查找指定平台的已打开标签页
 */
async function findPlatformTab(platform: string): Promise<chrome.tabs.Tab | null> {
  const config = PLATFORMS[platform];
  if (!config) return null;
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && config.urlPattern.test(tab.url)) {
      return tab;
    }
  }
  return null;
}

const PROFILE_ENRICH_PLATFORMS = new Set(['wechat', 'tencent-cloud', 'jianshu', 'csdn', '51cto']);
const GENERIC_NICKNAMES: Record<string, string[]> = {
  wechat: ['微信公众号'],
  'tencent-cloud': ['腾讯云用户'],
  jianshu: ['简书用户'],
  csdn: ['CSDN用户'],
  '51cto': ['51CTO用户'],
};

function isGenericNickname(platform: string, nickname?: string): boolean {
  if (!nickname) return true;
  const trimmed = nickname.trim();
  if (!trimmed) return true;
  const candidates = GENERIC_NICKNAMES[platform];
  if (candidates?.includes(trimmed)) return true;
  const platformName = PLATFORM_NAMES[platform] || platform;
  return trimmed === `${platformName}用户`;
}

function pickBetterNickname(platform: string, previous: string, next?: string): string {
  const nextTrimmed = next?.trim();
  if (!nextTrimmed) return previous;
  if (isGenericNickname(platform, nextTrimmed) && !isGenericNickname(platform, previous)) return previous;
  return nextTrimmed;
}

function isValidAvatarUrl(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'deleted') return false;
  if (lower === 'about:blank') return false;
  return true;
}

function pickBetterAvatar(previous?: string, next?: string): string | undefined {
  if (isValidAvatarUrl(next)) return next!.trim();
  return isValidAvatarUrl(previous) ? previous!.trim() : undefined;
}

function extractUserIdFromAccountId(account: Account): string | undefined {
  const id = account.id;
  const platform = account.platform;
  if (typeof id !== 'string' || typeof platform !== 'string') return undefined;

  const underscorePrefix = `${platform}_`;
  if (id.startsWith(underscorePrefix)) return id.slice(underscorePrefix.length);
  const hyphenPrefix = `${platform}-`;
  if (id.startsWith(hyphenPrefix)) return id.slice(hyphenPrefix.length);

  // 兜底：兼容旧格式 / 平台名包含连字符的情况
  const underscoreIndex = id.indexOf('_');
  if (underscoreIndex > 0) {
    const prefix = id.substring(0, underscoreIndex);
    if (prefix === platform) return id.substring(underscoreIndex + 1);
  }
  const parts = id.split('-');
  if (parts.length > 1) {
    if (platform === 'tencent-cloud' && parts.length > 2) {
      return parts.slice(2).join('-');
    }
    return parts.slice(1).join('-');
  }
  return undefined;
}


/**
 * 账号服务
 */
export class AccountService {
  // 存储登录成功的回调
  private static loginCallbacks: Map<string, (state: LoginState) => void> = new Map();

  private static shouldEnrichProfile(account: Account): boolean {
    const platform = account.platform;
    if (!PROFILE_ENRICH_PLATFORMS.has(platform)) return false;

    const profileId = (account.meta as any)?.profileId as string | undefined;
    const needsProfileId =
      platform === 'jianshu' &&
      (!profileId || profileId === 'undefined' || profileId.startsWith('jianshu_') || /^\d+$/.test(profileId));

    const needsNickname = isGenericNickname(platform, account.nickname);
    const needsAvatar = !account.avatar;

    return needsProfileId || needsNickname || needsAvatar;
  }

  private static getProfileEnrichUrl(account: Account): string {
    const config = PLATFORMS[account.platform];
    if (!config) return '';

    if (account.platform === '51cto') {
      const uid = String((account.meta as any)?.profileId || extractUserIdFromAccountId(account) || '').trim();
      if (uid && /^\d+$/.test(uid)) {
        return `https://home.51cto.com/space?uid=${uid}`;
      }
      return config.homeUrl;
    }

    if (account.platform === 'jianshu') {
      const slug = String((account.meta as any)?.profileId || extractUserIdFromAccountId(account) || '').trim();
      if (slug && !/^\d+$/.test(slug) && !slug.startsWith('jianshu_')) {
        return `https://www.jianshu.com/u/${slug}`;
      }
      return config.homeUrl;
    }

    return config.homeUrl;
  }

  private static async tryEnrichAccountProfileViaTab(account: Account): Promise<Account | null> {
    const url = this.getProfileEnrichUrl(account);
    if (!url) return null;

    let tab: chrome.tabs.Tab | null = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      if (!tab.id) return null;
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const state = await checkLoginInTab(tab.id);
      if (!state.loggedIn) return null;

      const now = Date.now();
      const enriched: Account = {
        ...account,
        nickname: pickBetterNickname(account.platform, account.nickname, state.nickname),
        avatar: pickBetterAvatar(account.avatar, state.avatar),
        updatedAt: now,
        meta: {
          ...(account.meta || {}),
          ...(state.meta || {}),
          ...(state.userId ? { profileId: state.userId } : {}),
        },
      };

      await db.accounts.put(enriched);
      logger.info('enrich', '账号资料已补全', { platform: account.platform, nickname: enriched.nickname });
      return enriched;
    } catch (e: any) {
      logger.warn('enrich', '补全账号资料失败', { platform: account.platform, error: e?.message || String(e) });
      return null;
    } finally {
      if (tab?.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }

  private static async maybeEnrichAccountProfile(account: Account): Promise<Account> {
    if (!this.shouldEnrichProfile(account)) return account;
    const enriched = await this.tryEnrichAccountProfileViaTab(account);
    return enriched || account;
  }
  
  /**
   * 初始化：监听来自 content script 的登录成功消息
   */
  static init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'LOGIN_SUCCESS') {
        logger.info('login-success', '收到登录成功通知', message.data);
        const state = message.data as LoginState;
        
        // 触发回调
        if (state.platform) {
          const callback = this.loginCallbacks.get(state.platform);
          if (callback) {
            callback(state);
            this.loginCallbacks.delete(state.platform);
          }
        }
        
        sendResponse({ received: true });
      }
      
      if (message.type === 'LOGIN_STATE_REPORT') {
        logger.info('login-report', '收到登录状态报告', message.data);
        // 可以用于更新 UI 或缓存登录状态
        sendResponse({ received: true });
      }
    });
    
    logger.info('init', '账号服务已初始化');
  }
  
  /**
   * 快速添加账号（用户已登录）
   * 
   * 流程：
   * 1. 查找当前是否有该平台的标签页
   * 2. 如果有，向该标签页发送检测请求
   * 3. 如果没有，打开平台主页并检测
   * 4. 检测成功则保存账号
   */
  static async quickAddAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const config = PLATFORMS[platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('quick-add', `快速添加账号: ${platformName}`);
    
    // 1. 查找已打开的平台标签页
    let tab = await findPlatformTab(platform);
    let needCloseTab = false;
    
    // 2. 如果没有，打开平台主页
    if (!tab) {
      logger.info('quick-add', `未找到 ${platformName} 标签页，打开主页`);
      tab = await chrome.tabs.create({ url: config.homeUrl, active: false });
      needCloseTab = true;
      
      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    if (!tab.id) {
      throw new Error('无法创建标签页');
    }
    
    try {
      // 3. 在标签页中检测登录状态
      logger.info('quick-add', `在标签页 ${tab.id} 中检测登录状态`);
      const state = await checkLoginInTab(tab.id);
      
      if (!state.loggedIn) {
        throw new Error(`请先在浏览器中登录 ${platformName}，然后重试`);
      }
      
      // 4. 保存账号
      const account = await this.saveAccount(platform, {
        userId: state.userId || `${platform}_${Date.now()}`,
        nickname: state.nickname || platformName + '用户',
        avatar: state.avatar,
        platform,
      }, state.meta);
      
      logger.info('quick-add', '账号添加成功', { nickname: account.nickname });
      
      return await this.maybeEnrichAccountProfile(account);
    } finally {
      // 如果是我们创建的标签页，关闭它
      if (needCloseTab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }
  
  /**
   * 引导登录添加账号
   * 
   * 流程：
   * 1. 打开平台登录页面
   * 2. 在该页面启动登录状态轮询
   * 3. 登录成功后，content script 通知 background
   * 4. 保存账号并关闭登录页面
   */
  static async addAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const config = PLATFORMS[platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('add-account', `引导登录: ${platformName}`);
    
    // 先检查是否已经登录
    const existingTab = await findPlatformTab(platform);
    if (existingTab?.id) {
      const state = await checkLoginInTab(existingTab.id);
      if (state.loggedIn) {
        logger.info('add-account', '检测到已登录，直接保存账号');
        const account = await this.saveAccount(platform, {
          userId: state.userId || `${platform}_${Date.now()}`,
          nickname: state.nickname || platformName + '用户',
          avatar: state.avatar,
          platform,
        }, state.meta);
        return await this.maybeEnrichAccountProfile(account);
      }
    }
    
    // 打开登录页面
    logger.info('add-account', `打开登录页面: ${config.loginUrl}`);
    const tab = await chrome.tabs.create({ url: config.loginUrl });
    
    if (!tab.id) {
      throw new Error('无法打开登录页面');
    }
    
    // 等待页面加载
    await waitForTabLoad(tab.id);
    
    // 创建 Promise 等待登录成功
    return new Promise<Account>((resolve, reject) => {
      const tabId = tab.id!;
      let pollingStopped = false;
      let attempts = 0;
      const maxAttempts = 180; // 3分钟
      
      // 设置登录成功回调
      this.loginCallbacks.set(platform, async (state) => {
        pollingStopped = true;
        logger.info('add-account', '登录成功回调触发', state);
        
        try {
          const account = await this.saveAccount(platform, {
            userId: state.userId || `${platform}_${Date.now()}`,
            nickname: state.nickname || platformName + '用户',
            avatar: state.avatar,
            platform,
          }, state.meta);
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}

          const enriched = await this.maybeEnrichAccountProfile(account);
          resolve(enriched);
        } catch (e: any) {
          reject(e);
        }
      });
      
      // 启动轮询检测
      const poll = async () => {
        if (pollingStopped) return;
        
        attempts++;
        logger.info('add-account', `轮询检测 ${attempts}/${maxAttempts}`);
        
        // 检查标签页是否还存在
        try {
          await chrome.tabs.get(tabId);
        } catch {
          pollingStopped = true;
          this.loginCallbacks.delete(platform);
          reject(new Error('登录窗口已关闭，请重试'));
          return;
        }
        
        // 检测登录状态
        try {
          const state = await checkLoginInTab(tabId);
          
          if (state.loggedIn) {
            pollingStopped = true;
            this.loginCallbacks.delete(platform);
            
            const account = await this.saveAccount(platform, {
              userId: state.userId || `${platform}_${Date.now()}`,
              nickname: state.nickname || platformName + '用户',
              avatar: state.avatar,
              platform,
            }, state.meta);
            
            // 关闭登录标签页
            try {
              await chrome.tabs.remove(tabId);
            } catch {}

            const enriched = await this.maybeEnrichAccountProfile(account);
            resolve(enriched);
            return;
          }
        } catch (e: any) {
          logger.warn('add-account', '检测失败', { error: e.message });
        }
        
        // 继续轮询
        if (attempts < maxAttempts && !pollingStopped) {
          setTimeout(poll, 2000);
        } else if (!pollingStopped) {
          pollingStopped = true;
          this.loginCallbacks.delete(platform);
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}
          
          reject(new Error('登录超时（3分钟），请重试'));
        }
      };
      
      // 开始轮询
      setTimeout(poll, 3000); // 等待页面加载后开始
    });
  }
  
  /**
   * 保存账号到数据库
   * 
   * 新账号默认设置为 ACTIVE 状态，并记录 lastCheckAt 时间戳，
   * 以便保护期逻辑能够正确识别刚添加的账号。
   */
  private static async saveAccount(platform: string, userInfo: PlatformUserInfo, meta?: LoginState['meta']): Promise<Account> {
    const now = Date.now();
    const account: Account = {
      id: `${platform}-${userInfo.userId}`,
      platform: platform as any,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      meta: meta || {},
      // 新账号默认为 ACTIVE 状态，启用保护期机制
      status: AccountStatus.ACTIVE,
      lastCheckAt: now,
      consecutiveFailures: 0,
    };

    await db.accounts.put(account);
    logger.info('save-account', '账号已保存', { platform, nickname: account.nickname, status: account.status });
    return account;
  }
  
  /**
   * 检查账号认证状态
   */
  static async checkAccountAuth(account: Account): Promise<boolean> {
    const tab = await findPlatformTab(account.platform);
    if (!tab?.id) {
      return false;
    }
    
    const state = await checkLoginInTab(tab.id);
    return state.loggedIn;
  }
  
  /**
   * 更新账号状态
   * 
   * 更新账号的状态、最后检测时间、错误信息和连续失败次数。
   * 
   * Requirements: 5.1, 5.4
   * 
   * @param accountId - 账号 ID
   * @param status - 新状态
   * @param options - 可选参数
   * @param options.error - 错误信息（失败时设置）
   * @param options.resetFailures - 是否重置连续失败次数（成功时为 true）
   * @param options.incrementFailures - 是否增加连续失败次数（失败时为 true）
   */
  static async updateAccountStatus(
    accountId: string,
    status: AccountStatus,
    options: {
      error?: string;
      resetFailures?: boolean;
      incrementFailures?: boolean;
    } = {}
  ): Promise<void> {
    const account = await db.accounts.get(accountId);
    if (!account) {
      logger.warn('update-status', `账号不存在: ${accountId}`);
      return;
    }
    
    const now = Date.now();
    const updates: Partial<Account> = {
      status,
      lastCheckAt: now,
      updatedAt: now,
    };
    
    // 处理错误信息
    if (options.error !== undefined) {
      updates.lastError = options.error;
    } else if (status === AccountStatus.ACTIVE) {
      // 成功时清除错误信息
      updates.lastError = undefined;
    }
    
    // 处理连续失败次数
    if (options.resetFailures) {
      updates.consecutiveFailures = 0;
    } else if (options.incrementFailures) {
      updates.consecutiveFailures = (account.consecutiveFailures || 0) + 1;
    }
    
    await db.accounts.update(accountId, updates);
    logger.info('update-status', `账号状态已更新: ${accountId}`, { 
      status, 
      consecutiveFailures: updates.consecutiveFailures 
    });
  }
  
  /**
   * 刷新账号信息（优先使用直接 API 调用）
   * 
   * 根据检测结果更新账号状态：
   * - 成功：状态设为 ACTIVE，重置连续失败次数
   * - 可重试错误：状态设为 ERROR，增加连续失败次数
   * - 明确登出：状态设为 EXPIRED
   * 
   * 新登录保护机制：
   * - 如果账号在 5 分钟内刚登录成功（createdAt 或 lastCheckAt），且当前状态为 ACTIVE
   * - 遇到可重试错误时，保持 ACTIVE 状态，不立即标记为 ERROR
   * - 这避免了因 API 临时问题导致刚登录的账号被误判
   * 
   * Requirements: 2.1, 2.4, 2.5
   */
  static async refreshAccount(account: Account): Promise<Account> {
    const config = PLATFORMS[account.platform];
    if (!config) {
      throw new Error(`不支持的平台: ${account.platform}`);
    }
    
    const now = Date.now();
    const PROTECTION_PERIOD = 5 * 60 * 1000; // 5 分钟保护期
    
    // 判断是否在保护期内（刚登录成功的账号）
    // 条件：账号状态为 ACTIVE 或未设置（新账号），且在保护期时间内
    const lastSuccessTime = account.lastCheckAt || account.createdAt;
    const timeSinceLastSuccess = now - lastSuccessTime;
    const statusIsActiveOrNew = account.status === AccountStatus.ACTIVE || account.status === undefined;
    const isInProtectionPeriod = statusIsActiveOrNew && timeSinceLastSuccess < PROTECTION_PERIOD;
    
    // 优先尝试直接 API 调用（快速，无需打开标签页）
    if (supportDirectApi(account.platform)) {
      logger.info('refresh-account', `使用直接 API 刷新: ${account.platform}`, {
        isInProtectionPeriod,
        status: account.status,
        timeSinceLastCheck: Math.round(timeSinceLastSuccess / 1000) + 's'
      });
      const userInfo = await fetchPlatformUserInfo(account.platform);
      
      if (userInfo.loggedIn) {
        // 成功：更新状态为 ACTIVE，重置连续失败次数
        const updated: Account = {
          ...account,
          nickname: pickBetterNickname(account.platform, account.nickname, userInfo.nickname),
          avatar: pickBetterAvatar(account.avatar, userInfo.avatar),
          updatedAt: now,
          meta: {
            ...(account.meta || {}),
            ...(userInfo.meta || {}),
            ...(userInfo.userId ? { profileId: userInfo.userId } : {}),
          },
          status: AccountStatus.ACTIVE,
          lastCheckAt: now,
          lastError: undefined,
          consecutiveFailures: 0,
        };
        
        await db.accounts.put(updated);
        logger.info('refresh-account', '账号信息已更新（API）', { nickname: updated.nickname });

        if (this.shouldEnrichProfile(updated)) {
          const enriched = await this.tryEnrichAccountProfileViaTab(updated);
          if (enriched) return enriched;
        }
        return updated;
      }
      
      // 检测失败：根据错误类型决定状态
      const isRetryable = userInfo.retryable === true && userInfo.errorType !== AuthErrorType.LOGGED_OUT;

      // 51CTO：Cookie 结构/分区较容易导致误判，避免把“无法确认”当作失败打扰用户
      if (account.platform === '51cto' && isRetryable && account.status === AccountStatus.ACTIVE) {
        logger.info('refresh-account', '51CTO 检测结果不确定，保持 ACTIVE', { error: userInfo.error });

        const updated: Account = {
          ...account,
          updatedAt: now,
          lastCheckAt: now,
          lastError: `[临时] ${userInfo.error || '检测异常'}`,
        };

        await db.accounts.put(updated);
        return updated;
      }
      
      // 新登录保护：如果在保护期内且错误可重试，保持 ACTIVE 状态
      if (isInProtectionPeriod && isRetryable) {
        logger.info('refresh-account', '账号在保护期内，保持 ACTIVE 状态', {
          platform: account.platform,
          error: userInfo.error
        });
        
        // 只更新 lastCheckAt，不改变状态
        const updated: Account = {
          ...account,
          updatedAt: now,
          lastCheckAt: now,
          // 记录错误但不改变状态
          lastError: `[临时] ${userInfo.error || '检测异常'}`,
        };
        
        await db.accounts.put(updated);
        
        // 返回成功，不抛出错误
        return updated;
      }
      
      const newStatus = isRetryable ? AccountStatus.ERROR : AccountStatus.EXPIRED;
      const newConsecutiveFailures = isRetryable 
        ? (account.consecutiveFailures || 0) + 1 
        : (account.consecutiveFailures || 0);
      
      const updated: Account = {
        ...account,
        updatedAt: now,
        status: newStatus,
        lastCheckAt: now,
        lastError: userInfo.error || '检测失败',
        consecutiveFailures: newConsecutiveFailures,
      };
      
      await db.accounts.put(updated);
      logger.info('refresh-account', '账号检测失败', { 
        status: newStatus, 
        error: userInfo.error,
        retryable: isRetryable,
        consecutiveFailures: newConsecutiveFailures
      });
      
      // 抛出错误以便调用方处理
      const error = new Error(userInfo.error || '账号已登出，请重新登录');
      (error as any).retryable = isRetryable;
      (error as any).errorType = userInfo.errorType;
      throw error;
    }
    
    // 回退：使用标签页方式（仅用于微信公众号等特殊平台）
    return this.refreshAccountViaTab(account);
  }
  
  /**
   * 通过打开标签页刷新账号（回退方案）
   * 
   * Requirements: 2.1, 2.4, 2.5
   */
  private static async refreshAccountViaTab(account: Account): Promise<Account> {
    const config = PLATFORMS[account.platform];
    if (!config) {
      throw new Error(`不支持的平台: ${account.platform}`);
    }
    
    const now = Date.now();
    let tab = await findPlatformTab(account.platform);
    let needCloseTab = false;
    
    if (!tab) {
      tab = await chrome.tabs.create({ url: config.homeUrl, active: false });
      needCloseTab = true;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    if (!tab.id) {
      throw new Error('无法创建标签页');
    }
    
    try {
      const state = await checkLoginInTab(tab.id);
      
      if (!state.loggedIn) {
        // 标签页检测失败，标记为 EXPIRED
        const updated: Account = {
          ...account,
          updatedAt: now,
          status: AccountStatus.EXPIRED,
          lastCheckAt: now,
          lastError: state.error || '账号已登出',
          consecutiveFailures: (account.consecutiveFailures || 0) + 1,
        };
        
        await db.accounts.put(updated);
        
        const error = new Error('账号已登出，请重新登录');
        (error as any).retryable = false;
        (error as any).errorType = AuthErrorType.LOGGED_OUT;
        throw error;
      }
      
      // 成功：更新状态为 ACTIVE
      const updated: Account = {
        ...account,
        nickname: pickBetterNickname(account.platform, account.nickname, state.nickname),
        avatar: pickBetterAvatar(account.avatar, state.avatar),
        updatedAt: now,
        meta: {
          ...(account.meta || {}),
          ...(state.meta || {}),
          ...(state.userId ? { profileId: state.userId } : {}),
        },
        status: AccountStatus.ACTIVE,
        lastCheckAt: now,
        lastError: undefined,
        consecutiveFailures: 0,
      };
      
      await db.accounts.put(updated);
      logger.info('refresh-account', '账号信息已更新（Tab）', { nickname: updated.nickname });
      return updated;
    } finally {
      if (needCloseTab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }
  
  /**
   * 批量快速刷新所有账号（并行，无需打开标签页）
   * 
   * 根据检测结果更新每个账号的状态：
   * - 成功：状态设为 ACTIVE，重置连续失败次数
   * - 可重试错误：状态设为 ERROR，增加连续失败次数
   * - 明确登出：状态设为 EXPIRED
   * 
   * 新登录保护机制：
   * - 如果账号在 5 分钟内刚登录成功，且当前状态为 ACTIVE
   * - 遇到可重试错误时，保持 ACTIVE 状态，不立即标记为 ERROR
   * 
   * Requirements: 2.1, 2.4, 2.5
   */
  static async refreshAllAccountsFast(accounts: Account[]): Promise<{
    success: Account[];
    failed: { account: Account; error: string; errorType?: string; retryable?: boolean }[];
  }> {
    logger.info('refresh-all', `开始批量刷新 ${accounts.length} 个账号`);
    
    const now = Date.now();
    const PROTECTION_PERIOD = 5 * 60 * 1000; // 5 分钟保护期
    
    // 按平台分组
    const platformAccounts = new Map<string, Account>();
    for (const account of accounts) {
      platformAccounts.set(account.platform, account);
    }
    
    // 获取所有支持直接 API 的平台
    const directApiPlatforms = Array.from(platformAccounts.keys()).filter(supportDirectApi);
    const tabRequiredPlatforms = Array.from(platformAccounts.keys()).filter(p => !supportDirectApi(p));
    
    const success: Account[] = [];
    const failed: { account: Account; error: string; errorType?: string; retryable?: boolean }[] = [];
    
    // 并行调用所有支持直接 API 的平台
    if (directApiPlatforms.length > 0) {
      const results = await fetchMultiplePlatformUserInfo(directApiPlatforms);
      
      for (const [platform, userInfo] of results) {
        const account = platformAccounts.get(platform);
        if (!account) continue;
        
        // 判断是否在保护期内
        const lastSuccessTime = account.lastCheckAt || account.createdAt;
        const isInProtectionPeriod = account.status === AccountStatus.ACTIVE && 
                                      (now - lastSuccessTime) < PROTECTION_PERIOD;
        
        if (userInfo.loggedIn) {
          // 成功：更新状态为 ACTIVE，重置连续失败次数
          const updated: Account = {
            ...account,
            nickname: pickBetterNickname(account.platform, account.nickname, userInfo.nickname),
            avatar: pickBetterAvatar(account.avatar, userInfo.avatar),
            updatedAt: now,
            meta: {
              ...(account.meta || {}),
              ...(userInfo.meta || {}),
              ...(userInfo.userId ? { profileId: userInfo.userId } : {}),
            },
            status: AccountStatus.ACTIVE,
            lastCheckAt: now,
            lastError: undefined,
            consecutiveFailures: 0,
          };
          
          await db.accounts.put(updated);
          success.push(updated);
        } else {
          // 检测失败：根据错误类型决定状态
          const isRetryable = userInfo.retryable === true && userInfo.errorType !== AuthErrorType.LOGGED_OUT;

          // 51CTO：Cookie 结构/分区较容易导致误判，避免把“无法确认”当做失效打扰用户
          if (platform === '51cto' && isRetryable && account.status === AccountStatus.ACTIVE) {
            logger.info('refresh-all', '51CTO 检测结果不确定，保持 ACTIVE', { error: userInfo.error });

            const updated: Account = {
              ...account,
              updatedAt: now,
              lastCheckAt: now,
              lastError: `[临时] ${userInfo.error || '检测异常'}`,
            };

            await db.accounts.put(updated);
            success.push(updated);
            continue;
          }
          
          // 新登录保护：如果在保护期内且错误可重试，保持 ACTIVE 状态
          if (isInProtectionPeriod && isRetryable) {
            logger.info('refresh-all', `账号 ${platform} 在保护期内，保持 ACTIVE 状态`, {
              error: userInfo.error
            });
            
            // 只更新 lastCheckAt，不改变状态，视为成功
            const updated: Account = {
              ...account,
              updatedAt: now,
              lastCheckAt: now,
              lastError: `[临时] ${userInfo.error || '检测异常'}`,
            };
            
            await db.accounts.put(updated);
            success.push(updated);
            continue;
          }
          
          const newStatus = isRetryable ? AccountStatus.ERROR : AccountStatus.EXPIRED;
          const newConsecutiveFailures = isRetryable 
            ? (account.consecutiveFailures || 0) + 1 
            : (account.consecutiveFailures || 0);
          
          const updated: Account = {
            ...account,
            updatedAt: now,
            status: newStatus,
            lastCheckAt: now,
            lastError: userInfo.error || '检测失败',
            consecutiveFailures: newConsecutiveFailures,
          };
          
          await db.accounts.put(updated);

          // 传递错误类型和是否可重试信息，返回更新后的账号
          failed.push({
            account: updated,
            error: userInfo.error || '登录已失效',
            errorType: userInfo.errorType,
            retryable: isRetryable,
          });
        }
      }
    }
    
    // 串行处理需要打开标签页的平台（现在应该没有了，但保留兼容性）
    for (const platform of tabRequiredPlatforms) {
      const account = platformAccounts.get(platform);
      if (!account) continue;
      
      try {
        const updated = await this.refreshAccountViaTab(account);
        success.push(updated);
      } catch (e: any) {
        // refreshAccountViaTab 已经更新了数据库中的状态
        // 重新获取更新后的账号
        const updatedAccount = await db.accounts.get(account.id);
        failed.push({ 
          account: updatedAccount || account, 
          error: e.message, 
          retryable: (e as any).retryable ?? true,
          errorType: (e as any).errorType
        });
      }
    }
    
    logger.info('refresh-all', `刷新完成: ${success.length} 成功, ${failed.length} 失败`);
    return { success, failed };
  }
  
  /**
   * 重新登录账号
   * 
   * 流程：
   * 1. 打开平台登录页面
   * 2. 轮询检测登录成功（使用 checkLoginInTab）
   * 3. 登录成功后更新账号状态为 ACTIVE
   * 4. 关闭登录标签页并返回更新后的账号
   * 
   * Requirements: 4.2, 4.3, 4.4, 4.5
   * 
   * @param account - 需要重新登录的账号
   * @returns 更新后的账号信息
   */
  static async reloginAccount(account: Account): Promise<Account> {
    const platformName = PLATFORM_NAMES[account.platform] || account.platform;
    const config = PLATFORMS[account.platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('relogin', `开始重新登录: ${platformName}`, { accountId: account.id });
    
    // 打开登录页面
    logger.info('relogin', `打开登录页面: ${config.loginUrl}`);
    const tab = await chrome.tabs.create({ url: config.loginUrl, active: true });
    
    if (!tab.id) {
      throw new Error('无法打开登录页面');
    }
    
    const tabId = tab.id;
    
    // 等待页面加载
    await waitForTabLoad(tabId);
    
    // 创建 Promise 等待登录成功
    return new Promise<Account>((resolve, reject) => {
      let pollingStopped = false;
      let attempts = 0;
      const maxAttempts = 180; // 3分钟（每秒检测一次）
      
      // 设置登录成功回调（来自 content script 的主动通知）
      this.loginCallbacks.set(account.platform, async (state) => {
        if (pollingStopped) return;
        pollingStopped = true;
        logger.info('relogin', '登录成功回调触发', state);
        
        try {
          const now = Date.now();
          
          // 更新账号状态为 ACTIVE，重置连续失败次数，清除错误信息
           const updated: Account = {
             ...account,
             nickname: pickBetterNickname(account.platform, account.nickname, state.nickname),
             avatar: pickBetterAvatar(account.avatar, state.avatar),
             updatedAt: now,
             meta: {
               ...(account.meta || {}),
               ...(state.meta || {}),
              ...(state.userId ? { profileId: state.userId } : {}),
            },
            status: AccountStatus.ACTIVE,
            lastCheckAt: now,
            lastError: undefined,
            consecutiveFailures: 0,
          };
          
          await db.accounts.put(updated);
          logger.info('relogin', '账号状态已更新为 ACTIVE', { nickname: updated.nickname });
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}

          const enriched = await this.maybeEnrichAccountProfile(updated);
          resolve(enriched);
        } catch (e: any) {
          reject(e);
        }
      });
      
      // 启动轮询检测
      const poll = async () => {
        if (pollingStopped) return;
        
        attempts++;
        logger.debug('relogin', `轮询检测 ${attempts}/${maxAttempts}`);
        
        // 检查标签页是否还存在
        try {
          await chrome.tabs.get(tabId);
        } catch {
          // 标签页已关闭
          pollingStopped = true;
          this.loginCallbacks.delete(account.platform);
          reject(new Error('登录窗口已关闭，登录未完成'));
          return;
        }
        
        // 检测登录状态
        try {
          const state = await checkLoginInTab(tabId);
          
          if (state.loggedIn) {
            pollingStopped = true;
            this.loginCallbacks.delete(account.platform);
            
            const now = Date.now();
            
            // 更新账号状态为 ACTIVE，重置连续失败次数，清除错误信息
             const updated: Account = {
               ...account,
               nickname: pickBetterNickname(account.platform, account.nickname, state.nickname),
               avatar: pickBetterAvatar(account.avatar, state.avatar),
               updatedAt: now,
               meta: {
                 ...(account.meta || {}),
                 ...(state.meta || {}),
                ...(state.userId ? { profileId: state.userId } : {}),
              },
              status: AccountStatus.ACTIVE,
              lastCheckAt: now,
              lastError: undefined,
              consecutiveFailures: 0,
            };
            
            await db.accounts.put(updated);
            logger.info('relogin', '重新登录成功', { nickname: updated.nickname });
            
            // 关闭登录标签页
            try {
              await chrome.tabs.remove(tabId);
            } catch {}

            const enriched = await this.maybeEnrichAccountProfile(updated);
            resolve(enriched);
            return;
          }
        } catch (e: any) {
          logger.warn('relogin', '检测失败', { error: e.message });
        }
        
        // 继续轮询
        if (attempts < maxAttempts && !pollingStopped) {
          setTimeout(poll, 1000); // 每秒检测一次
        } else if (!pollingStopped) {
          pollingStopped = true;
          this.loginCallbacks.delete(account.platform);
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}
          
          reject(new Error('登录超时（3分钟），请重试'));
        }
      };
      
      // 开始轮询（等待页面加载后开始）
      setTimeout(poll, 2000);
    });
  }
}

// 导出用于兼容旧代码
export const AUTH_CHECKERS = {};
