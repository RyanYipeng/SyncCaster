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
    
    // 优先使用 API
    try {
      const res = await fetch('https://me.csdn.net/api/user/show', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.code === 200 && data.data) {
          const user = data.data;
          log('csdn', '从 API 获取到用户信息', { nickname: user.nickname });
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
        if (data.code === 200 && data.data) {
          const user = data.data;
          log('csdn', '从备用 API 获取到用户信息');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username,
            nickname: user.nickName || user.username,
            avatar: user.avatar,
          };
        }
      }
    } catch {}
    
    // 检查 Cookie
    try {
      const cookies = document.cookie;
      const userNameMatch = cookies.match(/UserName=([^;]+)/);
      if (userNameMatch) {
        const userName = decodeURIComponent(userNameMatch[1]);
        log('csdn', '从 Cookie 检测到用户名: ' + userName);
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: userName,
          nickname: userName,
        };
      }
    } catch {}
    
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
    if (url.includes('/cgi-bin/loginpage') || url.includes('action=scanlogin') || 
        url.includes('/cgi-bin/bizlogin') || url === 'https://mp.weixin.qq.com/' ||
        url === 'https://mp.weixin.qq.com') {
      if (!url.includes('token=')) {
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
    // 检查 URL 中的 token 参数
    const tokenMatch = url.match(/token=(\d+)/);
    if (tokenMatch && tokenMatch[1]) {
      log('wechat', '从 URL token 参数判断已登录');
      
      let nickname = '微信公众号';
      // 尝试从页面标题获取昵称
      const title = document.title;
      if (title && !title.includes('登录')) {
        const match = title.match(/^(.+?)\s*[-–—]\s*微信公众平台/);
        if (match && match[1].trim().length > 0) {
          nickname = match[1].trim();
        }
      }
      
      // 尝试从 DOM 获取头像
      const avatarEl = document.querySelector('.weui-desktop-account__avatar img, [class*="avatar"] img') as HTMLImageElement;
      
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: nickname,
        avatar: avatarEl?.src,
      };
    }
    
    // 检查 Cookie
    try {
      const cookies = document.cookie;
      if (cookies.includes('slave_sid=') || cookies.includes('data_ticket=') || cookies.includes('bizuin=')) {
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: '微信公众号',
        };
      }
    } catch {}
    
    // 检查登录表单
    const loginFormSelectors = ['.login__type__container', '.login_frame', '.weui-desktop-login'];
    for (const selector of loginFormSelectors) {
      if (document.querySelector(selector)) {
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
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
        if (data.id) {
          // 简书的 userId 应该使用 slug 字段（用于主页 URL），而不是数字 id
          // slug 格式如 bb8f42a96b80
          const userId = data.slug || String(data.id);
          log('jianshu', '从 API 获取到用户信息', { userId, nickname: data.nickname });
          return {
            loggedIn: true,
            platform: 'jianshu',
            userId: userId,
            nickname: data.nickname,
            avatar: data.avatar,
            meta: {
              followersCount: data.followers_count,
              articlesCount: data.public_notes_count,
              viewsCount: data.total_wordage,
            },
          };
        }
      }
    } catch (e) {
      log('jianshu', 'API 调用失败', e);
    }
    
    // 尝试从页面 URL 提取用户 slug（如果在用户主页）
    const url = window.location.href;
    const slugMatch = url.match(/jianshu\.com\/u\/([a-zA-Z0-9]+)/);
    if (slugMatch) {
      log('jianshu', '从 URL 提取到用户 slug', { slug: slugMatch[1] });
    }
    
    // DOM 检测
    const avatarEl = document.querySelector('.user .avatar img, .avatar-wrapper img') as HTMLImageElement;
    const usernameEl = document.querySelector('.user .name, .nickname');
    
    if (avatarEl?.src || usernameEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'jianshu',
        // 如果从 URL 提取到了 slug，使用它
        userId: slugMatch ? slugMatch[1] : undefined,
        nickname: usernameEl?.textContent?.trim(),
        avatar: avatarEl?.src,
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
              avatar: data.avatar,
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
            avatar: data.avatar,
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
    
    // 尝试 API
    try {
      const res = await fetch('https://home.51cto.com/api/user/info', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if ((data.code === 0 || data.status === 'success') && data.data) {
          const user = data.data;
          // userId 应该是纯数字，用于构建主页 URL
          const userId = String(user.id || user.uid || '');
          log('51cto', '从 API 获取到用户信息', { userId, nickname: user.name || user.nickname });
          return {
            loggedIn: true,
            platform: '51cto',
            userId: userId,
            nickname: user.name || user.nickname || '51CTO用户',
            avatar: user.avatar || user.avatarUrl,
          };
        }
      }
    } catch (e) {
      log('51cto', 'API 调用失败', e);
    }
    
    // 尝试从页面 URL 提取用户 ID（如果在用户主页）
    const url = window.location.href;
    const userIdMatch = url.match(/blog\.51cto\.com\/u_(\d+)/);
    if (userIdMatch) {
      log('51cto', '从 URL 提取到用户 ID', { userId: userIdMatch[1] });
      return {
        loggedIn: true,
        platform: '51cto',
        userId: userIdMatch[1],
        nickname: '51CTO用户',
      };
    }
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="logout"], a[href*="signout"]');
    if (logoutEl) {
      return {
        loggedIn: true,
        platform: '51cto',
        nickname: '51CTO用户',
      };
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
            
            // 确保有有效的用户信息
            if (userId && nickname && nickname !== '腾讯云用户') {
              log('tencent-cloud', '从 API 获取到用户信息', { userId, nickname });
              return {
                loggedIn: true,
                platform: 'tencent-cloud',
                userId: userId,
                nickname: nickname,
                avatar: user.avatar || user.avatarUrl,
              };
            }
          }
        }
      } catch (e) {
        log('tencent-cloud', `API ${endpoint} 调用失败`, e);
      }
    }
    
    // 检查页面上的用户信息元素
    try {
      // 腾讯云开发者社区页面可能有用户头像或昵称元素
      const userAvatarEl = document.querySelector('.com-header-user-avatar img, .user-avatar img, [class*="avatar"] img') as HTMLImageElement;
      const userNameEl = document.querySelector('.com-header-user-name, .user-name, [class*="username"]');
      
      if (userAvatarEl?.src || userNameEl?.textContent?.trim()) {
        log('tencent-cloud', '从 DOM 检测到登录状态');
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          nickname: userNameEl?.textContent?.trim() || '腾讯云用户',
          avatar: userAvatarEl?.src,
        };
      }
    } catch {}
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="logout"], [class*="logout"]');
    if (logoutEl) {
      return {
        loggedIn: true,
        platform: 'tencent-cloud',
        nickname: '腾讯云用户',
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
// 思否检测器 - API 优先
// ============================================================
const segmentfaultDetector: PlatformAuthDetector = {
  id: 'segmentfault',
  urlPatterns: [/segmentfault\.com/],
  async checkLogin(): Promise<LoginState> {
    log('segmentfault', '检测登录状态...');
    
    // 尝试 API
    try {
      const res = await fetch('https://segmentfault.com/api/user/current', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 0 && data.data) {
          const user = data.data;
          log('segmentfault', '从 API 获取到用户信息', { nickname: user.name });
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
      }
    } catch (e) {
      log('segmentfault', 'API 调用失败', e);
    }
    
    // 检查全局变量
    const win = window as any;
    if (win.SF?.user?.id) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: win.SF.user.id,
        nickname: win.SF.user.name || '思否用户',
        avatar: win.SF.user.avatar,
      };
    }
    
    // 检查退出按钮
    const logoutEl = document.querySelector('a[href*="logout"], a[href*="/user/logout"]');
    if (logoutEl) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        nickname: '思否用户',
      };
    }
    
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
// 开源中国检测器 - API 优先
// ============================================================
const oschinaDetector: PlatformAuthDetector = {
  id: 'oschina',
  urlPatterns: [/oschina\.net/],
  async checkLogin(): Promise<LoginState> {
    log('oschina', '检测登录状态...');
    
    // 尝试 API
    try {
      const res = await fetch('https://www.oschina.net/action/user/info', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.code === 0 || data.result?.id || data.id) {
          const user = data.result || data;
          log('oschina', '从 API 获取到用户信息', { nickname: user.name });
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
      }
    } catch (e) {
      log('oschina', 'API 调用失败', e);
    }
    
    // 检查全局变量
    const win = window as any;
    if (win.G_USER?.id) {
      return {
        loggedIn: true,
        platform: 'oschina',
        userId: String(win.G_USER.id),
        nickname: win.G_USER.name || '开源中国用户',
        avatar: win.G_USER.portrait,
      };
    }
    
    // 检查 Cookie
    try {
      const cookies = document.cookie;
      if (cookies.includes('oscid=') || cookies.includes('user=')) {
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
        };
      }
    } catch {}
    
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
