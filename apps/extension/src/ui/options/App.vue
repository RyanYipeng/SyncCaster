<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <div class="min-h-screen bg-gray-50">
        <!-- 头部 -->
        <header class="bg-white border-b border-gray-200 px-6 py-4">
          <div class="flex-between max-w-7xl mx-auto">
            <div class="flex items-center gap-4">
              <h1 class="text-2xl font-bold text-gray-800">SyncCaster</h1>
              <span class="text-sm text-gray-500">v2.0.0</span>
            </div>
            <div class="flex items-center gap-4">
              <n-button text @click="toggleTheme">
                {{ isDark ? '🌙' : '☀️' }}
              </n-button>
            </div>
          </div>
        </header>

        <div class="max-w-7xl mx-auto flex">
          <!-- 侧边栏 -->
          <aside class="w-64 bg-white border-r border-gray-200 min-h-[calc(100vh-73px)]">
            <nav class="p-4">
              <div
                v-for="item in navItems"
                :key="item.path"
                class="px-4 py-2 rounded cursor-pointer hover:bg-gray-100 mb-1"
                :class="{ 'bg-blue-50 text-blue-600': currentPath === item.path }"
                @click="navigate(item.path)"
              >
                <span class="mr-2">{{ item.icon }}</span>
                {{ item.label }}
              </div>
            </nav>
          </aside>

          <!-- 主内容区 -->
          <main class="flex-1 p-6">
            <component :is="currentComponent" />
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
