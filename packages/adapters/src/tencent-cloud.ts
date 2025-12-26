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
      console.log('[tencent-cloud] Current URL:', window.location.href);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        console.log('[tencent-cloud] Waiting for page to load...');
        await new Promise<void>(resolve => {
          window.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      }

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
          } catch {}
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

      const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
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

      // 查找标题输入框
      const findTitleField = (): HTMLElement | null => {
        // 腾讯云可能的标题选择器（按优先级）
        const selectors = [
          // 腾讯云特定选择器
          '.J-title-input',
          '.article-title-input',
          '.write-title input',
          '.write-title textarea',
          // 常见标题输入框
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input[placeholder*="请输入标题"]',
          'input[placeholder*="文章标题"]',
          '.article-title input',
          '.title-input input',
          '.editor-title input',
          'input[name="title"]',
          'input#title',
        ];
        
        for (const sel of selectors) {
          const el = queryAllDeep(sel).find(isVisible) as HTMLElement | undefined;
          if (el) {
            console.log('[tencent-cloud] Found title via selector:', sel);
            return el;
          }
        }
        
        // 回退：查找页面顶部的大输入框或 textarea
        const candidates = queryAllDeep('input, textarea')
          .map(e => e as HTMLInputElement | HTMLTextAreaElement)
          .filter(e => {
            if (!isVisible(e)) return false;
            if ((e as HTMLInputElement).type === 'hidden' || 
                (e as HTMLInputElement).type === 'checkbox' || 
                (e as HTMLInputElement).type === 'radio') return false;
            return isLikelyTitle(e);
          });
        
        if (candidates.length > 0) {
          candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
          });
          console.log('[tencent-cloud] Found title via fallback:', candidates[0].tagName);
          return candidates[0];
        }
        
        return null;
      };

      // 填充 CodeMirror 5
      const tryFillCodeMirror5 = (markdown: string): boolean => {
        console.log('[tencent-cloud] Trying CodeMirror 5...');
        const cmEls = queryAllDeep('.CodeMirror').filter(isVisible) as any[];
        console.log('[tencent-cloud] Found .CodeMirror elements:', cmEls.length);
        for (const cmEl of cmEls) {
          const cm = cmEl?.CodeMirror;
          if (cm?.setValue) {
            console.log('[tencent-cloud] CodeMirror 5 instance found, setting value');
            cm.setValue('');
            cm.setValue(markdown);
            cm.refresh?.();
            try {
              const ta = cmEl.querySelector?.('textarea') as HTMLTextAreaElement | null;
              ta?.dispatchEvent(new Event('input', { bubbles: true }));
            } catch {}
            return true;
          }
        }
        return false;
      };

      // 填充 Monaco
      const tryFillMonaco = (markdown: string): boolean => {
        console.log('[tencent-cloud] Trying Monaco...');
        const monacoRoot = queryAllDeep('.monaco-editor').find(isVisible) as HTMLElement | undefined;
        console.log('[tencent-cloud] Found .monaco-editor:', !!monacoRoot);
        if (!monacoRoot) return false;
        try {
          const monaco = (window as any).monaco;
          const models = monaco?.editor?.getModels?.() as any[] | undefined;
          if (models?.length) {
            console.log('[tencent-cloud] Monaco models found:', models.length);
            for (const m of models) {
              m?.setValue?.('');
              m?.setValue?.(markdown);
            }
            return true;
          }
        } catch {}
        return false;
      };

      // 填充 CodeMirror 6
      const tryFillCodeMirror6 = async (markdown: string): Promise<boolean> => {
        console.log('[tencent-cloud] Trying CodeMirror 6...');
        const cm6 = queryAllDeep('.cm-content[contenteditable="true"], .cm-editor .cm-content')
          .map(e => e as HTMLElement)
          .find(isVisible);
        console.log('[tencent-cloud] Found .cm-content:', !!cm6);
        if (!cm6) return false;
        
        try {
          const cmEditor = cm6.closest('.cm-editor') as any;
          let view: any = null;
          
          if (cmEditor?.cmView?.view) view = cmEditor.cmView.view;
          
          if (!view && cmEditor) {
            for (const key of Object.keys(cmEditor)) {
              const val = cmEditor[key];
              if (val && typeof val === 'object' && val.dispatch && val.state?.doc) {
                view = val;
                break;
              }
            }
          }
          
          if (view?.dispatch && view?.state?.doc) {
            console.log('[tencent-cloud] Dispatching to CodeMirror 6 view');
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: markdown },
            });
            return true;
          }
        } catch {}
        return false;
      };

      // 填充 textarea（排除标题框）
      const tryFillTextarea = (markdown: string): boolean => {
        console.log('[tencent-cloud] Trying textarea...');
        const tas = queryAllDeep('textarea')
          .map(e => e as HTMLTextAreaElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000);
        console.log('[tencent-cloud] Found textareas:', tas.length);
        if (!tas.length) return false;
        tas.sort((a, b) => getRectArea(b) - getRectArea(a));
        const ta = tas[0];
        console.log('[tencent-cloud] Using textarea:', ta.className, getRectArea(ta));
        setNativeValue(ta, '');
        setNativeValue(ta, markdown);
        return true;
      };

      // 填充 contenteditable（排除标题框）
      const tryFillContentEditable = async (markdown: string): Promise<boolean> => {
        console.log('[tencent-cloud] Trying contenteditable...');
        const editables = queryAllDeep('[contenteditable="true"]')
          .map(e => e as HTMLElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000);
        console.log('[tencent-cloud] Found contenteditable elements:', editables.length);
        if (!editables.length) return false;
        
        editables.sort((a, b) => getRectArea(b) - getRectArea(a));
        const target = editables[0];
        console.log('[tencent-cloud] Using contenteditable:', target.className, getRectArea(target));
        
        const doc = target.ownerDocument;
        const win = doc.defaultView || window;
        
        target.innerHTML = '';
        target.focus();
        await sleep(100);
        
        // 方式1：模拟粘贴纯文本
        try {
          const sel = win.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = doc.createRange();
            range.selectNodeContents(target);
            sel.addRange(range);
          }
          
          const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
          const dt = new DT();
          dt.setData('text/plain', markdown);
          const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
          const pasteEvt = new CE('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(pasteEvt, 'clipboardData', { get: () => dt });
          target.dispatchEvent(pasteEvt);
          await sleep(300);
          
          if (target.textContent && target.textContent.includes(markdown.substring(0, 20))) {
            console.log('[tencent-cloud] Paste simulation worked');
            return true;
          }
        } catch {}
        
        // 方式2：逐行插入
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
        return true;
      };

      try {
        // 等待页面加载
        console.log('[tencent-cloud] Waiting for page initialization...');
        await sleep(3000);
        
        // 打印页面元素调试信息
        console.log('[tencent-cloud] Page elements:');
        console.log('  - inputs:', document.querySelectorAll('input').length);
        console.log('  - textareas:', document.querySelectorAll('textarea').length);
        console.log('  - contenteditable:', document.querySelectorAll('[contenteditable="true"]').length);
        console.log('  - CodeMirror:', document.querySelectorAll('.CodeMirror').length);
        
        // 1. 填充标题
        console.log('[tencent-cloud] Step 1: 填充标题');
        const titleField = await waitFor(() => findTitleField(), 25000);
        const title = String((payload as any).title || '');
        console.log('[tencent-cloud] 找到标题输入框:', titleField?.tagName, titleField?.className);
        
        // 聚焦并填充标题
        titleField.focus();
        await sleep(100);
        
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // 模拟用户输入触发表单验证
        await sleep(200);
        titleField.focus();
        document.execCommand?.('insertText', false, ' ');
        await sleep(50);
        document.execCommand?.('delete', false);
        titleField.dispatchEvent(new Event('input', { bubbles: true }));
        titleField.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[tencent-cloud] Title filled:', title);
        await sleep(500);

        // 2. 填充内容
        console.log('[tencent-cloud] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        console.log('[tencent-cloud] Content length:', markdown.length);
        
        // 等待编辑器出现
        const editorSelectors = '.CodeMirror, .monaco-editor, .cm-content, .cm-editor, textarea, [contenteditable="true"]';
        await waitFor(
          () => queryAllDeep(editorSelectors)
            .map(e => e as HTMLElement)
            .find(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000) || null,
          25000
        ).catch(() => null);
        
        // 额外等待编辑器初始化
        await sleep(2000);
        
        // 打印调试信息
        const allEditors = queryAllDeep(editorSelectors)
          .map(e => e as HTMLElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e));
        console.log('[tencent-cloud] 找到的编辑器:', allEditors.map(e => ({
          tag: e.tagName,
          class: e.className?.substring?.(0, 60),
          area: Math.round(getRectArea(e)),
        })));

        const ok =
          tryFillCodeMirror5(markdown) ||
          tryFillMonaco(markdown) ||
          (await tryFillCodeMirror6(markdown)) ||
          tryFillTextarea(markdown) ||
          (await tryFillContentEditable(markdown));

        if (!ok) {
          throw new Error('未找到可写入的编辑器控件');
        }

        await sleep(500);

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
