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
          <div class="max-w-7xl mx-auto px-4 py-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 select-none">
                <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
                  <span class="text-white text-base">✨</span>
                </div>
                <div>
                  <h1 class="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">SyncCaster</h1>
                  <p class="text-[10px]" :class="isDark ? 'text-gray-400' : 'text-gray-500'">v2.0.0 · 内容采集与发布助手</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  @click="toggleTheme"
                  class="w-8 h-8 rounded-lg transition-colors flex items-center justify-center text-base select-none border-none outline-none"
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
          <aside class="w-44 min-h-[calc(100vh-57px)] sticky top-[57px] flex-shrink-0">
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
          <main class="flex-1 p-3 min-h-[calc(100vh-57px)] overflow-hidden">
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
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import { darkTheme } from 'naive-ui';
import DashboardView from './views/Dashboard.vue';
import PostsView from './views/Posts.vue';
import AccountsView from './views/Accounts.vue';
import TasksView from './views/Tasks.vue';
import SettingsView from './views/Settings.vue';
import EditorView from './views/Editor.vue';

const isDark = ref(false);
const theme = computed(() => isDark.value ? darkTheme : null);
const currentPath = ref('dashboard');

const navItems = [
  { path: 'dashboard', label: '仪表盘', icon: '📊' },
  { path: 'posts', label: '文章管理', icon: '📝' },
  { path: 'accounts', label: '账号管理', icon: '👤' },
  { path: 'tasks', label: '任务中心', icon: '⚙️' },
  { path: 'settings', label: '设置', icon: '🔧' },
];

const components: Record<string, any> = {
  dashboard: DashboardView,
  posts: PostsView,
  accounts: AccountsView,
  tasks: TasksView,
  settings: SettingsView,
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
