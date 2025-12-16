<template>
  <div>
    <h2 class="text-2xl font-bold mb-4" :class="isDark ? 'text-gray-100' : 'text-gray-800'">编辑文章</h2>

    <div v-if="loading" class="text-gray-500">加载中...</div>
    <div v-else-if="notFound" class="text-red-500">未找到文章</div>

    <div v-else class="space-y-4">
      <!-- 采集来源链接 -->
      <div v-if="sourceUrl" class="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
        <span class="text-blue-600">📥 采集来源：</span>
        <a 
          :href="sourceUrl" 
          target="_blank" 
          rel="noopener noreferrer"
          class="text-blue-600 hover:text-blue-800 hover:underline truncate flex-1"
          :title="sourceUrl"
        >
          {{ sourceUrl }}
        </a>
        <button
          @click="copyText(sourceUrl)"
          class="p-1 rounded hover:bg-blue-100 text-blue-600"
          title="复制链接"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
      </div>

      <!-- 标题框 -->
      <div class="relative">
        <label class="block text-sm text-gray-600 mb-1">标题</label>
        <div class="relative">
          <input
            v-model="title"
            type="text"
            class="w-full border rounded px-3 py-2 pr-12"
            placeholder="请输入标题"
          />
          <button
            @click="copyText(title)"
            class="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded bg-white/90 hover:bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-700 transition-all shadow-sm hover:shadow"
            title="复制标题"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 正文框 -->
      <div class="relative">
        <div class="flex items-center justify-between mb-1">
          <label class="block text-sm text-gray-600">正文</label>
          <!-- 打开公众号编辑器按钮 -->
          <button
            @click="openMdEditor"
            class="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors outline-none focus:outline-none focus:ring-0 border-none"
            title="在新标签页中打开完整的公众号编辑器"
          >
            🚀 打开公众号编辑器
          </button>
        </div>
        
        <!-- Markdown 编辑 -->
        <div class="relative">
          <textarea
            v-model="body"
            class="w-full h-80 border rounded px-3 py-2 pr-12 font-mono text-sm"
            placeholder="# 开始编辑..."
          ></textarea>
          <button
            @click="copyText(body)"
            class="absolute right-1 top-2 p-1.5 rounded bg-white/90 hover:bg-gray-100 border border-gray-200 text-gray-500 hover:text-gray-700 transition-all shadow-sm hover:shadow"
            title="复制正文"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="text-sm text-gray-500">
        <span>字数：{{ body.length }}</span>
      </div>

      <!-- 操作按钮：移到正文下方 -->
      <div class="flex gap-2 pt-2 border-t">
        <button class="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors outline-none focus:outline-none focus:ring-0 border-none" @click="save">保存</button>
        <button class="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 transition-colors outline-none focus:outline-none focus:ring-0 border-none" @click="goBack">返回</button>
        <button class="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors outline-none focus:outline-none focus:ring-0 border-none" @click="publish">发布</button>
      </div>

      <!-- 图片资源：移到按钮下方 -->
      <div v-if="images.length" class="mt-6 pt-4 border-t">
        <div class="text-sm text-gray-600 mb-3 font-semibold">图片资源（{{ images.length }}）</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div 
            v-for="img in images" 
            :key="img.id" 
            class="border rounded p-2 bg-white hover:shadow-lg transition-shadow cursor-pointer"
            @click="previewImage(img)"
          >
            <img :src="img.url" :alt="img.alt || ''" class="w-full h-28 object-cover rounded" />
            <div class="mt-1 text-xs text-gray-500 truncate" :title="img.title || img.alt || img.url">
              {{ img.title || img.alt || img.url }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 图片预览模态框 -->
    <Teleport to="body">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="previewImg"
          class="fixed inset-0 flex items-center justify-center p-4"
          style="background-color: rgba(0, 0, 0, 0.75); z-index: 9999;"
          @click="closeImagePreview"
        >
          <div class="max-w-4xl max-h-full">
            <img :src="previewImg.url" :alt="previewImg.alt || ''" class="max-w-full max-h-[85vh] object-contain rounded shadow-2xl" />
            <div v-if="previewImg.title || previewImg.alt" class="text-white text-center mt-3 font-medium">
              {{ previewImg.title || previewImg.alt }}
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 复制成功提示 -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="showCopyTip"
        class="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50"
      >
        ✓ {{ copyTipMessage }}
      </div>
    </transition>

    <!-- 验证错误提示 -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="showValidationTip"
        class="fixed bottom-4 right-4 bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg z-50"
      >
        ⚠️ {{ validationTipMessage }}
      </div>
    </transition>

    <!-- 发布对话框 -->
    <Teleport to="body">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showPublishDialog"
          class="fixed inset-0 flex items-center justify-center p-4"
          style="background-color: rgba(0, 0, 0, 0.5); z-index: 9999;"
          @click.self="closePublishDialog"
        >
          <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" @click.stop>
          <!-- 对话框头部 -->
          <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h3 class="text-xl font-bold text-gray-800">发布文章</h3>
            <button
              @click="closePublishDialog"
              class="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 对话框内容 -->
          <div class="p-6 space-y-4">
            <!-- 文章信息 -->
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="text-sm text-gray-600 mb-1">文章标题</div>
              <div class="font-semibold text-gray-800">{{ title || '未命名' }}</div>
              <div class="text-sm text-gray-500 mt-2">字数：{{ body.length }}</div>
            </div>

            <!-- 平台选择 -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <label class="text-sm font-semibold text-gray-700">选择发布平台</label>
                <button
                  @click="toggleSelectAll"
                  class="text-sm text-blue-600 hover:text-blue-700 transition-colors"
                >
                  {{ allSelected ? '取消全选' : '全选' }}
                </button>
              </div>

              <!-- 已登录账号列表 -->
              <div v-if="enabledAccounts.length > 0" class="space-y-2">
                <div
                  v-for="account in enabledAccounts"
                  :key="account.id"
                  class="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
                  :class="selectedAccounts.includes(account.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200'"
                  @click="toggleAccount(account.id)"
                >
                  <input
                    type="checkbox"
                    :checked="selectedAccounts.includes(account.id)"
                    class="w-4 h-4 text-blue-600 rounded"
                    @click.stop="toggleAccount(account.id)"
                  />
                  <img
                    v-if="account.avatar"
                    :src="account.avatar"
                    :alt="account.nickname"
                    class="w-8 h-8 rounded-full"
                  />
                  <div class="flex-1">
                    <div class="font-medium text-gray-800">{{ account.nickname }}</div>
                    <div class="text-xs text-gray-500">{{ getPlatformName(account.platform) }}</div>
                  </div>
                  <span class="text-xl">{{ getPlatformIcon(account.platform) }}</span>
                </div>
              </div>

              <!-- 无可用账号提示 -->
              <div v-else class="text-center py-8 text-gray-500">
                <div class="text-4xl mb-2">📭</div>
                <div>暂无已登录的账号</div>
                <button
                  @click="goToAccounts"
                  class="mt-3 text-blue-600 hover:text-blue-700 text-sm"
                >
                  前往添加账号 →
                </button>
              </div>
            </div>
          </div>

          <!-- 对话框底部 -->
          <div class="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex gap-3 rounded-b-2xl">
            <button
              @click="previewPost"
              class="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              :disabled="!title && !body"
            >
              👁️ 预览
            </button>
            <button
              @click="confirmPublish"
              class="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              :disabled="selectedAccounts.length === 0 || publishing"
            >
              {{ publishing ? '发布中...' : `发布到 ${selectedAccounts.length} 个平台` }}
            </button>
          </div>
        </div>
      </div>
    </transition>
    </Teleport>

    <!-- 预览对话框 -->
    <Teleport to="body">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showPreview"
          class="fixed inset-0 flex items-center justify-center p-4"
          style="background-color: rgba(0, 0, 0, 0.5); z-index: 9999;"
          @click.self="closePreview"
        >
          <div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-y-auto" @click.stop>
          <!-- 预览头部 -->
          <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h3 class="text-xl font-bold text-gray-800">文章预览</h3>
            <button
              @click="closePreview"
              class="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 预览内容 -->
          <div class="p-8">
            <h1 class="text-3xl font-bold text-gray-900 mb-4">{{ title || '未命名标题' }}</h1>
            <div class="text-sm text-gray-500 mb-6">字数：{{ body.length }} · 图片：{{ images.length }}</div>
            <div class="prose prose-lg max-w-none" v-html="previewHtml"></div>
          </div>
        </div>
      </div>
    </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { db, type Account, ChromeStorageBridge, type SyncCasterArticle } from '@synccaster/core';
import { marked } from 'marked';

defineProps<{ isDark?: boolean }>();

const loading = ref(true);
const notFound = ref(false);
const id = ref<string>('');
const title = ref('');
const body = ref('');
const sourceUrl = ref('');
const images = ref<any[]>([]);
const previewImg = ref<any>(null);
const showCopyTip = ref(false);
const copyTipMessage = ref('已复制到剪贴板');
const showPublishDialog = ref(false);
const showPreview = ref(false);
const publishing = ref(false);
const enabledAccounts = ref<Account[]>([]);
const selectedAccounts = ref<string[]>([]);



// 计算是否全选
const allSelected = computed(() => {
  return enabledAccounts.value.length > 0 && 
         selectedAccounts.value.length === enabledAccounts.value.length;
});

// 预览 HTML
const previewHtml = computed(() => {
  if (!body.value) return '<p class="text-gray-400">暂无内容</p>';
  try {
    return marked(body.value);
  } catch {
    return `<pre class="text-red-500">Markdown 解析失败</pre>`;
  }
});

// 显示复制提示
function showCopySuccess(message: string = '已复制到剪贴板') {
  copyTipMessage.value = message;
  showCopyTip.value = true;
  setTimeout(() => {
    showCopyTip.value = false;
  }, 2000);
}

// 复制文本到剪贴板
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showCopySuccess('已复制到剪贴板');
  } catch {
    // Silently ignore copy errors
  }
}

// 预览图片
function previewImage(img: any) {
  previewImg.value = img;
}

// 关闭图片预览
function closeImagePreview() {
  previewImg.value = null;
}

function parseIdFromHash() {
  const raw = window.location.hash.slice(1);
  const hash = raw.startsWith('/') ? raw.slice(1) : raw;
  if (hash.startsWith('editor/')) return hash.slice('editor/'.length);
  return '';
}

async function load() {
  loading.value = true;
  try {
    const pid = parseIdFromHash();
    id.value = pid;

    if (pid === 'new' || !pid) {
      title.value = '';
      body.value = '';
      sourceUrl.value = '';
      loading.value = false;
      return;
    }

    const post = await db.posts.get(pid);
    if (!post) {
      notFound.value = true;
      return;
    }
    title.value = post.title || '';
    body.value = post.body_md || '';
    sourceUrl.value = post.url || post.canonicalUrl || '';
    images.value = Array.isArray(post.assets) ? post.assets.filter((a: any) => a.type === 'image') : [];
  } finally {
    loading.value = false;
  }
}

// 保存验证提示
const showValidationTip = ref(false);
const validationTipMessage = ref('');

function showValidationError(message: string) {
  validationTipMessage.value = message;
  showValidationTip.value = true;
  setTimeout(() => {
    showValidationTip.value = false;
  }, 2000);
}

async function save() {
  // 验证标题和正文
  if (!title.value.trim()) {
    showValidationError('请输入文章标题');
    return;
  }
  if (!body.value.trim()) {
    showValidationError('请输入文章正文');
    return;
  }

  if (!id.value || id.value === 'new') {
    const now = Date.now();
    const newId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await db.posts.add({
      id: newId,
      version: 1,
      title: title.value,
      summary: (body.value || '').slice(0, 200),
      canonicalUrl: '',
      createdAt: now,
      updatedAt: now,
      body_md: body.value,
      tags: [],
      categories: [],
      assets: [],
      meta: {},
    } as any);
    window.location.hash = `editor/${newId}`;
    showCopySuccess('文章已保存');
    return;
  }
  await db.posts.update(id.value, {
    title: title.value,
    body_md: body.value,
    summary: (body.value || '').slice(0, 200),
    updatedAt: Date.now(),
  } as any);
  showCopySuccess('文章已保存');
}

function goBack() {
  window.location.hash = 'posts';
}

// 加载已启用的账号
async function loadEnabledAccounts() {
  try {
    const allAccounts = await db.accounts.toArray();
    enabledAccounts.value = allAccounts.filter(account => account.enabled === true);
  } catch {
    enabledAccounts.value = [];
  }
}

// 获取平台名称（全部12个平台）
function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    wechat: '微信公众号',
    zhihu: '知乎',
    juejin: '掘金',
    csdn: 'CSDN',
    jianshu: '简书',
    cnblogs: '博客园',
    '51cto': '51CTO',
    'tencent-cloud': '腾讯云开发者社区',
    aliyun: '阿里云开发者社区',
    segmentfault: '思否',
    bilibili: 'B站专栏',
    oschina: '开源中国',
  };
  return names[platform] || platform;
}

// 获取平台图标（全部12个平台）
function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    wechat: '💚',
    zhihu: '🔵',
    juejin: '🔷',
    csdn: '📘',
    jianshu: '📝',
    cnblogs: '🌿',
    '51cto': '🔶',
    'tencent-cloud': '☁️',
    aliyun: '🧡',
    segmentfault: '🟢',
    bilibili: '📺',
    oschina: '🔴',
  };
  return icons[platform] || '📄';
}

// 切换账号选择
function toggleAccount(accountId: string) {
  const index = selectedAccounts.value.indexOf(accountId);
  if (index > -1) {
    selectedAccounts.value.splice(index, 1);
  } else {
    selectedAccounts.value.push(accountId);
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (allSelected.value) {
    selectedAccounts.value = [];
  } else {
    selectedAccounts.value = enabledAccounts.value.map(a => a.id);
  }
}

// 打开发布对话框
async function publish() {
  // 确保文章已保存
  if (!id.value || id.value === 'new') {
    alert('请先保存文章');
    await save();
    if (!id.value || id.value === 'new') return;
  }
  
  // 加载账号
  await loadEnabledAccounts();
  
  // 重置选择
  selectedAccounts.value = [];
  
  // 显示对话框
  showPublishDialog.value = true;
}

// 关闭发布对话框
function closePublishDialog() {
  showPublishDialog.value = false;
  selectedAccounts.value = [];
}

// 预览文章
function previewPost() {
  showPreview.value = true;
}

// 关闭预览
function closePreview() {
  showPreview.value = false;
}

// 前往账号管理
function goToAccounts() {
  window.location.hash = 'accounts';
}

// 打开公众号编辑器（md-editor）
async function openMdEditor() {
  // 确保文章已保存
  if (!id.value || id.value === 'new') {
    await save();
    if (!id.value || id.value === 'new') {
      alert('请先保存文章');
      return;
    }
  }
  
  try {
    // 构建 SyncCasterArticle 数据
    const article: SyncCasterArticle = {
      id: id.value,
      title: title.value || '未命名标题',
      content: body.value || '',
      sourceUrl: sourceUrl.value || undefined,
      updatedAt: Date.now(),
    };
    
    // 保存到 Chrome Storage
    await ChromeStorageBridge.saveArticle(article);
    
    // 获取扩展的 md-editor.html URL（位于 public/md-editor/ 目录下）
    const mdEditorUrl = chrome.runtime.getURL('md-editor/md-editor.html');
    
    // 在新标签页中打开
    chrome.tabs.create({ url: mdEditorUrl });
    
  } catch (error: any) {
    alert('打开公众号编辑器失败: ' + (error?.message || '未知错误'));
  }
}

// 确认发布
async function confirmPublish() {
  if (selectedAccounts.value.length === 0) {
    alert('请选择至少一个发布平台');
    return;
  }
  
  publishing.value = true;
  
  try {
    // 获取文章数据
    const post = await db.posts.get(id.value);
    if (!post) {
      throw new Error('文章不存在');
    }
    
    // 构建发布目标
    const targets = selectedAccounts.value.map(accountId => {
      const account = enabledAccounts.value.find(a => a.id === accountId);
      return {
        platform: account!.platform,
        accountId: accountId,
        config: {},
      };
    });
    
    // 创建发布任务
    const jobId = crypto.randomUUID();
    const now = Date.now();
    
    await db.jobs.add({
      id: jobId,
      postId: id.value,
      targets: targets,
      state: 'PENDING',
      progress: 0,
      attempts: 0,
      maxAttempts: 3,
      logs: [
        {
          id: crypto.randomUUID(),
          level: 'info',
          step: 'create',
          message: `创建发布任务，目标平台：${targets.length} 个`,
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    
    // 通知后台开始执行任务
    chrome.runtime.sendMessage({
      type: 'START_PUBLISH_JOB',
      data: { jobId },
    });
    
    // 关闭对话框
    closePublishDialog();
    
    // 显示成功提示
    alert(`发布任务已创建！\n将发布到 ${targets.length} 个平台\n\n您可以在"任务中心"查看进度`);
    
    // 跳转到任务中心
    window.location.hash = 'tasks';
    
  } catch (error: any) {
    alert('发布失败: ' + (error?.message || '未知错误'));
  } finally {
    publishing.value = false;
  }
}

// 从 Chrome Storage 同步内容（当从 md-editor 返回时）
async function syncFromStorage() {
  if (!id.value || id.value === 'new') return;
  
  try {
    const article = await ChromeStorageBridge.loadArticle();
    if (article && article.id === id.value) {
      // 检查是否有更新
      if (article.content !== body.value || article.title !== title.value) {
        title.value = article.title;
        body.value = article.content;
      }
    }
  } catch {
    // Silently ignore sync errors
  }
}

// 监听页面可见性变化（当用户从 md-editor 返回时）
function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    syncFromStorage();
  }
}

// 监听 Chrome Storage 变化
let unsubscribeStorageChange: (() => void) | null = null;

function setupStorageListener() {
  try {
    unsubscribeStorageChange = ChromeStorageBridge.onArticleChange((article) => {
      if (article && article.id === id.value) {
        if (article.content !== body.value || article.title !== title.value) {
          title.value = article.title;
          body.value = article.content;
        }
      }
    });
  } catch {
    // Silently ignore listener setup errors
  }
}

onMounted(() => {
  load();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  setupStorageListener();
});

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (unsubscribeStorageChange) {
    unsubscribeStorageChange();
  }
});
</script>

<style scoped>
/* 基础样式 */
</style>
