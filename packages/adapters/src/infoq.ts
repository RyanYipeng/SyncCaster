import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * InfoQ（写作台 xie.infoq.cn）适配器
 *
 * 平台特点：
 * - 入口：https://xie.infoq.cn/
 * - 编辑器：Vue 自定义编辑器（gk-editor），支持 Markdown
 * - 需要先创建草稿才能进入编辑页（参考 cose：/api/v1/draft/create）
 *
 * 发布策略：
 * - transform: 将 Markdown 转 HTML
 * - dom.getEditorUrl: 返回 InfoQ 首页
 * - dom.createDraft: 在页面上下文中创建草稿，返回草稿编辑 URL
 * - dom.fillAndPublish: 在草稿页填充标题/正文
 */
export const infoqAdapter: PlatformAdapter = {
  id: 'infoq',
  name: 'InfoQ',
  kind: 'dom',
  icon: 'infoq',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 15, concurrent: 1 },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    const markdown = post.body_md || '';
    const contentHtml = renderMarkdownToHtmlForPaste(markdown);
    return {
      title: post.title,
      contentMarkdown: markdown,
      contentHtml,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('infoq: use DOM automation');
  },

  dom: {
    matchers: ['https://xie.infoq.cn/*'],

    // 返回 InfoQ 首页，用于初始打开标签页
    getEditorUrl: () => 'https://xie.infoq.cn/',

    // 在页面上下文中创建草稿，返回草稿编辑 URL
    // 这个函数会在 publish-engine 中通过 executeInOrigin 调用
    createDraft: async function () {
      const endpoint = 'https://xie.infoq.cn/api/v1/draft/create';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}` };
        }

        const data = await res.json();
        console.log('[infoq] Draft API response:', data);
        const draftId = data?.data?.id || data?.id || data?.data?.draftId;

        if (!draftId) {
          return { success: false, error: 'missing draftId in response' };
        }

        return { success: true, draftUrl: `https://xie.infoq.cn/draft/${draftId}` };
      } catch (e: any) {
        console.error('[infoq] Failed to create draft:', e);
        return { success: false, error: e?.message || 'unknown error' };
      }
    },

    fillAndPublish: async function (payload) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const titleText = String((payload as any).title || '').trim();
      const markdown = String((payload as any).contentMarkdown || '');
      const html = String((payload as any).contentHtml || '');

      const waitFor = async <T>(getter: () => T | null, timeoutMs = 45000): Promise<T> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const v = getter();
          if (v) return v;
          await sleep(200);
        }
        throw new Error('等待元素超时');
      };

      const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      // 1) 填充标题
      if (titleText) {
        try {
          const titleInput = await waitFor(() => {
            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            const candidates = inputs.filter((i) => {
              const attrs = [i.placeholder || '', i.getAttribute('aria-label') || '', i.name || '', i.id || '', i.className || ''].join(' ');
              return /标题|title/i.test(attrs);
            });
            return candidates[0] || null;
          });
          setNativeValue(titleInput, titleText);
          console.log('[infoq] Title filled');
          await sleep(200);
        } catch (e) {
          console.warn('[infoq] Failed to fill title:', e);
        }
      }

      // 2) 填充正文 - 优先使用 Vue 编辑器的 readMarkdown 方法
      try {
        // 尝试使用 gk-editor Vue 组件的 readMarkdown 方法
        const gkEditor = document.querySelector('.gk-editor') as any;
        if (gkEditor?.__vue__?.readMarkdown && markdown) {
          gkEditor.__vue__.readMarkdown(markdown);
          console.log('[infoq] Content filled via readMarkdown');
          await sleep(300);
          return { editUrl: window.location.href, url: window.location.href } as any;
        }

        // 尝试 CodeMirror
        const cmElement = document.querySelector('.CodeMirror') as any;
        if (cmElement?.CodeMirror && markdown) {
          cmElement.CodeMirror.setValue(markdown);
          console.log('[infoq] Content filled via CodeMirror');
          await sleep(300);
          return { editUrl: window.location.href, url: window.location.href } as any;
        }

        // 回退到 contenteditable
        const editor = await waitFor(() => {
          const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });
          return candidates[0] || null;
        });

        try {
          editor.focus();
        } catch {}

        try {
          if (html) {
            document.execCommand('selectAll');
            document.execCommand('insertHTML', false, html);
          } else {
            document.execCommand('selectAll');
            document.execCommand('insertText', false, markdown);
          }
        } catch {
          if (html) (editor as any).innerHTML = html;
          else editor.textContent = markdown;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log('[infoq] Content filled via contenteditable');
      } catch (e) {
        console.warn('[infoq] Failed to fill content:', e);
      }

      await sleep(300);
      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
