import { initializeMermaid } from '@md/core/utils'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'

import { setupComponents } from './utils/setup-components'
import { SyncCasterAdapter } from './utils/synccaster-adapter'

import 'vue-sonner/style.css'

/* 每个页面公共css */
import '@/assets/index.css'
import '@/assets/less/theme.less'

// 异步初始化 mermaid，避免初始化顺序问题
initializeMermaid().catch(console.error)

setupComponents()

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)

// 检测是否在 SyncCaster 扩展环境中
const isInExtension = SyncCasterAdapter.isInExtension()

// 提供全局状态供组件使用
app.provide('isInSyncCasterExtension', isInExtension)

app.mount(`#app`)

// 在扩展模式下，自动加载 Chrome Storage 中的内容
if (isInExtension) {
  // 等待 Vue 应用挂载完成后加载内容
  setTimeout(async () => {
    try {
      const articleData = await SyncCasterAdapter.loadFromExtension()
      if (articleData) {
        // 触发自定义事件，让 post store 处理内容加载
        window.dispatchEvent(new CustomEvent('synccaster-load-content', {
          detail: articleData
        }))
        console.log('[SyncCaster] Content loaded from extension storage')
      }
    } catch (error) {
      console.error('[SyncCaster] Failed to load content from extension:', error)
    }
  }, 100)
}
