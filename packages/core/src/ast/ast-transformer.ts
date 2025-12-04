/**
 * AST 转换器
 * 在 AST 层进行清洗、优化和平台适配
 * 
 * 所有结构性操作都在这里完成，不在字符串层做 regex 替换
 */

import type {
  RootNode,
  BlockNode,
  InlineNode,
  CanonicalNode,
  ParagraphNode,
  TextNode,
  HeadingNode,
  ListNode,
  ListItemNode,
  TableNode,
  MathBlockNode,
  MathInlineNode,
  ImageBlockNode,
  ImageInlineNode,
  EmbedBlockNode,
  HtmlBlockNode,
  CanonicalAssetManifest,
} from './canonical-ast';

// ========== 访问器类型 ==========

export type NodeVisitor = (
  node: CanonicalNode,
  parent: CanonicalNode | null,
  index: number
) => CanonicalNode | null | void;

export type BlockVisitor = (
  node: BlockNode,
  parent: RootNode | BlockNode,
  index: number
) => BlockNode | null | void;

export type InlineVisitor = (
  node: InlineNode,
  parent: BlockNode,
  index: number
) => InlineNode | null | void;

// ========== 通用遍历函数 ==========

/**
 * 遍历并转换 AST
 * 返回 null 表示删除节点
 */
export function visitAst(
  ast: RootNode,
  visitor: NodeVisitor
): RootNode {
  const newChildren: BlockNode[] = [];
  
  for (let i = 0; i < ast.children.length; i++) {
    const child = ast.children[i];
    const result = visitBlockNode(child, ast, i, visitor);
    if (result) newChildren.push(result);
  }
  
  return { ...ast, children: newChildren };
}


function visitBlockNode(
  node: BlockNode,
  parent: RootNode | BlockNode,
  index: number,
  visitor: NodeVisitor
): BlockNode | null {
  // 先访问当前节点
  const result = visitor(node, parent, index);
  if (result === null) return null;
  
  const currentNode = (result as BlockNode) || node;
  
  // 递归处理子节点
  switch (currentNode.type) {
    case 'paragraph':
    case 'heading': {
      const n = currentNode as ParagraphNode | HeadingNode;
      const newChildren: InlineNode[] = [];
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        const childResult = visitInlineNode(child, currentNode, i, visitor);
        if (childResult) newChildren.push(childResult);
      }
      return { ...n, children: newChildren } as BlockNode;
    }
    
    case 'blockquote': {
      const n = currentNode as { type: 'blockquote'; children: BlockNode[] };
      const newChildren: BlockNode[] = [];
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        const childResult = visitBlockNode(child, currentNode, i, visitor);
        if (childResult) newChildren.push(childResult);
      }
      return { ...n, children: newChildren } as BlockNode;
    }
    
    case 'list': {
      const n = currentNode as ListNode;
      const newChildren: ListItemNode[] = [];
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        const childResult = visitBlockNode(child, currentNode, i, visitor);
        if (childResult) newChildren.push(childResult as ListItemNode);
      }
      return { ...n, children: newChildren };
    }
    
    case 'listItem': {
      const n = currentNode as ListItemNode;
      const newChildren: BlockNode[] = [];
      for (let i = 0; i < n.children.length; i++) {
        const child = n.children[i];
        const childResult = visitBlockNode(child, currentNode, i, visitor);
        if (childResult) newChildren.push(childResult);
      }
      return { ...n, children: newChildren };
    }
    
    case 'table': {
      const n = currentNode as TableNode;
      // 表格的递归处理较复杂，这里简化处理
      return n;
    }
    
    default:
      return currentNode;
  }
}

function visitInlineNode(
  node: InlineNode,
  parent: BlockNode,
  index: number,
  visitor: NodeVisitor
): InlineNode | null {
  const result = visitor(node, parent, index);
  if (result === null) return null;
  
  const currentNode = (result as InlineNode) || node;
  
  // 递归处理有子节点的内联节点
  if ('children' in currentNode && Array.isArray((currentNode as any).children)) {
    const n = currentNode as { children: InlineNode[] };
    const newChildren: InlineNode[] = [];
    for (let i = 0; i < n.children.length; i++) {
      const child = n.children[i];
      const childResult = visitInlineNode(child, parent, i, visitor);
      if (childResult) newChildren.push(childResult);
    }
    return { ...currentNode, children: newChildren } as InlineNode;
  }
  
  return currentNode;
}


// ========== 预定义转换器 ==========

/**
 * 清洗 AST：移除空节点、合并相邻文本等
 */
export function cleanAst(ast: RootNode): RootNode {
  return visitAst(ast, (node, parent, index) => {
    // 移除空段落
    if (node.type === 'paragraph') {
      const para = node as ParagraphNode;
      if (para.children.length === 0) return null;
      if (para.children.length === 1 && para.children[0].type === 'text') {
        const text = (para.children[0] as TextNode).value;
        if (!text.trim()) return null;
      }
    }
    
    // 移除空文本节点
    if (node.type === 'text') {
      const text = (node as TextNode).value;
      if (!text) return null;
    }
    
    return node;
  });
}

/**
 * 移除 TOC 节点
 */
export function removeToc(ast: RootNode): RootNode {
  return visitAst(ast, (node) => {
    if (node.type === 'toc') return null;
    
    // 检查是否是 [TOC] 文本
    if (node.type === 'paragraph') {
      const para = node as ParagraphNode;
      if (para.children.length === 1 && para.children[0].type === 'text') {
        const text = (para.children[0] as TextNode).value.trim();
        if (text === '[TOC]' || text === '[[toc]]') return null;
      }
    }
    
    return node;
  });
}

/**
 * 移除广告/推广内容
 */
export function removeAds(ast: RootNode): RootNode {
  const adPatterns = [
    /关注.*公众号/,
    /扫码.*关注/,
    /点击.*领取/,
    /限时.*优惠/,
    /广告/,
  ];
  
  return visitAst(ast, (node) => {
    if (node.type === 'paragraph') {
      const para = node as ParagraphNode;
      const text = getPlainText(para.children);
      
      for (const pattern of adPatterns) {
        if (pattern.test(text)) return null;
      }
    }
    
    return node;
  });
}

/**
 * 提取所有图片资产 ID
 */
export function extractImageAssetIds(ast: RootNode): string[] {
  const ids: string[] = [];
  
  visitAst(ast, (node) => {
    if (node.type === 'imageBlock') {
      ids.push((node as ImageBlockNode).assetId);
    }
    if (node.type === 'imageInline') {
      ids.push((node as ImageInlineNode).assetId);
    }
    return node;
  });
  
  return ids;
}

/**
 * 替换图片 URL（通过 assetId 映射）
 */
export function replaceImageUrls(
  ast: RootNode,
  urlMap: Map<string, string>
): RootNode {
  return visitAst(ast, (node) => {
    if (node.type === 'imageBlock') {
      const img = node as ImageBlockNode;
      const newUrl = urlMap.get(img.assetId);
      if (newUrl) {
        return { ...img, originalUrl: newUrl };
      }
    }
    if (node.type === 'imageInline') {
      const img = node as ImageInlineNode;
      const newUrl = urlMap.get(img.assetId);
      if (newUrl) {
        return { ...img, originalUrl: newUrl };
      }
    }
    return node;
  });
}

/**
 * 将公式转换为图片（用于不支持 LaTeX 的平台）
 */
export function convertMathToImage(
  ast: RootNode,
  formulaImages: Map<string, string> // tex → imageUrl
): RootNode {
  return visitAst(ast, (node) => {
    if (node.type === 'mathBlock') {
      const math = node as MathBlockNode;
      const imageUrl = formulaImages.get(math.tex);
      if (imageUrl) {
        return {
          type: 'imageBlock',
          assetId: `formula-${math.tex.substring(0, 20)}`,
          alt: math.tex,
          originalUrl: imageUrl,
        } as ImageBlockNode;
      }
    }
    if (node.type === 'mathInline') {
      const math = node as MathInlineNode;
      const imageUrl = formulaImages.get(math.tex);
      if (imageUrl) {
        return {
          type: 'imageInline',
          assetId: `formula-${math.tex.substring(0, 20)}`,
          alt: math.tex,
          originalUrl: imageUrl,
        } as ImageInlineNode;
      }
    }
    return node;
  });
}

/**
 * 将复杂表格转换为 HTML 块
 */
export function convertComplexTablesToHtml(ast: RootNode): RootNode {
  return visitAst(ast, (node) => {
    if (node.type === 'table') {
      const table = node as TableNode;
      if (table.hasRowspan || table.hasColspan) {
        // 这里需要序列化为 HTML
        // 简化处理：标记为需要 HTML 输出
        return {
          ...table,
          data: { ...table.data, requiresHtml: true },
        };
      }
    }
    return node;
  });
}

// ========== 辅助函数 ==========

function getPlainText(nodes: InlineNode[]): string {
  return nodes.map(node => {
    if (node.type === 'text') return (node as TextNode).value;
    if ('children' in node && Array.isArray((node as any).children)) {
      return getPlainText((node as any).children);
    }
    return '';
  }).join('');
}

// ========== 组合转换器 ==========

export type AstTransformer = (ast: RootNode) => RootNode;

/**
 * 组合多个转换器
 */
export function composeTransformers(...transformers: AstTransformer[]): AstTransformer {
  return (ast: RootNode) => {
    return transformers.reduce((current, transformer) => transformer(current), ast);
  };
}

/**
 * 标准清洗管道
 */
export const standardCleanupPipeline = composeTransformers(
  removeToc,
  removeAds,
  cleanAst
);

// 所有函数已通过 export function 导出
