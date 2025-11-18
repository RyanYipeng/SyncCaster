/**
 * Markdown 适配器
 * 用于支持 Markdown 的平台：掘金、CSDN、简书等
 */
import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import type { Root as MdastRoot } from 'mdast';
import type {
  AdaptedContent,
  AssetManifest,
  FormulaAsset,
} from '../types/ast';
import type { CanonicalPost } from '../types';
import { PlatformAdapter } from './base';
import { mdastToMarkdown } from '../ast/pipeline';

/**
 * Markdown 平台适配器
 */
export class MarkdownAdapter extends PlatformAdapter {
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
      // 降级：从 body_md 解析
      mdast = { type: 'root', children: [] };
    }

    // 2. 处理公式
    const mathRendering = this.getStrategy('mathRendering');
    if (mathRendering === 'image') {
      mdast = this.replaceMathWithImages(mdast, manifest.formulas);
    } else if (mathRendering === 'none') {
      mdast = this.removeMath(mdast);
    }
    // 如果是 'latex'，保持原样

    // 3. 转换为 Markdown
    let content = await this.convertToMarkdown(mdast);

    // 4. 替换图片 URL
    content = this.replaceImageUrls(content, manifest);

    // 5. 分类资产
    const { toUpload, external } = this.categorizeImages(manifest);

    return {
      platform: this.getPlatformId(),
      format: 'markdown',
      content,
      assets: {
        toUpload,
        external,
        formulas: manifest.formulas,
      },
      meta: {
        wordCount: content.length,
        imageCount: manifest.images.length,
        formulaCount: manifest.formulas.length,
      },
    };
  }

  /**
   * 转换 MDAST 为 Markdown
   */
  private async convertToMarkdown(mdast: MdastRoot): Promise<string> {
    const processor = unified()
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        fences: true,
        incrementListMarker: true,
      });

    const file = await processor.stringify(mdast);
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
          // 替换为图片节点
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
    visit(mdast, (node: any, index, parent) => {
      if (node.type === 'inlineMath' || node.type === 'math') {
        // 替换为纯文本
        node.type = 'text';
        node.value = `[公式: ${node.value}]`;
      }
    });

    return mdast;
  }
}
