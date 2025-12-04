<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold" :class="isDark ? 'text-gray-100' : 'text-gray-800'">任务中心</h2>
      <div class="flex gap-2">
        <button
          :disabled="selectedIds.length === 0"
          :class="selectedIds.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'"
          class="px-4 py-2 text-white rounded-lg transition-colors"
          @click="deleteSelected"
        >
          🗑️ 删除选中 ({{ selectedIds.length }})
        </button>
        <button
          @click="loadJobs"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          🔄 刷新
        </button>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <!-- 工具栏 -->
      <div class="flex items-center justify-between mb-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="selectAll" @change="toggleSelectAll" class="w-4 h-4" />
          <span class="text-sm">全选</span>
        </label>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">每页显示:</span>
          <select v-model="pageSize" class="border rounded px-2 py-1 text-sm">
            <option :value="10">10 条</option>
            <option :value="20">20 条</option>
            <option :value="50">50 条</option>
          </select>
        </div>
      </div>

      <!-- 任务列表 -->
      <div v-if="allJobs.length === 0" class="text-center py-12 text-gray-500">
        <div class="text-5xl mb-4">📋</div>
        <div class="text-lg">暂无任务</div>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="job in paginatedJobs"
          :key="job.id"
          class="border rounded-lg p-4 hover:shadow-md transition-shadow"
          :class="getJobClass(job.state)"
        >
          <div class="flex items-start gap-4">
            <input
              type="checkbox"
              :checked="selectedIds.includes(job.id)"
              @change="toggleSelect(job.id)"
              class="w-4 h-4 mt-1"
            />
            <div class="flex-1">
              <div class="flex items-center justify-between mb-2">
                <div>
                  <span class="font-semibold text-gray-800">{{ getPostTitle(job.postId) }}</span>
                  <span class="ml-2 px-2 py-1 text-xs rounded-full" :class="getStateClass(job.state)">
                    {{ getStateLabel(job.state) }}
                  </span>
                </div>
                <div class="flex gap-2">
                  <button v-if="job.state === 'PENDING'" @click="startJob(job.id)" class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">开始</button>
                  <button @click="deleteJob(job.id)" class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">删除</button>
                </div>
              </div>
              <div class="text-sm text-gray-600">发布到 {{ job.targets?.length || 0 }} 个平台</div>
              <div class="text-xs text-gray-500 mt-1">{{ formatTime(job.createdAt) }}</div>
              <div v-if="job.state === 'RUNNING'" class="mt-2">
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full" :style="{ width: `${job.progress || 0}%` }"></div>
                </div>
              </div>
              <div v-if="job.state === 'FAILED' && job.error" class="mt-2 p-2 bg-red-100 rounded text-sm text-red-800">❌ {{ job.error }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="allJobs.length > pageSize" class="flex justify-center items-center gap-4 mt-4">
        <button :disabled="currentPage <= 1" @click="currentPage--" class="px-3 py-1 border rounded disabled:opacity-50">上一页</button>
        <span class="text-sm">{{ currentPage }} / {{ pageCount }}</span>
        <button :disabled="currentPage >= pageCount" @click="currentPage++" class="px-3 py-1 border rounded disabled:opacity-50">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { db } from '@synccaster/core';

defineProps<{ isDark?: boolean }>();
const allJobs = ref<any[]>([]);
const posts = ref<Map<string, any>>(new Map());
const selectedIds = ref<string[]>([]);
const selectAll = ref(false);
const currentPage = ref(1);
const pageSize = ref(10);
let refreshInterval: number | null = null;

const pageCount = computed(() => Math.ceil(allJobs.value.length / pageSize.value));
const paginatedJobs = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return allJobs.value.slice(start, start + pageSize.value);
});

watch(pageSize, () => { currentPage.value = 1; });
onMounted(async () => {
  await loadJobs();
  refreshInterval = window.setInterval(loadJobs, 5000);
});
onUnmounted(() => { if (refreshInterval) clearInterval(refreshInterval); });

async function loadJobs() {
  try {
    const jobs = await db.jobs.toArray();
    allJobs.value = jobs.sort((a, b) => b.createdAt - a.createdAt);
    const postIds = [...new Set(jobs.map(j => j.postId))];
    for (const id of postIds) {
      if (!posts.value.has(id)) {
        const post = await db.posts.get(id);
        if (post) posts.value.set(id, post);
      }
    }
  } catch (e) { console.error('Failed to load jobs:', e); }
}

function toggleSelect(id: string) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) selectedIds.value.splice(idx, 1);
  else selectedIds.value.push(id);
  // 直接更新 selectAll 状态，不触发 watch
  selectAll.value = selectedIds.value.length === paginatedJobs.value.length && paginatedJobs.value.length > 0;
}

function toggleSelectAll() {
  selectedIds.value = selectAll.value ? paginatedJobs.value.map(j => j.id) : [];
}

async function startJob(jobId: string) {
  try {
    await chrome.runtime.sendMessage({ type: 'START_JOB', data: { jobId } });
    await loadJobs();
  } catch (e) { console.error('Failed to start job:', e); }
}

async function deleteJob(jobId: string) {
  if (!confirm('确定要删除这个任务吗？')) return;
  await db.jobs.delete(jobId);
  await loadJobs();
}

async function deleteSelected() {
  if (selectedIds.value.length === 0) return;
  if (!confirm(`确定要删除选中的 ${selectedIds.value.length} 个任务吗？`)) return;
  await db.jobs.bulkDelete(selectedIds.value);
  selectedIds.value = [];
  selectAll.value = false;
  await loadJobs();
}

function getPostTitle(postId: string) { return posts.value.get(postId)?.title || '未命名文章'; }
function getStateLabel(state: string) { return { PENDING: '待执行', RUNNING: '进行中', DONE: '已完成', FAILED: '失败' }[state] || state; }
function getJobClass(state: string) {
  return { RUNNING: 'border-blue-500 bg-blue-50', DONE: 'border-green-500 bg-green-50', PENDING: 'border-yellow-500 bg-yellow-50', FAILED: 'border-red-500 bg-red-50' }[state] || '';
}
function getStateClass(state: string) {
  return { RUNNING: 'bg-blue-600 text-white', DONE: 'bg-green-600 text-white', PENDING: 'bg-yellow-600 text-white', FAILED: 'bg-red-600 text-white' }[state] || '';
}
function formatTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>
