# 跨平台自动发文机制

本文档描述了插件的跨平台自动发文机制的设计原则和实现细节。

## 核心原则

### 1. 统一的发布控制原则

**所有平台均禁止插件执行最终发布、提交、确认发布等操作。**

插件职责仅包括：
- 内容填充（标题、正文）
- 必要的格式解析确认（如 Markdown 解析弹窗）

最终"发布"动作必须完全由用户手动完成。

### 2. 平台分类与处理策略

#### 支持 Markdown 的平台

| 平台 | 编辑器类型 | 处理策略 |
|------|-----------|---------|
| 知乎 | 富文本（支持 Markdown 粘贴解析） | 填充 Markdown 原文，自动点击"确认并解析"按钮 |
| 掘金 | Markdown (bytemd) | 直接填充 Markdown 原文 |
| CSDN | Markdown (CodeMirror/Monaco) | 直接填充 Markdown 原文 |
| 51CTO | Markdown | 直接填充 Markdown 原文 |
| 博客园 | Markdown (CodeMirror) | 直接填充 Markdown 原文 |
| 简书 | Markdown | 直接填充 Markdown 原文 |
| 阿里云 | Markdown | 直接填充 Markdown 原文 |
| 思否 | Markdown | 直接填充 Markdown 原文 |
| 腾讯云 | Markdown | 直接填充 Markdown 原文 |

对于支持 Markdown 解析的平台（如知乎）：
- 插件将 Markdown 原文完整填充至编辑器
- 当平台弹出"识别到特殊格式，是否将 Markdown 解析为正确格式"的提示时
- 插件自动点击"确认/解析"类按钮，完成 Markdown → 平台格式的解析
- 该自动操作仅限于格式解析确认，不涉及发布行为

#### 不支持 Markdown 的平台（富文本适配）

| 平台 | 编辑器类型 | 处理策略 |
|------|-----------|---------|
| B站专栏 | Quill 富文本 | Markdown → HTML 转换后注入 |
| 微信公众号 | UEditor 富文本 | Markdown → 微信优化 HTML 转换后自动注入 |

对于不支持 Markdown 识别、仅支持富文本编辑的平台：
- 禁止直接填充 Markdown 原文
- 插件在发文前引入 Markdown → 富文本（HTML）转换层
- 转换结果基于实时预览的渲染结构
- 以平台可识别的富文本形式注入编辑器
- 尽可能保留原有排版与样式：
  - 标题层级
  - 段落与换行
  - 加粗、斜体
  - 有序/无序列表
  - 引用与代码块等基础结构

### 微信公众号自动化流程

微信公众号的发文流程已进行自动化整合，用户无需再手动在多个页面间切换与复制粘贴。

#### 原有手动流程（已废弃）

1. 打开发文页面并填充标题
2. 手动打开微信公众号排版编辑器
3. 在排版编辑器中点击"复制样式"
4. 返回微信公众号发文页面，将内容粘贴到正文编辑区

#### 新的自动化流程

当用户选择「微信公众号」作为发文平台时，插件自动完成：

1. **内容转换**：调用内置的 `mdToWechatHtml` 函数，将 Markdown 转换为微信公众号优化的 HTML
   - 使用 doocs/md 风格的转换逻辑
   - 自动应用主题样式（默认/优雅/简约）
   - 自动内联 CSS 样式（微信公众号不支持 `<style>` 标签）
   - 自动处理代码高亮、引用块、表格等元素

2. **页面打开**：自动打开微信公众号编辑页面

3. **标题填充**：自动填充文章标题

4. **作者填充**：如果配置了作者，自动填充作者字段

5. **正文填充**：自动将已适配公众号样式的富文本内容填充到编辑器
   - 优先使用 UEditor API（最可靠）
   - 备用方案：iframe body innerHTML
   - 备用方案：execCommand insertHTML
   - 备用方案：模拟粘贴事件
   - 最终备用：复制到剪贴板，提示用户手动粘贴

6. **用户手动发布**：插件不执行最终发布操作，由用户检查排版效果后手动完成

## 技术实现

### 平台能力声明

每个适配器通过 `capabilities` 声明平台能力：

```typescript
capabilities: {
  supportsMarkdown: boolean;  // 是否支持 Markdown
  supportsHtml: boolean;      // 是否支持 HTML
  // ...
}
```

### 内容转换流程

1. **transform 阶段**：根据平台能力决定内容格式
   - 支持 Markdown 的平台：保留 `contentMarkdown`
   - 仅支持 HTML 的平台：调用 `renderMarkdownToHtmlForPaste()` 生成 `contentHtml`

2. **fillAndPublish 阶段**：根据平台特性填充内容
   - Markdown 平台：直接填充 `contentMarkdown`
   - 富文本平台：填充 `contentHtml`，必要时进行 Quill/UEditor 适配

### Markdown 解析弹窗处理

对于知乎等支持 Markdown 粘贴解析的平台：

```typescript
// 查找并点击"确认并解析"按钮（格式解析确认）
for (let i = 0; i < 15; i++) {
  const parseBtn = Array.from(document.querySelectorAll('button')).find((btn) => {
    const text = btn.textContent || '';
    return text.includes('确认并解析') || 
           text.includes('解析为') ||
           text.includes('转换为');
  });

  if (parseBtn) {
    parseBtn.click();
    break;
  }
  await sleep(300);
}
```

### 富文本 HTML 规范化

对于 B 站专栏等 Quill 编辑器平台，需要将 HTML 规范化为 Quill 可识别的格式：

```typescript
const normalizeHtmlForQuill = (html: string): string => {
  // 代码块：转换为 Quill 的 ql-syntax 格式
  // 行内 code：保留标签，补充样式
  // 引用：转换为 div + 样式
  // 表格：添加基础样式
  // ...
};
```

## 返回值约定

所有适配器的 `fillAndPublish` 方法返回统一格式：

```typescript
return { 
  url: window.location.href,
  __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
};
```

错误情况：

```typescript
return {
  url: window.location.href,
  __synccasterError: {
    message: error?.message || String(error),
    stack: error?.stack,
  },
};
```

## 注意事项

1. **不要自动发布**：所有平台的最终发布操作必须由用户手动完成
2. **格式解析确认**：仅限于 Markdown → 平台格式的转换确认，不涉及发布
3. **富文本适配**：不支持 Markdown 的平台必须进行 HTML 转换，禁止直接填充 Markdown
4. **保留排版**：转换过程中尽可能保留原有排版与样式
