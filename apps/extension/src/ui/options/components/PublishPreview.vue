<template>
  <div class="publish-preview">
    <!-- 预览标签页 -->
    <div class="flex border-b mb-4">
      <button
        v-for="platform in platforms"
        :key="platform.id"
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activePlatform === platform.id 
          ? 'border-b-2 border-blue-500 text-blue-600' 
          : 'text-gray-500 hover:text-gray-700'"
        @click="activePlatform = platform.id"
      >
        {{ platform.icon }} {{ platform.name }}
      </button>
    </div>

    <!-- 预览内容 -->
    <div class="preview-content bg-gray-50 rounded-lg p-4 min-h-[300px]">
      <!-- 平台特定样式提示 -->
      <div class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
        <strong>{{ currentPlatform?.name }}</strong> 预览
        <span v-if="currentPlatform?.notes" class="ml-2 text-yellow-600">
          · {{ currentPlatform.notes }}
        </span>
      </div>

      <!-- 微信公众号专用预览 -->
      <template v-if="activePlatform === 'wechat'">
        <!-- 微信预览容器 -->
        <div class="wechat-preview-container bg-white rounded-lg shadow-sm p-6 max-w-[600px] mx-auto">
          <!-- 标题 -->
          <h1 class="text-xl font-bold mb-2 text-gray-900">{{ title }}</h1>
          
          <!-- 作者信息 -->
          <div v-if="wechatAuthor" class="text-sm text-gray-500 mb-4">
            作者：{{ wechatAuthor }}
          </div>
          
          <!-- 微信格式化内容 -->
          <div 
            class="wechat-content"
            v-html="wechatPreviewHtml"
          ></div>
          
          <!-- 阅读统计 -->
          <div v-if="wechatMeta" class="mt-4 pt-4 border-t text-sm text-gray-500">
            <span v-if="wechatMeta.wordCount">字数：{{ wechatMeta.wordCount }}</span>
            <span v-if="wechatMeta.readingTime" class="ml-4">阅读时间：约 {{ wechatMeta.readingTime }} 分钟</span>
          </div>
        </div>
      </template>

      <!-- 其他平台预览 -->
      <template v-else>
        <!-- 标题预览 -->
        <h1 class="text-2xl font-bold mb-4 text-gray-900">{{ title }}</h1>

        <!-- 内容预览 -->
        <div
          class="markdown-preview"
          :class="previewClass"
          v-html="previewHtml"
        ></div>
      </template>

      <!-- 元信息预览 -->
      <div v-if="tags?.length || categories?.length" class="mt-6 pt-4 border-t">
        <div v-if="tags?.length" class="flex flex-wrap gap-2 mb-2">
          <span class="text-sm text-gray-500">标签：</span>
          <span 
            v-for="tag in tags" 
            :key="tag"
            class="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
          >
            {{ tag }}
          </span>
        </div>
        <div v-if="categories?.length" class="flex flex-wrap gap-2">
          <span class="text-sm text-gray-500">分类：</span>
          <span 
            v-for="cat in categories" 
            :key="cat"
            class="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded"
          >
            {{ cat }}
          </span>
        </div>
      </div>
    </div>

    <!-- 平台差异说明 -->
    <div class="mt-4 text-sm text-gray-500">
      <div v-if="currentPlatform?.warnings?.length" class="space-y-1">
        <div v-for="(warning, idx) in currentPlatform.warnings" :key="idx" class="flex items-start gap-2">
          <span class="text-yellow-500">⚠️</span>
          <span>{{ warning }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { mdToWechatHtmlRaw, type WechatFormatOptions } from '@synccaster/core';
import { renderMarkdownPreview } from '../utils/markdown-preview';

const props = defineProps<{
  title: string;
  content: string;
  tags?: string[];
  categories?: string[];
  selectedPlatforms: string[];
  wechatOptions?: WechatFormatOptions;
}>();

const activePlatform = ref('');

// 微信预览相关
const wechatPreviewHtml = ref('');
const wechatPreviewCss = ref('');
const wechatMeta = ref<{ wordCount?: number; readingTime?: number } | null>(null);
const wechatAuthor = computed(() => props.wechatOptions?.author || '');

// 平台配置
const platformConfigs: Record<string, {
  id: string;
  name: string;
  icon: string;
  notes?: string;
  warnings?: string[];
  previewClass?: string;
}> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    icon: '🔷',
    notes: '支持 Markdown + LaTeX',
    previewClass: 'preview-juejin',
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    icon: '🔵',
    notes: '富文本编辑器',
    warnings: ['LaTeX 公式需要去除 $ 符号'],
    previewClass: 'preview-zhihu',
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    icon: '📘',
    notes: '支持 Markdown',
    previewClass: 'preview-csdn',
  },
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    icon: '💚',
    notes: '富文本编辑器',
    warnings: ['不支持 LaTeX 公式', '图片需要上传到微信服务器'],
    previewClass: 'preview-wechat',
  },
  jianshu: {
    id: 'jianshu',
    name: '简书',
    icon: '📝',
    notes: '支持 Markdown',
    warnings: ['不支持 LaTeX 公式'],
    previewClass: 'preview-jianshu',
  },
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    icon: '🌿',
    notes: '支持 Markdown + LaTeX',
    previewClass: 'preview-cnblogs',
  },
  segmentfault: {
    id: 'segmentfault',
    name: '思否',
    icon: '🟢',
    notes: '支持 Markdown',
    warnings: ['LaTeX 语法略有不同'],
    previewClass: 'preview-segmentfault',
  },
  bilibili: {
    id: 'bilibili',
    name: 'B站专栏',
    icon: '📺',
    notes: '富文本编辑器',
    warnings: ['不支持 LaTeX 公式'],
    previewClass: 'preview-bilibili',
  },
};

// 当前选中的平台列表
const platforms = computed(() => {
  return props.selectedPlatforms
    .map(id => platformConfigs[id])
    .filter(Boolean);
});

// 当前预览的平台
const currentPlatform = computed(() => {
  return platformConfigs[activePlatform.value];
});

// 预览样式类
const previewClass = computed(() => {
  return currentPlatform.value?.previewClass || '';
});

// 预览 HTML
const previewHtml = computed(() => {
  if (!props.content) return '<p class="text-gray-400">暂无内容</p>';
  try {
    return renderMarkdownPreview(props.content);
  } catch (error) {
    return `<pre class="text-red-500">Markdown 解析失败</pre>`;
  }
});

// 初始化激活平台
watch(() => props.selectedPlatforms, (newVal) => {
  if (newVal.length > 0 && !newVal.includes(activePlatform.value)) {
    activePlatform.value = newVal[0];
  }
}, { immediate: true });

// 生成微信预览
async function generateWechatPreview() {
  if (!props.content) {
    wechatPreviewHtml.value = '<p style="color: #999;">暂无内容</p>';
    return;
  }
  
  try {
    const result = await mdToWechatHtmlRaw(props.content, props.wechatOptions || {});
    wechatPreviewHtml.value = result.html;
    wechatPreviewCss.value = result.css;
    
    // 计算字数和阅读时间
    const plainText = props.content.replace(/[#*`\[\]()!]/g, '');
    const chineseCount = (plainText.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (plainText.match(/[a-zA-Z]+/g) || []).length;
    const wordCount = chineseCount + englishWords;
    
    wechatMeta.value = {
      wordCount,
      readingTime: Math.ceil(wordCount / 400),
    };
  } catch (error) {
    console.error('微信预览生成失败:', error);
    wechatPreviewHtml.value = '<p style="color: red;">预览生成失败</p>';
  }
}

// 监听内容变化，更新微信预览
watch(
  () => [props.content, props.wechatOptions, activePlatform.value],
  () => {
    if (activePlatform.value === 'wechat') {
      generateWechatPreview();
    }
  },
  { immediate: true }
);

// 组件挂载时生成预览
onMounted(() => {
  if (activePlatform.value === 'wechat') {
    generateWechatPreview();
  }
});
</script>

<style scoped>
/* 平台特定预览样式 */
.preview-juejin {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.preview-zhihu {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  line-height: 1.8;
}

.preview-wechat {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  font-size: 15px;
  line-height: 1.75;
}

.preview-csdn {
  font-family: 'Microsoft YaHei', sans-serif;
}

/* 微信公众号预览容器 */
.wechat-preview-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: #333;
}

/* 微信内容样式 - 使用 :deep() 穿透 scoped */
.wechat-content :deep(h1) {
  display: table;
  padding: 0 1em;
  border-bottom: 2px solid #3f51b5;
  margin: 2em auto 1em;
  font-size: 1.2em;
  font-weight: bold;
  text-align: center;
}

.wechat-content :deep(h2) {
  display: table;
  padding: 0 0.2em;
  margin: 2em auto 1em;
  color: #fff;
  background: #3f51b5;
  font-size: 1.2em;
  font-weight: bold;
  text-align: center;
}

.wechat-content :deep(h3) {
  padding-left: 8px;
  border-left: 3px solid #3f51b5;
  margin: 1.5em 0 0.75em;
  font-size: 1.1em;
  font-weight: bold;
}

.wechat-content :deep(p) {
  margin: 1.5em 0;
  letter-spacing: 0.1em;
}

.wechat-content :deep(blockquote) {
  padding: 1em;
  border-left: 4px solid #3f51b5;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  margin: 1em 0;
}

.wechat-content :deep(blockquote p) {
  margin: 0;
}

.wechat-content :deep(pre) {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 0;
  margin: 1em 0;
  overflow-x: auto;
}

.wechat-content :deep(pre code) {
  display: block;
  padding: 1em;
  color: #dcdcdc;
  background: none;
}

.wechat-content :deep(code) {
  font-size: 90%;
  color: #d14;
  background: rgba(27, 31, 35, 0.05);
  padding: 3px 5px;
  border-radius: 4px;
}

.wechat-content :deep(img) {
  max-width: 100%;
  margin: 0.5em auto;
  display: block;
  border-radius: 4px;
}

.wechat-content :deep(a) {
  color: #576b95;
  text-decoration: none;
}

.wechat-content :deep(strong) {
  color: #3f51b5;
  font-weight: bold;
}

.wechat-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.wechat-content :deep(th),
.wechat-content :deep(td) {
  border: 1px solid #dfdfdf;
  padding: 0.5em;
}

.wechat-content :deep(th) {
  background: rgba(0, 0, 0, 0.05);
}

.wechat-content :deep(hr) {
  border: none;
  border-top: 2px solid rgba(0, 0, 0, 0.1);
  margin: 1.5em 0;
}

.wechat-content :deep(ul),
.wechat-content :deep(ol) {
  padding-left: 1.5em;
  margin: 1em 0;
}

.wechat-content :deep(li) {
  margin: 0.3em 0;
}
</style>
