<template>
  <div>
    <h2 class="text-2xl font-bold mb-6" :class="isDark ? 'text-gray-100' : 'text-gray-800'">设置</h2>

    <n-card title="基础设置" class="mb-4">
      <n-form label-placement="left" label-width="120px">
        <n-form-item label="自动保存">
          <n-switch v-model:value="settings.autoSave" />
        </n-form-item>
        <n-form-item label="发布通知">
          <n-switch v-model:value="settings.notifications" />
        </n-form-item>
        <n-form-item label="最大并发数">
          <n-input-number v-model:value="settings.maxConcurrent" :min="1" :max="5" />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card title="高级设置" class="mb-4">
      <n-form label-placement="left" label-width="120px">
        <n-form-item label="调试模式">
          <n-switch v-model:value="settings.debug" />
        </n-form-item>
        <n-form-item label="日志保留天数">
          <n-input-number v-model:value="settings.logRetentionDays" :min="7" :max="90" />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card title="数据管理">
      <n-space>
        <n-button @click="exportData">导出数据</n-button>
        <n-button @click="importData">导入数据</n-button>
        <n-button type="error" @click="clearData">清空数据</n-button>
      </n-space>
    </n-card>

    <div class="mt-6 flex justify-end">
      <n-button type="primary" @click="saveSettings">保存设置</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ isDark?: boolean }>();

const settings = ref({
  autoSave: true,
  notifications: true,
  maxConcurrent: 2,
  debug: false,
  logRetentionDays: 30,
});

function saveSettings() {
  alert('设置已保存');
}

function exportData() {
  alert('导出数据功能待实现');
}

function importData() {
  alert('导入数据功能待实现');
}

function clearData() {
  if (confirm('确认清空所有数据吗？此操作不可恢复！')) {
    alert('清空数据功能待实现');
  }
}
</script>
