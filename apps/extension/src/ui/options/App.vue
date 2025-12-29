<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <div 
        class="min-h-screen relative transition-colors duration-300"
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
          <div class="max-w-7xl mx-auto px-3 py-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 select-none">
                <div class="w-7 h-7 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
                  <span class="text-white text-sm">✨</span>
                </div>
                <div>
                  <h1 class="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-tight">SyncCaster</h1>
                  <p class="text-[9px] leading-tight" :class="isDark ? 'text-gray-400' : 'text-gray-500'">v2.0.0 · 内容采集与发布助手</p>
                </div>
              </div>
              
              <!-- 功能区：导入/导出 + 主题切换 -->
              <div class="flex items-center gap-1.5">
                <!-- 导入按钮 -->
                <button
                  @click="handleImport"
                  class="h-7 px-2.5 rounded-md transition-colors flex items-center gap-1 text-xs font-medium select-none border-none outline-none"
                  :class="isDark 
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                  title="导入 Markdown 文件"
                >
                  <span>📥</span>
                  <span>导入</span>
                </button>
                
                <!-- 导出下拉菜单 -->
                <n-dropdown 
                  :options="exportOptions" 
                  @select="handleExport"
                  trigger="click"
                  placement="bottom-end"
                >
                  <button
                    class="h-7 px-2.5 rounded-md transition-colors flex items-center gap-1 text-xs font-medium select-none border-none outline-none"
                    :class="isDark 
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'"
                    title="导出内容"
                  >
                    <span>📤</span>
                    <span>导出</span>
                    <span class="text-[10px]">▼</span>
                  </button>
                </n-dropdown>
                
                <!-- 主题切换 -->
                <button
                  @click="toggleTheme"
                  class="w-7 h-7 rounded-md transition-colors flex items-center justify-center text-sm select-none border-none outline-none"
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
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, h } from 'vue';
import { darkTheme, useMessage } from 'naive-ui';
import type { DropdownOption } from 'naive-ui';
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

const message = useMessage();

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

const components: Record<string, any> = {
  dashboard: DashboardView,
  posts: PostsView,
  accounts: AccountsView,
  tasks: TasksView,
  editor: EditorView,
};

const currentComponent = shallowRef(DashboardView);

onMounted(() => {
  updateRouteFromHash();
  window.addEventListener('hashchange', updateRouteFromHash);
});

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
      assets: [],
      meta: { importedFrom: file.name }
    } as any);
    
    message.success(`已导入文章：${fileName}`);
    
    // 跳转到编辑器
    window.location.hash = `editor/${newId}`;
  } catch (e: any) {
    message.error(`导入失败：${e?.message || '未知错误'}`);
  } finally {
    // 清空 input 以便再次选择同一文件
    input.value = '';
  }
}

// 导出功能
async function handleExport(key: string) {
  // 检查当前是否在编辑器页面
  const raw = window.location.hash.slice(1);
  const hash = raw.startsWith('/') ? raw.slice(1) : raw;
  
  if (!hash.startsWith('editor/')) {
    message.warning('请先打开一篇文章再进行导出');
    return;
  }
  
  const postId = hash.slice('editor/'.length);
  if (!postId || postId === 'new') {
    message.warning('请先保存文章再进行导出');
    return;
  }
  
  try {
    const post = await db.posts.get(postId);
    if (!post) {
      message.error('文章不存在');
      return;
    }
    
    const title = post.title || '未命名';
    const content = post.body_md || '';
    
    switch (key) {
      case 'markdown':
        downloadFile(content, `${sanitizeTitle(title)}.md`, 'text/markdown;charset=utf-8');
        message.success('已导出 Markdown 文件');
        break;
        
      case 'html':
        await exportAsHtml(content, title);
        message.success('已导出 HTML 文件');
        break;
        
      case 'pdf':
        await exportAsPdf(content, title);
        break;
        
      case 'png':
        await exportAsPng(title);
        break;
    }
  } catch (e: any) {
    message.error(`导出失败：${e?.message || '未知错误'}`);
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

// 导出为 HTML
async function exportAsHtml(markdown: string, title: string) {
  // 动态导入 marked
  const { Marked } = await import('marked');
  const marked = new Marked();
  const htmlContent = await marked.parse(markdown);
  
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${sanitizeTitle(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', Monaco, monospace; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #dfe2e5; margin: 0; padding-left: 16px; color: #6a737d; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
    th { background: #f6f8fa; }
  </style>
</head>
<body>
  <h1>${sanitizeTitle(title)}</h1>
  ${htmlContent}
</body>
</html>`;
  
  downloadFile(fullHtml, `${sanitizeTitle(title)}.html`, 'text/html');
}

// 导出为 PDF
async function exportAsPdf(markdown: string, title: string) {
  const { Marked } = await import('marked');
  const marked = new Marked();
  const htmlContent = await marked.parse(markdown);
  
  const safeTitle = sanitizeTitle(title);
  
  // 创建新窗口用于打印
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    message.error('无法打开打印窗口，请检查浏览器弹窗设置');
    return;
  }
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${safeTitle}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 100%; margin: 0 auto; padding: 20px; line-height: 1.6; }
        pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
        code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', Monaco, monospace; }
        pre code { background: none; padding: 0; }
        blockquote { border-left: 4px solid #dfe2e5; margin: 0; padding-left: 16px; color: #6a737d; }
        img { max-width: 100%; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
        th { background: #f6f8fa; }
        
        @page {
          margin: 1cm;
        }
        
        @media print {
          body { margin: 0; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
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
  
  printWindow.onload = () => {
    printWindow.print();
    printWindow.onafterprint = () => {
      printWindow.close();
    };
  };
  
  message.info('请在打印对话框中选择"另存为 PDF"');
}

// 导出为 PNG
async function exportAsPng(title: string) {
  // 查找预览区域
  const previewEl = document.querySelector('.markdown-preview') as HTMLElement;
  if (!previewEl) {
    message.error('未找到预览内容，请确保文章已打开');
    return;
  }
  
  try {
    // 动态导入 html-to-image
    const { toPng } = await import('html-to-image');
    
    const dataUrl = await toPng(previewEl, {
      backgroundColor: isDark.value ? '#1f2937' : '#ffffff',
      skipFonts: true,
      pixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      style: {
        margin: '0',
        padding: '20px',
      },
    });
    
    downloadFile(dataUrl, `${sanitizeTitle(title)}.png`, 'image/png');
    message.success('已导出 PNG 图片');
  } catch (e: any) {
    message.error(`导出图片失败：${e?.message || '未知错误'}`);
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
