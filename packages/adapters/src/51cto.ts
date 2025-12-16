import type { PlatformAdapter } from './base';

/**
 * 51CTO 适配器
 * 
 * 平台特点：
 * - 入口：https://blog.51cto.com/blogger/publish?&newBloger=2（Markdown 编辑器）
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 */
export const cto51Adapter: PlatformAdapter = {
  id: '51cto',
  name: '51CTO',
  kind: 'dom',
  icon: '51cto',
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
    // 51CTO 支持标准 Markdown + LaTeX
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
    throw new Error('51cto: use DOM automation');
  },

  dom: {
    matchers: [
      // ⚠️ matchers[0] 会被 publish-engine 直接拿来打开标签页，不能包含通配符
      // Markdown 编辑器
      'https://blog.51cto.com/blogger/publish?&newBloger=2',
      // 兼容匹配其它参数/旧入口
      'https://blog.51cto.com/blogger/publish*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[51cto] fillAndPublish starting', payload);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        const style = window.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      async function waitForAny(selectors: string[], timeout = 20000): Promise<HTMLElement> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && isVisible(el)) return el as HTMLElement;
          }
          await sleep(200);
        }
        throw new Error(`等待元素超时: ${selectors.join(' | ')}`);
      }

      function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function pickLargest<T extends Element>(els: T[]): T | undefined {
        let best: { el: T; score: number } | undefined;
        for (const el of els) {
          const he = el as HTMLElement;
          const score = Math.max(1, he.clientWidth) * Math.max(1, he.clientHeight);
          if (!best || score > best.score) best = { el, score };
        }
        return best?.el;
      }

      function findEditorInRoot(
        root: Document | HTMLElement
      ):
        | { kind: 'codemirror'; el: HTMLElement }
        | { kind: 'textarea'; el: HTMLTextAreaElement }
        | { kind: 'contenteditable'; el: HTMLElement }
        | null {
        const cmRoot = root.querySelector?.('.CodeMirror') as any;
        if (cmRoot && isVisible(cmRoot)) return { kind: 'codemirror', el: cmRoot as HTMLElement };

        const textareas = Array.from(root.querySelectorAll?.('textarea') || []).filter(isVisible) as HTMLTextAreaElement[];
        const bestTextarea = pickLargest(textareas);
        if (bestTextarea) return { kind: 'textarea', el: bestTextarea };

        const editables = Array.from(root.querySelectorAll?.('[contenteditable="true"]') || []).filter(isVisible) as HTMLElement[];
        const bestEditable = pickLargest(editables);
        if (bestEditable) return { kind: 'contenteditable', el: bestEditable };

        return null;
      }

      async function fillMarkdown(markdown: string) {
        let editor = findEditorInRoot(document);

        if (!editor) {
          const frames = Array.from(document.querySelectorAll('iframe'));
          for (const frame of frames) {
            try {
              const doc = (frame as HTMLIFrameElement).contentDocument;
              if (!doc) continue;
              const e = findEditorInRoot(doc);
              if (e) {
                editor = e;
                break;
              }
            } catch (e) {}
          }
        }

        if (!editor) throw new Error('未找到 51CTO 编辑器');

        if (editor.kind === 'codemirror') {
          const cmEl = editor.el as any;
          if (cmEl?.CodeMirror?.setValue) {
            cmEl.CodeMirror.setValue(markdown);
            cmEl.CodeMirror.refresh?.();
            return;
          }

          const cmInput = editor.el.querySelector('textarea') as HTMLTextAreaElement | null;
          if (cmInput) {
            cmInput.focus();
            try {
              document.execCommand('selectAll', false);
              document.execCommand('insertText', false, markdown);
              return;
            } catch (e) {
              setNativeValue(cmInput, markdown);
              return;
            }
          }

          throw new Error('未找到 51CTO CodeMirror 输入框');
        }

        if (editor.kind === 'textarea') {
          setNativeValue(editor.el, markdown);
          return;
        }

        editor.el.focus();
        editor.el.textContent = markdown;
        editor.el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      try {
        // 1. 填充标题
        console.log('[51cto] Step 1: 填充标题');
        const titleInput = (await waitForAny([
          'input[placeholder*="标题"]',
          'input[placeholder*="请输入"][placeholder*="标题"]',
          'input[name="title"]',
          'input[id*="title"]',
          '.title-input input',
          '.article-title input',
          '.el-input__inner[placeholder*="标题"]',
        ])) as HTMLInputElement;
        setNativeValue(titleInput, (payload as any).title || '');
        await sleep(300);

        // 2. 填充内容 - 51CTO 使用 Markdown 编辑器
        console.log('[51cto] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        await fillMarkdown(markdown);
        await sleep(500);

        // 3. 点击发布按钮
        console.log('[51cto] Step 3: 点击发布按钮');
        const clickable = Array.from(document.querySelectorAll('button, a, [role="button"]')) as HTMLElement[];
        const publishBtn = clickable.find(el => {
          const text = (el.textContent || '').trim();
          if (!text.includes('发布')) return false;
          if (!isVisible(el)) return false;
          const disabled = (el as any).disabled || el.getAttribute('aria-disabled') === 'true';
          if (disabled) return false;
          return true;
        });
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布弹窗
        console.log('[51cto] Step 4: 处理发布弹窗');
        const confirmBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
          .find(btn => isVisible(btn) && /确定|确认|发布/.test((btn.textContent || '').trim())) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待获取文章 URL
        console.log('[51cto] Step 5: 等待文章 URL');
        const checkUrl = () => /blog\.51cto\.com\/.*\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[51cto] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[51cto] 发布失败:', error);
        throw error;
      }
    },
  },
};
