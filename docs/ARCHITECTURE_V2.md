# SyncCaster 架构 v2.0 - 统一 AST + 资产中转服务

## 📋 概述

从 v1.0 的"临时方案"（Readability + Turndown）升级到健壮的生产级架构：

- **统一内容 AST**：基于 unified/rehype/remark 生态，保留完整语义
- **资产中转服务**：云端图片/公式托管，解决 CORS/防盗链/一致性问题
- **平台适配器矩阵**：根据平台能力智能转换输出格式

## 🏗️ 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       采集阶段 (Content Script)                   │
├─────────────────────────────────────────────────────────────────┤
│  1. HTML 提取 (Readability)                                      │
│  2. 公式/图片预处理                                               │
│  3. HTML → HAST (rehype-parse)                                   │
│  4. HAST → MDAST (rehype-remark)                                 │
│  5. 生成 Asset Manifest                                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    资产中转服务 (Asset Proxy)                     │
├─────────────────────────────────────────────────────────────────┤
│  Input: Asset Manifest (URLs + metadata)                        │
│  Process:                                                        │
│    - 批量下载资源                                                 │
│    - 计算 SHA-256 哈希去重                                        │
│    - 上传到对象存储 (S3/OSS/R2)                                   │
│    - 图片优化 (WebP/AVIF 转换，尺寸压缩)                          │
│    - 公式渲染 (LaTeX → SVG/PNG)                                  │
│  Output: URL Mapping { original → cdn }                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     平台适配器 (Adapters)                         │
├─────────────────────────────────────────────────────────────────┤
│  根据目标平台能力选择输出策略：                                    │
│                                                                  │
│  ┌─────────────┬──────────┬────────┬─────────┬──────────────┐  │
│  │ 平台        │ Markdown │ 数学   │ 外链图  │ 输出格式      │  │
│  ├─────────────┼──────────┼────────┼─────────┼──────────────┤  │
│  │ 掘金        │ ✅       │ ✅     │ ✅      │ MD + KaTeX   │  │
│  │ CSDN        │ ✅       │ ✅     │ ✅      │ MD + MathJax │  │
│  │ 知乎        │ ⚠️       │ ❌     │ ⚠️      │ MD + 图片公式 │  │
│  │ 微信公众号   │ ❌       │ ❌     │ ❌      │ HTML + 上传  │  │
│  └─────────────┴──────────┴────────┴─────────┴──────────────┘  │
│                                                                  │
│  转换策略：                                                       │
│    - MDAST → Markdown (remark-stringify)                        │
│    - MDAST → HTML (remark-rehype + rehype-stringify)            │
│    - Math 节点 → KaTeX/MathJax/图片                              │
│    - 图片 URL → CDN/本地上传                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 技术栈

### 1. Unified 生态

```typescript
// 核心处理器
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';      // HTML → HAST
import rehypeRemark from 'rehype-remark';    // HAST → MDAST
import remarkGfm from 'remark-gfm';          // GFM 支持
import remarkMath from 'remark-math';        // 数学支持
import remarkStringify from 'remark-stringify';  // MDAST → Markdown
import remarkRehype from 'remark-rehype';    // MDAST → HAST
import rehypeStringify from 'rehype-stringify';  // HAST → HTML
import rehypeKatex from 'rehype-katex';      // KaTeX 渲染
```

### 2. 自定义插件

```typescript
// rehype 插件：识别公式节点
function rehypeExtractMath() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.properties?.className?.includes('katex')) {
        // 转换为 inlineMath 节点
        node.type = 'inlineMath';
        node.value = extractLatex(node);
      }
    });
  };
}

// rehype 插件：提取图片资产
function rehypeExtractAssets(manifest) {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img') {
        const url = node.properties.src;
        manifest.images.push({
          url,
          alt: node.properties.alt,
          node, // 保留引用以便后续替换
        });
      }
    });
  };
}

// remark 插件：替换图片 URL
function remarkReplaceImageUrls(urlMap) {
  return (tree) => {
    visit(tree, 'image', (node) => {
      if (urlMap[node.url]) {
        node.url = urlMap[node.url];
      }
    });
  };
}
```

## 📦 数据结构

### CanonicalPost (扩展)

```typescript
interface CanonicalPost {
  id: string;
  title: string;
  source_url: string;
  collected_at: number;
  
  // AST 存储（核心）
  ast: {
    mdast: MDastRoot;          // Markdown AST (主存储)
    hast?: HastRoot;           // HTML AST (可选缓存)
  };
  
  // 资产清单
  assets: AssetManifest;
  
  // 派生输出（缓存）
  outputs?: {
    markdown?: string;         // remark-stringify 输出
    html?: string;             // rehype-stringify 输出
    platforms?: {
      [key: string]: {
        format: 'markdown' | 'html' | 'rich-text';
        content: string;
        meta: Record<string, any>;
      };
    };
  };
  
  // 元数据
  meta: {
    wordCount: number;
    readingTime: number;
    tags?: string[];
    excerpt?: string;
  };
}
```

### AssetManifest

```typescript
interface AssetManifest {
  images: ImageAsset[];
  formulas: FormulaAsset[];
  videos?: VideoAsset[];
  files?: FileAsset[];
}

interface ImageAsset {
  id: string;                  // SHA-256 哈希
  originalUrl: string;
  proxyUrl?: string;           // CDN URL
  localBlob?: Blob;            // IndexedDB 存储的本地副本
  
  metadata: {
    width?: number;
    height?: number;
    format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'svg';
    size: number;              // 字节
    alt?: string;
    title?: string;
  };
  
  optimized?: {
    webp?: { url: string; size: number };
    thumbnail?: { url: string; size: number };
  };
  
  status: 'pending' | 'downloading' | 'ready' | 'failed';
  uploadedTo?: string[];       // 已上传到哪些平台 ['wechat', 'zhihu']
}

interface FormulaAsset {
  id: string;
  latex: string;
  display: boolean;
  
  rendered?: {
    svg?: string;              // KaTeX → SVG
    png?: { url: string; blob: Blob };  // LaTeX → PNG (fallback)
    mathml?: string;
  };
  
  engine: 'katex' | 'mathjax' | 'mathml';
}
```

### PlatformCapability

```typescript
interface PlatformCapability {
  id: string;                  // 'juejin' | 'zhihu' | 'csdn' | 'wechat'
  name: string;
  
  support: {
    markdown: boolean;
    html: boolean;
    latex: boolean;            // 原生数学支持
    externalImages: boolean;   // 接受外链图片
    uploadImages: boolean;     // 支持上传图片
    richText: boolean;         // 富文本编辑器
  };
  
  limits: {
    maxImageSize?: number;     // 字节
    maxImageCount?: number;
    allowedImageFormats?: string[];
    maxContentLength?: number;
  };
  
  strategy: {
    mathRendering: 'latex' | 'image' | 'html' | 'none';
    imageSource: 'cdn' | 'upload' | 'local';
    outputFormat: 'markdown' | 'html' | 'custom';
  };
}
```

## 🔄 处理流程

### 阶段 1: 采集与解析

```typescript
async function collectContent(url: string): Promise<CanonicalPost> {
  // 1. HTML 提取
  const html = extractHTML(document);
  
  // 2. 创建资产清单
  const assetManifest: AssetManifest = {
    images: [],
    formulas: [],
  };
  
  // 3. HTML → HAST → MDAST
  const processor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeExtractMath)              // 识别公式
    .use(rehypeExtractAssets, assetManifest)  // 提取图片
    .use(rehypeCleanup)                  // 清理冗余节点
    .use(rehypeRemark)                   // HAST → MDAST
    .use(remarkGfm)                      // GFM 支持
    .use(remarkMath);                    // 数学节点
  
  const mdast = processor.parse(html);
  const transformedMdast = await processor.run(mdast);
  
  // 4. 生成标题和摘要
  const title = extractTitle(transformedMdast);
  const excerpt = extractExcerpt(transformedMdast);
  
  return {
    id: generateId(),
    title,
    source_url: url,
    collected_at: Date.now(),
    ast: { mdast: transformedMdast },
    assets: assetManifest,
    meta: {
      wordCount: countWords(transformedMdast),
      readingTime: calculateReadingTime(transformedMdast),
      excerpt,
    },
  };
}
```

### 阶段 2: 资产中转

```typescript
async function proxyAssets(manifest: AssetManifest): Promise<URLMapping> {
  const urlMapping: URLMapping = {};
  
  // 批量处理图片
  const imagePromises = manifest.images.map(async (img) => {
    // 1. 下载
    const blob = await fetch(img.originalUrl).then(r => r.blob());
    
    // 2. 计算哈希
    const hash = await calculateSHA256(blob);
    img.id = hash;
    
    // 3. 检查是否已存在
    const existing = await assetCache.get(hash);
    if (existing) {
      urlMapping[img.originalUrl] = existing.cdnUrl;
      return;
    }
    
    // 4. 上传到云存储
    const cdnUrl = await uploadToS3(blob, {
      path: `images/${hash}.${img.metadata.format}`,
      contentType: blob.type,
    });
    
    // 5. 生成优化版本
    if (img.metadata.format !== 'svg') {
      const webp = await convertToWebP(blob);
      const webpUrl = await uploadToS3(webp, {
        path: `images/${hash}.webp`,
      });
      img.optimized = { webp: { url: webpUrl, size: webp.size } };
    }
    
    // 6. 缓存映射
    urlMapping[img.originalUrl] = cdnUrl;
    img.proxyUrl = cdnUrl;
    await assetCache.set(hash, { cdnUrl, metadata: img.metadata });
  });
  
  await Promise.all(imagePromises);
  
  // 处理公式
  for (const formula of manifest.formulas) {
    formula.rendered = {
      svg: renderKaTeX(formula.latex, { displayMode: formula.display }),
    };
  }
  
  return urlMapping;
}
```

### 阶段 3: 平台适配

```typescript
async function adaptToPlatform(
  post: CanonicalPost,
  platform: PlatformCapability
): Promise<AdaptedContent> {
  let processor = unified().use(remarkGfm).use(remarkMath);
  
  // 1. 替换图片 URL
  if (platform.support.externalImages) {
    processor = processor.use(remarkReplaceImageUrls, post.assets.images);
  } else if (platform.support.uploadImages) {
    // 稍后通过自动化上传
    processor = processor.use(remarkMarkImagesForUpload);
  }
  
  // 2. 处理数学
  switch (platform.strategy.mathRendering) {
    case 'latex':
      // 保持 $...$ 语法
      break;
    case 'image':
      // 将 math 节点替换为图片
      processor = processor.use(remarkMathToImage, post.assets.formulas);
      break;
    case 'html':
      processor = processor.use(remarkRehype).use(rehypeKatex);
      break;
  }
  
  // 3. 输出格式
  if (platform.strategy.outputFormat === 'markdown') {
    processor = processor.use(remarkStringify);
  } else if (platform.strategy.outputFormat === 'html') {
    processor = processor
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeStringify);
  }
  
  const result = await processor.process(post.ast.mdast);
  
  return {
    platform: platform.id,
    format: platform.strategy.outputFormat,
    content: String(result),
    assets: {
      toUpload: platform.support.uploadImages ? post.assets.images : [],
      external: platform.support.externalImages ? post.assets.images : [],
    },
  };
}
```

## 🌐 资产中转服务实现

### 选项 1: Cloudflare Worker (推荐)

```typescript
// worker.js
export default {
  async fetch(request, env) {
    const { manifest } = await request.json();
    
    const results = await Promise.all(
      manifest.images.map(async (img) => {
        // 下载原图
        const response = await fetch(img.url);
        const blob = await response.arrayBuffer();
        
        // 计算哈希
        const hash = await crypto.subtle.digest('SHA-256', blob);
        const hashHex = Array.from(new Uint8Array(hash))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        // 上传到 R2
        const key = `images/${hashHex}.${img.format}`;
        await env.ASSETS.put(key, blob, {
          httpMetadata: { contentType: img.contentType },
        });
        
        return {
          original: img.url,
          cdn: `https://cdn.yoursite.com/${key}`,
        };
      })
    );
    
    return Response.json({ mapping: results });
  }
};
```

### 选项 2: Vercel Edge Function

```typescript
// api/proxy-assets.ts
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const { manifest } = await req.json();
  
  // 类似 Cloudflare Worker 实现
  // 上传到 Vercel Blob Storage
  const { put } = await import('@vercel/blob');
  
  const results = await Promise.all(
    manifest.images.map(async (img) => {
      const response = await fetch(img.url);
      const blob = await response.blob();
      const { url } = await put(`images/${img.hash}`, blob, { access: 'public' });
      return { original: img.url, cdn: url };
    })
  );
  
  return Response.json({ mapping: results });
}
```

### 选项 3: 自托管服务 (Node.js + S3)

```typescript
// server/api/proxy-assets.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import fetch from 'node-fetch';

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function proxyAssets(manifest: AssetManifest) {
  const results = await Promise.all(
    manifest.images.map(async (img) => {
      const response = await fetch(img.url);
      const buffer = await response.buffer();
      
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const key = `images/${hash}.${img.format}`;
      
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: img.contentType,
      }));
      
      return {
        original: img.url,
        cdn: `https://${process.env.CDN_DOMAIN}/${key}`,
      };
    })
  );
  
  return { mapping: results };
}
```

## 📊 平台配置矩阵

```typescript
// packages/core/src/platforms/configs.ts
export const PLATFORM_CONFIGS: Record<string, PlatformCapability> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    support: {
      markdown: true,
      html: false,
      latex: true,           // 支持 KaTeX
      externalImages: true,
      uploadImages: true,
      richText: false,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,
      allowedImageFormats: ['jpeg', 'png', 'gif', 'webp'],
    },
    strategy: {
      mathRendering: 'latex',
      imageSource: 'cdn',
      outputFormat: 'markdown',
    },
  },
  
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    support: {
      markdown: true,          // 部分支持
      html: false,
      latex: false,            // 不支持
      externalImages: false,   // 需要图床
      uploadImages: true,
      richText: false,
    },
    limits: {
      maxImageSize: 5 * 1024 * 1024,
      maxImageCount: 50,
    },
    strategy: {
      mathRendering: 'image',  // 公式转图片
      imageSource: 'cdn',      // 使用稳定图床
      outputFormat: 'markdown',
    },
  },
  
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    support: {
      markdown: false,
      html: true,
      latex: false,
      externalImages: false,   // 必须上传
      uploadImages: true,
      richText: true,
    },
    limits: {
      maxImageSize: 2 * 1024 * 1024,
      maxImageCount: 30,
    },
    strategy: {
      mathRendering: 'image',
      imageSource: 'upload',   // 走自动化上传
      outputFormat: 'html',
    },
  },
  
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    support: {
      markdown: true,
      html: true,
      latex: true,             // MathJax
      externalImages: true,
      uploadImages: true,
      richText: true,
    },
    strategy: {
      mathRendering: 'latex',
      imageSource: 'cdn',
      outputFormat: 'markdown',
    },
  },
};
```

## 🚀 迁移策略

### 阶段 1: 并行运行 (2 周)
- 保留现有 Turndown 方案
- 新增 Unified 管道，双写存储
- A/B 对比质量

### 阶段 2: 灰度切换 (1 周)
- 默认使用 Unified，Turndown 作为 fallback
- 监控错误率

### 阶段 3: 完全迁移 (1 周)
- 移除 Turndown 依赖
- 批量转换历史数据

## 📈 收益预期

| 指标 | v1.0 | v2.0 | 提升 |
|------|------|------|------|
| 公式准确率 | 70% | 95% | +25% |
| 图片成功率 | 60% | 98% | +38% |
| 表格完整度 | 80% | 99% | +19% |
| 平台兼容性 | 2 个 | 5+ 个 | +150% |
| 发布成功率 | 65% | 90% | +25% |

## 🔍 后续优化

1. **AI 增强**
   - 自动生成摘要和标签
   - 智能识别代码语言
   - 图片 OCR 和描述生成

2. **协作功能**
   - 多人编辑同一篇文章
   - 版本历史和 diff
   - 评论和审核流程

3. **分析面板**
   - 发布统计
   - 阅读量聚合
   - 最佳发布时间建议
