/* In-page runner utilities: open target origin in a background tab and execute code in page MAIN world */

export async function waitForLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) return;
        if (tab.status === 'complete') {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('waitForLoad timeout'));
        }
      } catch (e) {
        clearInterval(timer);
        reject(e as Error);
      }
    }, 300);
  });
}

type ReuseRecord = { tabId: number; createdAt: number; lastUrl?: string };
const reuseTabs = new Map<string, ReuseRecord>();

export async function getReuseTabInfo(reuseKey: string): Promise<{ tabId: number; url?: string } | null> {
  const record = reuseTabs.get(reuseKey);
  if (!record?.tabId) return null;
  try {
    const tab = await chrome.tabs.get(record.tabId);
    return tab?.id ? { tabId: tab.id, url: tab.url } : null;
  } catch {
    reuseTabs.delete(reuseKey);
    return null;
  }
}

/**
 * Open a tab (or reuse an existing one) for a given reuseKey without waiting for page load.
 *
 * This is useful for DOM automation platforms where we want to show the editor page ASAP,
 * while heavy preprocessing (e.g. image downloading) continues in background.
 */
export async function openOrReuseTab(
  url: string,
  opts: { active?: boolean; reuseKey?: string } = {}
): Promise<{ tabId: number; url: string; reused: boolean }> {
  const reuseKey = opts.reuseKey;
  console.log('[inpage-runner] openOrReuseTab', { url, active: opts.active, reuseKey });

  let tab: chrome.tabs.Tab | undefined;
  try {
    if (reuseKey) {
      const record = reuseTabs.get(reuseKey);
      if (record?.tabId) {
        try {
          tab = await chrome.tabs.get(record.tabId);
        } catch {
          reuseTabs.delete(reuseKey);
        }
      }
    }

    if (!tab) {
      tab = await chrome.tabs.create({ url, active: !!opts.active });
      if (!tab?.id) throw new Error('Failed to create tab');
      if (reuseKey) {
        reuseTabs.set(reuseKey, { tabId: tab.id, createdAt: Date.now(), lastUrl: url });
      }
      return { tabId: tab.id, url, reused: false };
    }

    if (!tab.id) throw new Error('Tab id missing');
    const currentUrl = tab.url || '';

    if (currentUrl !== url) {
      await chrome.tabs.update(tab.id, { url });
      if (reuseKey) {
        const record = reuseTabs.get(reuseKey);
        if (record) record.lastUrl = url;
      }
    }

    if (opts.active) {
      await chrome.tabs.update(tab.id, { active: true });
    }

    return { tabId: tab.id, url, reused: true };
  } catch (error) {
    console.error('[inpage-runner] openOrReuseTab failed', error);
    throw error;
  }
}

export async function executeInOrigin<T>(
  url: string,
  fn: (...args: any[]) => Promise<T> | T,
  args: any[] = [],
  opts: { closeTab?: boolean; active?: boolean; reuseKey?: string } = { closeTab: true, active: false }
): Promise<T> {
  const reuseKey = opts.reuseKey;
  console.log('[inpage-runner] executeInOrigin', { url, active: opts.active, reuseKey });
  
  let tab: chrome.tabs.Tab | undefined;
  try {
    if (reuseKey) {
      const record = reuseTabs.get(reuseKey);
      if (record?.tabId) {
        try {
          tab = await chrome.tabs.get(record.tabId);
        } catch {
          reuseTabs.delete(reuseKey);
        }
      }
    }

    if (!tab) {
      tab = await chrome.tabs.create({ url, active: !!opts.active });
      console.log('[inpage-runner] Tab created', { tabId: tab.id, reuseKey });
      if (reuseKey && tab.id) {
        reuseTabs.set(reuseKey, { tabId: tab.id, createdAt: Date.now(), lastUrl: url });
      }
    } else {
      // Reuse existing tab: ensure it is on the desired URL.
      if (tab.id) {
        const currentUrl = tab.url || '';
        if (currentUrl !== url) {
          await chrome.tabs.update(tab.id, { url });
          if (reuseKey) {
            const record = reuseTabs.get(reuseKey);
            if (record) record.lastUrl = url;
          }
        }
        if (opts.active) {
          await chrome.tabs.update(tab.id, { active: true });
        }
      }
    }
    
    if (!tab.id) {
      throw new Error('Failed to create tab');
    }
    
    await waitForLoad(tab.id);
    console.log('[inpage-runner] Tab loaded, waiting for page to stabilize...');
    
    // 额外等待，确保页面 JS 完全初始化
    // 简书 writer 页面注入脚本本身会等待编辑器就绪，这里缩短固定等待以提升首屏填充速度
    const stabilizeMs = /https?:\/\/www\.jianshu\.com\/writer\b/i.test(url) ? 200 : 1500;
    await new Promise(resolve => setTimeout(resolve, stabilizeMs));
    
    console.log('[inpage-runner] Executing script');
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: fn,
      args,
    });
    
    console.log('[inpage-runner] Script executed', { resultCount: results?.length });
    
    if (!results || results.length === 0) {
      throw new Error('Script execution returned no results');
    }
    
    const [result] = results;
    
    if (!result) {
      console.error('[inpage-runner] No result object returned');
      throw new Error('Script execution returned no result object');
    }
    
    console.log('[inpage-runner] Raw result:', result);

    // When the injected function throws, Chrome returns exceptionDetails instead of result.
    const exceptionDetails = (result as any).exceptionDetails;
    if (exceptionDetails) {
      const message =
        exceptionDetails?.exception?.description ||
        exceptionDetails?.exception?.value ||
        exceptionDetails?.text ||
        'Script execution failed with exception';
      console.error('[inpage-runner] Script exceptionDetails:', exceptionDetails);
      throw new Error(String(message));
    }
    
    // 检查是否有错误（某些情况下 Chrome 会返回错误信息）
    if ((result as any).error) {
      console.error('[inpage-runner] Script had error:', (result as any).error);
      throw new Error(`Script error: ${(result as any).error}`);
    }

    // 允许注入脚本将错误以结构化形式返回（用于解决 async throw 无法传回 background 的情况）
    const returned: any = (result as any).result;
    if (returned && typeof returned === 'object' && returned.__synccasterError) {
      const info = returned.__synccasterError;
      const err = new Error(String(info?.message || 'Injected script failed'));
      if (info?.stack) {
        (err as any).stack = String(info.stack);
      }
      console.error('[inpage-runner] Script returned __synccasterError:', info);
      throw err;
    }
    
    // 允许 null 和 undefined 作为有效的返回值，但记录警告
    if (result.result === null || result.result === undefined) {
      console.warn('[inpage-runner] Script returned null/undefined - this might indicate an error in the script');
      console.warn('[inpage-runner] Please check the target page console for errors');
    }
    
    console.log('[inpage-runner] Execution successful', result.result);
    return result.result as T;
  } catch (error: any) {
    console.error('[inpage-runner] executeInOrigin failed', error);
    throw error;
  } finally {
    if (opts.closeTab && tab?.id) {
      try { 
        await chrome.tabs.remove(tab.id); 
        console.log('[inpage-runner] Tab closed', { tabId: tab.id });
        if (reuseKey) {
          const record = reuseTabs.get(reuseKey);
          if (record?.tabId === tab.id) reuseTabs.delete(reuseKey);
        }
      } catch (e) {
        console.warn('[inpage-runner] Failed to close tab', e);
      }
    } else if (reuseKey && tab?.id) {
      // Keep tab open, but clean up record if the tab was closed by user.
      try {
        await chrome.tabs.get(tab.id);
      } catch {
        const record = reuseTabs.get(reuseKey);
        if (record?.tabId === tab.id) reuseTabs.delete(reuseKey);
      }
    }
  }
}
