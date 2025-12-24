import { defineContentScript, injectScript } from '#imports'

export default defineContentScript({
  matches: [`https://mp.weixin.qq.com/cgi-bin/appmsg*`],
  async main() {
    await injectScript(`/injected.js`, {
      keepInDom: true,
    })
    
    browser.runtime.onMessage.addListener((message) => {
      // 兼容旧的 copyToMp 消息（仅设置内容）
      if (message.type === `copyToMp`) {
        console.log(`[appmsg.content] Copying content to MP editor:`, message.content?.length, `chars`)
        const customEventData = { type: `copyToMp`, content: message.content }
        window.postMessage(customEventData)
        return Promise.resolve(true)
      }
      
      // 新的 publishToWechat 消息（设置标题 + 内容 + 作者）
      if (message.type === `publishToWechat`) {
        console.log(`[appmsg.content] Publishing to MP editor:`, message.payload)
        const customEventData = { 
          type: `publishToWechat`, 
          payload: message.payload,
        }
        window.postMessage(customEventData)
        return Promise.resolve(true)
      }
      
      return true
    })
  },
})
