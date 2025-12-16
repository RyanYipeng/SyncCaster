import type { PlatformAdapter } from './base';

/**
 * 博客园适配器
 * 
 * 平台特点：
 * - 入口：https://i.cnblogs.com/posts/edit
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - LaTeX：需在后台设置 https://i.cnblogs.com/preference 开启"启用数学公式支持"
 * - 结构：标题 + 正文
 */
export const cnblogsAdapter: PlatformAdapter = {
  id: 'cnblogs',
  name: '博客园',
  kind: 'dom',
  icon: 'cnblogs',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: false,
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
    // 博客园支持 Markdown + LaTeX（需后台开启）
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('cnblogs: use DOM automation');
  },

  dom: {
    matchers: [
      'https://i.cnblogs.com/posts/edit*',
      'https://i.cnblogs.com/EditPosts.aspx*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[cnblogs] fillAndPublish starting', payload);
      
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
        console.log('[cnblogs] Step 1: 填充标题');
        const titleInput = await waitFor('#post-title, input[name="title"]');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - 博客园使用 Markdown 编辑器
        console.log('[cnblogs] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        // 博客园使用 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：textarea
          const textarea = document.querySelector('#post-body, textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到博客园编辑器');
          }
        }
        await sleep(500);

        // 3. 点击发布按钮
        console.log('[cnblogs] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button, a'))
          .find(btn => /发布|保存/.test(btn.textContent || '')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(2000);

        // 4. 等待获取文章 URL
        console.log('[cnblogs] Step 4: 等待文章 URL');
        const checkUrl = () => /cnblogs\.com\/.*\/p\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[cnblogs] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        // 博客园可能显示成功提示
        const successMsg = document.querySelector('.success, [class*="success"]');
        if (successMsg) {
          return { url: 'https://www.cnblogs.com/' };
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[cnblogs] 发布失败:', error);
        throw error;
      }
    },
  },
};
