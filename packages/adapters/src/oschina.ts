import type { PlatformAdapter } from './base';

/**
 * 开源中国适配器
 * 
 * 平台特点：
 * - 入口：https://my.oschina.net/u/{userId}/blog/write（需要登录）
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - 结构：标题 + 正文
 * 
 * 发布策略：
 * - 使用 DOM 自动化填充内容
 * - 不执行最终发布操作，由用户手动完成
 */
export const oschinaAdapter: PlatformAdapter = {
  id: 'oschina',
  name: '开源中国',
  kind: 'dom',
  icon: 'oschina',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: false,
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
    throw new Error('oschina: use DOM automation');
  },

  dom: {
    matchers: [
      // 开源中国发文页面需要用户 ID，使用通用入口
      'https://my.oschina.net/blog/write',
      'https://my.oschina.net/u/*/blog/write',
      'https://my.oschina.net/*/blog/write',
    ],
    // 动态生成编辑器 URL（需要用户 ID）
    getEditorUrl: (accountId?: string): string => {
      if (accountId) {
        // accountId 格式为 "oschina-{userId}" 或 "oschina_{userId}"，需要提取纯数字的 userId
        // 例如：oschina-9580420 -> 9580420
        let userId = accountId;
        
        // 移除平台前缀（支持连字符和下划线两种格式）
        if (accountId.startsWith('oschina-')) {
          userId = accountId.substring('oschina-'.length);
        } else if (accountId.startsWith('oschina_')) {
          userId = accountId.substring('oschina_'.length);
        }
        
        // 确保 userId 是有效的（非空且为纯数字）
        if (userId && userId.trim() && /^\d+$/.test(userId.trim())) {
          return `https://my.oschina.net/u/${userId.trim()}/blog/write`;
        }

        // 兼容特殊 accountId（例如含有其它后缀）：尝试从字符串中提取 userId 数字片段（避免 Date.now() 13位时间戳）
        const m = userId.match(/(?:^|[^0-9])(\d{5,12})(?:[^0-9]|$)/);
        if (m?.[1]) {
          return `https://my.oschina.net/u/${m[1]}/blog/write`;
        }
      }
      // 回退到通用入口（可能会重定向）
      return 'https://my.oschina.net/blog/write';
    },
    fillAndPublish: async function (payload) {
      console.log('[oschina] fillAndPublish starting', payload);
      console.log('[oschina] Current URL:', window.location.href);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        console.log('[oschina] Waiting for page to load...');
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

      const getAllDocs = (): Document[] => {
        const docs: Document[] = [document];
        const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) docs.push(doc);
          } catch {}
        }
        return docs;
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
        ].join(' ').toLowerCase();
        
        // 排除搜索框
        if (/search|搜索/.test(attrs)) return false;
        
        return /标题|title/i.test(attrs) || rect.width > 200;
      };

      // 查找标题输入框
      const findTitleField = (): HTMLElement | null => {
        // 开源中国发文页面的标题输入框选择器
        const selectors = [
          // 开源中国特有的选择器
          '.blog-editor input[placeholder*="标题"]',
          '.editor-header input[placeholder*="标题"]',
          '.write-header input[placeholder*="标题"]',
          '.article-title input',
          '.post-title input',
          // 通用选择器
          'input[placeholder*="标题"]',
          'input[placeholder*="请输入标题"]',
          'input[name="title"]',
          'input#title',
          '.blog-title input',
          '.title-input input',
          '.editor-title input',
        ];
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) {
            // 排除搜索框
            const className = (el.className || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            if (className.includes('search') || placeholder.includes('搜索')) {
              continue;
            }
            console.log('[oschina] Found title via selector:', sel);
            return el as HTMLElement;
          }
        }
        
        // 回退：查找页面顶部的输入框（排除搜索框）
        const inputs = Array.from(document.querySelectorAll('input'))
          .filter(e => {
            if (!isVisible(e)) return false;
            if (e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio') return false;
            // 排除搜索框
            const className = (e.className || '').toLowerCase();
            const placeholder = (e.getAttribute('placeholder') || '').toLowerCase();
            const name = (e.getAttribute('name') || '').toLowerCase();
            if (className.includes('search') || placeholder.includes('搜索') || name.includes('search')) {
              return false;
            }
            return isLikelyTitle(e);
          });
        
        if (inputs.length > 0) {
          inputs.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
          });
          console.log('[oschina] Found title via fallback:', inputs[0].tagName);
          return inputs[0];
        }
        
        return null;
      };

      // 填充 CodeMirror 5
      const tryFillCodeMirror5 = (markdown: string): boolean => {
        console.log('[oschina] Trying CodeMirror 5...');
        const all = getAllDocs().flatMap((doc) => Array.from(doc.querySelectorAll('.CodeMirror')) as any[]);
        const visibleCount = all.filter((e) => {
          try { return isVisible(e as any); } catch { return false; }
        }).length;
        console.log('[oschina] Found .CodeMirror elements:', all.length, '(visible:', visibleCount, ')');

        const withInstance = all.filter((cmEl) => cmEl?.CodeMirror?.setValue);
        const ordered = [
          ...withInstance.filter((e) => {
            try { return isVisible(e as any); } catch { return false; }
          }),
          ...withInstance.filter((e) => {
            try { return !isVisible(e as any); } catch { return true; }
          }),
        ];

        for (const cmEl of ordered) {
          const cm = cmEl?.CodeMirror;
          if (cm?.setValue) {
            console.log('[oschina] CodeMirror 5 instance found, setting value');
            try { cm.focus?.(); } catch {}
            try { (cmEl as HTMLElement)?.scrollIntoView?.({ block: 'center' }); } catch {}
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

      // 填充 textarea
      const tryFillTextarea = (markdown: string): boolean => {
        console.log('[oschina] Trying textarea...');
        const all = getAllDocs().flatMap((doc) => Array.from(doc.querySelectorAll('textarea')) as HTMLTextAreaElement[]);
        const candidates = all.filter((ta) => {
          const attrs = [
            ta.getAttribute('placeholder') || '',
            ta.getAttribute('aria-label') || '',
            ta.getAttribute('name') || '',
            ta.id || '',
            ta.className || '',
          ]
            .join(' ')
            .toLowerCase();
          if (/title|标题/i.test(attrs)) return false;
          return true;
        });

        const scored = candidates.map((ta) => {
          const area = getRectArea(ta);
          let visible = false;
          try { visible = isVisible(ta); } catch {}
          return { ta, area, visible };
        });

        console.log('[oschina] Found textareas:', scored.length);
        if (!scored.length) return false;

        scored.sort((a, b) => (Number(b.visible) - Number(a.visible)) || (b.area - a.area));
        const ta = scored[0].ta;
        console.log('[oschina] Using textarea:', ta.className, 'area=', scored[0].area, 'visible=', scored[0].visible);
        try { (ta as any).scrollIntoView?.({ block: 'center' }); } catch {}
        setNativeValue(ta, '');
        setNativeValue(ta, markdown);
        return true;
      };

      // 填充 contenteditable
      const tryFillContentEditable = async (markdown: string): Promise<boolean> => {
        console.log('[oschina] Trying contenteditable...');
        const editables = getAllDocs()
          .flatMap((doc) => Array.from(doc.querySelectorAll('[contenteditable="true"]')) as HTMLElement[])
          .filter(e => {
            try { return !isLikelyTitle(e as HTMLElement) && getRectArea(e) > 5000; } catch { return false; }
          }) as HTMLElement[];
        console.log('[oschina] Found contenteditable elements:', editables.length);
        if (!editables.length) return false;
        
        editables.sort((a, b) => getRectArea(b) - getRectArea(a));
        const target = editables[0];
        console.log('[oschina] Using contenteditable:', target.className, getRectArea(target));
        
        try { target.scrollIntoView?.({ block: 'center' }); } catch {}
        target.innerHTML = '';
        target.focus();
        await sleep(100);
        
        // 逐行插入
        const lines = markdown.split('\n');
        for (const line of lines) {
          const div = document.createElement('div');
          div.textContent = line || '\u200B';
          target.appendChild(div);
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
        return true;
      };

      try {
        console.log('[oschina] Waiting for page initialization...');
        await sleep(300);
        
        console.log('[oschina] Page elements:');
        console.log('  - inputs:', document.querySelectorAll('input').length);
        console.log('  - textareas:', document.querySelectorAll('textarea').length);
        console.log('  - contenteditable:', document.querySelectorAll('[contenteditable="true"]').length);
        console.log('  - CodeMirror:', document.querySelectorAll('.CodeMirror').length);
        
        // 0. 切换到 Markdown 编辑器（如果存在切换按钮）
        console.log('[oschina] Step 0: 切换到 Markdown 编辑器');
        const switchToMarkdown = async (): Promise<boolean> => {
          // 查找 Markdown 切换按钮/标签
          const mdSwitchSelectors = [
            // 常见的 Markdown 切换按钮
            'button:contains("Markdown")',
            'a:contains("Markdown")',
            '[data-type="markdown"]',
            '[data-editor="markdown"]',
            '.editor-switch-markdown',
            '.switch-markdown',
            '.markdown-tab',
            '.tab-markdown',
            // 开源中国特有的选择器
            '.editor-type-switch [data-type="markdown"]',
            '.editor-tabs [data-type="markdown"]',
            '.editor-mode-switch .markdown',
          ];
          
          // 使用更通用的方式查找包含 "Markdown" 文本的按钮/链接
          const allButtons = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, .tab, .switch-item, .editor-type-switch *, .editor-tabs *, .editor-mode-switch *'));
          const mdButton = allButtons.find(el => {
            const text = el.textContent?.trim().toLowerCase() || '';
            const isMarkdown = text === 'markdown' || text.includes('markdown');
            // 排除已激活的按钮
            const isActive =
              el.classList.contains('active') ||
              el.classList.contains('selected') ||
              el.classList.contains('current') ||
              el.classList.contains('is-active') ||
              el.getAttribute('aria-selected') === 'true' ||
              el.getAttribute('aria-checked') === 'true' ||
              el.getAttribute('aria-pressed') === 'true' ||
              el.getAttribute('data-active') === 'true';
            return isMarkdown && !isActive && isVisible(el);
          });
          
          if (mdButton) {
            console.log('[oschina] Found Markdown switch button:', mdButton.textContent?.trim());
            const clickable = (mdButton as HTMLElement).closest('button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label') as HTMLElement | null;
            (clickable || (mdButton as HTMLElement)).click();
            await sleep(250);
            return true;
          }
          
          // 尝试使用选择器查找
          for (const selector of mdSwitchSelectors) {
            try {
              const el = document.querySelector(selector);
              if (el && isVisible(el)) {
                console.log('[oschina] Found Markdown switch via selector:', selector);
                (el as HTMLElement).click();
                await sleep(250);
                return true;
              }
            } catch {}
          }

          // 兜底：开源中国编辑页可能提供 “HTML编辑器 / Markdown” 的格式切换
          try {
            const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
            const isActive = (el: Element) => {
              const he = el as HTMLElement;
              return (
                he.classList.contains('active') ||
                he.classList.contains('selected') ||
                he.classList.contains('current') ||
                he.classList.contains('is-active') ||
                he.getAttribute('aria-selected') === 'true' ||
                he.getAttribute('aria-checked') === 'true' ||
                he.getAttribute('aria-pressed') === 'true' ||
                he.getAttribute('data-active') === 'true'
              );
            };

            const candidates = Array.from(
              document.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, li, div, span')
            ).filter(isVisible);

            const containers = candidates
              .map((el) => ({ el, t: norm(el.textContent || '') }))
              .filter(({ t }) => t.includes('markdown') && (t.includes('html编辑器') || t.includes('html')))
              .sort((a, b) => getRectArea(a.el) - getRectArea(b.el));

            const container = containers[0]?.el as HTMLElement | undefined;
            if (container) {
              const inside = Array.from(
                container.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, li, div, span')
              )
                .filter((el) => isVisible(el) && norm(el.textContent || '').includes('markdown'))
                .find((el) => !isActive(el));

              if (inside) {
                console.log('[oschina] Found Markdown switch via HTML/Markdown toggle');
                const clickable = (inside as HTMLElement).closest('button, a, [role="tab"], [role="radio"], [role="button"], label') as HTMLElement | null;
                (clickable || (inside as HTMLElement)).click();
                await sleep(250);
                return true;
              }
            }
          } catch {}
          
          console.log('[oschina] No Markdown switch button found, may already be in Markdown mode');
          return false;
        };
        
        await switchToMarkdown();
        // 确保切换完成后再开始填充（Markdown 编辑器通常为 CodeMirror/textarea）
        await waitFor(
          () => {
            const docs = getAllDocs();
            const hasCm = docs.some((d) => d.querySelectorAll('.CodeMirror').length > 0);
            if (hasCm) return {} as any;
            const hasTextarea = docs.some((d) => d.querySelectorAll('textarea').length > 0);
            return hasTextarea ? ({} as any) : null;
          },
          12000
        ).catch(() => null);
        await sleep(120);
        
        // 1. 填充标题
        console.log('[oschina] Step 1: 填充标题');
        const titleField = await waitFor(() => findTitleField(), 25000);
        const title = String((payload as any).title || '');
        console.log('[oschina] 找到标题输入框:', titleField?.tagName, titleField?.className);
        
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
        
        console.log('[oschina] Title filled:', title);
        await sleep(120);

        // 2. 填充内容
        console.log('[oschina] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';
        console.log('[oschina] Content length:', markdown.length);
        
        // 等待编辑器出现
        await waitFor(
          () => {
            const docs = getAllDocs();
            const hasCm = docs.some((d) => d.querySelectorAll('.CodeMirror').length > 0);
            const hasTextarea = docs.some((d) => d.querySelectorAll('textarea').length > 0);
            const hasEditable = docs.some((d) => d.querySelectorAll('[contenteditable="true"]').length > 0);
            return (hasCm || hasTextarea || hasEditable) ? ({} as any) : null;
          },
          12000
        ).catch(() => null);
        
        await sleep(150);

        const ok =
          tryFillCodeMirror5(markdown) ||
          tryFillTextarea(markdown) ||
          (await tryFillContentEditable(markdown));

        if (!ok) {
          throw new Error('未找到可写入的编辑器控件');
        }

        await sleep(150);

        console.log('[oschina] 内容填充完成');
        console.log('[oschina] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[oschina] 填充失败:', error);
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
