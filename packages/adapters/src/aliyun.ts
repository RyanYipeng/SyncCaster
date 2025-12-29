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
    throw new Error('aliyun: use DOM automation');
  },

  dom: {
    matchers: [
      // ⚠️ matchers[0] 会被 publish-engine 直接拿来打开标签页，不能包含通配符
      // 阿里云新建文章页使用 hash 路由
      'https://developer.aliyun.com/article/new#/',
      'https://developer.aliyun.com/article/new*',
    ],
    fillAndPublish: async function (payload) {
      console.log('[aliyun] fillAndPublish starting', payload);
      
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

      async function replaceContentEditableText(el: HTMLElement, text: string) {
        el.focus();
        try {
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.addRange(range);
          }
          if (document.execCommand) {
            const ok = document.execCommand('insertText', false, text);
            if (ok) return;
          }
        } catch (e) {}
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
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

      function normalizeMarkdownImageUrls(markdown: string): string {
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
      }

      try {
        const downloadedImages = (payload as any).__downloadedImages || [];
        console.log('[aliyun] 下载的图片:', downloadedImages.length);

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

        const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
          const res = await fetch(dataUrl);
          if (!res.ok) throw new Error('dataURL fetch failed: ' + res.status);
          return await res.blob();
        };

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

        const mimeToExt = (mime: string) => {
          const m = (mime || '').toLowerCase();
          if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
          if (m.includes('png')) return 'png';
          if (m.includes('gif')) return 'gif';
          return 'png';
        };

        const buildFileForAliyun = async (imgData: any, index: number): Promise<File> => {
          const blob0 = await dataUrlToBlob(imgData.base64);
          const declaredMime = (blob0.type || imgData.mimeType || 'image/png').toLowerCase();
          const allowed = new Set(['image/jpeg', 'image/png', 'image/gif']);
          let blob = blob0;
          let mime = declaredMime;

          if (!allowed.has(mime)) {
            // 将 webp/svg 等统一转为 png，避免“只支持 jpg/jpeg/png/gif”弹窗
            blob = await convertBlobTo(blob0, 'image/png');
            mime = 'image/png';
          }

          const ext = mimeToExt(mime);
          const filename = `image_${Date.now()}_${index}.${ext}`;
          return new File([blob], filename, { type: mime });
        };

        const simulatePasteFile = (target: HTMLElement, file: File): boolean => {
          try {
            const dt = new DataTransfer();
            dt.items.add(file);
            const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true } as any);
            Object.defineProperty(evt, 'clipboardData', { get: () => dt });
            return target.dispatchEvent(evt);
          } catch (e) {
            console.warn('[aliyun] simulatePasteFile failed', e);
            return false;
          }
        };

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
            console.warn('[aliyun] simulateDropFile failed', e);
            return false;
          }
        };

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

        // 1. 填充标题
        console.log('[aliyun] Step 1: 填充标题');
        const titleInput = (await waitForAny([
          'input[placeholder*="标题"]',
          'input[placeholder*="请输入"][placeholder*="标题"]',
          'input[name="title"]',
          'input[id*="title"]',
          '.article-title input',
          '.title-input input',
          '.el-input__inner[placeholder*="标题"]',
        ])) as HTMLInputElement;
        setNativeValue(titleInput, (payload as any).title || '');
        await sleep(300);

        // 2. 填充内容
        console.log('[aliyun] Step 2: 填充内容');
        const originalMarkdown = normalizeMarkdownImageUrls((payload as any).contentMarkdown || '');
        let markdown = originalMarkdown;
        
        // CodeMirror 5
        const cm5 = document.querySelector('.CodeMirror') as any;
        let editorKind: 'cm5' | 'textarea' | 'editable' = 'textarea';
        let pasteTarget: HTMLElement | null = null;
        let setText: (t: string) => Promise<void> | void;
        let getText: () => string;

        if (cm5?.CodeMirror?.setValue) {
          editorKind = 'cm5';
          const cm = cm5.CodeMirror;
          setText = async (t: string) => {
            cm.setValue(t);
            cm.refresh?.();
          };
          getText = () => cm.getValue() || '';
          pasteTarget =
            (cm5.querySelector?.('.CodeMirror-scroll') as HTMLElement | null) ||
            (cm5.querySelector?.('textarea') as HTMLElement | null) ||
            (cm5 as HTMLElement);
        } else {
          // CodeMirror 6 / Bytemd / 通用 contenteditable
          const cm6Content = document.querySelector('.cm-editor .cm-content[contenteditable="true"]') as HTMLElement | null;
          if (cm6Content && isVisible(cm6Content)) {
            editorKind = 'editable';
            pasteTarget = cm6Content;
            setText = async (t: string) => {
              await replaceContentEditableText(cm6Content, t);
            };
            getText = () => cm6Content.innerText || cm6Content.textContent || '';
          } else {
            // textarea（优先选可见且最大的，避免选到隐藏的 store textarea）
            const textareas = Array.from(document.querySelectorAll('textarea')).filter(isVisible) as HTMLTextAreaElement[];
            const bestTextarea = pickLargest(textareas);
            if (bestTextarea) {
              editorKind = 'textarea';
              pasteTarget = bestTextarea;
              setText = async (t: string) => {
                setNativeValue(bestTextarea, t);
              };
              getText = () => bestTextarea.value || '';
            } else {
              const editable = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
              if (editable && isVisible(editable)) {
                editorKind = 'editable';
                pasteTarget = editable;
                setText = async (t: string) => {
                  await replaceContentEditableText(editable, t);
                };
                getText = () => editable.innerText || editable.textContent || '';
              } else {
                throw new Error('未找到阿里云编辑器');
              }
            }
          }
        }

        // 先填充原始正文（即便图片转链失败，也保证内容可见）
        await setText(markdown);
        await sleep(500);

        // 2.1 图片转链：对不支持外链的平台，通过“粘贴上传”获取站内 URL，再替换正文
        if (downloadedImages.length > 0 && pasteTarget) {
          console.log('[aliyun] Step 2.1: 图片转链（粘贴上传）');
          const oldAlert = window.alert;
          try {
            // 避免站点用 alert 阻塞自动化流程
            (window as any).alert = (...args: any[]) => console.warn('[aliyun] alert suppressed:', ...args);

            const urlMap = new Map<string, string>();
            const before = getText();

            // 清空编辑区用于上传（避免把临时插入内容污染正文）
            await setText('');
            await sleep(200);

            for (let i = 0; i < downloadedImages.length; i++) {
              const imgData = downloadedImages[i];
              try {
                const file = await buildFileForAliyun(imgData, i);

                pasteTarget.focus?.();
                const beforeText = getText();

                let ok = simulatePasteFile(pasteTarget, file);
                if (!ok) ok = simulateDropFile(pasteTarget, file);

                // 等待编辑区出现新的图片 URL（阿里云会插入 markdown 图片语法）
                const newUrl = await waitForNewUrlInText(getText, beforeText, imgData.url, 40000);
                urlMap.set(imgData.url, newUrl);
                console.log('[aliyun] 图片上传成功:', newUrl);

                // 清空，准备下一张
                await setText('');
                await sleep(200);
              } catch (e) {
                console.warn('[aliyun] 单张图片转链失败，跳过', imgData?.url, e);
              }
            }

            // 恢复正文并替换图片链接
            await setText(before);
            await sleep(200);

            if (urlMap.size > 0) {
              for (const [oldUrl, newUrl] of urlMap) {
                markdown = markdown.split(oldUrl).join(newUrl);
              }
              await setText(markdown);
              await sleep(500);
              console.log('[aliyun] 图片转链完成:', urlMap.size);
            } else {
              console.warn('[aliyun] 未获得任何图片站内链接，保留外链');
              await setText(markdown);
              await sleep(200);
            }
          } finally {
            window.alert = oldAlert;
          }
        }

        // 3. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[aliyun] 内容填充完成');
        console.log('[aliyun] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[aliyun] 填充失败:', error);
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
