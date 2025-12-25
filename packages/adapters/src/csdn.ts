import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * CSDN（新版创作中心）
 *
 * 平台特点：
 * - 入口：https://editor.csdn.net/md/?not_checkout=1
 * - 编辑器：Markdown 编辑器（CodeMirror/Monaco）或富文本编辑器
 * - 支持：Markdown 语法
 * - 结构：标题输入框 + 正文编辑器
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 不执行最终发布操作，由用户手动完成
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
        console.log('[csdn-fill] Trying CodeMirror 5...');
        const cmEls = queryAllDeep('.CodeMirror').filter(isVisible) as any[];
        console.log('[csdn-fill] Found .CodeMirror elements:', cmEls.length);
        for (const cmEl of cmEls) {
          const cm = cmEl?.CodeMirror;
          if (cm?.setValue) {
            console.log('[csdn-fill] CodeMirror 5 instance found, setting value');
            // 先清空原有内容，再设置新内容（解决 CSDN 自动保存草稿导致内容混乱的问题）
            cm.setValue('');
            cm.setValue(markdown);
            cm.refresh?.();
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
        console.log('[csdn-fill] Trying Monaco...');
        const monacoRoot = queryAllDeep('.monaco-editor').find(isVisible) as HTMLElement | undefined;
        console.log('[csdn-fill] Found .monaco-editor:', !!monacoRoot);
        if (!monacoRoot) return false;
        try {
          const monaco = (window as any).monaco;
          const models = monaco?.editor?.getModels?.() as any[] | undefined;
          if (models?.length) {
            console.log('[csdn-fill] Monaco models found:', models.length);
            // 先清空原有内容，再设置新内容（解决 CSDN 自动保存草稿导致内容混乱的问题）
            for (const m of models) {
              m?.setValue?.('');
              m?.setValue?.(markdown);
            }
            return true;
          }
        } catch {}

        try {
          const ta = monacoRoot.querySelector('textarea.inputarea, textarea') as HTMLTextAreaElement | null;
          if (!ta) return false;
          // 先清空再设置
          setNativeValue(ta, '');
          setNativeValue(ta, markdown);
          return true;
        } catch {
          return false;
        }
      };

      const tryFillCodeMirror6 = async (markdown: string): Promise<boolean> => {
        console.log('[csdn-fill] Trying CodeMirror 6...');
        const cm6 = queryAllDeep('.cm-content[contenteditable="true"], .cm-editor .cm-content')
          .map((e) => e as HTMLElement)
          .find(isVisible);
        console.log('[csdn-fill] Found .cm-content:', !!cm6);
        if (!cm6) return false;
        
        try {
          const cmEditor = cm6.closest('.cm-editor') as any;
          console.log('[csdn-fill] Found .cm-editor:', !!cmEditor);
          
          let view: any = null;
          
          if (cmEditor?.cmView?.view) {
            view = cmEditor.cmView.view;
            console.log('[csdn-fill] Found view via cmView.view');
          }
          
          if (!view && cmEditor) {
            for (const key of Object.keys(cmEditor)) {
              const val = cmEditor[key];
              if (val && typeof val === 'object' && val.dispatch && val.state?.doc) {
                view = val;
                console.log('[csdn-fill] Found view via key:', key);
                break;
              }
            }
          }
          
          if (!view && cmEditor) {
            const symbols = Object.getOwnPropertySymbols(cmEditor);
            for (const sym of symbols) {
              const val = cmEditor[sym];
              if (val && typeof val === 'object' && val.dispatch && val.state?.doc) {
                view = val;
                console.log('[csdn-fill] Found view via Symbol');
                break;
              }
            }
          }
          
          if (!view && cm6) {
            for (const key of Object.keys(cm6)) {
              const val = (cm6 as any)[key];
              if (val && typeof val === 'object' && val.dispatch && val.state?.doc) {
                view = val;
                console.log('[csdn-fill] Found view via cm6 key:', key);
                break;
              }
            }
          }
          
          if (!view) {
            const win = cm6.ownerDocument?.defaultView || window;
            const globalKeys = ['editorView', 'editor', 'cmView', 'markdownEditor'];
            for (const key of globalKeys) {
              const val = (win as any)[key];
              if (val && typeof val === 'object' && val.dispatch && val.state?.doc) {
                view = val;
                console.log('[csdn-fill] Found view via window.' + key);
                break;
              }
            }
          }
          
          if (view?.dispatch && view?.state?.doc) {
            console.log('[csdn-fill] Dispatching to CodeMirror 6 view');
            // 先清空原有内容，再设置新内容（解决 CSDN 自动保存草稿导致内容混乱的问题）
            // 使用 from: 0, to: doc.length 替换全部内容
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: markdown },
            });
            return true;
          }

          // DOM 回退：模拟粘贴纯文本
          console.log('[csdn-fill] No CM6 view found, trying paste simulation');
          cm6.focus();
          await sleep(100);
          
          const doc = cm6.ownerDocument;
          const win = doc.defaultView || window;
          
          // 选中所有内容
          const sel = win.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = doc.createRange();
            range.selectNodeContents(cm6);
            sel.addRange(range);
          }
          
          // 模拟粘贴事件（纯文本）
          try {
            const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
            const dt = new DT();
            dt.setData('text/plain', markdown);
            const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
            const pasteEvt = new CE('paste', { bubbles: true, cancelable: true } as any);
            Object.defineProperty(pasteEvt, 'clipboardData', { get: () => dt });
            cm6.dispatchEvent(pasteEvt);
            await sleep(300);
            
            // 检查是否成功
            if (cm6.textContent && cm6.textContent.includes(markdown.substring(0, 20))) {
              console.log('[csdn-fill] Paste simulation worked');
              return true;
            }
          } catch (e) {
            console.log('[csdn-fill] Paste simulation failed:', e);
          }
          
          // 尝试 execCommand insertText
          try {
            sel?.removeAllRanges();
            const range2 = doc.createRange();
            range2.selectNodeContents(cm6);
            sel?.addRange(range2);
            
            const ok = doc.execCommand?.('insertText', false, markdown);
            if (ok) {
              cm6.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(100);
              console.log('[csdn-fill] execCommand insertText worked');
              return true;
            }
          } catch {}
          
          // 最后尝试：逐行插入（保持换行）
          console.log('[csdn-fill] Trying line-by-line insertion');
          cm6.innerHTML = '';
          const lines = markdown.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineDiv = doc.createElement('div');
            lineDiv.className = 'cm-line';
            lineDiv.textContent = line || '\u200B'; // 空行用零宽空格
            cm6.appendChild(lineDiv);
          }
          cm6.dispatchEvent(new Event('input', { bubbles: true }));
          cm6.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(200);
          console.log('[csdn-fill] Line-by-line insertion done');
          return true;
        } catch (e) {
          console.log('[csdn-fill] CM6 error:', e);
          return false;
        }
      };

      const tryFillTextarea = (markdown: string): boolean => {
        console.log('[csdn-fill] Trying textarea...');
        const tas = queryAllDeep('textarea')
          .map((e) => e as HTMLTextAreaElement)
          .filter((e) => isVisible(e) && !isLikelyTitle(e));
        console.log('[csdn-fill] Found textareas:', tas.length);
        if (!tas.length) return false;
        tas.sort((a, b) => getRectArea(b) - getRectArea(a));
        const ta = tas[0];
        console.log('[csdn-fill] Using textarea:', ta.className, getRectArea(ta));
        // 先清空原有内容，再设置新内容（解决 CSDN 自动保存草稿导致内容混乱的问题）
        setNativeValue(ta, '');
        setNativeValue(ta, markdown);
        return true;
      };

      const tryFillContentEditable = async (markdown: string): Promise<boolean> => {
        console.log('[csdn-fill] Trying contenteditable fallback...');
        const editables = queryAllDeep('[contenteditable="true"]')
          .map((e) => e as HTMLElement)
          .filter((e) => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 10000);
        
        console.log('[csdn-fill] Found contenteditable elements:', editables.length);
        if (editables.length === 0) return false;
        
        editables.sort((a, b) => getRectArea(b) - getRectArea(a));
        const target = editables[0];
        console.log('[csdn-fill] Using contenteditable:', target.className, getRectArea(target));
        
        const doc = target.ownerDocument;
        const win = doc.defaultView || window;
        
        // 先清空原有内容（解决 CSDN 自动保存草稿导致内容混乱的问题）
        target.innerHTML = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(100);
        
        target.focus();
        await sleep(100);
        
        // 选中所有内容
        const sel = win.getSelection();
        if (sel) {
          sel.removeAllRanges();
          const range = doc.createRange();
          range.selectNodeContents(target);
          sel.addRange(range);
        }
        
        // 方式1：模拟粘贴纯文本
        try {
          const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
          const dt = new DT();
          dt.setData('text/plain', markdown);
          const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
          const pasteEvt = new CE('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(pasteEvt, 'clipboardData', { get: () => dt });
          target.dispatchEvent(pasteEvt);
          await sleep(300);
          
          if (target.textContent && target.textContent.includes(markdown.substring(0, 20))) {
            console.log('[csdn-fill] Paste worked for contenteditable');
            return true;
          }
        } catch {}
        
        // 方式2：execCommand insertText
        try {
          sel?.removeAllRanges();
          const range2 = doc.createRange();
          range2.selectNodeContents(target);
          sel?.addRange(range2);
          
          const ok = doc.execCommand?.('insertText', false, markdown);
          if (ok) {
            target.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            console.log('[csdn-fill] execCommand worked for contenteditable');
            return true;
          }
        } catch {}
        
        // 方式3：逐行插入
        target.innerHTML = '';
        const lines = markdown.split('\n');
        for (const line of lines) {
          const div = doc.createElement('div');
          div.textContent = line || '\u200B';
          target.appendChild(div);
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
        
        return target.textContent ? target.textContent.length > 10 : false;
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

        await dispatchPaste(editor, { html: html || undefined, text: fallbackText });

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
        console.log('[csdn-fill] Starting fill process...');
        console.log('[csdn-fill] URL:', window.location.href);
        console.log('[csdn-fill] isMarkdownEditorPage:', isMarkdownEditorPage());
        
        // 1) 标题
        const titleField = await waitFor(() => findTitleField(), 25000);
        const title = String((payload as any).title || '');
        console.log('[csdn-fill] Title field found:', titleField?.tagName, titleField?.className);
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
          titleField.dispatchEvent(new Event('change', { bubbles: true }));
        }
        console.log('[csdn-fill] Title filled');

        // 2) 正文
        const markdown = String((payload as any).contentMarkdown || '');
        const html = String((payload as any).contentHtml || '');
        const fallbackText = html ? htmlToPlainText(html) || markdown : markdown;
        console.log('[csdn-fill] Content length:', markdown.length);

        // 等待编辑器出现
        const editorSelectors = '.CodeMirror, .monaco-editor, .cm-content, .cm-editor, textarea, .ProseMirror, .ql-editor, [contenteditable="true"]';
        await waitFor(
          () =>
            queryAllDeep(editorSelectors)
              .map((e) => e as HTMLElement)
              .find((e) => isVisible(e) && !isLikelyTitle(e)) || null,
          25000
        ).catch(() => null);
        
        // 额外等待编辑器初始化
        await sleep(2000);
        
        // 打印调试信息
        const allEditors = queryAllDeep(editorSelectors)
          .map((e) => e as HTMLElement)
          .filter((e) => isVisible(e) && !isLikelyTitle(e));
        console.log('[csdn-fill] All visible editors:', allEditors.map(e => ({
          tag: e.tagName,
          class: e.className?.substring?.(0, 60),
          id: e.id,
          area: Math.round(getRectArea(e)),
        })));

        let ok =
          tryFillCodeMirror5(markdown) ||
          tryFillMonaco(markdown) ||
          (await tryFillCodeMirror6(markdown)) ||
          tryFillTextarea(markdown) ||
          (await tryFillContentEditable(markdown));

        console.log('[csdn-fill] Fill result:', ok);

        if (!ok && isMarkdownEditorPage()) {
          throw new Error('未找到可写入的 Markdown 编辑器控件');
        }

        if (!ok) {
          console.log('[csdn-fill] Trying rich editor fallback');
          const editor = await waitFor(() => findBestRichEditor(), 25000);
          await fillRichEditor(editor, html, fallbackText);
        }

        // 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[csdn] 内容填充完成');
        console.log('[csdn] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[csdn-fill] Error:', error);
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
