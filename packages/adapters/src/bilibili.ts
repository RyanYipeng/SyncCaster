import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 哔哩哔哩专栏（Quill 富文本）
 *
 * 平台特点：
 * - 入口：https://member.bilibili.com/platform/upload/text/edit
 * - 编辑器：Quill 富文本编辑器，不支持 Markdown 识别
 * - 支持：HTML/富文本内容粘贴
 * - 图片：由 publish-engine 在站内粘贴上传，获得可发布的 URL 后替换进正文
 * 
 * 发布策略：
 * - 将 Markdown 转换为富文本 HTML 后注入编辑器
 * - 保留原有排版与样式（标题、段落、列表、引用、代码块等）
 * - 不执行最终发布操作，由用户手动完成
 */
export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  name: '哔哩哔哩专栏',
  kind: 'dom',
  icon: 'bilibili',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false, // B 站专栏不支持 Markdown 识别
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 20, concurrent: 1 },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    // B 站专栏不支持 Markdown 识别，必须转换为富文本 HTML
    // 转换结果基于实时预览的渲染结构，尽可能保留原有排版与样式
    let markdown = post.body_md || '';
    
    // B 站专栏通常不支持 LaTeX 渲染：去掉 $ 包裹，保留表达式
    markdown = markdown.replace(/\$([^$\n]+)\$/g, '$1');
    markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, '\n$1\n');

    // 将 Markdown 转换为富文本 HTML
    const contentHtml = renderMarkdownToHtmlForPaste(markdown);
    
    return {
      title: post.title,
      contentMarkdown: markdown, // 保留原始 Markdown（用于调试）
      contentHtml, // 必须使用转换后的 HTML
      tags: post.tags,
      categories: post.categories,
      cover: post.cover,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('bilibili: use DOM automation');
  },

  dom: {
    matchers: ['https://member.bilibili.com/platform/upload/text/edit*'],
    fillAndPublish: async function (payload) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        const win = he.ownerDocument?.defaultView || window;
        const style = win.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const getAllDocs = (): Document[] => {
        const docs: Document[] = [document];
        const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) docs.push(doc);
          } catch {
            // ignore cross-origin frames
          }
        }
        return docs;
      };

      const queryInAllDocs = (selector: string): HTMLElement | null => {
        for (const doc of getAllDocs()) {
          const el = doc.querySelector(selector) as HTMLElement | null;
          if (el && isVisible(el)) return el;
        }
        return null;
      };

      const waitForAny = async (selectors: string[], timeoutMs = 30000): Promise<HTMLElement> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          for (const sel of selectors) {
            const el = queryInAllDocs(sel);
            if (el) return el;
          }
          await sleep(200);
        }
        throw new Error(`等待元素超时: ${selectors.join(', ')}`);
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

      const clearEditor = (editor: HTMLElement, quill: any | null) => {
        try {
          if (quill?.setText) {
            quill.setText('');
            return;
          }
        } catch {}
        editor.innerHTML = '';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      };

      const getQuill = (editor: HTMLElement): any | null => {
        const win = editor.ownerDocument?.defaultView || window;
        const QuillCtor = (win as any).Quill;
        return (
          QuillCtor?.find?.(editor) ||
          (editor as any).__quill ||
          ((editor.closest('.ql-container') as any)?.__quill ?? null)
        );
      };


      /**
       * 将 HTML 规范化为 Quill 可识别的格式
       * 保留原有排版与样式：标题层级、段落换行、加粗斜体、列表、引用、代码块等
       */
      const normalizeHtmlForQuill = (html: string): string => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || '', 'text/html');

        // 代码块：转换为 Quill 的 `ql-syntax` 格式
        doc.querySelectorAll('pre').forEach((pre) => {
          const code = pre.querySelector('code');
          const text = (code?.textContent || pre.textContent || '').replace(/\r\n/g, '\n');
          const out = doc.createElement('pre');
          out.setAttribute('spellcheck', 'false');
          out.classList.add('ql-syntax');
          out.style.whiteSpace = 'pre';
          out.style.overflowX = 'auto';
          out.style.background = '#f6f8fa';
          out.style.padding = '12px 14px';
          out.style.borderRadius = '8px';
          out.style.fontFamily =
            'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace';
          const lang =
            (code?.getAttribute('class') || '')
              .split(/\s+/)
              .find((c) => c.startsWith('language-'))
              ?.slice('language-'.length) || '';
          if (lang) out.setAttribute('data-language', lang);
          out.textContent = text;
          pre.replaceWith(out);
        });

        // 行内 code：保留 <code> 标签，补充基础样式
        doc.querySelectorAll('code').forEach((code) => {
          if (code.closest('pre')) return;
          const el = code as HTMLElement;
          el.style.fontFamily =
            'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace';
          el.style.background = '#f6f8fa';
          el.style.borderRadius = '4px';
          el.style.padding = '2px 4px';
        });

        // 引用：将 blockquote 转成 div + 样式，保留多级嵌套的视觉结构
        const allBlockquotes = Array.from(doc.querySelectorAll('blockquote')) as HTMLElement[];
        allBlockquotes.reverse();
        for (const bq of allBlockquotes) {
          let depth = 0;
          let p: HTMLElement | null = bq;
          while (p) {
            if (p.tagName === 'BLOCKQUOTE') depth++;
            p = p.parentElement;
          }
          const indent = Math.max(0, depth - 1);
          const wrapper = doc.createElement('div');
          wrapper.setAttribute('data-synccaster-quote', '1');
          wrapper.style.borderLeft = '4px solid #d0d7de';
          wrapper.style.paddingLeft = '12px';
          wrapper.style.margin = '10px 0';
          wrapper.style.marginLeft = `${indent * 14}px`;
          wrapper.style.color = '#57606a';
          wrapper.innerHTML = bq.innerHTML;
          bq.replaceWith(wrapper);
        }

        // 表格：添加基础样式
        doc.querySelectorAll('table').forEach((table) => {
          (table as HTMLElement).style.borderCollapse = 'collapse';
          (table as HTMLElement).style.width = '100%';
          table.querySelectorAll('th,td').forEach((cell) => {
            (cell as HTMLElement).style.border = '1px solid #d0d7de';
            (cell as HTMLElement).style.padding = '6px 10px';
          });
          table.querySelectorAll('thead th').forEach((cell) => {
            (cell as HTMLElement).style.background = '#f6f8fa';
          });
        });

        // 去掉潜在的脚本/样式，避免被编辑器过滤导致异常
        doc.querySelectorAll('script, style').forEach((el) => el.remove());
        return doc.body.innerHTML;
      };

      const pasteHtml = async (editor: HTMLElement, quill: any | null, html: string, fallbackText: string) => {
        const doc = editor.ownerDocument;
        const win = doc.defaultView || window;

        // 1) Quill API 优先
        try {
          if (quill?.clipboard?.dangerouslyPasteHTML) {
            clearEditor(editor, quill);
            // 大内容在部分站点会被 Quill/clipboard 截断：拆分为块按顺序写入
            const parsed = new win.DOMParser().parseFromString(html || '', 'text/html');
            const nodes = Array.from(parsed.body.childNodes)
              .map((n) => (n as any).outerHTML || (n.textContent ? `<p>${n.textContent}</p>` : ''))
              .filter((s) => String(s || '').trim().length > 0);
            const MAX_CHUNK = 12000;
            let buf = '';
            const flush = (atStart: boolean) => {
              const chunk = buf;
              buf = '';
              if (!chunk) return;
              const idx = atStart ? 0 : Math.max(0, (quill.getLength?.() ?? 1) - 1);
              quill.clipboard.dangerouslyPasteHTML(idx, chunk);
            };

            let first = true;
            for (const part of nodes.length > 0 ? nodes : [html]) {
              if ((buf + part).length > MAX_CHUNK && buf) {
                flush(first);
                first = false;
              }
              buf += part;
            }
            flush(first);
            quill.setSelection?.(quill.getLength?.() ?? 0, 0);
            await sleep(250);
            return;
          }
        } catch {}

        // 2) 粘贴事件（HTML + text）
        try {
          const DT = (win as any).DataTransfer || (globalThis as any).DataTransfer;
          const dt = new DT();
          if (html) dt.setData('text/html', html);
          dt.setData('text/plain', fallbackText);
          const CE = (win as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
          const evt = new CE('paste', { bubbles: true, cancelable: true } as any);
          Object.defineProperty(evt, 'clipboardData', { get: () => dt });
          editor.focus();
          editor.dispatchEvent(evt);
          await sleep(300);
          return;
        } catch {}

        // 3) execCommand / innerHTML
        try {
          editor.focus();
          const ok = doc.execCommand?.('insertHTML', false, html);
          if (!ok) {
            editor.innerHTML = html;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch {
          editor.innerHTML = html;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };

      try {
        console.log('[bilibili] fillAndPublish starting');
        console.log('[bilibili] ⚠️ B 站专栏不支持 Markdown，将使用富文本 HTML 填充');
        
        // 检查是否有图片需要处理
        const downloadedImages = (payload as any).__downloadedImages || [];
        const hasExternalImages = downloadedImages.length > 0;
        
        if (hasExternalImages) {
          console.log('[bilibili] 检测到', downloadedImages.length, '张图片需要上传');
          console.log('[bilibili] 图片将在内容填充后由 publish-engine 处理');
        }
        
        // 1) 定位标题与编辑器
        const titleField = await waitForAny(
          [
            'textarea[placeholder*="标题"]',
            'input[placeholder*="标题"]',
            '.title-input textarea',
            '.title-input input',
            'textarea[name*="title"]',
            'input[name*="title"]',
          ],
          25000
        );

        const editor = await waitForAny(['.ql-editor', '.ProseMirror', '[contenteditable="true"]'], 25000);
        const quill = getQuill(editor);

        // 2) 填充标题
        const title = (payload as any).title || '';
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        console.log('[bilibili] Title filled:', title);

        // 3) 获取富文本 HTML 内容（必须使用 HTML，禁止直接填充 Markdown）
        let html = String((payload as any).contentHtml || '');
        const markdownOriginal = String((payload as any).contentMarkdown || '');
        
        // 如果没有 HTML 但有 Markdown，说明 transform 阶段可能出错，这里做兜底转换
        if (!html && markdownOriginal) {
          console.warn('[bilibili] contentHtml is empty, falling back to basic conversion');
          html = `<p>${markdownOriginal.replace(/\n/g, '</p><p>')}</p>`;
        }
        
        if (!html) {
          throw new Error('无法获取富文本内容，B 站专栏不支持直接填充 Markdown');
        }

        // 4) 正文写入（HTML -> Quill）
        console.log('[bilibili] Filling content with HTML (length:', html.length, ')');
        const normalizedHtml = normalizeHtmlForQuill(html);
        const fallbackText = markdownOriginal || '';
        await pasteHtml(editor, quill, normalizedHtml, fallbackText);
        await sleep(500);
        
        // 简单校验：避免 paste 发生截断
        const expected = (fallbackText || '').trim().length;
        const actual = ((editor.innerText || editor.textContent || '').trim() || '').length;
        if (expected > 0 && actual > 0 && actual < expected * 0.85) {
          console.log('[bilibili] Content may be truncated, retrying paste...');
          await pasteHtml(editor, quill, normalizedHtml, fallbackText);
        }

        // 5) 检查是否有外链图片（B 站不支持外链图片显示）
        const imgElements = editor.querySelectorAll('img');
        const externalImages: string[] = [];
        imgElements.forEach((img) => {
          const src = img.getAttribute('src') || '';
          // B 站自己的图片域名
          const isBilibiliImage = /^https?:\/\/[^/]*\.hdslb\.com\//i.test(src) || 
                                   /^https?:\/\/[^/]*\.bilivideo\.com\//i.test(src) ||
                                   /^https?:\/\/i[0-9]*\.hdslb\.com\//i.test(src);
          if (src && !isBilibiliImage && !src.startsWith('data:') && !src.startsWith('blob:')) {
            externalImages.push(src);
          }
        });
        
        if (externalImages.length > 0) {
          console.warn('[bilibili] ⚠️ 检测到', externalImages.length, '张外链图片，B 站可能无法显示');
          console.warn('[bilibili] 外链图片列表:', externalImages);
          console.log('[bilibili] 提示：图片将由 publish-engine 自动上传到 B 站，请稍候...');
        }

        // 6) 内容填充完成，不执行发布操作
        console.log('[bilibili] Content fill completed');
        console.log('[bilibili] ⚠️ 发布操作需要用户手动完成');
        
        const note = externalImages.length > 0 
          ? `内容已填充完成。检测到 ${externalImages.length} 张外链图片，正在自动上传到 B 站...`
          : '内容已填充完成，请手动点击发布按钮完成发布';

        return { 
          url: window.location.href,
          __synccasterNote: note,
          __externalImages: externalImages,
        };
      } catch (error: any) {
        console.error('[bilibili] Fill failed:', error);
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
