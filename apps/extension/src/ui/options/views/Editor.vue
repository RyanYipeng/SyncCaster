<template>
  <div class="editor-page">
    <!-- 顶部工具栏 -->
    <div class="editor-toolbar">
      <h2 class="editor-title" :class="isDark ? 'text-gray-100' : 'text-gray-800'">编辑文章</h2>
      <div class="toolbar-actions">
        <button class="btn btn-primary" @click="save">保存</button>
        <button class="btn btn-secondary" @click="goBack">返回</button>
        <button class="btn btn-success" @click="publish">发布</button>
        <button class="btn btn-purple" @click="openMdEditor" title="在新标签页中打开完整的公众号编辑器">
          🚀 打开公众号编辑器
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-gray-500 p-4">加载中...</div>
    <div v-else-if="notFound" class="text-red-500 p-4">未找到文章</div>

    <div v-else class="editor-content">
      <!-- 采集来源链接 -->
      <div v-if="sourceUrl" class="source-link">
        <span class="source-icon">📥</span>
        <span class="source-label">采集来源：</span>
        <a :href="sourceUrl" target="_blank" rel="noopener noreferrer" class="source-url" :title="sourceUrl">{{ sourceUrl }}</a>
      </div>

      <!-- 标题输入区 -->
      <div class="title-section">
        <div class="title-input-wrapper">
          <input v-model="title" type="text" class="title-input" :class="isDark ? 'dark' : ''" placeholder="请输入文章标题..." />
          <button @click="copyText(title, '标题')" class="copy-btn" title="复制标题">
            <svg xmlns="http://www.w3.org/2000/svg" class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
        <span class="char-count">字数：{{ body.length }}</span>
      </div>

      <!-- 编辑器主体：左右分栏 -->
      <div class="editor-main" :style="{ height: editorHeight + 'px' }">
        <!-- 左侧：Markdown 编辑器 -->
        <div class="editor-pane" :class="isDark ? 'dark' : ''" :style="{ width: leftPaneWidth + '%' }">
          <div class="pane-header">
            <span class="pane-label">Markdown 编辑</span>
            <button @click="copyText(body, '正文')" class="copy-link">复制源码</button>
          </div>
          <div class="pane-body">
            <textarea ref="editorRef" v-model="body" class="editor-textarea" :class="isDark ? 'dark' : ''" placeholder="# 开始编辑你的 Markdown 内容..." @scroll="handleEditorScroll"></textarea>
          </div>
        </div>

        <!-- 中间分割线 - 可拖拽调整宽度 -->
        <div class="divider" :class="[isDark ? 'dark' : '', { dragging: isResizingWidth }]" @mousedown="startResizeWidth"></div>

        <!-- 右侧：实时预览区 -->
        <div class="preview-pane" :class="isDark ? 'dark' : ''" :style="{ width: (100 - leftPaneWidth) + '%' }">
          <div class="pane-header">
            <span class="pane-label">实时预览</span>
            <button @click="copyPreview" class="copy-link">复制预览</button>
          </div>
          <div class="pane-body" ref="previewRef" @scroll="handlePreviewScroll">
            <div class="markdown-preview" :class="isDark ? 'dark' : ''" v-html="previewHtml"></div>
          </div>
        </div>
      </div>

      <!-- 底部拖拽条 - 调整高度 -->
      <div class="height-resizer" :class="{ dragging: isResizingHeight }" @mousedown="startResizeHeight">
        <div class="resizer-handle"></div>
      </div>

      <!-- 图片资源 -->
      <div v-if="images.length" class="images-section">
        <div class="images-header">图片资源（{{ images.length }}）</div>
        <div class="images-list">
          <div v-for="img in images" :key="img.id" class="image-item" @click="previewImage(img)">
            <img :src="img.url" :alt="img.alt || ''" />
          </div>
        </div>
      </div>
    </div>

    <!-- 图片预览模态框 -->
    <Teleport to="body">
      <div v-if="previewImg" class="modal-overlay" @click="closeImagePreview">
        <div class="image-preview-modal">
          <img :src="previewImg.url" :alt="previewImg.alt || ''" />
          <div v-if="previewImg.title || previewImg.alt" class="image-caption">{{ previewImg.title || previewImg.alt }}</div>
        </div>
      </div>
    </Teleport>

    <!-- Toast 提示 -->
    <div v-if="showCopyTip" class="toast toast-success">✓ {{ copyTipMessage }}</div>
    <div v-if="showValidationTip" class="toast toast-warning">⚠️ {{ validationTipMessage }}</div>

    <!-- 发布对话框 -->
    <Teleport to="body">
      <div v-if="showPublishDialog" class="modal-overlay" @click.self="closePublishDialog">
        <div class="publish-dialog" @click.stop>
          <div class="dialog-header">
            <h3>发布文章</h3>
            <button @click="closePublishDialog" class="close-btn">×</button>
          </div>
          <div class="dialog-body">
            <div class="article-info">
              <div class="info-label">文章标题</div>
              <div class="info-value">{{ title || '未命名' }}</div>
              <div class="info-meta">字数：{{ body.length }}</div>
            </div>
            <div class="platform-section">
              <div class="platform-header">
                <span>选择发布平台</span>
                <button @click="toggleSelectAll" class="select-all-btn">{{ allSelected ? '取消全选' : '全选' }}</button>
              </div>
              <div v-if="enabledAccounts.length > 0" class="account-list">
                <div v-for="account in enabledAccounts" :key="account.id" class="account-item" :class="{ selected: selectedAccounts.includes(account.id), disabled: isAccountDisabled(account) }" @click="!isAccountDisabled(account) && toggleAccount(account.id)">
                  <input type="checkbox" :checked="selectedAccounts.includes(account.id)" :disabled="isAccountDisabled(account)" />
                  <img v-if="account.avatar" :src="account.avatar" :alt="account.nickname" class="avatar" />
                  <div class="account-info">
                    <div class="nickname">{{ account.nickname }}</div>
                    <div class="platform">
                      {{ getPlatformName(account.platform) }}
                      <span v-if="account.status === 'expired'" class="status-tag expired">已失效</span>
                      <span v-else-if="account.status === 'error'" class="status-tag error">检测异常</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="no-accounts">
                <div>📭</div>
                <div>暂无已登录的账号</div>
                <button @click="goToAccounts">前往添加账号 →</button>
              </div>
            </div>
          </div>
          <div class="dialog-footer">
            <button @click="confirmPublish" class="publish-btn" :disabled="selectedAccounts.length === 0 || publishing">
              {{ publishing ? '发布中...' : `发布到 ${selectedAccounts.length} 个平台` }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 未保存修改确认弹窗 -->
    <Teleport to="body">
      <div v-if="showUnsavedDialog" class="modal-overlay" @click.self="handleCancelLeave">
        <div class="unsaved-dialog" @click.stop @keydown.enter="handleSaveAndLeave" @keydown.escape="handleCancelLeave">
          <div class="unsaved-dialog-icon">📝</div>
          <div class="unsaved-dialog-title">文章尚未保存</div>
          <div class="unsaved-dialog-message">是否保存当前修改？</div>
          <div class="unsaved-dialog-actions">
            <button class="unsaved-btn unsaved-btn-primary" @click="handleSaveAndLeave" autofocus>是（保存）</button>
            <button class="unsaved-btn unsaved-btn-secondary" @click="handleDiscardAndLeave">否（不保存）</button>
            <button class="unsaved-btn unsaved-btn-cancel" @click="handleCancelLeave">取消</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>


<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useMessage } from 'naive-ui';
import { db, type Account, ChromeStorageBridge, type SyncCasterArticle, AccountStatus } from '@synccaster/core';
import { renderMarkdownPreview, processMermaidInContainer } from '../utils/markdown-preview';
import '../markdown-preview.css';

defineProps<{ isDark?: boolean }>();

const message = useMessage();

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
const publishing = ref(false);
const enabledAccounts = ref<Account[]>([]);
const selectedAccounts = ref<string[]>([]);

const editorRef = ref<HTMLTextAreaElement | null>(null);
const previewRef = ref<HTMLDivElement | null>(null);

// 未保存修改状态追踪
const savedTitle = ref('');
const savedBody = ref('');
const hasUnsavedChanges = computed(() => title.value !== savedTitle.value || body.value !== savedBody.value);

// 保存确认弹窗
const showUnsavedDialog = ref(false);
const pendingNavigation = ref<string | null>(null);

// 可调整的尺寸
const editorHeight = ref(420);
const leftPaneWidth = ref(50);
const isResizingHeight = ref(false);
const isResizingWidth = ref(false);

// 尺寸记忆 - 存储键
const STORAGE_KEY_HEIGHT = 'synccaster_editor_height';
const STORAGE_KEY_WIDTH = 'synccaster_editor_width';

// 加载保存的尺寸
function loadSavedDimensions() {
  try {
    const savedHeight = localStorage.getItem(STORAGE_KEY_HEIGHT);
    const savedWidth = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (savedHeight) {
      const h = parseInt(savedHeight, 10);
      if (!isNaN(h) && h >= 200 && h <= 700) {
        editorHeight.value = h;
      }
    }
    if (savedWidth) {
      const w = parseFloat(savedWidth);
      if (!isNaN(w) && w >= 25 && w <= 75) {
        leftPaneWidth.value = w;
      }
    }
  } catch {}
}

// 保存尺寸到 localStorage
function saveDimensions() {
  try {
    localStorage.setItem(STORAGE_KEY_HEIGHT, String(editorHeight.value));
    localStorage.setItem(STORAGE_KEY_WIDTH, String(leftPaneWidth.value));
  } catch {}
}

// 高度拖拽
function startResizeHeight(e: MouseEvent) {
  e.preventDefault();
  isResizingHeight.value = true;
  const startY = e.clientY;
  const startHeight = editorHeight.value;
  
  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientY - startY;
    editorHeight.value = Math.max(200, Math.min(700, startHeight + delta));
  };
  
  const onUp = () => {
    isResizingHeight.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // 保存尺寸
    saveDimensions();
  };
  
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// 宽度拖拽
function startResizeWidth(e: MouseEvent) {
  e.preventDefault();
  isResizingWidth.value = true;
  const startX = e.clientX;
  const startWidth = leftPaneWidth.value;
  const container = (e.target as HTMLElement).parentElement;
  const containerWidth = container?.offsetWidth || 800;
  
  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX;
    const deltaPercent = (delta / containerWidth) * 100;
    leftPaneWidth.value = Math.max(25, Math.min(75, startWidth + deltaPercent));
  };
  
  const onUp = () => {
    isResizingWidth.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // 保存尺寸
    saveDimensions();
  };
  
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// 滚动同步
let syncSource: 'editor' | 'preview' | null = null;
let rafId: number | null = null;

function handleEditorScroll() {
  if (syncSource === 'preview') return;
  syncSource = 'editor';
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const editor = editorRef.value;
    const preview = previewRef.value;
    if (!editor || !preview) return;
    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = preview.scrollHeight - preview.clientHeight;
    if (editorMax <= 0 || previewMax <= 0) return;
    preview.scrollTop = (editor.scrollTop / editorMax) * previewMax;
    setTimeout(() => { syncSource = null; }, 50);
  });
}

function handlePreviewScroll() {
  if (syncSource === 'editor') return;
  syncSource = 'preview';
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const editor = editorRef.value;
    const preview = previewRef.value;
    if (!editor || !preview) return;
    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = preview.scrollHeight - preview.clientHeight;
    if (editorMax <= 0 || previewMax <= 0) return;
    editor.scrollTop = (preview.scrollTop / previewMax) * editorMax;
    setTimeout(() => { syncSource = null; }, 50);
  });
}

function isAccountDisabled(account: Account): boolean {
  return account.status === AccountStatus.EXPIRED || account.status === AccountStatus.ERROR;
}

const availableAccounts = computed(() => enabledAccounts.value.filter(a => !isAccountDisabled(a)));
const allSelected = computed(() => {
  const available = availableAccounts.value;
  return available.length > 0 && available.every(a => selectedAccounts.value.includes(a.id));
});

const previewHtml = computed(() => {
  if (!body.value) return '<p class="empty-hint">暂无内容</p>';
  try { return renderMarkdownPreview(body.value); }
  catch { return '<pre class="error-hint">Markdown 解析失败</pre>'; }
});

// 监听预览内容变化，处理 Mermaid 图表渲染
watch(previewHtml, async () => {
  await nextTick();
  const container = previewRef.value?.querySelector('.markdown-preview');
  if (container) {
    try {
      await processMermaidInContainer(container as HTMLElement);
    } catch {
      // Mermaid 渲染失败，静默处理
    }
  }
});

function showCopySuccess(msg: string = '已复制到剪贴板') {
  copyTipMessage.value = msg;
  showCopyTip.value = true;
  setTimeout(() => { showCopyTip.value = false; }, 1000);
}

function copyWithExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyPlainText(text: string): Promise<boolean> {
  const v = String(text ?? '');
  if (!v) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(v);
      return true;
    }
  } catch {}
  return copyWithExecCommand(v);
}

async function copyText(text: string, label: string = '内容') {
  const ok = await copyPlainText(text);
  if (ok) showCopySuccess(`已复制${label}`);
  else showValidationError('复制失败：请检查浏览器剪贴板权限');
}

function stripHtmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.innerText || div.textContent || '').trim();
}

async function copyPreview() {
  const container = previewRef.value?.querySelector('.markdown-preview') as HTMLElement | null;
  const bodyHtml = container?.innerHTML ?? (previewHtml.value || '');
  const plain = stripHtmlToText(bodyHtml);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('clipboard_write_unavailable');
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([bodyHtml], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    showCopySuccess('已复制预览内容');
  } catch {
    const ok = await copyPlainText(plain);
    if (ok) showCopySuccess('已复制预览内容');
    else showValidationError('复制失败：请检查浏览器剪贴板权限');
  }
}

function previewImage(img: any) { previewImg.value = img; }
function closeImagePreview() { previewImg.value = null; }

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
      savedTitle.value = '';
      savedBody.value = '';
      loading.value = false; 
      return; 
    }
    const post = await db.posts.get(pid);
    if (!post) { notFound.value = true; return; }
    title.value = post.title || '';
    body.value = post.body_md || '';
    sourceUrl.value = post.url || post.canonicalUrl || '';
    images.value = Array.isArray(post.assets) ? post.assets.filter((a: any) => a.type === 'image') : [];
    // 记录保存状态
    savedTitle.value = title.value;
    savedBody.value = body.value;
  } finally { loading.value = false; }
}

const showValidationTip = ref(false);
const validationTipMessage = ref('');

function showValidationError(msg: string) {
  validationTipMessage.value = msg;
  showValidationTip.value = true;
  setTimeout(() => { showValidationTip.value = false; }, 1500);
}

async function save() {
  if (!title.value.trim()) { showValidationError('请输入文章标题'); return false; }
  if (!body.value.trim()) { showValidationError('请输入文章正文'); return false; }
  if (!id.value || id.value === 'new') {
    const now = Date.now();
    const newId = crypto.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await db.posts.add({ id: newId, version: 1, title: title.value, summary: body.value.slice(0, 200), canonicalUrl: '', createdAt: now, updatedAt: now, body_md: body.value, tags: [], categories: [], assets: [], meta: {} } as any);
    // 更新当前文章 ID，避免重复创建
    id.value = newId;
    window.location.hash = `editor/${newId}`;
    savedTitle.value = title.value;
    savedBody.value = body.value;
    showCopySuccess('文章已保存');
    return true;
  }
  await db.posts.update(id.value, { title: title.value, body_md: body.value, summary: body.value.slice(0, 200), updatedAt: Date.now() } as any);
  savedTitle.value = title.value;
  savedBody.value = body.value;
  showCopySuccess('文章已保存');
  return true;
}

function goBack() {
  if (hasUnsavedChanges.value) {
    pendingNavigation.value = 'posts';
    showUnsavedDialog.value = true;
  } else {
    window.location.hash = 'posts';
  }
}

// 未保存确认弹窗操作
async function handleSaveAndLeave() {
  const success = await save();
  if (success && pendingNavigation.value) {
    showUnsavedDialog.value = false;
    window.location.hash = pendingNavigation.value;
    pendingNavigation.value = null;
  }
}

function handleDiscardAndLeave() {
  showUnsavedDialog.value = false;
  if (pendingNavigation.value) {
    window.location.hash = pendingNavigation.value;
    pendingNavigation.value = null;
  }
}

function handleCancelLeave() {
  showUnsavedDialog.value = false;
  pendingNavigation.value = null;
}

// 浏览器关闭/刷新提示
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (hasUnsavedChanges.value) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
}

async function loadEnabledAccounts() {
  try { const all = await db.accounts.toArray(); enabledAccounts.value = all.filter(a => a.enabled === true); }
  catch { enabledAccounts.value = []; }
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = { wechat: '微信公众号', zhihu: '知乎', juejin: '掘金', csdn: 'CSDN', jianshu: '简书', cnblogs: '博客园', '51cto': '51CTO', 'tencent-cloud': '腾讯云', aliyun: '阿里云', segmentfault: '思否', bilibili: 'B站专栏', oschina: '开源中国' };
  return names[platform] || platform;
}

function toggleAccount(accountId: string) {
  const idx = selectedAccounts.value.indexOf(accountId);
  if (idx > -1) selectedAccounts.value.splice(idx, 1);
  else selectedAccounts.value.push(accountId);
}

function toggleSelectAll() {
  const available = availableAccounts.value;
  if (allSelected.value) { selectedAccounts.value = selectedAccounts.value.filter(id => !available.some(a => a.id === id)); }
  else { const ids = new Set(selectedAccounts.value); available.forEach(a => ids.add(a.id)); selectedAccounts.value = Array.from(ids); }
}

async function publish() {
  if (!id.value || id.value === 'new') { await save(); if (!id.value || id.value === 'new') return; }
  await loadEnabledAccounts();
  selectedAccounts.value = [];
  showPublishDialog.value = true;
}

function closePublishDialog() { showPublishDialog.value = false; selectedAccounts.value = []; }
function goToAccounts() { window.location.hash = 'accounts'; }

async function openMdEditor() {
  if (!id.value || id.value === 'new') { await save(); if (!id.value || id.value === 'new') { alert('请先保存文章'); return; } }
  try {
    await ChromeStorageBridge.saveArticle({ id: id.value, title: title.value || '未命名标题', content: body.value || '', sourceUrl: sourceUrl.value || undefined, updatedAt: Date.now() });
    chrome.tabs.create({ url: chrome.runtime.getURL('md-editor/md-editor.html') });
  } catch (e: any) { alert('打开公众号编辑器失败: ' + (e?.message || '未知错误')); }
}

async function confirmPublish() {
  if (selectedAccounts.value.length === 0) { alert('请选择至少一个发布平台'); return; }
  publishing.value = true;
  try {
    const post = await db.posts.get(id.value);
    if (!post) throw new Error('文章不存在');
    const targets = selectedAccounts.value.map(accountId => {
      const account = enabledAccounts.value.find(a => a.id === accountId);
      return { platform: account!.platform, accountId, config: {} };
    });
    const platformName = (p: string) => ({ juejin: '掘金', csdn: 'CSDN', zhihu: '知乎', wechat: '微信公众号', jianshu: '简书', cnblogs: '博客园', '51cto': '51CTO', 'tencent-cloud': '腾讯云', aliyun: '阿里云', segmentfault: 'SegmentFault', bilibili: 'B站专栏', oschina: '开源中国' } as Record<string, string>)[p] || p;
    const platformListText = Array.from(new Set(targets.map(t => t.platform))).map(platformName).join('、');
    
    // 检查是否包含微信公众号
    const hasWechat = targets.some(t => t.platform === 'wechat');
    if (hasWechat) {
      // 微信公众号发布：内容会自动通过内置排版逻辑转换，并使用官方 API 填充到编辑器
      // 保存文章到 Chrome Storage，供 md-editor 读取（如果用户需要手动调整排版）
      await ChromeStorageBridge.saveArticle({ 
        id: id.value, 
        title: title.value || '未命名标题', 
        content: body.value || '', 
        sourceUrl: sourceUrl.value || undefined, 
        updatedAt: Date.now() 
      });
      message.info('微信公众号：内容将自动转换为公众号格式并填充到编辑器', { duration: 3000 });
    }
    
    const jobId = crypto.randomUUID();
    const now = Date.now();
    await db.jobs.add({ id: jobId, postId: id.value, targets, state: 'PENDING', progress: 0, attempts: 0, maxAttempts: 3, logs: [{ id: crypto.randomUUID(), level: 'info', step: 'create', message: `创建发布任务，目标平台：${platformListText}`, timestamp: now }], createdAt: now, updatedAt: now });
    chrome.runtime.sendMessage({ type: 'START_PUBLISH_JOB', data: { jobId } });
    closePublishDialog();
    message.success(`发布任务已创建：${platformListText}`, { duration: 1000 });
  } catch (e: any) { message.error('发布失败: ' + (e?.message || '未知错误'), { duration: 3000 }); }
  finally { publishing.value = false; }
}

async function syncFromStorage() {
  if (!id.value || id.value === 'new') return;
  try {
    const article = await ChromeStorageBridge.loadArticle();
    if (article && article.id === id.value && (article.content !== body.value || article.title !== title.value)) {
      title.value = article.title;
      body.value = article.content;
    }
  } catch {}
}

function handleVisibilityChange() { if (document.visibilityState === 'visible') syncFromStorage(); }

let unsubscribeStorageChange: (() => void) | null = null;

function setupStorageListener() {
  try {
    unsubscribeStorageChange = ChromeStorageBridge.onArticleChange((article) => {
      if (article && article.id === id.value && (article.content !== body.value || article.title !== title.value)) {
        title.value = article.title;
        body.value = article.content;
      }
    });
  } catch {}
}

onMounted(() => { loadSavedDimensions(); load(); document.addEventListener('visibilitychange', handleVisibilityChange); window.addEventListener('beforeunload', handleBeforeUnload); setupStorageListener(); });
onUnmounted(() => { document.removeEventListener('visibilitychange', handleVisibilityChange); window.removeEventListener('beforeunload', handleBeforeUnload); if (unsubscribeStorageChange) unsubscribeStorageChange(); if (rafId) cancelAnimationFrame(rafId); });
</script>


<style scoped>
.editor-page { display: flex; flex-direction: column; height: auto; max-height: 100%; overflow-y: auto; }

.editor-toolbar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; margin-bottom: 10px; flex-shrink: 0; }
.editor-title { font-size: 1.15rem; font-weight: 700; margin: 0; }
.toolbar-actions { display: flex; gap: 8px; }
.btn { padding: 5px 12px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; outline: none; }
.btn-primary { background: #3b82f6; color: white; }
.btn-primary:hover { background: #2563eb; }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; }
.btn-success { background: #10b981; color: white; }
.btn-success:hover { background: #059669; }
.btn-purple { background: #8b5cf6; color: white; }
.btn-purple:hover { background: #7c3aed; }

.editor-content { display: flex; flex-direction: column; gap: 0; overflow-y: auto; }

.source-link { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 12px; margin-bottom: 10px; flex-shrink: 0; }
.source-icon, .source-label { color: #3b82f6; }
.source-url { color: #2563eb; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-url:hover { text-decoration: underline; }

.title-section { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-shrink: 0; }
.title-input-wrapper { position: relative; flex: 1; max-width: 600px; }
.title-input { width: 100%; padding: 8px 36px 8px 12px; font-size: 14px; border: 1px solid #d1d5db; border-radius: 6px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; background: white; }
.title-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }
.title-input.dark { background: #1f2937; border-color: #4b5563; color: #f3f4f6; }
.title-input.dark:focus { border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2); }
.copy-btn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); padding: 4px; background: transparent; border: none; cursor: pointer; color: #9ca3af; border-radius: 4px; transition: all 0.2s; }
.copy-btn:hover { background: #f3f4f6; color: #6b7280; }
.copy-btn .icon { width: 14px; height: 14px; }
.char-count { font-size: 12px; color: #9ca3af; white-space: nowrap; }

.editor-main { display: flex; gap: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #f9fafb; flex-shrink: 0; }

.editor-pane { display: flex; flex-direction: column; min-width: 0; background: #fafbfc; }
.editor-pane.dark { background: #111827; }
.preview-pane { display: flex; flex-direction: column; min-width: 0; background: #ffffff; }
.preview-pane.dark { background: #1f2937; }

.pane-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; background: inherit; flex-shrink: 0; }
.editor-pane.dark .pane-header, .preview-pane.dark .pane-header { border-bottom-color: #374151; }
.pane-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
.copy-link { font-size: 11px; color: #3b82f6; background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.2s; }
.copy-link:hover { background: rgba(59, 130, 246, 0.1); }

.pane-body { flex: 1; overflow: hidden; min-height: 0; position: relative; }
.editor-textarea { width: 100%; height: 100%; padding: 12px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; border: none; outline: none; resize: none; background: transparent; color: #1f2937; overflow-y: auto; box-sizing: border-box; }
.editor-textarea.dark { color: #e5e7eb; }
.editor-textarea::placeholder { color: #9ca3af; }

/* 预览区域滚动 */
.preview-pane .pane-body { overflow-y: auto; }

/* 分割线 - 可拖拽 */
.divider { width: 6px; background: #e5e7eb; flex-shrink: 0; cursor: col-resize; position: relative; transition: background 0.2s; }
.divider:hover, .divider.dragging { background: #3b82f6; }
.divider.dark { background: #374151; }
.divider.dark:hover, .divider.dark.dragging { background: #60a5fa; }

/* 高度调整条 */
.height-resizer { height: 8px; background: transparent; cursor: row-resize; display: flex; align-items: center; justify-content: center; margin: 4px 0; flex-shrink: 0; }
.height-resizer:hover, .height-resizer.dragging { background: rgba(59, 130, 246, 0.1); }
.resizer-handle { width: 60px; height: 4px; background: #d1d5db; border-radius: 2px; transition: background 0.2s; }
.height-resizer:hover .resizer-handle, .height-resizer.dragging .resizer-handle { background: #3b82f6; }

.markdown-preview { padding: 12px; font-size: 14px; line-height: 1.75; color: #1f2937; }
.markdown-preview.dark { color: #e5e7eb; }
.markdown-preview .empty-hint { color: #9ca3af; font-style: italic; }
.markdown-preview .error-hint { color: #ef4444; }

.images-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; flex-shrink: 0; }
.images-header { font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 6px; }
.images-list { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.image-item { flex-shrink: 0; width: 72px; height: 54px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; cursor: pointer; transition: box-shadow 0.2s; }
.image-item:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.image-item img { width: 100%; height: 100%; object-fit: cover; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px; }
.image-preview-modal img { max-width: 90vw; max-height: 85vh; border-radius: 8px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4); }
.image-caption { text-align: center; color: white; margin-top: 12px; font-size: 14px; }

.toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 999px; font-size: 12px; z-index: 10000; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18); pointer-events: none; animation: toastFade 1s ease-out forwards; }
.toast-success { background: #10b981; color: white; }
.toast-warning { top: 44px; background: #f59e0b; color: white; }

@keyframes toastFade {
  0% { opacity: 0; transform: translate(-50%, -6px); }
  10% { opacity: 0.98; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -8px); }
}

.publish-dialog { background: white; border-radius: 16px; width: 100%; max-width: 580px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.dialog-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
.close-btn { width: 24px; height: 24px; border: none; background: #f3f4f6; border-radius: 6px; font-size: 14px; cursor: pointer; color: #6b7280; transition: all 0.2s; }
.close-btn:hover { background: #e5e7eb; color: #374151; }
.dialog-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.article-info { background: #f9fafb; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
.info-label { font-size: 10px; color: #6b7280; margin-bottom: 3px; }
.info-value { font-size: 13px; font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info-meta { font-size: 10px; color: #9ca3af; margin-top: 4px; }
.platform-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.platform-header span { font-size: 12px; font-weight: 600; color: #374151; }
.select-all-btn { font-size: 11px; color: #3b82f6; background: none; border: none; cursor: pointer; }
.account-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.account-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
.account-item:hover { background: #f9fafb; border-color: #d1d5db; }
.account-item.selected { border-color: #3b82f6; background: #eff6ff; }
.account-item.disabled { opacity: 0.5; cursor: not-allowed; }
.account-item input[type="checkbox"] { width: 12px; height: 12px; accent-color: #3b82f6; flex-shrink: 0; }
.account-item .avatar { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
.account-info { flex: 1; min-width: 0; overflow: hidden; }
.nickname { font-size: 11px; font-weight: 500; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.platform { font-size: 10px; color: #6b7280; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.status-tag { font-size: 9px; padding: 1px 4px; border-radius: 3px; }
.status-tag.expired { background: #fee2e2; color: #dc2626; }
.status-tag.error { background: #fef3c7; color: #d97706; }
.no-accounts { text-align: center; padding: 20px; color: #6b7280; grid-column: span 2; }
.no-accounts div:first-child { font-size: 24px; margin-bottom: 6px; }
.no-accounts button { margin-top: 8px; color: #3b82f6; background: none; border: none; cursor: pointer; font-size: 11px; }
.dialog-footer { padding: 12px 14px; border-top: 1px solid #e5e7eb; }
.publish-btn { width: 100%; padding: 8px; font-size: 12px; font-weight: 600; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
.publish-btn:hover:not(:disabled) { background: #059669; }
.publish-btn:disabled { background: #d1d5db; cursor: not-allowed; }

/* 暗色模式 */
.markdown-preview.dark blockquote { background: #374151; border-left-color: #4b5563; color: #d1d5db; }
.markdown-preview.dark :not(pre) > code { background: #374151; border-color: #4b5563; }
.markdown-preview.dark pre.md-code-block { background: #1f2937 !important; border-color: #374151; }
.markdown-preview.dark .md-table-wrap { border-color: #374151; background: #1f2937; }
.markdown-preview.dark thead th { background: #374151; }
.markdown-preview.dark th, .markdown-preview.dark td { border-bottom-color: #374151; }

/* 滚动条统一样式 */
.pane-body::-webkit-scrollbar, .editor-textarea::-webkit-scrollbar { width: 6px; height: 6px; }
.pane-body::-webkit-scrollbar-track, .editor-textarea::-webkit-scrollbar-track { background: transparent; border-radius: 3px; }
.pane-body::-webkit-scrollbar-thumb, .editor-textarea::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; min-height: 30px; }
.pane-body::-webkit-scrollbar-thumb:hover, .editor-textarea::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
.editor-pane.dark .editor-textarea::-webkit-scrollbar-thumb { background: #4b5563; }
.editor-pane.dark .editor-textarea::-webkit-scrollbar-thumb:hover { background: #6b7280; }
.preview-pane.dark .pane-body::-webkit-scrollbar-thumb { background: #4b5563; }
.preview-pane.dark .pane-body::-webkit-scrollbar-thumb:hover { background: #6b7280; }

/* 未保存确认弹窗 */
.unsaved-dialog { background: white; border-radius: 12px; padding: 24px; width: 100%; max-width: 320px; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2); }
.unsaved-dialog-icon { font-size: 36px; margin-bottom: 12px; }
.unsaved-dialog-title { font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 8px; }
.unsaved-dialog-message { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
.unsaved-dialog-actions { display: flex; flex-direction: column; gap: 8px; }
.unsaved-btn { padding: 10px 16px; font-size: 13px; font-weight: 500; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; outline: none; }
.unsaved-btn:focus { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); }
.unsaved-btn-primary { background: #3b82f6; color: white; }
.unsaved-btn-primary:hover { background: #2563eb; }
.unsaved-btn-secondary { background: #f3f4f6; color: #374151; }
.unsaved-btn-secondary:hover { background: #e5e7eb; }
.unsaved-btn-cancel { background: transparent; color: #9ca3af; }
.unsaved-btn-cancel:hover { color: #6b7280; background: #f9fafb; }
</style>
