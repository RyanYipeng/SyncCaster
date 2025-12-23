/**
 * Markdown 渲染入口（用于平台发布）
 *
 * 此模块是旧 API 的兼容层，内部调用新的 MDH Core 渲染器。
 * 保持原有函数签名不变，调用方无需修改。
 */

import { renderMarkdown, type RenderResult } from '../renderer';

export type RenderMarkdownToHtmlForPasteOptions = {
  /**
   * Strip `$...$` and `$$...$$` wrappers.
   * Useful for platforms that don't support LaTeX rendering.
   */
  stripMath?: boolean;
  /**
   * 强制使用旧渲染器（用于回退）
   */
  forceLegacy?: boolean;
};

/**
 * 渲染 Markdown 为 HTML（用于平台发布）
 *
 * @param markdown - Markdown 源文本
 * @param options - 渲染选项
 * @returns 渲染后的 HTML 字符串
 */
export function renderMarkdownToHtmlForPaste(
  markdown: string,
  options: RenderMarkdownToHtmlForPasteOptions = {}
): string {
  let md = markdown || '';
  md = md.replace(/\r\n/g, '\n');

  // 处理数学公式
  if (options.stripMath) {
    md = md.replace(/\$([^$\n]+)\$/g, '$1');
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, '\n$1\n');
  }

  // 调用新渲染器
  const result = renderMarkdown(md, {
    gfmLineBreaks: false,
    smartypants: true,
    sanitize: true,
    forceLegacy: options.forceLegacy,
  });

  return result.html;
}

/**
 * 渲染 Markdown 为 HTML（带资源信息）
 *
 * @param markdown - Markdown 源文本
 * @param options - 渲染选项
 * @returns 渲染结果，包含 HTML 和资源信息
 */
export function renderMarkdownToHtmlWithAssets(
  markdown: string,
  options: RenderMarkdownToHtmlForPasteOptions = {}
): RenderResult {
  let md = markdown || '';
  md = md.replace(/\r\n/g, '\n');

  if (options.stripMath) {
    md = md.replace(/\$([^$\n]+)\$/g, '$1');
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, '\n$1\n');
  }

  return renderMarkdown(md, {
    gfmLineBreaks: false,
    smartypants: true,
    sanitize: true,
    forceLegacy: options.forceLegacy,
  });
}

