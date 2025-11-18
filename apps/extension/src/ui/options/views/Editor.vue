<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-800 mb-4">编辑文章</h2>

    <div v-if="loading" class="text-gray-500">加载中...</div>
    <div v-else-if="notFound" class="text-red-500">未找到文章</div>

    <div v-else class="space-y-4">
      <!-- 标题框 -->
      <div class="relative">
        <label class="block text-sm text-gray-600 mb-1">标题</label>
        <div class="relative">
          <input
            v-model="title"
            type="text"
            class="w-full border rounded px-3 py-2 pr-10"
            placeholder="请输入标题"
          />
          <button
            @click="copyText(title)"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
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
        <label class="block text-sm text-gray-600 mb-1">正文（Markdown）</label>
        <div class="relative">
          <textarea
            v-model="body"
            class="w-full h-80 border rounded px-3 py-2 pr-10 font-mono text-sm"
            placeholder="# 开始编辑..."
          ></textarea>
          <button
            @click="copyText(body)"
            class="absolute right-2 top-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="复制正文"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="text-sm text-gray-500">字数：{{ body.length }}</div>

      <!-- 操作按钮：移到正文下方 -->
      <div class="flex gap-2 pt-2 border-t">
        <button class="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors" @click="save">保存</button>
        <button class="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 transition-colors" @click="goBack">返回</button>
        <button class="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors" @click="publish">发布</button>
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
        class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
        @click="closePreview"
      >
        <div class="max-w-4xl max-h-full">
          <img :src="previewImg.url" :alt="previewImg.alt || ''" class="max-w-full max-h-[90vh] object-contain rounded" />
          <div v-if="previewImg.title || previewImg.alt" class="text-white text-center mt-2">
            {{ previewImg.title || previewImg.alt }}
          </div>
        </div>
      </div>
    </transition>

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
        class="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg"
      >
        ✓ 已复制到剪贴板
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db } from '@synccaster/core';

const loading = ref(true);
const notFound = ref(false);
const id = ref<string>('');
const title = ref('');
const body = ref('');
const images = ref<any[]>([]);
const previewImg = ref<any>(null);
const showCopyTip = ref(false);

// 复制文本到剪贴板
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showCopyTip.value = true;
    setTimeout(() => {
      showCopyTip.value = false;
    }, 2000);
  } catch (error) {
    console.error('复制失败:', error);
  }
}

// 预览图片
function previewImage(img: any) {
  previewImg.value = img;
}

// 关闭预览
function closePreview() {
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
    images.value = Array.isArray(post.assets) ? post.assets.filter((a: any) => a.type === 'image') : [];
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!id.value || id.value === 'new') {
    const now = Date.now();
    const newId = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await db.posts.add({
      id: newId,
      version: 1,
      title: title.value || '未命名标题',
      summary: (body.value || '').slice(0, 200),
      canonicalUrl: '',
      createdAt: now,
      updatedAt: now,
      body_md: body.value || '',
      tags: [],
      categories: [],
      assets: [],
      meta: {},
    } as any);
    window.location.hash = `editor/${newId}`;
    return;
  }
  await db.posts.update(id.value, {
    title: title.value,
    body_md: body.value,
    summary: (body.value || '').slice(0, 200),
    updatedAt: Date.now(),
  } as any);
  alert('已保存');
}

function goBack() {
  window.location.hash = 'posts';
}

function publish() {
  alert('发布功能尚未实现');
}

onMounted(load);
</script>
