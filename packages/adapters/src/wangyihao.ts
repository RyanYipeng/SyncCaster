import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 网易号适配器
 *
 * 平台特点：
 * - 入口：https://mp.163.com/
 * - 编辑器：Draft.js 富文本编辑器
 * - 不支持：Markdown 识别、表格、数学公式
 *
 * 发布策略：
 * - 使用 ClipboardEvent + DataTransfer 模拟粘贴操作
 * - Draft.js 编辑器会正确处理 paste 事件中的 HTML 内容
 * - 不执行最终发布操作，由用户手动完成
 */

export const wangyihaoAdapter: PlatformAdapter = {
  id: 'wangyihao',
  name: '网易号',
  kind: 'dom',
  icon: 'wangyihao',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 20, concurrent: 1 },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    // 网易号不支持 LaTeX/表格等复杂结构：这里做降级处理，避免粘贴后结构错乱
    let markdown = post.body_md || '';

    // 公式降级：转为 code / code block，避免页面尝试渲染或出现不可控的排版
    // - block math: $$...$$ -> ```tex ... ```
    // - inline math: $...$ -> `...`
    markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => `\n\n\`\`\`tex\n${String(expr).trim()}\n\`\`\`\n\n`);
    markdown = markdown.replace(/\$([^$\n]+)\$/g, (_m, expr) => `\`${String(expr).trim()}\``);

    const contentHtml = renderMarkdownToHtmlForPaste(markdown, { stripMath: true });
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
    throw new Error('wangyihao: use DOM automation');
  },

  dom: {
    matchers: [
      'https://mp.163.com/*',
    ],
    getEditorUrl: () => 'https://mp.163.com/#/article-publish',
    fillAndPublish: async function (payload) {
      // 注意：此函数会被 `chrome.scripting.executeScript({ func })` 注入到目标页面执行。
      // 因此必须“完全自包含”，不能依赖模块作用域的函数/变量，否则会在页面里变成 undefined。
      try {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const waitFor = async <T>(getter: () => T | null, timeoutMs = 45000): Promise<T> => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const v = getter();
            if (v) return v;
            await sleep(200);
          }
          throw new Error('等待元素超时');
        };

        const htmlToPlainText = (html: string): string => {
          const div = document.createElement('div');
          div.innerHTML = html;
          return (div.innerText || div.textContent || '').trim();
        };

        const normalizeHtmlForWangyihaoPaste = (rawHtml: string): string => {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml || '', 'text/html');
            const body = doc.body;

            const normalizeSpaces = (s: string) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

            const removeTrailingBreaks = (node: Element) => {
              while (node.lastChild) {
                const last = node.lastChild;
                if (last.nodeType === Node.TEXT_NODE) {
                  if (!normalizeSpaces(last.textContent || '')) {
                    node.removeChild(last);
                    continue;
                  }
                  break;
                }
                if (last.nodeType === Node.ELEMENT_NODE && (last as Element).tagName === 'BR') {
                  node.removeChild(last);
                  continue;
                }
                break;
              }
            };

            const isEmptyBlock = (el: Element) => {
              const text = normalizeSpaces(el.textContent || '');
              if (text) return false;
              // 保留媒体/分割线等“非文本内容”
              if (el.querySelector('img,video,audio,iframe,svg,canvas,hr')) return false;
              return true;
            };

            // 1) 标题降级：网易号对 h1-h6 支持不稳定，转换为粗体段落并尝试保留层级（字体大小可能被平台过滤）
            body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
              const level = Number(h.tagName.slice(1)) || 2;
              const text = normalizeSpaces(h.textContent || '');
              if (!text) {
                h.remove();
                return;
              }
              const p = doc.createElement('p');
              const strong = doc.createElement('strong');
              const span = doc.createElement('span');
              const sizeMap: Record<number, string> = { 1: '22px', 2: '20px', 3: '18px', 4: '16px', 5: '16px', 6: '16px' };
              span.setAttribute('style', `font-size:${sizeMap[level] || '16px'};line-height:1.6;`);
              span.textContent = text;
              strong.appendChild(span);
              p.appendChild(strong);
              h.replaceWith(p);
            });

            // 2) 代码块：去掉高亮 span 等富文本，保留纯文本（尽量让平台识别为代码样式）
            body.querySelectorAll('pre').forEach((pre) => {
              const text = (pre.textContent || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
              const newPre = doc.createElement('pre');
              const code = doc.createElement('code');
              code.textContent = text;
              newPre.appendChild(code);
              pre.replaceWith(newPre);
            });

            body.querySelectorAll('code').forEach((code) => {
              if (code.querySelector('*')) {
                code.textContent = (code.textContent || '').replace(/\r\n/g, '\n');
              }
            });

            // 3) 表格：网易号不支持 table，降级为 pre（TSV），避免“乱套”
            body.querySelectorAll('table').forEach((table) => {
              const rows = Array.from(table.querySelectorAll('tr'))
                .map((tr) =>
                  Array.from(tr.children)
                    .map((cell) => normalizeSpaces((cell as HTMLElement).innerText || cell.textContent || ''))
                    .join('\t')
                )
                .filter((line) => normalizeSpaces(line).length > 0);
              const pre = doc.createElement('pre');
              pre.textContent = rows.join('\n');
              table.replaceWith(pre);
            });

            // 4) 清理空段落/空引用行
            body.querySelectorAll('p,blockquote').forEach((el) => {
              removeTrailingBreaks(el);
            });

            // 5) 列表：Draft.js 对 li 内多段落/空段落转换容易生成空白条目，做扁平化
            body.querySelectorAll('li').forEach((li) => {
              // 删除 li 内的空 p
              li.querySelectorAll('p').forEach((p) => {
                removeTrailingBreaks(p);
                if (isEmptyBlock(p)) p.remove();
              });

              // 将 li 内的多个 <p> 合并为同一条目内容（用单个 <br> 分隔，避免产生“空白条目”）
              const pChildren = Array.from(li.children).filter((c) => c.tagName === 'P') as HTMLElement[];
              if (pChildren.length > 0) {
                const insertBefore = Array.from(li.children).find((c) => c.tagName !== 'P') || null;
                const frag = doc.createDocumentFragment();
                pChildren.forEach((p, idx) => {
                  removeTrailingBreaks(p);
                  while (p.firstChild) frag.appendChild(p.firstChild);
                  if (idx < pChildren.length - 1) frag.appendChild(doc.createElement('br'));
                });
                pChildren.forEach((p) => p.remove());
                li.insertBefore(frag, insertBefore);
              }

              removeTrailingBreaks(li);
            });

            // 6) 移除全局空块，避免产生空白列表项/空白引用行
            const removableSelectors = ['p', 'blockquote'];
            for (const sel of removableSelectors) {
              body.querySelectorAll(sel).forEach((el) => {
                removeTrailingBreaks(el);
                if (isEmptyBlock(el)) el.remove();
              });
            }
            body.querySelectorAll('li').forEach((li) => {
              removeTrailingBreaks(li);
              if (isEmptyBlock(li)) li.remove();
            });
            body.querySelectorAll('ul,ol').forEach((list) => {
              if (isEmptyBlock(list)) list.remove();
            });

            // 清掉 body 里仅由空白/br 组成的文本节点
            removeTrailingBreaks(body);

            return body.innerHTML || '';
          } catch (e) {
            console.log('[wangyihao] normalizeHtmlForWangyihaoPaste 失败，使用原始 HTML:', e);
            return rawHtml || '';
          }
        };

        const focusAndPlaceCaret = async (el: HTMLElement) => {
          try {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
          } catch {}
          el.focus();
          await sleep(50);

          // 将光标/选区放到编辑器内，确保 execCommand 生效
          try {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              selection.addRange(range);
            }
          } catch {}
        };

        const isEditorFilled = (el: HTMLElement) => {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return text.length >= 10;
        };

        const simulatePasteHtml = (target: HTMLElement, html: string, plain: string): boolean => {
          try {
            const dt: any =
              typeof (window as any).DataTransfer === 'function'
                ? new DataTransfer()
                : {
                    types: ['text/html', 'text/plain'],
                    getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? plain : ''),
                  };

            try {
              dt.setData?.('text/html', html);
              dt.setData?.('text/plain', plain);
            } catch {}

            // 关键点：不要依赖构造参数传 clipboardData（Chrome 可能忽略），改为 defineProperty 注入
            const buildEvt = () => {
              let evt: Event;
              try {
                evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true } as any);
              } catch {
                evt = new Event('paste', { bubbles: true, cancelable: true });
              }
              try {
                Object.defineProperty(evt, 'clipboardData', { get: () => dt });
              } catch {}
              return evt;
            };

            const ok = target.dispatchEvent(buildEvt());

            // 有些站点在父节点绑定 onPaste，这里补发一次
            const root = target.closest('.DraftEditor-root') as HTMLElement | null;
            if (root && root !== target) root.dispatchEvent(buildEvt());

            return ok;
          } catch (e) {
            console.log('[wangyihao] simulatePasteHtml 失败:', e);
            return false;
          }
        };

        const titleText = String((payload as any).title || '').trim();
        const html = String((payload as any).contentHtml || '');
        const markdown = String((payload as any).contentMarkdown || '');

        console.log('[wangyihao] 开始填充内容，标题:', titleText?.substring(0, 20));

        // 等待页面加载完成
        await sleep(2000);

        // 1) 填充标题
        if (titleText) {
          const titleInput = await waitFor(() => {
            const neteaseTextarea = document.querySelector('textarea.netease-textarea') as HTMLTextAreaElement;
            if (neteaseTextarea) return neteaseTextarea;

            const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
            const candidates = textareas.filter((ta) => {
              const placeholder = ta.placeholder || '';
              return /标题/i.test(placeholder);
            });
            if (candidates.length > 0) return candidates[0];

            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            const inputCandidates = inputs.filter((i) => {
              const attrs = [i.placeholder || '', i.getAttribute('aria-label') || '', i.name || '', i.id || '', i.className || ''].join(' ');
              return /标题|title/i.test(attrs);
            });
            return inputCandidates[0] || null;
          }, 10000);

          if (titleInput) {
            titleInput.focus();
            const isTextarea = titleInput.tagName.toLowerCase() === 'textarea';
            const proto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(titleInput, titleText);
            } else {
              (titleInput as any).value = titleText;
            }
            try {
              titleInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: titleText, inputType: 'insertText' }));
            } catch {
              titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log('[wangyihao] 标题填充成功');
          } else {
            console.log('[wangyihao] 未找到标题输入框');
          }
          await sleep(500);
        }

        // 2) 等待编辑器加载
        await sleep(1000);

        // 3) 填充正文 - 网易号使用 Draft.js 编辑器
        const rawContentHtml = html || markdown.replace(/\n/g, '<br>');
        const contentHtml = normalizeHtmlForWangyihaoPaste(rawContentHtml);
        const plainText = htmlToPlainText(contentHtml);
        console.log('[wangyihao] 准备填充内容，HTML 长度:', contentHtml.length, 'raw:', rawContentHtml.length);

        // 查找 Draft.js 编辑器
        const editor = await waitFor(() => {
          // Draft.js 常见：.public-DraftEditor-content（不强制 contenteditable，避免站点改动）
          const draftEditor = document.querySelector('.public-DraftEditor-content') as HTMLElement | null;
          if (draftEditor) {
            if (draftEditor.getAttribute('contenteditable') === 'true' || (draftEditor as any).isContentEditable) return draftEditor;
            const ce = draftEditor.closest('[contenteditable="true"]') as HTMLElement | null;
            if (ce) return ce;
            return draftEditor;
          }

          // Draft.js 内部常见：data-contents="true"，其父节点才是 contenteditable
          const dataContents = document.querySelector('[data-contents="true"]') as HTMLElement | null;
          if (dataContents) {
            const ce = dataContents.closest('[contenteditable="true"]') as HTMLElement | null;
            if (ce) return ce;
          }

          // 网易号可能使用其他编辑器容器
          const draftRoot = document.querySelector('.DraftEditor-root') as HTMLElement | null;
          if (draftRoot) {
            const content = draftRoot.querySelector('[contenteditable="true"]') as HTMLElement | null;
            if (content) return content;
          }

          // 更通用的可编辑文本框
          const roleTextbox = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement | null;
          if (roleTextbox) return roleTextbox;

          // 查找其他 contenteditable 元素
          const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          const filtered = candidates.filter((el) => {
            const className = el.className || '';
            const parentClassName = el.parentElement?.className || '';
            // 排除标题输入框
            if (/title|标题/i.test(className) || /title|标题/i.test(parentClassName)) return false;
            // 排除不可见元素
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 200 || rect.height < 50) return false;
            return true;
          });
          filtered.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });
          return filtered[0] || null;
        }, 30000);

        if (editor) {
          const getPasteTarget = (base: HTMLElement) => {
            try {
              const root = base.closest('.DraftEditor-root') as HTMLElement | null;
              const inside = (root || document).querySelector('.public-DraftEditor-content') as HTMLElement | null;
              if (inside && (root ? root.contains(inside) : true)) return inside;
            } catch {}
            return base;
          };

          const pasteTarget = getPasteTarget(editor);

          // 聚焦编辑器并确保激活（Draft.js 有时需要真实 click 来创建 selection）
          await focusAndPlaceCaret(pasteTarget);
          await sleep(150);

          try {
            const rect = pasteTarget.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + 30,
            });
            pasteTarget.dispatchEvent(clickEvent);
          } catch {}
          await sleep(150);
          await focusAndPlaceCaret(pasteTarget);

          console.log('[wangyihao] 编辑器已聚焦，开始填充内容');

          let filled = false;

          // 方法1：模拟粘贴（Draft.js 期望路径，避免直接破坏内部 DOM）
          try {
            await focusAndPlaceCaret(pasteTarget);
            await sleep(80);

            simulatePasteHtml(pasteTarget, contentHtml, plainText);
            await sleep(500);

            if (isEditorFilled(pasteTarget) || isEditorFilled(editor)) {
              console.log('[wangyihao] paste 事件注入成功，内容长度:', (pasteTarget.textContent || '').length);
              filled = true;
            } else {
              console.log('[wangyihao] paste 事件后内容仍为空');
            }
          } catch (e) {
            console.log('[wangyihao] paste 事件注入失败:', e);
          }

          // 方法2：使用 insertText 作为备选（牺牲格式，优先保证不白屏/不崩溃）
          if (!filled) {
            try {
              await focusAndPlaceCaret(pasteTarget);
              const ok = document.execCommand('insertText', false, plainText);
              if (ok) {
                console.log('[wangyihao] execCommand insertText 成功');
                await sleep(500);
                filled = isEditorFilled(pasteTarget) || isEditorFilled(editor);
              }
            } catch (e5) {
              console.log('[wangyihao] execCommand insertText 失败:', e5);
            }
          }

          if (!filled) {
            const toast = document.createElement('div');
            toast.style.cssText =
              'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#b91c1c;color:#fff;padding:12px 24px;border-radius:8px;z-index:999999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
            toast.textContent = '网易号正文自动填充失败：请刷新页面后重试，或从 SyncCaster 复制正文并粘贴到编辑器';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 6500);
            console.log('[wangyihao] 正文自动填充失败');
          }

          (pasteTarget || editor).dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(300);
        } else {
          console.log('[wangyihao] 未找到编辑器元素');
        }

        await sleep(300);
        return { editUrl: window.location.href, url: window.location.href } as any;
      } catch (e: any) {
        // 将错误结构化返回给 background（避免 async throw 丢失导致返回 null）
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[wangyihao] fillAndPublish failed', err);
        return {
          __synccasterError: {
            message: err.message || String(e),
            stack: err.stack || '',
          },
        } as any;
      }
    },
  },
};
