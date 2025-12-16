import type { PlatformAdapter } from './base';

/**
 * 哔哩哔哩专栏适配器
 * 
 * 平台特点：
 * - 入口：https://member.bilibili.com/platform/upload/text/edit
 * - 编辑器：富文本编辑器（支持 Markdown 语法识别）
 * - 支持：Markdown 语法（部分）
 * - 不支持：LaTeX 公式
 * - 结构：标题 + 正文
 */
export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  name: '哔哩哔哩专栏',
  kind: 'dom',
  icon: 'bilibili',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 20,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // 哔哩哔哩不支持 LaTeX，移除公式标记
    let markdown = post.body_md;
    
    // 移除行内公式的 $ 符号
    markdown = markdown.replace(/\$([^$\n]+)\$/g, '$1');
    // 移除块级公式的 $$ 符号
    markdown = markdown.replace(/\$\$([^$]+)\$\$/g, '\n$1\n');
    
    return {
      title: post.title,
      contentMarkdown: markdown,
      tags: post.tags,
      categories: post.categories,
      cover: post.cover,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('bilibili: use DOM automation');
  },

  dom: {
    matchers: [
      'https://member.bilibili.com/platform/upload/text/edit*',
      'https://member.bilibili.com/article-text/home*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[bilibili] fillAndPublish starting', payload);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      async function waitFor(selector: string, timeout = 15000): Promise<HTMLElement> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const el = document.querySelector(selector);
          if (el) return el as HTMLElement;
          await sleep(200);
        }
        throw new Error(`等待元素超时: ${selector}`);
      }

      try {
        // 1. 填充标题
        console.log('[bilibili] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .title-input input, input.title');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - B站使用富文本编辑器
        console.log('[bilibili] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        // B站编辑器可能是 contenteditable
        const editor = document.querySelector('[contenteditable="true"], .ql-editor, .editor-content') as HTMLElement;
        if (editor) {
          editor.focus();
          // 使用粘贴方式插入
          const dt = new DataTransfer();
          dt.setData('text/plain', markdown);
          const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
          editor.dispatchEvent(pasteEvent);
        } else {
          // 降级：textarea
          const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到 B站编辑器');
          }
        }
        await sleep(500);

        // 3. 点击发布/提交按钮
        console.log('[bilibili] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button, .submit-btn'))
          .find(btn => /发布|提交|投稿/.test(btn.textContent || '')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布弹窗
        console.log('[bilibili] Step 4: 处理发布弹窗');
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => /确定|发布|投稿/.test(btn.textContent || '')) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待获取文章 URL
        console.log('[bilibili] Step 5: 等待文章 URL');
        const checkUrl = () => /bilibili\.com\/read\/cv\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[bilibili] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        // B站可能显示成功提示但不跳转
        const successTip = document.querySelector('.success, [class*="success"]');
        if (successTip) {
          // 尝试从页面获取链接
          const link = document.querySelector('a[href*="/read/cv"]') as HTMLAnchorElement;
          if (link) {
            return { url: link.href };
          }
          return { url: 'https://member.bilibili.com/platform/upload/text/home' };
        }

        throw new Error('发布超时：未获取到文章链接');
      } catch (error: any) {
        console.error('[bilibili] 发布失败:', error);
        throw error;
      }
    },
  },
};
