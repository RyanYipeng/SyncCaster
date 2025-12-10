import type { PlatformAdapter } from './base';

/**
 * 知乎适配器
 * 
 * 平台特点：
 * - 入口：https://zhuanlan.zhihu.com/write
 * - 编辑器：富文本编辑器（不是 Markdown）
 * - 支持：HTML 内容粘贴
 * - LaTeX 公式：需通过"公式"插件输入，去除 $ 符号
 * - 结构：标题输入框 + 富文本正文
 */
export const zhihuAdapter: PlatformAdapter = {
  id: 'zhihu',
  name: '知乎',
  kind: 'dom',
  icon: 'zhihu',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: false,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // 知乎使用富文本编辑器，优先使用 HTML
    const contentHtml = (post as any)?.meta?.body_html || '';
    const contentMarkdown = post.body_md;
    
    return {
      title: post.title,
      contentHtml,
      contentMarkdown,
      cover: post.cover,
      tags: post.tags?.slice(0, 5),
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('zhihu: use DOM automation');
  },


  dom: {
    matchers: [
      'https://zhuanlan.zhihu.com/write',
    ],
    fillAndPublish: async function(payload: any) {
      console.log('[zhihu] fillAndPublish starting', payload);
      console.log('[zhihu] Current URL:', window.location.href);
      console.log('[zhihu] Document ready state:', document.readyState);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        console.log('[zhihu] Waiting for page to load...');
        await new Promise<void>(resolve => {
          window.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 5000); // 最多等 5 秒
        });
      }
      
      // 额外等待确保 React/Vue 组件渲染完成
      console.log('[zhihu] Waiting for editor to initialize...');
      await sleep(2000);
      
      async function waitForAny(selectors: string[], timeout = 20000): Promise<HTMLElement> {
        const start = Date.now();
        console.log('[zhihu] Waiting for selectors:', selectors);
        while (Date.now() - start < timeout) {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              console.log('[zhihu] Found element:', selector);
              return el as HTMLElement;
            }
          }
          await sleep(300);
        }
        // 打印当前页面的一些元素帮助调试
        console.log('[zhihu] Available inputs:', document.querySelectorAll('input, textarea').length);
        console.log('[zhihu] Available contenteditable:', document.querySelectorAll('[contenteditable]').length);
        throw new Error(`等待元素超时: ${selectors.join(', ')}`);
      }

      try {
        // 1. 填充标题
        console.log('[zhihu] Step 1: 填充标题');
        const titleSelectors = [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.WriteIndex-titleInput textarea',
          '.WriteIndex-titleInput input',
          '.PostEditor-titleInput textarea',
          '.PostEditor-titleInput input',
          'textarea.Input',
        ];
        const titleInput = await waitForAny(titleSelectors);
        console.log('[zhihu] Title input found:', titleInput.tagName, titleInput.className);
        
        // 清空并填充标题
        // 知乎需要模拟真实用户输入才能激活发布按钮
        titleInput.focus();
        await sleep(100);
        
        const titleText = (payload as any).title || '';
        
        if (titleInput.tagName === 'TEXTAREA') {
          (titleInput as HTMLTextAreaElement).value = titleText;
        } else {
          (titleInput as HTMLInputElement).value = titleText;
        }
        
        // 触发各种事件确保 React 状态更新
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
        
        // 模拟用户输入：添加一个字符然后删除，触发表单验证
        await sleep(200);
        titleInput.focus();
        
        // 使用 execCommand 模拟真实输入
        document.execCommand('insertText', false, ' ');
        await sleep(100);
        document.execCommand('delete', false);
        
        // 再次触发事件
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[zhihu] Title filled with input simulation:', titleText);
        await sleep(500);

        // 2. 填充内容 - 知乎使用 Draft.js 富文本编辑器
        // 使用 Clipboard API 写入剪贴板，然后模拟 Ctrl+V 粘贴
        console.log('[zhihu] Step 2: 填充内容');
        const content = (payload as any).contentMarkdown || (payload as any).contentHtml || '';
        console.log('[zhihu] Content length:', content.length);
        
        const editorSelectors = [
          '.public-DraftEditor-content[contenteditable="true"]',
          '.DraftEditor-editorContainer [contenteditable="true"]',
          '.PostEditor-content [contenteditable="true"]',
          '[data-contents="true"]',
          '[contenteditable="true"]',
        ];
        const editor = await waitForAny(editorSelectors);
        console.log('[zhihu] Editor found:', editor.tagName, editor.className);
        
        // 聚焦编辑器
        editor.focus();
        await sleep(500);
        
        // 方法1：使用 Clipboard API 写入剪贴板，然后触发粘贴
        console.log('[zhihu] Writing to clipboard and pasting...');
        try {
          // 写入剪贴板
          await navigator.clipboard.writeText(content);
          console.log('[zhihu] Clipboard written successfully');
          
          // 模拟 Ctrl+V 粘贴
          editor.focus();
          await sleep(200);
          
          // 触发 keydown 事件
          const keydownEvent = new KeyboardEvent('keydown', {
            key: 'v',
            code: 'KeyV',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          editor.dispatchEvent(keydownEvent);
          
          // 同时触发 paste 事件
          const dt = new DataTransfer();
          dt.setData('text/plain', content);
          const pasteEvent = new ClipboardEvent('paste', { 
            clipboardData: dt, 
            bubbles: true,
            cancelable: true,
          });
          editor.dispatchEvent(pasteEvent);
          
          console.log('[zhihu] Paste event dispatched');
        } catch (e) {
          console.warn('[zhihu] Clipboard API failed:', e);
          
          // 备用方案：使用 document.execCommand
          try {
            editor.focus();
            document.execCommand('insertText', false, content);
          } catch (e2) {
            console.warn('[zhihu] execCommand also failed:', e2);
          }
        }
        
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1500);

        // 3. 处理 Markdown 解析弹窗
        console.log('[zhihu] Step 3: 处理 Markdown 解析弹窗');
        await sleep(500);
        
        // 查找"确认并解析"按钮
        for (let i = 0; i < 10; i++) {
          const parseBtn = Array.from(document.querySelectorAll('button'))
            .find(btn => btn.textContent?.includes('确认并解析'));
          
          if (parseBtn) {
            console.log('[zhihu] Found Markdown parse button, clicking...');
            (parseBtn as HTMLElement).click();
            await sleep(1500);
            break;
          }
          await sleep(300);
        }

        // 4. 点击发布按钮
        console.log('[zhihu] Step 4: 点击发布按钮');
        await sleep(500);
        
        let publishBtn: HTMLElement | null = null;
        
        // 查找页面底部的"发布"按钮
        const allButtons = Array.from(document.querySelectorAll('button'));
        publishBtn = allButtons.find(btn => {
          const text = btn.textContent?.trim();
          return text === '发布' || text === '发布文章';
        }) as HTMLElement;
        
        if (!publishBtn) {
          // 尝试其他选择器
          const publishBtnSelectors = [
            '.PublishPanel-triggerButton',
            '.WriteIndex-publishButton',
            'button[type="button"]',
          ];
          
          for (const selector of publishBtnSelectors) {
            const btns = document.querySelectorAll(selector);
            for (const btn of btns) {
              if (btn.textContent?.includes('发布')) {
                publishBtn = btn as HTMLElement;
                break;
              }
            }
            if (publishBtn) break;
          }
        }
        
        if (!publishBtn) throw new Error('未找到发布按钮');
        console.log('[zhihu] Clicking publish button:', publishBtn.textContent);
        publishBtn.click();
        await sleep(2000);

        // 5. 处理发布确认弹窗（如果有）
        console.log('[zhihu] Step 5: 处理发布确认弹窗');
        
        const confirmBtns = Array.from(document.querySelectorAll('button'))
          .filter(btn => /确认发布|立即发布|发布文章|确定/.test(btn.textContent || ''));
        
        if (confirmBtns.length > 0) {
          console.log('[zhihu] Found confirm button, clicking...');
          (confirmBtns[0] as HTMLElement).click();
          await sleep(2000);
        }

        // 6. 等待跳转获取文章 URL
        console.log('[zhihu] Step 6: 等待文章 URL');
        const checkUrl = () => /zhuanlan\.zhihu\.com\/p\/\d+/.test(window.location.href);
        
        for (let i = 0; i < 60; i++) {
          if (checkUrl()) {
            console.log('[zhihu] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        // 检查是否有成功提示
        const successTip = document.querySelector('.Notification--success, [class*="success"]');
        if (successTip) {
          const link = document.querySelector('a[href*="/p/"]') as HTMLAnchorElement;
          if (link) {
            return { url: link.href };
          }
          return { url: 'https://zhuanlan.zhihu.com/' };
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[zhihu] 发布失败:', error);
        throw error;
      }
    },
  },
};
