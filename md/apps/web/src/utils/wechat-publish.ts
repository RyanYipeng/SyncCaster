/// <reference types="chrome" />
/**
 * 微信公众号发布工具（SyncCaster 扩展集成）
 *
 * 目标流程：
 * - 用户在 md-editor 预览排版
 * - 点击“发布到微信”后，才打开公众号发文页并自动填充
 */

export interface WechatPublishPayload {
  title: string
  /** 渲染后的 HTML（富文本） */
  content: string
  author?: string
}

export interface WechatPublishResult {
  success: boolean
  message: string
  url?: string
  meta?: Record<string, any>
}

export function isExtensionEnvironment(): boolean {
  const w = window as any
  return typeof w.chrome !== 'undefined'
    && typeof w.chrome.runtime !== 'undefined'
    && typeof w.chrome.runtime.sendMessage === 'function'
}

function getChrome(): any {
  return (window as any).chrome
}

function sendMessage<T>(message: any): Promise<T> {
  const chrome = getChrome()
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(response)
    })
  })
}

export async function publishToWechat(payload: WechatPublishPayload): Promise<WechatPublishResult> {
  console.log('[wechat-publish] 开始发布到微信公众号')
  console.log('[wechat-publish] 标题:', payload.title)
  console.log('[wechat-publish] 内容长度:', payload.content.length, '字符')

  if (!isExtensionEnvironment()) {
    // 非扩展环境：给出提示（发布按钮通常不会显示）
    window.open('https://mp.weixin.qq.com/', '_blank')
    return {
      success: false,
      message: '请在 SyncCaster Chrome 扩展环境中使用此功能',
    }
  }

  if (!payload.content) {
    return { success: false, message: '正文为空，请先生成预览内容' }
  }

  try {
    const response = await sendMessage<any>({
      type: 'WECHAT_PUBLISH_FROM_MD_EDITOR',
      data: payload,
    })

    if (response?.success) {
      return {
        success: true,
        message: response?.message || '已打开微信公众号发文页面并自动填充标题和正文',
        url: response?.url,
        meta: response?.meta,
      }
    }

    return {
      success: false,
      message: response?.error || response?.message || '发布失败，请确保已登录微信公众号后台',
    }
  }
  catch (error: any) {
    console.error('[wechat-publish] 发布失败:', error)
    return {
      success: false,
      message: error?.message || '发布失败，请重试',
    }
  }
}

