import type { PlatformAdapter } from './base';

/**
 * 思否（SegmentFault）适配器
 * 
 * 平台特点：
 * - 入口：https://segmentfault.com/write?freshman=1
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - LaTeX 公式：
 *   - 行内公式和块级公式都使用 $$公式$$ 语法
 * - 结构：标题 + 正文
 */
export const segmentfaultAdapter: PlatformAdapter = {
  id: 'segmentfault',
  name: '思否',
  kind: 'dom',
  icon: 'segmentfault',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: false,
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
    // 思否 LaTeX 语法：行内和块级公式都使用双美元符号 $$...$$
    // 需要将标准 Markdown 的单 $ 行内公式转换为双 $$
    let markdown = post.body_md || '';
    
    // 使用特殊标记替换，避免 $ 符号的特殊处理问题
    const DOLLAR = '\uFFFF';  // 使用 Unicode 替换字符作为临时标记
    
    // 1. 先将所有 $$ 替换为临时标记（保护块级公式）
    markdown = markdown.split('$$').join(DOLLAR + DOLLAR);
    
    // 2. 将剩余的单个 $ 替换为双 $$（转换行内公式）
    markdown = markdown.split('$').join(DOLLAR + DOLLAR);
    
    // 3. 将临时标记还原为 $
    markdown = markdown.split(DOLLAR).join('$');
    
    // 4. 规范化分割线：将 "* * *" 转换为 "---"
    markdown = markdown.replace(/^\* \* \*$/gm, '---');
    markdown = markdown.replace(/^\*\*\*$/gm, '---');
    
    return {
      title: post.title,
      contentMarkdown: markdown,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('segmentfault: use DOM automation');
  },

  dom: {
    matchers: [
      // 注意：直接使用带参数的完整 URL，避免跳转到 howtowrite 提示页
      'https://segmentfault.com/write?freshman=1',
    ],
    fillAndPublish: async function (payload) {
      console.log('[segmentfault] fillAndPublish starting', payload);
      
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
        console.log('[segmentfault] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .title-input input');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - 思否使用 Markdown 编辑器
        console.log('[segmentfault] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        // 尝试 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：textarea
          const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到思否编辑器');
          }
        }
        await sleep(500);

        // 3. 内容填充完成，不执行发布操作
        console.log('[segmentfault] 内容填充完成');
        console.log('[segmentfault] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[segmentfault] 填充失败:', error);
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
