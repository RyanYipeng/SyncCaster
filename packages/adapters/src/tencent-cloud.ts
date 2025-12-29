import type { PlatformAdapter } from './base';

/**
 * 腾讯云开发者社区适配器
 * 
 * 平台特点：
 * - 入口：https://cloud.tencent.com/developer/article/write-new（Markdown 模式）
 * - 编辑器：可切换富文本/Markdown
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 * - 图片：支持粘贴上传，外链图片可能无法正常显示
 * 
 * 发布策略：
 * - 直接填充 Markdown 原文到编辑器
 * - 通过粘贴上传方式处理图片，获取站内链接
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

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
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

  async publish() {
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

      // 规范化 Markdown 图片链接（去除 URL 中的空格/换行）
      const normalizeMarkdownImageUrls = (markdown: string): string => {
        if (!markdown) return markdown;
        return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, rawInner: string) => {
          let inner = String(rawInner || '').trim();
          let titlePart = '';
          const quoteIdx = inner.search(/["']/);
          if (quoteIdx > 0) {
            titlePart = inner.slice(quoteIdx).trim();
            inner = inner.slice(0, quoteIdx).trimEnd();
          }
          if (inner.startsWith('<') && inner.endsWith('>')) {
            inner = inner.slice(1, -1);
          }
          const normalizedUrl = inner.replace(/\s+/g, '');
          return `![${alt}](${normalizedUrl}${titlePart ? ' ' + titlePart : ''})`;
        });
      };

      // 从文本中提取 URL
      const extractUrls = (text: string): string[] => {
        const re = /((?:https?:)?\/\/[^\s)'"<>]+)/g;
        const urls: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const u = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
          urls.push(u);
        }
        return urls;
      };

      // 将 dataURL 转换为 Blob
      const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
        const res = await fetch(dataUrl);
        if (!res.ok) throw new Error('dataURL fetch failed: ' + res.status);
        return await res.blob();
      };

      // 将 Blob 转换为指定格式
      const convertBlobTo = async (blob: Blob, targetMime: string): Promise<Blob> => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        try {
          img.src = url;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image load failed'));
          });

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 1;
          canvas.height = img.naturalHeight || 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context not available');
          if (targetMime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0);

          return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
              targetMime,
              0.92
            );
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      // MIME 类型转扩展名
      const mimeToExt = (mime: string) => {
        const m = (mime || '').toLowerCase();
        if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
        if (m.includes('png')) return 'png';
        if (m.includes('gif')) return 'gif';
        if (m.includes('webp')) return 'webp';
        return 'png';
      };

      // 构建适合腾讯云的图片文件
      const buildFileForTencentCloud = async (imgData: any, index: number): Promise<File> => {
        const blob0 = await dataUrlToBlob(imgData.base64);
        const declaredMime = (blob0.type || imgData.mimeType || 'image/png').toLowerCase();
        const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
        let blob = blob0;
        let mime = declaredMime;

        if (!allowed.has(mime)) {
          blob = await convertBlobTo(blob0, 'image/png');
          mime = 'image/png';
        }

        const ext = mimeToExt(mime);
        const filename = `image_${Date.now()}_${index}.${ext}`;
        return new File([blob], filename, { type: mime });
      };

      // 模拟粘贴文件
      const simulatePasteFile = (target: HTMLElement, file: File): boolean => {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(evt, 'clipboardData', { get: () => dt });
          return target.dispatchEvent(evt);
        } catch (e) {
          console.warn('[tencent-cloud] simulatePasteFile failed', e);
          return false;
        }
      };

      // 模拟拖放文件
      const simulateDropFile = (target: HTMLElement, file: File): boolean => {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(dragOver, 'dataTransfer', { get: () => dt });
          target.dispatchEvent(dragOver);
          const drop = new DragEvent('drop', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(drop, 'dataTransfer', { get: () => dt });
          return target.dispatchEvent(drop);
        } catch (e) {
          console.warn('[tencent-cloud] simulateDropFile failed', e);
          return false;
        }
      };

      // 等待文本中出现新的 URL
      const waitForNewUrlInText = async (
        getText: () => string,
        beforeText: string,
        originalUrl: string,
        timeoutMs: number
      ): Promise<string> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const current = getText() || '';
          if (current !== beforeText) {
            const urls = extractUrls(current);
            for (let i = urls.length - 1; i >= 0; i--) {
              const u = urls[i];
              if (!u) continue;
              if (u === originalUrl) continue;
              if (beforeText.includes(u)) continue;
              return u;
            }
          }
          await sleep(200);
        }
        throw new Error('waitForNewUrlInText timeout');
      };

      // 查找标题输入框
      const findTitleField = (): HTMLElement | null => {
        const selectors = [
          '.J-title-input',
          '.article-title-input',
          '.write-title input',
          '.write-title textarea',
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

      type EditorResult = { ok: boolean; getText?: () => string; pasteTarget?: HTMLElement };

      // 填充 CodeMirror 5
      const tryFillCodeMirror5 = (markdown: string): EditorResult => {
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
            return {
              ok: true,
              getText: () => cm.getValue() || '',
              pasteTarget: (cmEl.querySelector?.('.CodeMirror-scroll') as HTMLElement | null) ||
                          (cmEl.querySelector?.('textarea') as HTMLElement | null) ||
                          (cmEl as HTMLElement),
            };
          }
        }
        return { ok: false };
      };

      // 填充 Monaco
      const tryFillMonaco = (markdown: string): EditorResult => {
        console.log('[tencent-cloud] Trying Monaco...');
        const monacoRoot = queryAllDeep('.monaco-editor').find(isVisible) as HTMLElement | undefined;
        console.log('[tencent-cloud] Found .monaco-editor:', !!monacoRoot);
        if (!monacoRoot) return { ok: false };
        try {
          const monaco = (window as any).monaco;
          const models = monaco?.editor?.getModels?.() as any[] | undefined;
          if (models?.length) {
            console.log('[tencent-cloud] Monaco models found:', models.length);
            for (const m of models) {
              m?.setValue?.('');
              m?.setValue?.(markdown);
            }
            return {
              ok: true,
              getText: () => models[0]?.getValue?.() || '',
              pasteTarget: monacoRoot.querySelector('.view-lines') as HTMLElement || monacoRoot,
            };
          }
        } catch {}
        return { ok: false };
      };

      // 填充 CodeMirror 6
      const tryFillCodeMirror6 = async (markdown: string): Promise<EditorResult> => {
        console.log('[tencent-cloud] Trying CodeMirror 6...');
        const cm6 = queryAllDeep('.cm-content[contenteditable="true"], .cm-editor .cm-content')
          .map(e => e as HTMLElement)
          .find(isVisible);
        console.log('[tencent-cloud] Found .cm-content:', !!cm6);
        if (!cm6) return { ok: false };
        
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
            return {
              ok: true,
              getText: () => view.state?.doc?.toString?.() || '',
              pasteTarget: cm6,
            };
          }
        } catch {}
        return { ok: false };
      };

      // 填充 textarea
      const tryFillTextarea = (markdown: string): EditorResult => {
        console.log('[tencent-cloud] Trying textarea...');
        const tas = queryAllDeep('textarea')
          .map(e => e as HTMLTextAreaElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000);
        console.log('[tencent-cloud] Found textareas:', tas.length);
        if (!tas.length) return { ok: false };
        tas.sort((a, b) => getRectArea(b) - getRectArea(a));
        const ta = tas[0];
        console.log('[tencent-cloud] Using textarea:', ta.className, getRectArea(ta));
        setNativeValue(ta, '');
        setNativeValue(ta, markdown);
        return {
          ok: true,
          getText: () => ta.value || '',
          pasteTarget: ta,
        };
      };

      // 填充 contenteditable
      const tryFillContentEditable = async (markdown: string): Promise<EditorResult> => {
        console.log('[tencent-cloud] Trying contenteditable...');
        const editables = queryAllDeep('[contenteditable="true"]')
          .map(e => e as HTMLElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000);
        console.log('[tencent-cloud] Found contenteditable elements:', editables.length);
        if (!editables.length) return { ok: false };
        
        editables.sort((a, b) => getRectArea(b) - getRectArea(a));
        const target = editables[0];
        console.log('[tencent-cloud] Using contenteditable:', target.className, getRectArea(target));
        
        const doc = target.ownerDocument;
        const win = doc.defaultView || window;
        
        target.innerHTML = '';
        target.focus();
        await sleep(100);
        
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
            return {
              ok: true,
              getText: () => target.innerText || target.textContent || '',
              pasteTarget: target,
            };
          }
        } catch {}
        
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
        return {
          ok: true,
          getText: () => target.innerText || target.textContent || '',
          pasteTarget: target,
        };
      };

      try {
        console.log('[tencent-cloud] Waiting for page initialization...');
        await sleep(3000);
        
        const downloadedImages = (payload as any).__downloadedImages || [];
        console.log('[tencent-cloud] 下载的图片:', downloadedImages.length);
        
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
        
        titleField.focus();
        await sleep(100);
        
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        await sleep(200);
        titleField.dispatchEvent(new Event('input', { bubbles: true }));
        titleField.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[tencent-cloud] Title filled:', title);
        await sleep(500);

        // 2. 填充内容
        console.log('[tencent-cloud] Step 2: 填充内容');
        const originalMarkdown = normalizeMarkdownImageUrls((payload as any).contentMarkdown || '');
        let markdown = originalMarkdown;
        console.log('[tencent-cloud] Content length:', markdown.length);
        
        const editorSelectors = '.CodeMirror, .monaco-editor, .cm-content, .cm-editor, textarea, [contenteditable="true"]';
        await waitFor(
          () => queryAllDeep(editorSelectors)
            .map(e => e as HTMLElement)
            .find(e => isVisible(e) && !isLikelyTitle(e) && getRectArea(e) > 5000) || null,
          25000
        ).catch(() => null);
        
        await sleep(2000);
        
        const allEditors = queryAllDeep(editorSelectors)
          .map(e => e as HTMLElement)
          .filter(e => isVisible(e) && !isLikelyTitle(e));
        console.log('[tencent-cloud] 找到的编辑器:', allEditors.map(e => ({
          tag: e.tagName,
          class: e.className?.substring?.(0, 60),
          area: Math.round(getRectArea(e)),
        })));

        let editorResult: EditorResult = { ok: false };
        
        editorResult = tryFillCodeMirror5(markdown);
        if (!editorResult.ok) editorResult = tryFillMonaco(markdown);
        if (!editorResult.ok) editorResult = await tryFillCodeMirror6(markdown);
        if (!editorResult.ok) editorResult = tryFillTextarea(markdown);
        if (!editorResult.ok) editorResult = await tryFillContentEditable(markdown);

        if (!editorResult.ok) {
          throw new Error('未找到可写入的编辑器控件');
        }

        await sleep(500);

        // 2.1 图片转链
        if (downloadedImages.length > 0 && editorResult.pasteTarget && editorResult.getText) {
          console.log('[tencent-cloud] Step 2.1: 图片转链（粘贴上传）');
          const oldAlert = window.alert;
          try {
            (window as any).alert = (...args: any[]) => console.warn('[tencent-cloud] alert suppressed:', ...args);

            const urlMap = new Map<string, string>();
            const getText = editorResult.getText;
            const pasteTarget = editorResult.pasteTarget;
            const before = getText();

            const clearEditor = () => {
              tryFillCodeMirror5('');
              tryFillMonaco('');
              tryFillTextarea('');
            };

            const restoreEditor = async (content: string) => {
              let r = tryFillCodeMirror5(content);
              if (r.ok) return;
              r = tryFillMonaco(content);
              if (r.ok) return;
              r = await tryFillCodeMirror6(content);
              if (r.ok) return;
              r = tryFillTextarea(content);
              if (r.ok) return;
              await tryFillContentEditable(content);
            };

            clearEditor();
            await sleep(200);

            for (let i = 0; i < downloadedImages.length; i++) {
              const imgData = downloadedImages[i];
              try {
                const file = await buildFileForTencentCloud(imgData, i);

                pasteTarget.focus?.();
                const beforeText = getText();

                let ok = simulatePasteFile(pasteTarget, file);
                if (!ok) ok = simulateDropFile(pasteTarget, file);

                const newUrl = await waitForNewUrlInText(getText, beforeText, imgData.url, 40000);
                urlMap.set(imgData.url, newUrl);
                console.log('[tencent-cloud] 图片上传成功:', newUrl);

                clearEditor();
                await sleep(200);
              } catch (e) {
                console.warn('[tencent-cloud] 单张图片转链失败，跳过', imgData?.url, e);
              }
            }

            await restoreEditor(before);
            await sleep(200);

            if (urlMap.size > 0) {
              for (const [oldUrl, newUrl] of urlMap) {
                markdown = markdown.split(oldUrl).join(newUrl);
              }
              await restoreEditor(markdown);
              await sleep(500);
              console.log('[tencent-cloud] 图片转链完成:', urlMap.size);
            } else {
              console.warn('[tencent-cloud] 未获得任何图片站内链接，保留外链');
              await restoreEditor(markdown);
              await sleep(200);
            }
          } finally {
            window.alert = oldAlert;
          }
        }

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
