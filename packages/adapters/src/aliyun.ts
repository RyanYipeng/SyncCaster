import type { PlatformAdapter } from './base';

/**
 * 阿里云开发者社区适配器
 * 
 * 平台特点：
 * - 入口：https://developer.aliyun.com/article/new#/
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - 不支持：LaTeX 公式直接识别（需点击"数学公式"按钮转换，自动添加 $$ 包裹）
 * - 结构：标题 + 正文
 * - 注意：原公式前后不能有 $ 符号
 */
export const aliyunAdapter: PlatformAdapter = {
  id: 'aliyun',
  name: '阿里云开发者社区',
  kind: 'dom',
  icon: 'aliyun',
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
    // 阿里云不直接支持 LaTeX，需要移除 $ 符号
    // 平台会通过"数学公式"按钮自动添加 $$ 包裹
    let markdown = post.body_md;
    
    // 移除公式的 $ 符号（阿里云会自动添加）
    // 行内公式：$..$ -> ..
    markdown = markdown.replace(/\$([^$\n]+)\$/g, '$1');
    // 块级公式：$$...$$  -> ...
    markdown = markdown.replace(/\$\$([^$]+)\$\$/g, '$1');
    
    return {
      title: post.title,
      contentMarkdown: markdown,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('aliyun: use DOM automation');
  },

  dom: {
    matchers: [
      'https://developer.aliyun.com/article/new*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[aliyun] fillAndPublish starting', payload);
      
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
        console.log('[aliyun] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .article-title input');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容
        console.log('[aliyun] Step 2: 填充内容');
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
            throw new Error('未找到阿里云编辑器');
          }
        }
        await sleep(500);

        // 3. 点击发布按钮
        console.log('[aliyun] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent?.includes('发布')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布弹窗
        console.log('[aliyun] Step 4: 处理发布弹窗');
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => /确定|发布/.test(btn.textContent || '')) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待获取文章 URL
        console.log('[aliyun] Step 5: 等待文章 URL');
        const checkUrl = () => /developer\.aliyun\.com\/article\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[aliyun] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[aliyun] 发布失败:', error);
        throw error;
      }
    },
  },
};
