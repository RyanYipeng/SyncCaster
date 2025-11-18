<template>
  <div class="w-96 min-h-120 p-4 bg-white">
    <div class="flex-between mb-4">
      <h1 class="text-xl font-bold text-gray-800">SyncCaster</h1>
      <button
        class="text-gray-500 hover:text-gray-700"
        @click="openOptions"
      >
        ⚙️
      </button>
    </div>

    <div v-if="loading" class="flex-center py-8">
      <div class="text-gray-500">加载中...</div>
    </div>

    <template v-else>
      <!-- 快速操作 -->
      <div class="mb-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-2">快速操作</h2>
        <div class="grid grid-cols-2 gap-2">
          <button
            class="btn-ghost text-left"
            @click="collectFromCurrentPage"
          >
            📥 采集当前页
          </button>
          <button
            class="btn-ghost text-left"
            @click="openEditor"
          >
            ✍️ 新建文章
          </button>
        </div>
      </div>

      <!-- 草稿列表 -->
      <div class="mb-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-2">最近草稿</h2>
        <div v-if="recentPosts.length === 0" class="text-sm text-gray-500">
          暂无草稿
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="post in recentPosts"
            :key="post.id"
            class="p-3 rounded border border-gray-200 hover:bg-gray-50 cursor-pointer"
            @click="editPost(post.id)"
          >
            <div class="text-sm font-medium text-gray-800 truncate">
              {{ post.title }}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ formatDate(post.updatedAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 任务状态 -->
      <div v-if="runningJobs.length > 0" class="mb-4">
        <h2 class="text-sm font-semibold text-gray-700 mb-2">进行中的任务</h2>
        <div class="space-y-2">
          <div
            v-for="job in runningJobs"
            :key="job.id"
            class="p-3 rounded border border-blue-200 bg-blue-50"
          >
            <div class="text-sm text-gray-800">发布中...</div>
            <div class="mt-2 bg-gray-200 rounded-full h-2">
              <div
                class="bg-blue-500 h-2 rounded-full transition-all"
                :style="{ width: `${job.progress}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部链接 -->
      <div class="pt-4 border-t border-gray-200 flex justify-between text-xs text-gray-500">
        <a href="#" @click.prevent="openOptions">设置</a>
        <a href="#" @click.prevent="openHistory">历史记录</a>
        <a href="#" @click.prevent="openHelp">帮助</a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db } from '@synccaster/core';

const loading = ref(true);
const recentPosts = ref<any[]>([]);
const runningJobs = ref<any[]>([]);

onMounted(async () => {
  await loadData();
});

async function loadData() {
  try {
    // 加载最近的草稿
    const posts = await db.posts
      .orderBy('updatedAt')
      .reverse()
      .limit(5)
      .toArray();
    recentPosts.value = posts;

    // 加载进行中的任务
    const jobs = await db.jobs
      .where('state')
      .equals('RUNNING')
      .toArray();
    runningJobs.value = jobs;
  } catch (error) {
    console.error('Failed to load data:', error);
  } finally {
    loading.value = false;
  }
}

async function collectFromCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab');

    const sendCollectMessage = (): Promise<any> =>
      new Promise((resolve, reject) => {
        try {
          chrome.tabs.sendMessage(tab.id!, { type: 'COLLECT_CONTENT' }, (resp) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr) return reject(new Error(lastErr.message));
            resolve(resp);
          });
        } catch (e: any) {
          reject(e);
        }
      });

    let response: any;
    try {
      // 第一次尝试，假设 content script 已注入
      response = await sendCollectMessage();
    } catch (err) {
      // 若未注入，则动态注入后重试
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts.js'],
      });
      // 等待注入完成
      await new Promise((r) => setTimeout(r, 150));
      response = await sendCollectMessage();
    }

    console.log('Collected content:', response);
    if (!response || !response.success || !response.data) {
      throw new Error('采集结果为空');
    }

    // 将采集结果交给 background 保存
    const saveResult = await chrome.runtime.sendMessage({
      type: 'SAVE_POST',
      data: response.data,
    });

    if (!saveResult?.success) {
      throw new Error(saveResult?.error || '保存失败');
    }

    alert('内容采集并保存成功！');

    // 打开文章管理视图，方便立即查看
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/ui/options/index.html#posts'),
    });
  } catch (error: any) {
    console.error('Collection failed:', error);
    alert('采集失败: ' + error.message);
  }
}

function openEditor() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/ui/options/index.html#/editor/new'),
  });
}

function editPost(postId: string) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(`src/ui/options/index.html#/editor/${postId}`),
  });
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function openHistory() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/ui/options/index.html#/history'),
  });
}

function openHelp() {
  chrome.tabs.create({
    url: 'https://github.com/your-repo/synccaster',
  });
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  
  return date.toLocaleDateString('zh-CN');
}
</script>

<style scoped>
/* 样式由 UnoCSS 提供 */
</style>
