/**
 * 登录检测器 - 优化版
 * 
 * 核心思路：优先使用各平台 API 获取用户信息
 * 1. 在目标网站的页面中执行（content script）
 * 2. 优先调用平台 API（自动带 Cookie）
 * 3. API 失败时回退到 DOM 检测
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
 * 平台登录检测器接口
 */
interface PlatformAuthDetector {
  id: string;
  urlPatterns: RegExp[];
  checkLogin(): Promise<LoginState>;
}

function log(scope: string, msg: string, data?: any) {
  console.log(`[auth-detector:${scope}] ${msg}`, data ?? '');
}

async function fetchPlatformInfoFromBackground(platform: string): Promise<LoginState | null> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'FETCH_PLATFORM_USER_INFO',
      data: { platform },
    });
    const info = resp?.info;
    if (resp?.success && info?.loggedIn) {
      return {
        loggedIn: true,
        platform,
        userId: info.userId,
        nickname: info.nickname,
        avatar: info.avatar,
        meta: info.meta,
      };
    }
  } catch (e) {
    log(platform, '后台检测失败', e);
  }
  return null;
}

function readTextFromEl(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const text = el.textContent?.trim();
  if (text) return text;
  const title = (el as HTMLElement).getAttribute?.('title')?.trim();
  return title || undefined;
}

function extractCssUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match?.[2] || undefined;
}

function readAvatarUrlFromEl(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  if (el instanceof HTMLImageElement && el.src) return el.src;
  const img = el.querySelector('img') as HTMLImageElement | null;
  if (img?.src) return img.src;
  const styleBg = extractCssUrl((el as HTMLElement).style?.backgroundImage);
  if (styleBg) return styleBg;
  try {
    const computed = extractCssUrl(getComputedStyle(el as HTMLElement).backgroundImage);
    if (computed) return computed;
  } catch {}
  return undefined;
}

async function waitForValue<T>(
  getter: () => T | null | undefined,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T | undefined> {
  const timeoutMs = options.timeoutMs ?? 1800;
  const intervalMs = options.intervalMs ?? 120;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const value = getter();
    if (value !== undefined && value !== null) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed as T;
      } else {
        return value;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

// ============================================================
// 掘金检测器 - API 优先
// ============================================================
const juejinDetector: PlatformAuthDetector = {
  id: 'juejin',
  urlPatterns: [/juejin\.cn/],
  async checkLogin(): Promise<LoginState> {
    log('juejin', '检测登录状态...');
    
    // 优先使用 API
    try {
      const res = await fetch('https://api.juejin.cn/user_api/v1/user/get', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.err_no === 0 && data.data) {
          const user = data.data;
          log('juejin', '从 API 获取到用户信息', { nickname: user.user_name });
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
      }
    } catch (e) {
      log('juejin', 'API 调用失败，尝试 DOM 检测', e);
    }
    
    // 回退：检查登录按钮
    const loginBtn = document.querySelector('.login-button, [class*="login"]');
    if (loginBtn?.textContent?.includes('登录')) {
      return { loggedIn: false, platform: 'juejin' };
    }
    
    return { loggedIn: false, platform: 'juejin' };
  },
};

// ============================================================
// CSDN 检测器 - API 优先
// ============================================================
 const csdnDetector: PlatformAuthDetector = {
   id: 'csdn',
   urlPatterns: [/csdn\.net/],
   async checkLogin(): Promise<LoginState> {
     log('csdn', '检测登录状态...');

     const getUserNameFromCookie = () => {
       try {
         const cookies = document.cookie;
         const match = cookies.match(/(?:^|;\s*)UserName=([^;]+)/);
         if (!match?.[1]) return undefined;
         const decoded = decodeURIComponent(match[1]);
         return decoded?.trim() || undefined;
       } catch {
         return undefined;
       }
     };

     const extractUserIdFromAvatarUrl = (avatarUrl?: string): string | undefined => {
       if (!avatarUrl) return undefined;
       const trimmed = avatarUrl.trim();
       if (!trimmed) return undefined;
       const match = trimmed.match(/\/[^\/]*_([a-zA-Z0-9][a-zA-Z0-9_-]{2,60})\.(?:jpg|jpeg|png)(?:[!?].*)?$/i);
       const candidate = match?.[1]?.trim();
       if (!candidate) return undefined;
       const lower = candidate.toLowerCase();
       if (lower === 'default' || lower === 'placeholder') return undefined;
       return candidate;
     };

     const extractUserIdFromUrl = (): string | undefined => {
       try {
         if (window.location.host === 'blog.csdn.net') {
           const first = window.location.pathname.split('/').filter(Boolean)[0];
           if (first && first.length < 80 && first !== 'community') return first;
         }
       } catch {}
       return undefined;
     };

     // 优先：个人中心页面（SPA 渲染）直接从 DOM 提取昵称/头像
     const url = window.location.href;
     const isIHost = window.location.host === 'i.csdn.net';
     const isUserCenterPage =
       isIHost &&
       (url.includes('user-center') || window.location.hash.includes('user-center') || url.includes('/#/user-center'));

     const cleanNickname = (value?: string) => {
       const trimmed = value?.trim();
       if (!trimmed) return undefined;
       // 过滤“已加入 CSDN X年”等非昵称信息
       if (trimmed.includes('已加入') && trimmed.includes('CSDN')) return undefined;
       return trimmed;
     };

     const extractNicknameFromContainer = (container: Element | null) => {
       if (!container) return undefined;
       const titleCandidate = container.querySelector('[title]') as HTMLElement | null;
       const title = cleanNickname(titleCandidate?.getAttribute?.('title') || undefined);
       if (title) return title;

       const all = Array.from(container.querySelectorAll('a, span, div')) as HTMLElement[];
       for (const el of all) {
         const className = (el.className || '').toString();
         if (className.includes('age') || className.includes('icon')) continue;
         const text = cleanNickname(readTextFromEl(el));
         if (!text) continue;
         if (text.length > 40) continue;
         return text;
       }

       const selfText = cleanNickname(readTextFromEl(container));
       return selfText;
     };

     const getNicknameFromDom = () =>
       extractNicknameFromContainer(document.querySelector('.user-profile-head-name')) ||
       extractNicknameFromContainer(document.querySelector('[class*="user-profile"][class*="head-name"]')) ||
       cleanNickname(readTextFromEl(document.querySelector('[class*="user-profile"][class*="name"]')));
     const getAvatarFromDom = () =>
       readAvatarUrlFromEl(document.querySelector('.user-profile-avatar img')) ||
       readAvatarUrlFromEl(document.querySelector('.user-profile-avatar')) ||
      readAvatarUrlFromEl(document.querySelector('img[src*="profile-avatar.csdnimg.cn"]')) ||
       readAvatarUrlFromEl(document.querySelector('[class*="user-profile"][class*="avatar"]'));

     const getReliableNicknameFromDom = () => {
       const value = getNicknameFromDom();
       if (!value) return undefined;
       const trimmed = value.trim();
       if (!trimmed) return undefined;
       if (trimmed === 'CSDN用户') return undefined;
       return trimmed;
     };
     const getReliableAvatarFromDom = () => {
       const value = getAvatarFromDom();
       if (!value) return undefined;
       const trimmed = value.trim();
       if (!trimmed) return undefined;
       if (trimmed === 'about:blank') return undefined;
       return trimmed;
     };

     // i.csdn.net 个人中心页经常是 hash 路由，且可能重定向到相近路径；只要 DOM 结构出现就视为“个人中心上下文”
     const hasUserCenterDom = isIHost && !!document.querySelector('.user-profile-head-name, .user-profile-avatar');

      if (isUserCenterPage || hasUserCenterDom) {
        // 该页面未登录时通常会引导跳转/展示登录入口，昵称/头像元素不会出现
        const nicknameFromDom = await waitForValue(() => getReliableNicknameFromDom(), { timeoutMs: 2500 });
        const avatarFromDom = await waitForValue(() => getReliableAvatarFromDom(), { timeoutMs: 2500 });
        if (nicknameFromDom || avatarFromDom) {
          const cookieUser = getUserNameFromCookie();
          const inferredUserId =
            cookieUser || extractUserIdFromAvatarUrl(avatarFromDom) || extractUserIdFromUrl() || undefined;
          const bg = await fetchPlatformInfoFromBackground('csdn');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: inferredUserId || bg?.userId,
            nickname: nicknameFromDom || cookieUser || bg?.nickname || 'CSDN用户',
            avatar: avatarFromDom || bg?.avatar,
          };
        }
       }
    
    // 优先使用 API
    try {
      const res = await fetch('https://me.csdn.net/api/user/show', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      
      if (res.ok) {
        const data = await res.json();
        const payload = data?.data || data?.result || data;
        if ((data?.code === 200 || data?.code === '200') && payload) {
          const user = payload;
          const userId = user.username || user.userName || user.user_name;
          let nickname = user.nickname || user.nickName || user.name || userId;
          let avatar = user.avatar || user.avatarUrl || user.headUrl;

          const trimmedNickname = (nickname || '').trim();
          const trimmedUserId = (userId || '').trim();
          const suspectNickname =
            !trimmedNickname ||
            (trimmedUserId && trimmedNickname.toLowerCase() === trimmedUserId.toLowerCase()) ||
            /^(?:csdn_\d+|qq_\d+|weixin_\d+|m\d+_\d+)$/i.test(trimmedNickname);

          if (suspectNickname) {
            const domNickname = getReliableNicknameFromDom();
            const domAvatar = getReliableAvatarFromDom();
            const bg = await fetchPlatformInfoFromBackground('csdn');
            nickname = domNickname || bg?.nickname || nickname;
            avatar = avatar || domAvatar || bg?.avatar;
          }
          log('csdn', '从 API 获取到用户信息', { nickname });
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: userId,
            nickname: nickname,
            avatar: avatar,
            meta: {
              level: user.level,
              followersCount: user.fansNum,
              articlesCount: user.articleNum,
              viewsCount: user.visitNum,
            },
          };
        }
      }
    } catch (e) {
      log('csdn', 'API 调用失败', e);
    }
    
    // 备用 API
    try {
      const res = await fetch('https://blog.csdn.net/community/home-api/v1/get-business-info', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const payload = data?.data || data?.result || data;
        if ((data?.code === 200 || data?.code === '200') && payload) {
          const user = payload;
          log('csdn', '从备用 API 获取到用户信息');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username || user.userName || user.user_name,
            nickname: user.nickName || user.nickname || user.name || user.username,
            avatar: user.avatar || user.avatarUrl || user.headUrl,
          };
        }
      }
    } catch {}
    
    // 检查 Cookie
    let cookieState: LoginState | null = null;
    try {
      const cookies = document.cookie;
      const userNameMatch = cookies.match(/UserName=([^;]+)/);
      if (userNameMatch) {
        const userName = decodeURIComponent(userNameMatch[1]);
        log('csdn', '从 Cookie 检测到用户名: ' + userName);
        cookieState = {
          loggedIn: true,
          platform: 'csdn',
          userId: userName,
          nickname: userName,
        };
      }
    } catch {}

    // DOM: 仅用于补齐昵称/头像（不要仅凭“主页可见信息”判断登录）
    const shouldWaitForDom = cookieState?.loggedIn === true;
    const nicknameFromDom = shouldWaitForDom ? await waitForValue(() => getNicknameFromDom()) : getNicknameFromDom();
    const avatarFromDom = shouldWaitForDom ? await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1500 }) : getAvatarFromDom();
    const inferredUserId =
      extractUserIdFromUrl() ||
      (cookieState?.userId ? String(cookieState.userId) : undefined) ||
      extractUserIdFromAvatarUrl(avatarFromDom) ||
      undefined;

    // CSDN 子域名较多：content script 可能会遇到 CORS/HttpOnly 限制，兜底让 background 统一检测并补全昵称/头像
    const bg = await fetchPlatformInfoFromBackground('csdn');
    if (bg?.loggedIn) {
      return {
        ...bg,
        userId: inferredUserId || bg.userId,
        nickname: nicknameFromDom || bg.nickname,
        avatar: avatarFromDom || bg.avatar,
      };
    }
    if (cookieState) {
      return {
        ...cookieState,
        userId: inferredUserId || cookieState.userId,
        nickname: nicknameFromDom || cookieState.nickname,
        avatar: avatarFromDom,
      };
    }
    
    return { loggedIn: false, platform: 'csdn' };
  },
};

// ============================================================
// 知乎检测器 - API 优先
// ============================================================
const zhihuDetector: PlatformAuthDetector = {
  id: 'zhihu',
  urlPatterns: [/zhihu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('zhihu', '检测登录状态...');
    
    // 优先使用 API
    try {
      const res = await fetch('https://www.zhihu.com/api/v4/me', {
        credentials: 'include',
      });
      if (res.ok) {
        const user = await res.json();
        if (user.id) {
          log('zhihu', '从 API 获取到用户信息', { nickname: user.name });
          return {
            loggedIn: true,
            platform: 'zhihu',
            userId: user.id,
            nickname: user.name,
            avatar: user.avatar_url,
            meta: {
              followersCount: user.follower_count,
              articlesCount: user.articles_count,
            },
          };
        }
      }
    } catch (e) {
      log('zhihu', 'API 调用失败', e);
    }
    
    // 检查登录按钮
    const loginBtn = document.querySelector('.AppHeader-login, button[aria-label="登录"]');
    if (loginBtn) {
      return { loggedIn: false, platform: 'zhihu' };
    }
    
    return { loggedIn: false, platform: 'zhihu' };
  },
};

// ============================================================
// 微信公众号检测器
// ============================================================
const wechatDetector: PlatformAuthDetector = {
  id: 'wechat',
  urlPatterns: [/mp\.weixin\.qq\.com/],
  async checkLogin(): Promise<LoginState> {
    log('wechat', '检测登录状态...');
    const url = window.location.href;
    
    // 检查是否在登录页面
    if (url.includes('/cgi-bin/loginpage') || url.includes('action=scanlogin') || url.includes('/cgi-bin/bizlogin')) {
      if (!url.includes('token=')) {
        const loginFormSelectors = ['.login__type__container', '.login_frame', '.weui-desktop-login'];
        for (const selector of loginFormSelectors) {
          if (document.querySelector(selector)) {
            return { loggedIn: false, platform: 'wechat' };
          }
        }
      }
    }

    const normalizeUrl = (value?: string): string | undefined => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `https://mp.weixin.qq.com${trimmed}`;
      return trimmed;
    };

    const decodeJsonString = (value: string): string => {
      try {
        return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
      } catch {
        return value;
      }
    };

    const extractFromGlobals = (): { nickname?: string; avatar?: string } => {
      const win = window as any;
      const sources = [
        win.cgiData,
        win.wx?.cgiData,
        win.wx_common_data,
        win.__wxCommonData__,
        win.__INITIAL_STATE__,
        win.__NUXT__,
      ].filter(Boolean);

      const pickFromObj = (obj: any): { nickname?: string; avatar?: string } | null => {
        if (!obj || typeof obj !== 'object') return null;
        const nickname =
          obj.nickname ||
          obj.nick_name ||
          obj.nickName ||
          obj.name ||
          obj.account_name ||
          obj.accountName ||
          obj.user_name ||
          obj.username ||
          obj.userName;
        const avatar =
          obj.avatar ||
          obj.head_img ||
          obj.headimgurl ||
          obj.headImgUrl ||
          obj.head_img_url ||
          obj.headimg_url ||
          obj.headimg ||
          obj.logo ||
          obj.headImageUrl ||
          obj.head_image_url;

        const nicknameStr = typeof nickname === 'string' ? nickname.trim() : undefined;
        const avatarStr = typeof avatar === 'string' ? normalizeUrl(avatar) : undefined;
        if (nicknameStr || avatarStr) return { nickname: nicknameStr, avatar: avatarStr };
        return null;
      };

      for (const source of sources) {
        const candidates = [
          source,
          source.user,
          source.user_info,
          source.userInfo,
          source.account,
          source.profile,
          source.data?.user,
          source.data?.user_info,
          source.data?.account,
        ];
        for (const candidate of candidates) {
          const picked = pickFromObj(candidate);
          if (picked) return picked;
        }
      }

      return {};
    };

    const extractFromScripts = (): { nickname?: string; avatar?: string } => {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent;
        if (!text) continue;
        if (!/(nick_name|nickname|head_img|headimgurl|head_img_url|headimg_url)/.test(text)) continue;

        const nicknameMatch = text.match(/["'](?:nick_name|nickname)["']\s*:\s*["']([^"']+)["']/);
        const avatarMatch = text.match(/["'](?:head_img|headimgurl|head_img_url|headimg_url|avatar)["']\s*:\s*["']([^"']+)["']/);

        const nickname = nicknameMatch?.[1] ? decodeJsonString(nicknameMatch[1]).trim() : undefined;
        const avatar = avatarMatch?.[1] ? normalizeUrl(decodeJsonString(avatarMatch[1])) : undefined;

        if (nickname || avatar) return { nickname, avatar };
      }
      return {};
    };

    const getNicknameFromDom = () =>
      readTextFromEl(document.querySelector('.weui-desktop-person-info .weui-desktop-name')) ||
      readTextFromEl(document.querySelector('#js_mp_personal_info .weui-desktop-name')) ||
      readTextFromEl(document.querySelector('.weui-desktop-name')) ||
      readTextFromEl(document.querySelector('.weui-desktop-account__name')) ||
      readTextFromEl(document.querySelector('.weui-desktop-account__nickname')) ||
      readTextFromEl(document.querySelector('.weui-desktop-account__info .weui-desktop-account__name')) ||
      readTextFromEl(document.querySelector('#js_account_info .weui-desktop-account__name')) ||
      readTextFromEl(document.querySelector('#js_account_info .weui-desktop-account__nickname')) ||
      readTextFromEl(document.querySelector('#js_account_nickname')) ||
      readTextFromEl(document.querySelector('[class*="account"][class*="name"]')) ||
      readTextFromEl(document.querySelector('[class*="account"][class*="nickname"]'));
    const getAvatarFromDom = () =>
      normalizeUrl(
        readAvatarUrlFromEl(document.querySelector('img.weui-desktop-account__img')) ||
          readAvatarUrlFromEl(document.querySelector('.weui-desktop-account__avatar img')) ||
          readAvatarUrlFromEl(document.querySelector('#js_account_info img')) ||
          readAvatarUrlFromEl(document.querySelector('[class*="account"] img')) ||
          readAvatarUrlFromEl(document.querySelector('[class*="avatar"] img'))
      ) || undefined;
    
    // 检查 URL 中的 token 参数
    const tokenMatch = url.match(/token=(\d+)/);
    if (tokenMatch && tokenMatch[1]) {
      log('wechat', '从 URL token 参数判断已登录');

      const nicknameFromDom = await waitForValue(() => getNicknameFromDom());
      const avatarFromDom = await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1200 });
      const fromGlobals = extractFromGlobals();
      const fromScripts = extractFromScripts();
      
      let nickname = nicknameFromDom || fromGlobals.nickname || fromScripts.nickname || '微信公众号';
      // 尝试从页面标题获取昵称
      const title = document.title;
      if (title && !title.includes('登录')) {
        const match = title.match(/^(.+?)\s*[-–—]\s*微信公众平台/);
        if (match && match[1].trim().length > 0) {
          nickname = match[1].trim();
        }
      }
      
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: nickname,
        avatar: avatarFromDom || fromGlobals.avatar || fromScripts.avatar,
      };
    }
    
    // 检查 Cookie
    try {
      const cookies = document.cookie;
      if (cookies.includes('slave_sid=') || cookies.includes('data_ticket=') || cookies.includes('bizuin=')) {
        const nicknameFromDom = await waitForValue(() => getNicknameFromDom(), { timeoutMs: 1200 });
        const avatarFromDom = await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1200 });
        const fromGlobals = extractFromGlobals();
        const fromScripts = extractFromScripts();

        // 兜底：让 background 尝试从 Cookie 结构化字段中解析昵称/头像
        const bg = await fetchPlatformInfoFromBackground('wechat');
        const bgNickname = bg?.loggedIn ? bg.nickname : undefined;
        const bgAvatar = bg?.loggedIn ? bg.avatar : undefined;
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: nicknameFromDom || fromGlobals.nickname || fromScripts.nickname || bgNickname || '微信公众号',
          avatar: avatarFromDom || fromGlobals.avatar || fromScripts.avatar || bgAvatar,
        };
      }
    } catch {}
    
    return { loggedIn: false, platform: 'wechat' };
  },
};

// ============================================================
// 简书检测器
// 注意：简书用户主页格式为 https://www.jianshu.com/u/{slug}
// slug 是类似 bb8f42a96b80 的字符串，不是数字 ID
// ============================================================
const jianshuDetector: PlatformAuthDetector = {
  id: 'jianshu',
  urlPatterns: [/jianshu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('jianshu', '检测登录状态...');
    
    // 尝试 API
      try {
        const res = await fetch('https://www.jianshu.com/shakespeare/v2/user/info', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          const payload = data?.data || data?.result || data;
          if (payload?.id) {
            // 简书的 userId 应该使用 slug 字段（用于主页 URL），而不是数字 id
            // slug 格式如 bb8f42a96b80
            const slug =
              (typeof payload.slug === 'string' && payload.slug.trim()) ||
              (typeof payload.user?.slug === 'string' && payload.user.slug.trim()) ||
              undefined;
            const nickname = payload.nickname || payload.user?.nickname || payload.user?.name;
            const avatar = payload.avatar || payload.user?.avatar;
            const userId = slug;
            log('jianshu', '从 API 获取到用户信息', { userId, slug, nickname });
            return {
              loggedIn: true,
              platform: 'jianshu',
              userId: userId,
              nickname: nickname,
              avatar: avatar,
              meta: {
                followersCount: payload.followers_count,
                articlesCount: payload.public_notes_count,
                viewsCount: payload.total_wordage,
              },
            };
          }
        }
      } catch (e) {
        log('jianshu', 'API 调用失败', e);
      }
    
     const isValidSlug = (value: unknown): value is string => {
       if (typeof value !== 'string') return false;
       const trimmed = value.trim();
       if (!trimmed) return false;
       if (!/^[a-zA-Z0-9]+$/.test(trimmed)) return false;
       // 简书 slug 不是纯数字
       if (/^\d+$/.test(trimmed)) return false;
       return true;
     };

     // 尝试从页面 URL 提取用户 slug（如果在用户主页）
     const url = window.location.href;
     const slugMatch = url.match(/jianshu\.com\/u\/([a-zA-Z0-9]+)/);
     if (slugMatch) {
       log('jianshu', '从 URL 提取到用户 slug', { slug: slugMatch[1] });
     }

    // DOM: 仅用于补齐昵称/头像（不要仅凭“用户主页信息”判断登录）
    const slugFromDom = (() => {
      const avatarLink = document.querySelector('a.avatar[href^="/u/"]') as HTMLAnchorElement | null;
      const nameLink = document.querySelector('a.name[href^="/u/"]') as HTMLAnchorElement | null;
      const href = avatarLink?.getAttribute('href') || nameLink?.getAttribute('href');
      const match = href?.match(/^\/u\/([a-zA-Z0-9]+)/);
      return match?.[1];
    })();
    const nicknameFromDom =
      readTextFromEl(document.querySelector('.main-top .title a.name')) ||
      readTextFromEl(document.querySelector('.title a.name')) ||
      readTextFromEl(document.querySelector('a.name[href^="/u/"]')) ||
      readTextFromEl(document.querySelector('.user .name')) ||
      readTextFromEl(document.querySelector('.nickname'));
    const avatarFromDom =
      readAvatarUrlFromEl(document.querySelector('.main-top a.avatar img')) ||
      readAvatarUrlFromEl(document.querySelector('.main-top a.avatar')) ||
      readAvatarUrlFromEl(document.querySelector('a.avatar[href^="/u/"] img')) ||
      readAvatarUrlFromEl(document.querySelector('a.avatar[href^="/u/"]')) ||
      readAvatarUrlFromEl(document.querySelector('.user .avatar img')) ||
      readAvatarUrlFromEl(document.querySelector('.avatar-wrapper img'));

     const bg = await fetchPlatformInfoFromBackground('jianshu');
     if (bg?.loggedIn) {
       const bestSlug =
         (isValidSlug(slugMatch?.[1]) ? slugMatch?.[1] : undefined) ||
         (isValidSlug(slugFromDom) ? slugFromDom : undefined) ||
         (isValidSlug(bg.userId) ? bg.userId : undefined);
       return {
         ...bg,
         userId: bestSlug || bg.userId,
         nickname: nicknameFromDom || bg.nickname,
         avatar: avatarFromDom || bg.avatar,
       };
     }
    
    return { loggedIn: false, platform: 'jianshu' };
  },
};

// ============================================================
// 博客园检测器
// 注意：博客园的用户主页格式为 https://home.cnblogs.com/u/{blogApp}
// 所以 userId 应该使用 blogApp 而不是数字 ID
// ============================================================
const cnblogsDetector: PlatformAuthDetector = {
  id: 'cnblogs',
  urlPatterns: [/cnblogs\.com/],
  async checkLogin(): Promise<LoginState> {
    log('cnblogs', '检测登录状态...');
    const url = window.location.href;

    const normalizeUrl = (value?: unknown, base = 'https://www.cnblogs.com'): string | undefined => {
      const candidate =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object'
            ? (value as any).url || (value as any).src || (value as any).href
            : undefined;
      if (typeof candidate !== 'string') return undefined;
      const trimmed = candidate.trim();
      if (!trimmed || trimmed === '[object Object]') return undefined;
      if (trimmed.startsWith('//')) return `https:${trimmed}`;
      if (trimmed.startsWith('/')) return `${base}${trimmed}`;
      return trimmed;
    };
    
    // 检查是否在"您已登录"页面 - 此时需要尝试获取用户信息
    if (url.includes('continue-sign-out') || url.includes('already-signed-in')) {
      // 尝试从 API 获取完整用户信息
      try {
        const res = await fetch('https://account.cnblogs.com/api/user', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.blogApp || data.displayName) {
            log('cnblogs', '从 API 获取到用户信息', { blogApp: data.blogApp, displayName: data.displayName });
            return {
              loggedIn: true,
              platform: 'cnblogs',
              // 使用 blogApp 作为 userId，因为主页 URL 格式为 /u/{blogApp}
              userId: data.blogApp || data.userId,
              nickname: data.displayName || data.blogApp,
              avatar: normalizeUrl(data.avatar || data.avatarUrl || data.avatar_url || data.Avatar || data.AvatarUrl),
            };
          }
        }
      } catch (e) {
        log('cnblogs', 'API 调用失败', e);
      }
      
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: '博客园用户',
      };
    }
    
    // 尝试 API
    try {
      const res = await fetch('https://account.cnblogs.com/api/user', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.blogApp || data.displayName || data.userId) {
          log('cnblogs', '从 API 获取到用户信息', { blogApp: data.blogApp, displayName: data.displayName });
          return {
            loggedIn: true,
            platform: 'cnblogs',
            // 使用 blogApp 作为 userId，因为主页 URL 格式为 /u/{blogApp}
            userId: data.blogApp || data.userId,
            nickname: data.displayName || data.blogApp,
            avatar: normalizeUrl(data.avatar || data.avatarUrl || data.avatar_url || data.Avatar || data.AvatarUrl),
          };
        }
      }
    } catch (e) {
      log('cnblogs', 'API 调用失败', e);
    }
    
    // 检查全局变量
    const win = window as any;
    if (win.currentBlogApp || win.cb_blogUserGuid) {
      return {
        loggedIn: true,
        platform: 'cnblogs',
        // currentBlogApp 就是用于主页 URL 的标识
        userId: win.currentBlogApp,
        nickname: win.currentBlogApp || '博客园用户',
      };
    }
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="signout"], a[href*="logout"]');
    if (logoutEl) {
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: '博客园用户',
      };
    }
    
    return { loggedIn: false, platform: 'cnblogs' };
  },
};

// ============================================================
// 51CTO 检测器 - API 优先
// 注意：51CTO 用户主页格式为 https://blog.51cto.com/u_{userId}
// userId 是纯数字，如 17035626
// ============================================================
const cto51Detector: PlatformAuthDetector = {
  id: '51cto',
  urlPatterns: [/51cto\.com/],
  async checkLogin(): Promise<LoginState> {
    log('51cto', '检测登录状态...');
    
    // ⚠️ 避免调用 home.51cto.com/api/user/info：该接口在未命中会话时可能下发清理 Cookie 的 Set-Cookie，
    // 会导致“检测/刷新”触发实际登录态丢失。

    // 尝试从页面 URL / DOM 提取用户 ID（如果在用户主页或用户中心）
    const url = window.location.href;
    const domUid =
      (document.querySelector('#homeBaseVar') as HTMLElement | null)?.getAttribute?.('user-id') ||
      undefined;

    // DOM: 头像/昵称（用户中心页常见结构）
    const getNicknameFromDom = () =>
      readTextFromEl(document.querySelector('.name a.left')) ||
      readTextFromEl(document.querySelector('.name a')) ||
      readTextFromEl(document.querySelector('[class*="name"] a.left')) ||
      readTextFromEl(document.querySelector('[class*="user"] [class*="name"]'));
    const getAvatarFromDom = () =>
      readAvatarUrlFromEl(document.querySelector('img[src*="avatar.php"]')) ||
      readAvatarUrlFromEl(document.querySelector('img[alt="头像"]')) ||
      readAvatarUrlFromEl(document.querySelector('[class*="avatar"] img')) ||
      undefined;
    const shouldWaitForDom =
      !!document.querySelector('#homeBaseVar') ||
      !!document.querySelector('.name') ||
      url.includes('home.51cto.com/space') ||
      url.includes('blog.51cto.com/u_');
    const nicknameFromDom = shouldWaitForDom ? await waitForValue(() => getNicknameFromDom(), { timeoutMs: 1200 }) : getNicknameFromDom();
    const avatarFromDom = shouldWaitForDom ? await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1200 }) : getAvatarFromDom();

    // 主页：https://home.51cto.com/space?uid=17025626
    const spaceUidMatch = url.match(/home\.51cto\.com\/space\?(?:[^#]*&)?uid=(\d+)/);
    if (spaceUidMatch) {
      log('51cto', '从 URL 提取到 uid', { userId: spaceUidMatch[1] });
      return {
        loggedIn: true,
        platform: '51cto',
        userId: spaceUidMatch[1],
        nickname: nicknameFromDom || '51CTO用户',
        avatar: avatarFromDom,
      };
    }

    // 旧格式：https://blog.51cto.com/u_17025626
    const blogUidMatch = url.match(/blog\.51cto\.com\/u_(\d+)/);
    if (blogUidMatch) {
      log('51cto', '从 URL 提取到 uid', { userId: blogUidMatch[1] });
      return {
        loggedIn: true,
        platform: '51cto',
        userId: blogUidMatch[1],
        nickname: nicknameFromDom || '51CTO用户',
        avatar: avatarFromDom,
      };
    }
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="logout"], a[href*="signout"], a[href*="loginout"]');
    if (logoutEl) {
      return {
        loggedIn: true,
        platform: '51cto',
        userId: domUid || undefined,
        nickname: nicknameFromDom || '51CTO用户',
        avatar: avatarFromDom,
      };
    }

    // 兜底：让 background 用 Cookie 检测（不会触发页面请求）
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'FETCH_PLATFORM_USER_INFO',
        data: { platform: '51cto' },
      });
      const info = resp?.info;
      if (resp?.success && info?.loggedIn) {
        return {
          loggedIn: true,
          platform: '51cto',
          userId: info.userId || domUid || undefined,
          nickname: nicknameFromDom || info.nickname || '51CTO用户',
          avatar: avatarFromDom || info.avatar,
        };
      }
    } catch (e) {
      log('51cto', '后台检测失败', e);
    }
    
    return { loggedIn: false, platform: '51cto' };
  },
};

// ============================================================
// 腾讯云开发者社区检测器 - API 优先
// 注意：腾讯云用户主页格式为 https://cloud.tencent.com/developer/user/{userId}
// ============================================================
const tencentCloudDetector: PlatformAuthDetector = {
  id: 'tencent-cloud',
  urlPatterns: [/cloud\.tencent\.com/],
  async checkLogin(): Promise<LoginState> {
    log('tencent-cloud', '检测登录状态...');
    
    // 尝试多个 API 端点
    const apiEndpoints = [
      'https://cloud.tencent.com/developer/api/user/info',
      'https://cloud.tencent.com/developer/api/user/current',
    ];
    
    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetch(endpoint, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if ((data.code === 0 || data.ret === 0) && data.data) {
            const user = data.data;
            const userId = String(user.uin || user.uid || user.id || '');
            const nickname = user.name || user.nickname || user.nick;
            
            if (userId) {
              log('tencent-cloud', '从 API 获取到用户信息', { userId, nickname });
              const apiState: LoginState = {
                loggedIn: true,
                platform: 'tencent-cloud',
                userId: userId,
                nickname: nickname || '腾讯云用户',
                avatar: user.avatar || user.avatarUrl,
              };

              const getNicknameFromDom = () =>
                readTextFromEl(document.querySelector('.uc-hero-name')) ||
                readTextFromEl(document.querySelector('[class*="hero"][class*="name"]')) ||
                readTextFromEl(document.querySelector('.com-header-user-name')) ||
                readTextFromEl(document.querySelector('.user-name'));
              const getAvatarFromDom = () =>
                readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar .com-2-avatar-inner')) ||
                readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar [style*="background-image"]')) ||
                readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar img')) ||
                readAvatarUrlFromEl(document.querySelector('.com-header-user-avatar img'));

              const nicknameFromDom = await waitForValue(() => getNicknameFromDom(), { timeoutMs: 1200 });
              const avatarFromDom = await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1200 });

              const merged: LoginState = {
                ...apiState,
                nickname: apiState.nickname && apiState.nickname !== '腾讯云用户' ? apiState.nickname : (nicknameFromDom || apiState.nickname),
                avatar: apiState.avatar || avatarFromDom,
              };

              if (!merged.avatar || !merged.nickname || merged.nickname === '腾讯云用户') {
                const bg = await fetchPlatformInfoFromBackground('tencent-cloud');
                if (bg?.loggedIn) {
                  return {
                    ...bg,
                    nickname: merged.nickname || bg.nickname,
                    avatar: merged.avatar || bg.avatar,
                  };
                }
              }
              return merged;
            }
          }
        }
      } catch (e) {
        log('tencent-cloud', `API ${endpoint} 调用失败`, e);
      }
    }
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="logout"], [class*="logout"]');
    if (logoutEl) {
      const bg = await fetchPlatformInfoFromBackground('tencent-cloud');
      if (bg?.loggedIn) return bg;
      return {
        loggedIn: true,
        platform: 'tencent-cloud',
        nickname: '腾讯云用户',
      };
    }

    const bg = await fetchPlatformInfoFromBackground('tencent-cloud');
    if (bg?.loggedIn) {
      const getNicknameFromDom = () =>
        readTextFromEl(document.querySelector('.uc-hero-name')) ||
        readTextFromEl(document.querySelector('[class*="hero"][class*="name"]')) ||
        readTextFromEl(document.querySelector('.com-header-user-name')) ||
        readTextFromEl(document.querySelector('.user-name'));
      const getAvatarFromDom = () =>
        readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar .com-2-avatar-inner')) ||
        readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar [style*="background-image"]')) ||
        readAvatarUrlFromEl(document.querySelector('.uc-hero-avatar img')) ||
        readAvatarUrlFromEl(document.querySelector('.com-header-user-avatar img'));

      const nicknameFromDom = await waitForValue(() => getNicknameFromDom(), { timeoutMs: 1500 });
      const avatarFromDom = await waitForValue(() => getAvatarFromDom(), { timeoutMs: 1500 });
      return {
        ...bg,
        nickname: nicknameFromDom || bg.nickname,
        avatar: avatarFromDom || bg.avatar,
      };
    }
    
    return { loggedIn: false, platform: 'tencent-cloud' };
  },
};

// ============================================================
// 阿里云开发者社区检测器
// 注意：阿里云用户主页格式为 https://developer.aliyun.com/profile/{userId}
// userId 是数字 ID
// 
// 检测策略：
// 1. 优先尝试 API（返回 200 说明已登录）
// 2. 然后检测页面 DOM 中的用户信息
// 3. 最后尝试从页面全局变量获取用户信息
// ============================================================
const aliyunDetector: PlatformAuthDetector = {
  id: 'aliyun',
  // 只匹配开发者社区域名
  urlPatterns: [/developer\.aliyun\.com/],
  async checkLogin(): Promise<LoginState> {
    log('aliyun', '检测登录状态...');
    
    // 1. 优先尝试 API - getUser 返回 200 说明已登录
    try {
      const res = await fetch('https://developer.aliyun.com/developer/api/my/user/getUser', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      
      log('aliyun', 'API getUser 响应状态', { status: res.status });
      
      if (res.ok) {
        const text = await res.text();
        log('aliyun', 'API getUser 响应内容', text.substring(0, 500));
        
        try {
          const data = JSON.parse(text);
          log('aliyun', 'API getUser 解析结果', data);
          
          // 检查各种可能的响应结构
          // 阿里云 API 可能返回 { success: true, data: {...} } 或 { code: 0, data: {...} }
          const userData = data.data || data.result || data.content || data;
          
          // 如果 API 返回 200 且有数据，说明已登录
          if (userData && typeof userData === 'object') {
            const nickname = userData.nickName || userData.nickname || userData.name || userData.loginId || userData.userName;
            const userId = userData.userId || userData.id || userData.uid || userData.accountId;
            const avatar = userData.avatarUrl || userData.avatar || userData.headUrl;
            
            log('aliyun', '提取的用户数据', { userId, nickname, avatar });
            
            // 只要有 userId 或 nickname，就认为已登录
            if (userId || nickname) {
              const validNickname = nickname && 
                nickname !== '阿里云用户' && 
                !nickname.startsWith('aliyun_') 
                  ? nickname 
                  : '阿里云开发者';
              
              log('aliyun', '从 API 检测到登录状态', { userId, nickname: validNickname });
              return {
                loggedIn: true,
                platform: 'aliyun',
                userId: userId ? String(userId) : undefined,
                nickname: validNickname,
                avatar: avatar,
              };
            }
          }
          
          // 检查是否明确返回未登录
          if (data.success === false || data.code === 401 || data.code === 403) {
            log('aliyun', 'API 明确返回未登录');
            return { loggedIn: false, platform: 'aliyun' };
          }
        } catch (parseErr) {
          // JSON 解析失败，但 HTTP 200 可能意味着已登录
          log('aliyun', 'API 响应解析失败，但返回 200', parseErr);
        }
      }
    } catch (e) {
      log('aliyun', 'API getUser 调用失败', e);
    }
    
    // 2. 从页面 DOM 检测
    try {
      // 检查登录按钮是否存在（使用有效的 CSS 选择器）
      const loginBtnSelectors = [
        '.aliyun-header-login',
        'a[href*="login.aliyun"]',
        'a[href*="/login"]',
        '[class*="login-btn"]',
        '[class*="loginBtn"]',
      ];
      
      let hasLoginBtn = false;
      for (const selector of loginBtnSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && (el.textContent?.includes('登录') || el.getAttribute('href')?.includes('login'))) {
            hasLoginBtn = true;
            log('aliyun', '找到登录按钮', { selector, text: el.textContent });
            break;
          }
        } catch {}
      }
      
      // 检查所有按钮是否有"登录"文字
      if (!hasLoginBtn) {
        const allButtons = document.querySelectorAll('button, a');
        for (const btn of allButtons) {
          if (btn.textContent?.trim() === '登录' || btn.textContent?.trim() === '立即登录') {
            hasLoginBtn = true;
            log('aliyun', '找到登录按钮（文字匹配）', { text: btn.textContent });
            break;
          }
        }
      }
      
      // 获取用户头像
      const avatarSelectors = [
        '.aliyun-header-user img',
        '.aliyun-user-avatar img',
        'header img[class*="avatar"]',
        'header img[src*="avatar"]',
        '[class*="user-avatar"] img',
        '[class*="userAvatar"] img',
      ];
      
      let avatarEl: HTMLImageElement | null = null;
      for (const selector of avatarSelectors) {
        try {
          avatarEl = document.querySelector(selector) as HTMLImageElement;
          if (avatarEl?.src && !avatarEl.src.includes('default') && avatarEl.src.startsWith('http')) {
            log('aliyun', '找到用户头像', { selector, src: avatarEl.src });
            break;
          }
          avatarEl = null;
        } catch {}
      }
      
      log('aliyun', 'DOM 检测结果', { hasLoginBtn, hasAvatar: !!avatarEl?.src });
      
      // 如果有用户头像且没有登录按钮，认为已登录
      if (avatarEl?.src && !hasLoginBtn) {
        log('aliyun', '从 DOM 检测到登录状态（有头像无登录按钮）');
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: '阿里云开发者',
          avatar: avatarEl.src,
        };
      }
      
      // 如果明确有登录按钮且没有头像，说明未登录
      if (hasLoginBtn && !avatarEl?.src) {
        log('aliyun', '检测到登录按钮且无头像，判定为未登录');
        return { loggedIn: false, platform: 'aliyun' };
      }
    } catch (e) {
      log('aliyun', 'DOM 检测异常', e);
    }
    
    // 3. 尝试从页面全局变量获取用户信息
    try {
      const win = window as any;
      // 阿里云可能在全局变量中存储用户信息
      const possibleUserVars = [
        win.__INITIAL_STATE__?.user,
        win.__USER_INFO__,
        win.USER_INFO,
        win.userInfo,
        win.__NUXT__?.state?.user,
        win.g_config?.user,
      ];
      
      for (const userData of possibleUserVars) {
        if (userData && (userData.userId || userData.id || userData.nickName)) {
          const userId = userData.userId || userData.id;
          const nickname = userData.nickName || userData.nickname || userData.name;
          
          if (userId || nickname) {
            log('aliyun', '从全局变量检测到登录状态', { userId, nickname });
            return {
              loggedIn: true,
              platform: 'aliyun',
              userId: userId ? String(userId) : undefined,
              nickname: nickname || '阿里云开发者',
              avatar: userData.avatarUrl || userData.avatar,
            };
          }
        }
      }
    } catch (e) {
      log('aliyun', '全局变量检测异常', e);
    }
    
    // 4. 备用 API
    try {
      const res = await fetch('https://developer.aliyun.com/developer/api/user/getUserInfo', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      
      log('aliyun', 'API getUserInfo 响应状态', { status: res.status });
      
      if (res.ok) {
        const data = await res.json();
        const userData = data.data || data.result || data;
        
        if (data.success !== false && userData) {
          const nickname = userData.nickName || userData.nickname || userData.name;
          const userId = userData.userId || userData.id;
          
          if (userId || nickname) {
            log('aliyun', '从备用 API 检测到登录状态', { userId, nickname });
            return {
              loggedIn: true,
              platform: 'aliyun',
              userId: userId ? String(userId) : undefined,
              nickname: nickname || '阿里云开发者',
              avatar: userData.avatarUrl || userData.avatar,
            };
          }
        }
      }
    } catch (e) {
      log('aliyun', 'API getUserInfo 调用失败', e);
    }
    
    log('aliyun', '所有检测方式都未能确认登录状态，判定为未登录');
    return { loggedIn: false, platform: 'aliyun' };
  },
};

// ============================================================
// 思否检测器 - 多重检测策略
// ============================================================
// 思否检测器 - 多重检测策略（优化版）
//
// 思否网站特点：
// 1. 登录后页面右上角显示用户头像
// 2. 用户主页格式：https://segmentfault.com/u/{slug}
// 3. 页面可能包含 __INITIAL_STATE__ 全局变量
// 4. 注意：页面中可能有多个用户链接（如文章作者），需要精确定位当前登录用户
// ============================================================
const segmentfaultDetector: PlatformAuthDetector = {
  id: 'segmentfault',
  urlPatterns: [/segmentfault\.com/],
  async checkLogin(): Promise<LoginState> {
    const isSegmentfaultSlugLike = (value: string): boolean => {
      const v = value.trim();
      if (!v || v.length > 50) return false;
      if (/[^\x00-\x7F]/.test(v)) return false;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(v)) return false;
      return !/^\d+$/.test(v);
    };

    const slugFromUrl = (() => {
      const match = window.location.pathname.match(/^\/u\/([^\/?#]+)/);
      return match?.[1];
    })();
    log('segmentfault', '检测登录状态...');

    // 辅助函数：从 DOM 中提取当前登录用户信息
    // 关键：只从导航栏右上角的用户下拉菜单区域提取，避免误提取文章作者
    const extractUserFromDom = (): { nickname?: string; avatar?: string; userId?: string } => {
      let nickname: string | undefined;
      let avatar: string | undefined;
      let userId: string | undefined;

      const excludedTexts = ['我的', '设置', '退出', '登录', '登出', 'logout', 'settings', 'profile', '个人中心', '写文章', '提问题', '我的主页', '消息', '收藏', '关注'];

      const isValidNickname = (text?: string): boolean => {
        if (!text) return false;
        const trimmed = text.trim();
        if (!trimmed || trimmed.length >= 50) return false;
        if (excludedTexts.some(excluded => trimmed === excluded || trimmed.toLowerCase() === excluded.toLowerCase())) return false;
        // 排除纯 slug 格式的文本
        if (isSegmentfaultSlugLike(trimmed)) return false;
        return true;
      };

      // 1. 思否登录后，右上角有用户下拉菜单
      // 关键选择器：导航栏中的 dropdown 或 user 相关区域
      // 注意：只匹配导航栏顶部区域，不要匹配页面内容中的用户信息

      // 首先尝试从 header/navbar 中的下拉菜单获取
      const headerEl = document.querySelector('header, .navbar, nav, [class*="header"]');
      if (headerEl) {
        // 在 header 中查找用户下拉菜单
        // 思否的用户下拉菜单通常有特定的类名
        const dropdownSelectors = [
          '.nav-user-dropdown', // 思否特有的用户下拉菜单
          '.user-dropdown',
          '[class*="nav-user"]',
          '.dropdown', // 通用下拉菜单
          '[class*="dropdown"]',
          '[class*="user-menu"]',
        ];

        for (const selector of dropdownSelectors) {
          const dropdowns = headerEl.querySelectorAll(selector);
          for (const dropdown of dropdowns) {
            // 只在“当前登录用户菜单”区域提取，避免误抓推荐/列表/评论区的用户链接
            const hasUserMenuMarker = !!dropdown.querySelector(
              'a[href*="/user/settings"], a[href*="/user/logout"], a[href*="logout"], a[href*="settings"]'
            );
            if (!hasUserMenuMarker) continue;

            // 检查是否是用户相关的下拉菜单（包含用户链接）
            const userLinks = dropdown.querySelectorAll('a[href*="/u/"]') as NodeListOf<HTMLAnchorElement>;
            
            // 遍历所有用户链接，找到当前登录用户的链接
            // 通常第一个用户链接是当前登录用户的主页链接
            for (const userLink of userLinks) {
              const href = userLink.href || userLink.getAttribute('href') || '';
              const match = href.match(/\/u\/([^\/\?#]+)/);
              if (match?.[1] && isSegmentfaultSlugLike(match[1])) {
                // 检查这个链接是否在下拉菜单的触发器区域（而不是菜单项）
                // 或者是否是"我的主页"类型的链接
                const linkText = userLink.textContent?.trim() || '';
                const isProfileLink = linkText.includes('主页') || linkText.includes('profile') || 
                                     userLink.classList.contains('user-link') ||
                                     userLink.closest('.dropdown-toggle, .dropdown-trigger, [data-toggle]');
                
                if (isProfileLink || !userId) {
                  userId = match[1].trim();
                  log('segmentfault', '从导航栏下拉菜单提取到 userId', { userId, linkText });
                }
              }
            }

            if (userId) {
              // 提取头像 - 优先从下拉菜单触发器中获取
              const triggerImg = dropdown.querySelector(':scope > a img, :scope > button img, :scope > div > img, .dropdown-toggle img, [data-toggle] img') as HTMLImageElement;
              if (triggerImg?.src && !triggerImg.src.includes('default') && !triggerImg.src.includes('placeholder')) {
                avatar = triggerImg.src;
              }

              // 如果没有直接子图片，尝试其他位置
              if (!avatar) {
                const anyImg = dropdown.querySelector('img[src*="avatar"], img[class*="avatar"], img[src*="cdn.segmentfault"]') as HTMLImageElement;
                if (anyImg?.src && !anyImg.src.includes('default') && !anyImg.src.includes('placeholder')) {
                  avatar = anyImg.src;
                }
              }

              // 提取昵称 - 从下拉菜单内的用户链接文本或特定元素
              // 注意：不要使用下拉菜单中的菜单项文本（如"我的主页"、"设置"等）
              const nicknameSelectors = [
                '[class*="nickname"]',
                '[class*="user-name"]',
                '[class*="username"]',
                '.dropdown-toggle span',
                '[data-toggle] span',
              ];

              for (const nickSelector of nicknameSelectors) {
                const nickEl = dropdown.querySelector(nickSelector);
                if (nickEl && isValidNickname(nickEl.textContent)) {
                  nickname = nickEl.textContent!.trim();
                  break;
                }
              }

              break; // 找到用户 slug 后跳出
            }
          }
          if (userId) break;
        }
      }

      // 2. 如果还没找到，尝试从更通用的导航区域查找
      // 但要更加严格，只匹配明确的用户区域
      if (!userId) {
        // 查找导航栏中的用户头像区域
        const userAvatarSelectors = [
          'header img[class*="avatar"]',
          'nav img[class*="avatar"]',
          '.navbar img[class*="avatar"]',
          '[class*="header"] img[class*="avatar"]',
        ];

        for (const selector of userAvatarSelectors) {
          const avatarImg = document.querySelector(selector) as HTMLImageElement;
          if (avatarImg?.src && !avatarImg.src.includes('default') && !avatarImg.src.includes('placeholder')) {
            // 找到头像后，查找附近的用户链接
            const parentEl = avatarImg.closest('a[href*="/u/"], [class*="dropdown"], [class*="user"]');
            if (parentEl) {
              const userLink = parentEl.querySelector('a[href*="/u/"]') as HTMLAnchorElement || 
                              (parentEl.tagName === 'A' ? parentEl as HTMLAnchorElement : null);
              if (userLink) {
                const href = userLink.href || userLink.getAttribute('href') || '';
                const match = href.match(/\/u\/([^\/\?#]+)/);
                if (match?.[1] && isSegmentfaultSlugLike(match[1])) {
                  userId = match[1].trim();
                  avatar = avatarImg.src;
                  log('segmentfault', '从导航区域头像提取到 userId', { userId });
                  break;
                }
              }
            }
          }
        }
      }

      return { nickname, avatar, userId };
    };
    
    // 辅助函数：从全局变量提取用户信息
    const extractUserFromGlobal = (): { nickname?: string; avatar?: string; userId?: string } | null => {
      const win = window as any;
      
      // 尝试多种可能的全局变量
      const possibleSources = [
        win.__INITIAL_STATE__,
        win.__NUXT__,
        win.SF,
        win.__SF__,
        win.pageData,
        win.__pageData__,
      ];
      
      for (const source of possibleSources) {
        if (!source) continue;
        
        // 尝试从不同路径获取用户信息
        const userPaths = [
          source.currentUser,
          source.auth?.user,
          source.auth?.currentUser,
          source.global?.currentUser,
          source.global?.user,
          source.state?.auth?.user,
          source.state?.currentUser,
        ];
        
        for (const user of userPaths) {
          if (user && (user.id || user.uid || user.slug || user.name)) {
            // 思否中 name 是 URL slug，nickname 才是真实显示名称
            const nameField = typeof user.name === 'string' ? user.name : '';
            const displayName =
              user.nickName ||
              user.nickname ||
              user.nick ||
              (!isSegmentfaultSlugLike(nameField) ? nameField : '') ||
              '';
            log('segmentfault', '从全局变量获取到用户信息', { nickname: displayName, slug: user.name });
            const userId =
              (typeof user.slug === 'string' && isSegmentfaultSlugLike(user.slug) && user.slug.trim()) ||
              (typeof user.username === 'string' && isSegmentfaultSlugLike(user.username) && user.username.trim()) ||
              (typeof user.user_name === 'string' && isSegmentfaultSlugLike(user.user_name) && user.user_name.trim()) ||
              (typeof user.name === 'string' && isSegmentfaultSlugLike(user.name) && user.name.trim()) ||
              undefined;
            return {
              userId,
              nickname: displayName,
              avatar: user.avatar || user.avatarUrl || user.avatar_url,
            };
          }
        }
      }
      
      return null;
    };

    const fetchSegmentfaultProfileBySlug = async (
      userId: string
    ): Promise<{ nickname?: string; avatar?: string } | null> => {
      const slug = userId.trim();
      if (!slug || !isSegmentfaultSlugLike(slug)) return null;

      const normalizeProfileUrl = (value?: string): string | undefined => {
        if (!value) return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (trimmed.startsWith('//')) return `https:${trimmed}`;
        if (trimmed.startsWith('/')) return `https://segmentfault.com${trimmed}`;
        return trimmed;
      };

      try {
        const res = await fetch(`https://segmentfault.com/u/${slug}`, {
          credentials: 'include',
          headers: { 'Accept': 'text/html,application/xhtml+xml' },
        });

        if (!res.ok) return null;
        const html = await res.text();
        const scope = (() => {
          const idx = html.search(/class=["'][^"']*userinfo[^"']*["']/i);
          if (idx >= 0) {
            return html.substring(Math.max(0, idx - 4000), Math.min(html.length, idx + 12000));
          }
          return html.substring(0, 60000);
        })();

        let nickname: string | undefined;
        const namePatterns = [
          /<h3[^>]*class=["'][^"']*text-center[^"']*["'][^>]*>([^<]+)<\/h3>/i,
          /<div[^>]*class=["'][^"']*userinfo[^"']*["'][^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/i,
          /<div[^>]*class=["'][^"']*card-body[^"']*["'][^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/i,
          /<title>([^<\-]+)\s*[-–—]/i,
        ];

        for (const pattern of namePatterns) {
          const match = scope.match(pattern) || html.match(pattern);
          const value = match?.[1]?.trim();
          if (value && value.length < 50 && !isSegmentfaultSlugLike(value)) {
            nickname = value;
            break;
          }
        }

        let avatar: string | undefined;
        const avatarPatterns = [
          /<img[^>]+class=["'][^"']*avatar[^"']*["'][^>]+src=["']([^"']+)["']/i,
          /<img[^>]+src=["']([^"']+cdn\.segmentfault[^"']+)["']/i,
          /<img[^>]+src=["']([^"']+avatar[^"']+)["']/i,
        ];

        for (const pattern of avatarPatterns) {
          const match = scope.match(pattern) || html.match(pattern);
          const value = normalizeProfileUrl(match?.[1]);
          if (!value) continue;
          if (/default|placeholder/i.test(value)) continue;
          avatar = value;
          break;
        }

        if (!nickname && !avatar) return null;
        return { nickname, avatar };
      } catch {
        return null;
      }
    };
    
    const extractCurrentUserFromUserMenu = async (): Promise<{
      nickname?: string;
      avatar?: string;
      userId?: string;
    } | null> => {
      const normalizeSlugFromHref = (href: string): string | undefined => {
        const match = href.match(/\/u\/([^\/\?#]+)/);
        const candidate = (match?.[1] || '').trim();
        return candidate && isSegmentfaultSlugLike(candidate) ? candidate : undefined;
      };

      const excludedTexts = [
        '我的',
        '设置',
        '退出',
        '登录',
        '登出',
        'logout',
        'settings',
        'profile',
        '个人中心',
        '写文章',
        '提问',
        '我的主页',
        '消息',
        '收藏',
        '关注',
      ];

      const isValidLabel = (text?: string): boolean => {
        if (!text) return false;
        const trimmed = text.trim();
        if (!trimmed || trimmed.length >= 50) return false;
        if (/^\d+$/.test(trimmed)) return false;
        if (excludedTexts.some((excluded) => trimmed === excluded || trimmed.toLowerCase() === excluded.toLowerCase())) {
          return false;
        }
        return true;
      };

      const isElementVisible = (el: Element): boolean => {
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el as Element);
        if (!style) return true;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        return true;
      };

      const pickAvatarFromImg = (img?: HTMLImageElement | null): string | undefined => {
        const src = img?.src?.trim();
        if (!src) return undefined;
        if (src.includes('default') || src.includes('placeholder')) return undefined;
        return src;
      };

      const pickAvatarFromContainer = (container?: Element | null): string | undefined => {
        if (!container) return undefined;
        const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
        for (const img of imgs) {
          const src = img.src?.trim();
          if (!src) continue;
          if (src.includes('default') || src.includes('placeholder')) continue;
          const cls = (img.className || '').toString().toLowerCase();
          if (cls.includes('avatar') || src.includes('avatar') || src.includes('cdn.segmentfault')) {
            return src;
          }
        }
        return pickAvatarFromImg(imgs[0]);
      };

      const header = (document.querySelector('#sf-header') ||
        document.querySelector('header, .navbar, nav, [class*="header"]')) as HTMLElement | null;
      if (!header) return null;

      const candidateImgs = Array.from(header.querySelectorAll('img')) as HTMLImageElement[];
      const headerAvatarImg = candidateImgs
        .filter((img) => {
          const src = img.src || '';
          const cls = (img.className || '').toString().toLowerCase();
          const alt = (img.getAttribute('alt') || '').toLowerCase();
          if (!src) return false;
          if (!isElementVisible(img)) return false;
          if (src.includes('default') || src.includes('placeholder')) return false;
          return cls.includes('avatar') || src.includes('avatar') || src.includes('cdn.segmentfault') || alt.includes('avatar');
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.right - ar.right;
        })[0];

      const trigger =
        (headerAvatarImg?.closest('a, button, [role="button"], [class*="nav-user"], [class*="user"], [class*="dropdown"]') ||
          header.querySelector('.nav-user-dropdown, .user-dropdown, [class*="nav-user"], [class*="user-dropdown"], [class*="user-menu"]')) as
          | HTMLElement
          | null;

      const triggerAvatar = pickAvatarFromImg(headerAvatarImg);

      const hasUserMenuMarkers = (menu: Element): boolean => {
        return (
          !!menu.querySelector('a[href*="/user/settings"], a[href*="/user/logout"], a[href*="logout"], a[href*="settings"]') ||
          /logout|settings|退出|设置/i.test(menu.textContent || '')
        );
      };

      const findMenu = (): Element | null => {
        const menus = Array.from(
          document.querySelectorAll(
            '[role="menu"], .dropdown-menu, .nav-user-dropdown, .user-dropdown, [class*="user-menu"], [class*="popover"]'
          )
        ) as HTMLElement[];

        const candidates = menus
          .filter((menu) => isElementVisible(menu) && hasUserMenuMarkers(menu))
          .map((menu) => {
            const rect = menu.getBoundingClientRect();
            const triggerRect = trigger?.getBoundingClientRect?.();
            const score = triggerRect
              ? Math.abs(rect.top - triggerRect.bottom) + Math.abs(rect.left - triggerRect.left)
              : rect.top;
            return { menu, score };
          })
          .sort((a, b) => a.score - b.score);

        return candidates[0]?.menu || null;
      };

      if (trigger) {
        try {
          trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch {}
      }

      const menu = await waitForValue(() => findMenu(), { timeoutMs: 1200 });
      if (!menu) return triggerAvatar ? { avatar: triggerAvatar } : null;

      const links = Array.from(
        menu.querySelectorAll('a[href^="/u/"], a[href^="https://segmentfault.com/u/"]')
      ) as HTMLAnchorElement[];
      let profileLink: HTMLAnchorElement | undefined;
      let fallbackLink: HTMLAnchorElement | undefined;

      for (const link of links) {
        const href = link.getAttribute('href') || link.href || '';
        const userId = normalizeSlugFromHref(href);
        if (!userId) continue;
        if (!fallbackLink) fallbackLink = link;
        const text = link.textContent?.trim();
        if (isValidLabel(text)) {
          profileLink = link;
          break;
        }
      }

      profileLink = profileLink || fallbackLink;
      if (!profileLink) return triggerAvatar ? { avatar: triggerAvatar } : null;

      const userId = normalizeSlugFromHref(profileLink.getAttribute('href') || profileLink.href || '');
      if (!userId) return triggerAvatar ? { avatar: triggerAvatar } : null;

      const card = profileLink.closest('a, li, div') || profileLink;
      let nickname = isValidLabel(profileLink.textContent) ? profileLink.textContent!.trim() : undefined;
      if (!nickname) {
        const preferredSelectors = ['[class*="nickname"]', '[class*="user-name"]', '[class*="username"]'];
        for (const selector of preferredSelectors) {
          const el = card.querySelector(selector) || menu.querySelector(selector);
          const text = el?.textContent?.trim();
          if (isValidLabel(text)) {
            nickname = text;
            break;
          }
        }
      }
      if (!nickname) {
        const nodes = Array.from(card.querySelectorAll('a, span, div')) as HTMLElement[];
        for (const node of nodes) {
          const text = node.textContent?.trim();
          if (isValidLabel(text)) {
            nickname = text;
            break;
          }
        }
      }

      const avatar = pickAvatarFromContainer(card) || pickAvatarFromContainer(menu) || triggerAvatar;

      return {
        userId,
        nickname,
        avatar,
      };
    };

    const menuUser = await extractCurrentUserFromUserMenu();
    let menuResolved: LoginState | null = null;

    if (menuUser?.userId) {
      let nickname = menuUser.nickname;
      let avatar = menuUser.avatar;

      if (!nickname || !avatar) {
        const profile = await fetchSegmentfaultProfileBySlug(menuUser.userId);
        if (!nickname && profile?.nickname) nickname = profile.nickname;
        if (!avatar && profile?.avatar) avatar = profile.avatar;
      }

      menuResolved = {
        loggedIn: true,
        platform: 'segmentfault',
        userId: menuUser.userId,
        nickname,
        avatar,
      };

      if (nickname && avatar) {
        return {
          ...menuResolved,
          nickname: nickname || '思否用户',
        };
      }
    }

    // 1. 尝试 API（多个可能的接口）
    const apiEndpoints = [
      'https://segmentfault.com/api/users/-/info',
      'https://segmentfault.com/api/user/info',
      'https://segmentfault.com/api/user/-/info',
      'https://segmentfault.com/gateway/user/-/info',
    ];

    let apiUser: LoginState | null = null;
    
    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetch(endpoint, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        if (res.ok) {
          const text = await res.text();
          // 检查是否是 HTML
          if (text.startsWith('<!') || text.startsWith('<html')) {
            continue;
          }
          
          try {
            const data = JSON.parse(text);
            // 兼容多种响应格式
            const user = data.data || data.user || data;
            const isSuccess = data.status === 0 || data.code === 0 || data.success === true || 
                             (user && (user.id || user.uid || user.slug || user.name));
            
            if (isSuccess && user && (user.id || user.uid || user.slug || user.name)) {
              // 思否中 name 是 URL slug，nickname 才是真实显示名称
              const nameField = typeof user.name === 'string' ? user.name : '';
              const displayName =
                user.nickName ||
                user.nickname ||
                user.nick ||
                (!isSegmentfaultSlugLike(nameField) ? nameField : '') ||
                '';
              log('segmentfault', '从 API 获取到用户信息', { endpoint, nickname: displayName, slug: user.name });
              apiUser = {
                loggedIn: true,
                platform: 'segmentfault',
                userId:
                  (typeof user.slug === 'string' && isSegmentfaultSlugLike(user.slug) && user.slug.trim()) ||
                  (typeof user.username === 'string' && isSegmentfaultSlugLike(user.username) && user.username.trim()) ||
                  (typeof user.user_name === 'string' && isSegmentfaultSlugLike(user.user_name) && user.user_name.trim()) ||
                  (typeof user.name === 'string' && isSegmentfaultSlugLike(user.name) && user.name.trim()) ||
                  undefined,
                nickname: displayName || '思否用户',
                avatar: user.avatar || user.avatarUrl || user.avatar_url,
                meta: {
                  followersCount: user.followers || user.follower_count,
                  articlesCount: user.articles || user.article_count,
                },
              };
              break;
            }
          } catch {}
        }
      } catch (e) {
        log('segmentfault', `API ${endpoint} 调用失败`, e);
      }

      if (apiUser) break;
    }

    // 2. 优先使用“右上角当前登录用户头像菜单”提取的 userId/昵称/头像，避免误抓页面其他用户信息
    if (menuResolved) {
      const mergedNickname =
        menuResolved.nickname ||
        (apiUser?.userId === menuResolved.userId ? apiUser.nickname : undefined) ||
        '思否用户';
      const mergedAvatar = menuResolved.avatar || (apiUser?.userId === menuResolved.userId ? apiUser.avatar : undefined);

      return {
        ...menuResolved,
        nickname: mergedNickname,
        avatar: mergedAvatar,
        meta: apiUser?.meta,
      };
    }

    if (apiUser) return apiUser;

    if (menuUser && (menuUser.nickname || menuUser.avatar)) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        nickname: menuUser.nickname || '思否用户',
        avatar: menuUser.avatar,
      };
    }
    
    // 3. Prefer global currentUser state before generic DOM parsing.
    const globalUser = extractUserFromGlobal();
    if (globalUser && globalUser.userId) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: globalUser.userId,
        nickname: globalUser.nickname || '思否用户',
        avatar: globalUser.avatar,
      };
    }

    // 4. 从 DOM 中提取用户信息
    const domUser = extractUserFromDom();
    if (domUser.avatar || domUser.nickname || domUser.userId) {
      log('segmentfault', '从 DOM 获取到用户信息', domUser);
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: domUser.userId,
        nickname: domUser.nickname || '思否用户',
        avatar: domUser.avatar,
      };
    }

    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="/user/logout"]',
      'a[href*="/user/settings"]',
      '[data-action="logout"]',
      '.logout-btn',
      '.dropdown-menu a[href*="logout"]',
      // 思否特有的用户菜单
      '.user-dropdown',
      '.nav-user-dropdown',
      '[class*="user"][class*="dropdown"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('segmentfault', '检测到退出/设置按钮或用户菜单', { selector });
        
        // 尝试再次从 DOM 提取用户信息
        const retryDomUser = await waitForValue(() => {
          const user = extractUserFromDom();
          return (user.nickname || user.avatar) ? user : null;
        }, { timeoutMs: 2000 });
        
        return {
          loggedIn: true,
          platform: 'segmentfault',
          userId: retryDomUser?.userId,
          nickname: retryDomUser?.nickname || '思否用户',
          avatar: retryDomUser?.avatar,
        };
      }
    }
    
    // 5. 检查登录按钮是否存在（如果存在登录按钮，说明未登录）
    const loginBtnSelectors = [
      'a[href*="/user/login"]',
      'a[href*="login"]',
      '.login-btn',
      '[class*="login"][class*="btn"]',
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
    
    if (hasLoginBtn) {
      log('segmentfault', '检测到登录按钮，判定为未登录');
      return { loggedIn: false, platform: 'segmentfault' };
    }
    
    // 6. 最后尝试让 background 检测
    const bg = await fetchPlatformInfoFromBackground('segmentfault');
    if (bg?.loggedIn) {
      log('segmentfault', '从 background 获取到登录状态', bg);
      return {
        ...bg,
        nickname: bg.nickname || '思否用户',
      };
    }
    
    log('segmentfault', '未检测到登录状态');
    return { loggedIn: false, platform: 'segmentfault' };
  },
};

// ============================================================
// B站专栏检测器 - API 优先
// ============================================================
const bilibiliDetector: PlatformAuthDetector = {
  id: 'bilibili',
  urlPatterns: [/bilibili\.com/],
  async checkLogin(): Promise<LoginState> {
    log('bilibili', '检测登录状态...');
    
    // 优先使用 API（这个 API 非常可靠）
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.code === 0 && data.data?.isLogin) {
          const user = data.data;
          log('bilibili', '从 API 获取到用户信息', { nickname: user.uname });
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
      }
    } catch (e) {
      log('bilibili', 'API 调用失败', e);
    }
    
    return { loggedIn: false, platform: 'bilibili' };
  },
};

// ============================================================
// 开源中国检测器 - 多重检测策略
// 
// 开源中国网站特点：
// 1. 登录后页面右上角显示用户头像和昵称
// 2. 用户主页格式：https://my.oschina.net/u/{userId}
// 3. 可能存在全局变量 G_USER
// 4. 登录页面：https://www.oschina.net/home/login
// ============================================================
const oschinaDetector: PlatformAuthDetector = {
  id: 'oschina',
  urlPatterns: [/oschina\.net/],
  async checkLogin(): Promise<LoginState> {
    log('oschina', '检测登录状态...');
    const url = window.location.href;

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
    
    // 辅助函数：从 DOM 中提取用户信息
    // 开源中国的用户信息通常在页面顶部导航栏的用户下拉菜单中
    const extractUserFromDom = (): { nickname?: string; avatar?: string; userId?: string } => {
      let nickname: string | undefined;
      let avatar: string | undefined;
      let userId: string | undefined;
      
      // 排除的文本（菜单项、按钮等）
      const excludedTexts = ['登录', '注册', '退出', '设置', '我的', '消息', '收藏', '关注', '开源中国', 'OSCHINA'];
      
      const isValidNickname = (text?: string): boolean => {
        if (!text) return false;
        const trimmed = text.trim();
        if (!trimmed || trimmed.length >= 50 || trimmed.length < 2) return false;
        if (excludedTexts.some(excluded => trimmed === excluded || trimmed.toLowerCase() === excluded.toLowerCase())) return false;
        return true;
      };

      // 优先从侧边栏用户信息区域提取（my.oschina.net 页面）
      const sidebarScope =
        document.querySelector('#userSidebar') ||
        document.querySelector('.sidebar-section.user-info') ||
        document.querySelector('.space-sidebar') ||
        document.querySelector('.user-text');

      if (sidebarScope) {
        const scope = sidebarScope.closest('.sidebar-section.user-info') || sidebarScope;
        const profileLink = scope.querySelector('a[href*="my.oschina.net/u/"]') as HTMLAnchorElement | null;
        const href = profileLink?.getAttribute('href') || profileLink?.href || '';
        const match = href.match(/\/u\/(\d+)/);
        if (match?.[1]) {
          userId = match[1];
        }

        const nicknameCandidates = [
          scope.querySelector('.user-name .name'),
          scope.querySelector('.user-name'),
          scope.querySelector('.user-name__inner'),
          scope.querySelector('span.name'),
          scope.querySelector('span[class*="name"]'),
        ];

        for (const node of nicknameCandidates) {
          const text = readTextFromEl(node);
          if (isValidNickname(text)) {
            nickname = text!.trim();
            break;
          }
        }

        if (!nickname && profileLink) {
          const linkText = profileLink.textContent?.trim();
          if (isValidNickname(linkText)) {
            nickname = linkText;
          }
        }

        const avatarContainer = scope.querySelector('.avatar-wrap') || scope.querySelector('img');
        const rawAvatar = readAvatarUrlFromEl(avatarContainer);
        const normalizedAvatar = normalizeUrl(rawAvatar, 'https://my.oschina.net') || normalizeUrl(rawAvatar);
        if (
          normalizedAvatar &&
          !normalizedAvatar.includes('logo') &&
          !normalizedAvatar.includes('icon') &&
          !normalizedAvatar.includes('favicon') &&
          !normalizedAvatar.includes('sprite') &&
          !normalizedAvatar.includes('loading') &&
          !normalizedAvatar.includes('placeholder') &&
          !normalizedAvatar.includes('default')
        ) {
          avatar = normalizedAvatar;
        }

        if (userId || nickname || avatar) {
          return { nickname, avatar, userId };
        }
      }
      
      // 1. 尝试从导航栏用户区域提取（最可靠）
      // 开源中国的用户下拉菜单通常在页面顶部
      const headerEl = document.querySelector('header, .header, nav, .navbar, [class*="header"]');
      if (headerEl) {
        // 查找用户下拉菜单或用户信息区域
        const userAreaSelectors = [
          '.user-dropdown',
          '.user-menu',
          '.user-info',
          '.current-user',
          '[class*="user"][class*="dropdown"]',
          '[class*="user"][class*="menu"]',
          '[class*="user"][class*="info"]',
          '.header-user',
          '.nav-user',
        ];
        
        for (const selector of userAreaSelectors) {
          const userArea = headerEl.querySelector(selector) || document.querySelector(selector);
          if (userArea) {
            // 提取用户 ID - 从用户主页链接
            const userLinks = userArea.querySelectorAll('a[href*="/u/"]') as NodeListOf<HTMLAnchorElement>;
            for (const link of userLinks) {
              const href = link.href || link.getAttribute('href') || '';
              const match = href.match(/\/u\/(\d+)/);
              if (match?.[1]) {
                userId = match[1];
                // 如果链接文本是有效的用户名，使用它
                const linkText = link.textContent?.trim();
                if (isValidNickname(linkText)) {
                  nickname = linkText;
                }
                log('oschina', '从用户区域提取到 userId', { userId, nickname });
                break;
              }
            }
            
            // 提取头像 - 优先从用户区域的 img 标签获取
            if (!avatar) {
              const avatarSelectors = [
                'img[class*="avatar"]',
                'img[class*="portrait"]',
                'img[src*="oscimg"]',
                'img[src*="static.oschina"]',
                'img[src*="avatar"]',
                'img[src*="portrait"]',
                'img',
              ];
              for (const imgSelector of avatarSelectors) {
                const img = userArea.querySelector(imgSelector) as HTMLImageElement;
                if (img?.src && img.src.includes('http') && 
                    !img.src.includes('default') && !img.src.includes('placeholder') &&
                    !img.src.includes('logo') && !img.src.includes('icon')) {
                  avatar = img.src;
                  log('oschina', '从用户区域提取到头像', { avatar });
                  break;
                }
              }
            }
            
            // 提取昵称 - 如果还没有
            if (!nickname) {
              const nicknameSelectors = [
                '[class*="name"]',
                '[class*="nick"]',
                '[class*="account"]',
                'span',
              ];
              for (const nickSelector of nicknameSelectors) {
                const nickEl = userArea.querySelector(nickSelector);
                if (nickEl && isValidNickname(nickEl.textContent)) {
                  nickname = nickEl.textContent!.trim();
                  break;
                }
              }
            }
            
            if (userId || avatar || nickname) break;
          }
        }
      }
      
      // 2. 尝试从页面中的用户链接提取（备用）
      if (!userId) {
        // 只在导航区域查找，避免误匹配文章作者
        const navUserLinks = document.querySelectorAll('header a[href*="my.oschina.net/u/"], nav a[href*="my.oschina.net/u/"], .header a[href*="my.oschina.net/u/"]');
        for (const link of navUserLinks) {
          const href = (link as HTMLAnchorElement).href;
          const match = href.match(/\/u\/(\d+)/);
          if (match?.[1]) {
            userId = match[1];
            const linkText = link.textContent?.trim();
            if (!nickname && isValidNickname(linkText)) {
              nickname = linkText;
            }
            log('oschina', '从导航区域链接提取到 userId', { userId });
            break;
          }
        }
      }

      // 3. 尝试从导航栏头像图片提取（备用）
      if (!avatar) {
        const headerAvatarSelectors = [
          'header img[class*="avatar"]',
          'header img[src*="oscimg"]',
          'header img[src*="portrait"]',
          'nav img[class*="avatar"]',
          '.header img[class*="avatar"]',
          '.navbar img[class*="avatar"]',
        ];
        for (const selector of headerAvatarSelectors) {
          const img = document.querySelector(selector) as HTMLImageElement;
          if (img?.src && img.src.includes('http') && 
              !img.src.includes('default') && !img.src.includes('placeholder') &&
              !img.src.includes('logo') && !img.src.includes('icon')) {
            avatar = img.src;
            log('oschina', '从导航栏头像提取', { avatar });
            break;
          }
        }
      }
      
      return { nickname, avatar, userId };
    };

    const reconcileWithBackground = async (local: LoginState): Promise<LoginState> => {
      try {
        const bg = await fetchPlatformInfoFromBackground('oschina');
        if (bg?.loggedIn) {
          const mergedUserId = bg.userId || local.userId;
          const mergedNickname = bg.nickname || local.nickname || '开源中国用户';
          const mergedAvatar = bg.avatar || local.avatar;

          // 如果本地从页面提取的是"正在浏览的他人主页"，而 background 基于 Cookie 得到的是当前登录用户，则以 background 为准
          if (bg.userId && local.userId && bg.userId !== local.userId) {
            return {
              loggedIn: true,
              platform: 'oschina',
              userId: bg.userId,
              nickname: mergedNickname,
              avatar: mergedAvatar,
              meta: bg.meta || local.meta,
            };
          }

          return {
            loggedIn: true,
            platform: 'oschina',
            userId: mergedUserId,
            nickname: mergedNickname,
            avatar: mergedAvatar,
            meta: { ...(local.meta || {}), ...(bg.meta || {}) },
          };
        }
      } catch {}

      return {
        ...local,
        platform: 'oschina',
        nickname: local.nickname || '开源中国用户',
      };
    };
    
    // 1. 检查是否在登录页面
    if (url.includes('/home/login') || url.includes('/login')) {
      // 检查是否有登录成功的迹象（可能是登录后的重定向）
      const domUser = extractUserFromDom();
      if (domUser.userId || domUser.nickname) {
        log('oschina', '在登录页但检测到用户信息，可能已登录', domUser);
        return await reconcileWithBackground({
          loggedIn: true,
          platform: 'oschina',
          userId: domUser.userId,
          nickname: domUser.nickname || '开源中国用户',
          avatar: domUser.avatar,
        });
      }
      log('oschina', '在登录页面，未检测到登录状态');
      return { loggedIn: false, platform: 'oschina' };
    }
    
    // 2. 检查全局变量
    const win = window as any;
    if (win.G_USER?.id) {
      log('oschina', '从全局变量 G_USER 获取到用户信息', { id: win.G_USER.id, name: win.G_USER.name, account: win.G_USER.account });
      // 开源中国用户名可能在 account、name、nick、nickname 等字段
      const nickname = win.G_USER.account || win.G_USER.nick || win.G_USER.nickname || win.G_USER.name || win.G_USER.userName || win.G_USER.user_name;
      return await reconcileWithBackground({
        loggedIn: true,
        platform: 'oschina',
        userId: String(win.G_USER.id),
        nickname: nickname || '开源中国用户',
        avatar: normalizeUrl(win.G_USER.portrait || win.G_USER.avatar || win.G_USER.img || win.G_USER.avatarUrl),
      });
    }

    // 检查其他可能的全局变量
    const possibleUserVars = [
      win.__USER__,
      win.__INITIAL_STATE__?.user,
      win.pageData?.user,
      win.currentUser,
    ];

    for (const userData of possibleUserVars) {
      if (userData && (userData.id || userData.uid)) {
        log('oschina', '从全局变量获取到用户信息', userData);
        // 尝试多种可能的用户名字段
        const nickname = userData.account || userData.nick || userData.nickname || userData.name || userData.userName || userData.user_name;
        return await reconcileWithBackground({
          loggedIn: true,
          platform: 'oschina',
          userId: String(userData.id || userData.uid),
          nickname: nickname || '开源中国用户',
          avatar: normalizeUrl(userData.portrait || userData.avatar || userData.img || userData.avatarUrl),
        });
      }
    }

    // 3. 尝试 API
    try {
      const res = await fetch('https://www.oschina.net/action/user/info', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (res.ok) {
        const text = await res.text();
        log('oschina', 'API 响应', { status: res.status, text: text.substring(0, 300) });

        // 检查是否是 HTML（重定向到登录页）
        if (!text.includes('<!DOCTYPE') && !text.includes('<html')) {
          try {
            const data = JSON.parse(text);
            const user = data.result || data.data || data;

            if (user && user.id) {
              log('oschina', '从 API 获取到用户信息', { id: user.id, name: user.name, account: user.account, nick: user.nick });
              // 尝试多种可能的用户名字段
              const nickname = user.account || user.nick || user.nickname || user.name || user.userName || user.user_name;
              return await reconcileWithBackground({
                loggedIn: true,
                platform: 'oschina',
                userId: String(user.id),
                nickname: nickname || '开源中国用户',
                avatar: normalizeUrl(user.portrait || user.avatar || user.img || user.avatarUrl || user.avatar_url || user.portraitUrl),
                meta: {
                  followersCount: user.fansCount,
                  articlesCount: user.blogCount,
                },
              });
            }
          } catch (parseErr) {
            log('oschina', 'API 响应解析失败', parseErr);
          }
        }
      }
    } catch (e) {
      log('oschina', 'API 调用失败', e);
    }
    
    // 4. 从 DOM 中提取用户信息
    // my.oschina.net 页面可能需要短时间渲染侧边栏（用户信息卡片），这里做一次短等待以提升稳定性
    const domUser =
      (await waitForValue(() => {
        const user = extractUserFromDom();
        return user.userId || user.nickname || user.avatar ? user : undefined;
      }, { timeoutMs: 2000 })) || extractUserFromDom();
    if (domUser.userId || domUser.nickname || domUser.avatar) {
      log('oschina', '从 DOM 获取到用户信息', domUser);
      return await reconcileWithBackground({
        loggedIn: true,
        platform: 'oschina',
        userId: domUser.userId,
        nickname: domUser.nickname || '开源中国用户',
        avatar: domUser.avatar,
      });
    }
    
    // 5. 检查登录/退出按钮
    // 如果有退出按钮，说明已登录
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="/action/user/logout"]',
      '[class*="logout"]',
      '[data-action="logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          log('oschina', '检测到退出按钮，判定为已登录', { selector });
          return await reconcileWithBackground({
            loggedIn: true,
            platform: 'oschina',
            nickname: '开源中国用户',
          });
        }
      } catch {}
    }
    
    // 如果有登录按钮，说明未登录
    const loginSelectors = [
      'a[href*="/home/login"]',
      'a[href*="login"]',
      '.login-btn',
      '[class*="login"][class*="btn"]',
    ];
    
    let hasLoginBtn = false;
    for (const selector of loginSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
          hasLoginBtn = true;
          log('oschina', '检测到登录按钮', { selector, text: el.textContent });
          break;
        }
      } catch {}
    }
    
    // 6. 检查 Cookie
    try {
      const cookies = document.cookie;
      log('oschina', '当前 Cookie', { cookies: cookies.substring(0, 200) });
      
      // 检查关键 Cookie
      const hasOscid = cookies.includes('oscid=') && !cookies.includes('oscid=;') && !cookies.includes('oscid=deleted');
      const hasUserId = (cookies.includes('user_id=') || cookies.includes('_user_id=')) && 
                        !cookies.includes('user_id=;') && !cookies.includes('user_id=deleted');
      
      if (hasOscid || hasUserId) {
        log('oschina', '从 Cookie 检测到登录状态', { hasOscid, hasUserId });
        return await reconcileWithBackground({
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
        });
      }
    } catch (e) {
      log('oschina', 'Cookie 检测失败', e);
    }
    
    // 7. 最后尝试让 background 检测
    const bg = await fetchPlatformInfoFromBackground('oschina');
    if (bg?.loggedIn) {
      log('oschina', '从 background 获取到登录状态', bg);
      return {
        ...bg,
        nickname: bg.nickname || '开源中国用户',
      };
    }
    
    if (hasLoginBtn) {
      log('oschina', '检测到登录按钮且无其他登录迹象，判定为未登录');
      return { loggedIn: false, platform: 'oschina' };
    }
    
    log('oschina', '未检测到明确的登录状态');
    return { loggedIn: false, platform: 'oschina' };
  },
};

// ============================================================
// 检测器注册表
// ============================================================

const detectors: PlatformAuthDetector[] = [
  juejinDetector,
  csdnDetector,
  zhihuDetector,
  wechatDetector,
  jianshuDetector,
  cnblogsDetector,
  cto51Detector,
  tencentCloudDetector,
  aliyunDetector,
  segmentfaultDetector,
  bilibiliDetector,
  oschinaDetector,
];

/**
 * 根据当前 URL 获取匹配的检测器
 */
function getDetectorForUrl(url: string): PlatformAuthDetector | null {
  for (const detector of detectors) {
    for (const pattern of detector.urlPatterns) {
      if (pattern.test(url)) {
        return detector;
      }
    }
  }
  return null;
}

/**
 * 检测当前页面的登录状态
 */
export async function detectLoginState(): Promise<LoginState> {
  const url = window.location.href;
  log('detect', `检测 URL: ${url}`);
  
  const detector = getDetectorForUrl(url);
  if (!detector) {
    log('detect', '未找到匹配的检测器');
    return { loggedIn: false, error: '不支持的平台' };
  }
  
  log('detect', `使用检测器: ${detector.id}`);
  
  try {
    const state = await detector.checkLogin();
    log('detect', '检测结果', state);
    return state;
  } catch (error: any) {
    log('detect', '检测失败', error);
    return { loggedIn: false, platform: detector.id, error: error.message };
  }
}

/**
 * 启动登录状态轮询
 */
export function startLoginPolling(
  onLoginSuccess: (state: LoginState) => void,
  interval = 2000,
  maxAttempts = 90 // 3分钟
): () => void {
  let attempts = 0;
  let stopped = false;
  
  log('polling', `开始轮询，间隔 ${interval}ms，最大尝试 ${maxAttempts} 次`);
  
  const poll = async () => {
    if (stopped) return;
    
    attempts++;
    const state = await detectLoginState();
    
    log('polling', `第 ${attempts} 次检测`, { loggedIn: state.loggedIn });
    
    if (state.loggedIn) {
      log('polling', '检测到登录成功！', state);
      onLoginSuccess(state);
      return;
    }
    
    if (attempts < maxAttempts && !stopped) {
      setTimeout(poll, interval);
    } else {
      log('polling', '轮询超时');
    }
  };
  
  poll();
  
  return () => {
    stopped = true;
    log('polling', '轮询已停止');
  };
}

/**
 * 初始化登录检测消息监听
 */
export function initAuthDetector() {
  log('init', '初始化登录检测器');
  
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CHECK_LOGIN') {
      log('message', '收到登录检测请求');
      detectLoginState().then(sendResponse);
      return true;
    }
    
    if (message.type === 'START_LOGIN_POLLING') {
      log('message', '收到启动轮询请求');
      startLoginPolling((state) => {
        chrome.runtime.sendMessage({
          type: 'LOGIN_SUCCESS',
          data: state,
        });
      });
      sendResponse({ started: true });
      return true;
    }
    
    return false;
  });
}
