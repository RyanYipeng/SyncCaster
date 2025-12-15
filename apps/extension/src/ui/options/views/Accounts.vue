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
            <!-- 7.2: Add warning badge on avatar for expired accounts -->
            <n-badge :show="account.status === 'expired'" dot type="error" :offset="[-2, 2]">
              <n-avatar :src="account.avatar" :fallback-src="`https://api.dicebear.com/7.x/avataaars/svg?seed=${account.nickname}`" />
            </n-badge>
          </template>
          <n-thing>
            <template #header>
              <span 
                class="cursor-pointer hover:text-blue-500 hover:underline transition-colors"
                @click="goToUserProfile(account)"
                :title="`点击访问 ${account.nickname} 的主页`"
              >
                {{ account.nickname }}
              </span>
            </template>
            <template #description>
              <n-space>
                <n-tag 
                  type="info" 
                  size="small" 
                  class="cursor-pointer hover:opacity-80"
                  @click="goToUserProfile(account)"
                  :title="`点击访问 ${getPlatformName(account.platform)}`"
                >
                  {{ getPlatformName(account.platform) }}
                </n-tag>
                <n-tag v-if="account.meta?.level" type="success" size="small">
                  Lv{{ account.meta.level }}
                </n-tag>
                <!-- 7.1: Status tag display logic -->
                <n-tooltip v-if="account.status === 'expired'" trigger="hover">
                  <template #trigger>
                    <n-tag type="error" size="small">已失效</n-tag>
                  </template>
                  {{ account.lastError || '账号登录已失效，请重新登录' }}
                </n-tooltip>
                <n-tooltip v-else-if="account.status === 'error'" trigger="hover">
                  <template #trigger>
                    <n-tag type="warning" size="small">检测异常</n-tag>
                  </template>
                  {{ account.lastError || '检测异常，可能是临时问题' }}
                </n-tooltip>
                <n-spin v-else-if="account.status === 'checking'" :size="12" />
              </n-space>
            </template>
            <template #footer>
              <n-space vertical size="small">
                <!-- Account meta info -->
                <n-space v-if="account.meta" size="small" class="text-xs text-gray-500">
                  <span v-if="account.meta.followersCount">粉丝: {{ formatCount(account.meta.followersCount) }}</span>
                  <span v-if="account.meta.articlesCount">文章: {{ formatCount(account.meta.articlesCount) }}</span>
                  <span v-if="account.meta.viewsCount">阅读: {{ formatCount(account.meta.viewsCount) }}</span>
                </n-space>
                <!-- 7.5: Display lastError in account footer -->
                <div 
                  v-if="account.lastError && (account.status === 'expired' || account.status === 'error')" 
                  class="text-xs"
                  :class="account.status === 'expired' ? 'text-red-500' : 'text-yellow-600'"
                >
                  {{ account.lastError }}
                </div>
              </n-space>
            </template>
          </n-thing>
          <template #suffix>
            <n-space>
              <!-- 7.3: Conditional re-login button -->
              <n-button 
                v-if="account.status === 'expired'" 
                text 
                type="warning" 
                :loading="reloginLoadingMap[account.id]"
                @click="reloginAccount(account)"
              >
                重新登录
              </n-button>
              <n-button 
                v-else 
                text 
                type="primary" 
                @click="refreshAccount(account)"
              >
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
import { ref, reactive, onMounted, watch } from 'vue';
import { db, type Account, AccountStatus } from '@synccaster/core';
import { useMessage } from 'naive-ui';

defineProps<{ isDark?: boolean }>();
const message = useMessage();
const accounts = ref<Account[]>([]);
const showAddDialog = ref(false);
const selectedPlatform = ref<string>('');
const addingAccount = ref(false);
const refreshingAll = ref(false);
// 7.4: Track re-login loading state per account
const reloginLoadingMap = reactive<Record<string, boolean>>({});

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

// 平台用户主页 URL 模板
// 注意：各平台的 URL 格式不同，需要根据实际情况配置
// 当 userId 无效时，返回设置页面或平台首页
const platformUserUrls: Record<string, (userId?: string) => string> = {
  'juejin': (userId) => userId ? `https://juejin.cn/user/${userId}` : 'https://juejin.cn/user/settings/profile',
  'csdn': (userId) => userId ? `https://blog.csdn.net/${userId}` : 'https://i.csdn.net/#/user-center/profile',
  'zhihu': (userId) => userId ? `https://www.zhihu.com/people/${userId}` : 'https://www.zhihu.com/settings/profile',
  'wechat': () => 'https://mp.weixin.qq.com/',
  // 简书使用 slug 格式的 userId，如 bb8f42a96b80（不是数字 ID）
  'jianshu': (userId) => {
    // 检查 userId 是否是有效的 slug（字母数字组合，不是纯数字开头的临时 ID）
    if (userId && !userId.startsWith('jianshu_') && userId.length > 5) {
      return `https://www.jianshu.com/u/${userId}`;
    }
    return 'https://www.jianshu.com/settings/basic';
  },
  // 博客园使用 blogApp 作为主页路径，格式为 https://home.cnblogs.com/u/{blogApp}
  'cnblogs': (userId) => {
    // blogApp 通常是字母数字组合，不是纯数字或时间戳格式
    // 过滤掉临时生成的 ID（如 cnblogs_1765715946013）
    if (userId && userId.length > 2 && !userId.startsWith('cnblogs_') && !/^\d{10,}$/.test(userId)) {
      return `https://home.cnblogs.com/u/${userId}`;
    }
    return 'https://account.cnblogs.com/settings/account';
  },
  // 51CTO 使用纯数字 uid，个人主页格式为 https://home.51cto.com/space?uid={uid}
  '51cto': (userId) => {
    // 51CTO 的 uid 应该是纯数字
    if (userId && /^\d+$/.test(userId)) {
      return `https://home.51cto.com/space?uid=${userId}`;
    }
    return 'https://home.51cto.com/space';
  },
  // 腾讯云开发者社区主页格式为 https://cloud.tencent.com/developer/user/{userId}
  'tencent-cloud': (userId) => {
    // userId 应该是纯数字
    if (userId && /^\d+$/.test(userId)) {
      return `https://cloud.tencent.com/developer/user/${userId}`;
    }
    return 'https://cloud.tencent.com/developer/user';
  },
  // 阿里云开发者社区主页格式为 https://developer.aliyun.com/profile/{userId}
  'aliyun': (userId) => {
    // userId 应该是纯数字
    if (userId && /^\d+$/.test(userId)) {
      return `https://developer.aliyun.com/profile/${userId}`;
    }
    return 'https://developer.aliyun.com/my';
  },
  'segmentfault': (userId) => userId ? `https://segmentfault.com/u/${userId}` : 'https://segmentfault.com/user/settings',
  'bilibili': (userId) => userId ? `https://space.bilibili.com/${userId}` : 'https://member.bilibili.com/platform/home',
  'oschina': (userId) => userId ? `https://my.oschina.net/u/${userId}` : 'https://my.oschina.net/',
};

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

/**
 * 跳转到平台用户主页
 * 
 * 从账号 ID 中提取真实的 userId（格式为 platform_userId 或 platform-userId）
 * 如果账号有 profileUrl 字段，优先使用
 */
function goToUserProfile(account: Account) {
  // 优先使用账号存储的 profileUrl（如果有）
  if ((account as any).profileUrl) {
    window.open((account as any).profileUrl, '_blank');
    return;
  }
  
  const urlFn = platformUserUrls[account.platform];
  if (urlFn) {
    // 从 account.id 中提取 userId
    // 账号 ID 格式可能是：
    // - platform_userId（下划线分隔，如 jianshu_bb8f42a96b80）
    // - platform-userId（连字符分隔，如 cnblogs-RyanYipeng）
    let userId: string | undefined;
    
    // 先尝试下划线分隔（新格式）
    const underscoreIndex = account.id.indexOf('_');
    if (underscoreIndex > 0) {
      const prefix = account.id.substring(0, underscoreIndex);
      // 确保前缀是平台名
      if (prefix === account.platform || prefix.replace('-', '') === account.platform.replace('-', '')) {
        userId = account.id.substring(underscoreIndex + 1);
      }
    }
    
    // 如果下划线分隔没找到，尝试连字符分隔（旧格式）
    if (!userId) {
      const idParts = account.id.split('-');
      // 第一部分是平台名，剩余部分是 userId（userId 本身可能包含 -）
      if (idParts.length > 1) {
        // 特殊处理：tencent-cloud 平台名本身包含连字符
        if (account.platform === 'tencent-cloud' && idParts.length > 2) {
          userId = idParts.slice(2).join('-');
        } else {
          userId = idParts.slice(1).join('-');
        }
      }
    }
    
    // 过滤掉无效的 userId（如 undefined, 空字符串, 或临时生成的 ID）
    // 临时 ID 格式为 platform_timestamp（如 jianshu_1765638738736, cnblogs_1765715946013）
    if (userId === 'undefined' || userId === '' || 
        userId?.startsWith('jianshu_') || 
        userId?.startsWith('cnblogs_') ||
        userId?.startsWith('csdn_') ||
        /^\d{10,}$/.test(userId || '')) {
      userId = undefined;
    }

    // 兜底：使用刷新时写入的 profileId（避免因账号 id 不是平台 userId 导致跳转错误）
    if (!userId) {
      const profileId = (account.meta as any)?.profileId;
      if (typeof profileId === 'string' && profileId.trim()) {
        const trimmed = profileId.trim();
        // 简书 profileId 必须是 slug（非纯数字），避免历史脏数据导致跳转到错误页面
        if (!(account.platform === 'jianshu' && /^\d+$/.test(trimmed))) {
          userId = trimmed;
        }
      }
    }

    // 博客园兜底：部分场景无法获取 blogApp 时，尝试用昵称（若符合 blogApp 规范）
    if (!userId && account.platform === 'cnblogs') {
      const nickname = account.nickname?.trim();
      if (nickname && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,}$/.test(nickname)) {
        userId = nickname;
      }
    }
    
    const url = urlFn(userId);
    window.open(url, '_blank');
  }
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
      // 7.6: Reload accounts to show updated status
      await loadAccounts();
    }
  } catch (error: any) {
    loadingMsg.destroy();
    console.error('Failed to refresh account:', error);
    message.error('刷新失败: ' + error.message);
  }
}

/**
 * 7.4: Re-login account
 * 
 * Send RELOGIN_ACCOUNT message to background, show loading message during login,
 * and handle success/failure responses.
 * 
 * Requirements: 4.2, 4.4, 4.5
 */
async function reloginAccount(account: Account) {
  const platformName = getPlatformName(account.platform);
  
  // Set loading state for this account
  reloginLoadingMap[account.id] = true;
  const loadingMsg = message.loading(`正在打开 ${platformName} 登录页面，请完成登录...`, { duration: 0 });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'RELOGIN_ACCOUNT',
      data: { account },
    });

    loadingMsg.destroy();

    if (result.success) {
      // 4.4: Show success message when login is detected successfully
      message.success(`${platformName} 重新登录成功！`);
      await loadAccounts();
    } else {
      // 4.5: Show message indicating login was not completed
      message.warning(result.error || '登录未完成，请重试');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    console.error('Failed to re-login account:', error);
    // 4.5: Show message indicating login was not completed
    message.error('重新登录失败: ' + (error.message || '未知错误'));
  } finally {
    // Clear loading state
    reloginLoadingMap[account.id] = false;
  }
}

/**
 * 7.6: Refresh all accounts with enhanced status handling
 * 
 * Update local accounts array with returned status and improve error message
 * display based on errorType.
 * 
 * Requirements: 2.2, 2.3
 */
async function refreshAllAccounts() {
  if (accounts.value.length === 0) {
    message.warning('暂无账号需要刷新');
    return;
  }
  
  refreshingAll.value = true;
  const loadingMsg = message.loading(`正在快速刷新 ${accounts.value.length} 个账号...`, { duration: 0 });
  
  try {
    // 使用新的快速批量刷新 API（并行，无需打开标签页）
    const result = await chrome.runtime.sendMessage({
      type: 'REFRESH_ALL_ACCOUNTS_FAST',
      data: { accounts: accounts.value },
    });
    
    loadingMsg.destroy();
    
    if (result.success) {
      const { successCount, failedCount, failedAccounts } = result;
      
      if (failedCount === 0) {
        message.success(`全部 ${successCount} 个账号刷新成功`);
      } else if (successCount === 0) {
        message.error(`全部 ${failedCount} 个账号刷新失败`);
      } else {
        message.warning(`刷新完成：${successCount} 成功，${failedCount} 失败`);
      }
      
      // 7.6: Distinguish between truly expired and temporary errors based on status
      if (failedAccounts && failedAccounts.length > 0) {
        // 真正失效的账号（status 为 expired）
        const reallyExpired = failedAccounts.filter((f: any) => 
          f.account.status === AccountStatus.EXPIRED || 
          f.errorType === 'logged_out' || 
          f.retryable === false
        );
        // 临时错误（status 为 error，可重试）
        const maybeTemporary = failedAccounts.filter((f: any) => 
          f.account.status === AccountStatus.ERROR ||
          (f.retryable === true && f.errorType !== 'logged_out')
        );
        
        // 2.2: Show different visual indicators for expired vs temporarily failed
        if (reallyExpired.length > 0) {
          const expiredNames = reallyExpired.map((f: any) => 
            getPlatformName(f.account.platform)
          ).join('、');
          message.error(`以下账号登录已失效，请点击"重新登录"：${expiredNames}`, { duration: 6000 });
        }
        
        // 2.3: Show message suggesting retry later for temporary errors
        if (maybeTemporary.length > 0) {
          const tempNames = maybeTemporary.map((f: any) => 
            `${getPlatformName(f.account.platform)}(${f.error || '检测异常'})`
          ).join('、');
          message.warning(`以下账号检测异常（可能是临时问题，稍后重试即可）：${tempNames}`, { duration: 5000 });
        }
      }
      
      // 7.6: Reload accounts to display updated status fields
      await loadAccounts();
    } else {
      message.error(result.error || '刷新失败');
    }
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
