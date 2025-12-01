/**
 * 登录检测器 - 在目标网站页面上下文中运行
 * 
 * 核心思路：
 * 1. 在目标网站的页面中执行登录检测（content script）
 * 2. 通过 DOM、站内 JS 变量、站内 API 判断登录状态
 * 3. 将结果通过消息机制告诉 background
 */

export interface LoginState {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatar?: string;
  platform?: string;
  error?: string;
}

/**
 * 平台登录检测器接口
 */
interface PlatformAuthDetector {
  /** 平台 ID */
  id: string;
  /** 匹配的 URL 模式 */
  urlPatterns: RegExp[];
  /** 在页面中检测登录状态 */
  checkLogin(): Promise<LoginState>;
}

/**
 * 日志函数
 */
function log(scope: string, msg: string, data?: any) {
  console.log(`[auth-detector:${scope}] ${msg}`, data ?? '');
}

// ============================================================
// 各平台登录检测器实现
// ============================================================


/**
 * 掘金登录检测器
 */
const juejinDetector: PlatformAuthDetector = {
  id: 'juejin',
  urlPatterns: [/juejin\.cn/],
  async checkLogin(): Promise<LoginState> {
    log('juejin', '检测登录状态...');
    
    // 方法1: 检查 DOM 中的用户信息
    const avatarEl = document.querySelector('.avatar-wrapper img, .user-dropdown-list .avatar') as HTMLImageElement;
    const usernameEl = document.querySelector('.username, .user-dropdown-list .name');
    
    if (avatarEl && usernameEl?.textContent?.trim()) {
      log('juejin', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'juejin',
        nickname: usernameEl.textContent.trim(),
        avatar: avatarEl.src,
      };
    }
    
    // 方法2: 检查全局变量
    const win = window as any;
    if (win.__NUXT__?.state?.user?.id) {
      const user = win.__NUXT__.state.user;
      log('juejin', '从 __NUXT__ 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'juejin',
        userId: user.id,
        nickname: user.username || user.user_name,
        avatar: user.avatar_large || user.avatar,
      };
    }
    
    // 方法3: 调用站内 API（在页面上下文中，Cookie 会自动带上）
    try {
      const res = await fetch('https://api.juejin.cn/user_api/v1/user/get', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.err_no === 0 && data.data) {
          log('juejin', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'juejin',
            userId: data.data.user_id,
            nickname: data.data.user_name,
            avatar: data.data.avatar_large,
          };
        }
      }
    } catch (e) {
      log('juejin', 'API 调用失败', e);
    }
    
    // 方法4: 检查登录按钮是否存在
    const loginBtn = document.querySelector('.login-button, [class*="login"]');
    if (loginBtn) {
      log('juejin', '检测到登录按钮，未登录');
      return { loggedIn: false, platform: 'juejin' };
    }
    
    return { loggedIn: false, platform: 'juejin' };
  },
};

/**
 * CSDN 登录检测器
 */
const csdnDetector: PlatformAuthDetector = {
  id: 'csdn',
  urlPatterns: [/csdn\.net/],
  async checkLogin(): Promise<LoginState> {
    log('csdn', '检测登录状态...');
    log('csdn', '当前 URL: ' + window.location.href);
    
    // 打印页面中所有可能的用户相关元素，帮助调试
    const debugInfo: string[] = [];
    
    // 检查常见的用户头像/用户名容器
    const possibleContainers = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="profile"], [id*="user"], [id*="avatar"]');
    debugInfo.push(`找到 ${possibleContainers.length} 个可能的用户相关元素`);
    
    // 检查是否有图片元素
    const allImages = document.querySelectorAll('img');
    const avatarImages = Array.from(allImages).filter(img => 
      img.src && (img.src.includes('avatar') || img.src.includes('profile') || img.className.includes('avatar'))
    );
    debugInfo.push(`找到 ${avatarImages.length} 个可能的头像图片`);
    if (avatarImages.length > 0) {
      debugInfo.push(`头像图片: ${avatarImages.map(img => img.src.substring(0, 50)).join(', ')}`);
    }
    
    log('csdn', '调试信息: ' + debugInfo.join(' | '));
    
    // 方法1: 检查多种 DOM 选择器
    const avatarSelectors = [
      '.toolbar-container-left img',
      '.user-avatar img',
      '.avatar-pic img',
      '.hasmark img',
      '#csdn-toolbar img.avatar',
      '.csdn-profile-avatar img',
      '.user-info img',
      'img.avatar',
    ];
    
    const usernameSelectors = [
      '.toolbar-container-middle .name',
      '.user-name',
      '.username',
      '.nick-name',
      '.hasmark .name',
      '#csdn-toolbar .name',
      '.csdn-profile-name',
      '.user-info .name',
    ];
    
    let avatarEl: HTMLImageElement | null = null;
    let usernameEl: Element | null = null;
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar')) {
        avatarEl = el;
        log('csdn', '找到头像元素:', selector);
        break;
      }
    }
    
    for (const selector of usernameSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && el.textContent.trim() !== '登录') {
        usernameEl = el;
        log('csdn', '找到用户名元素: ' + selector + ' -> ' + el.textContent.trim());
        break;
      }
    }
    
    if (usernameEl?.textContent?.trim()) {
      log('csdn', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'csdn',
        nickname: usernameEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 方法2: 检查全局变量（CSDN 可能在多个地方存储用户信息）
    const win = window as any;
    const possibleUserObjects = [
      win.csdn?.currentUser,
      win.currentUser,
      win.userInfo,
      win.__INITIAL_STATE__?.user,
      win.loginUserInfo,
    ];
    
    for (const user of possibleUserObjects) {
      if (user && (user.userName || user.username || user.nickName || user.nickname)) {
        log('csdn', '从全局变量检测到登录状态', user);
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: user.userName || user.username || user.userId,
          nickname: user.nickName || user.nickname || user.userName || user.username,
          avatar: user.avatar || user.avatarUrl,
        };
      }
    }
    
    // 方法3: 检查页面中的脚本内容（CSDN 经常在 script 标签中嵌入用户信息）
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      // 查找类似 "userName":"xxx" 或 userName = "xxx" 的模式
      const userNameMatch = content.match(/"userName"\s*:\s*"([^"]+)"/) || 
                           content.match(/userName\s*=\s*["']([^"']+)["']/);
      const nickNameMatch = content.match(/"nickName"\s*:\s*"([^"]+)"/) ||
                           content.match(/nickName\s*=\s*["']([^"']+)["']/);
      
      if (userNameMatch || nickNameMatch) {
        log('csdn', '从 script 标签检测到登录状态');
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: userNameMatch?.[1],
          nickname: nickNameMatch?.[1] || userNameMatch?.[1],
        };
      }
    }
    
    // 方法4: 检查登录按钮是否存在
    const loginBtnSelectors = [
      '.toolbar-btn-login',
      '.login-mark',
      'a[href*="passport.csdn.net/login"]',
      '.login-btn',
      'a.login',
    ];
    
    for (const selector of loginBtnSelectors) {
      const btn = document.querySelector(selector);
      if (btn) {
        const text = btn.textContent?.trim() || '';
        if (text.includes('登录') || text.includes('Login')) {
          log('csdn', '检测到登录按钮，未登录:', selector);
          return { loggedIn: false, platform: 'csdn' };
        }
      }
    }
    
    // 方法5: 检查是否在登录页面
    if (window.location.href.includes('passport.csdn.net')) {
      // 在登录页面，检查是否已经登录成功（可能会跳转）
      const successEl = document.querySelector('.success, .login-success');
      if (successEl) {
        log('csdn', '登录页面显示成功');
        return { loggedIn: true, platform: 'csdn', nickname: 'CSDN用户' };
      }
      log('csdn', '在登录页面，未登录');
      return { loggedIn: false, platform: 'csdn' };
    }
    
    // 方法6: 检查是否有退出按钮（有退出按钮说明已登录）
    const logoutSelectors = [
      'a[href*="logout"]',
      '.logout',
      '.sign-out',
    ];
    
    for (const selector of logoutSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          log('csdn', '检测到退出按钮，已登录');
          return { loggedIn: true, platform: 'csdn', nickname: 'CSDN用户' };
        }
      } catch {}
    }
    
    // 方法7: 调用 CSDN API 检测登录状态
    try {
      log('csdn', '尝试调用 CSDN API...');
      const res = await fetch('https://me.csdn.net/api/user/show', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('csdn', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.code === 200 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username || user.userName,
            nickname: user.nickname || user.nickName || user.username,
            avatar: user.avatar || user.avatarUrl,
          };
        }
      } else {
        log('csdn', 'API 响应状态: ' + res.status);
      }
    } catch (e: any) {
      log('csdn', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查 localStorage 中的用户信息
    try {
      const userInfo = localStorage.getItem('UserInfo') || localStorage.getItem('userInfo');
      if (userInfo) {
        const user = JSON.parse(userInfo);
        if (user && (user.userName || user.username || user.nickName)) {
          log('csdn', '从 localStorage 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.userName || user.username,
            nickname: user.nickName || user.nickname || user.userName,
            avatar: user.avatar,
          };
        }
      }
    } catch (e) {
      log('csdn', 'localStorage 检查失败');
    }
    
    // 方法9: 检查 Cookie 中是否有用户名
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
    } catch (e) {
      log('csdn', 'Cookie 检查失败');
    }
    
    log('csdn', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'csdn' };
  },
};

/**
 * 知乎登录检测器
 */
const zhihuDetector: PlatformAuthDetector = {
  id: 'zhihu',
  urlPatterns: [/zhihu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('zhihu', '检测登录状态...');
    
    // 方法1: 检查 DOM
    const avatarEl = document.querySelector('.AppHeader-profile img, .Avatar') as HTMLImageElement;
    const usernameEl = document.querySelector('.AppHeader-profile .Popover, .ProfileHeader-name');
    
    if (avatarEl?.src && !avatarEl.src.includes('default')) {
      log('zhihu', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'zhihu',
        avatar: avatarEl.src,
        nickname: usernameEl?.textContent?.trim(),
      };
    }
    
    // 方法2: 检查全局变量
    const win = window as any;
    if (win.__INITIAL_STATE__?.entities?.users) {
      const users = win.__INITIAL_STATE__.entities.users;
      const currentUserId = win.__INITIAL_STATE__.currentUser;
      if (currentUserId && users[currentUserId]) {
        const user = users[currentUserId];
        log('zhihu', '从 __INITIAL_STATE__ 检测到登录状态');
        return {
          loggedIn: true,
          platform: 'zhihu',
          userId: user.id || user.urlToken,
          nickname: user.name,
          avatar: user.avatarUrl,
        };
      }
    }
    
    // 方法3: 调用 API
    try {
      const res = await fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.id) {
          log('zhihu', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'zhihu',
            userId: data.id,
            nickname: data.name,
            avatar: data.avatar_url,
          };
        }
      }
    } catch (e) {
      log('zhihu', 'API 调用失败', e);
    }
    
    // 方法4: 检查登录按钮
    const loginBtn = document.querySelector('.AppHeader-login, button[aria-label="登录"]');
    if (loginBtn) {
      return { loggedIn: false, platform: 'zhihu' };
    }
    
    return { loggedIn: false, platform: 'zhihu' };
  },
};


/**
 * 微信公众号登录检测器
 */
const wechatDetector: PlatformAuthDetector = {
  id: 'wechat',
  urlPatterns: [/mp\.weixin\.qq\.com/],
  async checkLogin(): Promise<LoginState> {
    log('wechat', '检测登录状态...');
    const url = window.location.href;
    log('wechat', '当前 URL: ' + url);
    log('wechat', '页面标题: ' + document.title);
    
    // 检查是否在登录页面（优先判断）
    if (url.includes('/cgi-bin/loginpage') || url.includes('action=scanlogin') || 
        url.includes('/cgi-bin/bizlogin') || url === 'https://mp.weixin.qq.com/' ||
        url === 'https://mp.weixin.qq.com') {
      // 但如果 URL 中有 token 参数，说明已登录
      if (!url.includes('token=')) {
        log('wechat', '当前在登录页面（无 token）');
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
    // 方法1（最可靠）: 检查 URL 中是否有 token 参数
    // 微信公众号后台的所有页面都会带 token 参数
    const tokenMatch = url.match(/token=(\d+)/);
    if (tokenMatch && tokenMatch[1]) {
      log('wechat', '从 URL token 参数判断已登录: token=' + tokenMatch[1]);
      // 尝试获取昵称
      let nickname = '微信公众号';
      
      // 尝试从 DOM 获取昵称
      const nicknameSelectors = [
        '.weui-desktop-account__nickname',
        '.account_nickname', 
        '.nickname',
        '.user-name',
        '.mp-account-name',
        '.account-name',
        '[class*="account"] [class*="name"]',
      ];
      
      for (const selector of nicknameSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el?.textContent?.trim() && !el.textContent.includes('登录')) {
            nickname = el.textContent.trim();
            log('wechat', '从 DOM 获取到昵称: ' + nickname);
            break;
          }
        } catch {}
      }
      
      // 尝试从页面标题获取昵称
      if (nickname === '微信公众号') {
        const title = document.title;
        if (title && !title.includes('登录')) {
          const match = title.match(/^(.+?)\s*[-–—]\s*微信公众平台/);
          if (match && match[1].trim().length > 0) {
            nickname = match[1].trim();
            log('wechat', '从页面标题获取到昵称: ' + nickname);
          }
        }
      }
      
      const avatarEl = document.querySelector('.weui-desktop-account__avatar img, .account_avatar img, [class*="avatar"] img') as HTMLImageElement;
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: nickname,
        avatar: avatarEl?.src,
      };
    }
    
    // 方法2: 检查 URL 路径判断是否在后台（即使没有 token 参数）
    if (url.includes('/cgi-bin/home') || url.includes('/cgi-bin/frame') || 
        url.includes('/cgi-bin/message') || url.includes('/cgi-bin/appmsg') ||
        url.includes('/cgi-bin/operate_appmsg') || url.includes('/cgi-bin/settingpage')) {
      log('wechat', '从 URL 路径判断已登录');
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: '微信公众号',
      };
    }
    
    // 方法3: 检查 Cookie 中是否有登录标记
    try {
      const cookies = document.cookie;
      log('wechat', 'Cookie 内容: ' + cookies.substring(0, 200));
      // 微信公众号登录后会有 slave_sid 或 data_ticket
      if (cookies.includes('slave_sid=') || cookies.includes('data_ticket=') || cookies.includes('bizuin=')) {
        log('wechat', '从 Cookie 检测到登录状态');
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: '微信公众号',
        };
      }
    } catch (e) {
      log('wechat', 'Cookie 检查失败: ' + e);
    }
    
    // 方法4: 检查是否有后台管理菜单（登录后才有）
    const menuSelectors = [
      '.weui-desktop-sidebar',
      '.menu_list',
      '.main_bd',
      '.new-home__container',
      '.home-container',
      '#app .weui-desktop-layout',
      '.weui-desktop-layout__body',
      '.weui-desktop-panel',
      '.new-creation__menu',
    ];
    
    for (const selector of menuSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('wechat', '检测到后台菜单，已登录: ' + selector);
        const nameEl = document.querySelector('[class*="name"], [class*="nickname"]');
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: nameEl?.textContent?.trim() || '微信公众号',
        };
      }
    }
    
    // 方法5: 检查全局变量
    const win = window as any;
    log('wechat', '检查全局变量...');
    const possibleUserVars = [
      { name: 'wx.data.user_name', value: win.wx?.data?.user_name },
      { name: 'cgiData.nick_name', value: win.cgiData?.nick_name },
      { name: 'cgiData.nickname', value: win.cgiData?.nickname },
      { name: '__INITIAL_DATA__.nickName', value: win.__INITIAL_DATA__?.nickName },
      { name: 'pageData.nickName', value: win.pageData?.nickName },
    ];
    
    for (const { name, value } of possibleUserVars) {
      if (value && typeof value === 'string' && value.length > 0) {
        log('wechat', '从全局变量检测到登录状态: ' + name + ' = ' + value);
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: value,
        };
      }
    }
    
    // 方法6: 检查登录表单是否存在（如果存在则未登录）
    const loginFormSelectors = [
      '.login__type__container',
      '.login_frame',
      '.weui-desktop-login',
      '.login-box',
      '#login_container',
      '.qrcode-login',
      '.login__type__container__scan',
    ];
    
    for (const selector of loginFormSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('wechat', '检测到登录表单，未登录: ' + selector);
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="account"], [class*="nickname"], [class*="user"], [class*="avatar"]');
    log('wechat', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    if (allElements.length > 0) {
      const classNames = Array.from(allElements).slice(0, 5).map(el => el.className);
      log('wechat', '元素类名: ' + classNames.join(', '));
    }
    
    log('wechat', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'wechat' };
  },
};

/**
 * 简书登录检测器
 */
const jianshuDetector: PlatformAuthDetector = {
  id: 'jianshu',
  urlPatterns: [/jianshu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('jianshu', '检测登录状态...');
    
    // 检查 DOM
    const avatarEl = document.querySelector('.user .avatar img, .avatar-wrapper img') as HTMLImageElement;
    const usernameEl = document.querySelector('.user .name, .nickname');
    
    if (avatarEl?.src || usernameEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'jianshu',
        nickname: usernameEl?.textContent?.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 检查登录按钮
    const loginBtn = document.querySelector('.sign-in, .login-btn');
    if (loginBtn) {
      return { loggedIn: false, platform: 'jianshu' };
    }
    
    return { loggedIn: false, platform: 'jianshu' };
  },
};

/**
 * 博客园登录检测器
 */
const cnblogsDetector: PlatformAuthDetector = {
  id: 'cnblogs',
  urlPatterns: [/cnblogs\.com/],
  async checkLogin(): Promise<LoginState> {
    log('cnblogs', '检测登录状态...');
    
    // 检查 DOM - 博客园登录后会显示用户名
    const userEl = document.querySelector('#blog_nav_admin, .user-info .name, #navList a[href*="/u/"]');
    
    if (userEl?.textContent?.trim()) {
      const avatarEl = document.querySelector('.user-avatar img') as HTMLImageElement;
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 检查登录链接
    const loginLink = document.querySelector('a[href*="signin"], a[href*="login"]');
    if (loginLink && loginLink.textContent?.includes('登录')) {
      return { loggedIn: false, platform: 'cnblogs' };
    }
    
    return { loggedIn: false, platform: 'cnblogs' };
  },
};

/**
 * 51CTO 登录检测器
 */
const cto51Detector: PlatformAuthDetector = {
  id: '51cto',
  urlPatterns: [/51cto\.com/],
  async checkLogin(): Promise<LoginState> {
    log('51cto', '检测登录状态...');
    
    // 检查 DOM
    const userEl = document.querySelector('.user-name, .nickname, .user-info .name');
    const avatarEl = document.querySelector('.user-avatar img, .avatar img') as HTMLImageElement;
    
    if (userEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: '51cto',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 检查登录按钮
    const loginBtn = document.querySelector('.login-btn, a[href*="login"]');
    if (loginBtn && loginBtn.textContent?.includes('登录')) {
      return { loggedIn: false, platform: '51cto' };
    }
    
    return { loggedIn: false, platform: '51cto' };
  },
};


/**
 * 腾讯云开发者社区登录检测器
 */
const tencentCloudDetector: PlatformAuthDetector = {
  id: 'tencent-cloud',
  urlPatterns: [/cloud\.tencent\.com/],
  async checkLogin(): Promise<LoginState> {
    log('tencent-cloud', '检测登录状态...');
    
    const userEl = document.querySelector('.user-name, .com-header-user-name');
    const avatarEl = document.querySelector('.user-avatar img, .com-header-user-avatar img') as HTMLImageElement;
    
    if (userEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'tencent-cloud',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    const loginBtn = document.querySelector('.login-btn, a[href*="login"]');
    if (loginBtn) {
      return { loggedIn: false, platform: 'tencent-cloud' };
    }
    
    return { loggedIn: false, platform: 'tencent-cloud' };
  },
};

/**
 * 阿里云开发者社区登录检测器
 */
const aliyunDetector: PlatformAuthDetector = {
  id: 'aliyun',
  urlPatterns: [/developer\.aliyun\.com/, /aliyun\.com/],
  async checkLogin(): Promise<LoginState> {
    log('aliyun', '检测登录状态...');
    
    const userEl = document.querySelector('.aliyun-user-name, .user-name, .aliyun-console-user-name');
    const avatarEl = document.querySelector('.aliyun-user-avatar img, .user-avatar img') as HTMLImageElement;
    
    if (userEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'aliyun',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    const loginBtn = document.querySelector('.aliyun-login-btn, a[href*="login"]');
    if (loginBtn && loginBtn.textContent?.includes('登录')) {
      return { loggedIn: false, platform: 'aliyun' };
    }
    
    return { loggedIn: false, platform: 'aliyun' };
  },
};

/**
 * 思否登录检测器
 */
const segmentfaultDetector: PlatformAuthDetector = {
  id: 'segmentfault',
  urlPatterns: [/segmentfault\.com/],
  async checkLogin(): Promise<LoginState> {
    log('segmentfault', '检测登录状态...');
    
    const userEl = document.querySelector('.user-name, .nav-user-name, .dropdown-toggle .name');
    const avatarEl = document.querySelector('.user-avatar img, .nav-user-avatar img') as HTMLImageElement;
    
    if (userEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 检查全局变量
    const win = window as any;
    if (win.SF?.user?.id) {
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: win.SF.user.id,
        nickname: win.SF.user.name,
        avatar: win.SF.user.avatar,
      };
    }
    
    const loginBtn = document.querySelector('.login-btn, a[href*="login"]');
    if (loginBtn && loginBtn.textContent?.includes('登录')) {
      return { loggedIn: false, platform: 'segmentfault' };
    }
    
    return { loggedIn: false, platform: 'segmentfault' };
  },
};

/**
 * B站专栏登录检测器
 */
const bilibiliDetector: PlatformAuthDetector = {
  id: 'bilibili',
  urlPatterns: [/bilibili\.com/],
  async checkLogin(): Promise<LoginState> {
    log('bilibili', '检测登录状态...');
    
    // 方法1: 检查 DOM
    const avatarEl = document.querySelector('.header-avatar-wrap img, .bili-avatar img') as HTMLImageElement;
    const usernameEl = document.querySelector('.header-entry-mini .nickname, .user-name');
    
    if (avatarEl?.src && !avatarEl.src.includes('noface')) {
      return {
        loggedIn: true,
        platform: 'bilibili',
        nickname: usernameEl?.textContent?.trim(),
        avatar: avatarEl.src,
      };
    }
    
    // 方法2: 调用 API
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.code === 0 && data.data?.isLogin) {
          log('bilibili', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'bilibili',
            userId: String(data.data.mid),
            nickname: data.data.uname,
            avatar: data.data.face,
          };
        }
      }
    } catch (e) {
      log('bilibili', 'API 调用失败', e);
    }
    
    return { loggedIn: false, platform: 'bilibili' };
  },
};

/**
 * 开源中国登录检测器
 */
const oschinaDetector: PlatformAuthDetector = {
  id: 'oschina',
  urlPatterns: [/oschina\.net/],
  async checkLogin(): Promise<LoginState> {
    log('oschina', '检测登录状态...');
    
    // 方法1: 检查 DOM
    const userEl = document.querySelector('.user-name, .current-user-name, .user-info .name');
    const avatarEl = document.querySelector('.user-avatar img, .current-user-avatar img') as HTMLImageElement;
    
    if (userEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'oschina',
        nickname: userEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 方法2: 检查全局变量
    const win = window as any;
    if (win.G_USER?.id || win.currentUser?.id) {
      const user = win.G_USER || win.currentUser;
      return {
        loggedIn: true,
        platform: 'oschina',
        userId: String(user.id),
        nickname: user.name || user.nickname,
        avatar: user.portrait || user.avatar,
      };
    }
    
    // 方法3: 检查登录按钮
    const loginBtn = document.querySelector('.login-btn, a[href*="login"]');
    if (loginBtn && loginBtn.textContent?.includes('登录')) {
      return { loggedIn: false, platform: 'oschina' };
    }
    
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
 * 用于引导登录场景：持续检测直到登录成功
 */
export function startLoginPolling(
  onLoginSuccess: (state: LoginState) => void,
  interval = 1000,
  maxAttempts = 180 // 3分钟
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
  
  // 立即开始第一次检测
  poll();
  
  // 返回停止函数
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
  
  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_LOGIN') {
      log('message', '收到登录检测请求');
      detectLoginState().then(sendResponse);
      return true; // 异步响应
    }
    
    if (message.type === 'START_LOGIN_POLLING') {
      log('message', '收到启动轮询请求');
      startLoginPolling((state) => {
        // 登录成功，通知 background
        chrome.runtime.sendMessage({
          type: 'LOGIN_SUCCESS',
          data: state,
        });
      });
      sendResponse({ started: true });
      return false;
    }
  });
  
  // 页面加载完成后，自动检测一次并报告
  if (document.readyState === 'complete') {
    reportLoginState();
  } else {
    window.addEventListener('load', reportLoginState);
  }
}

/**
 * 主动报告当前登录状态给 background
 */
async function reportLoginState() {
  const state = await detectLoginState();
  if (state.platform) {
    log('report', '报告登录状态', state);
    chrome.runtime.sendMessage({
      type: 'LOGIN_STATE_REPORT',
      data: state,
    });
  }
}
