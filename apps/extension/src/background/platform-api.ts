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
    sessionCookies: ['UserName', 'UserInfo', 'UserToken', 'uuid_tt_dd', 'c_segment', 'dc_session_id', 'c_first_ref', 'c_first_page', 'loginbox_strategy', 'SESSION', 'UN'],
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
    sessionCookies: ['PHPSESSID', 'sf_remember', 'SERVERID'],
  },
  'oschina': {
    url: 'https://www.oschina.net/',
    sessionCookies: ['oscid', 'user_id'],
  },
  'wechat': {
    url: 'https://mp.weixin.qq.com/',
    sessionCookies: ['slave_sid', 'slave_user', 'data_ticket', 'bizuin', 'data_bizuin', 'cert'],
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
  detectionMethod?: 'api' | 'cookie';  // 检测方式
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
      } catch {}
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
      } catch {}
      
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
      logger.info('cookie-detect', `${platform} Cookie 检测成功，存在有效会话`);
      return {
        loggedIn: true,
        platform,
        detectionMethod: 'cookie',
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
          logger.info('csdn', '从 API 获取到用户信息', { username: user.username, nickname: user.nickname });
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username || user.userName || user.user_name || user.loginName || user.name,
            nickname: user.nickname || user.nickName || user.name || user.username || user.userName || user.user_name,
            avatar: user.avatar || user.avatarUrl || user.headUrl || user.head_url || user.avatar_url,
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
          logger.info('csdn', '从备用 API 获取到用户信息');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username || user.userName || user.user_name || user.loginName || user.name,
            nickname: user.nickName || user.nickname || user.name || user.username || user.userName || user.user_name,
            avatar: user.avatar || user.avatarUrl || user.headUrl || user.head_url || user.avatar_url,
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
    
    // 去重
    const uniqueCookies = new Map<string, chrome.cookies.Cookie>();
    for (const c of allCookies) {
      if (!uniqueCookies.has(c.name)) {
        uniqueCookies.set(c.name, c);
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
    const hasUserCookie = userNameCookie || userInfoCookie || userTokenCookie || unCookie;
    // 其次检查登录后才有的 Cookie
    const hasSessionCookie = cSegmentCookie || creativeBtnCookie || loginboxCookie || 
                             sessionCookie || dcSessionCookie;
    // 最后检查日志相关 Cookie
    const hasLogCookie = logIdClickCookie || logIdPvCookie || logIdViewCookie;
    
    const hasValidSession = hasUserCookie || hasSessionCookie || hasLogCookie || hasUserRelatedCookie;
    
    if (hasValidSession) {
      // 尝试从 Cookie 获取用户名
      const userId = userNameCookie?.value ? decodeURIComponent(userNameCookie.value) : 
                     unCookie?.value ? decodeURIComponent(unCookie.value) : undefined;
      
      logger.info('csdn', '检测到有效的登录 Cookie，判定为已登录', { userId });
      return {
        loggedIn: true,
        platform: 'csdn',
        userId: userId,
        nickname: userId || 'CSDN用户',
        detectionMethod: 'cookie',
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
          logger.info('cnblogs', `API ${endpoint} 响应`, preview);

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
            const avatar = userData?.avatar || userData?.avatarUrl || data?.avatar;

            if (blogApp) {
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
                avatar: avatar,
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
            logger.warn('cnblogs', `API ${endpoint} 响应解析失败`, parseErr);
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
    
    if (hasSessionCookie || hasUserRelatedCookie) {
      const pickUserId = () => {
        const priority = ['uid', 'user_id', 'pub_sid', 'pub_loginuser', 'login_account'];
        for (const name of priority) {
          const candidate = allCookies.find(
            (c) => c.name.toLowerCase() === name && isValidValue(c.value)
          );
          if (!candidate?.value) continue;
          if ((name === 'uid' || name === 'user_id' || name === 'pub_sid') && !/^\d+$/.test(candidate.value)) {
            continue;
          }
          return candidate.value;
        }
        return undefined;
      };
      const userId = pickUserId();
      
      return {
        loggedIn: true,
        platform: '51cto',
        userId,
        nickname: '51CTO用户',
        detectionMethod: 'cookie',
      };
    }

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
      const baseVarMatch = html.match(
        /<div[^>]*\bid=['"]homeBaseVar['"][^>]*\buser-id=['"](\d+)['"][^>]*>/i
      );
      if (baseVarMatch?.[1]) {
        const userId = baseVarMatch[1];
        logger.info('51cto', 'HTML probe hit #homeBaseVar', { userId });
        const avatarMatch = html.match(/https?:\/\/[^"']*ucenter\.51cto\.com\/avatar\.php\?[^"']*/i);
        const nameMatch = html.match(
          /<div[^>]*\bclass=['"][^"']*name[^"']*['"][^>]*>[\s\S]*?<a[^>]*\bclass=['"]left['"][^>]*>([^<]+)<\/a>/i
        );

        return {
          loggedIn: true,
          platform: '51cto',
          userId,
          nickname: (nameMatch?.[1] || '').trim() || '51CTO用户',
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
    try {
      const res = await fetchWithCookies('https://segmentfault.com/api/user/current');
      
      return parseApiResponse(res, 'segmentfault', (data) => {
        if (data.status === 0 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'segmentfault',
            userId: String(user.id),
            nickname: user.name || user.nickname || '思否用户',
            avatar: user.avatar || user.avatarUrl,
            meta: {
              followersCount: user.followers,
              articlesCount: user.articles,
            },
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('segmentfault', 'API 调用失败', e);
      return { loggedIn: false, platform: 'segmentfault', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

const oschinaApi: PlatformApiConfig = {
  id: 'oschina',
  name: '开源中国',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://www.oschina.net/action/user/info');
      
      return parseApiResponse(res, 'oschina', (data) => {
        if (data.code === 0 || data.result?.id || data.id) {
          const user = data.result || data;
          return {
            loggedIn: true,
            platform: 'oschina',
            userId: String(user.id),
            nickname: user.name || user.nickname || '开源中国用户',
            avatar: user.portrait || user.avatar,
            meta: {
              followersCount: user.fansCount,
              articlesCount: user.blogCount,
            },
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('oschina', 'API 调用失败', e);
      return { loggedIn: false, platform: 'oschina', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
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
        } catch {}
        try {
          if (typeof atob === 'function') {
            return atob(normalized);
          }
        } catch {}
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
