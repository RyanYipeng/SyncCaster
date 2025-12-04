<template>
  <div>
    <div class="flex-between mb-6">
      <h2 class="text-2xl font-bold" :class="isDark ? 'text-gray-100' : 'text-gray-800'">账号管理</h2>
      <div class="flex gap-2">
        <n-button :loading="refreshingAll" :disabled="accounts.length === 0" @click="refreshAllAccounts">
          🔄 一键刷新全部
        </n-button>
        <n-button type="primary" @click="showAddDialog = true">
          ➕ 添加账号
        </n-button>
      </div>
    </div>

    <!-- 账号列表 -->
    <n-card title="已绑定账号">
      <n-empty v-if="accounts.length === 0" description="暂无绑定账号" />
      <n-list v-else>
        <n-list-item v-for="account in accounts" :key="account.id">
          <template #prefix>
            <n-avatar :src="account.avatar" :fallback-src="`https://api.dicebear.com/7.x/avataaars/svg?seed=${account.nickname}`" />
          </template>
          <n-thing :title="account.nickname">
            <template #description>
              <n-space>
                <n-tag type="info" size="small">{{ getPlatformName(account.platform) }}</n-tag>
                <n-tag v-if="account.meta?.level" type="success" size="small">
                  Lv{{ account.meta.level }}
                </n-tag>
              </n-space>
            </template>
            <template v-if="account.meta" #footer>
              <n-space size="small" class="text-xs text-gray-500">
                <span v-if="account.meta.followersCount">粉丝: {{ formatCount(account.meta.followersCount) }}</span>
                <span v-if="account.meta.articlesCount">文章: {{ formatCount(account.meta.articlesCount) }}</span>
                <span v-if="account.meta.viewsCount">阅读: {{ formatCount(account.meta.viewsCount) }}</span>
              </n-space>
            </template>
          </n-thing>
          <template #suffix>
            <n-space>
              <n-button text type="primary" @click="refreshAccount(account)">
                刷新
              </n-button>
              <n-switch v-model:value="account.enabled" @update:value="toggleAccount(account)" />
              <n-button text type="error" @click="deleteAccount(account)">
                删除
              </n-button>
            </n-space>
          </template>
        </n-list-item>
      </n-list>
    </n-card>

    <!-- 添加账号对话框 -->
    <n-modal v-model:show="showAddDialog" preset="dialog" title="添加账号">
      <n-space vertical size="large">
        <div>
          <div class="text-sm text-gray-600 mb-3">选择平台</div>
          <n-radio-group v-model:value="selectedPlatform">
            <n-space vertical>
              <n-radio v-for="platform in platforms" :key="platform.id" :value="platform.id">
                <n-space align="center">
                  <span class="text-lg">{{ platform.icon }}</span>
                  <span>{{ platform.name }}</span>
                </n-space>
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <n-alert v-if="selectedPlatform" type="info">
          <template #header>添加方式</template>
          <n-space vertical>
            <p><strong>方式一：引导登录</strong></p>
            <p class="text-sm">系统会打开 {{ getPlatformName(selectedPlatform) }} 登录页面，登录后自动获取账号信息。</p>
            <p><strong>方式二：快速添加</strong></p>
            <p class="text-sm">如果你已在浏览器中登录 {{ getPlatformName(selectedPlatform) }}，可以直接添加。</p>
          </n-space>
        </n-alert>
      </n-space>

      <template #action>
        <n-space>
          <n-button @click="showAddDialog = false">取消</n-button>
          <n-button type="info" :disabled="!selectedPlatform" :loading="addingAccount" @click="handleQuickAdd">
            快速添加（已登录）
          </n-button>
          <n-button type="primary" :disabled="!selectedPlatform" :loading="addingAccount" @click="handleGuidedAdd">
            引导登录
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { db, type Account } from '@synccaster/core';
import { useMessage } from 'naive-ui';

defineProps<{ isDark?: boolean }>();
const message = useMessage();
const accounts = ref<Account[]>([]);
const showAddDialog = ref(false);
const selectedPlatform = ref<string>('');
const addingAccount = ref(false);
const refreshingAll = ref(false);

// 监听对话框打开，重置状态
watch(showAddDialog, (newVal) => {
  if (newVal) {
    // 对话框打开时重置状态
    addingAccount.value = false;
    // 不重置 selectedPlatform，让用户可以重试同一个平台
  } else {
    // 对话框关闭时重置
    selectedPlatform.value = '';
    addingAccount.value = false;
  }
});

// 支持的平台列表（全部12个平台）
const platforms = [
  { id: 'juejin', name: '掘金', icon: '🔷' },
  { id: 'csdn', name: 'CSDN', icon: '📘' },
  { id: 'zhihu', name: '知乎', icon: '🔵' },
  { id: 'wechat', name: '微信公众号', icon: '💚' },
  { id: 'jianshu', name: '简书', icon: '📝' },
  { id: 'cnblogs', name: '博客园', icon: '🌿' },
  { id: '51cto', name: '51CTO', icon: '🔶' },
  { id: 'tencent-cloud', name: '腾讯云开发者社区', icon: '☁️' },
  { id: 'aliyun', name: '阿里云开发者社区', icon: '🧡' },
  { id: 'segmentfault', name: '思否', icon: '🟢' },
  { id: 'bilibili', name: 'B站专栏', icon: '📺' },
  { id: 'oschina', name: '开源中国', icon: '🔴' },
];

onMounted(async () => {
  await loadAccounts();
});

async function loadAccounts() {
  try {
    accounts.value = await db.accounts.toArray();
  } catch (error) {
    console.error('Failed to load accounts:', error);
    message.error('加载账号失败');
  }
}

function getPlatformName(platform: string) {
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

function formatCount(count: number): string {
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + 'w';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k';
  }
  return count.toString();
}

async function toggleAccount(account: Account) {
  try {
    await db.accounts.update(account.id, {
      enabled: account.enabled,
      updatedAt: Date.now(),
    });
    message.success(account.enabled ? '账号已启用' : '账号已禁用');
  } catch (error) {
    console.error('Failed to toggle account:', error);
    message.error('操作失败');
  }
}

async function handleQuickAdd() {
  if (!selectedPlatform.value) {
    message.warning('请先选择平台');
    return;
  }
  
  addingAccount.value = true;
  const platform = selectedPlatform.value;
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'QUICK_ADD_ACCOUNT',
      data: { platform },
    });

    if (result && result.success) {
      message.success('账号添加成功！');
      showAddDialog.value = false;
      selectedPlatform.value = '';
      await loadAccounts();
    } else {
      const errorMsg = result?.error || '添加失败，请先在该平台登录';
      message.error(errorMsg);
    }
  } catch (error: any) {
    console.error('Failed to quick add account:', error);
    message.error('添加失败: ' + (error.message || '未知错误'));
  } finally {
    addingAccount.value = false;
  }
}

async function handleGuidedAdd() {
  if (!selectedPlatform.value) {
    message.warning('请先选择平台');
    return;
  }
  
  addingAccount.value = true;
  const platform = selectedPlatform.value;
  
  // 不立即关闭对话框，让用户看到提示
  const loadingMsg = message.loading('正在打开登录页面，请完成登录...', { duration: 0 });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ADD_ACCOUNT',
      data: { platform },
    });

    loadingMsg.destroy();

    if (result && result.success) {
      message.success('账号添加成功！');
      showAddDialog.value = false;
      selectedPlatform.value = '';
      await loadAccounts();
    } else {
      const errorMsg = result?.error || '添加失败';
      message.error(errorMsg);
      // 失败时重新打开对话框
      showAddDialog.value = true;
    }
  } catch (error: any) {
    loadingMsg.destroy();
    console.error('Failed to add account:', error);
    message.error('添加失败: ' + (error.message || '未知错误'));
    // 失败时重新打开对话框
    showAddDialog.value = true;
  } finally {
    addingAccount.value = false;
  }
}

async function refreshAccount(account: Account) {
  const loadingMsg = message.loading('正在刷新账号信息...', { duration: 0 });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REFRESH_ACCOUNT',
      data: { account },
    });

    loadingMsg.destroy();

    if (result.success) {
      message.success('账号信息已更新');
      await loadAccounts();
    } else {
      message.error(result.error || '刷新失败');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    console.error('Failed to refresh account:', error);
    message.error('刷新失败: ' + error.message);
  }
}

async function refreshAllAccounts() {
  if (accounts.value.length === 0) {
    message.warning('暂无账号需要刷新');
    return;
  }
  
  refreshingAll.value = true;
  const loadingMsg = message.loading(`正在刷新 ${accounts.value.length} 个账号...`, { duration: 0 });
  
  let successCount = 0;
  let failCount = 0;
  
  try {
    for (const account of accounts.value) {
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'REFRESH_ACCOUNT',
          data: { account },
        });
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    }
    
    loadingMsg.destroy();
    
    if (failCount === 0) {
      message.success(`全部 ${successCount} 个账号刷新成功`);
    } else {
      message.warning(`刷新完成：${successCount} 成功，${failCount} 失败`);
    }
    
    await loadAccounts();
  } catch (error: any) {
    loadingMsg.destroy();
    console.error('Failed to refresh all accounts:', error);
    message.error('刷新失败: ' + error.message);
  } finally {
    refreshingAll.value = false;
  }
}

async function deleteAccount(account: Account) {
  if (!confirm(`确定要删除账号"${account.nickname}"吗？`)) {
    return;
  }

  try {
    await db.accounts.delete(account.id);
    message.success('账号已删除');
    await loadAccounts();
  } catch (error) {
    console.error('Failed to delete account:', error);
    message.error('删除失败');
  }
}
</script>
