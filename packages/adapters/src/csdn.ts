import type { PlatformAdapter } from './base';

/**
 * CSDN 适配器
 * 
 * 平台特点：
 * - 入口：https://mp.csdn.net/mp_blog/creation/editor（Markdown 编辑器）
 * - 编辑器：CodeMirror Markdown 编辑器
 * - 支持：Markdown 语法、LaTeX 公式（MathJax）
 * - 结构：标题输入框 + Markdown 编辑器
 */
export const csdnAdapter: PlatformAdapter = {
  id: 'csdn',
  name: 'CSDN',
  kind: 'dom',
  icon: 'csdn',
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

  async ensureAuth({ account }) {
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // CSDN 支持标准 Markdown + LaTeX，无需特殊转换
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      tags: post.tags?.slice(0, 5),
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('csdn: use DOM automation');
  },

  dom: {
    matchers: [
      'https://mp.csdn.net/mp_blog/creation/editor*',
      'https://editor.csdn.net/md/*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[csdn] fillAndPublish starting', payload);
      
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
        console.log('[csdn] Step 1: 填充标题');
        const titleInput = await waitFor('.article-bar__title input, input[placeholder*="标题"]');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - CSDN 使用 CodeMirror
        console.log('[csdn] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：尝试 textarea
          const textarea = document.querySelector('.editor__inner textarea, textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到 CSDN 编辑器');
          }
        }
        await sleep(500);

        // 3. 点击发布按钮
        console.log('[csdn] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent?.includes('发布')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布弹窗（选择文章类型等）
        console.log('[csdn] Step 4: 处理发布弹窗');
        // CSDN 发布弹窗可能需要选择文章类型
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => /发布|确定/.test(btn.textContent || '')) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待跳转获取文章 URL
        console.log('[csdn] Step 5: 等待文章 URL');
        const checkUrl = () => /blog\.csdn\.net\/.*\/article\/details\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[csdn] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[csdn] 发布失败:', error);
        throw error;
      }
    },
  },
};
