/**
 * MV3 Manifest 配置
 */
export function getManifest(mode: 'development' | 'production'): chrome.runtime.ManifestV3 {
  const isDev = mode === 'development';

  return {
    manifest_version: 3,
    name: isDev ? '[DEV] SyncCaster' : 'SyncCaster',
    version: '2.0.0',
    description: '多平台文章同步助手 - 一次编辑，处处发布',
    
    // 图标
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-32.png',
      128: 'assets/icon-192.png',
    },

    // 弹出窗口
    action: {
      default_popup: 'src/ui/popup/index.html',
      default_icon: {
        16: 'assets/icon-16.png',
        32: 'assets/icon-32.png',
      },
      default_title: 'SyncCaster',
    },

    // 设置页面
    options_ui: {
      page: 'src/ui/options/index.html',
      open_in_tab: true,
    },

    // 侧边栏
    side_panel: {
      default_path: 'src/ui/sidepanel/index.html',
    },

    // 后台服务
    background: {
      service_worker: 'src/background/index.ts',
      type: 'module',
    },

    // 内容脚本
    content_scripts: [
      {
        matches: [
          'https://*/*',
          'http://*/*'
        ],
        js: ['src/content-scripts/index.ts'],
        run_at: 'document_idle',
      },
      {
        matches: ['https://juejin.cn/editor/drafts/*'],
        js: ['src/content-scripts/juejin-image-paste.ts'],
        run_at: 'document_idle',
      },
    ],

    // 权限
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'tabGroups',  // ✨ 新增：标签页组管理，用于将发布页面归入同一组
      'alarms',
      'notifications',
      'sidePanel',
      'downloads',
      'activeTab',
      'cookies',  // ✨ 必需：读取 Cookie 以检测登录状态
      'clipboardRead',
      'clipboardWrite',
    ],

    // 主机权限（全部平台）
    host_permissions: [
      // favicon（用于账号管理页的平台图标显示）
      'https://www.google.com/s2/favicons*',

      // 微信公众号
      'https://mp.weixin.qq.com/*',
      'https://*.weixin.qq.com/*',
      
      // 知乎
      'https://*.zhihu.com/*',
      'https://www.zhihu.com/*',
      'https://zhuanlan.zhihu.com/*',
      
      // 掘金
      'https://*.juejin.cn/*',
      'https://juejin.cn/*',
      'https://api.juejin.cn/*',
      
      // CSDN
      'https://*.csdn.net/*',
      'https://blog.csdn.net/*',
      'https://editor.csdn.net/*',
      'https://me.csdn.net/*',
      'https://passport.csdn.net/*',
      
      // 简书
      'https://*.jianshu.com/*',
      'https://www.jianshu.com/*',
      
      // 博客园
      'https://*.cnblogs.com/*',
      'https://www.cnblogs.com/*',
      'https://i.cnblogs.com/*',
      'https://account.cnblogs.com/*',
      'https://passport.cnblogs.com/*',
      
      // 51CTO
      'https://*.51cto.com/*',
      'https://blog.51cto.com/*',
      'https://home.51cto.com/*',
      
      // 腾讯云开发者社区
      'https://cloud.tencent.com/*',
      'https://*.cloud.tencent.com/*',
      
      // 阿里云开发者社区
      'https://developer.aliyun.com/*',
      'https://*.aliyun.com/*',
      'https://account.aliyun.com/*',
      
      // 思否
      'https://segmentfault.com/*',
      'https://*.segmentfault.com/*',
      
      // B站专栏
      'https://*.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://member.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://passport.bilibili.com/*',
      
      // 开源中国
      'https://*.oschina.net/*',
      'https://www.oschina.net/*',
      'https://my.oschina.net/*',
      
      // 百家号
      'https://*.baidu.com/*',
      'https://baijiahao.baidu.com/*',
      
      // Medium
      'https://medium.com/*',
      'https://*.medium.com/*',
      
      // 头条号
      'https://mp.toutiao.com/*',
      'https://*.toutiao.com/*',
      'https://sso.toutiao.com/*',
      
      // InfoQ
      'https://www.infoq.cn/*',
      'https://*.infoq.cn/*',
      'https://xie.infoq.cn/*',
      
      // 网易号
      'https://mp.163.com/*',
      'https://*.163.com/*',
    ],

    // Web 可访问资源
    web_accessible_resources: [
      {
        resources: ['assets/*', 'md-editor/*', 'md-editor.html'],
        matches: ['<all_urls>'],
      },
    ],

    // 内容安全策略
    content_security_policy: {
      extension_pages: isDev
        ? "script-src 'self'; object-src 'self'"
        : "script-src 'self'; object-src 'self'",
    },
  } as chrome.runtime.ManifestV3;
}

// 默认导出生产环境的 manifest
const manifest = {
  manifest_version: 3,
  name: 'SyncCaster',
  version: '2.0.0',
  description: '多平台内容同步助手 - 一次编辑，处处发布',

  // 图标
  icons: {
    16: 'assets/icon-16.png',
    32: 'assets/icon-32.png',
    48: 'assets/icon-32.png',
    128: 'assets/icon-192.png',
  },
  
  // 弹出窗口
  action: {
    default_popup: 'src/ui/popup/index.html',
    default_icon: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
    },
    default_title: 'SyncCaster',
  },

  // 设置页面
  options_ui: {
    page: 'src/ui/options/index.html',
    open_in_tab: true,
  },

  // 侧边栏
  side_panel: {
    default_path: 'src/ui/sidepanel/index.html',
  },

  // 后台服务
  background: {
    service_worker: 'background.js',
    type: 'module',
  },

  // 内容脚本
  content_scripts: [
    {
      matches: ['https://*/*', 'http://*/*'],
      js: ['content-scripts.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  // 权限
  permissions: [
    'storage',
    'scripting',
    'tabs',
    'tabGroups',  // ✨ 新增：标签页组管理，用于将发布页面归入同一组
    'alarms',
    'notifications',
    'sidePanel',
    'downloads',
    'activeTab',
    'cookies',  // ✨ 必需：读取 Cookie 以检测登录状态
    'clipboardRead',
    'clipboardWrite',
  ],

  // 主机权限（全部平台）
  host_permissions: [
    // 微信公众号
    'https://mp.weixin.qq.com/*',
    'https://*.weixin.qq.com/*',
    
    // 知乎
    'https://*.zhihu.com/*',
    'https://www.zhihu.com/*',
    'https://zhuanlan.zhihu.com/*',
    
    // 掘金
    'https://*.juejin.cn/*',
    'https://juejin.cn/*',
    'https://api.juejin.cn/*',
    
    // CSDN
    'https://*.csdn.net/*',
    'https://blog.csdn.net/*',
    'https://editor.csdn.net/*',
    'https://me.csdn.net/*',
    'https://passport.csdn.net/*',
    
    // 简书
    'https://*.jianshu.com/*',
    'https://www.jianshu.com/*',
    
    // 博客园
    'https://*.cnblogs.com/*',
    'https://www.cnblogs.com/*',
    'https://i.cnblogs.com/*',
    'https://account.cnblogs.com/*',
    'https://passport.cnblogs.com/*',
    
    // 51CTO
    'https://*.51cto.com/*',
    'https://blog.51cto.com/*',
    'https://home.51cto.com/*',
    
    // 腾讯云开发者社区
    'https://cloud.tencent.com/*',
    'https://*.cloud.tencent.com/*',
    
    // 阿里云开发者社区
    'https://developer.aliyun.com/*',
    'https://*.aliyun.com/*',
    'https://account.aliyun.com/*',
    
    // 思否
    'https://segmentfault.com/*',
    'https://*.segmentfault.com/*',
    
    // B站专栏
    'https://*.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://member.bilibili.com/*',
    'https://api.bilibili.com/*',
    'https://passport.bilibili.com/*',
    
    // 开源中国
    'https://*.oschina.net/*',
    'https://www.oschina.net/*',
    'https://my.oschina.net/*',
    
    // 百家号
    'https://*.baidu.com/*',
    'https://baijiahao.baidu.com/*',
    
    // Medium
    'https://medium.com/*',
    'https://*.medium.com/*',
    
    // 头条号
    'https://mp.toutiao.com/*',
    'https://*.toutiao.com/*',
    'https://sso.toutiao.com/*',
    
    // InfoQ
    'https://www.infoq.cn/*',
    'https://*.infoq.cn/*',
    'https://xie.infoq.cn/*',
    
    // 网易号
    'https://mp.163.com/*',
    'https://*.163.com/*',
  ],

  // Web 可访问资源
  web_accessible_resources: [
    {
      resources: ['assets/*', 'md-editor/*', 'md-editor.html'],
      matches: ['<all_urls>'],
    },
  ],

  // 内容安全策略
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

export default manifest;
