import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * Medium 适配器
 *
 * 平台特点：
 * - 入口：https://medium.com/new-story
 * - 编辑器：富文本（contenteditable）
 * - 不支持：Markdown 识别、表格、LaTeX 公式
 * - 图片：通常可接受外链，但为兼容性这里不强制依赖外链
 *
 * 发布策略：
 * - 将 Markdown 转为 HTML 后粘贴/注入到编辑器
 * - 不执行最终发布操作，由用户手动完成
 */

/**
 * 为 Medium 平台优化 HTML 内容
 * 
 * Medium 编辑器对 HTML 有特殊要求：
 * 1. 列表项内部不能有 <p> 标签包裹（会产生空行）
 * 2. 引用块内部不能有多余换行
 * 3. 不支持表格 - 转换为格式化文本
 * 4. 不支持 LaTeX 公式 - 转换为纯文本或代码块
 */
function optimizeHtmlForMedium(html: string, markdown: string): string {
  let result = html;

  // 1. 关键修复：移除 <li> 内部的 <p> 标签包裹
  // 这是导致列表项之间出现空行的根本原因
  // 将 <li><p>内容</p></li> 转换为 <li>内容</li>
  result = result.replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g, '<li>$1</li>');
  
  // 处理 <li> 内部有多个 <p> 的情况，用 <br> 分隔
  result = result.replace(/<li>([\s\S]*?)<\/li>/g, (match, content) => {
    // 如果内容中还有 <p> 标签，将它们转换为 <br> 分隔的内容
    let cleaned = content
      .replace(/<p>([\s\S]*?)<\/p>/g, '$1<br>')
      .replace(/<br>\s*$/, '') // 移除末尾的 <br>
      .replace(/^\s+|\s+$/g, ''); // 移除首尾空白
    return `<li>${cleaned}</li>`;
  });

  // 2. 移除列表标签周围的换行符
  result = result.replace(/<\/li>\s*\n\s*/g, '</li>');
  result = result.replace(/\s*\n\s*<li>/g, '<li>');
  result = result.replace(/<(ul|ol)[^>]*>\s*\n\s*/g, '<$1>');
  result = result.replace(/\s*\n\s*<\/(ul|ol)>/g, '</$1>');

  // 3. 优化引用块 - 移除 blockquote 内部的 <p> 标签和多余换行
  result = result.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (match, content) => {
    // 移除 <p> 标签，保留内容
    let cleaned = content
      .replace(/<p>([\s\S]*?)<\/p>/g, '$1<br>')
      .replace(/<br>\s*<br>/g, '<br>') // 合并连续的 <br>
      .replace(/<br>\s*$/, '') // 移除末尾的 <br>
      .replace(/^\s*<br>/, '') // 移除开头的 <br>
      .replace(/\s*\n\s*/g, ' ') // 换行转为空格
      .trim();
    
    return `<blockquote>${cleaned}</blockquote>`;
  });

  // 4. 处理表格 - Medium 不支持表格，转换为格式化文本
  result = result.replace(/<table>([\s\S]*?)<\/table>/g, (match, tableContent) => {
    const headerMatch = tableContent.match(/<thead>([\s\S]*?)<\/thead>/);
    const bodyMatch = tableContent.match(/<tbody>([\s\S]*?)<\/tbody>/);
    
    const extractCells = (rowHtml: string): string[] => {
      const cells: string[] = [];
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
      }
      return cells;
    };

    const rows: string[][] = [];
    
    if (headerMatch) {
      const headerRowMatch = headerMatch[1].match(/<tr>([\s\S]*?)<\/tr>/);
      if (headerRowMatch) {
        rows.push(extractCells(headerRowMatch[1]));
      }
    }
    
    if (bodyMatch) {
      const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(bodyMatch[1])) !== null) {
        rows.push(extractCells(rowMatch[1]));
      }
    }

    if (rows.length === 0) return '';

    let textTable = '<p><strong>📊 表格内容：</strong></p>';
    rows.forEach((row, index) => {
      if (index === 0) {
        textTable += `<p><strong>${row.join(' | ')}</strong></p>`;
      } else {
        textTable += `<p>${row.join(' | ')}</p>`;
      }
    });
    
    return textTable;
  });

  // 5. 处理 LaTeX 公式 - Medium 不支持，转换为代码格式
  result = result.replace(/\$([^$\n]+)\$/g, '<code>$1</code>');
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, '<pre><code>$1</code></pre>');

  // 6. 移除多余的空行和换行
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.replace(/<p>\s*<\/p>/g, '');
  
  // 7. 确保段落之间有适当的分隔
  result = result.replace(/<\/p>\s*<p>/g, '</p><p>');

  return result;
}

/**
 * 预处理 Markdown，处理 Medium 不支持的语法
 */
function preprocessMarkdownForMedium(markdown: string): string {
  let result = markdown;

  // 处理 LaTeX 公式 - 在 Markdown 阶段就转换
  result = result.replace(/\$([^$\n]+)\$/g, '`$1`');
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, '\n```\n$1\n```\n');

  return result;
}

export const mediumAdapter: PlatformAdapter = {
  id: 'medium',
  name: 'Medium',
  kind: 'dom',
  icon: 'medium',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 20, concurrent: 1 },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    const markdown = post.body_md || '';
    const processedMarkdown = preprocessMarkdownForMedium(markdown);
    const rawHtml = renderMarkdownToHtmlForPaste(processedMarkdown);
    const contentHtml = optimizeHtmlForMedium(rawHtml, processedMarkdown);

    return {
      title: post.title,
      contentMarkdown: markdown,
      contentHtml,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('medium: use DOM automation');
  },

  dom: {
    matchers: ['https://medium.com/new-story', 'https://medium.com/p/*/edit', 'https://medium.com/me/stories/drafts*'],
    fillAndPublish: async function (payload) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const waitFor = async <T>(getter: () => T | null, timeoutMs = 45000): Promise<T> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const v = getter();
          if (v) return v;
          await sleep(200);
        }
        throw new Error('等待元素超时');
      };

      console.log('[Medium] 开始同步...');
      await sleep(2000);

      const titleText = String((payload as any).title || '').trim();
      const html = String((payload as any).contentHtml || '');
      const markdown = String((payload as any).contentMarkdown || '');

      // 1) 标题
      if (titleText) {
        const titleEl = await waitFor(() => {
          const grafTitle = document.querySelector('h3.graf--title') as HTMLElement;
          if (grafTitle) return grafTitle;

          const testIdTitle = document.querySelector('[data-testid="title"]') as HTMLElement;
          if (testIdTitle) return testIdTitle;

          const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          for (const el of editables) {
            const placeholder = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '';
            if (/title/i.test(placeholder)) return el;
          }

          const headings = Array.from(document.querySelectorAll('h1, h2, h3')) as HTMLElement[];
          const editableHeadings = headings.filter((h) => h.isContentEditable);
          if (editableHeadings.length > 0) {
            editableHeadings.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            return editableHeadings[0];
          }

          return null;
        });

        try {
          titleEl.focus();
          titleEl.textContent = titleText;
          titleEl.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[Medium] 标题填充成功');
        } catch (e) {
          console.error('[Medium] 标题填充失败', e);
        }
        await sleep(200);
      }

      // 2) 正文
      const htmlContent = html || '';
      if (htmlContent || markdown) {
        const contentEl = await waitFor(() => {
          const grafP = document.querySelector('p.graf--p') as HTMLElement;
          if (grafP) return grafP;

          const testIdBody = document.querySelector('[data-testid="body"]') as HTMLElement;
          if (testIdBody) return testIdBody;

          const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          for (const el of editables) {
            const placeholder = el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '';
            if (/story|content|write/i.test(placeholder)) return el;
          }

          const candidates = editables
            .filter((el) => !['H1', 'H2', 'H3'].includes(el.tagName))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width * r.height > 10000;
            });
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return rb.width * rb.height - ra.width * ra.height;
            });
            return candidates[0];
          }

          return null;
        });

        try {
          contentEl.focus();

          const dt = new DataTransfer();
          dt.setData('text/html', htmlContent);
          dt.setData('text/plain', htmlContent.replace(/<[^>]*>/g, '') || markdown);

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          });

          contentEl.dispatchEvent(pasteEvent);
          console.log('[Medium] 内容填充成功（paste 事件）');
        } catch (e) {
          console.warn('[Medium] paste 事件失败，尝试备选方案', e);

          try {
            if (htmlContent) {
              document.execCommand('selectAll');
              document.execCommand('insertHTML', false, htmlContent);
              console.log('[Medium] 内容填充成功（execCommand）');
            } else if (markdown) {
              document.execCommand('selectAll');
              document.execCommand('insertText', false, markdown);
              console.log('[Medium] 内容填充成功（insertText）');
            }
          } catch (e2) {
            console.warn('[Medium] execCommand 失败，使用 innerHTML', e2);
            try {
              if (htmlContent) {
                contentEl.innerHTML = htmlContent;
              } else if (markdown) {
                contentEl.textContent = markdown;
              }
              contentEl.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('[Medium] 内容填充成功（innerHTML）');
            } catch (e3) {
              console.error('[Medium] 所有填充方式均失败', e3);
            }
          }
        }
      }

      await sleep(300);

      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
