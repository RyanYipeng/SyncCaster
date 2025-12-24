import { db, type CanonicalPost, type PublishTarget, type LogEntry } from '@synccaster/core';
import { ChromeStorageBridge } from '@synccaster/core';
import { getAdapter } from '@synccaster/adapters';
import { executeInOrigin, getReuseTabInfo } from './inpage-runner';
import { ImageUploadPipeline, getImageStrategy, type ImageUploadProgress, renderMarkdownToHtmlForPaste } from '@synccaster/core';
import type { AssetManifest } from '@synccaster/core';

export interface EngineResult {
  success: boolean;
  url?: string;
  remoteId?: string;
  error?: string;
  meta?: Record<string, any>;
}

function isLikelyPublishedUrl(platformId: string, url: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome-extension://')) return false;

  const u = url.toLowerCase();
  const patterns: Record<string, RegExp[]> = {
    aliyun: [/developer\.aliyun\.com\/article\/\d+/i],
    bilibili: [/bilibili\.com\/read\/cv\d+/i],
    '51cto': [/blog\.51cto\.com\/u_\d+\/\d+/i, /blog\.51cto\.com\/\d+\/\d+/i],
    csdn: [/blog\.csdn\.net\/[^/]+\/article\/details\/\d+/i],
    juejin: [/juejin\.cn\/post\/\w+/i],
    zhihu: [/zhuanlan\.zhihu\.com\/p\/\d+/i],
    segmentfault: [/segmentfault\.com\/a\/\d+/i],
    oschina: [/my\.oschina\.net\/[^/]+\/blog\/\d+/i],
    jianshu: [/jianshu\.com\/p\/[0-9a-f]+/i],
    cnblogs: [/cnblogs\.com\/[^/]+\/p\/\d+\.html/i],
    'tencent-cloud': [/cloud\.tencent\.com\/developer\/article\/\d+/i],
  };

  const list = patterns[platformId];
  if (list) return list.some((re) => re.test(u));

  // 默认：保守处理（不确认即不算成功）
  return false;
}

export async function appendJobLog(jobId: string, entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  const job = await db.jobs.get(jobId);
  if (!job) return;
  const log: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    level: entry.level,
    step: entry.step,
    message: entry.message,
    meta: entry.meta,
  };
  await db.jobs.update(jobId, { logs: [...job.logs, log], updatedAt: Date.now() });
}

type DownloadedImage = { url: string; base64: string; mimeType: string };

// 同一个 job 可能会并发发布多个平台：图片下载可复用，避免重复下载拖慢整体速度
const jobDownloadedImagesCache = new Map<
  string,
  { createdAt: number; promise: Promise<DownloadedImage[]> }
>();
const JOB_IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;

function getJobImagesCacheKey(jobId: string) {
  return `${jobId}:downloadedImages`;
}

function cleanupJobImagesCache() {
  const now = Date.now();
  for (const [k, v] of jobDownloadedImagesCache.entries()) {
    if (now - v.createdAt > JOB_IMAGE_CACHE_TTL_MS) jobDownloadedImagesCache.delete(k);
  }
}

export async function publishToTarget(
  jobId: string,
  post: CanonicalPost,
  target: PublishTarget,
  options: { activeTab?: boolean } = {},
): Promise<EngineResult> {
  console.log('[publish-engine] publishToTarget called', { jobId, platform: target.platform });
  const activeTab = options.activeTab ?? true;
  
  let adapter: any;
  try {
    adapter = getAdapter(target.platform);
    console.log('[publish-engine] adapter loaded', { id: adapter.id, kind: adapter.kind });
  } catch (error: any) {
    console.error('[publish-engine] Failed to get adapter', error);
    return { success: false, error: `Adapter not found: ${target.platform}` };
  }

  const jobLogger = async (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    console.log(`[publish-engine:${entry.step}]`, entry.message, entry.meta || '');
    await appendJobLog(jobId, entry);
  };

  try {
    await jobLogger({ level: 'info', step: 'adapter', message: `使用适配器: ${adapter.name} (${adapter.id}, kind: ${adapter.kind})` });

    // 读取账号
    const account = await db.accounts.get(target.accountId);
    if (!account) {
      await jobLogger({ level: 'error', step: 'auth', message: '账号不存在或未登录', meta: { accountId: target.accountId } });
      return { success: false, error: 'Account not found' };
    }

    // 认证
    const auth = await adapter.ensureAuth({ account });
    if (!auth?.valid) {
      await jobLogger({ level: 'error', step: 'auth', message: '认证无效，请先登录该平台', meta: { accountId: target.accountId } });
      return { success: false, error: 'Auth invalid' };
    }

    // 处理图片 - 对于 DOM 模式，图片将在发布时一起处理
    // 注意：部分来源的 Markdown 图片链接会混入空格/换行（例如 `. jpeg`），导致平台/上传无法识别。
    // 这里先规范化图片语法里的 URL，保证后续提取、上传、替换都基于同一个“干净 URL”。
    let processedPost = {
      ...post,
      body_md: normalizeMarkdownImageUrls(post.body_md || ''),
    };

    // ================================
    // 微信公众号：两阶段发布流程（先进入 MD 编辑器预览）
    // ================================
    // 1) 用户在 SyncCaster 中点击发布
    // 2) 打开内置微信 Markdown 编辑器（md-editor）进行预览排版
    // 3) 用户在 md-editor 中点击“发布到微信”后，才会打开微信公众号发文页并自动填充
    //
    // 注意：这里不应自动打开微信公众号官方发文页面。
    if (target.platform === 'wechat') {
      await jobLogger({
        level: 'info',
        step: 'wechat',
        message: '微信公众号：已切换到「先预览后发布」流程，打开微信 Markdown 编辑器',
      });

      try {
        await ChromeStorageBridge.saveArticle({
          id: processedPost.id || jobId,
          title: processedPost.title || '未命名标题',
          content: processedPost.body_md || '',
          sourceUrl: (processedPost as any).source_url || undefined,
          updatedAt: Date.now(),
        });

        const mdEditorBaseUrl = chrome.runtime.getURL('md-editor/md-editor.html');
        const mdEditorUrl = `${mdEditorBaseUrl}?from=synccaster`;

        try {
          const allTabs = await chrome.tabs.query({});
          const existing = (allTabs || []).find((t) => (t.url || '').startsWith(mdEditorBaseUrl));
          if (existing?.id) {
            await chrome.tabs.update(existing.id, { url: mdEditorUrl, active: true });
          } else {
            await chrome.tabs.create({ url: mdEditorUrl, active: true });
          }
        } catch {
          // tabs 查询/更新失败时兜底：直接新开
          await chrome.tabs.create({ url: mdEditorUrl, active: true });
        }

        await jobLogger({
          level: 'info',
          step: 'wechat',
          message: '已打开微信 Markdown 编辑器：请在编辑器中预览排版并点击「发布到微信」继续',
          meta: { url: mdEditorUrl },
        });

        return {
          success: false,
          error: '已打开微信 Markdown 编辑器，请在编辑器中点击「发布到微信」继续',
          meta: { unconfirmed: true, currentUrl: mdEditorUrl, deferredToMdEditor: true },
        };
      } catch (e: any) {
        await jobLogger({
          level: 'error',
          step: 'wechat',
          message: '打开微信 Markdown 编辑器失败',
          meta: { error: e?.message },
        });
        return { success: false, error: e?.message || '打开微信 Markdown 编辑器失败' };
      }
    }

    const manifest = buildAssetManifest(processedPost);
    let strategy = getImageStrategy(target.platform);

    // CSDN：使用 Markdown 编辑器直接粘贴即可，图片外链通常可用；为提升首屏填充速度，这里跳过图片预处理。
    if (target.platform === 'csdn') {
      strategy = null;
    }
    
    // 处理图片：若目标平台不接受外链，需先上传并替换 URL。
    // domPasteUpload（如掘金/阿里云）在“同一发布页”里做粘贴上传更稳定，避免先打开一个空白上传页导致报错/阻塞。
    let downloadedImages: DownloadedImage[] = [];

    const needsDownloadedImagesForDomFill =
      adapter.kind === 'dom' &&
      strategy?.mode === 'domPasteUpload' &&
      (target.platform === 'aliyun' || target.platform === 'juejin');

    const prefillBeforeImageProcessing =
      adapter.kind === 'dom' && (target.platform === 'bilibili' || target.platform === 'csdn');

    if (!prefillBeforeImageProcessing && manifest.images.length > 0 && strategy && strategy.mode !== 'externalUrlOnly') {
      await jobLogger({
        level: 'info',
        step: 'upload_images',
        message: `发现 ${manifest.images.length} 张图片需要处理`,
      });

      if (needsDownloadedImagesForDomFill) {
        try {
          cleanupJobImagesCache();
          const urls = manifest.images.map((img) => img.originalUrl);
          const cacheKey = getJobImagesCacheKey(jobId);
          let cached = jobDownloadedImagesCache.get(cacheKey);
          if (!cached) {
            const promise = downloadImagesInBackground(urls, (progress) => {
              jobLogger({
                level: 'info',
                step: 'upload_images',
                message: `下载图片: ${progress.completed}/${progress.total}`,
                meta: { progress },
              });
            }).catch((e) => {
              jobDownloadedImagesCache.delete(cacheKey);
              throw e;
            });
            cached = { createdAt: Date.now(), promise };
            jobDownloadedImagesCache.set(cacheKey, cached);
          }

          downloadedImages = await cached.promise;
          await jobLogger({
            level: 'info',
            step: 'upload_images',
            message: `图片下载完成: ${downloadedImages.length}/${manifest.images.length}`,
          });
        } catch (imgError: any) {
          console.error('[publish-engine] 图片下载失败', imgError);
          await jobLogger({
            level: 'warn',
            step: 'upload_images',
            message: '图片下载失败，将使用原始链接',
            meta: { error: imgError?.message },
          });
        }
      } else {
        try {
          const imageResult = await uploadImagesInPlatform(
            manifest.images.map((img) => img.originalUrl),
            target.platform,
            strategy,
            (progress) => {
              jobLogger({
                level: 'info',
                step: 'upload_images',
                message: `图片上传: ${progress.completed}/${progress.total}`,
                meta: { progress },
              });
            }
          );

          if (imageResult.urlMapping.size > 0) {
            processedPost = {
              ...processedPost,
              body_md: ImageUploadPipeline.replaceImageUrls(processedPost.body_md || '', imageResult.urlMapping),
            };
            await jobLogger({
              level: 'info',
              step: 'upload_images',
              message: `图片处理完成: ${imageResult.stats.success}/${imageResult.stats.total} 成功`,
              meta: imageResult.stats,
            });
          } else {
            await jobLogger({
              level: 'warn',
              step: 'upload_images',
              message: '图片上传失败，将使用原始链接',
            });
          }
        } catch (imgError: any) {
          console.error('[publish-engine] 图片处理失败', imgError);
          await jobLogger({
            level: 'warn',
            step: 'upload_images',
            message: '图片处理失败，将使用原始链接',
            meta: { error: imgError?.message },
          });
        }
      }
    } else {
      if (prefillBeforeImageProcessing && manifest.images.length > 0 && strategy && strategy.mode !== 'externalUrlOnly') {
        await jobLogger({ level: 'info', step: 'upload_images', message: '图片处理将在内容填充后进行' });
      } else {
        await jobLogger({ level: 'info', step: 'upload_images', message: '无需处理图片或平台不支持' });
      }
    }

    // 转换内容
    await jobLogger({ level: 'info', step: 'transform', message: '转换内容以适配目标平台' });
    let payload = await adapter.transform(processedPost as any, { config: target.config || {} });

    // Rich-text only platforms: ensure we have HTML for paste/injection (doesn't affect Markdown platforms).
    if (
      adapter?.capabilities?.supportsMarkdown === false &&
      adapter?.capabilities?.supportsHtml &&
      !payload?.contentHtml &&
      payload?.contentMarkdown
    ) {
      payload = {
        ...payload,
        contentHtml: renderMarkdownToHtmlForPaste(String(payload.contentMarkdown)),
      };
    }

    // 发布（根据 kind 路由）
    await jobLogger({ level: 'info', step: 'publish', message: `开始发布... (模式: ${adapter.kind})` });
    let result: any = null;

    // 路由策略
    if (adapter.kind === 'dom') {
      // DOM 自动化模式：直接走站内执行
      if ((adapter as any).dom) {
        const dom = (adapter as any).dom as { matchers: string[]; fillAndPublish: Function; getEditorUrl?: Function };
        const reuseKey = `${jobId}:${target.platform}:${target.accountId}`;
        
        // 获取目标 URL
        const targetUrl = toDomOpenUrl(dom.matchers?.[0] || '');
        
        if (!targetUrl) {
          throw new Error('DOM adapter missing target URL');
        }
        await jobLogger({ level: 'info', step: 'dom', message: '使用站内执行（DOM 自动化）' });
        console.log('[publish-engine] Executing DOM automation', { targetUrl });
        try {
          // 将下载的图片数据附加到 payload 中，供 fillAndPublish 使用
          const payloadWithImages = {
            ...payload,
            __downloadedImages: downloadedImages,
            __imageStrategy: strategy,
          };
           // 发布页需要保留给用户观察/手动操作：不要自动关闭标签页
           result = await executeInOrigin(targetUrl, dom.fillAndPublish as any, [payloadWithImages], { closeTab: false, active: activeTab, reuseKey });
           if (result === null || result === undefined) {
             throw new Error('DOM 自动化脚本未返回结果（可能页面脚本报错），请查看目标页面 Console 日志');
           }
           console.log('[publish-engine] DOM automation result', result);
         } catch (e: any) {
            console.error('[publish-engine] DOM automation error', e);
            await jobLogger({ level: 'error', step: 'dom', message: 'DOM 自动化失败', meta: { error: e?.message, stack: e?.stack } });
            throw e;
         }

         // 对于需要图片转链的平台：优先让“正文/标题”快速填入，然后再异步处理图片并回写（改善首屏体验）。
         // 目前仅对 B 站专栏启用（CSDN 已跳过图片预处理）。
         if (
           prefillBeforeImageProcessing &&
           target.platform === 'bilibili' &&
           manifest.images.length > 0 &&
           strategy &&
           strategy.mode !== 'externalUrlOnly'
         ) {
           await jobLogger({ level: 'info', step: 'upload_images', message: `发现 ${manifest.images.length} 张图片需要处理` });
           try {
             const imageResult = await uploadImagesInPlatform(
               manifest.images.map((img) => img.originalUrl),
               target.platform,
               strategy,
               (progress) => {
                 jobLogger({
                   level: 'info',
                   step: 'upload_images',
                   message: `图片上传: ${progress.completed}/${progress.total}`,
                   meta: { progress },
                 });
               }
             );

             if (imageResult.urlMapping.size > 0) {
               const entries = Array.from(imageResult.urlMapping.entries());
               const applyMappingInEditor = async (pairs: [string, string][]) => {
                 const replaceByPairs = (text: string) => {
                   let out = text || '';
                   const sorted = pairs.slice().sort((a, b) => b[0].length - a[0].length);
                   for (const [from, to] of sorted) {
                     if (!from || !to || from === to) continue;
                     out = out.split(from).join(to);
                   }
                   return out;
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

                 const findEditor = (): HTMLElement | null => {
                   for (const doc of getAllDocs()) {
                     const el = doc.querySelector('.ql-editor, .ProseMirror, [contenteditable=\"true\"]') as HTMLElement | null;
                     if (el) return el;
                   }
                   return null;
                 };

                 const editor = findEditor();
                 if (!editor) return { ok: false, reason: 'editor_not_found' };
                 const win = editor.ownerDocument.defaultView || window;
                 const QuillCtor = (win as any).Quill;
                 const quill =
                   QuillCtor?.find?.(editor) ||
                   (editor as any).__quill ||
                   ((editor.closest('.ql-container') as any)?.__quill ?? null);

                 const currentHtml = editor.innerHTML || '';
                 const nextHtml = replaceByPairs(currentHtml);

                 // 优先用 Quill API 回写，保证编辑器内部 state 更新
                 try {
                   if (quill?.clipboard?.dangerouslyPasteHTML) {
                     quill.clipboard.dangerouslyPasteHTML(0, nextHtml);
                     quill.setSelection?.(quill.getLength?.() ?? 0, 0);
                     return { ok: true, method: 'quill' };
                   }
                 } catch {}

                 // DOM 兜底：替换 img/src 等属性
                 try {
                   editor.innerHTML = nextHtml;
                   editor.dispatchEvent(new Event('input', { bubbles: true }));
                   return { ok: true, method: 'dom' };
                 } catch {
                   return { ok: false, reason: 'apply_failed' };
                 }
               };

               await executeInOrigin(targetUrl, applyMappingInEditor as any, [entries], {
                 closeTab: false,
                 active: false,
                 reuseKey,
               });

               await jobLogger({
                 level: 'info',
                 step: 'upload_images',
                 message: `图片处理完成: ${imageResult.stats.success}/${imageResult.stats.total} 成功`,
                 meta: imageResult.stats,
               });
             } else {
               await jobLogger({ level: 'warn', step: 'upload_images', message: '图片上传失败，将使用原始链接' });
             }
           } catch (imgError: any) {
             console.error('[publish-engine] 图片处理失败', imgError);
             await jobLogger({
               level: 'warn',
               step: 'upload_images',
               message: '图片处理失败，将使用原始链接',
               meta: { error: imgError?.message },
             });
           }
         }
       } else {
        throw new Error('DOM adapter missing dom configuration');
      }
    } else if (adapter.kind === 'metaweblog' || adapter.kind === 'restApi') {
      // API 模式：直接调用 adapter.publish
      try {
        result = await adapter.publish(payload as any, {
          account,
          auth,
          assets: post.assets || [],
          logger: jobLogger,
        } as any);
      } catch (e: any) {
        await jobLogger({ level: 'error', step: 'publish', message: 'API 发布失败', meta: { error: e?.message } });
        // 尝试 DOM 降级（如果支持）
        if ((adapter as any).dom) {
          await jobLogger({ level: 'warn', step: 'publish', message: 'API 失败，尝试 DOM 降级' });
          const dom = (adapter as any).dom as { matchers: string[]; fillAndPublish: Function };
          const targetUrl = toDomOpenUrl(dom.matchers?.[0] || '');
          if (targetUrl) {
            // 降级到 DOM 时同样不要自动关闭页面，避免用户正在查看/编辑
            result = await executeInOrigin(targetUrl, dom.fillAndPublish as any, [payload], { closeTab: false, active: false, reuseKey: `${jobId}:${target.platform}:${target.accountId}` });
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }

    // DOM 模式：不能“猜测成功”。必须拿到可信的文章 URL，否则标记为待确认。
    if (!result || !result.url || !isLikelyPublishedUrl(target.platform, String(result.url))) {
      if (adapter.kind === 'dom') {
        const reuseKey = `${jobId}:${target.platform}:${target.accountId}`;
        const tabInfo = await getReuseTabInfo(reuseKey);
        const currentUrl = tabInfo?.url || '';

        if (currentUrl && isLikelyPublishedUrl(target.platform, currentUrl)) {
          await jobLogger({ level: 'info', step: 'publish', message: '检测到发布成功（URL）', meta: { url: currentUrl } });
          return { success: true, url: currentUrl, meta: { detectedFromTab: true } };
        }

        await jobLogger({
          level: 'warn',
          step: 'publish',
          message: '未能确认发布成功（需要手动确认）',
          meta: { currentUrl, note: '页面可能未发布成功，或平台不会跳转到文章页' },
        });

        return {
          success: false,
          error: '未能确认发布成功，请检查发布页并手动确认',
          meta: { unconfirmed: true, currentUrl },
        };
      }
      throw new Error('发布未返回有效链接');
    }

    await jobLogger({ level: 'info', step: 'publish', message: '发布完成', meta: { url: result?.url } });

    return { success: true, url: result?.url, remoteId: result?.remoteId, meta: result?.meta };
  } catch (error: any) {
    console.error('[publish-engine] Publish failed', error);
    await jobLogger({ level: 'error', step: 'publish', message: '发布失败', meta: { error: error?.message || String(error), stack: error?.stack } });
    return { success: false, error: error?.message || error?.toString() || 'Publish failed' };
  }
}

async function fetchImageWithBestEffort(url: string): Promise<Response> {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  const commonHeaders: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  const tryFetch = async (referrer?: string, referrerPolicy?: ReferrerPolicy) => {
    const init: RequestInit = {
      method: 'GET',
      credentials: 'omit',
      headers: commonHeaders,
      cache: 'no-store',
    };
    if (referrer !== undefined) (init as any).referrer = referrer;
    if (referrerPolicy !== undefined) init.referrerPolicy = referrerPolicy;
    return await fetch(url, init);
  };

  // CSDN 图床通常有防盗链：优先模拟来自 CSDN 博客域名的 Referer
  const referrerCandidates: Array<{ referrer?: string; policy?: ReferrerPolicy }> = [];

  if (host.endsWith('csdnimg.cn')) {
    referrerCandidates.push({ referrer: 'https://blog.csdn.net/', policy: 'unsafe-url' });
    referrerCandidates.push({ referrer: 'https://www.csdn.net/', policy: 'unsafe-url' });
  }

  // 默认：使用图片自身 origin 的 referrer（部分站点会校验同源/同站 referer）
  referrerCandidates.push({ referrer: u.origin + '/', policy: 'origin' });

  // 兜底：使用当前目标站点 origin（有些 CDN 仅要求存在可用 referer）
  referrerCandidates.push({ referrer: 'https://developer.aliyun.com/', policy: 'origin' });

  // 最后：不设置 referrer（浏览器默认策略）
  referrerCandidates.push({ referrer: undefined, policy: undefined });

  let lastError: any;
  for (const c of referrerCandidates) {
    try {
      const resp = await tryFetch(c.referrer, c.policy);
      if (resp.ok) return resp;

      // 若是 403/401，继续换 referrer 尝试
      if (resp.status === 401 || resp.status === 403) {
        continue;
      }
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('image download failed');
}


/**
 * 在 background 中下载图片（绕过 CORS/防盗链）
 */
async function downloadImagesInBackground(
  imageUrls: string[],
  onProgress?: (progress: { completed: number; total: number }) => void
): Promise<{ url: string; base64: string; mimeType: string }[]> {
  const downloadedImages: { url: string; base64: string; mimeType: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      console.log(`[publish-engine] 下载图片 ${i + 1}/${imageUrls.length}: ${url}`);
      const response = await fetchImageWithBestEffort(url);

      if (!response.ok) {
        console.error(`[publish-engine] 下载失败: HTTP ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      downloadedImages.push({
        url,
        base64,
        mimeType: blob.type || 'image/png',
      });

      onProgress?.({ completed: i + 1, total: imageUrls.length });
    } catch (error) {
      console.error(`[publish-engine] 下载异常: ${url}`, error);
    }
  }

  return downloadedImages;
}

/**
 * 平台主页 URL 映射
 */
const PLATFORM_URLS: Record<string, string> = {
  juejin: 'https://juejin.cn/',
  // 用于图片上传回退（站内执行）时打开的页面：指向创作中心编辑页，避免误打开首页导致用户困惑
  csdn: 'https://mp.csdn.net/mp_blog/creation/editor',
  zhihu: 'https://www.zhihu.com/',
  wechat: 'https://mp.weixin.qq.com/',
  jianshu: 'https://www.jianshu.com/',
  cnblogs: 'https://www.cnblogs.com/',
  '51cto': 'https://blog.51cto.com/',
  'tencent-cloud': 'https://cloud.tencent.com/developer/',
  // 阿里云图片上传接口可能依赖页面环境（如 CSRF meta），使用新建文章页更稳妥
  aliyun: 'https://developer.aliyun.com/article/new#/',
  segmentfault: 'https://segmentfault.com/',
  // 避免先打开首页再跳转编辑页（用户可见跳转/延迟）；图片上传与发文都可在专栏编辑页完成
  bilibili: 'https://member.bilibili.com/platform/upload/text/edit',
  oschina: 'https://www.oschina.net/',
};

function toDomOpenUrl(matcherOrUrl: string) {
  // DOM adapter matchers 通常包含通配符（用于匹配页面），但 executeInOrigin 需要真实 URL。
  // 规则：取第一个 `*` 之前的部分作为可打开的 URL（避免把 `*` 当作字面量打开）。
  const idx = matcherOrUrl.indexOf('*');
  return idx >= 0 ? matcherOrUrl.slice(0, idx) : matcherOrUrl;
}

/**
 * 在目标平台页面中执行图片上传
 * 
 * 策略：
 * 1. 在 background (Service Worker) 中下载图片 - 可以绑过 CORS/防盗链
 * 2. 将图片数据（base64）传递给目标平台页面
 * 3. 在目标平台页面中上传图片 - 利用用户的登录状态
 */
async function uploadImagesInPlatform(
  imageUrls: string[],
  platformId: string,
  strategy: any,
  onProgress?: (progress: { completed: number; total: number }) => void
): Promise<{
  urlMapping: Map<string, string>;
  stats: { total: number; success: number; failed: number };
}> {
  const targetUrl =
    strategy?.mode === 'domPasteUpload' && strategy.domPasteConfig?.editorUrl
      ? strategy.domPasteConfig.editorUrl
      : PLATFORM_URLS[platformId];

  if (!targetUrl) {
    console.log(`[publish-engine] 未知平台 ${platformId}，跳过图片上传`);
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }

  console.log(`[publish-engine] 准备上传 ${imageUrls.length} 张图片到 ${platformId}`);
  console.log('[publish-engine] 步骤1: 在 background 中下载图片...');
  const downloadedImages: { url: string; base64: string; mimeType: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      console.log(`[publish-engine] 下载图片 ${i + 1}/${imageUrls.length}: ${url}`);
      const response = await fetchImageWithBestEffort(url);

      if (!response.ok) {
        console.error(`[publish-engine] 下载失败: HTTP ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      downloadedImages.push({
        url,
        base64,
        mimeType: blob.type || 'image/png',
      });

      onProgress?.({ completed: i + 1, total: imageUrls.length * 2 });
    } catch (error) {
      console.error(`[publish-engine] 下载异常: ${url}`, error);
    }
  }

  if (downloadedImages.length === 0) {
    console.log('[publish-engine] 没有成功下载任何图片');
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }

  const mimeToExt = (mime: string) => {
    const m = (mime || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('png')) return 'png';
    if (m.includes('gif')) return 'gif';
    if (m.includes('webp')) return 'webp';
    return 'png';
  };

  const tryParseJson = async (res: Response) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const findUrlInObject = (data: any): string | undefined => {
    const seen = new Set<any>();
    const walk = (obj: any, depth = 0): string | undefined => {
      if (!obj || depth > 4) return undefined;
      if (typeof obj === 'string') {
        if (obj.startsWith('http://') || obj.startsWith('https://')) return obj;
        if (obj.startsWith('//')) return 'https:' + obj;
        return undefined;
      }
      if (typeof obj !== 'object') return undefined;
      if (seen.has(obj)) return undefined;
      seen.add(obj);

      for (const key of ['url', 'src', 'path', 'image', 'imageUrl', 'image_url']) {
        const found = walk((obj as any)[key], depth + 1);
        if (found) return found;
      }
      for (const v of Object.values(obj)) {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
      return undefined;
    };
    return walk(data);
  };

  const getCookie = async (url: string, name: string): Promise<string | undefined> => {
    try {
      const c = await chrome.cookies.get({ url, name });
      return c?.value || undefined;
    } catch {
      return undefined;
    }
  };

  // B 站：部分环境会拦截合成的 paste/drop 事件（站内粘贴上传不稳定）。
  // 这里先尝试走 API 直传（若可用），失败再回退到“站内执行”。
  if (platformId === 'bilibili') {
    try {
      const csrf =
        (await getCookie('https://www.bilibili.com/', 'bili_jct')) ||
        (await getCookie('https://api.bilibili.com/', 'bili_jct'));

      const endpoints = [
        { url: 'https://api.bilibili.com/x/article/creative/article/upimage', fileField: 'file' },
        { url: 'https://api.bilibili.com/x/article/creative/article/upcover', fileField: 'file' },
        { url: 'https://api.bilibili.com/x/article/creative/article/upimage', fileField: 'binary' },
      ];

      const urlMapping = new Map<string, string>();
      let success = 0;
      let failed = 0;

      for (let i = 0; i < downloadedImages.length; i++) {
        const img = downloadedImages[i];
        try {
          const blobRes = await fetch(img.base64);
          const blob = await blobRes.blob();
          const ext = mimeToExt(blob.type || img.mimeType || 'image/png');
          const filename = `image_${Date.now()}_${i}.${ext}`;

          let uploadedUrl: string | undefined;
          for (const ep of endpoints) {
            try {
              const form = new FormData();
              form.append(ep.fileField, blob, filename);
              if (csrf) {
                form.append('csrf', csrf);
                form.append('csrf_token', csrf);
              }

              const resp = await fetch(ep.url, { method: 'POST', body: form, credentials: 'include' });
              if (!resp.ok) continue;
              const data = await tryParseJson(resp);
              uploadedUrl = findUrlInObject(data);
              if (uploadedUrl) break;
            } catch {
              // try next endpoint
            }
          }

          if (!uploadedUrl) throw new Error('no bilibili url');
          urlMapping.set(img.url, uploadedUrl);
          success++;
        } catch {
          failed++;
        } finally {
          onProgress?.({ completed: success + failed, total: imageUrls.length });
        }
      }

      if (success > 0) {
        console.log(`[publish-engine] bilibili API 直传完成: ${success}/${downloadedImages.length} 成功`);
        return { urlMapping, stats: { total: imageUrls.length, success, failed } };
      }
    } catch {
      // ignore and fallback
    }
  }

  console.log(`[publish-engine] 步骤2: 在 ${targetUrl} 中上传 ${downloadedImages.length} 张图片`);

  // 优先尝试在 background 直接上传（避免额外打开标签页，用户无感）
  // 若失败再回退到“站内执行”方式。
  const canBackgroundUpload =
    strategy &&
    typeof strategy.uploadUrl === 'string' &&
    (strategy.mode === 'binaryUpload' || strategy.mode === 'formUpload');

  if (canBackgroundUpload) {
    try {
      console.log(`[publish-engine] 尝试 background 直传图片到 ${platformId}`);
      const urlMapping = new Map<string, string>();
      let success = 0;
      let failed = 0;

      const uploadOrigin = new URL(strategy.uploadUrl).origin + '/';

      const headersBase: Record<string, string> = {};
      if (strategy.csrfToken?.type === 'cookie' && strategy.csrfToken.name && strategy.csrfToken.headerName) {
        const csrf = await getCookie(uploadOrigin, strategy.csrfToken.name);
        if (csrf) headersBase[strategy.csrfToken.headerName] = csrf;
      }

      for (let i = 0; i < downloadedImages.length; i++) {
        const img = downloadedImages[i];
        try {
          const blobRes = await fetch(img.base64);
          const blob = await blobRes.blob();
          const ext = mimeToExt(blob.type || img.mimeType || 'image/png');
          const filename = `image_${Date.now()}_${i}.${ext}`;

          const formData = new FormData();
          const fileFieldName = strategy.fileFieldName || 'file';
          formData.append(fileFieldName, blob, filename);

          const resp = await fetch(strategy.uploadUrl, {
            method: strategy.method || 'POST',
            headers: headersBase,
            body: formData,
            credentials: 'include',
          });

          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }

          const data = await tryParseJson(resp);
          let newUrl: string | undefined;

          if (typeof strategy.responseParser === 'function') {
            try {
              newUrl = strategy.responseParser(data)?.url;
            } catch {}
          }
          if (!newUrl) {
            if ((data as any)?.data) {
              const d = (data as any).data;
              newUrl = d?.url || d?.src || d?.path || d?.imageUrl || d?.image_url;
            }
            if (!newUrl) newUrl = (data as any)?.url || (data as any)?.src || (data as any)?.path;
          }
          if (!newUrl) newUrl = findUrlInObject(data);
          if (!newUrl) throw new Error('无法解析图片 URL');

          urlMapping.set(img.url, newUrl);
          success++;
        } catch {
          failed++;
        } finally {
          onProgress?.({ completed: success + failed, total: imageUrls.length });
        }
      }

      if (success > 0) {
        console.log(`[publish-engine] background 直传完成: ${success}/${downloadedImages.length} 成功`);
        return { urlMapping, stats: { total: imageUrls.length, success, failed } };
      }

      console.warn('[publish-engine] background 直传全部失败，回退到站内执行');
    } catch (e) {
      console.warn('[publish-engine] background 直传异常，回退到站内执行', e);
    }
  }

  const uploadFunction = async (
    images: { url: string; base64: string; mimeType: string }[],
    strategyConfig: any
  ) => {
    console.log('[image-upload] 开始在页面中上传图片', { count: images.length, mode: strategyConfig.mode });
    
    const results: { originalUrl: string; newUrl: string; success: boolean; error?: string }[] = [];

    const mimeToExt = (mime: string) => {
      const m = (mime || '').toLowerCase();
      if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
      if (m.includes('png')) return 'png';
      if (m.includes('gif')) return 'gif';
      if (m.includes('webp')) return 'webp';
      return 'png';
    };

    const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
      const res = await fetch(dataUrl);
      if (!res.ok) {
        throw new Error('dataURL fetch failed: ' + res.status);
      }
      return await res.blob();
    };

    const collectUrls = (root: ParentNode): string[] => {
      const urls: string[] = [];
      Array.from(root.querySelectorAll<HTMLImageElement>('img')).forEach((el) => {
        if (el.src) urls.push(el.src);
        for (const attr of ['data-src', 'data-original', 'data-url', 'data-origin', 'data-source']) {
          const v = el.getAttribute(attr);
          if (v) urls.push(v);
        }
      });
      Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).forEach((a) => {
        if (a.href) urls.push(a.href);
        const raw = a.getAttribute('href');
        if (raw) urls.push(raw);
      });
      const text = (root as HTMLElement).innerText || '';
      const regex = /((?:https?:)?\/\/[^\s"'<>]+)/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const u = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
        urls.push(u);
      }
      return urls;
    };

    const waitForNewUrl = (
      root: HTMLElement,
      beforeSet: Set<string>,
      timeoutMs: number
    ): Promise<string> => {
      return new Promise((resolve, reject) => {
        const hostWin = root.ownerDocument.defaultView || window;
        const seen = new Set(beforeSet);

        const checkOnce = () => {
          const urls = collectUrls(root);
          for (const u of urls) {
            if (!u || seen.has(u)) continue;
            if (u.startsWith('data:') || u.startsWith('blob:')) continue;
            const normalized = u.startsWith('//') ? 'https:' + u : u;
            observer.disconnect();
            hostWin.clearTimeout(timer);
            resolve(normalized);
            return;
          }
        };

        const observer = new hostWin.MutationObserver(() => checkOnce());
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'href'],
        });

        checkOnce();

        const timer = hostWin.setTimeout(() => {
          observer.disconnect();
          reject(new Error('waitForNewUrl timeout'));
        }, timeoutMs);
      });
    };

    const waitForNewUrlInText = async (
      el: HTMLTextAreaElement | HTMLInputElement,
      beforeText: string,
      originalUrl: string,
      timeoutMs: number
    ): Promise<string> => {
      const start = Date.now();
      const norm = (u: string) => (u.startsWith('//') ? 'https:' + u : u);
      const urlRe = /(?:https?:)?\/\/[^\s)'"<>]+/g;

      while (Date.now() - start < timeoutMs) {
        const current = el.value || '';
        if (current !== beforeText) {
          const matches = current.match(urlRe) || [];
          for (let i = matches.length - 1; i >= 0; i--) {
            const candidate = norm(matches[i]);
            if (!candidate) continue;
            if (candidate === originalUrl) continue;
            if (beforeText.includes(candidate)) continue;
            return candidate;
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      throw new Error('waitForNewUrlInText timeout');
    };

    const findInDocBestEffort = (doc: Document, win: Window, selector: string): HTMLElement | null => {
      const candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector));
      if (candidates.length === 0) return null;

      const isVisible = (el: HTMLElement) => {
        try {
          const style = win.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        } catch (e) {
          return true;
        }
      };

      const visible = candidates.filter(isVisible);
      const list = visible.length > 0 ? visible : candidates;

      let best: { el: HTMLElement; score: number } | null = null;
      for (const el of list) {
        const rect = el.getBoundingClientRect();
        const score = Math.max(1, rect.width) * Math.max(1, rect.height);
        if (!best || score > best.score) best = { el, score };
      }
      return best?.el || list[0] || null;
    };

    const findInMainOrFrames = (selector: string): { el: HTMLElement; win: Window } | null => {
      const main = findInDocBestEffort(document, window, selector);
      if (main) return { el: main, win: window };

      const frames = Array.from(document.querySelectorAll('iframe'));
      for (const frame of frames) {
        try {
          const w = (frame as HTMLIFrameElement).contentWindow;
          const d = (frame as HTMLIFrameElement).contentDocument;
          if (!w || !d) continue;
          const el = findInDocBestEffort(d, w, selector);
          if (el) return { el, win: w };
        } catch (e) {}
      }

      return null;
    };

    const ensureEditor = async (
      selector: string,
      timeoutMs: number
    ): Promise<{ el: HTMLElement; win: Window } | null> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = findInMainOrFrames(selector);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };

    const focusEditor = async (el: HTMLElement, hostWin: Window) => {
      try {
        if (typeof hostWin !== 'undefined' && typeof hostWin.focus === 'function') {
          hostWin.focus();
        }
      } catch (_) {}
      if (typeof el.focus === 'function') {
        el.focus();
      }
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
      } catch (_) {}
      if (typeof (el as any).click === 'function') {
        try {
          (el as any).click();
        } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 80));
    };
    
    if (strategyConfig.mode === 'domPasteUpload' && (window as any).__juejinDomPaste) {
      const cfg = strategyConfig.domPasteConfig || {};
      try {
        const resp = await (window as any).__juejinDomPaste(images, cfg);
        return resp;
      } catch (e) {
        console.error('[image-upload] __juejinDomPaste failed, fallback to local logic', e);
      }
    }

    for (const img of images) {
      try {
        if (strategyConfig.mode === 'domPasteUpload') {
          const cfg = strategyConfig.domPasteConfig || {};
          const found =
            (cfg.editorSelector && (await ensureEditor(cfg.editorSelector, cfg.timeoutMs || 15000))) ||
            { el: document.querySelector<HTMLElement>(cfg.editorSelector || 'body') || document.body, win: window };
          if (!found?.el) {
            throw new Error('未找到编辑区：' + (cfg.editorSelector || 'body'));
          }
          const editor = found.el;
          const hostWin = found.win || window;

          const blob = await dataUrlToBlob(img.base64);
          const ext = mimeToExt(blob.type || img.mimeType || 'image/png');
          const filename = `image_${Date.now()}.${ext}`;
          const file = new File([blob], filename, { type: blob.type || img.mimeType });

          const isTextInput = (node: any): node is HTMLTextAreaElement | HTMLInputElement =>
            node && typeof node.value === 'string';

          const pickPasteTarget = (root: HTMLElement) => {
            const doc = root.ownerDocument;
            const candidates = Array.from(doc.querySelectorAll<HTMLElement>('textarea, input, [contenteditable="true"]'));
            const inRoot = candidates.filter((el) => root === el || root.contains(el));
            const list = inRoot.length > 0 ? inRoot : candidates;
            const visible = list.filter((el) => {
              try {
                const style = hostWin.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              } catch (e) {
                return true;
              }
            });
            const pickFrom = visible.length > 0 ? visible : list;
            if (pickFrom.length === 0) return root;
            let best: { el: HTMLElement; score: number } | null = null;
            for (const el of pickFrom) {
              const rect = el.getBoundingClientRect();
              const score = Math.max(1, rect.width) * Math.max(1, rect.height);
              if (!best || score > best.score) best = { el, score };
            }
            return best?.el || pickFrom[0] || root;
          };

          const pasteTarget = pickPasteTarget(editor);

          await focusEditor(pasteTarget, hostWin);

          const beforeText = isTextInput(pasteTarget) ? (pasteTarget.value || '') : '';

          const beforeSrcSet = new Set(Array.from(editor.querySelectorAll('img')).map((el: any) => el.src));

          const simulatePaste = (): boolean => {
            try {
              const DT = (hostWin as any).DataTransfer || (globalThis as any).DataTransfer;
              const dt = new DT();
              dt.items.add(file);
              const CE = (hostWin as any).ClipboardEvent || (globalThis as any).ClipboardEvent;
              const event = new CE('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt,
              } as any);
              Object.defineProperty(event, 'clipboardData', {
                get: () => dt,
              });
              return pasteTarget.dispatchEvent(event);
            } catch (e) {
              console.error('[image-upload] simulate paste failed', e);
              return false;
            }
          };

          const simulateDrop = (): boolean => {
            try {
              const DT = (hostWin as any).DataTransfer || (globalThis as any).DataTransfer;
              const dt = new DT();
              dt.items.add(file);
              const DE = (hostWin as any).DragEvent || (globalThis as any).DragEvent;
              const dragOver = new DE('dragover', { bubbles: true, cancelable: true } as any);
              Object.defineProperty(dragOver, 'dataTransfer', { get: () => dt });
              pasteTarget.dispatchEvent(dragOver);
              const drop = new DE('drop', { bubbles: true, cancelable: true } as any);
              Object.defineProperty(drop, 'dataTransfer', { get: () => dt });
              return pasteTarget.dispatchEvent(drop);
            } catch (e) {
              console.error('[image-upload] simulate drop failed', e);
              return false;
            }
          };

          let pastedOk = simulatePaste();

          // 若浏览器阻止 clipboardData，尝试 drop 事件；再不行再试 execCommand 备选
          if (!pastedOk) {
            pastedOk = simulateDrop();
          }
          const doc = pasteTarget.ownerDocument;
          if (!pastedOk && doc.execCommand) {
            await focusEditor(pasteTarget, hostWin);
            pastedOk = doc.execCommand('paste');
          }

          if (!pastedOk) {
            throw new Error('触发粘贴失败：浏览器未接受事件');
          }

          const newUrl = isTextInput(pasteTarget)
            ? await waitForNewUrlInText(pasteTarget, beforeText, img.url, cfg.timeoutMs || 30000)
            : await waitForNewUrl(editor, beforeSrcSet, cfg.timeoutMs || 30000);

          console.log('[image-upload] DOM 粘贴成功:', newUrl);
          results.push({ originalUrl: img.url, newUrl, success: true });
          continue;
        }

        if (!strategyConfig.uploadUrl) {
          throw new Error('未配置上传 URL');
        }

        const blob = await dataUrlToBlob(img.base64);

        const formData = new FormData();
        const ext = img.mimeType.split('/')[1] || 'png';
        const filename = 'image_' + Date.now() + '.' + ext;
        const file = new File([blob], filename, { type: img.mimeType });
        formData.append(strategyConfig.fileFieldName || 'file', file);

        if (strategyConfig.extraFields) {
          for (const [key, value] of Object.entries(strategyConfig.extraFields)) {
            formData.append(key, value as string);
          }
        }

        const headers: Record<string, string> = {};

        if (strategyConfig.csrfToken) {
          const { type, name, headerName } = strategyConfig.csrfToken;
          let token: string | null = null;

          if (type === 'cookie') {
            const match = document.cookie.match(new RegExp(name + '=([^;]+)'));
            token = match ? match[1] : null;
          } else if (type === 'meta') {
            const meta = document.querySelector('meta[name="' + name + '"]');
            token = meta?.getAttribute('content') || null;
          }

          if (token) {
            headers[headerName || name] = token;
          }
        }

        // 通用兜底：很多站点（含阿里系）会把 CSRF/XSRF 放在 cookie 或 meta 中，
        // 但策略可能未显式配置。这里做一次轻量自动探测，提升“站内上传 API”的成功率。
        const getCookie = (name: string) => {
          const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
          return m ? decodeURIComponent(m[1]) : null;
        };
        const getMeta = (name: string) => {
          const meta = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
          return meta?.getAttribute('content') || null;
        };

        const xsrfCookie =
          getCookie('XSRF-TOKEN') ||
          getCookie('xsrf-token') ||
          getCookie('_xsrf') ||
          getCookie('csrfToken') ||
          getCookie('csrf-token') ||
          getCookie('_csrf');

        const csrfMeta =
          getMeta('csrf-token') ||
          getMeta('_csrf') ||
          getMeta('csrf') ||
          getMeta('x-csrf-token');

        if (xsrfCookie) {
          if (!headers['x-xsrf-token']) headers['x-xsrf-token'] = xsrfCookie;
          if (!headers['x-csrftoken']) headers['x-csrftoken'] = xsrfCookie;
        }
        if (csrfMeta) {
          if (!headers['x-csrf-token']) headers['x-csrf-token'] = csrfMeta;
          if (!headers['csrf-token']) headers['csrf-token'] = csrfMeta;
        }
        if (!headers['x-requested-with']) headers['x-requested-with'] = 'XMLHttpRequest';

        const uploadResponse = await fetch(strategyConfig.uploadUrl, {
          method: strategyConfig.method || 'POST',
          headers,
          body: formData,
          credentials: 'include',
        });

        if (!uploadResponse.ok) {
          const textResp = await uploadResponse.text();
          throw new Error('上传失败: HTTP ' + uploadResponse.status + ' - ' + textResp.substring(0, 100));
        }

        const data = await uploadResponse.json();
        let newUrl: string | undefined;

        if (data.data) {
          newUrl = data.data.url || data.data.url_1 || data.data.image_url || data.data.imageUrl;
        }

        if (!newUrl) {
          newUrl = data.url || data.result?.url || data.imageUrl || data.src || data.image_url;
        }

        if (!newUrl && typeof data === 'object') {
          const findUrl = (obj: any, depth = 0): string | undefined => {
            if (depth > 3 || !obj) return undefined;
            if (typeof obj === 'string' && (obj.startsWith('http://') || obj.startsWith('https://'))) {
              return obj;
            }
            if (typeof obj === 'object') {
              for (const key of ['url', 'url_1', 'image_url', 'imageUrl', 'src', 'path']) {
                if (obj[key] && typeof obj[key] === 'string') {
                  const val = obj[key];
                  if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) {
                    return val.startsWith('//') ? 'https:' + val : val;
                  }
                }
              }
              for (const val of Object.values(obj)) {
                const found = findUrl(val, depth + 1);
                if (found) return found;
              }
            }
            return undefined;
          };
          newUrl = findUrl(data);
        }

        if (!newUrl) {
          throw new Error('无法从响应中解析图片 URL: ' + JSON.stringify(data).substring(0, 200));
        }

        results.push({ originalUrl: img.url, newUrl, success: true });
      } catch (error: any) {
        console.error('[image-upload] 上传失败:', img.url, error);
        results.push({ originalUrl: img.url, newUrl: img.url, success: false, error: (error?.message ?? String(error)) });
      }
    }

    return results;
  };

  try {
    // `chrome.scripting.executeScript` 参数需要可结构化克隆，策略对象里可能包含函数等不可序列化字段。
    // 这里显式做一次 JSON 序列化以剥离不可序列化字段（如 responseParser）。
    const serializableStrategy = JSON.parse(JSON.stringify(strategy));
    const results = await executeInOrigin(
      targetUrl,
      uploadFunction,
      [downloadedImages, serializableStrategy],
      { closeTab: true, active: false }
    );

    const urlMapping = new Map<string, string>();
    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.success) {
        urlMapping.set(result.originalUrl, result.newUrl);
        success++;
      } else {
        failed++;
      }
      onProgress?.({ completed: success + failed, total: imageUrls.length });
    }

    return {
      urlMapping,
      stats: { total: imageUrls.length, success, failed },
    };
  } catch (error: any) {
    console.error('[publish-engine] 图片上传执行失败', error);
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }
}

async function processImagesForPlatform(
  post: CanonicalPost,
  platformId: string,
  onProgress?: (progress: ImageUploadProgress) => void
): Promise<{
  urlMapping: Map<string, string>;
  stats: { total: number; success: number; failed: number };
}> {
  // 获取平台的图片上传策略
  const strategy = getImageStrategy(platformId);
  
  if (!strategy) {
    console.log(`[publish-engine] 平台 ${platformId} 无图片上传策略，跳过图片处理`);
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  // 如果策略是直接使用外链，跳过处理
  if (strategy.mode === 'externalUrlOnly') {
    console.log(`[publish-engine] 平台 ${platformId} 使用外链模式，跳过图片处理`);
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  // 构建资产清单
  const manifest = buildAssetManifest(post);
  
  if (manifest.images.length === 0) {
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  console.log(`[publish-engine] 发现 ${manifest.images.length} 张图片需要处理`);

  // 创建图片上传管道
  const pipeline = new ImageUploadPipeline({
    concurrency: 3,
    timeout: 30000,
    maxRetries: 2,
    onProgress,
  });

  // 处理图片
  const urlMapping = await pipeline.processImages(manifest, strategy, platformId);

  const stats = {
    total: manifest.images.length,
    success: urlMapping.size,
    failed: manifest.images.length - urlMapping.size,
  };

  return { urlMapping, stats };
}

/**
 * 从文章内容构建资产清单
 */
function buildAssetManifest(post: CanonicalPost): AssetManifest {
  const images: AssetManifest['images'] = [];
  const seen = new Set<string>();

  // 从 Markdown 内容提取图片
  if (post.body_md) {
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = mdImageRegex.exec(post.body_md)) !== null) {
      const url = (match[2] || '').trim();
      if (url && !seen.has(url) && isExternalImage(url)) {
        seen.add(url);
        images.push({
          id: `img-${images.length}`,
          originalUrl: url,
          metadata: {
            format: guessImageFormat(url),
            size: 0,
            alt: match[1] || undefined,
          },
          status: 'pending',
        });
      }
    }
  }

  // 如果文章已有 assets，合并
  if (post.assets) {
    for (const asset of post.assets) {
      // AssetRef 使用 url 字段
      if (asset.type === 'image' && asset.url && !seen.has(asset.url)) {
        seen.add(asset.url);
        images.push({
          id: asset.id || `img-${images.length}`,
          originalUrl: asset.url,
          metadata: {
            format: guessImageFormat(asset.url),
            size: 0,
            alt: asset.alt,
          },
          status: 'pending',
        });
      }
    }
  }

  return {
    images,
    formulas: [],
  };
}

/**
 * 判断是否为外部图片（需要处理的图片）
 */
function isExternalImage(url: string): boolean {
  if (!url) return false;
  
  // 跳过 data URL
  if (url.startsWith('data:')) return false;
  
  // 跳过相对路径
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  
  // 可以添加更多规则，比如跳过某些已知的公共 CDN
  return true;
}

/**
 * 猜测图片格式
 */
function guessImageFormat(url: string): 'jpeg' | 'png' | 'webp' | 'gif' | 'svg' | 'avif' {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'gif':
      return 'gif';
    case 'svg':
      return 'svg';
    case 'avif':
      return 'avif';
    default:
      return 'jpeg';
  }
}

function normalizeMarkdownImageUrls(markdown: string): string {
  if (!markdown) return markdown;

  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, rawInner: string) => {
    let inner = String(rawInner || '').trim();

    // 分离可选 title（通常以引号开始），避免把 title 里的空格也压缩掉
    let titlePart = '';
    const quoteIdx = inner.search(/["']/);
    if (quoteIdx > 0) {
      titlePart = inner.slice(quoteIdx).trim();
      inner = inner.slice(0, quoteIdx).trimEnd();
    }

    // 支持 ![](<url>) 写法：去掉包裹的尖括号
    if (inner.startsWith('<') && inner.endsWith('>')) {
      inner = inner.slice(1, -1);
    }

    // 去除 URL 中可能混入的空格/换行（如 `. jpeg`）
    const normalizedUrl = inner.replace(/\s+/g, '');

    return `![${alt}](${normalizedUrl}${titlePart ? ' ' + titlePart : ''})`;
  });
}


/**
 * 将 Blob 转换为 base64 字符串（Service Worker 兼容）
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const mimeType = blob.type || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}
