/**
 * 账号服务 - 重构版
 * 
 * 核心改进：
 * 1. 登录检测在 content script 中执行（目标网站页面上下文）
 * 2. background 只负责协调流程，不直接检测登录
 * 3. 通过消息机制获取登录状态
 * 4. 支持直接 API 调用快速刷新（无需打开标签页）
 * 5. 懒加载检测机制（用户选择平台时才检测）
 * 6. Cookie 过期时间管理
 * 7. 登录失效时自动打开登录页
 */
import { db, type Account, AccountStatus } from '@synccaster/core';
import { Logger } from '@synccaster/utils';
import { fetchPlatformUserInfo, fetchMultiplePlatformUserInfo, supportDirectApi, getPlatformCookieExpiration, type UserInfo, AuthErrorType } from './platform-api';

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
    // 使用阿里云统一登录页面，登录后会自动跳转回开发者社区
    loginUrl: 'https://account.aliyun.com/login/login.htm?oauth_callback=https%3A%2F%2Fdeveloper.aliyun.com%2F',
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
async function waitForTabLoad(tabId: number, timeoutMs = 2500): Promise<void> {
  // 某些站点（如 CSDN/思否）可能长时间处于 loading 状态或存在持续请求，等待 complete 会显著拖慢登录检测。
  // 这里最多等待一小段时间，超时后也继续发送检测请求，让 content script 自己做短等待/回退。
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return;
      }
    } catch {
      throw new Error('标签页已关闭');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
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

const PROFILE_ENRICH_PLATFORMS = new Set(['wechat', 'tencent-cloud', 'jianshu', 'csdn', '51cto', 'segmentfault', 'oschina']);
const GENERIC_NICKNAMES: Record<string, string[]> = {
  wechat: ['微信公众号'],
  'tencent-cloud': ['腾讯云用户'],
  jianshu: ['简书用户'],
  csdn: ['CSDN用户'],
  '51cto': ['51CTO用户'],
  segmentfault: ['思否用户'],
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

function isCsdnFallbackUserId(value: string): boolean {
  const v = value.trim();
  return /^csdn_\d{10,}$/i.test(v) || /^\d{10,}$/.test(v);
}

function isCsdnUserIdLike(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 60) return false;
  return /^(?:qq|weixin|m\d|csdn)_\d+$/i.test(v);
}

function extractCsdnUserIdFromAvatarUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/\/[^\/]*_([a-zA-Z0-9][a-zA-Z0-9_-]{2,60})\.(?:jpg|jpeg|png)(?:[!?].*)?$/i);
  const candidate = match?.[1]?.trim();
  if (!candidate) return undefined;
  if (candidate.toLowerCase().includes('default') || candidate.toLowerCase().includes('placeholder')) return undefined;
  return candidate;
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
      (platform === 'jianshu' &&
        (!profileId || profileId === 'undefined' || profileId.startsWith('jianshu_') || /^\d+$/.test(profileId))) ||
      (platform === 'segmentfault' &&
        (!profileId ||
          profileId === 'undefined' ||
          /^segmentfault_\d{10,}$/.test(profileId) || // add-account fallback: `${platform}_${Date.now()}`
          /^\d+$/.test(profileId)));

    const needsNickname =
      isGenericNickname(platform, account.nickname) ||
      (platform === 'csdn' &&
        (() => {
          const nickname = String(account.nickname || '').trim();
          if (!nickname) return true;
          if (isCsdnUserIdLike(nickname)) return true;
          const extracted = extractUserIdFromAccountId(account);
          const uid = String(profileId || extracted || extractCsdnUserIdFromAvatarUrl(account.avatar) || '').trim();
          if (!uid) return false;
          return nickname.toLowerCase() === uid.toLowerCase();
        })());
    const needsAvatar = !account.avatar;

    return needsProfileId || needsNickname || needsAvatar;
  }

  private static getProfileEnrichUrl(account: Account): string {
    const config = PLATFORMS[account.platform];
    if (!config) return '';

    if (account.platform === 'csdn') {
      let uid = String((account.meta as any)?.profileId || extractUserIdFromAccountId(account) || '').trim();
      if (!uid || uid === 'undefined' || isCsdnFallbackUserId(uid)) {
        const avatarUid = extractCsdnUserIdFromAvatarUrl(account.avatar);
        if (avatarUid && !isCsdnFallbackUserId(avatarUid)) {
          uid = avatarUid;
        } else {
          const nickname = String(account.nickname || '').trim();
          if (nickname && nickname !== 'CSDN用户' && !isCsdnFallbackUserId(nickname) && isCsdnUserIdLike(nickname)) {
            uid = nickname;
          }
        }
      }
      // 优先打开博客个人主页，可稳定提取昵称（避免把 userId 当昵称）
      if (uid && uid !== 'undefined' && !isCsdnFallbackUserId(uid)) {
        return `https://blog.csdn.net/${encodeURIComponent(uid)}?type=blog`;
      }
      return config.homeUrl;
    }

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

    if (account.platform === 'segmentfault') {
      // 思否用户主页格式：https://segmentfault.com/u/{slug}
      const slug = String((account.meta as any)?.profileId || extractUserIdFromAccountId(account) || '').trim();
      if (slug && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(slug) && !slug.startsWith('segmentfault_') && !/^\d+$/.test(slug)) {
        return `https://segmentfault.com/u/${slug}`;
      }
      return config.homeUrl;
    }

    if (account.platform === 'oschina') {
      const uid = String((account.meta as any)?.profileId || extractUserIdFromAccountId(account) || '').trim();
      if (uid && /^\d+$/.test(uid)) {
        return `https://my.oschina.net/u/${uid}`;
      }
      return 'https://my.oschina.net/';
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
    if (!enriched) return account;

    // CSDN：首次补全可能只拿到 profileId（userId），但昵称仍是 userId；再用博客主页二次校准昵称/头像
    if (account.platform === 'csdn' && this.shouldEnrichProfile(enriched)) {
      const second = await this.tryEnrichAccountProfileViaTab(enriched);
      return second || enriched;
    }

    return enriched;
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
   * 2. 在该页面启动登录状态轮询（优先使用直接 API 检测）
   * 3. 登录成功后，保存账号并关闭登录页面
   * 
   * 优化：
   * - 对于支持直接 API 的平台，优先使用 fetchPlatformUserInfo（更快，不依赖页面加载）
   * - 减少轮询延迟和间隔，提升响应速度
   */
  static async addAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const config = PLATFORMS[platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('add-account', `引导登录: ${platformName}`);
    
    // 先检查是否已经登录（优先使用直接 API）
    if (supportDirectApi(platform)) {
      try {
        const userInfo = await fetchPlatformUserInfo(platform);
        if (userInfo.loggedIn) {
          logger.info('add-account', '通过 API 检测到已登录，直接保存账号');
          const account = await this.saveAccount(platform, {
            userId: userInfo.userId || `${platform}_${Date.now()}`,
            nickname: userInfo.nickname || platformName + '用户',
            avatar: userInfo.avatar,
            platform,
          }, userInfo.meta);
          return await this.maybeEnrichAccountProfile(account);
        }
      } catch (e: any) {
        logger.debug('add-account', 'API 预检测失败，继续打开登录页', { error: e.message });
      }
    } else {
      // 回退：使用标签页检测
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
    }
    
    // 打开登录页面
    logger.info('add-account', `打开登录页面: ${config.loginUrl}`);
    const tab = await chrome.tabs.create({ url: config.loginUrl });
    
    if (!tab.id) {
      throw new Error('无法打开登录页面');
    }
    
    // 创建 Promise 等待登录成功
    return new Promise<Account>((resolve, reject) => {
      const tabId = tab.id!;
      let pollingStopped = false;
      let attempts = 0;
      const maxAttempts = 180; // 3分钟
      const useDirectApi = supportDirectApi(platform);
      
      // 轮询间隔：直接 API 检测更快，可以用更短的间隔
      const pollInterval = useDirectApi ? 1000 : 2000;
      
      // 设置登录成功回调（来自 content script 的主动通知）
      this.loginCallbacks.set(platform, async (state) => {
        if (pollingStopped) return;
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
        logger.info('add-account', `轮询检测 ${attempts}/${maxAttempts}${useDirectApi ? ' (API)' : ''}`);
        
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
          let loggedIn = false;
          let userId: string | undefined;
          let nickname: string | undefined;
          let avatar: string | undefined;
          let meta: any;
          
          // 优先使用直接 API 检测（更快，不依赖页面加载状态）
          if (useDirectApi) {
            if (tabId && ['segmentfault', 'oschina', 'csdn'].includes(platform)) {
              const state = await checkLoginInTab(tabId);
              if (state.loggedIn) {
                loggedIn = true;
                userId = state.userId;
                nickname = state.nickname;
                avatar = state.avatar;
                meta = state.meta;
                logger.info('add-account', 'Tab 检测到登录成功', { userId, nickname });
              }
            }

            if (!loggedIn) {
              const userInfo = await fetchPlatformUserInfo(platform);
              if (userInfo.loggedIn) {
                loggedIn = true;
                userId = userInfo.userId;
                nickname = userInfo.nickname;
                avatar = userInfo.avatar;
                meta = userInfo.meta;
                logger.info('add-account', 'API 检测到登录成功', { userId, nickname });
              }
            }
          } else {
            // 回退：使用 content script 检测
            const state = await checkLoginInTab(tabId);
            if (state.loggedIn) {
              loggedIn = true;
              userId = state.userId;
              nickname = state.nickname;
              avatar = state.avatar;
              meta = state.meta;
            }
          }
          
          if (loggedIn) {
            pollingStopped = true;
            this.loginCallbacks.delete(platform);
            
            const account = await this.saveAccount(platform, {
              userId: userId || `${platform}_${Date.now()}`,
              nickname: nickname || platformName + '用户',
              avatar,
              platform,
            }, meta);
            
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
          setTimeout(poll, pollInterval);
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
      
      // 开始轮询（减少首次延迟）
      setTimeout(poll, 1000);
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

      // 开源中国：检测结果不确定时保持原状态
      // Background 检测已经包含 Cookie + API + HTML 三层检测，足够准确
      // 只有在明确返回 LOGGED_OUT 时才会判定为失效
      if (account.platform === 'oschina' && isRetryable) {
        logger.info('refresh-account', '开源中国检测结果不确定，保持原状态', { 
          error: userInfo.error,
          currentStatus: account.status 
        });

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
          const enriched = await this.maybeEnrichAccountProfile(updated);
          success.push(enriched);
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
          
          // 开源中国：检测结果不确定时保持原状态
          // Background 检测已经包含 Cookie + API + HTML 三层检测，足够准确
          // 只有在明确返回 LOGGED_OUT 时才会判定为失效
          if (platform === 'oschina' && isRetryable) {
            logger.info('refresh-all', '开源中国检测结果不确定，保持原状态', { 
              error: userInfo.error,
              currentStatus: account.status 
            });

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
   * 2. 轮询检测登录成功（优先使用直接 API 检测）
   * 3. 登录成功后更新账号状态为 ACTIVE
   * 4. 关闭登录标签页并返回更新后的账号
   * 
   * 优化：
   * - 对于支持直接 API 的平台，优先使用 fetchPlatformUserInfo（更快，不依赖页面加载）
   * - 减少轮询延迟，提升响应速度
   * 
   * Requirements: 4.2, 4.3, 4.4, 4.5
   * 
   * @param account - 需要重新登录的账号
   * @returns 更新后的账号信息
   */
  static async reloginAccount(account: Account): Promise<Account> {
    const platformName = PLATFORM_NAMES[account.platform] || account.platform;
    const config = PLATFORMS[account.platform];
    const useDirectApi = supportDirectApi(account.platform);
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
    
    // 创建 Promise 等待登录成功
    return new Promise<Account>((resolve, reject) => {
      let pollingStopped = false;
      let attempts = 0;
      const maxAttempts = 180; // 3分钟
      
      // 轮询间隔：直接 API 检测更快，可以用更短的间隔
      const pollInterval = useDirectApi ? 1000 : 1000;
      
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
        logger.debug('relogin', `轮询检测 ${attempts}/${maxAttempts}${useDirectApi ? ' (API)' : ''}`);
        
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
          let loggedIn = false;
          let userId: string | undefined;
          let nickname: string | undefined;
          let avatar: string | undefined;
          let meta: any;
          
          // 优先使用直接 API 检测（更快，不依赖页面加载状态）
          if (useDirectApi) {
            const userInfo = await fetchPlatformUserInfo(account.platform);
            if (userInfo.loggedIn) {
              loggedIn = true;
              userId = userInfo.userId;
              nickname = userInfo.nickname;
              avatar = userInfo.avatar;
              meta = userInfo.meta;
              logger.info('relogin', 'API 检测到登录成功', { userId, nickname });
            }
          } else {
            // 回退：使用 content script 检测
            const state = await checkLoginInTab(tabId);
            if (state.loggedIn) {
              loggedIn = true;
              userId = state.userId;
              nickname = state.nickname;
              avatar = state.avatar;
              meta = state.meta;
            }
          }
          
          if (loggedIn) {
            pollingStopped = true;
            this.loginCallbacks.delete(account.platform);
            
            const now = Date.now();
            
            // 更新账号状态为 ACTIVE，重置连续失败次数，清除错误信息
             const updated: Account = {
               ...account,
               nickname: pickBetterNickname(account.platform, account.nickname, nickname),
               avatar: pickBetterAvatar(account.avatar, avatar),
               updatedAt: now,
               meta: {
                 ...(account.meta || {}),
                 ...(meta || {}),
                ...(userId ? { profileId: userId } : {}),
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
          setTimeout(poll, pollInterval);
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
      
      // 开始轮询（减少首次延迟）
      setTimeout(poll, 1000);
    });
  }
  
  // ============================================================
  // 懒加载检测机制
  // ============================================================
  
  /**
   * 快速状态检测（仅检测 Cookie 存在性，不调用 API）
   * 
   * 用于启动时快速判断账号状态，避免大量 API 调用。
   * 只检测 Cookie 是否存在，不验证 Cookie 是否有效。
   * 
   * @param account - 需要检测的账号
   * @returns 快速检测结果
   */
  static async quickStatusCheck(account: Account): Promise<{
    hasValidCookies: boolean;
    isExpiringSoon: boolean;
    cookieExpiresAt?: number;
  }> {
    const cookieInfo = await getPlatformCookieExpiration(account.platform);
    
    logger.debug('quick-check', `${account.platform} Cookie 检测`, {
      hasValidCookies: cookieInfo.hasValidCookies,
      isExpiringSoon: cookieInfo.isExpiringSoon,
    });
    
    return {
      hasValidCookies: cookieInfo.hasValidCookies,
      isExpiringSoon: cookieInfo.isExpiringSoon || false,
      cookieExpiresAt: cookieInfo.cookieExpiresAt,
    };
  }
  
  /**
   * 批量快速状态检测
   * 
   * 启动时使用，快速判断所有账号的 Cookie 状态。
   * 不调用 API，只检测 Cookie 存在性。
   * 
   * @param accounts - 账号列表
   * @returns 检测结果映射
   */
  static async quickStatusCheckAll(accounts: Account[]): Promise<Map<string, {
    hasValidCookies: boolean;
    isExpiringSoon: boolean;
    cookieExpiresAt?: number;
  }>> {
    logger.info('quick-check-all', `批量快速检测 ${accounts.length} 个账号`);
    
    const results = new Map<string, {
      hasValidCookies: boolean;
      isExpiringSoon: boolean;
      cookieExpiresAt?: number;
    }>();
    
    // 并行检测所有账号
    const checkResults = await Promise.all(
      accounts.map(async (account) => {
        const result = await this.quickStatusCheck(account);
        return { accountId: account.id, result };
      })
    );
    
    for (const { accountId, result } of checkResults) {
      results.set(accountId, result);
    }
    
    // 统计结果
    const validCount = Array.from(results.values()).filter(r => r.hasValidCookies).length;
    const expiringSoonCount = Array.from(results.values()).filter(r => r.isExpiringSoon).length;
    
    logger.info('quick-check-all', `检测完成`, {
      total: accounts.length,
      valid: validCount,
      expiringSoon: expiringSoonCount,
      invalid: accounts.length - validCount,
    });
    
    return results;
  }
  
  /**
   * 判断账号是否需要刷新
   * 
   * 基于以下条件判断：
   * 1. 状态不是 ACTIVE
   * 2. Cookie 即将过期
   * 3. 距离上次检测超过指定时间
   * 4. Cookie 不存在
   * 
   * @param account - 账号
   * @param options - 选项
   * @returns 是否需要刷新
   */
  static async shouldRefreshAccount(account: Account, options: {
    maxAge?: number;  // 最大缓存时间（毫秒），默认 30 分钟
    checkCookie?: boolean;  // 是否检测 Cookie，默认 true
  } = {}): Promise<{
    needsRefresh: boolean;
    reason?: string;
  }> {
    const { maxAge = 30 * 60 * 1000, checkCookie = true } = options;
    const now = Date.now();
    
    // 1. 状态不是 ACTIVE，需要刷新
    if (account.status !== AccountStatus.ACTIVE) {
      return { needsRefresh: true, reason: `状态为 ${account.status}` };
    }
    
    // 2. 距离上次检测超过最大缓存时间
    if (account.lastCheckAt) {
      const timeSinceLastCheck = now - account.lastCheckAt;
      if (timeSinceLastCheck > maxAge) {
        return { needsRefresh: true, reason: `距离上次检测已超过 ${Math.round(maxAge / 60000)} 分钟` };
      }
    } else {
      // 从未检测过
      return { needsRefresh: true, reason: '从未检测过' };
    }
    
    // 3. 检测 Cookie 状态
    if (checkCookie) {
      const cookieInfo = await getPlatformCookieExpiration(account.platform);
      
      if (!cookieInfo.hasValidCookies) {
        return { needsRefresh: true, reason: 'Cookie 不存在或已失效' };
      }
      
      if (cookieInfo.isExpiringSoon) {
        return { needsRefresh: true, reason: 'Cookie 即将过期' };
      }
    }
    
    return { needsRefresh: false };
  }
  
  /**
   * 智能刷新账号
   * 
   * 根据 shouldRefreshAccount 的结果决定是否刷新。
   * 如果不需要刷新，直接返回缓存的账号信息。
   * 
   * @param account - 账号
   * @param options - 选项
   * @returns 账号信息（可能是缓存的）
   */
  static async smartRefreshAccount(account: Account, options: {
    maxAge?: number;
    forceRefresh?: boolean;
  } = {}): Promise<{
    account: Account;
    refreshed: boolean;
    reason?: string;
  }> {
    const { forceRefresh = false } = options;
    
    // 强制刷新
    if (forceRefresh) {
      const updated = await this.refreshAccount(account);
      return { account: updated, refreshed: true, reason: '强制刷新' };
    }
    
    // 判断是否需要刷新
    const { needsRefresh, reason } = await this.shouldRefreshAccount(account, options);
    
    if (!needsRefresh) {
      logger.debug('smart-refresh', `${account.platform} 无需刷新`, { reason: '缓存有效' });
      return { account, refreshed: false };
    }
    
    logger.info('smart-refresh', `${account.platform} 需要刷新`, { reason });
    
    try {
      const updated = await this.refreshAccount(account);
      return { account: updated, refreshed: true, reason };
    } catch (e: any) {
      // 刷新失败，返回原账号（状态可能已更新）
      const updatedAccount = await db.accounts.get(account.id) || account;
      return { account: updatedAccount, refreshed: true, reason: `刷新失败: ${e.message}` };
    }
  }
  
  /**
   * 懒加载检测账号状态
   * 
   * 用户选择平台时才进行检测，而不是主动轮询。
   * 优先使用 Cookie 过期时间判断，避免不必要的 API 调用。
   * 
   * 检测策略：
   * 1. 如果 Cookie 未过期且距离上次检测不超过 30 分钟，跳过检测
   * 2. 如果 Cookie 即将过期（24小时内），标记需要重新登录
   * 3. 否则进行完整的 API 检测
   * 
   * @param account - 需要检测的账号
   * @param forceCheck - 是否强制检测（忽略缓存）
   * @returns 检测结果
   */
  static async lazyCheckAccount(account: Account, forceCheck = false): Promise<{
    needsRelogin: boolean;
    isExpiringSoon: boolean;
    account: Account;
  }> {
    const now = Date.now();
    const CACHE_DURATION = 30 * 60 * 1000; // 30 分钟缓存
    
    logger.info('lazy-check', `懒加载检测: ${account.platform}`, { forceCheck });
    
    // 1. 检查是否可以使用缓存
    if (!forceCheck && account.lastCheckAt) {
      const timeSinceLastCheck = now - account.lastCheckAt;
      
      // 如果状态是 ACTIVE 且在缓存期内，检查 Cookie 过期时间
      if (account.status === AccountStatus.ACTIVE && timeSinceLastCheck < CACHE_DURATION) {
        // 检查 Cookie 是否即将过期
        const cookieInfo = await getPlatformCookieExpiration(account.platform);
        
        if (cookieInfo.hasValidCookies) {
          if (cookieInfo.isExpiringSoon) {
            logger.info('lazy-check', `${account.platform} Cookie 即将过期，建议重新登录`);
            return {
              needsRelogin: false,
              isExpiringSoon: true,
              account,
            };
          }
          
          // Cookie 有效且未过期，使用缓存
          logger.info('lazy-check', `${account.platform} 使用缓存，跳过检测`);
          return {
            needsRelogin: false,
            isExpiringSoon: false,
            account,
          };
        }
      }
    }
    
    // 2. 进行完整检测
    try {
      const updated = await this.refreshAccount(account);
      
      // 更新 Cookie 过期时间
      const cookieInfo = await getPlatformCookieExpiration(account.platform);
      if (cookieInfo.cookieExpiresAt) {
        await db.accounts.update(account.id, {
          cookieExpiresAt: cookieInfo.cookieExpiresAt,
        });
      }
      
      return {
        needsRelogin: false,
        isExpiringSoon: cookieInfo.isExpiringSoon || false,
        account: updated,
      };
    } catch (e: any) {
      // 检测失败，判断是否需要重新登录
      const needsRelogin = (e as any).errorType === AuthErrorType.LOGGED_OUT || 
                           (e as any).retryable === false;
      
      // 重新获取更新后的账号
      const updatedAccount = await db.accounts.get(account.id) || account;
      
      return {
        needsRelogin,
        isExpiringSoon: false,
        account: updatedAccount,
      };
    }
  }
  
  /**
   * 批量懒加载检测
   * 
   * 对多个账号进行懒加载检测，返回需要重新登录的账号列表。
   * 
   * @param accounts - 需要检测的账号列表
   * @returns 检测结果
   */
  static async lazyCheckAccounts(accounts: Account[]): Promise<{
    valid: Account[];
    needsRelogin: Account[];
    expiringSoon: Account[];
  }> {
    const valid: Account[] = [];
    const needsRelogin: Account[] = [];
    const expiringSoon: Account[] = [];
    
    // 并行检测所有账号
    const results = await Promise.all(
      accounts.map(account => this.lazyCheckAccount(account))
    );
    
    for (const result of results) {
      if (result.needsRelogin) {
        needsRelogin.push(result.account);
      } else if (result.isExpiringSoon) {
        expiringSoon.push(result.account);
      } else {
        valid.push(result.account);
      }
    }
    
    logger.info('lazy-check-batch', `批量检测完成`, {
      valid: valid.length,
      needsRelogin: needsRelogin.length,
      expiringSoon: expiringSoon.length,
    });
    
    return { valid, needsRelogin, expiringSoon };
  }
  
  // ============================================================
  // 自动打开登录页
  // ============================================================
  
  /**
   * 自动打开平台登录页
   * 
   * 当检测到账号登录失效时，自动打开平台登录页面。
   * 用户完成登录后，系统会自动检测并更新账号状态。
   * 
   * @param account - 需要重新登录的账号
   * @param options - 选项
   * @returns 是否成功打开登录页
   */
  static async autoOpenLoginPage(account: Account, options: {
    active?: boolean;  // 是否激活标签页（默认 true）
    waitForLogin?: boolean;  // 是否等待登录完成（默认 false）
  } = {}): Promise<{ success: boolean; tabId?: number }> {
    const { active = true, waitForLogin = false } = options;
    const config = PLATFORMS[account.platform];
    
    if (!config) {
      logger.warn('auto-login', `不支持的平台: ${account.platform}`);
      return { success: false };
    }
    
    logger.info('auto-login', `自动打开登录页: ${config.name}`, { accountId: account.id });
    
    try {
      const tab = await chrome.tabs.create({ 
        url: config.loginUrl, 
        active 
      });
      
      if (!tab.id) {
        return { success: false };
      }
      
      if (waitForLogin) {
        // 等待登录完成（复用 reloginAccount 的逻辑）
        try {
          await this.reloginAccount(account);
          return { success: true, tabId: tab.id };
        } catch (e) {
          return { success: false, tabId: tab.id };
        }
      }
      
      return { success: true, tabId: tab.id };
    } catch (e: any) {
      logger.error('auto-login', `打开登录页失败: ${e.message}`);
      return { success: false };
    }
  }
  
  // ============================================================
  // 手动发布降级
  // ============================================================
  
  /**
   * 获取平台手动发布 URL
   * 
   * 当 API 完全不可用时，提供手动发布的降级方案。
   * 
   * @param platform - 平台标识
   * @returns 手动发布 URL
   */
  static getManualPublishUrl(platform: string): string | null {
    const MANUAL_PUBLISH_URLS: Record<string, string> = {
      'juejin': 'https://juejin.cn/editor/drafts/new',
      'csdn': 'https://editor.csdn.net/md',
      'zhihu': 'https://zhuanlan.zhihu.com/write',
      'wechat': 'https://mp.weixin.qq.com/',
      'jianshu': 'https://www.jianshu.com/writer',
      'cnblogs': 'https://i.cnblogs.com/posts/edit',
      '51cto': 'https://blog.51cto.com/blogger/publish',
      'tencent-cloud': 'https://cloud.tencent.com/developer/article/write',
      'aliyun': 'https://developer.aliyun.com/article/new',
      'segmentfault': 'https://segmentfault.com/write',
      'bilibili': 'https://member.bilibili.com/platform/upload/text/edit',
      'oschina': 'https://my.oschina.net/u/home/publish',
    };
    
    return MANUAL_PUBLISH_URLS[platform] || null;
  }
  
  /**
   * 打开手动发布页面
   * 
   * @param platform - 平台标识
   * @returns 是否成功打开
   */
  static async openManualPublishPage(platform: string): Promise<boolean> {
    const url = this.getManualPublishUrl(platform);
    
    if (!url) {
      logger.warn('manual-publish', `平台 ${platform} 不支持手动发布`);
      return false;
    }
    
    try {
      await chrome.tabs.create({ url, active: true });
      logger.info('manual-publish', `已打开 ${platform} 手动发布页面`);
      return true;
    } catch (e: any) {
      logger.error('manual-publish', `打开手动发布页面失败: ${e.message}`);
      return false;
    }
  }
  
  /**
   * 检查账号是否需要重新登录
   * 
   * 基于 Cookie 过期时间和账号状态判断。
   * 
   * @param account - 账号
   * @returns 是否需要重新登录
   */
  static isAccountExpiredOrExpiring(account: Account): {
    isExpired: boolean;
    isExpiringSoon: boolean;
    expiresIn?: number;  // 距离过期的毫秒数
  } {
    const now = Date.now();
    const EXPIRING_SOON_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时
    
    // 状态已经是 EXPIRED
    if (account.status === AccountStatus.EXPIRED) {
      return { isExpired: true, isExpiringSoon: false };
    }
    
    // 检查 Cookie 过期时间
    if (account.cookieExpiresAt) {
      const expiresIn = account.cookieExpiresAt - now;
      
      if (expiresIn <= 0) {
        return { isExpired: true, isExpiringSoon: false, expiresIn: 0 };
      }
      
      if (expiresIn < EXPIRING_SOON_THRESHOLD) {
        return { isExpired: false, isExpiringSoon: true, expiresIn };
      }
    }
    
    return { isExpired: false, isExpiringSoon: false };
  }
}

// 导出平台配置供外部使用
export { PLATFORMS, PLATFORM_NAMES };

// 导出用于兼容旧代码
export const AUTH_CHECKERS = {};
