import type { PlatformAdapter } from './base';

/**
 * 腾讯云开发者社区适配器
 * 
 * 平台特点：
 * - 入口：https://cloud.tencent.com/developer/article/write-new（Markdown 模式）
 * - 编辑器：可切换富文本/Markdown
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
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

        // 3. 点击发布按钮
        console.log('[tencent-cloud] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent?.includes('发布')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布弹窗
        console.log('[tencent-cloud] Step 4: 处理发布弹窗');
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => /确定|发布/.test(btn.textContent || '')) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待获取文章 URL
        console.log('[tencent-cloud] Step 5: 等待文章 URL');
        const checkUrl = () => /cloud\.tencent\.com\/developer\/article\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[tencent-cloud] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[tencent-cloud] 发布失败:', error);
        throw error;
      }
    },
  },
};
