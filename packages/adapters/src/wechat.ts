import type { PlatformAdapter, PlatformPayload, PublishResult } from './base';
import { mdToWechatHtml, type WechatFormatOptions } from '@synccaster/core';

/**
 * 微信公众号适配器（MD 编辑器整合版）
 *
 * 平台特点：
 * - 入口：https://mp.weixin.qq.com/ -> 点击"文章"进入发布页
 * - 编辑器：正在从 UEditor 迁移到 ProseMirror
 * - 结构：标题 + 作者 + 正文
 * - 不支持：Markdown、LaTeX
 * - 注意：Session 可能过期，需要重新登录
 *
 * 发布流程（MD 编辑器整合版）：
 * 1. 用户在插件中点击「发布到微信公众号」
 * 2. 插件将文章内容保存到 Chrome Storage，跳转到 MD 编辑器页面
 * 3. 用户在 MD 编辑器中预览和调整排版
 * 4. 用户在 MD 编辑器中点击「发布到微信」按钮
 * 5. MD 编辑器跳转到微信公众号发文页面，自动填充标题和正文
 * 
 * 自动化范围约束：
 * - 插件负责内容传递和页面跳转
 * - MD 编辑器负责排版预览和内容填充
 * - 不执行最终的"发布/群发/确认发布"等操作
 * - 最终发布行为仍完全由用户手动完成
 * 
 * 目标效果：
 * - 用户可以在 MD 编辑器中预览公众号排版效果
 * - 内容填充使用微信官方 __MP_Editor_JSAPI__ API，格式完整保留
 */
export const wechatAdapter: PlatformAdapter = {
  id: 'wechat',
  name: '微信公众号',
  kind: 'dom',
  icon: 'wechat',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: false,
    supportsTags: false,
    supportsCategories: false,
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
    // 获取微信格式化选项
    const wechatOptions: WechatFormatOptions = {
      theme: config?.theme || 'default',
      primaryColor: config?.primaryColor || '#3f51b5',
      fontFamily: config?.fontFamily,
      fontSize: config?.fontSize || '15px',
      isUseIndent: config?.isUseIndent || false,
      isUseJustify: config?.isUseJustify || false,
      citeStatus: config?.citeStatus !== false,
      countStatus: config?.countStatus || false,
      isMacCodeBlock: config?.isMacCodeBlock !== false,
      isShowLineNumber: config?.isShowLineNumber || false,
      legend: config?.legend || 'alt',
    };

    console.log('[wechat:transform] 开始转换内容');
    console.log('[wechat:transform] 排版选项:', wechatOptions);

    // 转换 Markdown 为微信公众号 HTML
    const result = await mdToWechatHtml(post.body_md, wechatOptions);

    console.log('[wechat:transform] 排版转换完成');
    console.log('[wechat:transform] HTML 长度:', result.html.length);

    return {
      title: post.title,
      contentHtml: result.html,
      contentCss: result.css,
      contentMarkdown: post.body_md,
      cover: post.cover,
      summary: post.summary,
      author: config?.author || '',
      meta: {
        assets: post.assets || [],
        wordCount: result.meta?.wordCount,
        readingTime: result.meta?.readingTime,
      },
    };
  },

  async publish(payload, ctx) {
    throw new Error('wechat: use DOM automation');
  },

  dom: {
    // 匹配微信公众号编辑页面
    matchers: [
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit*',
      'https://mp.weixin.qq.com/cgi-bin/appmsg*action=edit*',
      'https://mp.weixin.qq.com/cgi-bin/appmsg*isNew=1*',
    ],

    /**
     * 微信公众号自动发文流程（官方 API 版）
     * 
     * 使用微信官方 __MP_Editor_JSAPI__.invoke() API 设置正文内容，
     * 该 API 能完整保留富文本格式。
     * 
     * 支持的 API：
     * - mp_editor_get_isready: 获取编辑器状态（isReady, isNew）
     * - mp_editor_set_content: 设置全文内容（需要 isNew=true）
     * - mp_editor_insert_html: 插入内容（需要 isNew=true）
     * 
     * 流程：
     * 1. 等待编辑器就绪（mp_editor_get_isready）
     * 2. 使用 DOM 操作设置标题（API 不支持标题）
     * 3. 使用官方 API 设置正文（mp_editor_set_content）
     * 4. 如果失败，尝试 mp_editor_insert_html
     * 5. 如果仍失败，降级到 DOM 操作
     */
    fillAndPublish: async function (payload: PlatformPayload): Promise<PublishResult> {
      console.log('[wechat] ========================================');
      console.log('[wechat] 微信公众号自动发文流程开始（官方 API 版）');
      console.log('[wechat] ========================================');
      console.log('[wechat] 标题:', payload.title);
      console.log('[wechat] 内容长度:', (payload.contentHtml || '').length, '字符');

      // ========================================
      // 工具函数
      // ========================================

      function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function waitForElement(selector: string, timeout: number): Promise<Element | null> {
        return new Promise((resolve) => {
          const start = Date.now();
          function check() {
            const el = document.querySelector(selector);
            if (el) {
              resolve(el);
              return;
            }
            if (Date.now() - start > timeout) {
              resolve(null);
              return;
            }
            setTimeout(check, 200);
          }
          check();
        });
      }

      async function findElement(selectors: string[], timeout: number): Promise<Element | null> {
        for (const selector of selectors) {
          const el = await waitForElement(selector, timeout / selectors.length);
          if (el) {
            console.log('[wechat] 找到元素:', selector);
            return el;
          }
        }
        return null;
      }

      // ========================================
      // 微信官方 API 相关函数
      // ========================================

      function hasOfficialAPI(): boolean {
        return !!(window as any).__MP_Editor_JSAPI__ && 
               typeof (window as any).__MP_Editor_JSAPI__.invoke === 'function';
      }

      function waitForEditorReady(timeout: number): Promise<{ isReady: boolean; isNew: boolean } | null> {
        return new Promise((resolve) => {
          const start = Date.now();
          
          function check() {
            if (!hasOfficialAPI()) {
              if (Date.now() - start > timeout) {
                console.warn('[wechat] 官方 API 不可用，等待超时');
                resolve(null);
                return;
              }
              setTimeout(check, 300);
              return;
            }

            (window as any).__MP_Editor_JSAPI__.invoke({
              apiName: 'mp_editor_get_isready',
              apiParam: {},
              sucCb: (res: any) => {
                console.log('[wechat] mp_editor_get_isready 返回:', res);
                if (res && res.isReady) {
                  console.log('[wechat] ✓ 编辑器已就绪，isNew=' + res.isNew);
                  resolve({ isReady: true, isNew: !!res.isNew });
                } else {
                  if (Date.now() - start > timeout) {
                    console.warn('[wechat] 编辑器就绪等待超时');
                    resolve(null);
                    return;
                  }
                  setTimeout(check, 300);
                }
              },
              errCb: (err: any) => {
                console.warn('[wechat] mp_editor_get_isready 失败:', err);
                if (Date.now() - start > timeout) {
                  resolve(null);
                  return;
                }
                setTimeout(check, 300);
              }
            });
          }
          
          check();
        });
      }

      function setContentViaOfficialAPI(html: string): Promise<boolean> {
        return new Promise((resolve) => {
          if (!hasOfficialAPI()) {
            resolve(false);
            return;
          }

          console.log('[wechat] 调用 mp_editor_set_content');
          (window as any).__MP_Editor_JSAPI__.invoke({
            apiName: 'mp_editor_set_content',
            apiParam: { content: html },
            sucCb: (res: any) => {
              console.log('[wechat] ✓ mp_editor_set_content 成功:', res);
              resolve(true);
            },
            errCb: (err: any) => {
              console.error('[wechat] ✗ mp_editor_set_content 失败:', err);
              resolve(false);
            }
          });
        });
      }

      function insertHtmlViaOfficialAPI(html: string): Promise<boolean> {
        return new Promise((resolve) => {
          if (!hasOfficialAPI()) {
            resolve(false);
            return;
          }

          console.log('[wechat] 调用 mp_editor_insert_html');
          (window as any).__MP_Editor_JSAPI__.invoke({
            apiName: 'mp_editor_insert_html',
            apiParam: { html, isSelect: false },
            sucCb: (res: any) => {
              console.log('[wechat] ✓ mp_editor_insert_html 成功:', res);
              resolve(true);
            },
            errCb: (err: any) => {
              console.error('[wechat] ✗ mp_editor_insert_html 失败:', err);
              resolve(false);
            }
          });
        });
      }

      // ========================================
      // 降级方案：DOM 操作
      // ========================================

      function htmlToPlainText(html: string): string {
        try {
          const div = document.createElement('div');
          div.innerHTML = html;
          return (div.textContent || '').replace(/\u00a0/g, ' ').trim();
        } catch {
          return html.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').trim();
        }
      }

      function looksLikeRichContent(el: HTMLElement): boolean {
        try {
          const hasBlocks = el.querySelector('h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote,pre,table,img');
          if (hasBlocks) return true;
          const html = (el.innerHTML || '').toLowerCase();
          return html.includes('<p') || html.includes('<h') || html.includes('<ul') || 
                 html.includes('<ol') || html.includes('<blockquote') || 
                 html.includes('<pre') || html.includes('<table') || html.includes('<img');
        } catch {
          return false;
        }
      }

      function copyToClipboard(html: string, plainText: string): Promise<boolean> {
        return new Promise((resolve) => {
          try {
            const blob = new Blob([html], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            const clipboardItem = new ClipboardItem({
              'text/html': blob,
              'text/plain': textBlob
            });
            navigator.clipboard.write([clipboardItem]).then(() => {
              console.log('[wechat] ✓ 内容已复制到剪贴板');
              resolve(true);
            }).catch(() => {
              navigator.clipboard.writeText(plainText).then(() => resolve(true)).catch(() => resolve(false));
            });
          } catch {
            resolve(false);
          }
        });
      }

      function fillEditorContentViaDOM(contentHtml: string): Promise<boolean> {
        return new Promise((resolve) => {
          // 方法1：ProseMirror 编辑器
          try {
            const pmSelectors = ['.ProseMirror', '[data-slate-editor="true"]', '.editor-content [contenteditable="true"]'];
            for (const selector of pmSelectors) {
              const pmEditor = document.querySelector(selector) as HTMLElement;
              if (pmEditor) {
                console.log('[wechat] 找到 ProseMirror 编辑器:', selector);
                pmEditor.focus();
                pmEditor.innerHTML = contentHtml;
                pmEditor.dispatchEvent(new Event('input', { bubbles: true }));
                if (looksLikeRichContent(pmEditor)) {
                  console.log('[wechat] ✓ ProseMirror innerHTML 设置成功');
                  resolve(true);
                  return;
                }
              }
            }
          } catch (e) {
            console.warn('[wechat] ProseMirror 设置失败:', e);
          }

          // 方法2：UEditor iframe
          try {
            const iframeSelectors = ['#ueditor_0 iframe', '.edui-editor-iframeholder iframe', 'iframe[id*="ueditor"]'];
            for (const selector of iframeSelectors) {
              const iframe = document.querySelector(selector) as HTMLIFrameElement;
              if (iframe) {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc?.body) {
                  iframeDoc.body.innerHTML = contentHtml;
                  iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                  if (looksLikeRichContent(iframeDoc.body)) {
                    console.log('[wechat] ✓ iframe body innerHTML 设置成功');
                    resolve(true);
                    return;
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[wechat] iframe 设置失败:', e);
          }

          // 方法3：contenteditable 元素
          try {
            const editableSelectors = ['.edui-body-container [contenteditable="true"]', '#ueditor_0 [contenteditable="true"]', '[contenteditable="true"]'];
            for (const selector of editableSelectors) {
              const editable = document.querySelector(selector) as HTMLElement;
              if (editable) {
                editable.innerHTML = contentHtml;
                editable.dispatchEvent(new Event('input', { bubbles: true }));
                if (looksLikeRichContent(editable)) {
                  console.log('[wechat] ✓ contenteditable innerHTML 设置成功');
                  resolve(true);
                  return;
                }
              }
            }
          } catch (e) {
            console.warn('[wechat] contenteditable 设置失败:', e);
          }

          resolve(false);
        });
      }

      // ========================================
      // 主逻辑
      // ========================================
      try {
        await sleep(1000);

        // Step 1: 检测官方 API
        console.log('[wechat] Step 1: 检测微信官方 API');
        const hasAPI = hasOfficialAPI();
        if (hasAPI) {
          console.log('[wechat] ✓ 检测到微信官方 __MP_Editor_JSAPI__');
        } else {
          console.log('[wechat] ✗ 未检测到官方 API，将使用 DOM 降级方案');
        }

        // Step 2: 等待编辑器就绪
        console.log('[wechat] Step 2: 等待编辑器就绪');
        let editorState: { isReady: boolean; isNew: boolean } | null = null;
        if (hasAPI) {
          editorState = await waitForEditorReady(15000);
        } else {
          await sleep(2000);
        }

        // Step 3: 填充标题
        console.log('[wechat] Step 3: 填充标题（DOM 操作）');
        const titleSelectors = [
          '#title',
          'input[placeholder*="标题"]',
          'input[placeholder*="请在这里输入标题"]',
          '.title_input input',
          '.weui-desktop-form__input',
        ];
        const titleInput = await findElement(titleSelectors, 5000) as HTMLInputElement | null;
        if (titleInput) {
          titleInput.value = payload.title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log('[wechat] ✓ 标题已填充:', payload.title);
        } else {
          console.warn('[wechat] ✗ 未找到标题输入框');
        }

        // Step 4: 填充作者（如果有）
        const author = (payload as any).author as string | undefined;
        if (author) {
          console.log('[wechat] Step 4: 填充作者');
          const authorSelectors = ['#author', 'input[placeholder*="作者"]', 'input[placeholder*="请输入作者"]'];
          const authorInput = await findElement(authorSelectors, 2000) as HTMLInputElement | null;
          if (authorInput) {
            authorInput.value = author;
            authorInput.dispatchEvent(new Event('input', { bubbles: true }));
            authorInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[wechat] ✓ 作者已填充:', author);
          }
          await sleep(200);
        }

        // Step 5: 填充正文
        console.log('[wechat] Step 5: 填充正文');
        const contentHtml = payload.contentHtml || '';
        const plainText = htmlToPlainText(contentHtml);

        console.log('[wechat] 内容长度:', contentHtml.length, '字符');
        if (contentHtml.length > 20000) {
          console.warn('[wechat] ⚠ 正文内容较长，可能影响填充效果');
        }

        let filled = false;
        let method = 'none';

        // 尝试官方 API
        const canUseAPI = hasAPI && editorState && editorState.isReady;
        if (canUseAPI) {
          console.log('[wechat] 使用官方 API（isNew=' + editorState!.isNew + '）');
          
          // 优先使用 mp_editor_set_content
          filled = await setContentViaOfficialAPI(contentHtml);
          if (filled) {
            method = 'official_api_set_content';
          } else {
            // 尝试 mp_editor_insert_html
            console.log('[wechat] mp_editor_set_content 失败，尝试 mp_editor_insert_html');
            filled = await insertHtmlViaOfficialAPI(contentHtml);
            if (filled) {
              method = 'official_api_insert_html';
            }
          }
        }

        // 降级到 DOM 操作
        if (!filled) {
          console.log('[wechat] 官方 API 失败或不可用，使用 DOM 操作');
          filled = await fillEditorContentViaDOM(contentHtml);
          if (filled) {
            method = 'dom';
          }
        }

        // 最后降级到剪贴板
        if (!filled) {
          console.warn('[wechat] DOM 操作失败，复制到剪贴板');
          const copied = await copyToClipboard(contentHtml, plainText);
          if (copied) {
            method = 'clipboard';
            try { alert('内容已复制到剪贴板，请在编辑器中按 Ctrl+V 粘贴'); } catch {}
          }
        }

        await sleep(1000);

        // 输出结果
        console.log('[wechat] ========================================');
        console.log('[wechat] 微信公众号自动发文流程完成');
        console.log('[wechat] ========================================');
        console.log('[wechat] 填充方法:', method);
        
        let noteText = '';
        if (filled) {
          if (method.startsWith('official_api')) {
            console.log('[wechat] ✓ 内容已通过官方 API 填充（格式完整保留）');
            noteText = '内容已通过官方 API 自动填充，格式完整保留。';
          } else {
            console.log('[wechat] ✓ 内容已通过 DOM 操作填充');
            noteText = '内容已自动填充。如果格式不正确，请手动复制粘贴。';
          }
        } else {
          console.log('[wechat] ⚠ 内容已复制到剪贴板，请手动粘贴');
          noteText = '内容已复制到剪贴板，请在编辑器中按 Ctrl+V 粘贴';
        }
        
        console.log('[wechat] ⚠️ 发布操作需要用户手动完成');

        return {
          url: window.location.href,
          success: true,
          __synccasterNote: noteText,
          meta: {
            autoFilled: filled,
            fillMethod: method,
            wordCount: payload.meta?.wordCount,
            readingTime: payload.meta?.readingTime,
          },
        } as PublishResult;
      } catch (error: any) {
        console.error('[wechat] 发文流程失败:', error);
        return {
          url: window.location.href,
          success: false,
          __synccasterError: {
            message: error.message || String(error),
            stack: error.stack,
          },
        } as PublishResult;
      }
    },
  },
};
