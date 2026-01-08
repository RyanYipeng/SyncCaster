/**
 * 平台 API 直接调用模块
 * 
 * 核心思路：利用 Chrome 扩展的跨域能力，直接在 background 中调用各平台 API
 * 优势：
 * 1. 无需打开标签页，速度快
 * 2. 可以并行请求多个平台
 * 3. 更稳定，不受页面加载影响
 * 
 * v2 改进：
 * - 区分错误类型，避免将临时错误误判为登录失效
 * - 智能响应解析，处理 HTML 重定向等情况
 * - 支持重试机制
 */

import { Logger } from '@synccaster/utils';

const logger = new Logger('platform-api');

/**
 * 错误类型枚举
 */
export enum AuthErrorType {
  LOGGED_OUT = 'logged_out',      // 确认已登出
  API_ERROR = 'api_error',        // API 调用失败（可能是临时问题）
  NETWORK_ERROR = 'network_error', // 网络错误
  RATE_LIMITED = 'rate_limited',  // 被限流
  UNKNOWN = 'unknown',            // 未知错误
}

/**
 * Cookie 检测配置接口
 */
export interface CookieDetectionConfig {
  // 用于获取 Cookie 的 URL（使用 URL 而不是 domain 可以获取到所有相关 Cookie）
  url: string;
  // 备用 URL（某些平台 Cookie 可能在不同子域名）
  fallbackUrls?: string[];
  sessionCookies: string[];  // 表示有效会话的 Cookie 名称
}

/**
 * Cookie 检测配置 - 各平台的 Cookie 检测策略
 * 用于在主 API 检测失败时作为备用检测方案
 * 
 * 注意：使用 URL 而不是 domain 来获取 Cookie，因为 chrome.cookies.getAll({ domain })
 * 只会返回域名完全匹配的 Cookie，而使用 URL 可以获取到该 URL 可访问的所有 Cookie
 * 
 * Requirements: 1.2, 1.5, 6.2
 */
export const COOKIE_CONFIGS: Record<string, CookieDetectionConfig> = {
  'juejin': {
    url: 'https://juejin.cn/',
    sessionCookies: ['sessionid', 'sessionid_ss'],
  },
  'csdn': {
    // CSDN 的 Cookie 可能在多个子域名上
    url: 'https://www.csdn.net/',
    fallbackUrls: ['https://me.csdn.net/', 'https://blog.csdn.net/', 'https://passport.csdn.net/'],
    // CSDN 使用多种 Cookie 来标识登录状态 - 扩展列表
    sessionCookies: ['UserName', 'UserNick', 'UserInfo', 'UserToken', 'uuid_tt_dd', 'c_segment', 'dc_session_id', 'c_first_ref', 'c_first_page', 'loginbox_strategy', 'SESSION', 'UN'],
  },
  'zhihu': {
    url: 'https://www.zhihu.com/',
    sessionCookies: ['z_c0', 'd_c0'],
  },
  'bilibili': {
    url: 'https://www.bilibili.com/',
    sessionCookies: ['SESSDATA', 'bili_jct', 'DedeUserID'],
  },
  'jianshu': {
    url: 'https://www.jianshu.com/',
    sessionCookies: ['remember_user_token', 'sensorsdata2015jssdkcross'],
  },
  'cnblogs': {
    url: 'https://www.cnblogs.com/',
    fallbackUrls: ['https://account.cnblogs.com/', 'https://passport.cnblogs.com/'],
    // 博客园的 Cookie 名称可能有变化
    sessionCookies: ['.CNBlogsCookie', '.Cnblogs.AspNetCore.Cookies', 'CNZZDATA', '_ga'],
  },
  '51cto': {
    url: 'https://home.51cto.com/',
    fallbackUrls: [
      'https://blog.51cto.com/',
      'https://passport.51cto.com/',
      'https://ucenter.51cto.com/',
      'https://edu.51cto.com/',
    ],
    // Avoid PHPSESSID because it is set for guests; rely on login-specific cookies instead
    sessionCookies: [
      'pub_sauth1',
      'pub_sauth2',
      'pub_sauth3',
      'pub_sid',
      'pub_loginuser',
      'LOGIN_ACCOUNT',
      'uc_token',
      'sid',
      'uid',
      'user_id',
      'userid',
      'sauth1',
      'sauth2',
      'sauth3',
      'sauth4',
      'token',
    ],
  },
  'tencent-cloud': {
    url: 'https://cloud.tencent.com/',
    fallbackUrls: ['https://cloud.tencent.com/developer/'],
    sessionCookies: ['uin', 'skey', 'p_uin', 'pt4_token', 'p_skey'],
  },
  'aliyun': {
    url: 'https://developer.aliyun.com/',
    fallbackUrls: [
      'https://account.aliyun.com/',
      'https://passport.aliyun.com/',
      'https://signin.aliyun.com/',
      'https://www.aliyun.com/',
    ],
    // 阿里云/开发者社区登录态 Cookie（避免使用访客也会有的追踪类 Cookie）
    sessionCookies: [
      'login_aliyunid',
      'login_aliyunid_pk',
      'login_current_pk',
      'login_aliyunid_ticket',
      'havana_key',
    ],
  },
  'segmentfault': {
    url: 'https://segmentfault.com/',
    fallbackUrls: [
      'https://segmentfault.com/user/',
      'https://segmentfault.com/user/login',
      'https://segmentfault.com/user/settings',
    ],
    // 思否可能使用的登录态 Cookie（扩展列表 - 2024 更新）
    sessionCookies: [
      'sf_remember',         // 记住登录
      'sf_token',            // 思否 token
      'sf_session',          // 思否会话
      'PHPSESSID',           // PHP 会话（思否使用 PHP）
      'Hm_lvt_',             // 百度统计 Cookie（登录用户才有）
      'sensorsdata',         // 神策数据 Cookie
      '_ga',                 // Google Analytics
      'jwt',                 // JWT token
      'token',               // 通用 token
      'session',             // 通用会话
      'XSRF-TOKEN',          // XSRF 令牌
    ],
  },
  'oschina': {
    url: 'https://www.oschina.net/',
    fallbackUrls: ['https://my.oschina.net/', 'https://gitee.com/'],
    // 对标 cose：只使用 OSCHINA 自身的会话 Cookie，避免因第三方/残留 Cookie 造成误判
    sessionCookies: ['oscid', 'osc_id'],
  },
  'wechat': {
    url: 'https://mp.weixin.qq.com/',
    sessionCookies: ['slave_sid', 'slave_user', 'data_ticket', 'bizuin', 'data_bizuin', 'cert'],
  },
  'toutiao': {
    url: 'https://www.toutiao.com/',
    fallbackUrls: ['https://sso.toutiao.com/', 'https://mp.toutiao.com/'],
    sessionCookies: ['toutiao_sso_user', 'passport_csrf_token', 'sid_guard', 'uid_tt', 'sid_tt', 'sessionid'],
  },
  'infoq': {
    url: 'https://www.infoq.cn/',
    fallbackUrls: ['https://xie.infoq.cn/'],
    sessionCookies: ['INFOQ_TOKEN', 'SERVERID', 'uid', 'token', 'INFOQ_USER_ID'],
  },
  'baijiahao': {
    url: 'https://baijiahao.baidu.com/',
    fallbackUrls: ['https://passport.baidu.com/', 'https://author.baidu.com/'],
    sessionCookies: ['BDUSS', 'STOKEN', 'BAIDUID', 'BDUSS_BFESS', 'PSTM'],
  },
  'wangyihao': {
    url: 'https://mp.163.com/',
    fallbackUrls: ['https://www.163.com/', 'https://passport.163.com/'],
    sessionCookies: ['P_INFO', 'NTES_SESS', 'S_INFO', 'NTES_PASSPORT', 'NTESwebSI'],
  },
  'medium': {
    url: 'https://medium.com/',
    sessionCookies: ['sid', 'uid', '_gid', 'nonce', 'sz'],
  },
};

export interface UserInfo {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatar?: string;
  platform: string;
  error?: string;
  errorType?: AuthErrorType;  // 错误类型
  retryable?: boolean;        // 是否可重试
  detectionMethod?: 'api' | 'cookie' | 'html' | 'tab';  // 检测方式
  cookieExpiresAt?: number;   // Cookie 最早过期时间（毫秒时间戳）
  meta?: {
    level?: number;
    followersCount?: number;
    articlesCount?: number;
    viewsCount?: number;
  };
}

/**
 * 平台 API 配置
 */
interface PlatformApiConfig {
  id: string;
  name: string;
  fetchUserInfo: () => Promise<UserInfo>;
}

/**
 * 通用 fetch 封装，自动带上 Cookie，支持重试
 */
async function fetchWithCookies(url: string, options: RequestInit = {}, maxRetries = 1): Promise<Response> {
  let lastError: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          ...options.headers,
        },
      });
      return res;
    } catch (e: any) {
      lastError = e;
      logger.warn('fetch', `请求失败 (${i + 1}/${maxRetries + 1}): ${url}`, e.message);
      if (i < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('请求失败');
}

/**
 * 智能解析 API 响应，区分错误类型
 */
async function parseApiResponse(
  res: Response,
  platform: string,
  parseJson: (data: any) => UserInfo | null
): Promise<UserInfo> {
  const contentType = res.headers.get('content-type') || '';

  // 1. 检查 HTTP 状态码
  if (res.status === 401 || res.status === 403) {
    return {
      loggedIn: false,
      platform,
      errorType: AuthErrorType.LOGGED_OUT,
      error: '登录已失效',
      retryable: false
    };
  }

  if (res.status === 429) {
    return {
      loggedIn: false,
      platform,
      errorType: AuthErrorType.RATE_LIMITED,
      error: '请求过于频繁',
      retryable: true
    };
  }

  if (res.status >= 500) {
    return {
      loggedIn: false,
      platform,
      errorType: AuthErrorType.API_ERROR,
      error: `服务暂时不可用 (${res.status})`,
      retryable: true
    };
  }

  // 2. 404 不一定是登录失效，可能是 API 变更
  if (res.status === 404) {
    return {
      loggedIn: false,
      platform,
      errorType: AuthErrorType.API_ERROR,
      error: 'API 接口不可用',
      retryable: true
    };
  }

  // 3. 400 错误需要进一步分析
  if (res.status === 400) {
    try {
      const text = await res.text();
      // 尝试解析为 JSON
      try {
        const data = JSON.parse(text);
        // 检查是否是明确的未登录响应
        if (data.code === 401 || data.code === -101 || data.message?.includes('登录')) {
          return { loggedIn: false, platform, errorType: AuthErrorType.LOGGED_OUT, error: '需要登录' };
        }
      } catch { }
      return {
        loggedIn: false,
        platform,
        errorType: AuthErrorType.API_ERROR,
        error: '请求参数错误',
        retryable: true
      };
    } catch {
      return { loggedIn: false, platform, errorType: AuthErrorType.API_ERROR, error: 'HTTP 400', retryable: true };
    }
  }

  // 4. 检查响应内容类型
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    try {
      const text = await res.text();

      // 检查是否是 HTML 登录页面
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        const isLoginPage =
          text.includes('登录') ||
          text.includes('login') ||
          text.includes('sign in') ||
          text.includes('signin') ||
          text.includes('请先登录');

        if (isLoginPage) {
          return {
            loggedIn: false,
            platform,
            errorType: AuthErrorType.LOGGED_OUT,
            error: '需要重新登录',
            retryable: false
          };
        }

        // 其他 HTML 响应视为 API 错误
        return {
          loggedIn: false,
          platform,
          errorType: AuthErrorType.API_ERROR,
          error: '接口返回格式异常',
          retryable: true
        };
      }

      // 尝试解析为 JSON（有些服务器 content-type 设置不正确）
      try {
        const data = JSON.parse(text);
        const result = parseJson(data);
        if (result) return result;
      } catch { }

    } catch (e) {
      return {
        loggedIn: false,
        platform,
        errorType: AuthErrorType.API_ERROR,
        error: '响应解析失败',
        retryable: true
      };
    }
  }

  // 5. 正常解析 JSON
  try {
    const data = await res.json();
    const result = parseJson(data);
    if (result) return result;

    // parseJson 返回 null 表示未登录
    return { loggedIn: false, platform, errorType: AuthErrorType.LOGGED_OUT, error: '未登录' };
  } catch (e) {
    return {
      loggedIn: false,
      platform,
      errorType: AuthErrorType.API_ERROR,
      error: 'JSON 解析失败',
      retryable: true
    };
  }
}

// ============================================================
// Cookie 检测辅助函数
// ============================================================

/**
 * 获取 Cookie 最早过期时间
 * 
 * 遍历所有会话 Cookie，找出最早的过期时间。
 * 用于提前预警用户登录即将失效。
 * 
 * @param cookies - Cookie 列表
 * @param sessionCookieNames - 会话 Cookie 名称列表
 * @returns 最早过期时间（毫秒时间戳），如果都是 session cookie 则返回 undefined
 */
function getCookieEarliestExpiration(
  cookies: chrome.cookies.Cookie[],
  sessionCookieNames: string[]
): number | undefined {
  const sessionCookieNameSet = new Set(sessionCookieNames.map(n => n.toLowerCase()));

  let earliestExpiration: number | undefined;

  for (const cookie of cookies) {
    // 只检查会话 Cookie
    if (!sessionCookieNameSet.has(cookie.name.toLowerCase())) {
      continue;
    }

    // 跳过无效值的 Cookie
    if (!cookie.value || cookie.value.trim().toLowerCase() === 'deleted') {
      continue;
    }

    // expirationDate 是秒级时间戳，需要转换为毫秒
    // 如果没有 expirationDate，说明是 session cookie（浏览器关闭时失效）
    if (cookie.expirationDate) {
      const expiresAt = cookie.expirationDate * 1000;
      if (earliestExpiration === undefined || expiresAt < earliestExpiration) {
        earliestExpiration = expiresAt;
      }
    }
  }

  return earliestExpiration;
}

/**
 * 获取平台 Cookie 过期时间
 * 
 * 直接获取指定平台的 Cookie 过期时间，不进行登录状态检测。
 * 用于懒加载检测时快速判断是否需要重新检测。
 * 
 * @param platform - 平台标识
 * @returns Cookie 过期信息
 */
export async function getPlatformCookieExpiration(platform: string): Promise<{
  hasValidCookies: boolean;
  cookieExpiresAt?: number;
  isExpiringSoon?: boolean;  // 是否即将过期（24小时内）
}> {
  const config = COOKIE_CONFIGS[platform];

  if (!config) {
    return { hasValidCookies: false };
  }

  try {
    const urls = [config.url, ...(config.fallbackUrls || [])];
    const allCookies: chrome.cookies.Cookie[] = [];

    for (const url of urls) {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        allCookies.push(...cookies);
      } catch { }
    }

    const sessionCookieNameSet = new Set(config.sessionCookies.map(n => n.toLowerCase()));
    const isValidCookieValue = (value?: string) => {
      if (!value) return false;
      const trimmed = value.trim().toLowerCase();
      return trimmed && trimmed !== 'deleted' && trimmed !== 'null' && trimmed !== 'undefined';
    };

    const hasValidCookies = allCookies.some(
      cookie => sessionCookieNameSet.has(cookie.name.toLowerCase()) && isValidCookieValue(cookie.value)
    );

    if (!hasValidCookies) {
      return { hasValidCookies: false };
    }

    const cookieExpiresAt = getCookieEarliestExpiration(allCookies, config.sessionCookies);
    const now = Date.now();
    const EXPIRING_SOON_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时

    return {
      hasValidCookies: true,
      cookieExpiresAt,
      isExpiringSoon: cookieExpiresAt ? (cookieExpiresAt - now) < EXPIRING_SOON_THRESHOLD : false,
    };
  } catch (e) {
    logger.warn('cookie-expiration', `获取 ${platform} Cookie 过期时间失败`, e as Record<string, unknown>);
    return { hasValidCookies: false };
  }
}

/**
 * 通过 Cookie 检测登录状态
 * 
 * 当主 API 检测失败时，使用 Cookie 作为备用检测方案。
 * 检查平台特定的会话 Cookie 是否存在且有值。
 * 
 * 使用 URL 而不是 domain 来获取 Cookie，因为：
 * 1. chrome.cookies.getAll({ domain }) 只返回域名完全匹配的 Cookie
 * 2. chrome.cookies.getAll({ url }) 返回该 URL 可访问的所有 Cookie（包括父域名的 Cookie）
 * 
 * Requirements: 1.2
 * 
 * @param platform - 平台标识
 * @returns UserInfo 对象，包含 detectionMethod: 'cookie'
 */
export async function detectViaCookies(platform: string): Promise<UserInfo> {
  const config = COOKIE_CONFIGS[platform];

  if (!config) {
    logger.warn('cookie-detect', `平台 ${platform} 未配置 Cookie 检测`);
    return {
      loggedIn: false,
      platform,
      error: '不支持 Cookie 检测',
      errorType: AuthErrorType.UNKNOWN,
      retryable: false,
      detectionMethod: 'cookie',
    };
  }

  const isValidCookieValue = (value?: string) => {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined';
  };
  const sessionCookieNameSet = new Set(config.sessionCookies.map((n) => n.toLowerCase()));
  const matchesSessionCookieName = (name: string) => sessionCookieNameSet.has(name.toLowerCase());

  try {
    // 收集所有 URL 的 Cookie
    const urls = [config.url, ...(config.fallbackUrls || [])];
    const allCookies: chrome.cookies.Cookie[] = [];

    for (const url of urls) {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        allCookies.push(...cookies);
      } catch (e: any) {
        logger.warn('cookie-detect', `获取 ${url} 的 Cookie 失败`, { error: e?.message || String(e) });
      }
    }

    // 检查是否存在任一配置的会话 Cookie 且值有效
    // 注意：不能用 name@domain 做损失性去重，否则可能优先命中 path/partitionKey 不同的 "deleted" Cookie，导致误判未登录
    const hasValidSession = allCookies.some(
      (cookie) => matchesSessionCookieName(cookie.name) && isValidCookieValue(cookie.value)
    );

    if (hasValidSession) {
      // 计算 Cookie 最早过期时间
      const cookieExpiresAt = getCookieEarliestExpiration(allCookies, config.sessionCookies);

      logger.info('cookie-detect', `${platform} Cookie 检测成功，存在有效会话`, {
        cookieExpiresAt: cookieExpiresAt ? new Date(cookieExpiresAt).toISOString() : 'session'
      });
      return {
        loggedIn: true,
        platform,
        detectionMethod: 'cookie',
        cookieExpiresAt,
      };
    } else {
      // 记录找到的 Cookie 名称，便于调试
      const foundCookieNames = Array.from(new Set(allCookies.map((c) => c.name)));
      logger.info('cookie-detect', `${platform} Cookie 检测失败，未找到有效会话 Cookie`, {
        expected: config.sessionCookies,
        found: foundCookieNames.slice(0, 10) // 只记录前 10 个
      });
      return {
        loggedIn: false,
        platform,
        error: '未找到有效的登录 Cookie',
        errorType: AuthErrorType.LOGGED_OUT,
        retryable: false,
        detectionMethod: 'cookie',
      };
    }
  } catch (e: any) {
    logger.error('cookie-detect', `${platform} Cookie 检测异常`, e);
    return {
      loggedIn: false,
      platform,
      error: `Cookie 检测失败: ${e.message}`,
      errorType: AuthErrorType.NETWORK_ERROR,
      retryable: true,
      detectionMethod: 'cookie',
    };
  }
}

/**
 * 判断错误是否应该触发 Cookie 回退检测
 * 
 * 401/403 表示明确的登录失效，不应回退
 * 404/500+/网络错误等可能是临时问题，应尝试 Cookie 回退
 * 
 * Requirements: 1.1, 1.4
 */
export function shouldFallbackToCookie(userInfo: UserInfo): boolean {
  // 已登录不需要回退
  if (userInfo.loggedIn) {
    return false;
  }

  // 主检测本身就是 Cookie/页面探针时，不再做 Cookie 回退（避免重复/误导日志）
  if (userInfo.detectionMethod === 'cookie' || userInfo.detectionMethod === 'html') {
    return false;
  }

  // 明确的登出状态不回退
  if (userInfo.errorType === AuthErrorType.LOGGED_OUT) {
    return false;
  }

  // 可重试的错误应该尝试 Cookie 回退
  return userInfo.retryable === true;
}

/**
 * 带 Cookie 回退的用户信息获取
 * 
 * 先尝试主 API 检测，如果失败且错误可重试，则尝试 Cookie 检测
 * 
 * Requirements: 1.1, 1.3, 1.4, 6.3
 */
export async function fetchUserInfoWithFallback(
  platform: string,
  primaryFetch: () => Promise<UserInfo>
): Promise<UserInfo> {
  // 1. 尝试主 API 检测
  const primaryResult = await primaryFetch();
  if (!primaryResult.detectionMethod) {
    primaryResult.detectionMethod = 'api';
  }

  // 2. 如果成功或明确登出，直接返回
  if (!shouldFallbackToCookie(primaryResult)) {
    return primaryResult;
  }

  // 3. 检查是否配置了 Cookie 检测
  if (!COOKIE_CONFIGS[platform]) {
    logger.info('fallback', `${platform} 未配置 Cookie 检测，跳过回退`);
    return primaryResult;
  }

  // 4. 尝试 Cookie 回退检测
  logger.info('fallback', `${platform} API 检测失败 (${primaryResult.error})，尝试 Cookie 回退`);
  const cookieResult = await detectViaCookies(platform);

  // 5. 如果 Cookie 检测成功，返回成功结果
  if (cookieResult.loggedIn) {
    logger.info('fallback', `${platform} Cookie 回退检测成功`);
    return cookieResult;
  }

  // 6. 两种检测都失败，返回原始 API 错误（保留更多信息）
  logger.info('fallback', `${platform} Cookie 回退检测也失败`);
  return primaryResult;
}

// ============================================================
// 各平台 API 实现
// ============================================================

const juejinApi: PlatformApiConfig = {
  id: 'juejin',
  name: '掘金',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://api.juejin.cn/user_api/v1/user/get');

      return parseApiResponse(res, 'juejin', (data) => {
        if (data.err_no === 0 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'juejin',
            userId: user.user_id,
            nickname: user.user_name,
            avatar: user.avatar_large || user.avatar,
            meta: {
              level: user.level,
              followersCount: user.follower_count,
              articlesCount: user.post_article_count,
              viewsCount: user.got_view_count,
            },
          };
        }
        // 掘金特定的未登录错误码
        if (data.err_no === 403 || data.err_msg?.includes('登录')) {
          return { loggedIn: false, platform: 'juejin', errorType: AuthErrorType.LOGGED_OUT, error: '需要登录' };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('juejin', 'API 调用失败', e);
      return { loggedIn: false, platform: 'juejin', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

// CSDN - 先尝试 API，失败则用 Cookie 检测
const csdnApi: PlatformApiConfig = {
  id: 'csdn',
  name: 'CSDN',
  async fetchUserInfo(): Promise<UserInfo> {
    const normalizeUrl = (url?: unknown): string | undefined => {
      const candidate =
        typeof url === 'string'
          ? url
          : url && typeof url === 'object'
            ? (url as any).url || (url as any).src || (url as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      return trimmed;
    };

    const decodeHtmlEntities = (value: string): string =>
      value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const cleanNickname = (value?: string): string | undefined => {
      const trimmed = typeof value === 'string' ? decodeHtmlEntities(value).trim() : '';
      if (!trimmed) return undefined;
      if (trimmed.length > 60) return undefined;
      if (trimmed.includes('已加入') && trimmed.includes('CSDN')) return undefined;
      if (/CSDN\s*\d+/i.test(trimmed)) return undefined;
      if (trimmed === 'CSDN用户') return undefined;
      return trimmed;
    };

    const fetchProfileFromHtml = async (
      userId: string
    ): Promise<{ nickname?: string; avatar?: string } | null> => {
      const uid = userId.trim();
      if (!uid) return null;

      try {
        const url = `https://blog.csdn.net/${encodeURIComponent(uid)}?type=blog`;
        const res = await fetchWithCookies(url, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            Referer: 'https://blog.csdn.net/',
          },
        });

        if (!res.ok) return null;
        const html = await res.text();
        const scopeHtml = (() => {
          const markers = ['user-profile-head-name', 'user-profile-head', 'user-profile'];
          for (const marker of markers) {
            const idx = html.indexOf(marker);
            if (idx >= 0) {
              return html.substring(Math.max(0, idx - 8000), Math.min(html.length, idx + 16000));
            }
          }
          return html.substring(0, Math.min(html.length, 120000));
        })();

        let nickname: string | undefined;
        const nicknamePatterns = [
          /<div[^>]*class="[^"]*user-profile-head-name[^"]*"[^>]*>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i,
          /<div[^>]*class="[^"]*user-profile-head-name[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i,
          /<div[^>]*class="[^"]*user-profile-head-name[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*only-code[^"]*"[^>]*>([^<]+)<\/div>/i,
          /<div[^>]*class="[^"]*only-code[^"]*"[^>]*>([^<]+)<\/div>/i,
          /<div[^>]*class="[^"]*user-profile-head-name[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/i,
          /<h1[^>]*class="[^"]*user-profile-head-name[^"]*"[^>]*>([^<]+)<\/h1>/i,
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
          /<title>\s*([^<]+?)\s*-\s*CSDN/iu,
        ];

        for (const pattern of nicknamePatterns) {
          const match = scopeHtml.match(pattern) || html.match(pattern);
          const value = cleanNickname(match?.[1]);
          if (!value) continue;
          nickname = value;
          break;
        }

        let avatar: string | undefined;
        const avatarPatterns = [
          /<div[^>]*class="[^"]*user-profile-avatar[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i,
          /<img[^>]+src="([^"]*profile-avatar\.csdnimg\.cn[^"]+)"[^>]*>/i,
          /<img[^>]+data-src="([^"]*profile-avatar\.csdnimg\.cn[^"]+)"[^>]*>/i,
          /background-image:\s*url\(['"]?([^'")\s]+profile-avatar\.csdnimg\.cn[^'")\s]+)['"]?\)/i,
        ];

        for (const pattern of avatarPatterns) {
          const match = scopeHtml.match(pattern) || html.match(pattern);
          const value = normalizeUrl(match?.[1]);
          if (!value) continue;
          if (value.toLowerCase().includes('default') || value.toLowerCase().includes('placeholder')) continue;
          avatar = value;
          break;
        }

        if (!nickname && !avatar) return null;
        return { nickname, avatar };
      } catch (e: any) {
        logger.warn('csdn', '个人主页 HTML 提取失败', { error: e?.message || String(e) });
        return null;
      }
    };

    // 先尝试 API 获取用户信息
    try {
      const res = await fetchWithCookies('https://me.csdn.net/api/user/show', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://me.csdn.net/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        logger.info('csdn', 'API 响应', data);

        const payload = data?.data || data?.result || data;
        const okCode =
          data?.code === 200 ||
          data?.code === '200' ||
          data?.status === 200 ||
          data?.status === '200' ||
          data?.success === true;

        if (okCode && payload) {
          const user = payload;
          let userId: string | undefined =
            user.loginName || user.username || user.userName || user.user_name || user.name;
          userId = typeof userId === 'string' ? userId.trim() : undefined;

          let nickname: string | undefined =
            user.nickname || user.nickName || user.name || user.username || user.userName || user.user_name;
          nickname = typeof nickname === 'string' ? nickname.trim() : undefined;

          let avatar: string | undefined =
            user.avatar || user.avatarUrl || user.headUrl || user.head_url || user.avatar_url;
          avatar = normalizeUrl(avatar);

          logger.info('csdn', '从 API 获取到用户信息', { userId, nickname });

          if (userId) {
            const shouldFixNickname =
              !nickname || nickname.trim().toLowerCase() === userId.trim().toLowerCase();
            const shouldFixAvatar = !avatar;

            if (shouldFixNickname || shouldFixAvatar) {
              const profile = await fetchProfileFromHtml(userId);
              if (profile?.nickname && shouldFixNickname) nickname = profile.nickname;
              if (!avatar && profile?.avatar) avatar = profile.avatar;
            }
          }

          return {
            loggedIn: true,
            platform: 'csdn',
            userId,
            nickname: nickname || userId || 'CSDN用户',
            avatar: avatar || undefined,
            meta: {
              level: user.level,
              followersCount: user.fansNum,
              articlesCount: user.articleNum,
              viewsCount: user.visitNum,
            },
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('csdn', 'API 调用失败', { error: e.message });
    }

    // 备用 API
    try {
      const res = await fetchWithCookies('https://blog.csdn.net/community/home-api/v1/get-business-info', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://blog.csdn.net/',
        },
      });
      if (res.ok) {
        const data = await res.json();
        logger.info('csdn', '备用 API 响应', data);

        const payload = data?.data || data?.result || data;
        const okCode =
          data?.code === 200 ||
          data?.code === '200' ||
          data?.status === 200 ||
          data?.status === '200' ||
          data?.success === true;

        if (okCode && payload) {
          const user = payload;

          let userId: string | undefined =
            user.loginName || user.username || user.userName || user.user_name || user.name;
          userId = typeof userId === 'string' ? userId.trim() : undefined;

          let nickname: string | undefined =
            user.nickName || user.nickname || user.name || user.username || user.userName || user.user_name;
          nickname = typeof nickname === 'string' ? nickname.trim() : undefined;

          let avatar: string | undefined =
            user.avatar || user.avatarUrl || user.headUrl || user.head_url || user.avatar_url;
          avatar = normalizeUrl(avatar);

          logger.info('csdn', '从备用 API 获取到用户信息', { userId, nickname });

          if (userId) {
            const shouldFixNickname =
              !nickname || nickname.trim().toLowerCase() === userId.trim().toLowerCase();
            const shouldFixAvatar = !avatar;

            if (shouldFixNickname || shouldFixAvatar) {
              const profile = await fetchProfileFromHtml(userId);
              if (profile?.nickname && shouldFixNickname) nickname = profile.nickname;
              if (!avatar && profile?.avatar) avatar = profile.avatar;
            }
          }

          return {
            loggedIn: true,
            platform: 'csdn',
            userId,
            nickname: nickname || userId || 'CSDN用户',
            avatar: avatar || undefined,
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('csdn', '备用 API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    const mainCookies = await chrome.cookies.getAll({ url: 'https://www.csdn.net/' });
    const meCookies = await chrome.cookies.getAll({ url: 'https://me.csdn.net/' });
    const blogCookies = await chrome.cookies.getAll({ url: 'https://blog.csdn.net/' });
    const passportCookies = await chrome.cookies.getAll({ url: 'https://passport.csdn.net/' });
    const iCookies = await chrome.cookies.getAll({ url: 'https://i.csdn.net/' });
    const allCookies = [...mainCookies, ...meCookies, ...blogCookies, ...passportCookies, ...iCookies];

    const isValidCookieValue = (value?: string) => {
      if (!value) return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined';
    };

    // 去重（优先保留有值的 Cookie，避免先命中空值/已失效值导致误判）
    const uniqueCookies = new Map<string, chrome.cookies.Cookie>();
    for (const c of allCookies) {
      const existing = uniqueCookies.get(c.name);
      if (!existing) {
        uniqueCookies.set(c.name, c);
        continue;
      }

      const existingValid = isValidCookieValue(existing.value);
      const currentValid = isValidCookieValue(c.value);

      if (!existingValid && currentValid) {
        uniqueCookies.set(c.name, c);
        continue;
      }

      if (currentValid && existingValid) {
        const existingLen = existing.value?.length || 0;
        const currentLen = c.value?.length || 0;
        if (currentLen > existingLen) {
          uniqueCookies.set(c.name, c);
        }
      }
    }
    const cookies = Array.from(uniqueCookies.values());

    logger.info('csdn', '获取到的 Cookie', {
      count: cookies.length,
      names: cookies.map(c => c.name)
    });

    // CSDN 的关键 Cookie - 检查多种可能的登录标识
    // 1. 明确的用户标识 Cookie
    const userNameCookie = cookies.find(c => c.name === 'UserName' && c.value && c.value.length > 0);
    const userNickCookie = cookies.find(c => c.name === 'UserNick' && c.value && c.value.length > 0);
    const userInfoCookie = cookies.find(c => c.name === 'UserInfo' && c.value && c.value.length > 0);
    const userTokenCookie = cookies.find(c => c.name === 'UserToken' && c.value && c.value.length > 0);
    const unCookie = cookies.find(c => c.name === 'UN' && c.value && c.value.length > 0);

    // 2. 登录后才有的 Cookie
    const cSegmentCookie = cookies.find(c => c.name === 'c_segment' && c.value && c.value.length > 0);
    const creativeBtnCookie = cookies.find(c => c.name === 'creative_btn_mp' && c.value);
    const loginboxCookie = cookies.find(c => c.name === 'loginbox_strategy' && c.value);
    const sessionCookie = cookies.find(c => c.name === 'SESSION' && c.value && c.value.length > 10);
    const dcSessionCookie = cookies.find(c => c.name === 'dc_session_id' && c.value && c.value.length > 10);

    // 3. 日志相关 Cookie（登录用户才会有这些）
    const logIdClickCookie = cookies.find(c => c.name === 'log_Id_click' && c.value);
    const logIdPvCookie = cookies.find(c => c.name === 'log_Id_pv' && c.value);
    const logIdViewCookie = cookies.find(c => c.name === 'log_Id_view' && c.value);

    // 4. 检查是否有任何看起来像登录状态的 Cookie
    // CSDN 可能使用不同的 Cookie 名称，所以我们检查是否有任何包含 user/User/login/Login 的 Cookie
    const hasUserRelatedCookie = cookies.some(c => {
      const nameLower = c.name.toLowerCase();
      return (nameLower.includes('user') || nameLower.includes('login') || nameLower.includes('token') || nameLower.includes('session')) &&
        c.value && c.value.length > 5;
    });

    // 优先检查明确的用户标识 Cookie
    const hasUserCookie = userNameCookie || userNickCookie || userInfoCookie || userTokenCookie || unCookie;
    // 其次检查登录后才有的 Cookie
    const hasSessionCookie = cSegmentCookie || creativeBtnCookie || loginboxCookie ||
      sessionCookie || dcSessionCookie;
    // 最后检查日志相关 Cookie
    const hasLogCookie = logIdClickCookie || logIdPvCookie || logIdViewCookie;

    const hasValidSession = hasUserCookie || hasSessionCookie || hasLogCookie || hasUserRelatedCookie;

    if (hasValidSession) {
      // 尝试从 Cookie 获取用户名
      const userIdFromCookie = userNameCookie?.value ? decodeURIComponent(userNameCookie.value) :
        userNickCookie?.value ? decodeURIComponent(userNickCookie.value) :
        unCookie?.value ? decodeURIComponent(unCookie.value) : undefined;

      // 对标 cose：Cookie 识别登录后，尽量补齐昵称/头像（不打开 tab）
      let nickname: string | undefined;
      let avatar: string | undefined;

      if (userIdFromCookie) {
        const profile = await fetchProfileFromHtml(userIdFromCookie);
        nickname = profile?.nickname;
        avatar = profile?.avatar;
      }

      logger.info('csdn', '检测到有效的登录 Cookie，判定为已登录', { userId: userIdFromCookie, hasProfile: !!(nickname || avatar) });
      return {
        loggedIn: true,
        platform: 'csdn',
        userId: userIdFromCookie,
        nickname: nickname || userIdFromCookie || 'CSDN用户',
        avatar: avatar,
        detectionMethod: nickname || avatar ? 'html' : 'cookie',
      };
    }

    logger.info('csdn', '未找到有效的登录 Cookie');
    return {
      loggedIn: false,
      platform: 'csdn',
      errorType: AuthErrorType.LOGGED_OUT,
      error: '登录已过期',
      retryable: false
    };
  },
};

const zhihuApi: PlatformApiConfig = {
  id: 'zhihu',
  name: '知乎',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://www.zhihu.com/api/v4/me');

      return parseApiResponse(res, 'zhihu', (data) => {
        if (data.id) {
          return {
            loggedIn: true,
            platform: 'zhihu',
            userId: data.id,
            nickname: data.name,
            avatar: data.avatar_url,
            meta: {
              followersCount: data.follower_count,
              articlesCount: data.articles_count,
            },
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('zhihu', 'API 调用失败', e);
      return { loggedIn: false, platform: 'zhihu', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

const bilibiliApi: PlatformApiConfig = {
  id: 'bilibili',
  name: 'B站专栏',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://api.bilibili.com/x/web-interface/nav');

      return parseApiResponse(res, 'bilibili', (data) => {
        if (data.code === 0 && data.data?.isLogin) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'bilibili',
            userId: String(user.mid),
            nickname: user.uname,
            avatar: user.face,
            meta: {
              level: user.level_info?.current_level,
              followersCount: user.follower,
            },
          };
        }
        // B站明确返回未登录
        if (data.code === 0 && data.data && !data.data.isLogin) {
          return { loggedIn: false, platform: 'bilibili', errorType: AuthErrorType.LOGGED_OUT, error: '未登录' };
        }
        // B站特定错误码
        if (data.code === -101) {
          return { loggedIn: false, platform: 'bilibili', errorType: AuthErrorType.LOGGED_OUT, error: '账号未登录' };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('bilibili', 'API 调用失败', e);
      return { loggedIn: false, platform: 'bilibili', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

// 简书 - 优先使用 API，失败时使用 Cookie 检测
const jianshuApi: PlatformApiConfig = {
  id: 'jianshu',
  name: '简书',
  async fetchUserInfo(): Promise<UserInfo> {
    const tryParseProfileFromHtml = async (): Promise<Pick<UserInfo, 'userId' | 'nickname' | 'avatar'> | null> => {
      const res = await fetchWithCookies(
        'https://www.jianshu.com/settings/basic',
        {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            Referer: 'https://www.jianshu.com/',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        },
        0
      );

      const finalUrl = res.url || 'https://www.jianshu.com/settings/basic';
      if (finalUrl.includes('/sign_in')) return null;

      const html = await res.text();
      const slugMatch = html.match(/href=['"]\/u\/([a-zA-Z0-9]+)['"]/);
      const slug = slugMatch?.[1];
      if (slug && /^\d+$/.test(slug)) return null;

      const nameMatch =
        html.match(/<a[^>]*\bclass=['"][^"']*\bname\b[^"']*['"][^>]*\bhref=['"]\/u\/[a-zA-Z0-9]+['"][^>]*>([^<]+)<\/a>/i) ||
        html.match(/<a[^>]*\bhref=['"]\/u\/[a-zA-Z0-9]+['"][^>]*\bclass=['"][^"']*\bname\b[^"']*['"][^>]*>([^<]+)<\/a>/i);
      const nickname = nameMatch?.[1]?.trim();

      const avatarMatch =
        html.match(/<a[^>]*\bclass=['"][^"']*\bavatar\b[^"']*['"][^>]*>[\s\S]*?<img[^>]*\bsrc=['"]([^'"]+)['"]/i) ||
        html.match(/<img[^>]*\bsrc=['"]([^'"]+)['"][^>]*\bclass=['"][^"']*\bavatar\b[^"']*['"]/i);
      const avatar = avatarMatch?.[1]?.trim();

      if (!slug && !nickname && !avatar) return null;
      return { userId: slug, nickname, avatar };
    };

    // 先尝试 API
    try {
      const res = await fetchWithCookies('https://www.jianshu.com/shakespeare/v2/user/info', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://www.jianshu.com/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        const payload = data?.data || data?.result || data;
        if (payload?.id) {
          // 简书用户主页格式为 https://www.jianshu.com/u/{slug}
          // slug 是类似 bb8f42a96b80 的字符串，不是数字 id
          // 必须使用 slug，不能使用数字 id
          const userId = typeof payload.slug === 'string' && payload.slug.trim().length > 0 ? payload.slug : undefined;
          const nickname = payload.nickname || payload.user?.nickname;
          const avatar = payload.avatar || payload.user?.avatar;
          logger.info('jianshu', 'API 成功', { userId, slug: payload.slug, id: payload.id });
          return {
            loggedIn: true,
            platform: 'jianshu',
            userId: userId,
            nickname: nickname,
            avatar: avatar,
            meta: {
              followersCount: payload.followers_count,
              articlesCount: payload.public_notes_count,
            },
          };
        }
      }
    } catch (e: any) {
      logger.warn('jianshu', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    const cookies = await chrome.cookies.getAll({ url: 'https://www.jianshu.com/' });
    logger.info('jianshu', '获取到的 Cookie', {
      count: cookies.length,
      names: cookies.map(c => c.name)
    });

    // 简书的关键 Cookie
    const rememberToken = cookies.find(c => c.name === 'remember_user_token' && c.value && c.value.length > 10);
    const sessionCore = cookies.find(c => c.name === '_m7e_session_core' && c.value && c.value.length > 10);
    const sensorsData = cookies.find(c => c.name.includes('sensorsdata') && c.value);

    if (rememberToken || sessionCore || sensorsData) {
      logger.info('jianshu', '检测到有效的登录 Cookie，判定为已登录');

      // 尝试用 HTML 探针从设置页提取昵称/slug（不打开标签页）
      try {
        const profile = await tryParseProfileFromHtml();
        if (profile) {
          return {
            loggedIn: true,
            platform: 'jianshu',
            userId: profile.userId,
            nickname: profile.nickname || '简书用户',
            avatar: profile.avatar,
            detectionMethod: 'html',
          };
        }
      } catch (e: any) {
        logger.warn('jianshu', 'HTML 探针失败', { error: e?.message || String(e) });
      }

      // 注意：Cookie 检测无法稳定获取 slug，所以不强行设置 userId
      return {
        loggedIn: true,
        platform: 'jianshu',
        nickname: '简书用户',
        detectionMethod: 'cookie',
      };
    }

    logger.info('jianshu', '未找到有效的登录 Cookie');
    return {
      loggedIn: false,
      platform: 'jianshu',
      errorType: AuthErrorType.LOGGED_OUT,
      error: '登录已过期',
      retryable: false
    };
  },
};

// 博客园 - 先尝试 API 获取用户信息（包含 blogApp），失败则用 Cookie 检测
const cnblogsApi: PlatformApiConfig = {
  id: 'cnblogs',
  name: '博客园',
  async fetchUserInfo(): Promise<UserInfo> {
    // 先尝试多个 API 端点获取用户信息（优先 i.cnblogs.com 的 JSON API）
    const apiEndpoints = [
      'https://i.cnblogs.com/api/user',
      'https://home.cnblogs.com/api/user',
      'https://home.cnblogs.com/user/GetMyInfo',
      'https://www.cnblogs.com/api/user',
    ];

    const normalizeUrl = (url?: unknown, base = 'https://www.cnblogs.com'): string | undefined => {
      const candidate =
        typeof url === 'string'
          ? url
          : url && typeof url === 'object'
            ? (url as any).url || (url as any).src || (url as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `${base}${trimmed}`;
      return trimmed;
    };

    const tryFetchAvatarFromHome = async (blogApp: string): Promise<string | undefined> => {
      try {
        const res = await fetchWithCookies(`https://home.cnblogs.com/u/${blogApp}/`, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://home.cnblogs.com/',
          },
        });

        if (!res.ok) return undefined;
        const html = await res.text();
        const head = html.substring(0, 30000);

        const patterns = [
          /<img[^>]+class=["'][^"']*(?:avatar|u_avatar|user-avatar|user_avatar)[^"']*["'][^>]+src=["']([^"']+)["']/i,
          /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*(?:avatar|u_avatar|user-avatar|user_avatar)[^"']*["']/i,
          /<img[^>]+src=["'](https?:\/\/[^"']*pic\.cnblogs\.com\/avatar[^"']+)["']/i,
          /<img[^>]+src=["'](https?:\/\/[^"']*cnblogs[^"']*avatar[^"']+)["']/i,
        ];

        for (const pattern of patterns) {
          const match = head.match(pattern);
          if (match?.[1]) {
            const normalized = normalizeUrl(match[1], 'https://home.cnblogs.com');
            if (normalized && !/favicon|sprite|logo/i.test(normalized)) {
              return normalized;
            }
          }
        }
      } catch (e: any) {
        logger.debug('cnblogs', 'Failed to fetch avatar from home page', { error: e?.message || String(e) });
      }
      return undefined;
    };

    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint, {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://www.cnblogs.com/',
          },
        });

        if (res.ok) {
          const text = await res.text();
          const preview = text.substring(0, 500);
          logger.info('cnblogs', `API ${endpoint} 响应`, { preview });

          // 处理未登录时的跳转/HTML 页面
          if (preview.trim().startsWith('<')) {
            continue;
          }

          try {
            const data = JSON.parse(text);
            const userData = data?.data || data?.result || data?.content || data;

            const isBlogApp = (value: unknown): value is string =>
              typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,}$/.test(value);

            // 检查是否有用户信息 - blogApp 是关键字段
            const blogApp = isBlogApp(userData?.blogApp) ? userData.blogApp
              : isBlogApp(data?.blogApp) ? data.blogApp
                : isBlogApp(userData?.userId) ? userData.userId
                  : isBlogApp(data?.userId) ? data.userId
                    : undefined;

            const displayName = userData?.displayName || userData?.DisplayName || data?.displayName || data?.DisplayName;
            const nickname = displayName || blogApp || userData?.nickname || userData?.name || '博客园用户';
            const avatar =
              normalizeUrl(
                userData?.avatar ||
                userData?.avatarUrl ||
                userData?.avatarURL ||
                userData?.avatar_url ||
                userData?.Avatar ||
                userData?.AvatarUrl ||
                userData?.portrait ||
                userData?.icon ||
                userData?.face ||
                data?.avatar ||
                data?.avatarUrl ||
                data?.avatarURL ||
                data?.avatar_url ||
                data?.Avatar ||
                data?.AvatarUrl
              ) || undefined;

            if (blogApp) {
              const avatarFromHome = avatar || (await tryFetchAvatarFromHome(blogApp));
              logger.info('cnblogs', '从 API 获取到用户信息', {
                blogApp,
                displayName: nickname
              });
              return {
                loggedIn: true,
                platform: 'cnblogs',
                // 使用 blogApp 作为 userId，因为主页 URL 格式为 /u/{blogApp}
                userId: blogApp,
                nickname: nickname,
                avatar: avatarFromHome,
                detectionMethod: 'api',
              };
            }

            // 如果能解析出昵称/头像，也视为已登录（但可能拿不到 blogApp）
            if (nickname && nickname !== '博客园用户') {
              logger.info('cnblogs', '检测到登录但无 blogApp', { endpoint, nickname });
              return {
                loggedIn: true,
                platform: 'cnblogs',
                nickname: nickname,
                avatar: avatar,
                detectionMethod: 'api',
              };
            }
          } catch (parseErr) {
            logger.warn('cnblogs', `API ${endpoint} 响应解析失败`, { error: parseErr });
          }
        }
      } catch (e: any) {
        logger.warn('cnblogs', `API ${endpoint} 调用失败`, { error: e.message });
      }
    }

    // API 失败，使用 Cookie 检测
    const cookies = await chrome.cookies.getAll({ url: 'https://www.cnblogs.com/' });
    const accountCookies = await chrome.cookies.getAll({ url: 'https://account.cnblogs.com/' });
    const passportCookies = await chrome.cookies.getAll({ url: 'https://passport.cnblogs.com/' });
    const homeCookies = await chrome.cookies.getAll({ url: 'https://home.cnblogs.com/' });
    const iCookies = await chrome.cookies.getAll({ url: 'https://i.cnblogs.com/' });
    const allCookies = [...cookies, ...accountCookies, ...passportCookies, ...homeCookies, ...iCookies];

    logger.info('cnblogs', '获取到的 Cookie', {
      count: allCookies.length,
      names: allCookies.map(c => c.name)
    });

    // 博客园的关键 Cookie - 检查多种可能的登录标识
    // 1. .Cnblogs.AspNetCore.Cookies - 主要的认证 Cookie
    // 2. 任何包含 CNBlogs/Cnblogs/AspNetCore 的 Cookie
    // 3. _ga 等分析 Cookie 不能作为登录标识
    const isValidValue = (value?: string) => {
      if (!value) return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined';
    };
    const hasValidSession = allCookies.some(c => {
      const name = c.name.toLowerCase();
      const nameMatches = name === '.cnblogs.aspnetcore.cookies' ||
        name.startsWith('.cnblogs.aspnetcore.cookies') || // Cookie chunking (C1/C2...)
        name === '.aspnetcore.cookies' ||
        name.startsWith('.aspnetcore.cookies') ||
        name.includes('cnblogscookie') ||
        (name.includes('aspnetcore') && name.includes('cookies')) ||
        (name.includes('cnblogs') && name.includes('cookie'));
      return nameMatches && isValidValue(c.value);
    });

    if (hasValidSession) {
      logger.info('cnblogs', '检测到有效的登录 Cookie，判定为已登录');
      // Cookie 检测无法获取 blogApp，所以不设置 userId
      // 这样点击用户名时会跳转到设置页面而不是错误的主页
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: '博客园用户',
        detectionMethod: 'cookie',
      };
    }

    logger.info('cnblogs', '未找到有效的登录 Cookie');
    return {
      loggedIn: false,
      platform: 'cnblogs',
      errorType: AuthErrorType.LOGGED_OUT,
      error: '登录已过期',
      retryable: false
    };
  },
};

// 51CTO - rely on cookie detection to avoid refresh-triggered logout
const cto51Api: PlatformApiConfig = {
  id: '51cto',
  name: '51CTO',
  async fetchUserInfo(): Promise<UserInfo> {
    // Prefer non-destructive signals. When cookie-name heuristics fail, probe a login-required HTML page
    // and look for stable markers like `#homeBaseVar[user-id]`.
    const urls = [
      'https://home.51cto.com/',
      'https://blog.51cto.com/',
      'https://passport.51cto.com/',
      'https://ucenter.51cto.com/',
      'https://edu.51cto.com/',
      'https://www.51cto.com/',
    ];
    const allCookies: chrome.cookies.Cookie[] = [];

    for (const url of urls) {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        allCookies.push(...cookies);
      } catch (e: any) {
        logger.warn('51cto', 'Failed to read cookies', { url, error: e?.message || String(e) });
      }
    }

    // Some 51CTO session cookies are scoped to specific subdomains; add domain-based scans to reduce false negatives.
    const domains = [
      '51cto.com',
      'home.51cto.com',
      'blog.51cto.com',
      'passport.51cto.com',
      'ucenter.51cto.com',
      'edu.51cto.com',
      'www.51cto.com',
    ];
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        allCookies.push(...cookies);
      } catch (e: any) {
        logger.warn('51cto', 'Failed to read cookies (domain)', { domain, error: e?.message || String(e) });
      }
    }

    const isValidValue = (value?: string) => {
      if (!value) return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined';
    };

    const sessionCookieNames = [
      'pub_sauth1',
      'pub_sauth2',
      'pub_sauth3',
      'pub_sid',
      'pub_loginuser',
      'LOGIN_ACCOUNT',
      'uc_token',
      'sid',
      'uid',
      'user_id',
      'userid',
      'sauth1',
      'sauth2',
      'sauth3',
      'sauth4',
      'token',
    ];
    const sessionCookieNameSet = new Set(sessionCookieNames.map((n) => n.toLowerCase()));

    const hasSessionCookie = allCookies.some(
      (c) => sessionCookieNameSet.has(c.name.toLowerCase()) && isValidValue(c.value)
    );
    const hasUserRelatedCookie = allCookies.some((c) => {
      const nameLower = c.name.toLowerCase();
      if (!isValidValue(c.value)) return false;
      const valueLooksLikeToken = (c.value?.length || 0) >= 8;
      return valueLooksLikeToken && (
        nameLower.includes('sauth') ||
        nameLower.includes('auth') ||
        nameLower.includes('passport') ||
        nameLower.includes('sso') ||
        nameLower.includes('ticket') ||
        nameLower.includes('tgc') ||
        nameLower.includes('login') ||
        nameLower.includes('token') ||
        nameLower.includes('session') ||
        nameLower.includes('sid') ||
        nameLower.includes('uid') ||
        nameLower.includes('user')
      );
    });

    logger.info('51cto', 'Cookie scan', {
      count: allCookies.length,
      names: Array.from(new Set(allCookies.map((c) => c.name))).slice(0, 30),
    });

    // 不做 cookie-only 的登录结论，避免保存固定占位昵称导致误识别。

    // HTML probe: https://home.51cto.com/index should contain `#homeBaseVar` when logged in.
    // This avoids depending on specific cookie names and helps when cookie APIs are incomplete.
    try {
      const res = await fetchWithCookies(
        'https://home.51cto.com/index',
        {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            Referer: 'https://home.51cto.com/',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        },
        0
      );

      const finalUrl = res.url || 'https://home.51cto.com/index';
      logger.info('51cto', 'HTML probe', { status: res.status, finalUrl });
      if (finalUrl.includes('passport.51cto.com')) {
        return {
          loggedIn: false,
          platform: '51cto',
          errorType: AuthErrorType.LOGGED_OUT,
          error: '登录已过期',
          retryable: false,
          detectionMethod: 'html',
        };
      }

      const html = await res.text();

      // 明确未登录信号（对齐 cose）：优先判定未登录
      if (/(?:var\s+isLogin\s*=\s*0|window\.isLogin\s*=\s*0)/.test(html)) {
        return {
          loggedIn: false,
          platform: '51cto',
          errorType: AuthErrorType.LOGGED_OUT,
          error: '未登录',
          retryable: false,
          detectionMethod: 'html',
        };
      }

      if (/(?:>\s*登录\s*<|home\.51cto\.com\/index\/login)/i.test(html)) {
        return {
          loggedIn: false,
          platform: '51cto',
          errorType: AuthErrorType.LOGGED_OUT,
          error: '需要登录',
          retryable: false,
          detectionMethod: 'html',
        };
      }
      const baseVarMatch = html.match(
        /<div[^>]*\bid=['"]homeBaseVar['"][^>]*\buser-id=['"](\d+)['"][^>]*>/i
      );
      if (baseVarMatch?.[1]) {
        const userId = baseVarMatch[1];
        logger.info('51cto', 'HTML probe hit #homeBaseVar', { userId });
        const avatarMatch = html.match(/https?:\/\/[^"']*ucenter\.51cto\.com\/avatar\.php\?[^"']*/i);
        const namePatterns = [
          /<div[^>]*\bclass=['"][^"']*name[^"']*['"][^>]*>[\s\S]*?<a[^>]*\bclass=['"]left['"][^>]*>([^<]+)<\/a>/i,
          /<div[^>]*\bclass=['"][^"']*user-name[^"']*['"][^>]*>([^<]+)<\/div>/i,
          /<span[^>]*\bclass=['"][^"']*user-name[^"']*['"][^>]*>([^<]+)<\/span>/i,
          /<div[^>]*\bclass=['"][^"']*user-base[^"']*['"][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i,
        ];

        let nickname: string | undefined;
        for (const pattern of namePatterns) {
          const match = html.match(pattern);
          const value = match?.[1]?.trim();
          if (value) {
            nickname = value;
            break;
          }
        }

        return {
          loggedIn: true,
          platform: '51cto',
          userId,
          nickname: nickname || '51CTO用户',
          avatar: avatarMatch?.[0],
          detectionMethod: 'html',
        };
      }

      return {
        loggedIn: false,
        platform: '51cto',
        errorType: AuthErrorType.API_ERROR,
        error: '无法确认登录状态（HTML 探针未命中）',
        retryable: true,
        detectionMethod: 'html',
      };
    } catch (e: any) {
      logger.warn('51cto', 'HTML probe failed', { error: e?.message || String(e) });
    }

    // 51CTO 的登录 Cookie 结构变动较频繁，且部分 Cookie 可能是分区/分路径的；
    // 在无法确认“确实登出”时，宁可返回可重试的异常，也不要误判为已登出并触发重新登录。
    return {
      loggedIn: false,
      platform: '51cto',
      errorType: AuthErrorType.API_ERROR,
      error: '无法确认登录状态（Cookie 可能变更）',
      retryable: true,
      detectionMethod: 'cookie',
    };
  },
};

// 腾讯云开发者社区 - 先尝试 API 获取用户信息，失败则用 Cookie 检测
const tencentCloudApi: PlatformApiConfig = {
  id: 'tencent-cloud',
  name: '腾讯云开发者社区',
  async fetchUserInfo(): Promise<UserInfo> {
    // 先尝试 API 获取用户信息（可以获取到正确的 userId）
    const apiEndpoints = [
      'https://cloud.tencent.com/developer/api/user/info',
      'https://cloud.tencent.com/developer/api/user/current',
    ];

    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint, {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://cloud.tencent.com/',
          },
        });

        if (res.ok) {
          const data = await res.json();
          logger.info('tencent-cloud', `API ${endpoint} 响应`, data);

          if ((data.code === 0 || data.ret === 0) && data.data) {
            const user = data.data;
            const userId = String(user.uin || user.uid || user.id || '');
            const nickname = user.name || user.nickname || user.nick;

            if (userId) {
              logger.info('tencent-cloud', '从 API 获取到用户信息', { userId, nickname });
              return {
                loggedIn: true,
                platform: 'tencent-cloud',
                userId: userId,
                nickname: nickname || '腾讯云用户',
                avatar: user.avatar || user.avatarUrl,
                detectionMethod: 'api',
              };
            }
          }
        }
      } catch (e: any) {
        logger.warn('tencent-cloud', `API ${endpoint} 调用失败`, { error: e.message });
      }
    }

    // API 失败，使用 Cookie 检测
    const cookies = await chrome.cookies.getAll({ url: 'https://cloud.tencent.com/' });
    const developerCookies = await chrome.cookies.getAll({ url: 'https://cloud.tencent.com/developer/' });
    const allCookies = [...cookies, ...developerCookies];

    logger.info('tencent-cloud', '获取到的 Cookie', {
      count: allCookies.length,
      names: allCookies.map(c => c.name)
    });

    // 腾讯云的关键 Cookie - 检查多种可能的登录标识
    // uin/p_uin 是用户 ID，skey/p_skey 是会话密钥
    // 也检查 qcloud_uid, intl, language 等腾讯云特有的 Cookie
    const uinCookie = allCookies.find(c => (c.name === 'uin' || c.name === 'p_uin') && c.value && c.value.length > 3);
    const skeyCookie = allCookies.find(c => (c.name === 'skey' || c.name === 'p_skey') && c.value && c.value.length > 3);
    const qcloudUidCookie = allCookies.find(c => c.name === 'qcloud_uid' && c.value && c.value.length > 3);
    // 检查 intl Cookie（腾讯云登录后会设置）
    const intlCookie = allCookies.find(c => c.name === 'intl' && c.value);
    // 检查 qcmainCSRFToken（CSRF token，登录后才有）
    const csrfCookie = allCookies.find(c => c.name === 'qcmainCSRFToken' && c.value && c.value.length > 10);
    // 检查 loginType（登录类型）
    const loginTypeCookie = allCookies.find(c => c.name === 'loginType' && c.value);
    // 检查 ownerUin（所有者 ID）
    const ownerUinCookie = allCookies.find(c => c.name === 'ownerUin' && c.value && c.value.length > 3);

    const hasValidSession = uinCookie || skeyCookie || qcloudUidCookie || csrfCookie || loginTypeCookie || ownerUinCookie;

    if (hasValidSession) {
      // 尝试从 uin Cookie 获取用户 ID
      // uin 格式可能是 o123456789，需要去掉前缀 o
      let userId = uinCookie?.value?.replace(/^o/, '') ||
        ownerUinCookie?.value?.replace(/^o/, '') ||
        qcloudUidCookie?.value || undefined;

      logger.info('tencent-cloud', '检测到有效的登录 Cookie，判定为已登录', { userId });
      // Cookie 检测可能无法获取正确的 userId，所以不设置 userId
      // 这样点击用户名时会跳转到用户中心而不是错误的主页
      return {
        loggedIn: true,
        platform: 'tencent-cloud',
        // 只有当 userId 看起来像有效的数字 ID 时才设置
        userId: userId && /^\d+$/.test(userId) ? userId : undefined,
        nickname: '腾讯云用户',
        detectionMethod: 'cookie',
      };
    }

    logger.info('tencent-cloud', '未找到有效的登录 Cookie');
    return {
      loggedIn: false,
      platform: 'tencent-cloud',
      errorType: AuthErrorType.LOGGED_OUT,
      error: '登录已过期',
      retryable: false
    };
  },
};

// 阿里云开发者社区 - 直接使用 Cookie 检测（API 不可靠）
const aliyunApi: PlatformApiConfig = {
  id: 'aliyun',
  name: '阿里云开发者社区',
  async fetchUserInfo(): Promise<UserInfo> {
    // API + Cookie 双重确认：避免因 Cookie/接口变更导致误判“登录过期”
    try {
      const res = await fetchWithCookies('https://developer.aliyun.com/developer/api/my/user/getUser', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://developer.aliyun.com/',
        },
      });

      const apiResult = await parseApiResponse(res, 'aliyun', (data) => {
        const code = data?.code ?? data?.errorCode ?? data?.status;
        const message = String(data?.message ?? data?.msg ?? data?.error ?? '');

        // { code: "40001", success: false, message: "用户未登录或登录已失效" }
        if (data?.success === false && (String(code) === '40001' || message.includes('未登录') || message.includes('登录已失效'))) {
          return null;
        }

        const userData = data?.data || data?.result || data?.content || data?.user || data;
        if (userData && typeof userData === 'object') {
          const userId = userData.userId || userData.id || userData.uid || userData.accountId;
          const nickname = userData.nickName || userData.nickname || userData.name || userData.loginId || userData.userName;
          const avatar = userData.avatarUrl || userData.avatar || userData.headUrl;

          if (userId || nickname) {
            return {
              loggedIn: true,
              platform: 'aliyun',
              userId: userId ? String(userId) : undefined,
              nickname: nickname || '阿里云开发者',
              avatar: avatar,
            };
          }
        }

        // 不是“未登录”，但也未能解析出用户信息 -> 视为可重试 API 异常
        if (data?.success === false) {
          return {
            loggedIn: false,
            platform: 'aliyun',
            errorType: AuthErrorType.API_ERROR,
            error: message || 'API 返回异常',
            retryable: true,
          };
        }

        return null;
      });

      if (apiResult.loggedIn) {
        return apiResult;
      }

      // API 判断未登录时，再用 Cookie 兜底，避免误判
      if (apiResult.errorType === AuthErrorType.LOGGED_OUT) {
        const cookieResult = await detectViaCookies('aliyun');
        if (cookieResult.loggedIn) {
          return {
            loggedIn: true,
            platform: 'aliyun',
            nickname: '阿里云开发者',
            detectionMethod: 'cookie',
          };
        }
      }

      return apiResult;
    } catch (e: any) {
      logger.warn('aliyun', 'API 调用失败，回退到 Cookie 检测', { error: e.message });
      return detectViaCookies('aliyun');
    }
  },
};

const segmentfaultApi: PlatformApiConfig = {
  id: 'segmentfault',
  name: '思否',
  async fetchUserInfo(): Promise<UserInfo> {
    // 思否 API 端点 - 按优先级排序
    // 1. 首先尝试 /api/users/-/info 接口（思否新版 API）
    // 2. 然后尝试 /api/user/info 接口
    // 3. 最后尝试从主页 HTML 中提取用户信息

    // 方法1: 尝试思否用户信息 API
    const normalizeUrl = (url?: unknown): string | undefined => {
      const candidate =
        typeof url === 'string'
          ? url
          : url && typeof url === 'object'
            ? (url as any).url || (url as any).src || (url as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `https://segmentfault.com${trimmed}`;
      return trimmed;
    };

    const normalizeSlug = (raw?: unknown): string | undefined => {
      if (typeof raw !== 'string') return undefined;
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const match = trimmed.match(/\/u\/([^\/?#]+)/);
      const candidate = (match?.[1] || trimmed).trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(candidate)) return undefined;
      if (/^\d+$/.test(candidate)) return undefined;
      return candidate;
    };

    const apiEndpoints = [
      'https://segmentfault.com/api/users/-/info',
      'https://segmentfault.com/api/user/info',
      'https://segmentfault.com/api/user/-/info',
      'https://segmentfault.com/gateway/user/-/info',
    ];

    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint, {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://segmentfault.com/',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });

        if (res.ok) {
          const text = await res.text();
          // 检查是否是 HTML（重定向到登录页）
          if (text.startsWith('<!') || text.startsWith('<html')) {
            logger.info('segmentfault', `API ${endpoint} 返回 HTML，跳过`);
            continue;
          }

          try {
            const data = JSON.parse(text);
            // 兼容多种响应格式
            const user = data.data || data.user || data;
            const isSuccess = data.status === 0 || data.code === 0 || data.success === true ||
              (user && (user.id || user.uid || user.slug || user.name));

            if (isSuccess && user && (user.id || user.uid || user.slug || user.name)) {
              let userId =
                normalizeSlug(user.slug) ||
                normalizeSlug(user.username) ||
                normalizeSlug(user.user_name) ||
                normalizeSlug(user.url) ||
                normalizeSlug(user.profileUrl) ||
                normalizeSlug(user.profile_url) ||
                normalizeSlug(user.homeUrl) ||
                normalizeSlug(user.home_url) ||
                normalizeSlug(user.html_url) ||
                normalizeSlug(user.href) ||
                normalizeSlug(user.name);
              // 思否 API 中 name 是 URL slug，nickname 才是真实显示名称
              // 优先使用 nickname，其次是 nick，不使用 userId 作为昵称（因为 userId 是 slug）
              let nickname = String(user.nickName || user.nickname || user.nick || user.displayName || '').trim();
              let avatar = normalizeUrl(user.avatar || user.avatarUrl || user.avatar_url || user.head);

              // 如果没有获取到有效的昵称或头像，从用户主页获取
              // 注意：不能用 userId 作为昵称，因为 userId 是 slug（如 abc123），不是真实用户名
              const needFetchProfile = !nickname || !avatar || nickname === userId;
              if (needFetchProfile && userId) {
                try {
                  const profileResult = await fetchSegmentfaultUserProfile(userId);
                  if (profileResult.nickname && profileResult.nickname !== userId) {
                    nickname = profileResult.nickname;
                  }
                  if (profileResult.avatar) {
                    avatar = avatar || profileResult.avatar;
                  }
                } catch { }
              }

              // 如果还是没有昵称/头像，尝试从 HTML 页面获取
              if (!userId || !avatar || !nickname) {
                try {
                  const htmlResult = await fetchSegmentfaultUserFromHtml();
                  if (htmlResult.loggedIn) {
                    userId = userId || htmlResult.userId;
                    avatar = avatar || htmlResult.avatar;
                    if (!nickname && htmlResult.nickname && htmlResult.nickname !== '思否用户') {
                      nickname = htmlResult.nickname;
                    }
                  }
                } catch { }
              }

              logger.info('segmentfault', `从 API ${endpoint} 获取到用户信息`, { userId, nickname, avatar: !!avatar });
              return {
                loggedIn: true,
                platform: 'segmentfault',
                userId: userId,
                nickname: nickname || userId || '思否用户',
                avatar: avatar || undefined,
                meta: {
                  followersCount: user.followers || user.follower_count || user.followersCount,
                  articlesCount: user.articles || user.article_count || user.articlesCount,
                },
                detectionMethod: 'api',
              };
            }
          } catch (parseErr) {
            logger.warn('segmentfault', `API ${endpoint} JSON 解析失败`, { error: (parseErr as Error).message });
          }
        }
      } catch (e: any) {
        logger.warn('segmentfault', `API ${endpoint} 调用失败`, { error: e.message });
      }
    }

    // 方法2: 使用隐藏标签页 + 注入脚本读取 DOM（避免 WAF 拦截）
    logger.info('segmentfault', 'API 检测失败，尝试使用标签页注入方式检测');
    try {
      const tabResult = await detectSegmentfaultViaTab();
      if (tabResult.loggedIn) {
        return tabResult;
      }
    } catch (e: any) {
      logger.warn('segmentfault', '标签页检测失败', { error: e.message });
    }

    // 方法3: 使用 Cookie 检测（只能判断登录状态，无法获取用户信息）
    logger.info('segmentfault', '标签页检测失败，尝试 Cookie 检测');
    return detectViaCookies('segmentfault');
  },
};

/**
 * 通过隐藏标签页 + 注入脚本检测思否登录状态
 * 
 * 这种方式模拟真实用户浏览行为，避免 WAF 拦截：
 * 1. 创建一个非激活的后台标签页访问思否主页
 * 2. 等待页面加载完成
 * 3. 注入脚本读取页面 DOM 中的用户信息
 * 4. 获取数据后关闭标签页
 */
async function detectSegmentfaultViaTab(): Promise<UserInfo> {
  // 检查缓存，避免短时间内重复创建标签页
  if (segmentfaultTabDetectionCache && 
      Date.now() - segmentfaultTabDetectionCache.timestamp < SEGMENTFAULT_CACHE_TTL) {
    logger.info('segmentfault', '使用缓存的检测结果');
    return segmentfaultTabDetectionCache.result;
  }
  
  let tab: chrome.tabs.Tab | null = null;
  
  try {
    // 1. 创建隐藏标签页
    tab = await chrome.tabs.create({ 
      url: 'https://segmentfault.com/', 
      active: false 
    });
    
    if (!tab.id) {
      throw new Error('无法创建标签页');
    }
    
    const tabId = tab.id;
    logger.info('segmentfault', '创建隐藏标签页', { tabId });

    // 2. 轮询注入脚本读取 DOM（不等整页 complete，降低平均检测耗时）
    const startedAt = Date.now();
    const timeoutMs = 6000;
    let result: any;
    let injectImmediatelySupported = true;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const injection: any = {
          target: { tabId },
          func: extractSegmentfaultUserFromDom,
        };
        if (injectImmediatelySupported) {
          injection.injectImmediately = true;
        }
        const results = await chrome.scripting.executeScript(injection);
        const candidate = results?.[0]?.result;
        if (candidate) result = candidate;

        const candidateNickname = typeof candidate?.nickname === 'string' ? candidate.nickname.trim() : '';
        const candidateUserId = typeof candidate?.userId === 'string' ? candidate.userId.trim() : '';
        const hasMeaningfulNickname =
          !!candidateNickname && candidateNickname !== '思否用户' && (!candidateUserId || candidateNickname !== candidateUserId);

        if (candidate?.loggedIn && hasMeaningfulNickname) break;
      } catch (e: any) {
        if (injectImmediatelySupported) {
          const message = String(e?.message || e);
          if (message.includes('injectImmediately')) {
            injectImmediatelySupported = false;
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    logger.info('segmentfault', '标签页注入脚本执行结果', result);
     
    let userInfo: UserInfo;
    if (result?.loggedIn) {
      userInfo = {
        loggedIn: true,
        platform: 'segmentfault',
        userId: result.userId,
        nickname: result.nickname || result.userId || '思否用户',
        avatar: result.avatar,
        detectionMethod: 'tab',
      };
    } else {
      userInfo = {
        loggedIn: false,
        platform: 'segmentfault',
        error: result?.error || '未检测到登录状态',
        errorType: AuthErrorType.LOGGED_OUT,
        detectionMethod: 'tab',
      };
    }
    
    // 缓存结果
    segmentfaultTabDetectionCache = { result: userInfo, timestamp: Date.now() };
    
    return userInfo;
  } finally {
    // 4. 关闭标签页
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
        logger.info('segmentfault', '已关闭隐藏标签页');
      } catch {}
    }
  }
}

// 缓存思否检测结果，避免短时间内重复创建标签页
let segmentfaultTabDetectionCache: { result: UserInfo; timestamp: number } | null = null;
const SEGMENTFAULT_CACHE_TTL = 30000; // 30秒缓存

/**
 * 在思否页面中执行的 DOM 提取函数
 * 此函数会被注入到标签页中执行
 */
function extractSegmentfaultUserFromDom(): { 
  loggedIn: boolean; 
  userId?: string; 
  nickname?: string; 
  avatar?: string;
  error?: string;
} {
  try {
    // 辅助函数：检查是否是有效的 slug
    const isValidSlug = (value: string): boolean => {
      const v = value.trim();
      if (!v || v.length > 50) return false;
      return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(v) && !/^\d+$/.test(v);
    };
    
    // 辅助函数：检查是否是有效的昵称
    const isValidNickname = (text: string): boolean => {
      if (!text || text.length > 50) return false;
      const excludedTexts = ['登录', '注册', '退出', '设置', '我的', '首页', '写文章', 'Login', 'Register', 'Settings', '消息', '通知'];
      const trimmed = text.trim();
      if (!trimmed) return false;
      // 排除纯 slug 格式
      if (isValidSlug(trimmed)) return false;
      return !excludedTexts.some(e => trimmed === e || trimmed.toLowerCase() === e.toLowerCase());
    };
    
    let userId: string | undefined;
    let nickname: string | undefined;
    let avatar: string | undefined;
    
    // 方法1: 从 __NEXT_DATA__ 提取（Next.js 应用，最可靠）
    const nextDataScript = document.querySelector('script#__NEXT_DATA__');
    if (nextDataScript?.textContent) {
      try {
        const nextData = JSON.parse(nextDataScript.textContent);
        // 递归查找用户信息
        const findUser = (obj: any, depth = 0): any => {
          if (!obj || depth > 6) return null;
          if (typeof obj !== 'object') return null;
          // 检查是否是用户对象
          if (obj.nickname && typeof obj.nickname === 'string' && obj.slug) {
            return obj;
          }
          // 检查常见字段
          for (const key of ['user', 'userInfo', 'currentUser', 'pageProps', 'props', 'data', 'state']) {
            if (obj[key] && typeof obj[key] === 'object') {
              const found = findUser(obj[key], depth + 1);
              if (found) return found;
            }
          }
          // 遍历其他字段
          for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object') {
              const found = findUser(obj[key], depth + 1);
              if (found) return found;
            }
          }
          return null;
        };
        const user = findUser(nextData);
        if (user) {
          if (user.slug && isValidSlug(user.slug)) userId = user.slug;
          if (user.nickname && isValidNickname(user.nickname)) nickname = user.nickname;
          if (user.avatar) avatar = user.avatar.startsWith('//') ? `https:${user.avatar}` : user.avatar;
        }
      } catch {}
    }
    
    // 方法2: 从全局变量提取
    if (!userId || !nickname) {
      const win = window as any;
      const sources = [win.__INITIAL_STATE__, win.__NUXT__, win.G_USER, win.USER_INFO];
      
      for (const source of sources) {
        if (!source) continue;
        const candidates = [source, source.user, source.userInfo, source.currentUser, source.auth?.user];
        for (const user of candidates) {
          if (!user || typeof user !== 'object') continue;
          if (!userId) {
            const slug = user.slug || user.username || user.user_name || user.name;
            if (typeof slug === 'string' && isValidSlug(slug)) {
              userId = slug.trim();
            }
          }
          if (!nickname) {
            const nameField = typeof user.name === 'string' ? user.name.trim() : '';
            const displayName =
              user.nickName ||
              user.nickname ||
              user.nick ||
              user.displayName ||
              (!isValidSlug(nameField) ? nameField : '');
            if (typeof displayName === 'string' && displayName.trim() && isValidNickname(displayName)) {
              nickname = displayName.trim();
            }
          }
          if (!avatar) {
            const av = user.avatar || user.avatarUrl || user.avatar_url;
            if (typeof av === 'string' && av.trim()) {
              avatar = av.startsWith('//') ? `https:${av}` : av;
            }
          }
          if (userId && nickname && avatar) break;
        }
        if (userId && nickname && avatar) break;
      }
    }
    
    // 方法3: 从导航栏用户菜单提取
    const header = document.querySelector('header, .navbar, nav, [role="navigation"], [class*="header"]');
    if (header) {
      // 尽量限定到“当前登录用户菜单”区域，避免误抓文章作者等 /u/{slug} 链接
      let userMenu: Element | null = null;
      const dropdownSelectors = [
        '.nav-user-dropdown',
        '.user-dropdown',
        '[class*="nav-user"]',
        '[class*="user-dropdown"]',
        '[class*="user-menu"]',
        '.dropdown',
        '[class*="dropdown"]',
      ];
      for (const selector of dropdownSelectors) {
        const dropdowns = header.querySelectorAll(selector);
        for (const dropdown of dropdowns) {
          const hasUserMenuMarker = !!dropdown.querySelector(
            'a[href*="/user/settings"], a[href*="/user/logout"], a[href*="logout"], a[href*="settings"]'
          );
          if (hasUserMenuMarker) {
            userMenu = dropdown;
            break;
          }
        }
        if (userMenu) break;
      }

      const scope = userMenu || header;

      // 查找指向用户主页的链接 /u/{slug}
      const userLinks = scope.querySelectorAll('a[href*="/u/"]') as NodeListOf<HTMLAnchorElement>;
      for (const link of userLinks) {
        const href = link.href || link.getAttribute('href') || '';
        const match = href.match(/\/u\/([^\/\?#]+)/);
        if (match?.[1] && isValidSlug(match[1])) {
          if (!userId) userId = match[1].trim();
          
          // 尝试从链接附近获取头像
          if (!avatar) {
            const img = link.querySelector('img') as HTMLImageElement;
            if (img?.src && !img.src.includes('default') && !img.src.includes('placeholder')) {
              avatar = img.src;
            }
          }
          
          // 尝试获取昵称
          if (!nickname) {
            const title = link.getAttribute('title')?.trim();
            if (title && isValidNickname(title)) {
              nickname = title;
            }
          }
          if (!nickname) {
            const ariaLabel = link.getAttribute('aria-label')?.trim();
            if (ariaLabel && isValidNickname(ariaLabel)) {
              nickname = ariaLabel;
            }
          }
          if (!nickname) {
            const linkText = link.textContent?.trim();
            if (linkText && isValidNickname(linkText)) {
              nickname = linkText;
            }
          }
          if (!nickname) {
            const nicknameSelectors = [
              '[class*="nickname"]',
              '[class*="user-name"]',
              '[class*="username"]',
              '.dropdown-toggle span',
              '[data-toggle] span',
              '[aria-haspopup] span',
            ];
            const containers = [userMenu, link, link.parentElement, link.closest('.dropdown, [class*="dropdown"], [class*="user"]')]
              .filter(Boolean) as Element[];
            for (const container of containers) {
              for (const selector of nicknameSelectors) {
                const el = container.querySelector(selector);
                const text = el?.textContent?.trim();
                if (text && isValidNickname(text)) {
                  nickname = text;
                  break;
                }
              }
              if (nickname) break;
            }
          }
           
          break;
        }
      }
      
      // 如果没有找到头像，尝试从 header 中的 avatar 类图片获取
      if (!avatar) {
        const avatarImgs = header.querySelectorAll('img[class*="avatar"], img[src*="avatar"]') as NodeListOf<HTMLImageElement>;
        for (const img of avatarImgs) {
          if (img.src && !img.src.includes('default') && !img.src.includes('placeholder')) {
            avatar = img.src;
            break;
          }
        }
      }

      // 如果已登录但用户菜单是“按需渲染”，尝试点击一次头像/菜单触发器展开下拉菜单（节流，避免来回切换）
      if (!userId || !nickname) {
        try {
          const win = window as any;
          const lastClickAt = typeof win.__synccaster_sf_menu_click_ts === 'number' ? win.__synccaster_sf_menu_click_ts : 0;
          if (Date.now() - lastClickAt > 1500) {
            const avatarImg =
              (header.querySelector('img[src*="cdn.segmentfault"], img[class*="avatar"], img[src*="avatar"]') as HTMLImageElement) ||
              null;
            const trigger = (avatarImg?.closest(
              '[aria-haspopup], [aria-expanded], [data-toggle], .dropdown-toggle, button, [role="button"]'
            ) || null) as HTMLElement | null;
            if (trigger && trigger.getAttribute('aria-expanded') !== 'true') {
              trigger.click();
              win.__synccaster_sf_menu_click_ts = Date.now();
            }
          }
        } catch {}
      }
    }
    
    // 方法4: 检查是否有登录按钮（未登录标识）
    const loginBtnSelectors = [
      'a[href*="/user/login"]',
      '.login-btn',
    ];
    
    let hasLoginBtn = false;
    for (const selector of loginBtnSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
          hasLoginBtn = true;
          break;
        }
      } catch {}
    }
    
    // 方法4: 检查是否有退出/设置按钮（已登录标识）
    const loggedInSelectors = [
      'a[href*="/user/logout"]',
      'a[href*="/user/settings"]',
    ];
    
    let hasLoggedInMarker = false;
    for (const selector of loggedInSelectors) {
      if (document.querySelector(selector)) {
        hasLoggedInMarker = true;
        break;
      }
    }
    
    // 判断登录状态
    if (userId || hasLoggedInMarker) {
      return {
        loggedIn: true,
        userId,
        nickname,
        avatar,
      };
    }
    
    if (hasLoginBtn) {
      return {
        loggedIn: false,
        error: '检测到登录按钮',
      };
    }
    
    return {
      loggedIn: false,
      error: '未检测到登录状态',
    };
  } catch (e: any) {
    return {
      loggedIn: false,
      error: e.message || '检测异常',
    };
  }
}

/**
 * 从思否用户主页获取用户信息
 * 
 * 访问 https://segmentfault.com/u/{userId} 获取用户的真实昵称和头像
 * 用户主页包含用户的显示名称（不是 slug）和头像 URL
 * 
 * @param userId 用户的 slug（如 abc123）
 * @returns 包含 nickname 和 avatar 的对象
 */
async function fetchSegmentfaultUserProfile(userId: string): Promise<{ nickname?: string; avatar?: string }> {
  const result: { nickname?: string; avatar?: string } = {};
  
  try {
    const profileUrl = `https://segmentfault.com/u/${userId}`;
    const res = await fetchWithCookies(profileUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://segmentfault.com/',
      },
    });

    if (!res.ok) {
      logger.warn('segmentfault', `获取用户主页失败: HTTP ${res.status}`, { userId });
      return result;
    }

    const html = await res.text();
    
    // 方法1: 从 __INITIAL_STATE__ 或 __NUXT__ 中提取用户信息
    const stateMarkers = ['__INITIAL_STATE__', '__NUXT__', 'window.__INITIAL_STATE__'];
    for (const marker of stateMarkers) {
      const markerIdx = html.indexOf(marker);
      if (markerIdx >= 0) {
        // 查找 JSON 对象的开始
        const startIdx = html.indexOf('{', markerIdx);
        if (startIdx >= 0 && startIdx < markerIdx + 100) {
          // 简单提取 JSON（找到匹配的结束括号）
          let depth = 0;
          let inString = false;
          let escape = false;
          for (let i = startIdx; i < Math.min(html.length, startIdx + 50000); i++) {
            const ch = html[i];
            if (inString) {
              if (escape) escape = false;
              else if (ch === '\\') escape = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                try {
                  const json = JSON.parse(html.slice(startIdx, i + 1));
                  // 递归查找用户信息
                  const findUser = (obj: any, maxDepth = 5): any => {
                    if (!obj || maxDepth <= 0) return null;
                    if (typeof obj !== 'object') return null;
                    // 检查是否是用户对象
                    if (obj.nickname && typeof obj.nickname === 'string' && obj.nickname !== userId) {
                      return obj;
                    }
                    if (obj.user && typeof obj.user === 'object') {
                      const found = findUser(obj.user, maxDepth - 1);
                      if (found) return found;
                    }
                    if (obj.userInfo && typeof obj.userInfo === 'object') {
                      const found = findUser(obj.userInfo, maxDepth - 1);
                      if (found) return found;
                    }
                    for (const key of Object.keys(obj)) {
                      if (typeof obj[key] === 'object') {
                        const found = findUser(obj[key], maxDepth - 1);
                        if (found) return found;
                      }
                    }
                    return null;
                  };
                  const user = findUser(json);
                  if (user) {
                    if (user.nickname && user.nickname !== userId) {
                      result.nickname = user.nickname;
                    }
                    if (user.avatar || user.avatarUrl || user.avatar_url) {
                      let avatar = user.avatar || user.avatarUrl || user.avatar_url;
                      if (avatar.startsWith('//')) avatar = `https:${avatar}`;
                      result.avatar = avatar;
                    }
                    if (result.nickname) {
                      logger.info('segmentfault', `从用户主页 JSON 获取到用户信息`, { userId, nickname: result.nickname });
                      return result;
                    }
                  }
                } catch { }
                break;
              }
            }
          }
        }
      }
    }

    // 方法2: 从 HTML 中提取用户名（通常在 h1 或 h3 标签中）
    // 思否用户主页的用户名通常在 class 包含 "username" 或 "nickname" 的元素中
    const nicknamePatterns = [
      /<h1[^>]*class="[^"]*(?:username|nickname|user-name)[^"]*"[^>]*>([^<]+)<\/h1>/i,
      /<h3[^>]*class="[^"]*(?:username|nickname|user-name|text-center)[^"]*"[^>]*>([^<]+)<\/h3>/i,
      /<span[^>]*class="[^"]*(?:username|nickname|user-name)[^"]*"[^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class="[^"]*user-info[^"]*"[^>]*>[\s\S]*?<(?:h1|h2|h3|span)[^>]*>([^<]+)<\/(?:h1|h2|h3|span)>/i,
      // 思否用户主页的用户名格式
      /<h1[^>]*>([^<]+)<\/h1>/i,
    ];
    
    for (const pattern of nicknamePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const nickname = match[1].trim();
        // 过滤掉无效的用户名
        if (nickname && nickname.length <= 50 && nickname !== userId && 
            !['思否', '登录', '注册', 'SegmentFault'].includes(nickname)) {
          result.nickname = nickname;
          break;
        }
      }
    }

    // 方法3: 从 HTML 中提取头像
    const avatarPatterns = [
      /<img[^>]*class="[^"]*(?:avatar|user-avatar)[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]*src="([^"]+)"[^>]*class="[^"]*(?:avatar|user-avatar)[^"]*"/i,
      /avatar[^"]*"[^>]*src="(https?:\/\/[^"]+(?:avatar|head)[^"]*)"/i,
    ];
    
    for (const pattern of avatarPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let avatar = match[1].trim();
        if (avatar.startsWith('//')) avatar = `https:${avatar}`;
        if (avatar.startsWith('http')) {
          result.avatar = avatar;
          break;
        }
      }
    }

    if (result.nickname || result.avatar) {
      logger.info('segmentfault', `从用户主页获取到用户信息`, { userId, nickname: result.nickname, avatar: !!result.avatar });
    }
  } catch (e: any) {
    logger.warn('segmentfault', `获取用户主页失败`, { userId, error: e.message });
  }

  return result;
}

/**
 * 从思否主页 HTML 中提取用户信息
 * 
 * 思否网站在登录后，页面中会包含用户信息：
 * 1. 全局变量 window.__INITIAL_STATE__ 或 window.__NUXT__
 * 2. 页面 script 标签中的 JSON 数据
 * 3. 用户头像和用户名的 DOM 元素
 */
async function fetchSegmentfaultUserFromHtml(): Promise<UserInfo> {
  const fetchHtml = async (
    url: string
  ): Promise<{ html?: string; redirectedToLogin?: boolean; status?: number; error?: string }> => {
    try {
      const res = await fetchWithCookies(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://segmentfault.com/',
        },
      });

      if (!res.ok) {
        return { status: res.status, error: `HTTP ${res.status}` };
      }

      const finalUrl = res.url || url;
      const redirectedToLogin = /\/user\/login/i.test(finalUrl);
      const html = await res.text();
      return { html, redirectedToLogin };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  };

  const parseHtml = async (html: string, sourceLabel: string): Promise<UserInfo> => {
    const headerHtml = (() => {
      const headerStart = html.search(/<header\b/i);
      if (headerStart < 0) return html.substring(0, 25000);

      const headerEnd = html.indexOf('</header>', headerStart);
      if (headerEnd < 0) return html.substring(headerStart, Math.min(html.length, headerStart + 25000));
      return html.substring(headerStart, headerEnd + '</header>'.length);
    })();

    const headerLower = headerHtml.toLowerCase();
    const userMenuMarkerIndex = (() => {
      const markers = ['/user/settings', '/user/logout', 'logout', 'signout'];
      for (const marker of markers) {
        const idx = headerLower.indexOf(marker);
        if (idx >= 0) return idx;
      }

      const zhMarkers = ['退出', '设置'];
      for (const marker of zhMarkers) {
        const idx = headerHtml.indexOf(marker);
        if (idx >= 0) return idx;
      }

      return -1;
    })();

    const hasUserMenuMarker = userMenuMarkerIndex >= 0;
    const menuHtml =
      hasUserMenuMarker
        ? headerHtml.substring(
          Math.max(0, userMenuMarkerIndex - 6000),
          Math.min(headerHtml.length, userMenuMarkerIndex + 6000)
        )
        : headerHtml;

    const normalizeUrl = (url?: unknown): string | undefined => {
      const candidate =
        typeof url === 'string'
          ? url
          : url && typeof url === 'object'
            ? (url as any).url || (url as any).src || (url as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `https://segmentfault.com${trimmed}`;
      return trimmed;
    };

    const normalizeSlug = (raw?: unknown): string | undefined => {
      if (typeof raw !== 'string') return undefined;
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const match = trimmed.match(/\/u\/([^\/?#]+)/);
      const candidate = (match?.[1] || trimmed).trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(candidate)) return undefined;
      if (/^\d+$/.test(candidate)) return undefined;
      return candidate;
    };

    // 辅助函数：判断是否是 slug 格式（非真实用户名）
    const isSlugLike = (value: string): boolean => {
      const v = value.trim();
      if (!v || v.length > 50) return false;
      return /^[a-zA-Z0-9_-]{2,50}$/.test(v);
    };

    const decodeHtmlEntities = (value: string): string =>
      value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const extractJsonFromMarker = (source: string, marker: string): any | null => {
      const idx = source.indexOf(marker);
      if (idx < 0) return null;
      const startObj = source.indexOf('{', idx + marker.length);
      const startArr = source.indexOf('[', idx + marker.length);
      let start = startObj;
      if (startArr >= 0 && (startArr < start || start < 0)) start = startArr;
      if (start < 0) return null;

      let depth = 0;
      let inString = false;
      let escape = false;

      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
          if (escape) {
            escape = false;
          } else if (ch === '\\') {
            escape = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{' || ch === '[') {
          depth++;
        } else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            const json = source.slice(start, i + 1);
            try {
              return JSON.parse(json);
            } catch {
              return null;
            }
          }
        }
      }
      return null;
    };

    // 辅助函数：过滤无效的用户名
    const isValidNickname = (text: string): boolean => {
      if (!text || text.length > 50) return false;
      const excludedTexts = ['我的', '设置', '退出', '登录', '登出', 'logout', 'settings', 'profile', '个人中心'];
      return !excludedTexts.includes(text.trim());
    };

    const buildUserInfo = (user: any, label: string): UserInfo | null => {
      if (!user || !(user.id || user.uid || user.slug || user.name || user.username || user.user_name)) return null;
      // 思否中 name 是 URL slug，nickname 才是真实显示名称
      const nameField = typeof user.name === 'string' ? user.name : '';
      const displayName =
        user.nickName ||
        user.nickname ||
        user.nick ||
        (!isSlugLike(nameField) ? nameField : '') ||
        '';

      const userId =
        normalizeSlug(user.slug) ||
        normalizeSlug(user.username) ||
        normalizeSlug(user.user_name) ||
        normalizeSlug(user.url) ||
        normalizeSlug(user.profileUrl) ||
        normalizeSlug(user.profile_url) ||
        normalizeSlug(user.homeUrl) ||
        normalizeSlug(user.home_url) ||
        normalizeSlug(user.html_url) ||
        normalizeSlug(user.href) ||
        normalizeSlug(user.name);

      if (!userId && !displayName) return null;

      logger.info('segmentfault', `${label} (${sourceLabel})`, {
        nickname: displayName,
        slug: user.name,
      });

      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId,
        nickname: displayName || userId || '思否用户',
        avatar: normalizeUrl(user.avatar || user.avatarUrl || user.avatar_url),
        detectionMethod: 'html',
      };
    };

    // 1. 尝试从 __INITIAL_STATE__ 或 __NUXT__ 中提取
    // 注意：不同页面可能存在空格/换行，因此仅用 marker 名称定位，再用括号计数提取 JSON
    const stateMarkers = ['window.__INITIAL_STATE__', 'window.__NUXT__', '__INITIAL_STATE__'];

    for (const marker of stateMarkers) {
      const state = extractJsonFromMarker(html, marker);
      if (!state) continue;
      // 只从“当前登录用户”相关字段中提取，避免误抓页面内容中的其他用户（如文章作者）
      const candidates = [
        state.currentUser,
        state.auth?.user,
        state.auth?.currentUser,
        state.global?.currentUser,
        state.global?.user,
        state.data?.currentUser,
        state.state?.auth?.user,
        state.state?.currentUser,
      ].filter(Boolean);

      for (const candidate of candidates) {
        const info = buildUserInfo(candidate, '从 __INITIAL_STATE__ 获取到用户信息');
        if (info) return info;
      }
    }

    // 2. 尝试从 __NEXT_DATA__ 中提取（Next.js 页面）
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch?.[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const candidates = [
          nextData?.props?.pageProps?.currentUser,
          nextData?.props?.pageProps?.auth?.user,
          nextData?.props?.pageProps?.auth?.currentUser,
          nextData?.props?.pageProps?.initialState?.currentUser,
          nextData?.props?.pageProps?.initialState?.auth?.user,
          nextData?.props?.pageProps?.initialState?.auth?.currentUser,
          nextData?.props?.pageProps?.initialState?.global?.currentUser,
          nextData?.props?.pageProps?.initialState?.state?.auth?.user,
          nextData?.props?.pageProps?.initialState?.state?.currentUser,
        ].filter(Boolean);

        for (const candidate of candidates) {
          const info = buildUserInfo(candidate, '从 __NEXT_DATA__ 获取到用户信息');
          if (info) return info;
        }
      } catch { }
    }

    // 3. 尝试从 script 标签中的 JSON 数据提取
    const scriptJsonPatterns = [
      /"currentUser"\s*:\s*(\{[^}]+\})/,
    ];

    for (const pattern of scriptJsonPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        try {
          const user = JSON.parse(match[1]);
          const info = buildUserInfo(user, '从 script JSON 获取到用户信息');
          if (info) return info;
        } catch { }
      }
    }

    // 4. 从 HTML DOM 结构中提取用户信息
    // 思否登录后，页面右上角会显示用户头像和用户名

    // 提取用户头像 URL
    const avatarPatterns = [
      /class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/i,
      /src="([^"]+)"[^>]*class="[^"]*avatar[^"]*"/i,
      /class="[^"]*user-avatar[^"]*"[^>]*src="([^"]+)"/i,
      /<img[^>]+src="(https?:\/\/[^"]*avatar[^"]*)"[^>]*>/i,
      /avatar[^"]*"[^>]*style="[^"]*background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i,
    ];

    let avatar: string | undefined;
    for (const pattern of avatarPatterns) {
      const match = menuHtml.match(pattern) || headerHtml.match(pattern);
      if (match?.[1] && !match[1].includes('default') && !match[1].includes('placeholder')) {
        avatar = normalizeUrl(match[1]);
        break;
      }
    }

    if (!avatar && sourceLabel === 'settings') {
      // settings 页面头像提取：更精确地匹配用户头像
      const settingsAvatarPatterns = [
        // 设置页面的头像上传区域
        /<img[^>]+class="[^"]*(?:avatar|user-avatar|profile-avatar)[^"]*"[^>]+src=["']([^"']+)["']/i,
        /<img[^>]+src=["']([^"']+)["'][^>]+class="[^"]*(?:avatar|user-avatar|profile-avatar)[^"]*"/i,
        // 用户信息区域的头像
        /<div[^>]*class="[^"]*(?:user-info|profile-info|avatar-container)[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
        // data-avatar 属性
        /data-avatar=["']([^"']+)["']/i,
        // 思否 CDN 头像链接（更宽松的匹配）
        /<img[^>]+src=["'](https?:\/\/[^"']*(?:avatar|static|cdn)[^"']*\.(?:jpg|jpeg|png|gif|webp)[^"']*)["']/i,
        // 任何带 avatar 关键字的图片
        /<img[^>]+(?:src|data-src)=["']([^"']*avatar[^"']*)["']/i,
      ];

      for (const pattern of settingsAvatarPatterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
          const url = match[1].trim();
          if (url && !/default|placeholder|logo|icon|banner/i.test(url)) {
            avatar = normalizeUrl(url);
            if (avatar) {
              logger.info('segmentfault', '从 settings 页面提取到头像', { avatar: avatar.substring(0, 80) });
              break;
            }
          }
        }
      }
      
      // 从 JSON 数据提取头像
      if (!avatar) {
        const jsonMarkers = ['__INITIAL_STATE__', '__NUXT__', 'window.__INITIAL_STATE__'];
        for (const marker of jsonMarkers) {
          const markerIdx = html.indexOf(marker);
          if (markerIdx >= 0) {
            // 使用正则直接提取 avatar 字段
            const avatarMatch = html.substring(markerIdx, markerIdx + 50000).match(/"avatar"\s*:\s*"([^"]+)"/);
            if (avatarMatch?.[1]) {
              let av = avatarMatch[1].trim();
              if (av && !/default|placeholder/i.test(av)) {
                if (av.startsWith('//')) av = `https:${av}`;
                if (av.startsWith('http') || av.startsWith('/')) {
                  avatar = normalizeUrl(av);
                  if (avatar) {
                    logger.info('segmentfault', '从 settings JSON 提取到头像', { avatar: avatar.substring(0, 80) });
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 提取用户 slug（用于获取用户主页）
    // 关键：只从导航栏/header 区域提取，避免误匹配文章作者
    let userId: string | undefined;

    // 1. 首先尝试从“当前登录用户菜单”附近提取（最可靠）
    const collectSlugsFromHtml = (sourceHtml: string): string[] => {
      const slugs: string[] = [];
      const re = /href="(?:https?:\/\/segmentfault\.com)?\/u\/([^"\/?#]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = re.exec(sourceHtml))) {
        const slug = normalizeSlug(match[1]);
        if (slug) slugs.push(slug);
      }
      return slugs;
    };

    if (hasUserMenuMarker) {
      let uniqueSlugs = Array.from(new Set(collectSlugsFromHtml(menuHtml)));
      if (uniqueSlugs.length === 0) {
        uniqueSlugs = Array.from(new Set(collectSlugsFromHtml(headerHtml)));
      }
      if (uniqueSlugs.length > 0) {
        userId = uniqueSlugs[0];
        logger.info('segmentfault', '从当前登录用户菜单提取到 userId', {
          userId,
          candidates: uniqueSlugs.slice(0, 3),
          total: uniqueSlugs.length,
        });
      }
    }

    // 2. 如果没找到，尝试从 header 标签内匹配（但要更严格）
    // 只匹配导航栏区域，不匹配页面内容
    if (!userId && hasUserMenuMarker) {
      // 匹配 <header> 标签内的用户链接（限定在前 5000 字符，通常是导航栏）
      const navHtml = headerHtml.substring(0, 5000);
      const headerTagMatch = navHtml.match(/<header[^>]*>[\s\S]*?href="\/u\/([a-zA-Z0-9][a-zA-Z0-9_-]{1,49})"[\s\S]*?<\/header>/i);
      if (headerTagMatch?.[1]) {
        userId = normalizeSlug(headerTagMatch[1]);
        logger.info('segmentfault', '从 header 标签提取到 userId', { userId });
      }
    }

    if (!userId && sourceLabel === 'settings') {
      // settings 页更适合从 header/top 区域提取，避免误匹配页面内容里的其他用户链接
      const slugMatch = headerHtml.match(
        /href="(?:https?:\/\/segmentfault\.com)?\/u\/([a-zA-Z0-9][a-zA-Z0-9_-]{1,49})"/i
      );
      if (slugMatch?.[1]) {
        userId = normalizeSlug(slugMatch[1]);
        logger.info('segmentfault', '从 settings 页面提取到 userId', { userId });
      }
    }

    // 3. 不再使用通用的 /u/ 链接匹配，因为这会误匹配文章作者

    // 提取用户名 - 优先从导航栏提取
    let nickname: string | undefined;
    const nicknamePatterns = [
      /class="[^"]*user-?name[^"]*"[^>]*>([^<]+)</i,
      /class="[^"]*nickname[^"]*"[^>]*>([^<]+)</i,
    ];

    const nicknameSearchHtml = hasUserMenuMarker ? menuHtml : '';

    for (const pattern of nicknamePatterns) {
      const match = nicknameSearchHtml.match(pattern);
      if (match?.[1]) {
        const value = match[1].trim();
        if (
          value &&
          value.length > 0 &&
          value.length < 50 &&
          !value.includes('<') &&
          !isSlugLike(value) &&
          isValidNickname(value)
        ) {
          nickname = value;
          break;
        }
      }
    }

    if (!nickname && sourceLabel === 'settings') {
      // 思否 settings 页面的昵称可能在多种位置：
      // 1. input 表单字段
      // 2. JSON 数据（__INITIAL_STATE__ 或 __NUXT__）
      // 3. 页面标题或其他元素
      
      // 方法1: 从 input 表单提取
      const inputPatterns = [
        /<input[^>]+name=["'](?:name|nickname|displayName|nick|user_name|userName)["'][^>]*value=["']([^"']+)["']/i,
        /<input[^>]+value=["']([^"']+)["'][^>]*name=["'](?:name|nickname|displayName|nick|user_name|userName)["']/i,
        // 思否可能使用 id 而不是 name
        /<input[^>]+id=["'](?:name|nickname|displayName|nick)["'][^>]*value=["']([^"']+)["']/i,
        /<input[^>]+value=["']([^"']+)["'][^>]*id=["'](?:name|nickname|displayName|nick)["']/i,
      ];
      
      for (const pattern of inputPatterns) {
        const inputMatch = html.match(pattern);
        const value = inputMatch?.[1] ? decodeHtmlEntities(inputMatch[1]).trim() : '';
        if (value && value.length > 0 && value.length < 50 && !isSlugLike(value) && isValidNickname(value)) {
          nickname = value;
          logger.info('segmentfault', '从 settings 表单提取到昵称', { nickname });
          break;
        }
      }
      
      // 方法2: 从 JSON 数据提取（__INITIAL_STATE__ 或 __NUXT__）
      if (!nickname) {
        const jsonMarkers = ['__INITIAL_STATE__', '__NUXT__', 'window.__INITIAL_STATE__'];
        for (const marker of jsonMarkers) {
          const markerIdx = html.indexOf(marker);
          if (markerIdx >= 0) {
            const startIdx = html.indexOf('{', markerIdx);
            if (startIdx >= 0 && startIdx < markerIdx + 100) {
              let depth = 0;
              let inString = false;
              let escape = false;
              for (let i = startIdx; i < Math.min(html.length, startIdx + 100000); i++) {
                const ch = html[i];
                if (inString) {
                  if (escape) escape = false;
                  else if (ch === '\\') escape = true;
                  else if (ch === '"') inString = false;
                  continue;
                }
                if (ch === '"') { inString = true; continue; }
                if (ch === '{') depth++;
                else if (ch === '}') {
                  depth--;
                  if (depth === 0) {
                    try {
                      const json = JSON.parse(html.slice(startIdx, i + 1));
                      // 递归查找用户信息
                      const findUserInfo = (obj: any, maxDepth = 6): { nickname?: string; avatar?: string } | null => {
                        if (!obj || maxDepth <= 0) return null;
                        if (typeof obj !== 'object') return null;
                        // 检查是否是用户对象
                        if (obj.nickname && typeof obj.nickname === 'string') {
                          const nick = obj.nickname.trim();
                          if (nick && nick.length < 50 && !isSlugLike(nick) && isValidNickname(nick)) {
                            return {
                              nickname: nick,
                              avatar: obj.avatar || obj.avatarUrl || obj.avatar_url,
                            };
                          }
                        }
                        // 检查 user/userInfo/currentUser 等常见字段
                        const userFields = ['user', 'userInfo', 'currentUser', 'profile', 'me', 'account'];
                        for (const field of userFields) {
                          if (obj[field] && typeof obj[field] === 'object') {
                            const found = findUserInfo(obj[field], maxDepth - 1);
                            if (found?.nickname) return found;
                          }
                        }
                        // 遍历其他字段
                        for (const key of Object.keys(obj)) {
                          if (typeof obj[key] === 'object') {
                            const found = findUserInfo(obj[key], maxDepth - 1);
                            if (found?.nickname) return found;
                          }
                        }
                        return null;
                      };
                      const userInfo = findUserInfo(json);
                      if (userInfo?.nickname) {
                        nickname = userInfo.nickname;
                        logger.info('segmentfault', '从 settings JSON 提取到昵称', { nickname });
                        if (userInfo.avatar && !avatar) {
                          let av = userInfo.avatar;
                          if (av.startsWith('//')) av = `https:${av}`;
                          avatar = normalizeUrl(av);
                          logger.info('segmentfault', '从 settings JSON 提取到头像', { avatar: avatar?.substring(0, 80) });
                        }
                      }
                    } catch { }
                    break;
                  }
                }
              }
            }
            if (nickname) break;
          }
        }
      }
      
      // 方法3: 从页面标题提取（格式可能是 "用户名 - 设置 - SegmentFault 思否"）
      // 注意：思否 settings 页面标题通常是 "账号设置 - SegmentFault 思否"，不包含用户名
      // 所以这个方法在 settings 页面基本不会成功，保留作为备选
      if (!nickname) {
        const titleMatch = html.match(/<title>([^<\-]+)\s*[-–—]/i);
        if (titleMatch?.[1]) {
          const value = titleMatch[1].trim();
          // 排除常见的页面标题关键词
          const excludedTitles = [
            '设置', '个人设置', '账号设置', '账户设置', '安全设置', '隐私设置',
            'Settings', 'Account', 'Profile', 'SegmentFault', '思否',
            '首页', '主页', 'Home', '登录', '注册', 'Login', 'Register'
          ];
          if (value && value.length > 0 && value.length < 50 && 
              !isSlugLike(value) && isValidNickname(value) &&
              !excludedTitles.some(t => value.includes(t))) {
            nickname = value;
            logger.info('segmentfault', '从 settings 页面标题提取到昵称', { nickname });
          }
        }
      }
    }

    // 4. 如果有用户 slug，尽量从用户主页获取权威昵称/头像（最稳定，避免误抓页面其他用户）
    // settings 页是最可靠的入口：一旦拿到 slug，就用用户主页校准昵称/头像
    // 注意：用户主页可能被 WAF 拦截，所以这只是补充方案
    const shouldFetchProfile =
      !!userId &&
      (!nickname || !avatar || !isValidNickname(nickname) || isSlugLike(nickname));

    if (shouldFetchProfile) {
      try {
        const userPageRes = await fetchWithCookies(`https://segmentfault.com/u/${userId}`, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://segmentfault.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (userPageRes.ok) {
          const userPageHtml = await userPageRes.text();
          logger.info('segmentfault', '获取用户主页成功', { userId, length: userPageHtml.length });

          // 检查是否被 WAF 拦截（雷池等安全检测页面）
          const isWafPage = userPageHtml.includes('安全检测') || 
                           userPageHtml.includes('SafeLine') || 
                           userPageHtml.includes('challenge') ||
                           userPageHtml.length < 5000;
          
          if (isWafPage) {
            logger.warn('segmentfault', '用户主页被 WAF 拦截', { userId, length: userPageHtml.length });
          } else {
            // 方法1: 从 __NEXT_DATA__ JSON 提取（Next.js 应用）
            const nextDataMatch = userPageHtml.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i);
            if (nextDataMatch?.[1]) {
              try {
                const nextData = JSON.parse(nextDataMatch[1]);
                // 递归查找用户信息
                const findUserInNextData = (obj: any, maxDepth = 8): { nickname?: string; avatar?: string } | null => {
                  if (!obj || maxDepth <= 0) return null;
                  if (typeof obj !== 'object') return null;
                  
                  // 检查是否是用户对象（思否用户对象通常有 name/nickname 和 avatar）
                  if (obj.nickname && typeof obj.nickname === 'string') {
                    const nick = obj.nickname.trim();
                    if (nick && nick.length < 50 && !isSlugLike(nick) && isValidNickname(nick)) {
                      return {
                        nickname: nick,
                        avatar: obj.avatar || obj.avatarUrl || obj.avatar_url,
                      };
                    }
                  }
                  // 思否可能使用 name 字段存储显示名称
                  if (obj.name && typeof obj.name === 'string' && obj.slug) {
                    const name = obj.name.trim();
                    if (name && name.length < 50 && name !== obj.slug && !isSlugLike(name) && isValidNickname(name)) {
                      return {
                        nickname: name,
                        avatar: obj.avatar || obj.avatarUrl || obj.avatar_url,
                      };
                    }
                  }
                  
                  // 优先检查常见的用户字段
                  const userFields = ['user', 'userInfo', 'currentUser', 'profile', 'author', 'pageProps', 'props', 'data'];
                  for (const field of userFields) {
                    if (obj[field] && typeof obj[field] === 'object') {
                      const found = findUserInNextData(obj[field], maxDepth - 1);
                      if (found?.nickname) return found;
                    }
                  }
                  
                  // 遍历其他字段
                  for (const key of Object.keys(obj)) {
                    if (typeof obj[key] === 'object' && !userFields.includes(key)) {
                      const found = findUserInNextData(obj[key], maxDepth - 1);
                      if (found?.nickname) return found;
                    }
                  }
                  return null;
                };
                
                const userInfo = findUserInNextData(nextData);
                if (userInfo?.nickname) {
                  nickname = userInfo.nickname;
                  logger.info('segmentfault', '从用户主页 __NEXT_DATA__ 提取到用户名', { nickname });
                  if (userInfo.avatar && !avatar) {
                    let av = userInfo.avatar;
                    if (av.startsWith('//')) av = `https:${av}`;
                    avatar = normalizeUrl(av);
                    if (avatar) {
                      logger.info('segmentfault', '从用户主页 __NEXT_DATA__ 提取到头像', { avatar: avatar.substring(0, 80) });
                    }
                  }
                }
              } catch (e) {
                logger.warn('segmentfault', '解析 __NEXT_DATA__ 失败', { error: (e as Error).message });
              }
            }

            // 方法2: 从 HTML 元素提取（如果 __NEXT_DATA__ 没有获取到）
            if (!nickname) {
              // 思否用户主页的用户名在 h3.text-center 元素中
              // 结构：<div class="userinfo"><div class="card-body"><h3 class="text-center pt-3">用户名</h3>
              const userNamePatterns = [
                // h3.text-center 中的用户名（最可靠，根据截图）
                /<h3[^>]*class="[^"]*text-center[^"]*pt-3[^"]*"[^>]*>([^<]+)<\/h3>/i,
                /<h3[^>]*class="[^"]*pt-3[^"]*text-center[^"]*"[^>]*>([^<]+)<\/h3>/i,
                /<h3[^>]*class="[^"]*text-center[^"]*"[^>]*>([^<]+)<\/h3>/i,
                // card-body 内的 h3
                /<div[^>]*class="[^"]*card-body[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/i,
                // 页面标题中的用户名（格式：用户名 - SegmentFault 思否）
                /<title>([^<\-]+)\s*[-–—]\s*SegmentFault/i,
              ];

              for (const pattern of userNamePatterns) {
                const match = userPageHtml.match(pattern);
                if (match?.[1]) {
                  const value = match[1].trim();
                  // 验证是有效的用户名（不是 slug，不是空白，长度合理，不是菜单文本）
                  if (value && value.length > 0 && value.length < 50 && !isSlugLike(value) && isValidNickname(value)) {
                    nickname = value;
                    logger.info('segmentfault', '从用户主页 HTML 提取到用户名', { nickname });
                    break;
                  }
                }
              }
            }

            // 方法3: 提取头像
            if (!avatar) {
              // 思否用户主页头像通常在 .head.rounded-top 区域
              const userAvatarPatterns = [
                // head rounded-top 区域内的头像（根据截图结构）
                /<div[^>]*class="[^"]*head[^"]*rounded-top[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["']/i,
                // card-body 内的头像
                /<div[^>]*class="[^"]*card-body[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["']/i,
                // 带 avatar 类的图片
                /<img[^>]+class="[^"]*avatar[^"]*"[^>]+(?:src|data-src)=["']([^"']+)["']/i,
                /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]+class="[^"]*avatar[^"]*"/i,
                // og:image meta 标签
                /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
              ];

              for (const pattern of userAvatarPatterns) {
                const match = userPageHtml.match(pattern);
                if (match?.[1]) {
                  const url = match[1].trim();
                  // 验证头像 URL 有效性
                  if (url &&
                    !/default|placeholder|logo|icon|banner/i.test(url) &&
                    (url.includes('avatar') || url.includes('user') || url.includes('head') || /\.(jpg|jpeg|png|gif|webp)/i.test(url))) {
                    const normalized = normalizeUrl(url);
                    if (normalized) {
                      avatar = normalized;
                      logger.info('segmentfault', '从用户主页提取到头像', { avatar: avatar.substring(0, 80) });
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e: any) {
        logger.warn('segmentfault', '获取用户主页失败', { error: e.message });
      }
    }

    // 5. 检查是否有登录按钮（未登录标识）
    // 注意：settings 页面可能包含“登录密码/登录设备”等文案，不能用 `html.includes('登录')` 这种粗粒度判断
    const hasLoginButtonRaw =
      /href=["'](?:https?:\/\/segmentfault\.com)?\/user\/login["']/i.test(headerHtml) ||
      /href=["'][^"']*\/user\/login[^"']*["']/i.test(headerHtml) ||
      /<form[^>]+action=["'][^"']*\/user\/login[^"']*["']/i.test(html);
    const hasLogoutButton =
      /\/user\/logout/i.test(headerHtml) ||
      /logout|signout|退出/i.test(headerHtml);
    const hasStrongUserMenuMarker =
      hasUserMenuMarker || hasLogoutButton || /\/user\/settings/i.test(headerHtml) || /\/user\/logout/i.test(headerHtml);
    // 思否页面可能同时包含登录入口 DOM（用于未登录渲染/埋点），但只要出现“用户菜单”强标识，就应忽略登录入口的干扰
    const hasLoginButton = hasStrongUserMenuMarker && userId ? false : hasLoginButtonRaw;

    // settings 页：只要能取到当前用户 slug 即可推断已登录
    // 原因：settings 页面只有登录用户才能访问，能成功获取 HTML 并提取到 userId 就说明已登录
    if (sourceLabel === 'settings' && userId) {
      logger.info('segmentfault', '从 settings 页面推断已登录', { userId, nickname, avatar: !!avatar });
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: userId,
        nickname: nickname || userId || '思否用户',
        avatar: avatar,
        detectionMethod: 'html',
      };
    }

    // 如果有退出按钮或用户头像，说明已登录
    if (
      (hasLogoutButton ||
        headerHtml.includes('user-dropdown') ||
        headerHtml.includes('nav-user-dropdown') ||
        headerHtml.includes('user-menu') ||
        headerHtml.includes('nav-user')) &&
      !hasLoginButton
    ) {
      logger.info('segmentfault', `从 HTML DOM 判断已登录 (${sourceLabel})`, { nickname, avatar: !!avatar, userId });
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: userId,
        nickname: nickname || userId || '思否用户',
        avatar: avatar,
        detectionMethod: 'html',
      };
    }

    // 未检测到登录状态
    return {
      loggedIn: false,
      platform: 'segmentfault',
      error: '未检测到登录状态',
      errorType: AuthErrorType.LOGGED_OUT,
      retryable: false,
      detectionMethod: 'html',
    };
  };

  try {
    const settingsResult = await fetchHtml('https://segmentfault.com/user/settings');
    let loggedOutResult: UserInfo | null = null;

    if (settingsResult.redirectedToLogin) {
      loggedOutResult = {
        loggedIn: false,
        platform: 'segmentfault',
        error: '需要登录',
        errorType: AuthErrorType.LOGGED_OUT,
        retryable: false,
        detectionMethod: 'html',
      };
    }

    if (settingsResult.html) {
      const parsed = await parseHtml(settingsResult.html, 'settings');
      if (parsed.loggedIn) return parsed;
      if (!loggedOutResult && parsed.errorType === AuthErrorType.LOGGED_OUT) {
        loggedOutResult = parsed;
      }
    } else if (settingsResult.error) {
      logger.warn('segmentfault', 'HTML 获取失败（settings）', { error: settingsResult.error });
    }

    const homeResult = await fetchHtml('https://segmentfault.com/');
    if (homeResult.html) {
      const parsed = await parseHtml(homeResult.html, 'home');
      if (parsed.loggedIn) return parsed;
      if (!loggedOutResult && parsed.errorType === AuthErrorType.LOGGED_OUT) {
        loggedOutResult = parsed;
      }
    } else if (homeResult.error) {
      logger.warn('segmentfault', 'HTML 获取失败（home）', { error: homeResult.error });
    }

    if (loggedOutResult) return loggedOutResult;

    return {
      loggedIn: false,
      platform: 'segmentfault',
      error: '未检测到登录状态',
      errorType: AuthErrorType.LOGGED_OUT,
      retryable: false,
      detectionMethod: 'html',
    };
  } catch (e: any) {
    logger.error('segmentfault', 'HTML 提取异常', e);
    return {
      loggedIn: false,
      platform: 'segmentfault',
      error: e.message,
      errorType: AuthErrorType.NETWORK_ERROR,
      retryable: true,
      detectionMethod: 'html',
    };
  }
}

const oschinaApi: PlatformApiConfig = {
  id: 'oschina',
  name: '开源中国',
  async fetchUserInfo(): Promise<UserInfo> {
    // 开源中国检测策略（精准版）：
    // 核心原则：只从用户信息专属区域提取数据，避免误抓页面内容
    // 1. 优先使用用户主页 API（最可靠，返回结构化数据）
    // 2. 其次使用 Cookie 中的用户 ID 访问用户主页
    // 3. 最后从首页顶部导航栏提取（限定在 header/nav 区域）

    // 检测结果收集
    let cookieResult: { hasValidCookie: boolean; userId?: string; noCookieAtAll?: boolean } = { hasValidCookie: false };
    let apiResult: { success: boolean; loggedIn?: boolean; userInfo?: any; error?: string } = { success: false };
    let htmlResult: { success: boolean; loggedIn?: boolean; hasLoginBtn?: boolean; hasLogoutBtn?: boolean; userInfo?: any } = { success: false };

    const normalizeUrl = (url?: unknown, base = 'https://www.oschina.net'): string | undefined => {
      const candidate =
        typeof url === 'string'
          ? url
          : url && typeof url === 'object'
            ? (url as any).url || (url as any).src || (url as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `${base}${trimmed}`;
      return trimmed;
    };

    // 1. Cookie 检测 - 获取用户 ID
    try {
      const mainCookies = await chrome.cookies.getAll({ url: 'https://www.oschina.net/' });
      const myCookies = await chrome.cookies.getAll({ url: 'https://my.oschina.net/' });
      const allCookies = [...mainCookies, ...myCookies];

      logger.info('oschina', '获取到的 Cookie', {
        count: allCookies.length,
        names: allCookies.map(c => c.name).slice(0, 25)
      });

      const isValidValue = (value?: string) => {
        if (!value) return false;
        const trimmed = value.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined' && trimmed.length > 0;
      };

      // 开源中国的关键登录态 Cookie
      const oscidCookie = allCookies.find(c => c.name === 'oscid' && isValidValue(c.value));
      const userIdCookie = allCookies.find(c => c.name === 'osc_id' && isValidValue(c.value));

      cookieResult.noCookieAtAll = allCookies.length === 0;

      if (oscidCookie || userIdCookie) {
        cookieResult.hasValidCookie = true;
        cookieResult.userId = userIdCookie?.value;
        logger.info('oschina', '检测到有效的登录 Cookie', {
          hasOscid: !!oscidCookie,
          userId: cookieResult.userId
        });
      } else {
        logger.info('oschina', '未检测到有效的登录 Cookie');
      }
    } catch (e: any) {
      logger.warn('oschina', 'Cookie 检测失败', { error: e.message });
    }

    // 2. API 检测 - 尝试获取用户信息
    const pickNickname = (...values: unknown[]): string | undefined => {
      for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (trimmed.length > 50) continue;
        // Account can be email/phone; prefer display fields.
        if (trimmed.includes('@')) continue;
        return trimmed;
      }
      return undefined;
    };

    const apiEndpoints = [
      { url: 'https://www.oschina.net/action/user/info', referer: 'https://www.oschina.net/' },
      { url: 'https://my.oschina.net/action/user/info', referer: 'https://my.oschina.net/' },
    ];

    let apiLoggedOut: string | null = null;

    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint.url, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Referer': endpoint.referer,
            'X-Requested-With': 'XMLHttpRequest',
          },
        });

        if (res.ok) {
          const text = await res.text();
          logger.info('oschina', 'API 响应', { status: res.status, textLength: text.length, preview: text.substring(0, 300) });

          if (!text.includes('<!DOCTYPE') && !text.includes('<html') && text.trim()) {
            try {
              const data = JSON.parse(text);
              const user = data.result || data.data || data;

              if (data.code === -1 || data.code === 401 || data.message?.includes('登录') || data.message?.includes('未登录')) {
                apiLoggedOut = 'API 返回未登录';
                logger.info('oschina', 'API 明确返回未登录');
                continue;
              }

              if (user && user.id) {
                const nickname = pickNickname(user.nick, user.nickname, user.name, user.account, user.userName, user.user_name);
                apiResult = {
                  success: true,
                  loggedIn: true,
                  userInfo: {
                    userId: String(user.id),
                    nickname: nickname,
                    avatar: normalizeUrl(
                      user.portrait || user.avatar || user.img || user.avatarUrl || user.avatar_url || user.portraitUrl || user.portrait_url
                    ),
                    meta: {
                      followersCount: user.fansCount || user.fans_count,
                      articlesCount: user.blogCount || user.blog_count,
                    }
                  }
                };
                logger.info('oschina', '从 API 获取到用户信息', { id: user.id, nickname });
                break;
              }
            } catch (parseErr: any) {
              logger.warn('oschina', 'API 响应解析失败', { error: parseErr?.message || String(parseErr) });
            }
          }
        }
      } catch (e: any) {
        logger.warn('oschina', 'API 调用失败', { error: e.message });
      }
    }

    if (!apiResult.success && apiLoggedOut) {
      apiResult = { success: true, loggedIn: false, error: apiLoggedOut };
    }

    // 登录证据：有效的 Cookie 或 API 确认登录
    const hasLoginEvidence = cookieResult.hasValidCookie || (apiResult.success && apiResult.loggedIn);

    // 3. 如有用户 ID，优先从用户主页补全昵称/头像（用户专属区域，避免误抓）
    let profileUserId = cookieResult.userId || apiResult.userInfo?.userId;
    let profileFromHome: { userId?: string; nickname?: string; avatar?: string } | null = null;

    // 尝试从个人空间首页提取用户信息（不需要登录证据，因为 Cookie 检测可能失败）
    const shouldTryHome =
      !profileUserId || (apiResult.userInfo && (!apiResult.userInfo.nickname || !apiResult.userInfo.avatar));

    if (shouldTryHome) {
      try {
        const homeRes = await fetchWithCookies('https://my.oschina.net/', {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://www.oschina.net/',
          },
        });

        if (homeRes.ok) {
          const homeHtml = await homeRes.text();
          const scopeHtml = (() => {
            const lower = homeHtml.toLowerCase();
            const markers = ['sidebar-section user-info', 'space-sidebar', 'user-text', 'avatar-wrap'];
            for (const marker of markers) {
              const idx = lower.indexOf(marker);
              if (idx < 0) continue;
              return homeHtml.substring(Math.max(0, idx - 6000), Math.min(homeHtml.length, idx + 16000));
            }
            return homeHtml.substring(0, 60000);
          })();

          const idMatch = scopeHtml.match(/my\.oschina\.net\/u\/(\d+)/i) || homeHtml.match(/my\.oschina\.net\/u\/(\d+)/i);
          const extractedUserId = idMatch?.[1];

          const nicknamePatterns = [
            /<div[^>]*class="[^"]*sidebar-section[^"]*user-info[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<h3[^>]*class="[^"]*user-name[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<h3[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/h3>/i,
            /<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
          ];

          let nickname: string | undefined;
          for (const pattern of nicknamePatterns) {
            const match = scopeHtml.match(pattern) || homeHtml.match(pattern);
            if (match?.[1]) {
              const value = match[1].trim();
              if (value && value.length > 0 && value.length < 50 && !/^\d+$/.test(value)) {
                nickname = value;
                break;
              }
            }
          }

          const avatarPatterns = [
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*style=["'][^"']*background-image:\s*url\(['"]?([^'")\s]+)['"]?\)[^"']*["']/i,
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*>[\s\S]*?<img[^>]+data-src=["']([^"']+)["']/i,
            /<img[^>]+class="[^"]*(?:user-avatar|portrait|avatar)[^"]*"[^>]+src=["']([^"']+)["']/i,
            /<img[^>]+src=["']([^"']+)["'][^>]+class="[^"]*(?:user-avatar|portrait|avatar)[^"]*"/i,
          ];

          let avatar: string | undefined;
          for (const pattern of avatarPatterns) {
            const match = scopeHtml.match(pattern) || homeHtml.match(pattern);
            if (match?.[1]) {
              const rawUrl = match[1].trim();
              const normalized = normalizeUrl(rawUrl, 'https://my.oschina.net') || normalizeUrl(rawUrl);
              if (
                normalized &&
                !normalized.includes('logo') &&
                !normalized.includes('icon') &&
                !normalized.includes('favicon') &&
                !normalized.includes('sprite') &&
                !normalized.includes('loading') &&
                !normalized.includes('placeholder') &&
                !normalized.includes('default')
              ) {
                avatar = normalized;
                break;
              }
            }
          }

          profileFromHome = {
            userId: extractedUserId,
            nickname,
            avatar,
          };

          if (profileFromHome.userId) {
            profileUserId = profileFromHome.userId;
          }
        }
      } catch (e: any) {
        logger.warn('oschina', '个人空间首页解析失败', { error: e?.message || String(e) });
      }
    }
    // 尝试从用户主页补全信息（不需要登录证据，因为 Cookie 检测可能失败）
    const shouldFetchProfilePage =
      !!profileUserId &&
      (!apiResult.userInfo ||
        !apiResult.userInfo.nickname ||
        !apiResult.userInfo.avatar ||
        apiResult.userInfo.nickname === apiResult.userInfo.userId ||
        (typeof apiResult.userInfo.nickname === 'string' && apiResult.userInfo.nickname.includes('@')));

    if (profileUserId && shouldFetchProfilePage) {
      try {
        const userPageRes = await fetchWithCookies(`https://my.oschina.net/u/${profileUserId}`, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://www.oschina.net/',
          },
        });

        if (userPageRes.ok) {
          const userPageHtml = await userPageRes.text();
          logger.info('oschina', '用户主页获取成功', { length: userPageHtml.length });

          // 扩大搜索范围，包含更多可能的用户信息区域
          const scopeHtml = (() => {
            const lower = userPageHtml.toLowerCase();
            // 开源中国用户主页的用户信息可能在多个区域
            const markers = [
              'sidebar-section user-info',
              'space-sidebar',
              'user-text',
              'avatar-wrap',
              'user-info-section',
              'user-profile',
              'profile-header',
              'user-header',
            ];
            for (const marker of markers) {
              const idx = lower.indexOf(marker);
              if (idx < 0) continue;
              return userPageHtml.substring(Math.max(0, idx - 8000), Math.min(userPageHtml.length, idx + 20000));
            }
            // 如果没有找到特定标记，返回更大范围的内容
            return userPageHtml.substring(0, 80000);
          })();

          // 从用户主页提取信息（这里的信息是用户专属的，不会误抓）
          let nickname: string | undefined;
          let avatar: string | undefined;

          // 用户主页的昵称提取策略（按优先级）：
          // 1. 从用户信息区域的特定元素提取（最可靠）
          // 2. 从 <title> 标签提取

          // 方法1：从用户信息区域提取昵称
          // 开源中国用户主页结构可能变化，需要多种匹配模式
          const userNamePatterns = [
            // 侧边栏用户信息区（截图位置）：<h3 class="user-name">...<span class="name">昵称</span>
            /<div[^>]*class="[^"]*sidebar-section[^"]*user-info[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<h3[^>]*class="[^"]*user-name[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
            // 用户信息卡片中的用户名（最新结构）
            /<div[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/div>/i,
            /<span[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<h1[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/h1>/i,
            /<h2[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/h2>/i,
            // 用户名链接（开源中国常见结构）
            /<a[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/a>/i,
            /<a[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/a>/i,
            // 用户信息区域的昵称
            /<div[^>]*class="[^"]*user-info-name[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
            /<div[^>]*class="[^"]*user-header[^"]*"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i,
            /<div[^>]*class="[^"]*user-header[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/i,
            // 页面中的 h1/h2 标签（用户名）
            /<h1[^>]*>([^<]+)<\/h1>/i,
            /<h2[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/h2>/i,
            // 更通用的用户链接匹配
            /<a[^>]*href="[^"]*\/u\/\d+[^"]*"[^>]*>([^<]+)<\/a>/i,
            // 用户信息卡片中的昵称
            /<div[^>]*class="[^"]*user-info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i,
            // 页面中的 h2/h3 用户名（限定在用户信息区域）
            /<div[^>]*class="[^"]*header[^"]*"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i,
            // 用户昵称/账号名（开源中国自动生成的用户名格式为 osc_XXXXXXXX）
            /<span[^>]*class="[^"]*(?:nickname|account|name)[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<div[^>]*class="[^"]*(?:nickname|account|name)[^"]*"[^>]*>([^<]+)<\/div>/i,
            // 新增：更宽松的用户名匹配
            /<span[^>]*class="name"[^>]*>([^<]+)<\/span>/i,
            /<div[^>]*class="name"[^>]*>([^<]+)<\/div>/i,
          ];

          for (const pattern of userNamePatterns) {
            const match = scopeHtml.match(pattern) || userPageHtml.match(pattern);
            if (match?.[1]) {
              const value = match[1].trim();
              // 验证是有效的用户名（不是空白，长度合理）
              // 注意：开源中国的自动生成用户名格式为 osc_XXXXXXXX，需要支持
              if (value && value.length > 0 && value.length < 50 && !/^\d+$/.test(value)) {
                nickname = value;
                logger.info('oschina', '从用户主页提取到昵称', { nickname, pattern: pattern.toString().substring(0, 50) });
                break;
              }
            }
          }

          // 方法2：从 <title> 标签提取（备用）
          if (!nickname) {
            const titleMatch = userPageHtml.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch?.[1]) {
              const title = titleMatch[1].trim();
              // 移除后缀，格式通常是 "用户名 - 开源中国" 或 "用户名的个人空间"
              const cleanTitle = title
                .replace(/\s*[-–—]\s*开源中国.*$/i, '')
                .replace(/\s*的个人空间.*$/i, '')
                .replace(/\s*的博客.*$/i, '')
                .replace(/\s*-\s*OSCHINA.*$/i, '')
                .replace(/\s*\|.*$/i, '')
                .replace(/\s*-\s*中文开源技术交流社区.*$/i, '')
                .trim();
              // 支持 osc_ 开头的用户名
              if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length < 50 && !/^\d+$/.test(cleanTitle) && cleanTitle !== '个人空间') {
                nickname = cleanTitle;
                logger.info('oschina', '从 title 提取到昵称', { nickname });
              }
            }
          }

          // 用户主页头像提取 - 放宽过滤条件
          // 开源中国的头像可能在多种位置和使用不同的 CDN
          const avatarPatterns = [
            // 侧边栏头像（截图位置）：avatar-wrap 可能使用背景图或 img
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*style=["'][^"']*background-image:\s*url\(['"]?([^'")\s]+)['"]?\)[^"']*["']/i,
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            /<div[^>]*class="[^"]*avatar-wrap[^"]*"[^>]*>[\s\S]*?<img[^>]+data-src=["']([^"']+)["']/i,
            // 用户头像区域（最常见）- class 在 src 前面
            /<img[^>]+class="[^"]*(?:user-avatar|portrait|avatar)[^"]*"[^>]+src=["']([^"']+)["']/i,
            // src 在 class 前面
            /<img[^>]+src=["']([^"']+)["'][^>]+class="[^"]*(?:user-avatar|portrait|avatar)[^"]*"/i,
            // 用户头像区域（div 包裹）
            /<div[^>]*class="[^"]*(?:user-portrait|portrait|avatar|user-avatar)[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            // 用户信息区域的头像
            /<div[^>]*class="[^"]*user-header[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            // 头像链接中的图片
            /<a[^>]*class="[^"]*(?:avatar|portrait)[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            // 用户信息卡片中的头像
            /<div[^>]*class="[^"]*user-info[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i,
            // 更通用的头像匹配 - 开源中国 CDN
            /<img[^>]+src=["'](https?:\/\/[^"']*oscimg[^"']+)["']/i,
            /<img[^>]+src=["'](https?:\/\/[^"']*static\.oschina[^"']+)["']/i,
            // 任何包含 avatar 的图片
            /<img[^>]+src=["']([^"']+avatar[^"']+)["']/i,
            // 任何包含 portrait 的图片
            /<img[^>]+src=["']([^"']+portrait[^"']+)["']/i,
            // 新增：更宽松的头像匹配
            /<img[^>]+class="avatar"[^>]+src=["']([^"']+)["']/i,
            /<img[^>]+src=["']([^"']+)["'][^>]+class="avatar"/i,
          ];

          for (const pattern of avatarPatterns) {
            const match = scopeHtml.match(pattern) || userPageHtml.match(pattern);
            if (match?.[1]) {
              const rawUrl = match[1].trim();
              const normalized = normalizeUrl(rawUrl, 'https://my.oschina.net') || normalizeUrl(rawUrl);
              // 放宽验证条件：只要是有效的 URL 且不是明显的 logo/icon
              if (normalized &&
                !normalized.includes('logo') && !normalized.includes('icon') &&
                !normalized.includes('favicon') && !normalized.includes('sprite') &&
                !normalized.includes('loading') && !normalized.includes('placeholder') &&
                !normalized.includes('default')) {
                avatar = normalized;
                logger.info('oschina', '从用户主页提取到头像', { avatar });
                break;
              }
            }
          }

          if (nickname || avatar) {
            logger.info('oschina', '从用户主页提取到信息', { nickname, avatar: avatar ? '有' : '无' });
            const existingUserInfo = apiResult.userInfo;
            apiResult = {
              success: true,
              loggedIn: true,
              userInfo: {
                userId: profileUserId,
                nickname: nickname || existingUserInfo?.nickname,
                avatar: avatar || existingUserInfo?.avatar,
                meta: existingUserInfo?.meta,
              }
            };
          }
        }
      } catch (e: any) {
        logger.warn('oschina', '用户主页获取失败', { error: e.message });
      }
    }

    // 只有在有登录证据（Cookie 或 API 确认）的情况下，才使用 profileFromHome 的信息
    // 避免将官方推荐用户误判为当前登录用户
    if (hasLoginEvidence && profileFromHome && (profileFromHome.nickname || profileFromHome.avatar || profileFromHome.userId)) {
      if (!apiResult.userInfo || !apiResult.userInfo.nickname || !apiResult.userInfo.avatar) {
        apiResult = {
          success: true,
          loggedIn: true,
          userInfo: {
            userId: profileFromHome.userId || apiResult.userInfo?.userId || profileUserId,
            nickname: profileFromHome.nickname || apiResult.userInfo?.nickname,
            avatar: profileFromHome.avatar || apiResult.userInfo?.avatar,
            meta: apiResult.userInfo?.meta,
          }
        };
      }
    }

    // 4. HTML 首页检测 - 仅用于判断登录状态，不提取用户信息
    try {
      const htmlRes = await fetchWithCookies('https://www.oschina.net/', {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': 'https://www.oschina.net/',
        },
      });

      if (htmlRes.ok) {
        const html = await htmlRes.text();
        logger.info('oschina', 'HTML 页面获取成功', { length: html.length });

        // 只提取页面头部区域（前 20000 字符，通常包含导航栏）
        const headerHtml = html.substring(0, 20000);

        // 检查登录/退出按钮（限定在导航区域）
        const loginPatterns = [
          'href="/home/login"',
          'class="login-btn"',
          'href="https://www.oschina.net/home/login"',
        ];

        const logoutPatterns = [
          'href="/action/user/logout"',
          'action/user/logout',
        ];

        const hasLoginBtn = loginPatterns.some(p => headerHtml.includes(p));
        const hasLogoutBtn = logoutPatterns.some(p => headerHtml.includes(p));

        // 从导航栏提取用户 ID（如果还没有）
        let htmlUserId: string | undefined;
        if (!cookieResult.userId) {
          // 只匹配导航栏中的用户链接
          const userIdMatch = headerHtml.match(/href=["'](?:https?:\/\/)?my\.oschina\.net\/u\/(\d+)["']/);
          if (userIdMatch?.[1]) {
            htmlUserId = userIdMatch[1];
          }
        }

        // 检查是否有用户下拉菜单（已登录标志）
        const hasUserDropdown = headerHtml.includes('user-dropdown') ||
          headerHtml.includes('user-menu') ||
          headerHtml.includes('current-user');

        htmlResult = {
          success: true,
          hasLoginBtn,
          hasLogoutBtn,
          loggedIn: hasLogoutBtn || hasUserDropdown,
          userInfo: htmlUserId ? { userId: htmlUserId } : undefined
        };

        logger.info('oschina', 'HTML 解析结果', {
          hasLoginBtn,
          hasLogoutBtn,
          hasUserDropdown,
          htmlUserId,
          loggedIn: htmlResult.loggedIn
        });
      }
    } catch (e: any) {
      logger.warn('oschina', 'HTML 页面获取失败', { error: e.message });
    }

    // 5. 综合判断登录状态
    logger.info('oschina', '综合检测结果', {
      cookie: { hasValid: cookieResult.hasValidCookie, userId: cookieResult.userId, noCookieAtAll: cookieResult.noCookieAtAll },
      api: { success: apiResult.success, loggedIn: apiResult.loggedIn, hasUserInfo: !!apiResult.userInfo },
      html: { success: htmlResult.success, loggedIn: htmlResult.loggedIn, hasLoginBtn: htmlResult.hasLoginBtn, hasLogoutBtn: htmlResult.hasLogoutBtn }
    });

    // 情况1: API 或用户主页返回了用户信息
    if (apiResult.success && apiResult.loggedIn && apiResult.userInfo) {
      const userInfo = apiResult.userInfo;
      return {
        loggedIn: true,
        platform: 'oschina',
        userId: userInfo.userId,
        // 只有在确实获取到昵称时才使用，否则使用默认值
        nickname: userInfo.nickname || '开源中国用户',
        // 只有在确实获取到头像时才使用
        avatar: userInfo.avatar || undefined,
        meta: userInfo.meta,
        detectionMethod: 'api',
      };
    }

    // 情况2: HTML 检测成功且明确显示未登录（有登录按钮，无退出按钮）
    if (htmlResult.success && htmlResult.hasLoginBtn && !htmlResult.hasLogoutBtn) {
      logger.info('oschina', 'HTML 检测确认未登录');
      return {
        loggedIn: false,
        platform: 'oschina',
        errorType: AuthErrorType.LOGGED_OUT,
        error: '需要登录',
        retryable: false,
      };
    }

    // 情况3: API 明确返回未登录
    if (apiResult.success && apiResult.loggedIn === false) {
      logger.info('oschina', 'API 检测确认未登录');
      return {
        loggedIn: false,
        platform: 'oschina',
        errorType: AuthErrorType.LOGGED_OUT,
        error: '需要登录',
        retryable: false,
      };
    }

    // 情况4: HTML 检测确认已登录（有退出按钮或用户下拉菜单）
    if (htmlResult.success && htmlResult.loggedIn) {
      return {
        loggedIn: true,
        platform: 'oschina',
        userId: cookieResult.userId || htmlResult.userInfo?.userId,
        // 不从 HTML 提取昵称和头像，避免误抓
        nickname: '开源中国用户',
        avatar: undefined,
        detectionMethod: 'html',
      };
    }

    // 情况5: Cookie 有效但 API/HTML 都无法确认
    // 对标 cose：避免仅凭 Cookie 误判（尤其是三方登录残留），宁可标记为可重试
    if (cookieResult.hasValidCookie) {
      logger.info('oschina', 'Cookie 有效但无法从 API/HTML 确认，标记为可重试');
      return {
        loggedIn: false,
        platform: 'oschina',
        errorType: AuthErrorType.API_ERROR,
        error: '无法确认登录状态',
        retryable: true,
        detectionMethod: 'cookie',
      };
    }

    // 情况6: 完全没有 Cookie 且 HTML 检测成功但无登录标志，判定为未登录
    if (cookieResult.noCookieAtAll && htmlResult.success) {
      logger.info('oschina', '无 Cookie 且 HTML 无登录标志，判定为未登录');
      return {
        loggedIn: false,
        platform: 'oschina',
        errorType: AuthErrorType.LOGGED_OUT,
        error: '需要登录',
        retryable: false,
      };
    }

    // 情况7: 所有检测都失败或不确定，标记为可重试
    logger.info('oschina', '所有检测方式都未能确认登录状态，标记为可重试');
    return {
      loggedIn: false,
      platform: 'oschina',
      errorType: AuthErrorType.API_ERROR,
      error: '无法确认登录状态',
      retryable: true,
    };
  },
};

// 微信公众号 - 使用 Cookie 检测，避免打开页面
const wechatApi: PlatformApiConfig = {
  id: 'wechat',
  name: '微信公众号',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 1. 检查关键 Cookie 是否存在（使用 URL 方式获取更完整的 Cookie）
      const wechatCookies = await chrome.cookies.getAll({ url: 'https://mp.weixin.qq.com/' });

      logger.info('wechat', '获取到的 Cookie', {
        count: wechatCookies.length,
        names: wechatCookies.map(c => c.name).slice(0, 15)
      });

      // 微信公众号的关键 Cookie
      // slave_sid / slave_user / data_ticket / bizuin 等都可能表示登录状态
      const sessionCookieNames = ['slave_sid', 'slave_user', 'data_ticket', 'bizuin', 'data_bizuin', 'cert'];
      const isValidValue = (value?: string) => {
        if (!value) return false;
        const trimmed = value.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        return lower !== 'deleted' && lower !== 'null' && lower !== 'undefined';
      };
      const sessionCookieNameSet = new Set(sessionCookieNames.map((n) => n.toLowerCase()));
      const hasValidSession = wechatCookies.some(
        (c) => sessionCookieNameSet.has(c.name.toLowerCase()) && isValidValue(c.value) && c.value.length > 5
      );

      if (!hasValidSession) {
        logger.info('wechat', '未找到有效的登录 Cookie');
        return {
          loggedIn: false,
          platform: 'wechat',
          errorType: AuthErrorType.LOGGED_OUT,
          error: '登录已过期',
          retryable: false
        };
      }

      // 2. 有 Cookie 就认为已登录（微信的 API 验证不可靠，经常返回重定向）
      // 因为微信公众号的 Cookie 有效期较长，且只有登录后才会设置这些 Cookie
      logger.info('wechat', '检测到有效的登录 Cookie，判定为已登录');

      const decodeURIComponentSafe = (value: string) => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };
      const tryParseJson = (text: string) => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };
      const tryDecodeBase64 = (text: string) => {
        const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
        try {
          const BufferLike = (globalThis as any).Buffer;
          if (BufferLike) return BufferLike.from(normalized, 'base64').toString('utf8');
        } catch { }
        try {
          if (typeof atob === 'function') {
            return atob(normalized);
          }
        } catch { }
        return null;
      };

      const slaveUserCookie = wechatCookies.find((c) => c.name === 'slave_user' && isValidValue(c.value));
      const slaveUserRaw = slaveUserCookie?.value;
      const parsedSlaveUser = (() => {
        if (!slaveUserRaw) return null;
        const decoded = decodeURIComponentSafe(slaveUserRaw);
        const direct = tryParseJson(decoded);
        if (direct) return direct;
        const base64Decoded = tryDecodeBase64(decoded) || tryDecodeBase64(slaveUserRaw);
        if (!base64Decoded) return null;
        return tryParseJson(base64Decoded);
      })();
      const slaveUser = parsedSlaveUser?.user || parsedSlaveUser;

      const nickname =
        slaveUser?.nickname ||
        slaveUser?.nick_name ||
        slaveUser?.name ||
        slaveUser?.user_name ||
        slaveUser?.username;
      const avatar =
        slaveUser?.avatar ||
        slaveUser?.headimgurl ||
        slaveUser?.headImgUrl ||
        slaveUser?.head_img ||
        slaveUser?.headimg ||
        slaveUser?.headimg_url ||
        slaveUser?.logo;

      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: nickname || '微信公众号',
        avatar: avatar || undefined,
        detectionMethod: 'cookie',
      };
    } catch (e: any) {
      logger.error('wechat', 'Cookie 检测失败', e);
      return {
        loggedIn: false,
        platform: 'wechat',
        errorType: AuthErrorType.NETWORK_ERROR,
        error: e.message,
        retryable: true
      };
    }
  },
};

// 今日头条 - 使用 Cookie 检测
const toutiaoApi: PlatformApiConfig = {
  id: 'toutiao',
  name: '今日头条',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 尝试 API 获取用户信息
      const res = await fetchWithCookies('https://www.toutiao.com/api/pc/user/info/', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://www.toutiao.com/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        logger.info('toutiao', 'API 响应', data);

        if (data.data && data.data.user_id) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'toutiao',
            userId: String(user.user_id),
            nickname: user.screen_name || user.name || '头条用户',
            avatar: user.avatar_url || user.avatar,
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('toutiao', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    return detectViaCookies('toutiao');
  },
};

// InfoQ - 使用 Cookie 检测
const infoqApi: PlatformApiConfig = {
  id: 'infoq',
  name: 'InfoQ',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 尝试 API 获取用户信息
      const res = await fetchWithCookies('https://www.infoq.cn/public/v1/user/info', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://www.infoq.cn/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        logger.info('infoq', 'API 响应', data);

        const user = data.data || data;
        if (user && (user.uid || user.id || user.userId)) {
          return {
            loggedIn: true,
            platform: 'infoq',
            userId: String(user.uid || user.id || user.userId),
            nickname: user.nickname || user.name || user.userName || 'InfoQ用户',
            avatar: user.avatar || user.avatarUrl,
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('infoq', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    return detectViaCookies('infoq');
  },
};

// 百家号 - 使用 Cookie 检测（百度账号体系）
const baijiahaoApi: PlatformApiConfig = {
  id: 'baijiahao',
  name: '百家号',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 尝试从百家号后台 API 获取用户信息
      const res = await fetchWithCookies('https://baijiahao.baidu.com/pcui/author/query', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://baijiahao.baidu.com/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        logger.info('baijiahao', 'API 响应', data);

        if (data.errno === 0 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'baijiahao',
            userId: String(user.app_id || user.author_id || user.id),
            nickname: user.name || user.author_name || '百家号用户',
            avatar: user.avatar || user.head_img,
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('baijiahao', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    return detectViaCookies('baijiahao');
  },
};

// 网易号 - 使用 Cookie 检测
const wangyihaoApi: PlatformApiConfig = {
  id: 'wangyihao',
  name: '网易号',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 尝试从网易号后台 API 获取用户信息
      const res = await fetchWithCookies('https://mp.163.com/api/user/info', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://mp.163.com/',
        },
      });

      if (res.ok) {
        const data = await res.json();
        logger.info('wangyihao', 'API 响应', data);

        if (data.code === 200 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'wangyihao',
            userId: String(user.userId || user.id || user.uid),
            nickname: user.nickname || user.name || '网易号用户',
            avatar: user.avatar || user.headImgUrl,
            detectionMethod: 'api',
          };
        }
      }
    } catch (e: any) {
      logger.warn('wangyihao', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    return detectViaCookies('wangyihao');
  },
};

// Medium - 使用 Cookie 检测
const mediumApi: PlatformApiConfig = {
  id: 'medium',
  name: 'Medium',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      // 尝试从 Medium API 获取用户信息
      const res = await fetchWithCookies('https://medium.com/_/api/users/me', {
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://medium.com/',
        },
      });

      if (res.ok) {
        const text = await res.text();
        // Medium API 返回的 JSON 前面有 ])}while(1);</x> 前缀
        const jsonStr = text.replace(/^\]\)\}while\(1\);<\/x>/, '');
        try {
          const data = JSON.parse(jsonStr);
          logger.info('medium', 'API 响应', data);

          if (data.payload && data.payload.user) {
            const user = data.payload.user;
            return {
              loggedIn: true,
              platform: 'medium',
              userId: user.username || user.userId,
              nickname: user.name || user.username || 'Medium用户',
              avatar: user.imageId ? `https://miro.medium.com/v2/resize:fill:176:176/${user.imageId}` : undefined,
              detectionMethod: 'api',
            };
          }
        } catch (parseErr) {
          logger.warn('medium', 'API 响应解析失败', { error: (parseErr as Error).message });
        }
      }
    } catch (e: any) {
      logger.warn('medium', 'API 调用失败', { error: e.message });
    }

    // API 失败，使用 Cookie 检测
    return detectViaCookies('medium');
  },
};

// ============================================================
// API 注册表和导出函数
// ============================================================

const platformApis: Record<string, PlatformApiConfig> = {
  juejin: juejinApi,
  csdn: csdnApi,
  zhihu: zhihuApi,
  bilibili: bilibiliApi,
  jianshu: jianshuApi,
  cnblogs: cnblogsApi,
  '51cto': cto51Api,
  'tencent-cloud': tencentCloudApi,
  aliyun: aliyunApi,
  segmentfault: segmentfaultApi,
  oschina: oschinaApi,
  wechat: wechatApi,
  toutiao: toutiaoApi,
  infoq: infoqApi,
  baijiahao: baijiahaoApi,
  wangyihao: wangyihaoApi,
  medium: mediumApi,
};

/**
 * 获取单个平台的用户信息（带 Cookie 回退）
 * 
 * 当主 API 检测失败且错误可重试时，自动尝试 Cookie 检测作为备用方案。
 * 对于 401/403 等明确的登出响应，不会触发回退。
 * 
 * Requirements: 1.1, 1.3, 1.4, 6.3
 */
export async function fetchPlatformUserInfo(platform: string): Promise<UserInfo> {
  const api = platformApis[platform];
  if (!api) {
    return { loggedIn: false, platform, error: '不支持的平台' };
  }

  logger.info('fetch', `获取 ${api.name} 用户信息...`);

  // 使用带 Cookie 回退的检测方式
  const result = await fetchUserInfoWithFallback(platform, () => api.fetchUserInfo());

  logger.info('fetch', `${api.name} 结果:`, {
    loggedIn: result.loggedIn,
    nickname: result.nickname,
    detectionMethod: result.detectionMethod
  });
  return result;
}

/**
 * 批量获取多个平台的用户信息（并行）
 */
export async function fetchMultiplePlatformUserInfo(platforms: string[]): Promise<Map<string, UserInfo>> {
  logger.info('batch-fetch', `批量获取 ${platforms.length} 个平台的用户信息`);

  const results = await Promise.all(
    platforms.map(async (platform) => {
      const info = await fetchPlatformUserInfo(platform);
      return { platform, info };
    })
  );

  const resultMap = new Map<string, UserInfo>();
  for (const { platform, info } of results) {
    resultMap.set(platform, info);
  }

  return resultMap;
}

/**
 * 检查平台是否支持直接 API 调用
 */
export function supportDirectApi(platform: string): boolean {
  // 现在所有平台都支持直接 API 调用（微信使用 Cookie 检测）
  return platform in platformApis;
}
