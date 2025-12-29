import type { PlatformAdapter } from './base';

/**
 * 简书适配器
 * 
 * 平台特点：
 * - 入口：https://www.jianshu.com/writer
 * - 编辑器：支持富文本（kalamu）和 Markdown（CodeMirror）两种模式
 * - 结构：左侧文集/文章列表 + 右侧编辑区域
 * 
 * 发布策略：
 * - 自动检测编辑器类型，两种模式都支持
 * - 富文本模式：直接填充纯文本（Markdown 源码）
 * - Markdown 模式：使用 CodeMirror API 填充
 * - 智能判断是否需要新建文章
 * - 不执行最终发布，由用户手动完成
 */
export const jianshuAdapter: PlatformAdapter = {
  id: 'jianshu',
  name: '简书',
  kind: 'dom',
  icon: 'jianshu',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: false,
    supportsCategories: false,
    supportsCover: false,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 20,
      concurrent: 1,
    },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('jianshu: use DOM automation');
  },

  dom: {
    matchers: ['https://www.jianshu.com/writer*'],
    fillAndPublish: async function (payload) {
      console.log('[jianshu] fillAndPublish starting', { url: window.location.href });
      
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        const style = window.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const waitForPredicate = async <T>(
        check: () => T | null | undefined | false,
        timeoutMs = 45000,
        intervalMs = 200
      ): Promise<T> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          try {
            const res = check();
            if (res) return res as T;
          } catch {}
          await sleep(intervalMs);
        }
        try {
          console.error('[jianshu] waitForPredicate timeout', {
            url: window.location.href,
            title: document.title,
            inputs: document.querySelectorAll('input').length,
            textareas: document.querySelectorAll('textarea').length,
            codeMirror: !!document.querySelector('.CodeMirror'),
            kalamuArea: !!document.querySelector('.kalamu-area'),
          });
        } catch {}
        throw new Error('等待页面元素超时');
      };

      const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const normalizeText = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

      const readEditableText = (el: HTMLElement): string => {
        const anyEl = el as any;
        if (typeof anyEl.value === 'string') return String(anyEl.value || '');
        return String(el.textContent || '');
      };

      const writeEditableText = (el: HTMLElement, value: string) => {
        const v = String(value || '');
        const anyEl = el as any;

        try {
          el.focus?.();
        } catch {}

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          setNativeValue(el, v);
        } else if (el.isContentEditable) {
          try {
            el.textContent = v;
          } catch {
            try {
              (el as any).innerText = v;
            } catch {}
          }
          try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {}
        } else if (typeof anyEl.value === 'string') {
          try {
            anyEl.value = v;
          } catch {}
          try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {}
        }

        // 一些版本可能依赖 keyup/blur 才会同步标题
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true } as any));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true } as any));
        } catch {}
        try {
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch {}
      };

      const findTitleInput = (): HTMLInputElement | HTMLTextAreaElement | null => {
        const direct = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          [
            'textarea[placeholder*="标题"]',
            'textarea[placeholder*="无标题"]',
            'textarea[aria-label*="标题"]',
            'textarea[name="title"]',
            'textarea[data-placeholder*="标题"]',
            'input[placeholder*="标题"]',
            'input[placeholder*="无标题"]',
            'input[aria-label*="标题"]',
            'input[name="title"]',
            'input[data-placeholder*="标题"]',
          ].join(', ')
        );
        if (direct && isVisible(direct)) return direct;

        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
        ).filter((el) => {
          if (!isVisible(el)) return false;

          // 排除明显的搜索框/筛选框
          const hint = `${(el as any).placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''}`;
          if (hint.includes('搜索') || hint.includes('查找') || hint.includes('筛选')) return false;

          const rect = el.getBoundingClientRect();
          // 标题通常较窄高：避免把正文编辑器 textarea 误判为标题
          if (rect.width < 160) return false;
          if (rect.height > 160) return false;
          return true;
        });

        candidates.sort((a, b) => {
          const ha = `${(a as any).placeholder || ''} ${a.getAttribute('aria-label') || ''} ${a.getAttribute('data-placeholder') || ''}`;
          const hb = `${(b as any).placeholder || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-placeholder') || ''}`;

          const sa = ha.includes('标题') || ha.includes('无标题') ? 2 : ha.trim() ? 1 : 0;
          const sb = hb.includes('标题') || hb.includes('无标题') ? 2 : hb.trim() ? 1 : 0;
          if (sa !== sb) return sb - sa;

          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          // 更偏向页面更靠上的输入框
          const topScore = ra.top - rb.top;
          if (Math.abs(topScore) > 30) return topScore;

          return rb.width * rb.height - ra.width * ra.height;
        });

        return candidates[0] || null;
      };

      const pickTitleField = (): HTMLElement | null => {
        const candidates: HTMLElement[] = [];

        const pushUnique = (el: HTMLElement | null) => {
          if (!el) return;
          if (!isVisible(el)) return;
          if (candidates.includes(el)) return;
          candidates.push(el);
        };

        // 优先：简书新版 Markdown 文本框（arthur-editor）结构通常是：input[type=text](标题) + textarea#arthur-editor(正文)
        const arthurTextarea = document.querySelector<HTMLElement>('#arthur-editor, textarea.source');
        const arthurRect = (() => {
          try {
            return arthurTextarea?.getBoundingClientRect();
          } catch {
            return null;
          }
        })();
        const arthurParent = arthurTextarea?.parentElement || null;
        if (arthurParent) {
          const localTitle =
            (arthurParent.querySelector('input[type="text"]') as HTMLElement | null) ||
            (arthurParent.querySelector('input') as HTMLElement | null);
          pushUnique(localTitle);
        }

        // 1) 常见的 input/textarea
        pushUnique(findTitleInput() as any);

        // 2) 带 title 语义的 contenteditable
        const ceSelectors = [
          '[contenteditable="true"][data-placeholder*="标题"]',
          '[contenteditable="true"][aria-label*="标题"]',
          '[role="textbox"][contenteditable="true"][data-placeholder*="标题"]',
          '[role="textbox"][contenteditable="true"][aria-label*="标题"]',
        ];
        document.querySelectorAll<HTMLElement>(ceSelectors.join(',')).forEach((el) => pushUnique(el));

        // 3) 兜底：从所有可见输入控件里按“标题特征”挑选
        const all = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input, textarea, [contenteditable="true"], [role="textbox"][contenteditable="true"]'
          )
        ).filter((el) => isVisible(el));

        for (const el of all) {
          try {
            if (el.closest('.CodeMirror')) continue;
          } catch {}

          const rect = el.getBoundingClientRect();
          if (rect.width < 160) continue;
          if (rect.height > 180) continue;
          if (rect.top > window.innerHeight * 0.55) continue;

          const hint = `${(el as any).placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''} ${el.getAttribute('name') || ''}`;
          if (hint.includes('搜索') || hint.includes('查找') || hint.includes('筛选')) continue;

          if (rect.top < 420) pushUnique(el);
        }

        if (candidates.length === 0) return null;

        const score = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          const hint = `${(el as any).placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''} ${el.getAttribute('name') || ''}`;
          const h = hint || '';

          let s = 0;
          if (h.includes('标题') || h.includes('无标题')) s += 80;
          if (/title/i.test(h)) s += 25;
          if (el.tagName === 'TEXTAREA') s += 10;
          if ((el as any).type === 'text') s += 5;
          if (rect.top < 120) s += 25;
          else if (rect.top < 220) s += 15;
          else if (rect.top < 320) s += 5;
          if (rect.height >= 20 && rect.height <= 120) s += 10;
          if (rect.left < 260) s += 5;

          // 与正文编辑器的空间关系：标题通常紧挨着正文上方，且处于同一列
          if (arthurParent && el.parentElement === arthurParent) s += 120;
          if (arthurRect) {
            const verticalGap = arthurRect.top - rect.bottom;
            const overlap =
              Math.max(0, Math.min(rect.right, arthurRect.right) - Math.max(rect.left, arthurRect.left)) /
              Math.max(1, Math.min(rect.width, arthurRect.width));
            if (verticalGap >= -30 && verticalGap <= 220 && overlap > 0.6) s += 120;
            // 明显在左侧栏（完全在正文左侧）则强惩罚，避免误选搜索框等
            if (rect.right < arthurRect.left - 20) s -= 120;
          }
          return s;
        };

        candidates.sort((a, b) => score(b) - score(a));
        return candidates[0] || null;
      };

      const setTitleRobust = async (title: string): Promise<boolean> => {
        const desired = normalizeText(title);
        if (!desired) return true;

        for (let i = 0; i < 3; i++) {
          const el = pickTitleField();
          if (!el) {
            await sleep(250);
            continue;
          }

          writeEditableText(el, title);
          await sleep(120);

          const got = normalizeText(readEditableText(el));
          if (got === desired) return true;

          // 兜底：部分 React/受控 input 需要 execCommand 才会触发内部同步
          try {
            (el as any).focus?.();
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              try {
                el.setSelectionRange(0, (el.value || '').length);
              } catch {}
              try {
                document.execCommand?.('insertText', false, title);
              } catch {}
              try {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch {}
            } else if (el.isContentEditable) {
              try {
                document.execCommand?.('selectAll', false);
                document.execCommand?.('insertText', false, title);
              } catch {}
              try {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch {}
            }
          } catch {}

          await sleep(120);
          const got2 = normalizeText(readEditableText(el));
          if (got2 === desired) return true;

          await sleep(250);
        }

        return false;
      };

      const getCodeMirror = (): any | null => {
        const cmEl = document.querySelector('.CodeMirror') as any;
        const cm = cmEl?.CodeMirror;
        if (cm && typeof cm.getValue === 'function' && typeof cm.setValue === 'function') return cm;
        return null;
      };

      const getBodyTextarea = (): HTMLTextAreaElement | null => {
        const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).filter((el) => {
          if (!isVisible(el)) return false;
          const hint = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''}`;
          // 排除标题框
          if (hint.includes('标题') || hint.includes('无标题')) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 240) return false;
          if (rect.height < 200) return false;
          return true;
        });

        let best: { el: HTMLTextAreaElement; score: number } | null = null;
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const score = rect.width * rect.height;
          if (!best || score > best.score) best = { el, score };
        }
        return best?.el || null;
      };

      const getKlamuArea = (): HTMLElement | null => {
        const direct = document.querySelector('.kalamu-area') as HTMLElement | null;
        if (direct && isVisible(direct)) return direct;

        // 兜底：部分版本的简书富文本编辑器不暴露 kalamu-area，使用 contenteditable 容器
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>('[contenteditable="true"], [role="textbox"][contenteditable="true"]')
        ).filter((el) => {
          if (!isVisible(el)) return false;
          const hint = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-placeholder') || ''}`;
          // 排除标题
          if (hint.includes('标题') || hint.includes('无标题')) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width < 240) return false;
          if (rect.height < 200) return false;
          return true;
        });

        let best: { el: HTMLElement; score: number } | null = null;
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const score = rect.width * rect.height;
          if (!best || score > best.score) best = { el, score };
        }
        return best?.el || null;
      };

      const tryWait = async <T>(
        check: () => T | null | undefined | false,
        timeoutMs: number
      ): Promise<T | null> => {
        try {
          return await waitForPredicate(check, timeoutMs);
        } catch {
          return null;
        }
      };

      const findBestByText = (
        text: string,
        opts: { root?: ParentNode; preferBottomLeft?: boolean } = {}
      ): HTMLElement | null => {
        const root = opts.root || document;
        const candidates = Array.from(
          root.querySelectorAll<HTMLElement>('button, a, li, div, span, p')
        ).filter((el) => {
          if (!isVisible(el)) return false;
          const t = (el.innerText || '').trim();
          if (!t) return false;
          if (!t.includes(text)) return false;
          // 避免选中大容器：文字太长通常不是可点击项
          if (t.length > 50) return false;
          return true;
        });

        if (candidates.length === 0) return null;

        let best: { el: HTMLElement; score: number } | null = null;
        for (const el of candidates) {
          const t = (el.innerText || '').trim();
          const rect = el.getBoundingClientRect();
          const exact = t === text ? 100 : 0;
          const tagBoost = ['BUTTON', 'A', 'LI'].includes(el.tagName) ? 10 : 0;
          const shortBoost = Math.max(0, 50 - t.length);
          const posBoost =
            opts.preferBottomLeft && rect.left < 260 && rect.bottom > window.innerHeight - 220 ? 30 : 0;
          const score = exact + tagBoost + shortBoost + posBoost;
          if (!best || score > best.score) best = { el, score };
        }
        return best?.el || candidates[0] || null;
      };

      const clickEl = (el: HTMLElement) => {
        try {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch {}
        try {
          (el as any).click?.();
        } catch {}
      };

      const normalizeMarkdownImageUrls = (md: string): string => {
        if (!md) return md;

        return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, rawInner: string) => {
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

      const escapeHtml = (s: string) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

      const escapeAttrFromEscaped = (s: string) => String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

      const markdownToRichHtml = (md: string): string => {
        const convertInline = (raw: string) => {
          let out = escapeHtml(raw || '');

          // images: ![alt](url "title")
          out = out.replace(
            /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
            (_m, alt: string, url: string) =>
              `<img src="${escapeAttrFromEscaped(url)}" alt="${escapeAttrFromEscaped(alt)}">`
          );

          // links: [text](url)
          out = out.replace(
            /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
            (_m, text: string, url: string) =>
              `<a href="${escapeAttrFromEscaped(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
          );

          // inline code
          out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);

          // bold / italic
          out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

          return out;
        };

        const lines = String(md || '').split('\n');
        const parts: string[] = [];
        let inCodeBlock = false;
        const codeLines: string[] = [];
        let listType: 'ul' | 'ol' | null = null;

        const closeList = () => {
          if (!listType) return;
          parts.push(`</${listType}>`);
          listType = null;
        };

        const openList = (t: 'ul' | 'ol') => {
          if (listType === t) return;
          closeList();
          listType = t;
          parts.push(`<${t}>`);
        };

        const flushCodeBlock = () => {
          if (!inCodeBlock) return;
          const body = escapeHtml(codeLines.join('\n'));
          parts.push(`<pre><code>${body}</code></pre>`);
          codeLines.length = 0;
          inCodeBlock = false;
        };

        for (const line of lines) {
          if (line.trim().startsWith('```')) {
            if (inCodeBlock) flushCodeBlock();
            else {
              closeList();
              inCodeBlock = true;
            }
            continue;
          }

          if (inCodeBlock) {
            codeLines.push(line);
            continue;
          }

          if (!line.trim()) {
            closeList();
            parts.push('<p><br></p>');
            continue;
          }

          const heading = /^(#{1,6})\s+(.*)$/.exec(line);
          if (heading) {
            closeList();
            const level = heading[1].length;
            parts.push(`<h${level}>${convertInline(heading[2])}</h${level}>`);
            continue;
          }

          const quote = /^>\s+(.*)$/.exec(line);
          if (quote) {
            closeList();
            parts.push(`<blockquote><p>${convertInline(quote[1])}</p></blockquote>`);
            continue;
          }

          const ul = /^[-*+]\s+(.*)$/.exec(line);
          if (ul) {
            openList('ul');
            parts.push(`<li>${convertInline(ul[1])}</li>`);
            continue;
          }

          const ol = /^\d+\.\s+(.*)$/.exec(line);
          if (ol) {
            openList('ol');
            parts.push(`<li>${convertInline(ol[1])}</li>`);
            continue;
          }

          closeList();
          parts.push(`<p>${convertInline(line)}</p>`);
        }

        if (inCodeBlock) flushCodeBlock();
        closeList();
        return parts.join('');
      };

      const ensureMarkdownEditor = async (): Promise<boolean> => {
        if (getCodeMirror()) return true;

        // 1) 先尝试直接点击“Markdown 编辑器”相关入口（若页面有显式切换）
        const direct = findBestByText('Markdown 编辑器') || findBestByText('Markdown');
        if (direct) {
          clickEl(direct);
          const cm = await tryWait(() => getCodeMirror(), 8000);
          if (cm) return true;
        }

        // 2) 走设置面板：设置 -> 默认编辑器 -> Markdown 编辑器
        const settingsBtn =
          findBestByText('设置', { preferBottomLeft: true }) ||
          (document.querySelector('.fa-cog, .fa-gear, .icon-setting, .icon-settings') as HTMLElement | null);

        if (!settingsBtn) return false;

        clickEl(settingsBtn);
        await sleep(200);

        const defaultEditorItem = await tryWait(() => findBestByText('默认编辑器'), 8000);
        if (defaultEditorItem) {
          clickEl(defaultEditorItem);
          await sleep(200);
        }

        const mdOption = await tryWait(
          () => findBestByText('Markdown 编辑器') || findBestByText('Markdown'),
          8000
        );
        if (mdOption) {
          clickEl(mdOption);
          await sleep(200);
        }

        const cm = await tryWait(() => getCodeMirror(), 15000);
        return !!cm;
      };

      const fillBody = (markdown: string) => {
        const cm = getCodeMirror();
        if (cm) {
          console.log('[jianshu] 使用 Markdown 编辑器');
          cm.setValue(markdown);
          cm.refresh?.();
          return;
        }

        const bodyTextarea = getBodyTextarea();
        if (bodyTextarea) {
          console.log('[jianshu] 使用 Markdown 文本框');
          bodyTextarea.focus();
          setNativeValue(bodyTextarea, markdown);
          return;
        }

        const kalamuArea = getKlamuArea();
        if (kalamuArea) {
          console.log('[jianshu] 使用富文本编辑器');
          kalamuArea.focus();
          const html = markdownToRichHtml(markdown);
          kalamuArea.innerHTML = html;
          kalamuArea.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }

        throw new Error('未找到编辑器');
      };

      try {
        const title = String((payload as any).title || '');
        let markdown = String((payload as any).contentMarkdown || '');
        markdown = normalizeMarkdownImageUrls(markdown);

        // 可能被重定向到登录页：提前给出明确提示
        if (
          /\/sign_in\b/i.test(window.location.pathname) ||
          /\/sign_up\b/i.test(window.location.pathname) ||
          document.querySelector('input[type="password"]')
        ) {
          throw new Error('未登录简书：请先在当前浏览器中登录 https://www.jianshu.com/writer 后重试');
        }

        const ensureEditorBoot = (() => {
          let clicks = 0;
          let lastClickAt = 0;
          return () => {
            if (clicks >= 3) return;
            const now = Date.now();
            if (now - lastClickAt < 2500) return;

            const btn =
              findBestByText('新建文章') ||
              findBestByText('写文章') ||
              findBestByText('开始写作') ||
              (document.querySelector('[title*="新建文章"], [aria-label*="新建文章"]') as HTMLElement | null) ||
              (document.querySelector('.fa-plus-circle') as HTMLElement | null);

            if (btn) {
              clicks++;
              lastClickAt = now;
              console.log('[jianshu] 未检测到编辑区，尝试初始化编辑器（新建文章）', { clicks });
              clickEl(btn);
            }
          };
        })();

        // 等待编辑器就绪（避免固定 sleep）
        await waitForPredicate(() => {
          const editorOk = !!getCodeMirror() || !!getKlamuArea() || !!getBodyTextarea();
          if (editorOk) return true;
          ensureEditorBoot();
          return null;
        }, 60000);

        let titleInput: HTMLInputElement | HTMLTextAreaElement | null = findTitleInput();

        let triedMarkdown = false;
        if (!getCodeMirror() && getKlamuArea()) {
          triedMarkdown = true;
          console.log('[jianshu] 当前为富文本编辑器，尝试切换到 Markdown 编辑器');
          const ok = await ensureMarkdownEditor();
          if (ok) {
            console.log('[jianshu] ✓ 已切换到 Markdown 编辑器');
          } else {
            console.warn('[jianshu] 切换 Markdown 编辑器失败，将尝试新建文章或使用富文本兜底');
          }

          // 设置/切换可能导致节点重建：重新等待编辑器稳定
          await waitForPredicate(() => {
            const editorOk = !!getCodeMirror() || !!getKlamuArea() || !!getBodyTextarea();
            return editorOk ? true : null;
          }, 20000);
          titleInput = findTitleInput() || titleInput;
        }

        // 检查当前文章是否有内容
        const cm = getCodeMirror();
        const kalamuEl = getKlamuArea();
	        const currentTitle = titleInput?.value?.trim() || '';
	        const bodyTextarea = getBodyTextarea();
	        const currentContent =
	          cm?.getValue?.()?.trim() || bodyTextarea?.value?.trim() || kalamuEl?.innerText?.trim() || '';

	        // 仅在“当前稿件确实有内容”时才尝试新建；切换 Markdown 失败不应阻断填充。
	        const titleLooksDefaultDate =
	          /^\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2}$/.test(currentTitle) || /^\d{4}年\d{1,2}月\d{1,2}日$/.test(currentTitle);
	        const shouldCreateNew = (!titleLooksDefaultDate && !!currentTitle) || currentContent.length > 10;

        const clearCurrentDraft = () => {
          try {
            titleInput && setNativeValue(titleInput, '');
          } catch {}
          try {
            const cmNow = getCodeMirror();
            if (cmNow) {
              cmNow.setValue('');
              cmNow.refresh?.();
              return;
            }
          } catch {}
          try {
            const taNow = getBodyTextarea();
            if (taNow) {
              setNativeValue(taNow, '');
              return;
            }
          } catch {}
          try {
            const kalamuNow = getKlamuArea();
            if (kalamuNow) {
              kalamuNow.innerHTML = '<p><br></p>';
              kalamuNow.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch {}
        };
        
        // 如果当前文章有内容（或需让 Markdown 设置生效），尽量新建文章（避免覆写用户草稿）
        if (shouldCreateNew) {
          console.log('[jianshu] 当前文章有内容，尝试新建文章', {
            currentTitleLen: currentTitle.length,
            currentContentLen: currentContent.length,
          });
          const addBtn = document.querySelector('.fa-plus-circle') as HTMLElement | null;
          if (addBtn) {
            addBtn.click();
            const nextTitleInput = await tryWait(() => {
              const ti = findTitleInput();
              if (!ti) return null;
              const t = ti.value?.trim() || '';
              const cm2 = getCodeMirror();
              const ta2 = getBodyTextarea();
              const kalamu2 = getKlamuArea();
              const c = cm2?.getValue?.()?.trim() || ta2?.value?.trim() || kalamu2?.innerText?.trim() || '';

              // 新建文章的“空稿”在不同账号/版本下表现不一致：
              // - 有的会清空标题/正文
              // - 有的会预填少量占位文本
              // 因此这里不要求绝对为空，只要明显变化即可。
              const titleChanged = t !== currentTitle;
              const titleCleared = !t;
              const contentChanged = c !== currentContent;
              const contentLooksEmpty = !c || c.length <= 2;
              if (!(titleCleared || titleChanged || contentChanged || contentLooksEmpty)) return null;
              return ti;
            }, 20000);

            if (nextTitleInput) {
              titleInput = nextTitleInput;
            } else {
              console.warn('[jianshu] 新建文章未确认成功，继续复用当前稿件并清空后填充');
              // 兜底：复用当前稿件，先清空再填充，保证不会“什么都不填”
              titleInput = findTitleInput() || titleInput;
              clearCurrentDraft();
            }
          } else {
            console.warn('[jianshu] 未找到新建文章按钮，继续复用当前文章');
            clearCurrentDraft();
          }
        }
        
        // ===== 2. 填充标题 =====
        // 标题输入框在不同版本下可能异步挂载，因此不强依赖 titleInput 变量

	        // ===== 3. 快速填充正文（先让用户看到内容） =====
	        fillBody(markdown);
	        console.log('[jianshu] ✓ 正文已快速填充');

	        // ===== 2. 填充标题（避免标题填充耗时阻塞首屏） =====
	        const titleOk1 = await setTitleRobust(title);
	        if (titleOk1) console.log('[jianshu] ✓ 标题已填充');
	        else console.warn('[jianshu] 标题填充可能未生效，稍后将重试');

        // ===== 4. 上传图片并替换链接（后台处理） =====
        const downloadedImagesRaw = (payload as any).__downloadedImages;
        const downloadedImages: any[] = Array.isArray(downloadedImagesRaw) ? downloadedImagesRaw : [];

        if (downloadedImages.length > 0) {
          const byUrl = new Map<string, any>();
          for (const img of downloadedImages) {
            const url = String(img?.url || '');
            if (!url) continue;
            if (!byUrl.has(url)) byUrl.set(url, img);
          }
          const images = Array.from(byUrl.values());

          const extractUrls = (text: string): string[] => {
            const urls: string[] = [];
            const re = /((?:https?:)?\/\/[^\s)'"<>]+)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text || '')) !== null) {
              const u = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
              urls.push(u);
            }
            return urls;
          };

          const isJianshuImageUrl = (url: string) => /jianshu\.io\//i.test(url);

          const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
            const res = await fetch(dataUrl);
            if (!res.ok) throw new Error('dataURL fetch failed: ' + res.status);
            return await res.blob();
          };

          const mimeToExt = (mime: string) => {
            const m = (mime || '').toLowerCase();
            if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
            if (m.includes('png')) return 'png';
            if (m.includes('gif')) return 'gif';
            if (m.includes('webp')) return 'webp';
            return 'png';
          };

          const buildFile = async (imgData: any, index: number): Promise<File> => {
            const blob = await dataUrlToBlob(imgData.base64);
            const mime = String(blob.type || imgData.mimeType || 'image/png').toLowerCase();
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
              console.warn('[jianshu] simulatePasteFile failed', e);
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
              console.warn('[jianshu] simulateDropFile failed', e);
              return false;
            }
          };

          const waitForNewUrlInText = async (
            getText: () => string,
            beforeUrls: Set<string>,
            timeoutMs: number
          ): Promise<string | null> => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const current = getText() || '';
              const urls = extractUrls(current);
              for (const u of urls) {
                if (!u) continue;
                if (beforeUrls.has(u)) continue;
                if (u.startsWith('data:') || u.startsWith('blob:')) continue;
                if (!isJianshuImageUrl(u)) continue;
                return u;
              }
              await sleep(400);
            }
            return null;
          };

          const waitForNewImgSrc = async (
            root: HTMLElement,
            beforeSrcSet: Set<string>,
            timeoutMs: number
          ): Promise<string | null> => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
              for (const img of imgs) {
                const candidates = [
                  img.src,
                  img.getAttribute('data-src') || '',
                  img.getAttribute('data-original') || '',
                  img.getAttribute('data-url') || '',
                ].filter(Boolean);
                for (const raw of candidates) {
                  const u = raw.startsWith('//') ? 'https:' + raw : raw;
                  if (!u) continue;
                  if (beforeSrcSet.has(u)) continue;
                  if (u.startsWith('data:') || u.startsWith('blob:')) continue;
                  if (!isJianshuImageUrl(u)) continue;
                  return u;
                }
              }
              await sleep(400);
            }
            return null;
          };

          console.log('[jianshu] 开始上传图片', { total: images.length });
          const imageUrlMap = new Map<string, string>();

          const cmUpload = getCodeMirror();
          if (cmUpload) {
            const wrapper =
              (cmUpload.getWrapperElement?.() as HTMLElement | null) ||
              (document.querySelector('.CodeMirror') as HTMLElement | null);
            const scrollEl =
              (wrapper?.querySelector('.CodeMirror-scroll') as HTMLElement | null) ||
              (document.querySelector('.CodeMirror-scroll') as HTMLElement | null);
            const pasteTarget =
              (wrapper?.querySelector('.CodeMirror-scroll') as HTMLElement | null) ||
              wrapper ||
              (document.querySelector('.CodeMirror') as HTMLElement | null);

            if (!pasteTarget) {
              console.warn('[jianshu] 未找到 Markdown 编辑器节点，跳过图片上传');
            } else {
              const allUploaded = new Set<string>();

              for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                const originalUrl = String(imgData?.url || '');
                if (!originalUrl) continue;

                let beforeText = '';
                let beforeScrollTop = 0;
                try {
                  const file = await buildFile(imgData, i);
                  beforeText = cmUpload.getValue() || '';
                  beforeScrollTop = scrollEl?.scrollTop ?? 0;

                  // 临时追加上传区（上传完成后会恢复正文）
                  try {
                    cmUpload.setValue(`${beforeText}\n\n<!-- SyncCaster image upload zone -->\n`);
                    cmUpload.refresh?.();
                  } catch {}
                  try {
                    if (scrollEl) scrollEl.scrollTop = beforeScrollTop;
                  } catch {}

                  const beforeUrls = new Set(extractUrls(beforeText));
                  allUploaded.forEach((u) => beforeUrls.add(u));

                  try {
                    pasteTarget.focus?.();
                    pasteTarget.dispatchEvent(new Event('focus', { bubbles: true }));
                  } catch {}

                  let ok = simulatePasteFile(pasteTarget, file);
                  if (!ok) ok = simulateDropFile(pasteTarget, file);

                  if (!ok) {
                    console.warn('[jianshu] 触发粘贴/拖拽失败，可能被浏览器拦截', { url: originalUrl });
                    continue;
                  }

                  const newUrl = await waitForNewUrlInText(() => cmUpload.getValue(), beforeUrls, 40000);
                  if (newUrl) {
                    imageUrlMap.set(originalUrl, newUrl);
                    allUploaded.add(newUrl);
                    console.log('[jianshu] 图片上传成功', { originalUrl, newUrl });
                  } else {
                    console.warn('[jianshu] 图片上传超时', { url: originalUrl });
                  }
                } catch (e: any) {
                  console.warn('[jianshu] 图片上传失败', { url: originalUrl, error: e?.message || String(e) });
                } finally {
                  // 恢复正文（避免长时间显示临时上传内容）
                  try {
                    cmUpload.setValue(beforeText);
                    cmUpload.refresh?.();
                  } catch {}
                  try {
                    if (scrollEl) scrollEl.scrollTop = beforeScrollTop;
                  } catch {}
                }

                await sleep(300);
              }
            }
          } else {
            const taUpload = getBodyTextarea();
            if (taUpload) {
              const allUploaded = new Set<string>();

              for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                const originalUrl = String(imgData?.url || '');
                if (!originalUrl) continue;

                let beforeText = '';
                let beforeScrollTop = 0;
                try {
                  const file = await buildFile(imgData, i);
                  beforeText = taUpload.value || '';
                  beforeScrollTop = taUpload.scrollTop || 0;
                  const beforeUrls = new Set(extractUrls(beforeText));
                  allUploaded.forEach((u) => beforeUrls.add(u));

                  const uploadText = `${beforeText}\n\n<!-- SyncCaster image upload zone -->\n`;
                  setNativeValue(taUpload, uploadText);
                  try {
                    taUpload.selectionStart = uploadText.length;
                    taUpload.selectionEnd = uploadText.length;
                  } catch {}
                  try {
                    taUpload.scrollTop = beforeScrollTop;
                  } catch {}

                  let ok = simulatePasteFile(taUpload as any, file);
                  if (!ok) ok = simulateDropFile(taUpload as any, file);
                  if (!ok) {
                    console.warn('[jianshu] 触发粘贴/拖拽失败，可能被浏览器拦截', { url: originalUrl });
                    continue;
                  }

                  const newUrl = await waitForNewUrlInText(() => taUpload.value || '', beforeUrls, 40000);
                  if (newUrl) {
                    imageUrlMap.set(originalUrl, newUrl);
                    allUploaded.add(newUrl);
                    console.log('[jianshu] 图片上传成功', { originalUrl, newUrl });
                  } else {
                    console.warn('[jianshu] 图片上传超时', { url: originalUrl });
                  }
                } catch (e: any) {
                  console.warn('[jianshu] 图片上传失败', { url: originalUrl, error: e?.message || String(e) });
                } finally {
                  // 恢复正文
                  try {
                    setNativeValue(taUpload, beforeText);
                  } catch {}
                  try {
                    taUpload.scrollTop = beforeScrollTop;
                  } catch {}
                }

                await sleep(300);
              }
            } else {
              const kalamuArea = getKlamuArea();
              if (!kalamuArea) {
                console.warn('[jianshu] 未找到可用编辑器，跳过图片上传');
              } else {
                kalamuArea.focus();
                const stableHtml = kalamuArea.innerHTML;

                for (let i = 0; i < images.length; i++) {
                  const imgData = images[i];
                  const originalUrl = String(imgData?.url || '');
                  if (!originalUrl) continue;

                  try {
                    const file = await buildFile(imgData, i);
                    const beforeSrcSet = new Set(
                      Array.from(kalamuArea.querySelectorAll('img'))
                        .map((el: any) => el.src)
                        .filter(Boolean)
                    );

                    let ok = simulatePasteFile(kalamuArea, file);
                    if (!ok) ok = simulateDropFile(kalamuArea, file);
                    if (!ok) {
                      console.warn('[jianshu] 触发粘贴/拖拽失败，可能被浏览器拦截', { url: originalUrl });
                      continue;
                    }

                    const newUrl = await waitForNewImgSrc(kalamuArea, beforeSrcSet, 40000);
                    if (newUrl) {
                      imageUrlMap.set(originalUrl, newUrl);
                      console.log('[jianshu] 图片上传成功', { originalUrl, newUrl });
                    } else {
                      console.warn('[jianshu] 图片上传超时', { url: originalUrl });
                    }

                    // 尽量清理临时插入的图片节点
                    Array.from(kalamuArea.querySelectorAll('img')).forEach((img) => {
                      const src = (img as HTMLImageElement).src || '';
                      if (!beforeSrcSet.has(src)) {
                        try {
                          img.remove();
                        } catch {}
                      }
                    });
                  } catch (e: any) {
                    console.warn('[jianshu] 图片上传失败', { url: originalUrl, error: e?.message || String(e) });
                  } finally {
                    // 兜底：恢复富文本内容（避免残留临时节点）
                    try {
                      kalamuArea.innerHTML = stableHtml;
                      kalamuArea.dispatchEvent(new Event('input', { bubbles: true }));
                    } catch {}
                  }

                  await sleep(300);
                }
              }
            }
          }

          if (imageUrlMap.size > 0) {
            const replaceWithVariants = (text: string, oldUrl: string, newUrl: string) => {
              const olds = new Set<string>();
              const raw = String(oldUrl || '');
              if (!raw) return text;
              olds.add(raw);
              olds.add(raw.replace(/^https?:\/\//i, '//'));
              olds.add(raw.replace(/^https:\/\//i, 'http://'));
              olds.add(raw.replace(/^http:\/\//i, 'https://'));
              return Array.from(olds).reduce((acc, u) => acc.split(u).join(newUrl), text);
            };

            for (const [oldUrl, newUrlRaw] of imageUrlMap.entries()) {
              const nu = String(newUrlRaw || '');
              const newUrl = nu.startsWith('//') ? 'https:' + nu : nu;
              if (!oldUrl || !newUrl || oldUrl === newUrl) continue;
              markdown = replaceWithVariants(markdown, oldUrl, newUrl);
            }

            // 回写正文（用户会看到最终可识别的图片链接）
            fillBody(markdown);
          }

          console.log('[jianshu] 图片处理完成', { total: images.length, success: imageUrlMap.size });
        }
        
        // ===== 5. 再次确认标题（部分版本可能会被默认日期覆盖） =====
        const titleOk2 = await setTitleRobust(title);
        if (!titleOk2) console.warn('[jianshu] 标题二次确认未成功，请手动检查标题');
        
        console.log('[jianshu] ✅ 填充完成，请手动发布');

        return { 
          url: window.location.href,
          success: true,
          __synccasterNote: '内容已填充，请手动点击发布按钮'
        };
      } catch (error: any) {
        console.error('[jianshu] 填充失败:', error);
        return {
          url: window.location.href,
          success: false,
          __synccasterError: {
            message: error?.message || String(error),
          },
        } as any;
      }
    },
  },
};
