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
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 不执行最终发布操作，由用户手动完成
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

        // 3. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[cnblogs] 内容填充完成');
        console.log('[cnblogs] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[cnblogs] 填充失败:', error);
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
