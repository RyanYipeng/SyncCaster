import { getAdapter } from '@synccaster/adapters';
import { executeInOrigin } from './inpage-runner';

export interface MdEditorWechatPublishPayload {
  title: string;
  /** Rendered HTML content from md-editor */
  content: string;
  author?: string;
}

export interface MdEditorWechatPublishResponse {
  success: boolean;
  message?: string;
  error?: string;
  url?: string;
  meta?: Record<string, any>;
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
        const match = script.textContent?.match(/token['":\\s]+['\"]?(\\d+)['\"]?/);
        if (match) {
          token = match[1];
          break;
        }
      }
    }

    if (!token && (window as any).wx && (window as any).wx.cgiData) {
      token = (window as any).wx.cgiData.token;
    }

    if (!token) {
      try {
        const stored = localStorage.getItem('wx_token');
        if (stored) token = stored;
      } catch {}
    }

    return token || null;
  };

  const token = await executeInOrigin(homeUrl, getTokenScript, [], {
    closeTab: false,
    active: false,
    reuseKey,
  });

  return token ? String(token) : null;
}

export async function publishWechatFromMdEditor(
  payload: MdEditorWechatPublishPayload,
): Promise<MdEditorWechatPublishResponse> {
  const title = String(payload?.title || '').trim();
  const contentHtml = String(payload?.content || '');
  const author = payload?.author ? String(payload.author) : '';

  if (!contentHtml) {
    return { success: false, error: '正文为空，请先在 md-editor 生成预览内容' };
  }

  const reuseKey = 'wechat:mp-editor:from-md-editor';

  try {
    const token = await getWechatToken(reuseKey);
    if (!token) {
      // 激活登录页，提示用户手动登录后重试
      await executeInOrigin(
        homeUrl,
        () => ({ ok: true }),
        [],
        { closeTab: false, active: true, reuseKey },
      );
      return {
        success: false,
        error: '无法获取微信公众号 token，请先登录公众号后台（已为你打开登录页），登录后回到 md-editor 再点一次“发布到微信”',
      };
    }

    const editorUrl = buildWechatEditorUrl(token);

    const adapter: any = getAdapter('wechat');
    const fillAndPublish: any = adapter?.dom?.fillAndPublish;
    if (typeof fillAndPublish !== 'function') {
      return { success: false, error: '微信公众号适配器未提供 dom.fillAndPublish' };
    }

    const platformPayload = {
      title,
      contentHtml,
      author: author || undefined,
    };

    const result: any = await executeInOrigin(editorUrl, fillAndPublish, [platformPayload], {
      closeTab: false,
      active: true,
      reuseKey,
    });

    if (result?.success) {
      return {
        success: true,
        message: '已打开微信公众号发文页面并自动填充标题和正文',
        url: result?.url,
        meta: result?.meta,
      };
    }

    return {
      success: false,
      error: result?.__synccasterNote || result?.error || '打开公众号发文页成功，但自动填充未确认，请检查编辑器页面',
      url: result?.url,
      meta: result?.meta,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}

