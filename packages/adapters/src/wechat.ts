import type { PlatformAdapter } from './base';
import { mdToWechatHtml, type WechatFormatOptions } from '@synccaster/core';

/**
 * 微信公众号适配器
 *
 * 平台特点：
 * - 入口：https://mp.weixin.qq.com/ -> 点击"文章"进入发布页
 * - 编辑器：富文本编辑器（不支持 Markdown）
 * - 结构：标题 + 作者 + 正文
 * - 不支持：Markdown、LaTeX
 * - 注意：Session 可能过期，需要重新登录
 *
 * 使用 doocs/md 风格的转换逻辑，生成专门为公众号优化的 HTML
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

    // 使用微信格式化器转换 Markdown
    const result = await mdToWechatHtml(post.body_md, wechatOptions);

    // 缓存到 post 对象（如果需要）
    if (!(post as any).body_wechat_html) {
      (post as any).body_wechat_html = result.html;
    }

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
    // 匹配微信公众号编辑页面（包含 token 参数的页面）
    matchers: [
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit*',
      'https://mp.weixin.qq.com/cgi-bin/appmsg*action=edit*',
      'https://mp.weixin.qq.com/cgi-bin/appmsg*isNew=1*',
    ],

    // 使用传统函数语法，避免序列化问题
    fillAndPublish: function (payload: any) {
      console.log('[wechat] fillAndPublish starting', payload);

      function sleep(ms: number) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }

      function waitForElement(selector: string, timeout: number) {
        return new Promise(function (resolve) {
          var start = Date.now();
          function check() {
            var el = document.querySelector(selector);
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

      function findElement(selectors: string[], timeout: number) {
        return new Promise(function (resolve) {
          var index = 0;
          function tryNext() {
            if (index >= selectors.length) {
              resolve(null);
              return;
            }
            waitForElement(selectors[index], timeout / selectors.length).then(function (el) {
              if (el) {
                console.log('[wechat] 找到元素:', selectors[index]);
                resolve(el);
              } else {
                index++;
                tryNext();
              }
            });
          }
          tryNext();
        });
      }

      // 主逻辑
      return sleep(2000)
        .then(function () {
          // 1. 填充标题
          console.log('[wechat] Step 1: 填充标题');
          var titleSelectors = [
            '#title',
            'input[placeholder*="标题"]',
            'input[placeholder*="请在这里输入标题"]',
            '.title_input input',
            '.weui-desktop-form__input',
          ];
          return findElement(titleSelectors, 5000);
        })
        .then(function (titleInput: any) {
          if (titleInput) {
            titleInput.value = payload.title || '';
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log('[wechat] 标题已填充');
          } else {
            console.warn('[wechat] 未找到标题输入框');
          }
          return sleep(300);
        })
        .then(function () {
          // 2. 填充作者（如果有）
          if (payload.author) {
            console.log('[wechat] Step 2: 填充作者');
            var authorSelectors = ['#author', 'input[placeholder*="作者"]', 'input[placeholder*="请输入作者"]'];
            return findElement(authorSelectors, 2000).then(function (authorInput: any) {
              if (authorInput) {
                authorInput.value = payload.author;
                authorInput.dispatchEvent(new Event('input', { bubbles: true }));
                authorInput.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('[wechat] 作者已填充');
              }
              return sleep(200);
            });
          }
          return Promise.resolve();
        })
        .then(function () {
          // 3. 填充正文
          console.log('[wechat] Step 3: 填充正文');
          var editorSelectors = [
            '#ueditor_0',
            '.edui-body-container',
            '[contenteditable="true"]',
            '.ProseMirror',
            '.ql-editor',
          ];
          return findElement(editorSelectors, 8000);
        })
        .then(function (editor: any) {
          var contentHtml = payload.contentHtml || '';

          if (!editor) {
            console.error('[wechat] 未找到编辑器');
            return Promise.resolve(false);
          }

          console.log('[wechat] 编辑器元素:', editor.tagName, editor.id);

          // 方法1：优先使用 UEditor API（最可靠）
          var filled = false;
          
          // 等待 UEditor 完全初始化
          function waitForUEditor(timeout: number) {
            return new Promise(function(resolve) {
              var start = Date.now();
              function check() {
                // @ts-ignore
                var ue = window.UE && window.UE.getEditor && window.UE.getEditor('ueditor_0');
                if (ue && ue.ready) {
                  ue.ready(function() {
                    resolve(ue);
                  });
                  return;
                }
                if (ue && ue.setContent) {
                  resolve(ue);
                  return;
                }
                if (Date.now() - start > timeout) {
                  resolve(null);
                  return;
                }
                setTimeout(check, 300);
              }
              check();
            });
          }

          return waitForUEditor(10000).then(function(ue: any) {
            // 方法1：UEditor API（最可靠）
            if (ue && ue.setContent) {
              try {
                ue.setContent(contentHtml);
                filled = true;
                console.log('[wechat] UEditor API setContent 成功');
                
                // 触发内容变化事件
                if (ue.fireEvent) {
                  ue.fireEvent('contentchange');
                }
              } catch (e) {
                console.warn('[wechat] UEditor API 失败:', e);
              }
            }

            // 方法2：直接操作 iframe body
            if (!filled && editor.tagName === 'IFRAME') {
              try {
                var iframe = editor as HTMLIFrameElement;
                var iframeDoc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
                if (iframeDoc && iframeDoc.body) {
                  iframeDoc.body.innerHTML = contentHtml;
                  iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                  
                  if (iframeDoc.body.innerHTML && iframeDoc.body.innerHTML.length > 50) {
                    filled = true;
                    console.log('[wechat] iframe body innerHTML 设置成功');
                  }
                }
              } catch (e) {
                console.warn('[wechat] iframe body 设置失败:', e);
              }
            }

            // 方法3：使用 execCommand
            if (!filled) {
              try {
                var iframe = editor as HTMLIFrameElement;
                var iframeDoc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
                if (iframeDoc) {
                  iframeDoc.body.focus();
                  iframeDoc.execCommand('selectAll', false, undefined);
                  var result = iframeDoc.execCommand('insertHTML', false, contentHtml);
                  if (result) {
                    filled = true;
                    console.log('[wechat] execCommand insertHTML 成功');
                  }
                }
              } catch (e) {
                console.warn('[wechat] execCommand 失败:', e);
              }
            }

            // 方法4：模拟粘贴事件
            if (!filled) {
              try {
                var iframe = editor as HTMLIFrameElement;
                var iframeDoc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
                if (iframeDoc && iframeDoc.body) {
                  iframeDoc.body.focus();
                  
                  var dt = new DataTransfer();
                  dt.setData('text/html', contentHtml);
                  dt.setData('text/plain', contentHtml.replace(/<[^>]+>/g, ''));

                  var pasteEvent = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt,
                  } as ClipboardEventInit);

                  Object.defineProperty(pasteEvent, 'clipboardData', {
                    get: function () {
                      return dt;
                    },
                  });

                  iframeDoc.body.dispatchEvent(pasteEvent);
                  console.log('[wechat] ClipboardEvent paste 已触发');
                }
              } catch (e) {
                console.warn('[wechat] ClipboardEvent paste 失败:', e);
              }
            }

            if (filled) {
              console.log('[wechat] 正文已填充');
            } else {
              console.warn('[wechat] 自动填充失败，尝试复制到剪贴板');
              // 将 HTML 内容复制到剪贴板，方便用户手动粘贴
              try {
                // 使用 Clipboard API 写入 HTML
                var blob = new Blob([contentHtml], { type: 'text/html' });
                var clipboardItem = new ClipboardItem({
                  'text/html': blob,
                  'text/plain': new Blob([contentHtml.replace(/<[^>]+>/g, '')], { type: 'text/plain' })
                });
                navigator.clipboard.write([clipboardItem]).then(function() {
                  console.log('[wechat] HTML 已复制到剪贴板，请在编辑器中按 Ctrl+V 粘贴');
                  alert('内容已复制到剪贴板，请在编辑器中按 Ctrl+V 粘贴');
                }).catch(function(e) {
                  console.warn('[wechat] Clipboard API 失败，尝试纯文本:', e);
                  navigator.clipboard.writeText(contentHtml);
                  console.log('[wechat] 纯文本已复制到剪贴板');
                });
              } catch (e) {
                console.warn('[wechat] 无法复制到剪贴板:', e);
              }
            }

            return filled;
          });
        })
        .then(function () {
          return sleep(1000);
        })
        .then(function () {
          console.log('[wechat] 内容已填充，请手动检查并保存');
          return {
            url: window.location.href,
            success: true,
            meta: {
              wordCount: payload.meta ? payload.meta.wordCount : undefined,
              readingTime: payload.meta ? payload.meta.readingTime : undefined,
            },
          };
        })
        .catch(function (error: any) {
          console.error('[wechat] 发布失败:', error);
          return {
            url: window.location.href,
            success: false,
            error: error.message || String(error),
          };
        });
    },
  },
};
