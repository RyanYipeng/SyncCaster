import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * CSDN（新版创作中心）
 *
 * 目标：
 * - 打开编辑页后自动填充标题与正文
 * - 兼容 Markdown（CodeMirror/Monaco）与富文本（contenteditable/ProseMirror/Quill）
 */
export const csdnAdapter: PlatformAdapter = {
  id: 'csdn',
  name: 'CSDN',
  kind: 'dom',
  icon: 'csdn',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 30, concurrent: 1 },
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
      tags: post.tags?.slice(0, 5),
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('csdn: use DOM automation');
  },

  dom: {
    matchers: [
      // 优先打开 Markdown 编辑器（比创作中心富文本更稳定）
      'https://editor.csdn.net/md/?not_checkout=1',
      'https://mp.csdn.net/mp_blog/creation/editor*',
      'https://editor.csdn.net/md/*',
      'https://editor.csdn.net/*',
    ],
    fillAndPublish: async function (payload) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const isMarkdownEditorPage = () => {
        try {
          return window.location.hostname === 'editor.csdn.net' && window.location.pathname.startsWith('/md');
        } catch {
          return false;
        }
      };

      const htmlToPlainText = (html: string) => {
        try {
          const div = document.createElement('div');
          div.innerHTML = html || '';
          return (div.innerText || div.textContent || '').trim();
        } catch {
          return '';
        }
      };

      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        const win = he.ownerDocument?.defaultView || window;
        const style = win.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const getRectArea = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width * r.height;
      };

      const collectRoots = (): ParentNode[] => {
        const roots: ParentNode[] = [document];
        const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) roots.push(doc);
          } catch {
            // ignore cross-origin frames
          }
        }
        return roots;
      };

      const queryAllDeep = (selector: string): Element[] => {
        const out: Element[] = [];
        const visit = (root: ParentNode) => {
          try {
            out.push(...Array.from(root.querySelectorAll(selector)));
          } catch {}
          const elements = Array.from((root as any).querySelectorAll?.('*') || []) as Element[];
          for (const el of elements) {
            const shadow = (el as any).shadowRoot as ShadowRoot | undefined;
            if (shadow) visit(shadow);
          }
        };
        for (const root of collectRoots()) visit(root);
        return out;
      };

      const waitFor = async <T>(getter: () => T | null, timeoutMs = 30000): Promise<T> => {
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

      const findTitleField = (): HTMLElement | null => {
        const preferred = [
          '.article-bar__title input',
          '.article-bar__title textarea',
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="文章"]',
          '#txtTitle',
          'input[name="title"]',
          'textarea[name="title"]',
        ];
        for (const sel of preferred) {
          const el = queryAllDeep(sel).find(isVisible) as HTMLElement | undefined;
          if (el) return el;
        }

        const candidates = queryAllDeep('input, textarea, [contenteditable="true"], [role="textbox"]')
          .map((e) => e as HTMLElement)
          .filter(isVisible);
        if (!candidates.length) return null;
        candidates.sort((a, b) => getRectArea(b) - getRectArea(a));
        return candidates.find((el) => el.getBoundingClientRect().top < 260 && getRectArea(el) > 20000) || candidates[0];
      };

      const isLikelyTitle = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < 0 || rect.top > 320) return false;
        if (rect.height <= 0 || rect.height > 140) return false;
        const attrs = [
          el.getAttribute('placeholder') || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('name') || '',
          el.id || '',
          el.className || '',
        ].join(' ');
        return /标题|title/i.test(attrs) || rect.width > 200;
      };

      const tryFillCodeMirror5 = (markdown: string): boolean => {
        const cmEls = queryAllDeep('.CodeMirror').filter(isVisible) as any[];
        for (const cmEl of cmEls) {
          const cm = cmEl?.CodeMirror;
          if (cm?.setValue) {
            cm.setValue(markdown);
            cm.refresh?.();
            // Some implementations only mark dirty after an input/change event
            try {
              const ta = cmEl.querySelector?.('textarea') as HTMLTextAreaElement | null;
              ta?.dispatchEvent(new Event('input', { bubbles: true }));
              ta?.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
            return true;
          }
        }
        return false;
      };

      const tryFillMonaco = (markdown: string): boolean => {
        const monacoRoot = queryAllDeep('.monaco-editor').find(isVisible) as HTMLElement | undefined;
        if (!monacoRoot) return false;
        try {
          const monaco = (window as any).monaco;
          const models = monaco?.editor?.getModels?.() as any[] | undefined;
          if (models?.length) {
            for (const m of models) m?.setValue?.(markdown);
            return true;
          }
        } catch {
          // ignore and fallback
        }

        // DOM 兜底：部分页面会隐藏 monaco 对象，但仍有可写入的 textarea
        try {
          const ta = monacoRoot.querySelector('textarea.inputarea, textarea') as HTMLTextAreaElement | null;
          if (!ta) return false;
          setNativeValue(ta, markdown);
          return true;
        } catch {
          return false;
        }
      };

      const tryFillCodeMirror6 = async (markdown: string): Promise<boolean> => {
        const cm6 = queryAllDeep('.cm-content[contenteditable="true"], .cm-editor .cm-content')
          .map((e) => e as HTMLElement)
          .find(isVisible);
        if (!cm6) return false;
        try {
          const cmEditor = cm6.closest('.cm-editor') as any;
          const view = cmEditor?.cmView?.view;
          if (view?.dispatch && view?.state?.doc) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: markdown },
            });
            return true;
          }

          // DOM 回退（尽量触发输入事件）
          cm6.focus();
          const doc = cm6.ownerDocument;
          const win = doc.defaultView || window;
          const sel = win.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = doc.createRange();
            range.selectNodeContents(cm6);
            sel.addRange(range);
          }
          const ok = doc.execCommand?.('insertText', false, markdown);
          if (!ok) cm6.textContent = markdown;
          cm6.dispatchEvent(new Event('input', { bubbles: true }));
          cm6.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(200);
          return true;
        } catch {
          return false;
        }
      };

      const tryFillTextarea = (markdown: string): boolean => {
        const tas = queryAllDeep('textarea')
          .map((e) => e as HTMLTextAreaElement)
          .filter((e) => isVisible(e) && !isLikelyTitle(e));
        if (!tas.length) return false;
        tas.sort((a, b) => getRectArea(b) - getRectArea(a));
        const ta = tas[0];
        setNativeValue(ta, markdown);
        return true;
      };

      const findBestRichEditor = (): HTMLElement | null => {
        const candidates = queryAllDeep('.ProseMirror, .ql-editor, [contenteditable="true"], [role="textbox"]')
          .map((e) => e as HTMLElement)
          .filter((e) => isVisible(e) && !isLikelyTitle(e));
        if (!candidates.length) return null;
        candidates.sort((a, b) => getRectArea(b) - getRectArea(a));
        return candidates[0] || null;
      };

      const dispatchPaste = async (target: HTMLElement, data: { html?: string; text: string }) => {
        const doc = target.ownerDocument;
        const win = doc.defaultView || window;
        try {
          target.focus();
          const sel = win.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = doc.createRange();
            range.selectNodeContents(target);
            sel.addRange(range);
          }
          try {
            doc.execCommand?.('delete');
          } catch {}

          const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
          const dt = new DT();
          if (data.html) dt.setData('text/html', data.html);
          dt.setData('text/plain', data.text);
          const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
          const evt = new CE('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(evt, 'clipboardData', { get: () => dt });
          target.dispatchEvent(evt);
          await sleep(300);
        } catch {}
      };

      const fillRichEditor = async (editor: HTMLElement, html: string, fallbackText: string) => {
        const doc = editor.ownerDocument;
        const win = doc.defaultView || window;

        // 1) Quill API（如果是）
        try {
          const QuillCtor = (win as any).Quill;
          const quill =
            (QuillCtor && typeof QuillCtor.find === 'function' ? QuillCtor.find(editor) : null) ||
            (editor as any).__quill ||
            ((editor.closest('.ql-container') as any)?.__quill ?? null);
          if (html && quill?.clipboard?.dangerouslyPasteHTML) {
            quill.setText?.('');
            quill.clipboard.dangerouslyPasteHTML(html);
            quill.setSelection?.(quill.getLength?.() ?? 0, 0);
            await sleep(200);
            return;
          }
        } catch {}

        // 2) paste event
        await dispatchPaste(editor, { html: html || undefined, text: fallbackText });

        // 3) execCommand / innerHTML
        try {
          editor.focus();
          const ok = doc.execCommand?.('insertHTML', false, html);
          if (!ok) {
            editor.innerHTML = html || `<p>${fallbackText}</p>`;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch {
          editor.innerHTML = html || `<p>${fallbackText}</p>`;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      try {
        // 1) 标题
        const titleField = await waitFor(() => findTitleField(), 25000);
        const title = String((payload as any).title || '');
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
          titleField.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 2) 正文
        const markdown = String((payload as any).contentMarkdown || '');
        const html = String((payload as any).contentHtml || '');
        const fallbackText = html ? htmlToPlainText(html) || markdown : markdown;

        // 编辑器常比标题更晚渲染：先等待任一正文编辑区出现，再进行填充，避免只填了标题。
        await waitFor(
          () =>
            queryAllDeep('.CodeMirror, .monaco-editor, .cm-content[contenteditable="true"], .cm-editor, textarea, .ProseMirror, .ql-editor')
              .map((e) => e as HTMLElement)
              .find((e) => isVisible(e) && !isLikelyTitle(e)) || null,
          25000
        ).catch(() => null);

        const ok =
          tryFillCodeMirror5(markdown) ||
          tryFillMonaco(markdown) ||
          (await tryFillCodeMirror6(markdown)) ||
          tryFillTextarea(markdown);

        // 若是 Markdown 编辑器页，必须“纯 Markdown”写入；不要回退到富文本 HTML 粘贴。
        if (!ok && isMarkdownEditorPage()) {
          throw new Error('未找到可写入的 Markdown 编辑器控件');
        }

        if (!ok) {
          const editor = await waitFor(() => findBestRichEditor(), 25000);
          await fillRichEditor(editor, html, fallbackText);
        }

        return { url: window.location.href };
      } catch (error: any) {
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
