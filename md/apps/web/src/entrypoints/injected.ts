/**
 * 微信公众号编辑器注入脚本
 * 
 * 使用微信官方 __MP_Editor_JSAPI__ API 实现内容填充
 * 参考文档：微信公众号编辑器 JSAPI 文档
 * 
 * 支持的 API：
 * - mp_editor_get_isready: 获取编辑器状态
 * - mp_editor_set_content: 设置全文内容（需要 isNew=true）
 * - mp_editor_insert_html: 插入内容（需要 isNew=true）
 * - mp_editor_get_content: 获取全文内容
 */

interface EditorReadyResult {
  isReady: boolean
  isNew: boolean
}

interface PublishPayload {
  title: string
  content: string
  author?: string
}

/**
 * 获取微信官方 API
 */
function getAPI(): any {
  return (window as any).__MP_Editor_JSAPI__
}

/**
 * 检测微信官方 API 是否可用
 */
function hasOfficialAPI(): boolean {
  const api = getAPI()
  return !!api && typeof api.invoke === `function`
}

/**
 * 等待编辑器就绪
 * 调用 mp_editor_get_isready 检查编辑器状态
 */
function waitForEditorReady(timeout: number): Promise<EditorReadyResult | null> {
  return new Promise((resolve) => {
    const start = Date.now()
    
    function check() {
      if (!hasOfficialAPI()) {
        if (Date.now() - start > timeout) {
          console.warn(`[injected] 官方 API 不可用，等待超时`)
          resolve(null)
          return
        }
        setTimeout(check, 300)
        return
      }

      const api = getAPI()
      api.invoke({
        apiName: `mp_editor_get_isready`,
        apiParam: {},
        sucCb: (res: any) => {
          const result = res as EditorReadyResult
          console.log(`[injected] mp_editor_get_isready 返回:`, result)
          if (result && result.isReady) {
            console.log(`[injected] ✓ 编辑器已就绪，isNew=${result.isNew}`)
            resolve(result)
          } else {
            if (Date.now() - start > timeout) {
              console.warn(`[injected] 编辑器就绪等待超时`)
              resolve(null)
              return
            }
            setTimeout(check, 300)
          }
        },
        errCb: (err: any) => {
          console.warn(`[injected] mp_editor_get_isready 失败:`, err)
          if (Date.now() - start > timeout) {
            resolve(null)
            return
          }
          setTimeout(check, 300)
        },
      })
    }
    
    check()
  })
}


/**
 * 使用 mp_editor_set_content 设置全文内容
 * 注意：只有 isNew=true 时才能调用
 */
function setContentViaAPI(content: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!hasOfficialAPI()) {
      console.warn(`[injected] 官方 API 不可用`)
      resolve(false)
      return
    }

    console.log(`[injected] 调用 mp_editor_set_content`)
    const api = getAPI()
    api.invoke({
      apiName: `mp_editor_set_content`,
      apiParam: { content },
      sucCb: (res: any) => {
        console.log(`[injected] ✓ mp_editor_set_content 成功:`, res)
        resolve(true)
      },
      errCb: (err: any) => {
        console.error(`[injected] ✗ mp_editor_set_content 失败:`, err)
        resolve(false)
      },
    })
  })
}

/**
 * 使用 mp_editor_insert_html 插入内容（备选方案）
 * 注意：只有 isNew=true 时才能调用
 */
function insertHtmlViaAPI(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!hasOfficialAPI()) {
      console.warn(`[injected] 官方 API 不可用`)
      resolve(false)
      return
    }

    console.log(`[injected] 调用 mp_editor_insert_html`)
    const api = getAPI()
    api.invoke({
      apiName: `mp_editor_insert_html`,
      apiParam: { 
        html,
        isSelect: false,
      },
      sucCb: (res: any) => {
        console.log(`[injected] ✓ mp_editor_insert_html 成功:`, res)
        resolve(true)
      },
      errCb: (err: any) => {
        console.error(`[injected] ✗ mp_editor_insert_html 失败:`, err)
        resolve(false)
      },
    })
  })
}

/**
 * 监听内容变化事件，确认填充成功
 */
function onContentChange(callback: () => void): void {
  if (!hasOfficialAPI()) {
    return
  }

  const api = getAPI()
  if (typeof api.on !== `function`) {
    return
  }

  api.on({
    eventName: `contentchange`,
    callback: () => {
      console.log(`[injected] 检测到 contentchange 事件`)
      callback()
    },
  })
}

/**
 * 填充标题（使用 DOM 操作，官方 API 不支持标题）
 */
function fillTitle(title: string): boolean {
  const titleSelectors = [
    `#title`,
    `input[placeholder*="标题"]`,
    `input[placeholder*="请在这里输入标题"]`,
    `.title_input input`,
    `.weui-desktop-form__input`,
  ]

  for (const selector of titleSelectors) {
    const titleInput = document.querySelector(selector) as HTMLInputElement | null
    if (titleInput) {
      titleInput.value = title
      titleInput.dispatchEvent(new Event(`input`, { bubbles: true }))
      titleInput.dispatchEvent(new Event(`change`, { bubbles: true }))
      titleInput.dispatchEvent(new Event(`blur`, { bubbles: true }))
      console.log(`[injected] ✓ 标题已填充:`, title)
      return true
    }
  }

  console.warn(`[injected] ✗ 未找到标题输入框`)
  return false
}

/**
 * 填充作者（使用 DOM 操作）
 */
function fillAuthor(author: string): boolean {
  const authorSelectors = [
    `#author`,
    `input[placeholder*="作者"]`,
    `input[placeholder*="请输入作者"]`,
  ]

  for (const selector of authorSelectors) {
    const authorInput = document.querySelector(selector) as HTMLInputElement | null
    if (authorInput) {
      authorInput.value = author
      authorInput.dispatchEvent(new Event(`input`, { bubbles: true }))
      authorInput.dispatchEvent(new Event(`change`, { bubbles: true }))
      console.log(`[injected] ✓ 作者已填充:`, author)
      return true
    }
  }

  console.warn(`[injected] ✗ 未找到作者输入框`)
  return false
}

/**
 * 显示通知（简单的 toast 提示）
 */
function showNotification(message: string, type: `success` | `error`): void {
  const toast = document.createElement(`div`)
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transition: opacity 0.3s ease;
    ${type === `success` 
      ? `background: #52c41a; color: white;` 
      : `background: #ff4d4f; color: white;`}
  `
  document.body.appendChild(toast)
  
  setTimeout(() => {
    toast.style.opacity = `0`
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}


/**
 * 主要的内容填充逻辑
 */
async function fillContent(payload: PublishPayload): Promise<void> {
  console.log(`[injected] ========================================`)
  console.log(`[injected] 开始填充内容到微信公众号编辑器`)
  console.log(`[injected] ========================================`)
  console.log(`[injected] 标题:`, payload.title)
  console.log(`[injected] 内容长度:`, payload.content.length, `字符`)

  // Step 1: 等待编辑器就绪
  console.log(`[injected] Step 1: 等待编辑器就绪`)
  const editorState = await waitForEditorReady(15000)
  
  if (!editorState) {
    console.error(`[injected] ✗ 编辑器未就绪，无法填充内容`)
    showNotification(`编辑器未就绪，请刷新页面后重试`, `error`)
    return
  }

  // Step 2: 填充标题
  console.log(`[injected] Step 2: 填充标题`)
  if (payload.title) {
    fillTitle(payload.title)
  }

  // Step 3: 填充作者（如果有）
  if (payload.author) {
    console.log(`[injected] Step 3: 填充作者`)
    fillAuthor(payload.author)
  }

  // Step 4: 填充正文
  console.log(`[injected] Step 4: 填充正文`)
  
  // 检查是否为新编辑器（isNew=true 才能使用 set_content 和 insert_html）
  if (!editorState.isNew) {
    console.warn(`[injected] ⚠ 当前为旧编辑器（isNew=false），API 可能不支持`)
    console.warn(`[injected] 尝试使用 mp_editor_set_content...`)
  }

  // 优先使用 mp_editor_set_content
  let success = await setContentViaAPI(payload.content)
  
  // 如果失败，尝试 mp_editor_insert_html
  if (!success) {
    console.log(`[injected] mp_editor_set_content 失败，尝试 mp_editor_insert_html`)
    success = await insertHtmlViaAPI(payload.content)
  }

  // 显示结果
  if (success) {
    console.log(`[injected] ========================================`)
    console.log(`[injected] ✓ 内容填充成功！`)
    console.log(`[injected] ========================================`)
    showNotification(`内容已自动填充，请检查排版后发布`, `success`)
  } else {
    console.error(`[injected] ========================================`)
    console.error(`[injected] ✗ 内容填充失败`)
    console.error(`[injected] ========================================`)
    showNotification(`内容填充失败，请手动复制粘贴`, `error`)
  }
}

/**
 * 入口：监听来自 content script 的消息
 */
export default defineUnlistedScript(() => {
  console.log(`[injected] 微信公众号编辑器注入脚本已加载`)

  // 监听 contentchange 事件
  onContentChange(() => {
    console.log(`[injected] 内容已变化`)
  })

  // 监听来自 content script 的消息
  window.addEventListener(`message`, async (event) => {
    // 兼容旧的 copyToMp 事件（仅设置内容）
    if (event.data.type === `copyToMp`) {
      console.log(`[injected] 收到 copyToMp 事件`)
      const content = event.data.content as string
      
      // 等待编辑器就绪
      const editorState = await waitForEditorReady(10000)
      if (!editorState) {
        console.error(`[injected] 编辑器未就绪`)
        return
      }

      // 设置内容
      const success = await setContentViaAPI(content)
      if (!success) {
        await insertHtmlViaAPI(content)
      }
      return
    }

    // 新的 publishToWechat 事件（设置标题 + 内容 + 作者）
    if (event.data.type === `publishToWechat`) {
      console.log(`[injected] 收到 publishToWechat 事件`)
      const payload = event.data.payload as PublishPayload
      await fillContent(payload)
    }
  })
})
