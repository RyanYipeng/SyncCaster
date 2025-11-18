<template>
  <div>
    <div class="flex-between mb-6">
      <h2 class="text-2xl font-bold text-gray-800">文章管理</h2>
      <n-button type="primary" @click="createPost">
        ➕ 新建文章
      </n-button>
    </div>

    <n-card>
      <n-data-table
        :columns="columns"
        :data="posts"
        :loading="loading"
        :pagination="pagination"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted } from 'vue';
import { NButton, NTag } from 'naive-ui';
import { db } from '@synccaster/core';

const loading = ref(false);
const posts = ref<any[]>([]);

const columns = [
  { title: '标题', key: 'title' },
  {
    title: '状态',
    key: 'status',
    render: (row: any) => h(NTag, { type: 'info' }, () => '草稿'),
  },
  {
    title: '更新时间',
    key: 'updatedAt',
    render: (row: any) => {
      const s = new Date(row.updatedAt).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      return h('span', { style: 'white-space:nowrap' }, s);
    },
  },
  {
    title: '操作',
    key: 'actions',
    render: (row: any) => h(
      'div',
      { class: 'flex gap-2' },
      [
        h(NButton, { size: 'small', onClick: () => editPost(row.id) }, () => '编辑'),
        h(NButton, { size: 'small', onClick: () => publishPost(row.id) }, () => '发布'),
        h(NButton, { size: 'small', type: 'error', onClick: () => deletePost(row.id) }, () => '删除'),
      ]
    ),
  },
];

const pagination = {
  pageSize: 10,
};

onMounted(async () => {
  await loadPosts();
});

async function loadPosts() {
  loading.value = true;
  try {
    const data = await db.posts.orderBy('updatedAt').reverse().toArray();
    posts.value = data;
  } catch (error) {
    console.error('Failed to load posts:', error);
  } finally {
    loading.value = false;
  }
}

function createPost() {
  window.location.hash = 'editor/new';
}

function editPost(id: string) {
  window.location.hash = `editor/${id}`;
}

function publishPost(id: string) {
  // 暂未实现发布，先跳转到编辑器
  window.location.hash = `editor/${id}`;
}

async function deletePost(id: string) {
  if (confirm('确认删除这篇文章吗？')) {
    await db.posts.delete(id);
    await loadPosts();
  }
}
</script>
