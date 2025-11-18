<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 relative">
        <!-- 装饰性背景 -->
        <div class="fixed top-0 right-0 w-96 h-96 bg-blue-100 rounded-full opacity-10 -translate-y-48 translate-x-48 blur-3xl pointer-events-none"></div>
        <div class="fixed bottom-0 left-0 w-96 h-96 bg-purple-100 rounded-full opacity-10 translate-y-48 -translate-x-48 blur-3xl pointer-events-none"></div>
        
        <!-- 头部 -->
        <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/50 shadow-sm">
          <div class="max-w-7xl mx-auto px-6 py-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4 select-none">
                <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <span class="text-white text-xl">✨</span>
                </div>
                <div>
                  <h1 class="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">SyncCaster</h1>
                  <p class="text-xs text-gray-500">v2.0.0 · 内容采集与发布助手</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <button
                  @click="toggleTheme"
                  class="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center text-xl"
                  :title="isDark ? '切换到亮色模式' : '切换到暗色模式'"
                >
                  {{ isDark ? '🌙' : '☀️' }}
                </button>
              </div>
            </div>
          </div>
        </header>

        <div class="max-w-7xl mx-auto flex relative">
          <!-- 侧边栏 -->
          <aside class="w-64 min-h-[calc(100vh-89px)] sticky top-[89px]">
            <nav class="p-4 space-y-1">
              <div
                v-for="item in navItems"
                :key="item.path"
                class="group relative px-4 py-3 rounded-xl cursor-pointer select-none transition-all duration-300"
                :class="currentPath === item.path 
                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/30' 
                  : 'hover:bg-white/60 text-gray-700 hover:text-gray-900'"
                @click="navigate(item.path)"
              >
                <div class="flex items-center gap-3">
                  <span class="text-xl transition-transform group-hover:scale-110">{{ item.icon }}</span>
                  <span class="font-medium">{{ item.label }}</span>
                </div>
                <div 
                  v-if="currentPath === item.path"
                  class="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 rounded-xl blur opacity-30 -z-10"
                ></div>
              </div>
            </nav>
          </aside>

          <!-- 主内容区 -->
          <main class="flex-1 p-6 min-h-[calc(100vh-89px)]">
            <div class="bg-white/60 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-6">
              <component :is="currentComponent" />
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
</style>
