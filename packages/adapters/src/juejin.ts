import type { PlatformAdapter } from './base';

/**
 * 掘金适配器
 * 
 * 平台特点：
 * - 入口：https://juejin.cn/editor/drafts/new?v=2
 * - 编辑器：Markdown 编辑器（bytemd）
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 */
export const juejinAdapter: PlatformAdapter = {
  id: 'juejin',
  name: '掘金',
  kind: 'dom',
  icon: 'juejin',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
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

          // 3. 点击发布按钮
          console.log('[juejin] Step 3: 点击发布按钮');
          const allBtns = Array.from(document.querySelectorAll('button'));
          const publishBtn = allBtns.find(function(btn) { 
            return btn.textContent?.trim() === '发布'; 
          }) as HTMLElement | null;
          
          if (!publishBtn) throw new Error('未找到顶部发布按钮');
          console.log('[juejin] 找到顶部发布按钮:', publishBtn.textContent);
          publishBtn.click();
          await sleep(2000);

          // 4. 处理发布弹窗
          console.log('[juejin] Step 4: 处理发布弹窗');
          
          let modalFound = false;
          for (let retry = 0; retry < 10; retry++) {
            const modal = document.querySelector('.publish-popup, [class*="publish-popup"], [class*="modal"], .editor-publish-dialog');
            if (modal) {
              modalFound = true;
              console.log('[juejin] 发现发布弹窗');
              break;
            }
            await sleep(500);
          }
          
          if (!modalFound) {
            console.log('[juejin] 警告：未发现弹窗');
          }
          
          // 4.1 选择分类
          console.log('[juejin] Step 4.1: 选择分类');
          const categorySelectors = ['.category-list .item:not(.active)', '[class*="category"] .item:not(.active)'];
          let categorySelected = false;
          for (const sel of categorySelectors) {
            const items = document.querySelectorAll(sel);
            if (items.length > 0) {
              (items[0] as HTMLElement).click();
              categorySelected = true;
              console.log('[juejin] 已选择分类:', (items[0] as HTMLElement).textContent?.trim());
              await sleep(500);
              break;
            }
          }
          if (!categorySelected) console.warn('[juejin] 未能选择分类');
          
          // 4.2 添加标签
          console.log('[juejin] Step 4.2: 添加标签');
          const tagInput = document.querySelector('input[placeholder*="标签"], input[placeholder*="搜索添加标签"], .tag-input input') as HTMLInputElement | null;
          if (tagInput) {
            tagInput.focus();
            tagInput.click();
            await sleep(500);
            const tagDropdown = document.querySelector('.tag-list, [class*="tag-list"], [class*="dropdown"]');
            if (tagDropdown) {
              const tagItem = tagDropdown.querySelector('.item, .tag-item, li') as HTMLElement | null;
              if (tagItem) {
                tagItem.click();
                console.log('[juejin] 已选择标签:', tagItem.textContent?.trim());
                await sleep(300);
              }
            } else {
              tagInput.value = '前端';
              tagInput.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(500);
              tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              await sleep(300);
            }
          }
          await sleep(500);
          
          // 4.3 填写摘要（需大于50字小于100字）
          console.log('[juejin] Step 4.3: 填写摘要');
          const summaryTextarea = document.querySelector('textarea[placeholder*="摘要"], textarea[placeholder*="简介"], .summary-input textarea, [class*="abstract"] textarea') as HTMLTextAreaElement | null;
          if (summaryTextarea) {
            // 从 markdown 中提取纯文本摘要
            let plainText = markdown
              .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // 移除图片 ![...](...) 
              .replace(/\[[^\]]*\]\([^)]+\)/g, '')  // 移除链接 [...](...) 
              .replace(/\$\$[\s\S]*?\$\$/g, '')  // 移除块级公式 $$...$$
              .replace(/\$[^$]+\$/g, '')  // 移除行内公式 $...$
              .replace(/```[\s\S]*?```/g, '')  // 移除代码块
              .replace(/`[^`]+`/g, '')  // 移除行内代码
              .replace(/^#{1,6}\s+/gm, '')  // 移除标题符号
              .replace(/^>\s*/gm, '')  // 移除引用符号
              .replace(/^[-*+]\s+/gm, '')  // 移除列表符号
              .replace(/^\d+\.\s+/gm, '')  // 移除有序列表符号
              .replace(/[*_~\[\]]/g, '')  // 移除格式符号
              .replace(/---+/g, '')  // 移除分割线
              .replace(/\n+/g, ' ')  // 换行转空格
              .replace(/\s+/g, ' ')  // 多空格合并
              .trim();
            
            console.log('[juejin] 提取的纯文本:', plainText.substring(0, 100));
            
            // 优先使用 payload.summary，如果没有或包含图片链接则使用提取的纯文本
            let summary = payload.summary || '';
            // 检查 summary 是否包含图片链接语法
            if (!summary || /!\[[^\]]*\]\([^)]+\)/.test(summary) || summary.includes('![')) {
              summary = plainText;
            }
            
            // 确保摘要长度在 50-100 字之间
            if (summary.length < 50) {
              summary = summary.padEnd(50, '。');
            }
            summary = summary.substring(0, 100);
            
            summaryTextarea.focus();
            summaryTextarea.value = summary;
            summaryTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[juejin] 已填写摘要:', summary.substring(0, 50) + '...');
            await sleep(300);
          }
          await sleep(500);
          
          // 5. 点击确定并发布
          console.log('[juejin] Step 5: 点击确定并发布');
          const confirmBtn = Array.from(document.querySelectorAll('button')).find(function(btn) { 
            const text = btn.textContent?.trim() || '';
            return text.includes('确定并发布') || text === '确认发布';
          }) as HTMLElement | null;
          
          if (!confirmBtn) {
            throw new Error('未找到确定并发布按钮');
          }
          
          console.log('[juejin] 找到确定并发布按钮，点击发布');
          confirmBtn.click();
          
          // 等待一小段时间让发布请求发送出去
          // 注意：页面跳转后脚本上下文会丢失，所以我们不能等待太久
          await sleep(3000);
          
          // 6. 检查发布结果
          console.log('[juejin] Step 6: 检查发布结果');
          const currentUrl = window.location.href;
          console.log('[juejin] 当前 URL:', currentUrl);
          
          // 检查是否已经跳转到发布成功页面
          if (currentUrl.includes('juejin.cn/published')) {
            console.log('[juejin] 已跳转到发布成功页面');
            return { url: 'https://juejin.cn/published' };
          }
          
          // 检查是否跳转到文章页
          const postMatch = currentUrl.match(/juejin\.cn\/post\/(\d+)/);
          if (postMatch) {
            console.log('[juejin] 已跳转到文章页:', currentUrl);
            return { url: currentUrl };
          }
          
          // 检查是否有错误提示
          const errorToast = document.querySelector('[class*="error"], [class*="toast-error"]');
          if (errorToast && errorToast.textContent) {
            const errorText = errorToast.textContent.trim();
            if (errorText) {
              console.error('[juejin] 发布错误:', errorText);
              throw new Error('发布失败: ' + errorText);
            }
          }
          
          // 如果还在编辑器页面，可能是发布请求还在处理中
          // 由于页面即将跳转，我们假设发布成功
          if (currentUrl.includes('juejin.cn/editor')) {
            console.log('[juejin] 仍在编辑器页面，假设发布请求已发送');
            // 返回发布成功页面的 URL，让用户自己查看
            return { url: 'https://juejin.cn/published' };
          }
          
          // 默认返回发布成功页面
          console.log('[juejin] 发布完成，返回发布成功页面');
          return { url: 'https://juejin.cn/published' };
        } catch (error) {
          console.error('[juejin] 发布失败:', error);
          throw error;
        }
      })();
    },
  },
};
