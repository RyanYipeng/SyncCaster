import type { PlatformAdapter } from './base';

/**
 * 简书适配器
 * 
 * 平台特点：
 * - 入口：https://www.jianshu.com/writer
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - 不支持：LaTeX 公式直接识别（需通过"数学公式"按钮弹框输入）
 * - 结构：标题 + 正文
 * - 注意：LaTeX 公式需去除 $ 符号
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const jianshuAdapter: PlatformAdapter = {
  id: 'jianshu',
  name: '简书',
  kind: 'dom',
  icon: 'jianshu',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: false,
    supportsCategories: false,
    supportsCover: false,
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
    // 简书不支持 LaTeX，需要移除 $ 符号或转换为图片
    // 暂时保留原始 Markdown，后续可添加公式转图片功能
    let markdown = post.body_md;
    
    // 移除行内公式的 $ 符号（简书不支持）
    // TODO: 可选择转换为图片或其他方式
    
    return {
      title: post.title,
      contentMarkdown: markdown,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('jianshu: use DOM automation');
  },

  dom: {
    matchers: [
      'https://www.jianshu.com/writer*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[jianshu] fillAndPublish starting', payload);
      
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
        // 简书编辑器结构：左侧文章列表，右侧编辑区域
        // 需要先创建新文章或选择文章
        
        // 1. 点击新建文章按钮（如果需要）
        console.log('[jianshu] Step 1: 准备编辑器');
        const newBtn = document.querySelector('.fa-plus, [class*="new"]') as HTMLElement;
        if (newBtn) {
          newBtn.click();
          await sleep(500);
        }

        // 2. 填充标题
        console.log('[jianshu] Step 2: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .public-DraftStyleDefault-block');
        if (titleInput.tagName === 'INPUT') {
          (titleInput as HTMLInputElement).value = (payload as any).title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          titleInput.textContent = (payload as any).title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(300);

        // 3. 填充内容 - 简书使用 Draft.js 或 Markdown 编辑器
        console.log('[jianshu] Step 3: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        
        // 尝试 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
        } else {
          // Draft.js 编辑器
          const editor = document.querySelector('[contenteditable="true"], .public-DraftEditor-content') as HTMLElement;
          if (editor) {
            editor.focus();
            // 使用粘贴方式插入内容
            const dt = new DataTransfer();
            dt.setData('text/plain', markdown);
            const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
            editor.dispatchEvent(pasteEvent);
          } else {
            throw new Error('未找到简书编辑器');
          }
        }
        await sleep(800);

        // 4. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[jianshu] 内容填充完成');
        console.log('[jianshu] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[jianshu] 填充失败:', error);
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
