// 掘金编辑页 DOM 粘贴/拖拽上传助手
// 暴露到 window.__juejinDomPaste，供后台注入脚本调用

type DomPasteImage = { url: string; base64: string; mimeType: string };

type DomPasteConfig = {
  editorSelector?: string;
  timeoutMs?: number;
};

type DomPasteResult = { originalUrl: string; newUrl: string; success: boolean; error?: string };

const dataUrlToFile = async (dataUrl: string, mime: string): Promise<File> => {
  const res = await fetch(dataUrl);
  if (!res.ok) {
    throw new Error('dataURL fetch failed: ' + res.status);
  }
  const blob = await res.blob();
  const ext = mime.split('/')[1] || 'png';
  return new File([blob], `image_${Date.now()}.${ext}`, { type: mime || blob.type });
};

const collectUrls = (root: ParentNode): string[] => {
  const urls: string[] = [];
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  imgs.forEach((el) => {
    if (el.src) urls.push(el.src);
  });
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a'));
  anchors.forEach((a) => {
    if (a.href) urls.push(a.href);
  });
  const text = (root as HTMLElement).innerText || '';
  const regex = /(https?:\/\/[^\s"'<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    urls.push(m[1]);
  }
  return urls;
};

const waitForNewUrl = (
  root: HTMLElement,
  beforeSet: Set<string>,
  timeoutMs: number,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const seen = new Set(beforeSet);

    const checkOnce = () => {
      const urls = collectUrls(root);
      for (const u of urls) {
        if (!u) continue;
        if (seen.has(u)) continue;
        if (u.startsWith('data:') || u.startsWith('blob:')) continue;
        observer.disconnect();
        clearTimeout(timer);
        resolve(u);
        return;
      }
    };

    const observer = new MutationObserver(() => checkOnce());
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    checkOnce();

    const timer = window.setTimeout(() => {
      observer.disconnect();
          reject(new Error('waitForNewUrl timeout'));
        }, timeoutMs);
      });
    };

const ensureEditor = async (selector: string, timeoutMs: number): Promise<HTMLElement | null> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
};

const focusEditor = async (el: HTMLElement) => {
  try {
    window.focus();
  } catch (_) {}
  try {
    el.focus();
  } catch (_) {}
  try {
    el.dispatchEvent(new Event('focus', { bubbles: true }));
  } catch (_) {}
  if (typeof (el as any).click === 'function') {
    try {
      (el as any).click();
    } catch (_) {}
  }
  await new Promise((r) => setTimeout(r, 50));
};

async function domPasteWorker(
  images: DomPasteImage[],
  cfg: DomPasteConfig,
): Promise<DomPasteResult[]> {
  const editor =
    (cfg.editorSelector &&
      (await ensureEditor(cfg.editorSelector, cfg.timeoutMs || 15000))) ||
    document.querySelector<HTMLElement>(cfg.editorSelector || '.bytemd-editor textarea, .CodeMirror textarea, .markdown-body[contenteditable=\"true\"], .ql-editor, body');
  if (!editor) {
    throw new Error(`未找到编辑区：${cfg.editorSelector || 'body'}`);
  }

  const results: DomPasteResult[] = [];

  for (const img of images) {
    try {
      const file = await dataUrlToFile(img.base64, img.mimeType || 'image/png');
      await focusEditor(editor);

      const beforeSrcSet = new Set(
        collectUrls(editor),
      );

      const tryDrop = (): boolean => {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true });
          Object.defineProperty(dragOver, 'dataTransfer', { get: () => dt });
          editor.dispatchEvent(dragOver);
          const drop = new DragEvent('drop', { bubbles: true, cancelable: true });
          Object.defineProperty(drop, 'dataTransfer', { get: () => dt });
          return editor.dispatchEvent(drop);
        } catch (e) {
          console.error('[juejin-domPaste] drop failed', e);
          return false;
        }
      };

      const tryPasteEvent = (): boolean => {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          } as ClipboardEventInit);
          Object.defineProperty(event, 'clipboardData', { get: () => dt });
          return editor.dispatchEvent(event);
        } catch (e) {
          console.error('[juejin-domPaste] paste event failed', e);
          return false;
        }
      };

      // 优先 drop，不占用剪贴板
      let ok = tryDrop();
      if (!ok) ok = tryPasteEvent();

      // 仍不行再尝试剪贴板写入 + execCommand
      if (!ok && navigator.clipboard && (window as any).ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              [file.type]: file,
            }),
          ]);
          await focusEditor(editor);
          ok = document.execCommand && document.execCommand('paste');
        } catch (e) {
          console.error('[juejin-domPaste] clipboard fallback failed', e);
        }
      }

      if (!ok) {
        throw new Error('触发粘贴/拖拽失败：浏览器未接受事件');
      }

      const newUrl = await waitForNewUrl(editor, beforeSrcSet, cfg.timeoutMs || 30000);

      // 清理刚插入的节点，避免污染正文
      try {
        const imgs = Array.from(editor.querySelectorAll<HTMLImageElement>('img')).filter(
          (el) => el.src === newUrl,
        );
        imgs.forEach((el) => el.remove());

        const anchors = Array.from(editor.querySelectorAll<HTMLAnchorElement>('a')).filter(
          (a) => a.href === newUrl,
        );
        anchors.forEach((a) => a.remove());

        // 清理包含该 URL 的纯文本节点
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        const toRemove: Node[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (node.nodeValue && node.nodeValue.includes(newUrl)) {
            toRemove.push(node);
          }
        }
        toRemove.forEach((n) => n.parentNode?.removeChild(n));
      } catch (e) {
        console.warn('[juejin-domPaste] cleanup failed', e);
      }

      results.push({ originalUrl: img.url, newUrl, success: true });
    } catch (err: any) {
      results.push({
        originalUrl: img.url,
        newUrl: img.url,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return results;
}

(window as any).__juejinDomPaste = domPasteWorker;
