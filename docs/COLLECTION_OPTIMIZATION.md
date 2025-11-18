# 内容采集模块优化文档

## 📋 优化概览

根据用户需求，对插件的内容抽取模块进行了系统性优化改进，实现了以下关键特性：

- ✅ A. DOM 预处理（Readability 配置 + 白名单清洗）
- ✅ B. 公式抽取器（KaTeX/MathJax/MathML）
- ✅ C. 图片归一化器（增强解析策略）
- ✅ D. 格式保真（表格/代码块优化）
- ✅ E. 质量校验与回退机制

## 🔧 实现细节

### A. DOM 预处理

#### Readability 增强配置
```typescript
const COLLECT_CONFIG = {
  readability: {
    keepClasses: true,         // 保留关键类名（katex/mjx等）
    maxElemsToParse: 10000,    // 提高解析元素上限
    nbTopCandidates: 10,       // 增加候选节点数
  },
  // ...
};
```

#### 白名单清洗
保留以下关键结构，清理冗余属性：
- `table/thead/tbody/tr/th/td/colgroup` - 复杂表格
- `pre>code` - 代码块（保留 `language-xxx` 类名）
- `blockquote`, `figure/figcaption` - 引用和图片说明
- `span.katex`, `mjx-container`, `math` - 公式元素

#### 代码块高亮去壳
自动展平由高亮器（如 Prism.js/highlight.js）注入的多层 `<span class="token">` 结构：
- 提取语言标识（从 `class="language-xxx"` 或 `data-lang`）
- 保留纯文本内容
- 保留语言类名供 Turndown 转换

### B. 公式抽取器

#### 支持的渲染引擎

**1. KaTeX**
```typescript
// 从 <annotation encoding="application/x-tex"> 读取 LaTeX
// 通过 .katex-display 判断行内/行间
<span class="katex">
  <span class="katex-mathml">
    <math>
      <semantics>
        <annotation encoding="application/x-tex">\frac{a}{b}</annotation>
      </semantics>
    </math>
  </span>
</span>
```

**2. MathJax v2**
```html
<!-- 直接读取 script 内容 -->
<script type="math/tex">\sum_{i=1}^{n} x_i</script>
<script type="math/tex; mode=display">...</script>
```

**3. MathJax v3**
```html
<!-- 从 mjx-container > math 提取 -->
<mjx-container class="MJXc-display">
  <mjx-assistive-mml>
    <math>...</math>
  </mjx-assistive-mml>
</mjx-container>
```

**4. 原生 MathML**
```html
<!-- 直接转换 <math> 元素 -->
<math display="block">...</math>
```

#### 占位符机制
所有公式节点被替换为统一占位符：
```html
<span data-sync-math="true" 
      data-tex="\frac{a}{b}" 
      data-display="true"></span>
```

### C. 图片归一化器（增强版）

#### 支持的图片来源

**1. 普通 `<img>` 标签**
- `src` 属性（优先）
- `srcset` 属性（选择最高分辨率）
- `data-src` / `data-original` / `data-lazy-src` / `data-actualsrc` 懒加载属性

**2. `<picture>` 元素**
```html
<picture>
  <source srcset="image-1x.jpg 1x, image-2x.jpg 2x">
  <img src="fallback.jpg">
</picture>
```

**3. `<noscript>` 中的 `<img>`**
```html
<noscript>
  <img src="no-js-fallback.jpg">
</noscript>
```

**4. CSS 背景图**
```html
<div style="background-image: url('bg.jpg')"></div>
```

#### URL 归一化
- 自动解析相对路径为绝对 URL（`new URL(src, document.baseURI)`）
- 去重（按 URL）
- 自动写回标准 `src` 属性，确保 Turndown 正确生成 Markdown

#### 存储策略
```typescript
interface CollectedImage {
  type: 'image';
  url: string;           // 绝对 URL
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  source: 'img' | 'picture' | 'noscript' | 'background';
}
```

### D. 格式保真

#### Turndown 配置优化
```typescript
new TurndownService({
  headingStyle: 'atx',        // # H1, ## H2
  codeBlockStyle: 'fenced',   // ```
  emDelimiter: '_',           // _斜体_
  bulletListMarker: '-',      // - 列表
  br: '\n',                   // 换行处理
});
```

#### 自定义规则

**1. 公式规则**
```typescript
td.addRule('sync-math', {
  filter: (node) => node.hasAttribute('data-sync-math'),
  replacement: (_, node) => {
    const tex = node.getAttribute('data-tex');
    const display = node.getAttribute('data-display') === 'true';
    return display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
});
```

输出示例：
```markdown
行内公式 $\frac{a}{b}$ 继续文本

行间公式：

$$
\sum_{i=1}^{n} x_i
$$

继续文本
```

**2. 复杂表格规则**
对于包含合并单元格（`colspan`/`rowspan`）或列组（`colgroup`）的表格，保留原始 HTML：
```typescript
td.addRule('complex-table', {
  filter: (node) => {
    return node.nodeName === 'TABLE' 
      && node.querySelector('colgroup, [colspan], [rowspan]');
  },
  replacement: (_, node) => `\n\n${node.outerHTML}\n\n`,
});
```

**3. GFM 表格/代码块**
通过 `turndown-plugin-gfm` 支持：
- GitHub 风格表格（`|---|---|`）
- 带语言标识的代码块（` ```javascript `）

### E. 质量校验与回退机制

#### 指标计算
```typescript
interface ContentMetrics {
  images: number;       // 图片数量
  formulas: number;     // 公式数量
  tables: number;       // 表格数量
  codeBlocks: number;   // 代码块数量
  textLen: number;      // 文本长度
}
```

#### 损耗阈值
```typescript
const QUALITY_THRESHOLDS = {
  images: 0.3,    // 图片丢失 > 30% → 回退
  formulas: 0.5,  // 公式丢失 > 50% → 回退
  tables: 0.5,    // 表格丢失 > 50% → 回退
};
```

#### 回退策略
```typescript
const qualityCheck = checkQuality(initialMetrics, finalMetrics);

if (!qualityCheck.pass) {
  // 启用 HTML 回退模式
  // 保留原始 HTML，供编辑器渲染或平台发布时使用
  useHtmlFallback = true;
  logInfo('质量不达标，启用HTML回退', { reason: qualityCheck.reason });
}
```

返回数据包含质量报告：
```typescript
{
  success: true,
  data: {
    title: string,
    body_md: string,
    body_html: string,         // 原始 HTML（回退用）
    useHtmlFallback: boolean,  // 是否建议使用 HTML
    qualityCheck: {
      pass: boolean,
      reason?: string,
      lossRatio: {
        images: number,
        formulas: number,
        tables: number,
      },
    },
    // ...
  }
}
```

## 📊 采集流程图

```
┌──────────────────────────────────────────┐
│   1. Readability 提取（增强配置）          │
│   - keepClasses: true                    │
│   - maxElemsToParse: 10000               │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   2. DOM 预处理                           │
│   ├─ 公式抽取（KaTeX/MathJax/MathML）     │
│   ├─ 代码块高亮去壳                       │
│   ├─ 白名单清洗（保留关键结构）            │
│   └─ 图片归一化（img/picture/noscript）   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   3. Turndown 转换                        │
│   ├─ 自定义公式规则（$/$$ 语法）          │
│   ├─ 自定义表格规则（复杂表格保留HTML）   │
│   └─ GFM 插件（表格/代码块）              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   4. 质量校验                             │
│   ├─ 计算初始/最终指标                    │
│   ├─ 对比损耗率                          │
│   └─ 决定是否回退到 HTML 模式             │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   5. 返回采集结果                         │
│   - body_md (Markdown)                   │
│   - body_html (原始HTML)                 │
│   - images[] (图片清单)                   │
│   - formulas[] (公式清单)                 │
│   - qualityCheck (质量报告)              │
└──────────────────────────────────────────┘
```

## 🧪 测试建议

### 1. 基础测试
- ✅ 纯文本文章（无图片/公式）
- ✅ 带图片文章（img/srcset/picture）
- ✅ 带代码块文章（单语言/多语言）
- ✅ 带表格文章（简单/复杂）

### 2. 公式测试
测试页面推荐：
- [KaTeX Demo](https://katex.org/) - KaTeX 渲染
- CSDN/知乎技术文章 - 常见 MathJax
- StackOverflow 数学问题 - MathML

### 3. 图片测试
测试懒加载图片的平台：
- CSDN - `data-src`
- 掘金 - `data-actualsrc`
- 知乎 - `data-original`
- Medium - `srcset`

### 4. 质量测试
故意测试极端情况：
- 大量图片（>50）- 测试去重
- 大量公式（>20）- 测试提取准确性
- 复杂嵌套表格 - 测试 HTML 回退
- 超长文章（>10000字）- 测试性能

## 🔄 后续优化方向

### 短期（下个版本）
1. **图片本地化下载**
   - 背景脚本批量 fetch 图片为 Blob
   - 存入 IndexedDB（assets 表）
   - 发布时优先使用本地 Blob

2. **MathML → LaTeX 转换**
   - 集成 `mathml-to-latex` 或等价库
   - 提高公式还原准确度

3. **更智能的语言检测**
   - 对无语言标识的代码块，使用 `highlight.js` 自动检测
   - 避免误判纯文本为代码

### 中期（2-3版本）
1. **资产中转服务**
   - 服务端拉取图片（无 CORS 限制）
   - 转存到对象存储/CDN
   - 返回新 URL 映射

2. **增量质量优化**
   - 记录每个平台的典型指标
   - 自动调整阈值
   - 提供"严格/宽松"模式切换

3. **自定义采集规则**
   - 允许用户为特定站点配置选择器
   - 预置常见平台规则（CSDN/掘金/知乎）

### 长期（未来）
1. **AI 辅助内容理解**
   - 自动提取文章摘要
   - 识别代码片段用途
   - 标签自动分类

2. **离线增强**
   - Service Worker 缓存采集结果
   - 断网时仍可查看历史采集
   - 恢复网络后自动同步

## 📝 API 文档

### collectContent 函数

```typescript
async function collectContent(options = {}): Promise<{
  success: boolean;
  data?: {
    title: string;
    url: string;
    summary: string;
    body_md: string;
    body_html: string;
    images: CollectedImage[];
    formulas: CollectedFormula[];
    wordCount: number;
    imageCount: number;
    formulaCount: number;
    useHtmlFallback: boolean;
    qualityCheck: QualityCheck;
  };
  error?: string;
}>
```

### 类型定义

```typescript
interface CollectedImage {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  source: 'img' | 'picture' | 'noscript' | 'background';
}

interface CollectedFormula {
  type: 'formula';
  latex: string;
  display: boolean;
  engine: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml' | 'unknown';
}

interface QualityCheck {
  pass: boolean;
  reason?: string;
  initialMetrics: ContentMetrics;
  finalMetrics: ContentMetrics;
  lossRatio: {
    images: number;
    formulas: number;
    tables: number;
  };
}
```

## 🎉 总结

本次优化全面提升了内容采集的准确性和完整性：

1. **更智能的内容提取** - Readability 增强配置 + 白名单清洗
2. **更完整的格式保留** - 公式/表格/代码块全面支持
3. **更稳健的质量保证** - 自动检测并回退，避免内容丢失
4. **更灵活的存储策略** - 同时保留 Markdown 和 HTML

采集模块现已达到生产可用标准，能够准确处理包含复杂格式的技术文章。
