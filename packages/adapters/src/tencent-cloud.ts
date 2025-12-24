import type { PlatformAdapter } from './base';

/**
 * 腾讯云开发者社区适配器
 * 
 * 平台特点：
 * - 入口：https://cloud.tencent.com/developer/article/write-new（Markdown 模式）
 * - 编辑器：可切换富文本/Markdown
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const tencentCloudAdapter: PlatformAdapter = {
  id: 'tencent-cloud',
  name: '腾讯云开发者社区',
  kind: 'dom',
  icon: 'tencent-cloud',
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
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // 腾讯云支持标准 Markdown + LaTeX
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
    throw new Error('tencent-cloud: use DOM automation');
  },

  dom: {
    matchers: [
      'https://cloud.tencent.com/developer/article/write*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[tencent-cloud] fillAndPublish starting', payload);
      
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
        console.log('[tencent-cloud] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .article-title input');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - 腾讯云使用 Markdown 编辑器
        console.log('[tencent-cloud] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        // 尝试 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：textarea
          const textarea = document.querySelector('textarea[placeholder*="正文"], textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到腾讯云编辑器');
          }
        }
        await sleep(500);

        // 3. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[tencent-cloud] 内容填充完成');
        console.log('[tencent-cloud] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[tencent-cloud] 填充失败:', error);
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
