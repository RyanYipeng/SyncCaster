import type { PlatformAdapter } from './base';

/**
 * 掘金适配器
 * 
 * 平台特点：
 * - 入口：https://juejin.cn/editor/drafts/new?v=2
 * - 编辑器：Markdown 编辑器（bytemd）
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const juejinAdapter: PlatformAdapter = {
  id: 'juejin',
  name: '掘金',
  kind: 'dom',
  icon: 'juejin',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true, // 掘金原生支持 Markdown
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      cover: post.cover,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('juejin: use DOM automation');
  },

  dom: {
    matchers: ['https://juejin.cn/editor/drafts/new?v=2'],
    fillAndPublish: function(payload: any): Promise<{ url: string }> {
      console.log('[juejin] fillAndPublish starting', payload);
      
      const downloadedImages = payload.__downloadedImages || [];
      console.log('[juejin] 收到下载的图片:', downloadedImages.length);
      
      function sleep(ms: number): Promise<void> {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
      }
      
      function waitFor(selector: string, timeout?: number): Promise<HTMLElement> {
        const t = timeout || 15000;
        return new Promise(function(resolve, reject) {
          const start = Date.now();
          function check() {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (el) {
              resolve(el);
            } else if (Date.now() - start > t) {
              reject(new Error('等待元素超时: ' + selector));
            } else {
              setTimeout(check, 200);
            }
          }
          check();
        });
      }
      
      return (async function() {
        try {
          // 1. 填充标题
          console.log('[juejin] Step 1: 填充标题');
          const titleInput = await waitFor('.title-input input, input[placeholder*="标题"]') as HTMLInputElement;
          titleInput.value = payload.title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(300);

          // 2. 处理图片和内容
          console.log('[juejin] Step 2: 处理图片和内容');
          let markdown = payload.contentMarkdown || '';
          const imageUrlMap = new Map<string, string>();
          
          // 如果有下载的图片，通过 DOM 粘贴方式上传
          if (downloadedImages.length > 0) {
            console.log('[juejin] Step 2.1: 通过粘贴上传图片到掘金');
            await sleep(1000);
            
            const cmElement = document.querySelector('.CodeMirror') as any;
            if (!cmElement || !cmElement.CodeMirror) {
              console.warn('[juejin] 未找到 CodeMirror 编辑器，跳过图片上传');
            } else {
              const cm = cmElement.CodeMirror;
              const allUploadedUrls = new Set<string>();
              
              for (let i = 0; i < downloadedImages.length; i++) {
                const imgData = downloadedImages[i];
                console.log(`[juejin] 上传图片 ${i + 1}/${downloadedImages.length}: ${imgData.url.substring(0, 50)}...`);
                
                try {
                  const res = await fetch(imgData.base64);
                  const blob = await res.blob();
                  const file = new File([blob], 'image_' + Date.now() + '.png', { type: imgData.mimeType || 'image/png' });
                  
                  // 记录粘贴前的所有 URL
                  const currentContent = cm.getValue();
                  const beforeUrls = new Set(currentContent.match(/https?:\/\/[^\s\)\]]+/g) || []);
                  allUploadedUrls.forEach(u => beforeUrls.add(u));
                  
                  cm.focus();
                  
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  const editorWrapper = cmElement.querySelector('.CodeMirror-scroll') || cmElement;
                  const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
                  Object.defineProperty(pasteEvent, 'clipboardData', { get: () => dt });
                  editorWrapper.dispatchEvent(pasteEvent);
                  
                  // 等待新 URL 出现
                  let newUrl: string | null = null;
                  const startTime = Date.now();
                  while (Date.now() - startTime < 15000) {
                    await sleep(500);
                    const newContent = cm.getValue();
                    const currentUrls = newContent.match(/https?:\/\/[^\s\)\]]+/g) || [];
                    for (const url of currentUrls) {
                      if (!beforeUrls.has(url) && (url.includes('juejin') || url.includes('byteimg') || url.includes('xtjj'))) {
                        newUrl = url;
                        break;
                      }
                    }
                    if (newUrl) break;
                  }
                  
                  if (newUrl) {
                    imageUrlMap.set(imgData.url, newUrl);
                    allUploadedUrls.add(newUrl);
                    console.log(`[juejin] 图片上传成功: ${newUrl}`);
                  } else {
                    console.warn(`[juejin] 图片上传超时: ${imgData.url}`);
                  }
                } catch (e) {
                  console.error('[juejin] 图片上传异常:', e);
                }
                await sleep(300);
              }
              
              console.log(`[juejin] 图片上传完成: ${imageUrlMap.size}/${downloadedImages.length} 成功`);
              
              // 清空编辑器，准备填充最终内容
              cm.setValue('');
              await sleep(100);
            }
            
            // 替换 markdown 中的图片链接
            for (const [oldUrl, newUrl] of imageUrlMap) {
              markdown = markdown.split(oldUrl).join(newUrl);
            }
          }
          
          // 填充内容
          console.log('[juejin] Step 2.2: 填充内容');
          const cm2 = document.querySelector('.CodeMirror') as any;
          if (cm2 && cm2.CodeMirror) {
            cm2.CodeMirror.setValue(markdown);
          } else {
            throw new Error('未找到掘金编辑器');
          }
          await sleep(500);

          // 3. 内容填充完成，不执行发布操作
          // 根据统一发布控制原则：最终发布必须由用户手动完成
          console.log('[juejin] Step 3: 内容填充完成');
          console.log('[juejin] ⚠️ 发布操作需要用户手动完成');
          console.log('[juejin] 请点击右上角"发布"按钮，选择分类和标签后完成发布');
          
          return { 
            url: window.location.href,
            __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
          };
        } catch (error) {
          console.error('[juejin] 填充失败:', error);
          return {
            url: window.location.href,
            __synccasterError: {
              message: (error as any)?.message || String(error),
              stack: (error as any)?.stack,
            },
          } as any;
        }
      })();
    },
  },
};
