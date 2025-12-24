import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 知乎适配器
 * 
 * 平台特点：
 * - 入口：https://zhuanlan.zhihu.com/write
 * - 编辑器：富文本编辑器，但支持 Markdown 粘贴解析
 * - 支持：Markdown 粘贴后弹窗确认解析、HTML 内容粘贴
 * - LaTeX 公式：需通过"公式"插件输入，去除 $ 符号
 * - 结构：标题输入框 + 富文本正文
 * 
 * 发布策略：
 * - 填充 Markdown 原文到编辑器
 * - 自动点击"确认并解析"按钮完成 Markdown → 富文本转换
 * - 不执行最终发布操作，由用户手动完成
 */
export const zhihuAdapter: PlatformAdapter = {
  id: 'zhihu',
  name: '知乎',
  kind: 'dom',
  icon: 'zhihu',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: true, // 知乎支持 Markdown 粘贴解析
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
    // 知乎支持 Markdown 粘贴解析：优先使用 Markdown 原文
    // 粘贴后平台会弹出"识别到 Markdown 格式"提示，插件自动点击确认解析
    const markdown = post.body_md || '';
    let contentHtml = (post as any)?.meta?.body_html || '';
    if (!contentHtml && markdown) {
      // 备用：若 Markdown 解析失败，使用预渲染的 HTML
      // 知乎不支持 LaTeX 渲染：去掉 $ 包裹
      contentHtml = renderMarkdownToHtmlForPaste(markdown, { stripMath: true });
    }
    
    return {
      title: post.title,
      contentHtml,
      contentMarkdown: markdown, // 优先使用 Markdown 原文
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

        // 2. 填充内容 - 知乎支持 Markdown 粘贴解析
        // 优先使用 Markdown 原文，让平台自动识别并弹出解析确认框
        console.log('[zhihu] Step 2: 填充内容');

        const contentMarkdown = String((payload as any).contentMarkdown || '');
        const contentHtml = String((payload as any).contentHtml || '');
        
        // 优先使用 Markdown 原文（知乎支持 Markdown 解析）
        const useMarkdown = !!contentMarkdown;
        const contentToFill = useMarkdown ? contentMarkdown : contentHtml;
        
        console.log('[zhihu] Content mode:', useMarkdown ? 'Markdown' : 'HTML');
        console.log('[zhihu] Content length:', contentToFill.length);
        
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
        
        // 触发 paste 事件
        console.log('[zhihu] Dispatching paste event...');
        try {
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
          
          // 触发 paste 事件
          const doc = editor.ownerDocument;
          const win = doc.defaultView || window;
          const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
          const dt = new DT();
          
          if (useMarkdown) {
            // Markdown 模式：只设置 text/plain，让知乎识别为 Markdown
            dt.setData('text/plain', contentMarkdown);
          } else {
            // HTML 模式：设置 HTML 和纯文本
            if (contentHtml) dt.setData('text/html', contentHtml);
            const htmlToPlainText = (html: string) => {
              try {
                const div = document.createElement('div');
                div.innerHTML = html || '';
                return (div.innerText || div.textContent || '').trim();
              } catch {
                return '';
              }
            };
            dt.setData('text/plain', htmlToPlainText(contentHtml));
          }

          const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
          const pasteEvent = new CE('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(pasteEvent, 'clipboardData', { get: () => dt });
          editor.dispatchEvent(pasteEvent);
          
          console.log('[zhihu] Paste event dispatched');
        } catch (e) {
          console.warn('[zhihu] Paste failed:', e);
          
          // 备用方案：使用 document.execCommand
          try {
            editor.focus();
            if (useMarkdown) {
              document.execCommand('insertText', false, contentMarkdown);
            } else if (contentHtml) {
              const ok = document.execCommand('insertHTML', false, contentHtml);
              if (!ok) {
                const htmlToPlainText = (html: string) => {
                  try {
                    const div = document.createElement('div');
                    div.innerHTML = html || '';
                    return (div.innerText || div.textContent || '').trim();
                  } catch {
                    return '';
                  }
                };
                document.execCommand('insertText', false, htmlToPlainText(contentHtml));
              }
            }
          } catch (e2) {
            console.warn('[zhihu] execCommand also failed:', e2);
          }
        }
        
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(1500);

        // 3. 处理 Markdown 解析弹窗（仅格式解析确认，不涉及发布）
        // 当知乎识别到 Markdown 格式时，会弹出"确认并解析"提示
        console.log('[zhihu] Step 3: 处理 Markdown 解析弹窗');
        await sleep(500);

        // 查找并点击"确认并解析"按钮（格式解析确认）
        for (let i = 0; i < 15; i++) {
          const parseBtn = Array.from(document.querySelectorAll('button')).find((btn) => {
            const text = btn.textContent || '';
            // 匹配各种可能的解析确认按钮文案
            return text.includes('确认并解析') || 
                   text.includes('解析为') ||
                   text.includes('转换为') ||
                   (text.includes('Markdown') && text.includes('确认'));
          });

          if (parseBtn) {
            console.log('[zhihu] Found Markdown parse button:', parseBtn.textContent);
            console.log('[zhihu] Clicking parse button (format conversion only, not publish)...');
            (parseBtn as HTMLElement).click();
            await sleep(1500);
            console.log('[zhihu] Markdown parse completed');
            break;
          }
          await sleep(300);
        }

        // 4. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[zhihu] Step 4: 内容填充完成');
        console.log('[zhihu] ⚠️ 发布操作需要用户手动完成');
        
        // 返回当前编辑页 URL，表示内容已填充完成
        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[zhihu] 填充失败:', error);
        return {
          url: window.location.href,
          __synccasterError: {
            message: error?.message || String(error),
            stack: error?.stack,
          },
        } as any;
      }
    },
  },
};
