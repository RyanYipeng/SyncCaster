/**
 * MV3 Manifest 配置
 */
export function getManifest(mode: 'development' | 'production'): chrome.runtime.ManifestV3 {
  const isDev = mode === 'development';

  return {
    manifest_version: 3,
    name: isDev ? '[DEV] SyncCaster' : 'SyncCaster',
    version: '2.0.0',
    description: '多平台内容同步助手 - 一次编辑，处处发布',
    
    // 图标
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-48.png',
      128: 'assets/icon-128.png',
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
    ],

    // 权限
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'alarms',
      'notifications',
      'sidePanel',
      'downloads',
      'activeTab',
    ],

    // 主机权限
    host_permissions: [
      'https://mp.weixin.qq.com/*',
      'https://zhuanlan.zhihu.com/*',
      'https://juejin.cn/*',
      'https://editor.csdn.net/*',
      'https://blog.csdn.net/*',
      'https://www.jianshu.com/*',
      'https://medium.com/*',
      'https://mp.toutiao.com/*',
    ],

    // Web 可访问资源
    web_accessible_resources: [
      {
        resources: ['assets/*'],
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
  
  // 弹出窗口
  action: {
    default_popup: 'src/ui/popup/index.html',
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
    'alarms',
    'notifications',
    'sidePanel',
    'downloads',
    'activeTab',
  ],

  // 主机权限
  host_permissions: [
    'https://mp.weixin.qq.com/*',
    'https://zhuanlan.zhihu.com/*',
    'https://www.zhihu.com/*',
    'https://juejin.cn/*',
    'https://editor.csdn.net/*',
    'https://blog.csdn.net/*',
    'https://www.jianshu.com/*',
    'https://medium.com/*',
    'https://mp.toutiao.com/*',
  ],

  // Web 可访问资源
  web_accessible_resources: [
    {
      resources: ['assets/*'],
      matches: ['<all_urls>'],
    },
  ],

  // 内容安全策略
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

export default manifest;
