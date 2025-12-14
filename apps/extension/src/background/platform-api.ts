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
    // CSDN 使用多种 Cookie 来标识登录状态
    sessionCookies: ['UserName', 'UserInfo', 'UserToken', 'uuid_tt_dd', 'c_segment', 'Hm_ct_6bcd52f51e9b3dce32bec4a3997715ac'],
  },
  'zhihu': {
    url: 'https://www.zhihu.com/',
    sessionCookies: ['z_c0', 'd_c0'],
  },
  'bilibili': {
    url: 'https://www.bilibili.com/',
    sessionCookies: ['SESSDATA', 'bili_jct'],
  },
  'jianshu': {
    url: 'https://www.jianshu.com/',
    sessionCookies: ['remember_user_token'],
  },
  'cnblogs': {
    url: 'https://www.cnblogs.com/',
    fallbackUrls: ['https://account.cnblogs.com/'],
    sessionCookies: ['.CNBlogsCookie'],
  },
  '51cto': {
    url: 'https://home.51cto.com/',
    sessionCookies: ['sid', 'uc_token'],
  },
  'tencent-cloud': {
    url: 'https://cloud.tencent.com/',
    sessionCookies: ['uin', 'skey'],
  },
  'aliyun': {
    url: 'https://developer.aliyun.com/',
    sessionCookies: ['login_aliyunid_pk', 'login_aliyunid'],
  },
  'segmentfault': {
    url: 'https://segmentfault.com/',
    sessionCookies: ['PHPSESSID', 'sf_remember'],
  },
  'oschina': {
    url: 'https://www.oschina.net/',
    sessionCookies: ['oscid'],
  },
  'wechat': {
    url: 'https://mp.weixin.qq.com/',
    sessionCookies: ['slave_sid', 'data_ticket', 'bizuin'],
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
    
    // 去重（同名 Cookie 可能在多个 URL 中出现）
    const uniqueCookies = new Map<string, chrome.cookies.Cookie>();
    for (const cookie of allCookies) {
      const key = `${cookie.name}@${cookie.domain}`;
      if (!uniqueCookies.has(key)) {
        uniqueCookies.set(key, cookie);
      }
    }
    
    // 检查是否存在任一配置的会话 Cookie 且值非空
    const hasValidSession = Array.from(uniqueCookies.values()).some(cookie => 
      config.sessionCookies.includes(cookie.name) && 
      cookie.value !== '' && 
      cookie.value !== undefined
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
      const foundCookieNames = Array.from(uniqueCookies.values()).map(c => c.name);
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
  primaryResult.detectionMethod = 'api';
  
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

const csdnApi: PlatformApiConfig = {
  id: 'csdn',
  name: 'CSDN',
  async fetchUserInfo(): Promise<UserInfo> {
    // 尝试主 API
    try {
      const res = await fetchWithCookies('https://me.csdn.net/api/user/show');
      
      const result = await parseApiResponse(res, 'csdn', (data) => {
        if (data.code === 200 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username,
            nickname: user.nickname || user.username,
            avatar: user.avatar,
            meta: {
              level: user.level,
              followersCount: user.fansNum,
              articlesCount: user.articleNum,
              viewsCount: user.visitNum,
            },
          };
        }
        // CSDN 特定的未登录响应：只有 401 是明确的登出
        if (data.code === 401) {
          return { loggedIn: false, platform: 'csdn', errorType: AuthErrorType.LOGGED_OUT, error: '需要登录' };
        }
        // 400 错误可能是 API 参数问题，不是登出
        if (data.code === 400) {
          return { loggedIn: false, platform: 'csdn', errorType: AuthErrorType.API_ERROR, error: '请求参数错误', retryable: true };
        }
        return null;
      });
      
      // 如果主 API 成功，直接返回
      if (result.loggedIn) {
        return result;
      }
      
      // 如果主 API 失败但不是明确登出，尝试备用 API
      if (result.errorType !== AuthErrorType.LOGGED_OUT) {
        logger.info('csdn', '主 API 失败，尝试备用 API');
        try {
          const backupRes = await fetchWithCookies('https://blog.csdn.net/community/home-api/v1/get-business-info');
          if (backupRes.ok) {
            const backupData = await backupRes.json();
            if (backupData.code === 200 && backupData.data) {
              const user = backupData.data;
              logger.info('csdn', '备用 API 成功');
              return {
                loggedIn: true,
                platform: 'csdn',
                userId: user.username,
                nickname: user.nickName || user.username,
                avatar: user.avatar,
              };
            }
          }
        } catch (e: any) {
          logger.warn('csdn', '备用 API 也失败', { error: e?.message || String(e) });
        }
      }
      
      return result;
    } catch (e: any) {
      logger.error('csdn', 'API 调用失败', e);
      return { loggedIn: false, platform: 'csdn', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
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

const jianshuApi: PlatformApiConfig = {
  id: 'jianshu',
  name: '简书',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://www.jianshu.com/shakespeare/v2/user/info');
      
      return parseApiResponse(res, 'jianshu', (data) => {
        if (data.id) {
          // 简书用户主页格式为 https://www.jianshu.com/u/{slug}
          // slug 是类似 bb8f42a96b80 的字符串，不是数字 id
          const userId = data.slug || String(data.id);
          return {
            loggedIn: true,
            platform: 'jianshu',
            userId: userId,
            nickname: data.nickname,
            avatar: data.avatar,
            meta: {
              followersCount: data.followers_count,
              articlesCount: data.public_notes_count,
            },
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('jianshu', 'API 调用失败', e);
      return { loggedIn: false, platform: 'jianshu', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

const cnblogsApi: PlatformApiConfig = {
  id: 'cnblogs',
  name: '博客园',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://account.cnblogs.com/api/user');
      
      return parseApiResponse(res, 'cnblogs', (data) => {
        // 博客园的用户主页格式为 https://home.cnblogs.com/u/{blogApp}
        // 所以 userId 应该使用 blogApp 而不是数字 userId
        if (data.blogApp || data.displayName || data.userId) {
          return {
            loggedIn: true,
            platform: 'cnblogs',
            // 优先使用 blogApp，因为主页 URL 需要它
            userId: data.blogApp || data.userId,
            nickname: data.displayName || data.blogApp,
            avatar: data.avatar,
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('cnblogs', 'API 调用失败', e);
      return { loggedIn: false, platform: 'cnblogs', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

const cto51Api: PlatformApiConfig = {
  id: '51cto',
  name: '51CTO',
  async fetchUserInfo(): Promise<UserInfo> {
    try {
      const res = await fetchWithCookies('https://home.51cto.com/api/user/info');
      
      return parseApiResponse(res, '51cto', (data) => {
        if ((data.code === 0 || data.status === 'success') && data.data) {
          const user = data.data;
          // 51CTO 用户主页格式为 https://blog.51cto.com/u_{userId}
          // userId 是纯数字
          const userId = String(user.id || user.uid || '');
          return {
            loggedIn: true,
            platform: '51cto',
            userId: userId,
            nickname: user.name || user.nickname || '51CTO用户',
            avatar: user.avatar || user.avatarUrl,
          };
        }
        return null;
      });
    } catch (e: any) {
      logger.error('51cto', 'API 调用失败', e);
      return { loggedIn: false, platform: '51cto', errorType: AuthErrorType.NETWORK_ERROR, error: e.message, retryable: true };
    }
  },
};

const tencentCloudApi: PlatformApiConfig = {
  id: 'tencent-cloud',
  name: '腾讯云开发者社区',
  async fetchUserInfo(): Promise<UserInfo> {
    // 尝试多个 API 端点
    const apiEndpoints = [
      'https://cloud.tencent.com/developer/api/user/info',
      'https://cloud.tencent.com/developer/api/user/current',
    ];
    
    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint);
        
        const result = await parseApiResponse(res, 'tencent-cloud', (data) => {
          if ((data.code === 0 || data.ret === 0) && data.data) {
            const user = data.data;
            const userId = String(user.uin || user.uid || user.id || '');
            const nickname = user.name || user.nickname || user.nick;
            
            // 严格检查：必须有有效的 userId 和 nickname
            if (userId && nickname && nickname !== '腾讯云用户') {
              return {
                loggedIn: true,
                platform: 'tencent-cloud',
                userId: userId,
                nickname: nickname,
                avatar: user.avatar || user.avatarUrl,
              };
            }
          }
          return null;
        });
        
        // 如果成功获取到用户信息，直接返回
        if (result.loggedIn) {
          return result;
        }
      } catch (e: any) {
        logger.warn('tencent-cloud', `API ${endpoint} 调用失败`, e.message);
      }
    }
    
    // 所有 API 都失败
    return { loggedIn: false, platform: 'tencent-cloud', errorType: AuthErrorType.API_ERROR, error: 'API 调用失败', retryable: true };
  },
};

const aliyunApi: PlatformApiConfig = {
  id: 'aliyun',
  name: '阿里云开发者社区',
  async fetchUserInfo(): Promise<UserInfo> {
    // 尝试多个 API 端点（阿里云 API 可能会变更）
    const apiEndpoints = [
      'https://developer.aliyun.com/developer/api/my/user/getUser',
      'https://developer.aliyun.com/developer/api/user/getUserInfo',
      'https://developer.aliyun.com/api/my/user/info',
    ];
    
    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetchWithCookies(endpoint);
        
        logger.info('aliyun', `API ${endpoint} 响应状态`, { status: res.status });
        
        if (res.ok) {
          const data = await res.json();
          logger.info('aliyun', 'API 响应数据', data);
          
          // 尝试从不同的响应结构中提取用户信息
          const userData = data.data || data.result || data;
          if (data.success !== false && userData) {
            const nickname = userData.nickName || userData.nickname || userData.name || userData.loginId;
            const userId = userData.userId || userData.id || userData.uid;
            
            logger.info('aliyun', '用户数据', { userId, nickname });
            
            // 严格检查
            const isValidUserId = userId && String(userId).trim() !== '' && String(userId) !== '0';
            const isValidNickname = nickname && 
                                    nickname.trim() !== '' && 
                                    nickname !== '阿里云用户' &&
                                    !nickname.startsWith('aliyun_');
            
            if (isValidUserId && isValidNickname) {
              logger.info('aliyun', '检测到有效登录', { userId, nickname });
              return {
                loggedIn: true,
                platform: 'aliyun',
                userId: String(userId),
                nickname: nickname,
                avatar: userData.avatarUrl || userData.avatar,
                meta: {
                  followersCount: userData.fansCount,
                  articlesCount: userData.articleCount,
                },
              };
            }
          }
        }
      } catch (e: any) {
        logger.warn('aliyun', `API ${endpoint} 调用失败`, { error: e.message });
      }
    }
    
    // 所有 API 都失败，返回 API 错误（可重试）
    logger.info('aliyun', '所有 API 端点都失败');
    return { 
      loggedIn: false, 
      platform: 'aliyun', 
      errorType: AuthErrorType.API_ERROR, 
      error: 'API 接口不可用', 
      retryable: true 
    };
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
      // 1. 先检查关键 Cookie 是否存在
      const wechatCookies = await chrome.cookies.getAll({ domain: 'mp.weixin.qq.com' });
      
      const hasValidSession = wechatCookies.some(c => 
        ['slave_sid', 'data_ticket', 'bizuin', 'data_bizuin'].includes(c.name) && c.value
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
      
      // 2. 尝试调用微信 API 验证（不打开页面）
      // 使用 redirect: 'manual' 阻止重定向
      const res = await fetch('https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN', {
        credentials: 'include',
        redirect: 'manual',
        headers: {
          'Accept': 'text/html',
        },
      });
      
      // 如果返回 302 重定向，说明未登录
      if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 301) {
        logger.info('wechat', '检测到重定向，可能需要重新登录');
        return { 
          loggedIn: false, 
          platform: 'wechat', 
          errorType: AuthErrorType.LOGGED_OUT,
          error: '需要重新登录',
          retryable: false
        };
      }
      
      // 3. 检查响应内容
      if (res.ok) {
        const text = await res.text();
        
        // 检查是否包含登录页面特征
        if (text.includes('请使用微信扫描') || 
            text.includes('loginpage') || 
            text.includes('扫码登录') ||
            text.includes('action=scanlogin')) {
          return { 
            loggedIn: false, 
            platform: 'wechat', 
            errorType: AuthErrorType.LOGGED_OUT,
            error: '需要重新登录',
            retryable: false
          };
        }
        
        // 尝试从响应中提取用户信息
        let nickname = '微信公众号';
        const nicknameMatch = text.match(/nick_name\s*[:=]\s*["']([^"']+)["']/) ||
                              text.match(/"nickname"\s*:\s*"([^"]+)"/) ||
                              text.match(/class="nickname"[^>]*>([^<]+)</);
        if (nicknameMatch?.[1]) {
          nickname = nicknameMatch[1].trim();
        }
        
        logger.info('wechat', '登录状态有效', { nickname });
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: nickname,
        };
      }
      
      // 其他 HTTP 错误
      return { 
        loggedIn: false, 
        platform: 'wechat', 
        errorType: AuthErrorType.API_ERROR,
        error: `HTTP ${res.status}`,
        retryable: true
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
