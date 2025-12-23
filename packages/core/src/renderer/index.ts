/**
 * Renderer Module
 *
 * 统一的 Markdown 渲染入口，支持新旧渲染器切换。
 *
 * 切换策略：
 * - 默认使用新渲染器（MDH Core）
 * - 环境变量 USE_MDH_RENDERER=0 可强制回退旧渲染器
 * - 新渲染器异常时自动回退旧渲染器
 */

import {
  renderMarkdownToHtml as mdhRender,
  type RenderOptions as MdhRenderOptions,
  type RenderResult,
} from './mdh-core';

// ============================================================================
// Configuration
// ============================================================================

/**
 * 检查是否使用 MDH 渲染器
 * 默认启用，设置 USE_MDH_RENDERER=0 可禁用
 */
function shouldUseMdhRenderer(): boolean {
  // 浏览器环境
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (win.__USE_MDH_RENDERER__ === false || win.__USE_MDH_RENDERER__ === '0') {
      return false;
    }
    return true;
  }

  // Node 环境
  if (typeof process !== 'undefined' && process.env) {
    return process.env.USE_MDH_RENDERER !== '0';
  }

  return true;
}

// ============================================================================
// Legacy Renderer (Fallback)
// ============================================================================

import { Marked as LegacyMarked } from 'marked';

/**
 * 旧渲染器实现（简化版，用于回退）
 */
function legacyRender(markdown: string): RenderResult {
  const marked = new LegacyMarked({
    gfm: true,
    breaks: false,
  });

  const html = marked.parse(markdown || '') as string;

  // 简单提取资源
  const images: string[] = [];
  const links: string[] = [];

  const imgRegex = /<img[^>]+src\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1] ?? match[2];
    if (src) images.push(src);
  }

  return { html, assets: { images, links } };
}

// ============================================================================
// Unified Render Function
// ============================================================================

export interface UnifiedRenderOptions extends MdhRenderOptions {
  /** 强制使用旧渲染器 */
  forceLegacy?: boolean;
}

/**
 * 统一渲染入口
 *
 * @param markdown - Markdown 源文本
 * @param options - 渲染选项
 * @returns 渲染结果
 */
export function renderMarkdown(markdown: string, options: UnifiedRenderOptions = {}): RenderResult {
  const { forceLegacy, ...renderOptions } = options;

  // 检查是否使用旧渲染器
  if (forceLegacy || !shouldUseMdhRenderer()) {
    return legacyRender(markdown);
  }

  // 使用新渲染器，异常时回退
  try {
    return mdhRender(markdown, renderOptions);
  } catch (error) {
    // 记录警告日志（不输出全文，只输出摘要）
    const errMsg = error instanceof Error ? error.message : String(error);
    const textLen = markdown?.length ?? 0;
    console.warn(`[MDH Renderer] Error: ${errMsg.slice(0, 100)}... (text length: ${textLen}), falling back to legacy renderer`);

    // 回退到旧渲染器
    return legacyRender(markdown);
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { renderMarkdownToHtml, type RenderOptions, type RenderResult } from './mdh-core';

// 默认导出
export default renderMarkdown;
