/**
 * 微信公众号 Markdown 格式化器
 *
 * 将 Markdown 转换为微信公众号可用的 HTML
 * 核心逻辑参考 doocs/md 项目
 */

import { marked } from 'marked';
import type { WechatFormatOptions, WechatFormatResult, CSSVariableConfig } from './types';
import { DEFAULT_WECHAT_OPTIONS } from './types';
import { getThemeCSS, replaceCSSVariables } from './themes';
import { createWechatRenderer } from './renderer';

/**
 * 解析 CSS 规则为样式映射
 */
function parseCSSRules(css: string): Map<string, Record<string, string>> {
  const styleMap = new Map<string, Record<string, string>>();
  
  // Strip CSS comments before parsing
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match;

  while ((match = ruleRegex.exec(cssWithoutComments)) !== null) {
    const selectors = match[1]
      .trim()
      .split(',')
      .map((s) => s.trim());
    const declarations = match[2].trim();

    const styles: Record<string, string> = {};
    declarations.split(';').forEach((decl) => {
      const colonIndex = decl.indexOf(':');
      if (colonIndex > 0) {
        const prop = decl.slice(0, colonIndex).trim();
        const value = decl.slice(colonIndex + 1).trim();
        if (prop && value) {
          styles[prop] = value;
        }
      }
    });

    selectors.forEach((selector) => {
      const existing = styleMap.get(selector) || {};
      styleMap.set(selector, { ...existing, ...styles });
    });
  }

  return styleMap;
}

/**
 * 将样式对象转换为内联样式字符串
 */
function stylesToString(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

/**
 * 将 CSS 转换为内联样式
 * 微信公众号编辑器会过滤 <style> 标签，所以需要内联
 */
function cssToInlineStyles(html: string, css: string): string {
  const styleMap = parseCSSRules(css);
  let result = html;

  // 处理标签选择器
  const tagSelectors = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
    'figure',
    'figcaption',
    'a',
    'strong',
    'em',
    'del',
    'hr',
    'section',
  ];

  tagSelectors.forEach((tag) => {
    const styles = styleMap.get(tag);
    if (styles) {
      const styleStr = stylesToString(styles);
      const tagRegex = new RegExp(`<${tag}([^>]*)>`, 'gi');
      result = result.replace(tagRegex, (match, attrs) => {
        if (attrs.includes('style=')) {
          return match.replace(/style="([^"]*)"/, `style="$1; ${styleStr}"`);
        } else {
          return `<${tag}${attrs} style="${styleStr}">`;
        }
      });
    }
  });

  // 处理类选择器
  styleMap.forEach((styles, selector) => {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      const styleStr = stylesToString(styles);
      const classRegex = new RegExp(`class="([^"]*\\b${className}\\b[^"]*)"`, 'gi');
      result = result.replace(classRegex, (match, classes) => {
        // 检查是否已有 style 属性
        return `class="${classes}" style="${styleStr}"`;
      });
    }
  });

  // 处理特殊的后代选择器
  const descendantSelectors = [
    { parent: 'blockquote', child: 'p', selector: 'blockquote p' },
    { parent: 'pre', child: 'code', selector: 'pre code' },
    { parent: 'pre.hljs', child: 'code', selector: 'pre.hljs code' },
  ];

  descendantSelectors.forEach(({ parent, child, selector }) => {
    const styles = styleMap.get(selector);
    if (styles) {
      const styleStr = stylesToString(styles);
      const parentRegex = new RegExp(`<${parent.split('.')[0]}([^>]*)>([\\s\\S]*?)<\\/${parent.split('.')[0]}>`, 'gi');
      result = result.replace(parentRegex, (match, attrs, content) => {
        const childRegex = new RegExp(`<${child}([^>]*)>`, 'gi');
        const newContent = content.replace(childRegex, (childMatch: string, childAttrs: string) => {
          if (childAttrs.includes('style=')) {
            return childMatch.replace(/style="([^"]*)"/, `style="$1; ${styleStr}"`);
          }
          return `<${child}${childAttrs} style="${styleStr}">`;
        });
        return `<${parent.split('.')[0]}${attrs}>${newContent}</${parent.split('.')[0]}>`;
      });
    }
  });

  return result;
}

/**
 * 统计字数
 */
function countWords(text: string): number {
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseCount + englishWords;
}

/**
 * 估算阅读时间（分钟）
 */
function estimateReadingTime(wordCount: number): number {
  return Math.ceil(wordCount / 400);
}

/**
 * 将 Markdown 转换为微信公众号 HTML（带内联样式）
 *
 * @param markdown - Markdown 源文本
 * @param options - 格式化选项
 * @returns 格式化结果，HTML 已包含内联样式，可直接粘贴到公众号
 */
export async function mdToWechatHtml(
  markdown: string,
  options: WechatFormatOptions = {}
): Promise<WechatFormatResult> {
  const opts = { ...DEFAULT_WECHAT_OPTIONS, ...options };

  const { renderer, buildFootnotes, reset } = createWechatRenderer(opts);
  reset();

  marked.setOptions({ breaks: true });
  marked.use({ renderer });

  const bodyHtml = await marked.parse(markdown);
  const footnotesHtml = buildFootnotes();
  const contentHtml = `<section class="container">${bodyHtml}${footnotesHtml}</section>`;

  // 获取主题 CSS 并替换变量
  let themeCSS = getThemeCSS(opts.theme);
  themeCSS = replaceCSSVariables(themeCSS, opts.primaryColor, opts.fontFamily, opts.fontSize);

  // 将 CSS 转换为内联样式
  const inlinedHtml = cssToInlineStyles(contentHtml, themeCSS);

  // 统计信息
  const plainText = markdown.replace(/[#*`\[\]()!]/g, '');
  const wordCount = countWords(plainText);
  const readingTime = estimateReadingTime(wordCount);

  return {
    html: inlinedHtml,
    css: themeCSS,
    meta: {
      wordCount,
      readingTime,
    },
  };
}

/**
 * 获取纯 HTML（不带内联样式）
 * 用于预览或需要自定义样式的场景
 */
export async function mdToWechatHtmlRaw(
  markdown: string,
  options: WechatFormatOptions = {}
): Promise<{ html: string; css: string; meta?: { wordCount: number; readingTime: number } }> {
  const opts = { ...DEFAULT_WECHAT_OPTIONS, ...options };

  const { renderer, buildFootnotes, reset } = createWechatRenderer(opts);
  reset();

  marked.setOptions({ breaks: true });
  marked.use({ renderer });

  const bodyHtml = await marked.parse(markdown);
  const footnotesHtml = buildFootnotes();
  const contentHtml = `<section class="container">${bodyHtml}${footnotesHtml}</section>`;

  let themeCSS = getThemeCSS(opts.theme);
  themeCSS = replaceCSSVariables(themeCSS, opts.primaryColor, opts.fontFamily, opts.fontSize);

  // 统计信息
  const plainText = markdown.replace(/[#*`\[\]()!]/g, '');
  const wordCount = countWords(plainText);
  const readingTime = estimateReadingTime(wordCount);

  return {
    html: contentHtml,
    css: themeCSS,
    meta: {
      wordCount,
      readingTime,
    },
  };
}

// 导出类型
export type { WechatFormatOptions, WechatFormatResult } from './types';
