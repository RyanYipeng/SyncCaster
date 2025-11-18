/**
 * Content Script - 优化版
 * 注入到目标网站，执行 DOM 自动化和内容采集
 * 支持：公式提取、图片归一化、表格/代码块保真、质量校验
 */
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';
import {
  computeMetrics,
  extractFormulas,
  flattenCodeHighlights,
  cleanDOMWithWhitelist,
  extractAndNormalizeImages,
  checkQuality,
  type CollectedImage,
  type ContentMetrics,
} from './collector-utils';

// 采集配置
const COLLECT_CONFIG = {
  readability: {
    keepClasses: true,
    maxElemsToParse: 10000,
    nbTopCandidates: 10,
  },
  images: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxCount: 100,
  },
  quality: {
    images: 0.3, // 图片丢失超30%则回退
    formulas: 0.5,
    tables: 0.5,
  },
};

function logInfo(scope: string, msg: string, extra?: any) {
  // 简易日志，避免外部依赖
  try {
    console.log(`[content:${scope}] ${msg}`, extra ?? '');
  } catch {}
}

logInfo('init', 'Content script loaded', { url: window.location.href });

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  logInfo('message', 'Received message', { type: message.type });
  
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      logInfo('message', 'Message handling failed', { error });
      sendResponse({ error: error.message });
    });
  
  return true;
});

/**
 * 处理消息
 */
async function handleMessage(message: any) {
  switch (message.type) {
    case 'COLLECT_CONTENT':
      return await collectContent();
    
    case 'FILL_AND_PUBLISH':
      return await fillAndPublish(message.data);
    
    case 'PING':
      return { pong: true };
    
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * 采集当前页面内容 - 优化版
 */
async function collectContent(options = {}) {
  try {
    logInfo('collect', '开始采集页面内容', { url: window.location.href });

    const url = window.location.href;

    // ========== 步骤1: Readability 提取（增强配置） ==========
    const cloned = document.cloneNode(true) as Document;
    const article = new Readability(cloned, COLLECT_CONFIG.readability).parse();

    const getMainContainer = () =>
      (document.querySelector('article') as HTMLElement)
      || (document.querySelector('[role="main"]') as HTMLElement)
      || (document.querySelector('.content') as HTMLElement)
      || document.body;

    const origContainer = getMainContainer();
    const orig_html = origContainer?.innerHTML || '';

    let title = document.title || '未命名标题';
    const read_html = article?.content || '';
    if (article?.title) title = article.title;

    // 计算初始指标（用于后续质量校验）
    const initialMetrics = computeMetrics(orig_html);
    logInfo('collect', '初始内容指标', initialMetrics);

    // 选择更优 HTML
    const mRead = computeMetrics(read_html);
    const mOrig = computeMetrics(orig_html);
    let body_html = (mOrig.images > mRead.images
      || (mOrig.images === mRead.images && mOrig.textLen > mRead.textLen))
      ? orig_html
      : read_html || orig_html;

    // ========== 步骤2: DOM 预处理（白名单清洗 + 公式/图片提取） ==========
    const container = document.createElement('div');
    container.innerHTML = body_html;

    // 2.1 公式抽取与占位
    const formulas = extractFormulas(container);
    logInfo('collect', '提取公式', { count: formulas.length });

    // 2.2 代码块高亮去壳
    flattenCodeHighlights(container);

    // 2.3 白名单清洗（保留关键结构）
    cleanDOMWithWhitelist(container);

    // 2.4 图片归一化（增强版）
    const images = extractAndNormalizeImages(container);
    logInfo('collect', '提取图片', { count: images.length });

    // ========== 步骤3: Turndown 转换（含自定义规则） ==========
    body_html = container.innerHTML;
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      bulletListMarker: '-',
      br: '\n',
    });
    td.use(gfm);

    // 自定义规则：公式
    td.addRule('sync-math', {
      filter: (node: any) => node.nodeType === 1 && (node as Element).hasAttribute('data-sync-math'),
      replacement: (_content: any, node: any) => {
        const el = node as Element;
        const tex = el.getAttribute('data-tex') || '';
        const display = el.getAttribute('data-display') === 'true';
        return display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      },
    });

    // 自定义规则：复杂表格保留HTML
    td.addRule('complex-table', {
      filter: (node: any) => {
        if (node.nodeName !== 'TABLE') return false;
        const el = node as HTMLTableElement;
        return !!el.querySelector('colgroup, [colspan], [rowspan]');
      },
      replacement: (_content: any, node: any) => `\n\n${(node as Element).outerHTML}\n\n`,
    });

    const body_md = td.turndown(body_html || '');
    const text_len = (body_md || '').length;
    const summary = (container.textContent || '').trim().slice(0, 200);

    // ========== 步骤4: 质量校验与回退 ==========
    const finalMetrics = computeMetrics(body_html);
    const qualityCheck = checkQuality(
      initialMetrics,
      finalMetrics,
      COLLECT_CONFIG.quality
    );

    logInfo('collect', '质量校验', qualityCheck);

    const useHtmlFallback = !qualityCheck.pass;
    if (useHtmlFallback) {
      logInfo('collect', '质量不达标，启用HTML回退模式', { reason: qualityCheck.reason });
    }

    logInfo('collect', '采集成功', {
      title,
      len: text_len,
      images: images.length,
      formulas: formulas.length,
      quality: qualityCheck.pass ? 'pass' : 'fallback',
    });

    return {
      success: true,
      data: {
        title,
        url,
        summary,
        body_md,
        body_html,
        images,
        formulas,
        wordCount: text_len,
        imageCount: images.length,
        formulaCount: formulas.length,
        useHtmlFallback,
        qualityCheck,
      },
    };
  } catch (error: any) {
    logInfo('collect', '采集异常', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

/**
 * 填充并发布内容
 */
async function fillAndPublish(data: {
  platform: string;
  payload: any;
}) {
  logInfo('publish', `Filling and publishing to ${data.platform}`);
  
  const { platform, payload } = data;
  
  // 根据平台执行不同的 DOM 自动化
  switch (platform) {
    case 'wechat':
      return await publishToWechat(payload);
    
    case 'zhihu':
      return await publishToZhihu(payload);
    
    case 'juejin':
      return await publishToJuejin(payload);
    
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * 微信公众号发布
 */
async function publishToWechat(payload: any) {
  logInfo('wechat', 'Publishing to WeChat');
  
  // TODO: 实现微信 DOM 自动化
  // 1. 等待编辑器加载
  // 2. 填充标题
  // 3. 粘贴 HTML 内容
  // 4. 上传封面
  // 5. 点击发布
  
  return {
    success: true,
    url: window.location.href,
  };
}

/**
 * 知乎发布
 */
async function publishToZhihu(payload: any) {
  logInfo('zhihu', 'Publishing to Zhihu');
  
  // TODO: 实现知乎 DOM 自动化
  
  return {
    success: true,
    url: window.location.href,
  };
}

/**
 * 掘金发布
 */
async function publishToJuejin(payload: any) {
  logInfo('juejin', 'Publishing to Juejin');
  
  // TODO: 实现掘金 DOM 自动化
  
  return {
    success: true,
    url: window.location.href,
  };
}

// 在页面上添加一个浮动按钮（用于快速操作）
function addFloatingButton() {
  const button = document.createElement('button');
  button.textContent = '📤 SyncCaster';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99999;
    padding: 12px 20px;
    background: #1677ff;
    color: white;
    border: none;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  `;
  
  button.addEventListener('click', async () => {
    logInfo('button', 'Quick action button clicked');
    
    try {
      button.textContent = '⏳ 采集中...';
      button.disabled = true;
      
      const result = await collectContent();
      
      // 发送到 background
      chrome.runtime.sendMessage({
        type: 'CONTENT_COLLECTED',
        data: result,
      });
      
      button.textContent = '✅ 已采集';
      
      setTimeout(() => {
        button.textContent = '📤 SyncCaster';
        button.disabled = false;
      }, 2000);
    } catch (error: any) {
      logInfo('button', 'Quick action failed', { error });
      button.textContent = '❌ 失败';
      button.disabled = false;
    }
  });
  
  document.body.appendChild(button);
}

// 在支持采集的页面添加浮动按钮
if (!window.location.href.includes('mp.weixin.qq.com')) {
  addFloatingButton();
}
