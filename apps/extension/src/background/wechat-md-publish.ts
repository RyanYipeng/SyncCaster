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
        const match = script.textContent?.match(/token['":\\s]+['"]?(\d+)['"]?/);
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
      return { success: false, error: 'Unable to get WeChat token. Please login first.' };
    }

    const editorUrl = buildWechatEditorUrl(token);

    const fillTitleOnly = async (platformPayload: { title: string; author?: string }): Promise<any> => {
      console.log('[wechat] WeChat publish flow started (title only)');
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
        const titleSelectors = ['#title', 'input[placeholder*="title"]', '.title_input input', '.weui-desktop-form__input'];
        const titleInput = await findElement(titleSelectors, 5000) as HTMLInputElement | null;
        if (titleInput) {
          titleInput.value = platformPayload.title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log('[wechat] Title filled:', platformPayload.title);
        } else {
          console.warn('[wechat] Title input not found');
        }
        if (platformPayload.author) {
          const authorSelectors = ['#author', 'input[placeholder*="author"]'];
          const authorInput = await findElement(authorSelectors, 2000) as HTMLInputElement | null;
          if (authorInput) {
            authorInput.value = platformPayload.author;
            authorInput.dispatchEvent(new Event('input', { bubbles: true }));
            authorInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[wechat] Author filled:', platformPayload.author);
          }
          await sleep(200);
        }
        console.log('[wechat] WeChat publish page opened, title filled');
        return { url: window.location.href, success: true, needManualCopy: true };
      } catch (error: any) {
        console.error('[wechat] Publish flow failed:', error);
        return { url: window.location.href, success: false, error: error.message || String(error) };
      }
    };

    const result: any = await executeInOrigin(editorUrl, fillTitleOnly, [{ title, author: author || undefined }], { closeTab: false, active: true, reuseKey });

    if (result?.success) {
      return { success: true, message: 'WeChat publish page opened. Please click Copy button and paste content manually.', url: result?.url, needManualCopy: true };
    }
    return { success: false, error: result?.error || 'Title fill not confirmed.', url: result?.url, needManualCopy: true };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
