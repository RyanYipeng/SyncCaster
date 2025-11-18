/**
 * 统一 AST 转换管道
 * HTML → HAST → MDAST → Markdown/HTML
 */
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkStringify from 'remark-stringify';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP, EXIT } from 'unist-util-visit';
import type { Root as HastRoot, Element as HastElement } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import type {
  AssetManifest,
  ImageAsset,
  FormulaAsset,
  ContentAST,
} from '../types/ast';

/**
 * HTML 转换为 MDAST
 */
export async function htmlToMdast(
  html: string,
  manifest: AssetManifest
): Promise<MdastRoot> {
  const processor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeExtractFormulas, manifest)
    .use(rehypeExtractImages, manifest)
    .use(rehypeCleanup)
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkMath);

  const file = await processor.process(html);
  return file.result as MdastRoot;
}

/**
 * MDAST 转换为 Markdown
 */
export async function mdastToMarkdown(mdast: MdastRoot): Promise<string> {
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
 * MDAST 转换为 HTML
 */
export async function mdastToHtml(mdast: MdastRoot): Promise<string> {
  const processor = unified()
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = await processor.process(mdast as any);
  return String(file);
}

/**
 * 完整转换：HTML → ContentAST
 */
export async function parseContent(html: string): Promise<{
  ast: ContentAST;
  manifest: AssetManifest;
}> {
  const manifest: AssetManifest = {
    images: [],
    formulas: [],
  };

  const mdast = await htmlToMdast(html, manifest);

  return {
    ast: { mdast },
    manifest,
  };
}

// ========== 自定义 rehype 插件 ==========

/**
 * 提取公式
 */
function rehypeExtractFormulas(manifest: AssetManifest) {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: HastElement, index, parent) => {
      // 1. KaTeX
      if (hasClass(node, 'katex')) {
        const annotation = findAnnotation(node);
        if (annotation) {
          const latex = annotation.children[0]?.type === 'text' 
            ? annotation.children[0].value 
            : '';
          const display = hasClass(node, 'katex-display');
          
          manifest.formulas.push({
            id: `formula-${manifest.formulas.length}`,
            latex,
            display,
            engine: 'katex',
          });

          // 替换为 math 节点（remark-math 识别）
          replaceMathNode(node, latex, display);
        }
      }

      // 2. MathJax v2 (script)
      if (node.tagName === 'script') {
        const type = (node.properties?.type as string) || '';
        if (type.includes('math/tex')) {
          const latex = node.children[0]?.type === 'text' 
            ? node.children[0].value 
            : '';
          const display = type.includes('mode=display');

          manifest.formulas.push({
            id: `formula-${manifest.formulas.length}`,
            latex,
            display,
            engine: 'mathjax2',
          });

          replaceMathNode(node, latex, display);
        }
      }

      // 3. MathJax v3 (mjx-container)
      if (node.tagName === 'mjx-container') {
        const mathEl = findElement(node, 'math');
        if (mathEl) {
          const latex = getText(mathEl);
          const display = hasClass(node, 'MJXc-display') || hasProperty(node, 'display');

          manifest.formulas.push({
            id: `formula-${manifest.formulas.length}`,
            latex,
            display,
            engine: 'mathjax3',
          });

          replaceMathNode(node, latex, display);
        }
      }

      // 4. 原生 MathML
      if (node.tagName === 'math' && !hasAncestor(node, parent, 'mjx-container')) {
        const latex = getText(node);
        const display = (node.properties?.display as string) === 'block';

        manifest.formulas.push({
          id: `formula-${manifest.formulas.length}`,
          latex,
          display,
          engine: 'mathml',
        });

        replaceMathNode(node, latex, display);
      }
    });
  };
}

/**
 * 提取图片
 */
function rehypeExtractImages(manifest: AssetManifest) {
  return (tree: HastRoot) => {
    const seen = new Set<string>();

    visit(tree, 'element', (node: HastElement) => {
      if (node.tagName === 'img') {
        const src = (node.properties?.src as string) || '';
        const srcset = (node.properties?.srcset as string) || '';
        const dataSrc = (node.properties?.dataSrc as string) || '';

        const url = src || parseSrcset(srcset) || dataSrc;
        
        if (url && !seen.has(url)) {
          seen.add(url);

          const asset: ImageAsset = {
            id: `image-${manifest.images.length}`,
            originalUrl: url,
            metadata: {
              format: guessFormat(url),
              size: 0,
              alt: (node.properties?.alt as string) || undefined,
              title: (node.properties?.title as string) || undefined,
            },
            status: 'pending',
          };

          manifest.images.push(asset);

          // 标准化 src
          node.properties = node.properties || {};
          node.properties.src = url;
        }
      }

      // picture > source
      if (node.tagName === 'source' && node.properties?.srcset) {
        const url = parseSrcset(node.properties.srcset as string);
        if (url && !seen.has(url)) {
          seen.add(url);
          manifest.images.push({
            id: `image-${manifest.images.length}`,
            originalUrl: url,
            metadata: { format: guessFormat(url), size: 0 },
            status: 'pending',
          });
        }
      }
    });
  };
}

/**
 * 清理 DOM
 */
function rehypeCleanup() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: HastElement, index, parent) => {
      // 移除 script/style 标签
      if (node.tagName === 'script' || node.tagName === 'style') {
        if (parent && index !== undefined && Array.isArray(parent.children)) {
          parent.children.splice(index, 1);
          return [SKIP, index];
        }
      }

      // 清理无用属性
      if (node.properties) {
        const keep = ['src', 'alt', 'title', 'href', 'id', 'className'];
        const cleaned: Record<string, any> = {};
        for (const key of keep) {
          if (node.properties[key] !== undefined) {
            cleaned[key] = node.properties[key];
          }
        }
        node.properties = cleaned;
      }
    });
  };
}

// ========== 辅助函数 ==========

function hasClass(node: HastElement, className: string): boolean {
  const classes = node.properties?.className as string[] | undefined;
  return classes?.includes(className) ?? false;
}

function hasProperty(node: HastElement, prop: string): boolean {
  return node.properties?.[prop] !== undefined;
}

function findAnnotation(node: HastElement): HastElement | null {
  let result: HastElement | null = null;
  visit(node, 'element', (n: HastElement) => {
    if (
      n.tagName === 'annotation' &&
      n.properties?.encoding === 'application/x-tex'
    ) {
      result = n;
      return EXIT;
    }
  });
  return result;
}

function findElement(node: HastElement, tagName: string): HastElement | null {
  let result: HastElement | null = null;
  visit(node, 'element', (n: HastElement) => {
    if (n.tagName === tagName) {
      result = n;
      return EXIT;
    }
  });
  return result;
}

function hasAncestor(
  node: HastElement,
  parent: any,
  ancestorTag: string
): boolean {
  if (!parent) return false;
  if (parent.tagName === ancestorTag) return true;
  return false; // 简化实现
}

function getText(node: HastElement): string {
  let text = '';
  visit(node, 'text', (n: any) => {
    text += n.value;
  });
  return text.trim();
}

function replaceMathNode(node: HastElement, latex: string, display: boolean) {
  // 替换为占位符，remark-math 会识别
  node.tagName = 'span';
  node.properties = {
    'data-math': 'true',
    'data-latex': latex,
    'data-display': display.toString(),
  };
  node.children = [{ type: 'text', value: latex }];
}

function parseSrcset(srcset: string): string {
  if (!srcset) return '';
  const candidates = srcset.split(',').map((s) => s.trim());
  const parsed = candidates.map((c) => {
    const [url, descriptor] = c.split(/\s+/);
    const width = descriptor?.endsWith('w') ? parseInt(descriptor) : 0;
    return { url, width };
  });
  parsed.sort((a, b) => b.width - a.width);
  return parsed[0]?.url || '';
}

function guessFormat(url: string): ImageAsset['metadata']['format'] {
  const ext = url.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'avif':
      return 'avif';
    case 'gif':
      return 'gif';
    case 'svg':
      return 'svg';
    default:
      return 'jpeg';
  }
}
