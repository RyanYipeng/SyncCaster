# Canonical AST 采集架构升级

## 概述

本次升级将文章采集模块从「HTML → Markdown → AST」改为「DOM → Canonical AST → 各格式输出」，实现了真正的标准化采集。

## 核心改进

### 1. 富语义 Canonical AST Schema

新的 AST Schema 能够表达常见平台的所有结构：

```typescript
// 块级节点
type BlockNode =
  | ParagraphNode      // 段落
  | HeadingNode        // 标题 (h1-h6)
  | BlockquoteNode     // 引用
  | ListNode           // 列表
  | CodeBlockNode      // 代码块
  | MathBlockNode      // 块级公式
  | TableNode          // 表格（支持 rowspan/colspan）
  | ImageBlockNode     // 块级图片
  | EmbedBlockNode     // 嵌入内容（视频、卡片等）
  | HtmlBlockNode      // 原始 HTML（兜底）
  | CustomBlockNode;   // 自定义块

// 内联节点
type InlineNode =
  | TextNode           // 文本
  | EmphasisNode       // 斜体
  | StrongNode         // 粗体
  | DeleteNode         // 删除线
  | InlineCodeNode     // 行内代码
  | LinkNode           // 链接
  | ImageInlineNode    // 行内图片
  | MathInlineNode     // 行内公式
  | BreakNode          // 换行
  | HtmlInlineNode;    // 原始 HTML（兜底）
```

### 2. 资产分离

图片等资源通过 `assetId` 引用，不直接存 URL：

```typescript
interface ImageBlockNode {
  type: 'imageBlock';
  assetId: string;        // 引用 AssetManifest 中的图片
  alt?: string;
  title?: string;
  originalUrl?: string;   // 仅用于调试/回退
}

interface CanonicalAssetManifest {
  images: ImageAssetEntry[];
  formulas: FormulaAssetEntry[];
  embeds?: EmbedEntry[];
}
```

### 3. DOM → AST 直接转换

不再经过 Markdown 中间层，避免信息丢失：

```
旧架构：DOM → innerHTML → Turndown → Markdown → parse → AST
新架构：DOM → domToCanonicalAst() → Canonical AST
```

### 4. AST 层清洗和转换

所有结构性操作都在 AST 层完成：

```typescript
// 清洗管道
const standardCleanupPipeline = composeTransformers(
  removeToc,      // 移除 TOC
  removeAds,      // 移除广告
  cleanAst        // 清理空节点
);

// 图片 URL 替换
replaceImageUrls(ast, urlMap);

// 公式转图片（用于不支持 LaTeX 的平台）
convertMathToImage(ast, formulaImages);
```

### 5. 多格式输出

Markdown 作为输出格式之一，不是中间格式：

```typescript
// 输出 Markdown
const markdown = serializeAst(ast, { format: 'markdown', assets });

// 输出 HTML
const html = serializeAst(ast, { format: 'html', assets });
```

## 文件结构

```
packages/core/src/ast/
├── canonical-ast.ts      # AST 类型定义
├── dom-to-ast.ts         # DOM → AST 转换器
├── ast-serializer.ts     # AST → Markdown/HTML 序列化
├── ast-transformer.ts    # AST 转换和清洗
└── pipeline.ts           # 统一导出

packages/core/src/collector/
├── canonical-collector.ts # 新的 Canonical 采集器
├── platform-rules.ts      # 平台采集规则
└── index.ts               # 旧采集器（保留兼容）

apps/extension/src/content-scripts/
├── canonical-collector.ts # Content Script 版本
└── index.ts               # 入口（使用新采集器）
```

## 使用方式

### 在 Content Script 中

```typescript
import { collectContentCanonical } from './canonical-collector';

const result = await collectContentCanonical();
if (result.success) {
  const { title, body_md, ast, assets, metrics } = result.data;
  // ...
}
```

### 在 Node.js 中

```typescript
import { CanonicalCollector } from '@synccaster/core';

const collector = new CanonicalCollector({
  useReadability: true,
  cleanup: true,
});

const result = await collector.collectFromHtml(html, url);
```

## 平台适配

### 公式处理

| 平台 | 支持方式 | 处理策略 |
|------|----------|----------|
| 掘金 | KaTeX | 直接输出 `$...$` |
| CSDN | MathJax | 直接输出 `$...$` |
| 微信 | 不支持 | 转换为图片 |
| 知乎 | MathJax | 直接输出 |

### 表格处理

| 情况 | 处理策略 |
|------|----------|
| 简单表格 | 输出 GFM 表格 |
| 复杂表格（rowspan/colspan） | 输出 HTML |
| 不支持表格的平台 | 降级为预格式文本 |

### 嵌入内容

| 类型 | 处理策略 |
|------|----------|
| 视频 | 保留 iframe/video HTML |
| 卡片 | 降级为链接 |
| 代码沙箱 | 保留 iframe |

## 质量保证

采集时会计算指标并进行质量校验：

```typescript
interface CollectionMetrics {
  images: number;      // 图片数量
  formulas: number;    // 公式数量
  tables: number;      // 表格数量
  codeBlocks: number;  // 代码块数量
  wordCount: number;   // 字数
  processingTime: number; // 处理时间
}
```

## 向后兼容

- 旧的 `collectContent()` 函数仍然可用（通过 `COLLECT_CONTENT_LEGACY` 消息）
- `CanonicalPost` 类型保持兼容，新增 `ast` 字段存储 AST
- 旧的 `body_md` 字段仍然生成，供不支持 AST 的代码使用
