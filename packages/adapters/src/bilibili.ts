import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 哔哩哔哩专栏（Quill 富文本）
 *
 * 关键点：
 * - 不可靠的“Markdown 直接粘贴” -> 先将 Markdown 渲染为 HTML，再写入 Quill
 * - 图片：由 publish-engine 在站内粘贴上传，获得可发布的 URL 后替换进正文（避免 data URL 导致“图片内容异常”）
 */
export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  name: '哔哩哔哩专栏',
  kind: 'dom',
  icon: 'bilibili',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false,
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
    // B 站专栏通常不支持 LaTeX 渲染：去掉 `$` 包裹，保留表达式
    let markdown = post.body_md || '';
    markdown = markdown.replace(/\$([^$\n]+)\$/g, '$1');
    markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, '\n$1\n');

    const contentHtml = renderMarkdownToHtmlForPaste(markdown);
    return {
      title: post.title,
      contentMarkdown: markdown,
      contentHtml,
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

      const normalizeHtmlForQuill = (html: string): string => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || '', 'text/html');

        // 代码块：尽量转换为 Quill 的 `ql-syntax`（若语法模块存在可直接识别；否则仍是可读的 <pre>）
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

        // 行内 code：保留 <code> 标签，并补充基础样式（Quill 支持 inline code 时可直接识别）
        doc.querySelectorAll('code').forEach((code) => {
          if (code.closest('pre')) return;
          const el = code as HTMLElement;
          el.style.fontFamily =
            'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace';
          el.style.background = '#f6f8fa';
          el.style.borderRadius = '4px';
          el.style.padding = '2px 4px';
        });

        // 引用：Quill 通常会扁平化 blockquote 嵌套；这里将 blockquote 转成 div + 样式，尽量保留多级嵌套的视觉结构
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

        // 表格：不再降级为文本，让 Quill 尝试直接粘贴为表格（若平台不支持则保持 HTML/样式退化）
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

      // 图片上传由 publish-engine 负责（先转成平台可发布 URL，再替换进正文）。

      const replaceByMap = (text: string, map: Map<string, string>): string => {
        let out = text || '';
        const entries = Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length);
        for (const [from, to] of entries) {
          if (!from || !to || from === to) continue;
          out = out.split(from).join(to);
        }
        return out;
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
        // 1) 定位标题与编辑器（B站常见：标题 textarea，正文 .ql-editor 在 iframe 内）
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

        let html = String((payload as any).contentHtml || '');
        let text = String((payload as any).contentMarkdown || '');

        // 4) 正文写入（HTML -> Quill）
        const normalizedHtml = normalizeHtmlForQuill(html);
        const fallbackText = text || '';
        await pasteHtml(editor, quill, normalizedHtml, fallbackText);
        await sleep(500);
        // 简单校验：避免 paste 发生截断（常见于极大 HTML / data URL）
        const expected = (fallbackText || '').trim().length;
        const actual = ((editor.innerText || editor.textContent || '').trim() || '').length;
        if (expected > 0 && actual > 0 && actual < expected * 0.85) {
          // 尝试重试一次（Quill 有时首次粘贴未完整）
          await pasteHtml(editor, quill, normalizedHtml, fallbackText);
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
