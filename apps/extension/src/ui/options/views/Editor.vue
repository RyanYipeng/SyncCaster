<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-800 mb-4">编辑文章</h2>

    <div v-if="loading" class="text-gray-500">加载中...</div>
    <div v-else-if="notFound" class="text-red-500">未找到文章</div>

    <div v-else class="space-y-4">
      <div>
        <label class="block text-sm text-gray-600 mb-1">标题</label>
        <input
          v-model="title"
          type="text"
          class="w-full border rounded px-3 py-2"
          placeholder="请输入标题"
        />
      </div>

      <div>
        <label class="block text-sm text-gray-600 mb-1">正文（Markdown）</label>
        <textarea
          v-model="body"
          class="w-full h-80 border rounded px-3 py-2 font-mono text-sm"
          placeholder="# 开始编辑..."
        ></textarea>
      </div>

      <div class="text-sm text-gray-500">字数：{{ body.length }}</div>

    <div v-if="images.length" class="mt-4">
      <div class="text-sm text-gray-600 mb-2">图片资源（{{ images.length }}）</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="img in images" :key="img.id" class="border rounded p-2 bg-white">
          <img :src="img.url" :alt="img.alt || ''" class="w-full h-28 object-cover rounded" />
          <div class="mt-1 text-xs text-gray-500 truncate">{{ img.title || img.alt || img.url }}</div>
        </div>
      </div>
    </div>

      <div class="flex gap-2">
        <button class="px-4 py-2 rounded bg-blue-600 text-white" @click="save">保存</button>
        <button class="px-4 py-2 rounded bg-gray-200" @click="goBack">返回</button>
        <button class="px-4 py-2 rounded bg-green-600 text-white" @click="publish">发布</button>
      </div>
    </div>
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
