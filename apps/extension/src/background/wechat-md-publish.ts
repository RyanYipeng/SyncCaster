import { executeInOrigin } from './inpage-runner';

export interface MdEditorWechatPublishPayload {
  title: string;
  content: string;
  author?: string;
}

export interface MdEditorWechatPublishResponse {
  success: boolean;
  message?: string;
  error?: string;
  url?: string;
  meta?: Record<string, any>;
  needManualCopy?: boolean;
}

function buildWechatEditorUrl(token: string): string {
  const timestamp = Date.now();
  return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=${token}&lang=zh_CN&timestamp=${timestamp}`;
}

const homeUrl = 'https://mp.weixin.qq.com/';

async function getWechatToken(reuseKey: string): Promise<string | null> {
  const getTokenScript = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');
    if (!token) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const match = script.textContent?.match(/token['":\\s]+['\"]?(\d+)['\"]?/);
        if (match) { token = match[1]; break; }
      }
    }
    if (!token && (window as any).wx && (window as any).wx.cgiData) {
      token = (window as any).wx.cgiData.token;
    }
    if (!token) {
      try { const stored = localStorage.getItem('wx_token'); if (stored) token = stored; } catch {}
    }
    return token || null;
  };
  const token = await executeInOrigin(homeUrl, getTokenScript, [], { closeTab: false, active: false, reuseKey });
  return token ? String(token) : null;
}


export async function publishWechatFromMdEditor(
  payload: MdEditorWechatPublishPayload,
): Promise<MdEditorWechatPublishResponse> {
  const title = String(payload?.title || '').trim();
  const author = payload?.author ? String(payload.author) : '';
  const reuseKey = 'wechat:mp-editor:from-md-editor';

  try {
    const token = await getWechatToken(reuseKey);
    if (!token) {
      await executeInOrigin(homeUrl, () => ({ ok: true }), [], { closeTab: false, active: true, reuseKey });
      return { success: false, error: '\u65e0\u6cd5\u83b7\u53d6\u5fae\u4fe1\u516c\u4f17\u53f7 token\uff0c\u8bf7\u5148\u767b\u5f55\u516c\u4f17\u53f7\u540e\u53f0\uff08\u5df2\u4e3a\u4f60\u6253\u5f00\u767b\u5f55\u9875\uff09\uff0c\u767b\u5f55\u540e\u56de\u5230 md-editor \u518d\u70b9\u4e00\u6b21\u201c\u53d1\u5e03\u5230\u5fae\u4fe1\u201d' };
    }

    const editorUrl = buildWechatEditorUrl(token);

    const fillTitleOnly = async (platformPayload: { title: string; author?: string }): Promise<any> => {
      console.log('[wechat] \u5fae\u4fe1\u516c\u4f17\u53f7\u53d1\u6587\u6d41\u7a0b\u5f00\u59cb\uff08\u4ec5\u586b\u5145\u6807\u9898\uff09');
      function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
      function waitForElement(selector: string, timeout: number): Promise<Element | null> {
        return new Promise((resolve) => {
          const start = Date.now();
          function check() {
            const el = document.querySelector(selector);
            if (el) { resolve(el); return; }
            if (Date.now() - start > timeout) { resolve(null); return; }
            setTimeout(check, 200);
          }
          check();
        });
      }
      async function findElement(selectors: string[], timeout: number): Promise<Element | null> {
        for (const selector of selectors) {
          const el = await waitForElement(selector, timeout / selectors.length);
          if (el) return el;
        }
        return null;
      }
      try {
        await sleep(2000);
        const titleSelectors = ['#title', 'input[placeholder*="\u6807\u9898"]', 'input[placeholder*="\u8bf7\u5728\u8fd9\u91cc\u8f93\u5165\u6807\u9898"]', '.title_input input', '.weui-desktop-form__input'];
        const titleInput = await findElement(titleSelectors, 5000) as HTMLInputElement | null;
        if (titleInput) {
          titleInput.value = platformPayload.title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log('[wechat] \u6807\u9898\u5df2\u586b\u5145:', platformPayload.title);
        } else {
          console.warn('[wechat] \u672a\u627e\u5230\u6807\u9898\u8f93\u5165\u6846');
        }
        if (platformPayload.author) {
          const authorSelectors = ['#author', 'input[placeholder*="\u4f5c\u8005"]', 'input[placeholder*="\u8bf7\u8f93\u5165\u4f5c\u8005"]'];
          const authorInput = await findElement(authorSelectors, 2000) as HTMLInputElement | null;
          if (authorInput) {
            authorInput.value = platformPayload.author;
            authorInput.dispatchEvent(new Event('input', { bubbles: true }));
            authorInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[wechat] \u4f5c\u8005\u5df2\u586b\u5145:', platformPayload.author);
          }
          await sleep(200);
        }
        console.log('[wechat] \u5fae\u4fe1\u516c\u4f17\u53f7\u53d1\u6587\u9875\u9762\u5df2\u6253\u5f00\uff0c\u6807\u9898\u5df2\u586b\u5145');
        return { url: window.location.href, success: true, needManualCopy: true };
      } catch (error: any) {
        console.error('[wechat] \u53d1\u6587\u6d41\u7a0b\u5931\u8d25:', error);
        return { url: window.location.href, success: false, error: error.message || String(error) };
      }
    };

    const result: any = await executeInOrigin(editorUrl, fillTitleOnly, [{ title, author: author || undefined }], { closeTab: false, active: true, reuseKey });

    if (result?.success) {
      return { success: true, message: '\u5df2\u6253\u5f00\u5fae\u4fe1\u516c\u4f17\u53f7\u53d1\u6587\u9875\u9762\u5e76\u586b\u5145\u6807\u9898\uff0c\u8bf7\u70b9\u51fb\u4e0a\u65b9\u201c\u590d\u5236\u201d\u6309\u94ae\u590d\u5236\u5185\u5bb9\u540e\u5728\u53d1\u6587\u9875\u9762\u624b\u52a8\u7c98\u8d34\u6b63\u6587', url: result?.url, needManualCopy: true };
    }
    return { success: false, error: result?.error || '\u6253\u5f00\u516c\u4f17\u53f7\u53d1\u6587\u9875\u6210\u529f\uff0c\u4f46\u6807\u9898\u586b\u5145\u672a\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u7f16\u8f91\u5668\u9875\u9762', url: result?.url, needManualCopy: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
