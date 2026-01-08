<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <!-- 内部组件用于获取 message API -->
      <MessageApiInjector />
      <div 
        class="min-h-screen relative transition-colors duration-300 overflow-x-hidden"
        :class="isDark 
          ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-slate-900' 
          : 'bg-gradient-to-br from-blue-50 via-white to-purple-50'"
      >
        <!-- 装饰性背景 -->
        <div 
          class="fixed top-0 right-0 w-96 h-96 rounded-full opacity-10 -translate-y-48 translate-x-48 blur-3xl pointer-events-none transition-colors duration-300"
          :class="isDark ? 'bg-blue-900' : 'bg-blue-100'"
        ></div>
        <div 
          class="fixed bottom-0 left-0 w-96 h-96 rounded-full opacity-10 translate-y-48 -translate-x-48 blur-3xl pointer-events-none transition-colors duration-300"
          :class="isDark ? 'bg-purple-900' : 'bg-purple-100'"
        ></div>
        
        <!-- 头部 -->
        <header 
          class="sticky top-0 z-50 backdrop-blur-md shadow-sm transition-colors duration-300"
          :class="isDark 
            ? 'bg-gray-900/80 border-b border-gray-700/50' 
            : 'bg-white/80 border-b border-gray-200/50'"
        >
          <div class="w-full pl-4 pr-4 py-2">
            <div class="flex items-center justify-between">
              <!-- 左侧 Logo 区域 - 靠左对齐 -->
              <div class="flex items-center gap-3 select-none">
                <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <span class="text-white text-xl">✨</span>
                </div>
                <div>
                  <h1 class="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-tight tracking-wide">SyncCaster</h1>
                  <p class="text-[10px] leading-tight mt-0.5" :class="isDark ? 'text-gray-400' : 'text-gray-500'">v2.0.0 · 内容采集与发布助手</p>
                </div>
              </div>
              
              <!-- 右侧功能区 - 靠右对齐 -->
              <div class="flex items-center gap-2 flex-shrink-0 mr-2">
                <!-- 导入按钮 -->
                <button
                  @click="handleImport"
                  class="h-8 px-2 sm:px-3 rounded-md transition-colors flex items-center gap-1.5 text-sm font-medium select-none border-none outline-none"
                  :class="isDark 
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                  title="导入 Markdown 文件"
                >
                  <span>📥</span>
                  <span class="hidden sm:inline">导入</span>
                </button>
                
                <!-- 导出下拉菜单 -->
                <n-dropdown 
                  :options="exportOptions" 
                  @select="handleExport"
                  trigger="click"
                  placement="bottom-end"
                >
                  <button
                    class="h-8 px-2 sm:px-3 rounded-md transition-colors flex items-center gap-1.5 text-sm font-medium select-none border-none outline-none"
                    :class="isDark 
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                    title="导出内容"
                  >
                    <span>📤</span>
                    <span class="hidden sm:inline">导出</span>
                    <span class="text-[10px]">▼</span>
                  </button>
                </n-dropdown>
                
                <!-- 帮助下拉菜单 -->
                <n-dropdown 
                  :options="helpOptions" 
                  @select="handleHelp"
                  trigger="click"
                  placement="bottom-end"
                >
                  <button
                    class="h-8 px-2 sm:px-3 rounded-md transition-colors flex items-center gap-1.5 text-sm font-medium select-none border-none outline-none"
                    :class="isDark 
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                    title="帮助"
                  >
                    <span>❓</span>
                    <span class="hidden sm:inline">帮助</span>
                    <span class="text-[10px]">▼</span>
                  </button>
                </n-dropdown>
                
                <!-- 主题切换 -->
                <button
                  @click="toggleTheme"
                  class="w-8 h-8 rounded-md transition-colors flex items-center justify-center text-sm select-none border-none outline-none"
                  :class="isDark 
                    ? 'bg-gray-700 hover:bg-gray-600 text-yellow-300' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                  :title="isDark ? '切换到亮色模式' : '切换到暗色模式'"
                >
                  {{ isDark ? '🌙' : '☀️' }}
                </button>
              </div>
            </div>
          </div>
        </header>

        <div class="max-w-full mx-auto flex relative">
          <!-- 侧边栏 - 收窄以释放更多编辑空间 -->
          <aside class="w-44 min-h-[calc(100vh-49px)] sticky top-[49px] flex-shrink-0">
            <nav class="p-2 space-y-0.5">
              <div
                v-for="item in navItems"
                :key="item.path"
                class="group relative px-3 py-2 rounded-md cursor-pointer select-none transition-all duration-300"
                :class="currentPath === item.path 
                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md shadow-blue-500/25' 
                  : isDark 
                    ? 'hover:bg-gray-700/60 text-gray-300 hover:text-white' 
                    : 'hover:bg-white/60 text-gray-700 hover:text-gray-900'"
                @click="navigate(item.path)"
              >
                <div class="flex items-center gap-2">
                  <span class="text-base transition-transform group-hover:scale-110">{{ item.icon }}</span>
                  <span class="text-sm font-medium">{{ item.label }}</span>
                </div>
                <div 
                  v-if="currentPath === item.path"
                  class="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-md blur opacity-25 -z-10"
                ></div>
              </div>
            </nav>
          </aside>

          <!-- 主内容区 -->
          <main class="flex-1 p-3 min-h-[calc(100vh-49px)] overflow-hidden">
            <div 
              class="backdrop-blur-sm rounded-xl shadow-sm p-3 transition-colors duration-300 h-full"
              :class="isDark 
                ? 'bg-gray-800/60 border border-gray-700' 
                : 'bg-white/60 border border-gray-100'"
            >
              <component :is="currentComponent" :isDark="isDark" />
            </div>
          </main>
        </div>
      </div>
      
      <!-- 隐藏的文件输入 -->
      <input 
        ref="fileInputRef"
        type="file" 
        accept=".md,.markdown,text/markdown"
        style="display: none"
        @change="onFileSelected"
      />
      
      <!-- 关于对话框 -->
      <n-modal v-model:show="showAboutDialog" preset="card" title="关于" style="width: 420px;">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
            <span class="text-white text-2xl">✨</span>
          </div>
          <h3 class="text-lg font-bold mb-2">SyncCaster</h3>
          <p class="text-sm text-gray-500 mb-4">一款高效的内容采集与多平台发布助手</p>
          <p class="text-xs text-gray-400 mb-4">基于 Doocs MD 编辑器，支持微信公众号排版</p>
          <div class="flex justify-center gap-3">
            <n-button size="small" @click="window.open('https://github.com/doocs/md', '_blank')">GitHub 仓库</n-button>
            <n-button size="small" @click="window.open('https://gitee.com/doocs/md', '_blank')">Gitee 仓库</n-button>
          </div>
        </div>
      </n-modal>
      
      <!-- 赞赏对话框 -->
      <n-modal v-model:show="showSponsorDialog" preset="card" title="赞赏" style="width: 480px;">
        <div class="text-center">
          <p class="text-sm text-gray-500 mb-4">若觉得项目不错，可以通过以下方式支持我们～</p>
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="text-center">
              <img 
                src="https://cdn-doocs.oss-cn-shenzhen.aliyuncs.com/gh/doocs/md/images/support1.jpg" 
                alt="赞赏二维码 1" 
                class="w-full max-w-[180px] mx-auto rounded-lg"
              />
              <p class="text-xs text-gray-400 mt-2">yanglbme</p>
            </div>
            <div class="text-center">
              <img 
                src="https://cdn-doocs.oss-cn-shenzhen.aliyuncs.com/gh/doocs/md/images/support2.jpg" 
                alt="赞赏二维码 2" 
                class="w-full max-w-[180px] mx-auto rounded-lg"
              />
              <p class="text-xs text-gray-400 mt-2">yangfong</p>
            </div>
          </div>
          <n-button @click="showSponsorDialog = false">关闭</n-button>
        </div>
      </n-modal>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, h, provide, inject } from 'vue';
import { darkTheme, useMessage } from 'naive-ui';
import type { DropdownOption, MessageApiInjection } from 'naive-ui';
import { db } from '@synccaster/core';
import DashboardView from './views/Dashboard.vue';
import PostsView from './views/Posts.vue';
import AccountsView from './views/Accounts.vue';
import TasksView from './views/Tasks.vue';
import EditorView from './views/Editor.vue';

const isDark = ref(false);
const theme = computed(() => isDark.value ? darkTheme : null);
const currentPath = ref('dashboard');
const fileInputRef = ref<HTMLInputElement | null>(null);

// message API 引用，将在 MessageApiProvider 组件中设置
const messageApiRef = ref<MessageApiInjection | null>(null);

// 简单的消息提示函数
function showMessage(type: 'success' | 'error' | 'warning' | 'info', content: string) {
  if (messageApiRef.value) {
    messageApiRef.value[type](content);
  } else {
    // 后备方案
    console.log(`[${type}] ${content}`);
    if (type === 'error') {
      alert(content);
    }
  }
}

// 提供设置 message API 的方法
provide('setMessageApi', (api: MessageApiInjection) => {
  messageApiRef.value = api;
});

// 内部组件：用于在 n-message-provider 内部获取 message API
const MessageApiInjector = {
  setup() {
    const setMessageApi = inject<(api: MessageApiInjection) => void>('setMessageApi');
    const message = useMessage();
    if (setMessageApi) {
      setMessageApi(message);
    }
    return () => null; // 不渲染任何内容
  }
};

const navItems = [
  { path: 'dashboard', label: '仪表盘', icon: '📊' },
  { path: 'posts', label: '文章管理', icon: '📝' },
  { path: 'accounts', label: '账号管理', icon: '👤' },
  { path: 'tasks', label: '任务中心', icon: '⚙️' },
];

// 导出选项
const exportOptions: DropdownOption[] = [
  { label: '导出为 Markdown', key: 'markdown', icon: () => h('span', '📄') },
  { label: '导出为 HTML', key: 'html', icon: () => h('span', '🌐') },
  { label: '导出为 PDF', key: 'pdf', icon: () => h('span', '📑') },
  { label: '导出为 PNG 图片', key: 'png', icon: () => h('span', '🖼️') },
];

// 帮助选项
const helpOptions: DropdownOption[] = [
  { label: '反馈', key: 'feedback', icon: () => h('span', '💬') },
  { label: '版本历史', key: 'releases', icon: () => h('span', '🏷️') },
  { label: '关于', key: 'about', icon: () => h('span', '❓') },
  { label: '赞赏', key: 'sponsor', icon: () => h('span', '❤️') },
];

// 帮助对话框状态
const showAboutDialog = ref(false);
const showSponsorDialog = ref(false);

const components: Record<string, any> = {
  dashboard: DashboardView,
  posts: PostsView,
  accounts: AccountsView,
  tasks: TasksView,
  editor: EditorView,
};

const currentComponent = shallowRef(DashboardView);

onMounted(async () => {
  updateRouteFromHash();
  window.addEventListener('hashchange', updateRouteFromHash);

  // 插件打开时自动检测账号状态（后台执行，不阻塞 UI）
  autoRefreshAccountsOnStartup();
});

// 启动时自动刷新账号状态
const ACCOUNTS_AUTO_REFRESH_THROTTLE_MS = 5 * 1000;
const ACCOUNTS_AUTO_REFRESH_STORAGE_KEY = 'lastAccountsAutoRefreshAt';

async function autoRefreshAccountsOnStartup() {
  try {
    // 从数据库加载账号
    const accounts = await db.accounts.toArray();
    if (accounts.length === 0) return;

    // 检查节流：避免短时间内重复刷新
    const stored = await chrome.storage.local.get([ACCOUNTS_AUTO_REFRESH_STORAGE_KEY]);
    const last = stored?.[ACCOUNTS_AUTO_REFRESH_STORAGE_KEY];
    const lastAt = typeof last === 'number' ? last : 0;
    const now = Date.now();

    if (lastAt > 0 && now - lastAt < ACCOUNTS_AUTO_REFRESH_THROTTLE_MS) {
      return;
    }

    // 写入节流时间戳
    await chrome.storage.local.set({ [ACCOUNTS_AUTO_REFRESH_STORAGE_KEY]: now });

    // 调用后台服务刷新所有账号
    const result = await chrome.runtime.sendMessage({
      type: 'REFRESH_ALL_ACCOUNTS_FAST',
      data: { accounts },
    });

    if (result?.success) {
      const { successCount, failedCount } = result;
      // 显示美观的提示
      if (failedCount === 0 && successCount > 0) {
        showMessage('success', `已检测 ${successCount} 个账号，全部正常`);
      } else if (successCount === 0 && failedCount > 0) {
        showMessage('error', `${failedCount} 个账号登录已失效，请前往账号管理重新登录`);
      } else if (failedCount > 0) {
        showMessage('warning', `${successCount} 个账号正常，${failedCount} 个已失效`);
      }
    }
  } catch (error) {
    console.error('[App] 自动刷新账号失败:', error);
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', updateRouteFromHash);
});

function navigate(path: string) {
  currentPath.value = path;
  currentComponent.value = components[path] || DashboardView;
  window.location.hash = path;
}

function updateRouteFromHash() {
  const raw = window.location.hash.slice(1);
  const hash = raw.startsWith('/') ? raw.slice(1) : raw;
  if (!hash) {
    navigate('dashboard');
    return;
  }
  // 支持 editor/<id>
  if (hash.startsWith('editor/')) {
    currentPath.value = 'editor';
    currentComponent.value = EditorView;
    return;
  }
  if (components[hash]) {
    currentPath.value = hash;
    currentComponent.value = components[hash];
    return;
  }
  // 默认
  navigate('dashboard');
}

function toggleTheme() {
  isDark.value = !isDark.value;
}

// 帮助功能处理
function handleHelp(key: string) {
  switch (key) {
    case 'feedback':
      window.open('https://github.com/doocs/md/issues', '_blank');
      break;
    case 'releases':
      window.open('https://github.com/doocs/md/releases', '_blank');
      break;
    case 'about':
      showAboutDialog.value = true;
      break;
    case 'sponsor':
      showSponsorDialog.value = true;
      break;
  }
}

// 导入功能
function handleImport() {
  fileInputRef.value?.click();
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  
  try {
    const content = await file.text();
    const fileName = file.name.replace(/\.(md|markdown)$/i, '');
    
    // 从 Markdown 内容中提取图片
    const assets = extractImagesFromMarkdown(content);
    
    // 创建新文章
    const now = Date.now();
    const newId = crypto.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2, 8)}`;
    
    await db.posts.add({
      id: newId,
      version: 1,
      title: fileName,
      summary: content.slice(0, 200),
      canonicalUrl: '',
      createdAt: now,
      updatedAt: now,
      body_md: content,
      tags: [],
      categories: [],
      assets: assets,
      meta: { importedFrom: file.name }
    } as any);
    
    const imageCount = assets.length;
    const msg = imageCount > 0 
      ? `已导入文章：${fileName}（包含 ${imageCount} 张图片）`
      : `已导入文章：${fileName}`;
    showMessage('success', msg);
    
    // 跳转到编辑器
    window.location.hash = `editor/${newId}`;
  } catch (e: any) {
    showMessage('error', `导入失败：${e?.message || '未知错误'}`);
  } finally {
    // 清空 input 以便再次选择同一文件
    input.value = '';
  }
}

// 从 Markdown 内容中提取图片 URL
function extractImagesFromMarkdown(markdown: string): Array<{ id: string; type: 'image'; url: string; alt: string; title?: string }> {
  const images: Array<{ id: string; type: 'image'; url: string; alt: string; title?: string }> = [];
  const seen = new Set<string>();
  
  // 匹配 Markdown 图片语法: ![alt](url "title") 或 ![alt](url)
  const mdImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
  let match;
  
  while ((match = mdImageRegex.exec(markdown)) !== null) {
    const [, alt, url, title] = match;
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({
        id: crypto.randomUUID?.() || `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'image',
        url: url,
        alt: alt || '',
        title: title || undefined,
      });
    }
  }
  
  // 匹配 HTML img 标签: <img src="url" alt="alt" title="title">
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImageRegex.exec(markdown)) !== null) {
    const url = match[1];
    if (url && !seen.has(url)) {
      seen.add(url);
      // 尝试提取 alt 和 title
      const altMatch = /alt=["']([^"']*)["']/i.exec(match[0]);
      const titleMatch = /title=["']([^"']*)["']/i.exec(match[0]);
      images.push({
        id: crypto.randomUUID?.() || `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'image',
        url: url,
        alt: altMatch?.[1] || '',
        title: titleMatch?.[1] || undefined,
      });
    }
  }
  
  return images;
}

// 导出功能
async function handleExport(key: string) {
  // 检查当前是否在编辑器页面
  const raw = window.location.hash.slice(1);
  const hash = raw.startsWith('/') ? raw.slice(1) : raw;
  
  if (!hash.startsWith('editor/')) {
    showMessage('warning', '请先打开一篇文章再进行导出');
    return;
  }
  
  const postId = hash.slice('editor/'.length);
  if (!postId || postId === 'new') {
    showMessage('warning', '请先保存文章再进行导出');
    return;
  }
  
  try {
    const post = await db.posts.get(postId);
    if (!post) {
      showMessage('error', '文章不存在');
      return;
    }
    
    const title = post.title || '未命名';
    const content = post.body_md || '';
    
    switch (key) {
      case 'markdown':
        downloadFile(content, `${sanitizeTitle(title)}.md`, 'text/markdown;charset=utf-8');
        showMessage('success', '已导出 Markdown 文件');
        break;
        
      case 'html':
        await exportAsHtml(content, title);
        showMessage('success', '已导出 HTML 文件');
        break;
        
      case 'pdf':
        await exportAsPdf(content, title);
        break;
        
      case 'png':
        await exportAsPng(title);
        break;
    }
  } catch (e: any) {
    showMessage('error', `导出失败：${e?.message || '未知错误'}`);
  }
}

// 工具函数：清理文件名
function sanitizeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'untitled';
}

// 工具函数：下载文件
function downloadFile(content: string | Blob, filename: string, mimeType?: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 获取渲染后的预览 HTML（包含 KaTeX 和 Mermaid）
function getRenderedPreviewHtml(): string | null {
  const previewEl = document.querySelector('.markdown-preview') as HTMLElement;
  if (!previewEl) return null;
  return previewEl.innerHTML;
}

// 获取导出所需的样式
function getExportStyles(): string {
  return `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #1f2937; }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
    h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    p { margin: 1em 0; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', Monaco, monospace; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #dfe2e5; margin: 1em 0; padding-left: 16px; color: #6a737d; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    ul, ol { padding-left: 2em; margin: 1em 0; }
    li { margin: 0.25em 0; }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
    /* KaTeX 样式 */
    .katex { font-size: 1.1em; }
    .katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.5em 0; }
    /* Mermaid 样式 */
    .mermaid-rendered svg { max-width: 100%; height: auto; }
    .mermaid-source { display: none; }
    .mermaid-loading { display: none; }
  `;
}

// 导出为 HTML
async function exportAsHtml(markdown: string, title: string) {
  // 优先使用已渲染的预览内容（包含 KaTeX 和 Mermaid）
  let htmlContent = getRenderedPreviewHtml();
  
  if (!htmlContent) {
    // 后备：使用 marked 解析
    const { Marked } = await import('marked');
    const marked = new Marked();
    htmlContent = await marked.parse(markdown);
  }
  
  const safeTitle = sanitizeTitle(title);
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <style>${getExportStyles()}</style>
</head>
<body>
  <h1>${safeTitle}</h1>
  ${htmlContent}
</body>
</html>`;
  
  downloadFile(fullHtml, `${safeTitle}.html`, 'text/html');
}

// 导出为 PDF
async function exportAsPdf(markdown: string, title: string) {
  // 优先使用已渲染的预览内容（包含 KaTeX 和 Mermaid）
  let htmlContent = getRenderedPreviewHtml();
  
  if (!htmlContent) {
    // 后备：使用 marked 解析
    const { Marked } = await import('marked');
    const marked = new Marked();
    htmlContent = await marked.parse(markdown);
  }
  
  const safeTitle = sanitizeTitle(title);
  
  // 创建新窗口用于打印
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showMessage('error', '无法打开打印窗口，请检查浏览器弹窗设置');
    return;
  }
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${safeTitle}</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
      <style>
        ${getExportStyles()}
        
        @page {
          margin: 1.5cm;
        }
        
        @media print {
          body { margin: 0; max-width: 100%; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          pre { white-space: pre-wrap; word-wrap: break-word; }
        }
      </style>
    </head>
    <body>
      <h1>${safeTitle}</h1>
      ${htmlContent}
    </body>
    </html>
  `);
  
  printWindow.document.close();
  
  // 等待资源加载完成后再打印
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
      printWindow.onafterprint = () => {
        printWindow.close();
      };
    }, 500); // 给 KaTeX 字体加载一些时间
  };
  
  showMessage('info', '请在打印对话框中选择"另存为 PDF"');
}

// 导出为 PNG
async function exportAsPng(title: string) {
  // 查找预览区域
  const previewEl = document.querySelector('.markdown-preview') as HTMLElement;
  if (!previewEl) {
    showMessage('error', '未找到预览内容，请确保文章已打开');
    return;
  }
  
  try {
    // 动态导入 html-to-image
    const { toPng } = await import('html-to-image');
    
    // 克隆元素以避免修改原始 DOM
    const clonedEl = previewEl.cloneNode(true) as HTMLElement;
    clonedEl.style.padding = '20px';
    clonedEl.style.backgroundColor = isDark.value ? '#1f2937' : '#ffffff';
    
    const dataUrl = await toPng(previewEl, {
      backgroundColor: isDark.value ? '#1f2937' : '#ffffff',
      skipFonts: false, // 不跳过字体以确保 KaTeX 正确渲染
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // 限制最大像素比
      style: {
        margin: '0',
        padding: '20px',
      },
      filter: (node) => {
        // 过滤掉隐藏的元素
        if (node instanceof HTMLElement) {
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }
        }
        return true;
      },
    });
    
    // 将 data URL 转换为 Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // 下载文件
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeTitle(title)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showMessage('success', '已导出 PNG 图片');
  } catch (e: any) {
    console.error('PNG export error:', e);
    showMessage('error', `导出图片失败：${e?.message || '未知错误'}`);
  }
}
</script>

<style scoped>
/* 确保渐变文字显示正确 */
.bg-clip-text {
  -webkit-background-clip: text;
  background-clip: text;
}

/* 全局禁用文本选择（默认） */
* {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

/* 允许可编辑元素选择文本 */
input,
textarea,
[contenteditable="true"],
.allow-select {
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  user-select: text;
}

/* 代码块和预格式化文本允许选择 */
code,
pre,
.prose {
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  user-select: text;
}
</style>
