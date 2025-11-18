/**
 * HTML 适配器
 * 用于富文本平台：微信公众号、Medium、今日头条等
 */
import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import { visit } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import type {
  AdaptedContent,
  AssetManifest,
  FormulaAsset,
} from '../types/ast';
import type { CanonicalPost } from '../types';
import { PlatformAdapter } from './base';

/**
 * HTML 平台适配器
 */
export class HtmlAdapter extends PlatformAdapter {
  async adapt(
    post: CanonicalPost,
    manifest: AssetManifest
  ): Promise<AdaptedContent> {
    // 1. 获取 MDAST
    let mdast: MdastRoot;
    const postWithAst = post as any;
    if (postWithAst.ast?.mdast) {
      mdast = postWithAst.ast.mdast;
    } else {
      mdast = { type: 'root', children: [] };
    }

    // 2. 处理公式
    const mathRendering = this.getStrategy('mathRendering');
    if (mathRendering === 'image') {
      mdast = this.replaceMathWithImages(mdast, manifest.formulas);
    } else if (mathRendering === 'none') {
      mdast = this.removeMath(mdast);
    }

    // 3. 转换为 HTML
    let content = await this.convertToHtml(mdast, mathRendering === 'html');

    // 4. 替换图片 URL
    content = this.replaceImageUrls(content, manifest);

    // 5. 应用样式（如果需要）
    if (this.options.config?.inlineStyles) {
      content = this.applyInlineStyles(content);
    }

    // 6. 分类资产
    const { toUpload, external } = this.categorizeImages(manifest);

    return {
      platform: this.getPlatformId(),
      format: 'html',
      content,
      assets: {
        toUpload,
        external,
        formulas: manifest.formulas,
      },
      meta: {
        wordCount: this.countWords(content),
        imageCount: manifest.images.length,
        formulaCount: manifest.formulas.length,
      },
    };
  }

  /**
   * 转换 MDAST 为 HTML
   */
  private async convertToHtml(
    mdast: MdastRoot,
    renderMath: boolean
  ): Promise<string> {
    const processor = unified()
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(renderMath ? rehypeKatex : () => {})
      .use(rehypeStringify, { allowDangerousHtml: true });

    const file = await processor.process(mdast as any);
    return String(file);
  }

  /**
   * 替换数学节点为图片
   */
  private replaceMathWithImages(
    mdast: MdastRoot,
    formulas: FormulaAsset[]
  ): MdastRoot {
    const formulaMap = new Map(formulas.map((f) => [f.latex, f]));

    visit(mdast, (node: any) => {
      if (node.type === 'inlineMath' || node.type === 'math') {
        const formula = formulaMap.get(node.value);
        if (formula?.rendered?.png?.url) {
          node.type = 'image';
          node.url = formula.rendered.png.url;
          node.alt = `公式: ${formula.latex.slice(0, 50)}`;
          delete node.value;
        }
      }
    });

    return mdast;
  }

  /**
   * 移除数学节点
   */
  private removeMath(mdast: MdastRoot): MdastRoot {
    visit(mdast, (node: any) => {
      if (node.type === 'inlineMath' || node.type === 'math') {
        node.type = 'text';
        node.value = `[公式: ${node.value}]`;
      }
    });

    return mdast;
  }

  /**
   * 应用内联样式（微信公众号等需要）
   */
  private applyInlineStyles(html: string): string {
    // 基础样式
    const styles = this.options.config?.styles || {
      h1: 'font-size: 28px; font-weight: bold; margin: 20px 0 10px;',
      h2: 'font-size: 24px; font-weight: bold; margin: 18px 0 10px;',
      h3: 'font-size: 20px; font-weight: bold; margin: 16px 0 10px;',
      p: 'margin: 10px 0; line-height: 1.75; font-size: 16px;',
      code: 'background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace;',
      pre: 'background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; margin: 15px 0;',
      blockquote: 'border-left: 4px solid #ddd; padding-left: 15px; margin: 15px 0; color: #666;',
      img: 'max-width: 100%; height: auto; display: block; margin: 15px auto;',
      table: 'border-collapse: collapse; width: 100%; margin: 15px 0;',
      th: 'border: 1px solid #ddd; padding: 8px; background: #f5f5f5; font-weight: bold;',
      td: 'border: 1px solid #ddd; padding: 8px;',
    };

    let result = html;

    // 应用样式
    for (const [tag, style] of Object.entries(styles)) {
      const regex = new RegExp(`<${tag}([^>]*)>`, 'gi');
      result = result.replace(regex, (match, attrs) => {
        // 如果已有 style，合并
        if (attrs.includes('style=')) {
          return match.replace(/style="([^"]*)"/, `style="$1 ${style}"`);
        } else {
          return `<${tag}${attrs} style="${style}">`;
        }
      });
    }

    return result;
  }

  /**
   * 统计字数
   */
  private countWords(html: string): number {
    // 移除 HTML 标签
    const text = html.replace(/<[^>]+>/g, '');
    // 统计中英文字符
    const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishCount = (text.match(/[a-zA-Z]+/g) || []).join('').length;
    return chineseCount + Math.ceil(englishCount / 5); // 英文按 5 字母 = 1 字计算
  }
}
