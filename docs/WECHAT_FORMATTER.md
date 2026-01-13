# 微信公众号格式化器

## 概述

微信公众号格式化器是一个专门为微信公众号设计的 Markdown → HTML 转换模块，核心逻辑参考了 [doocs/md](https://github.com/doocs/md) 项目。

## 自动化发文流程（优化版）

当用户选择「微信公众号」作为发文平台时，插件自动完成以下操作：

1. **打开发文页面** - 自动获取微信公众号 token 并打开编辑页面
2. **填充标题** - 自动将文章标题填入标题输入框
3. **内容转换** - 自动调用内置的 Markdown → 微信公众号排版逻辑（`mdToWechatHtml`）
4. **样式复制** - 生成带内联样式的 HTML（相当于"复制样式"操作）
5. **内容填充** - 将已适配公众号样式的富文本内容自动填充到正文编辑区

### 自动化范围约束

- 插件仅负责 **页面打开、内容转换、样式复制与内容填充**
- **不执行** 最终的"发布/群发/确认发布"等操作
- 最终发布行为仍完全由用户手动完成

### 目标效果

- 用户在选择「公众号发文」后，无需再手动在多个页面间切换与复制粘贴
- 正文内容在微信公众号编辑器中尽可能保持与内置排版效果一致

## 特性

- **自动化发文流程** - 选择公众号发文后，自动完成排版转换和内容填充
- **专为公众号优化**：生成的 HTML 可以直接粘贴到微信公众号编辑器
- **内联样式**：所有样式都内联到 HTML 中，避免公众号过滤 `<style>` 标签
- **多主题支持**：支持 default、grace、simple 三种主题
- **代码高亮**：内置简单的代码高亮，支持常见语言
- **Mac 风格代码块**：可选的 Mac 风格代码块装饰
- **脚注引用**：自动将外链转换为脚注引用
- **阅读统计**：自动计算字数和阅读时间

## 使用方法

### 基本用法

```typescript
import { mdToWechatHtml } from '@synccaster/core';

const markdown = `
# Hello World

This is a **test** paragraph.

## Features

- Item 1
- Item 2
`;

const result = await mdToWechatHtml(markdown);

console.log(result.html);  // 可直接粘贴到公众号的 HTML
console.log(result.meta);  // { wordCount: 10, readingTime: 1 }
```

### 自定义选项

```typescript
import { mdToWechatHtml, type WechatFormatOptions } from '@synccaster/core';

const options: WechatFormatOptions = {
  theme: 'grace',           // 主题：default | grace | simple
  primaryColor: '#1890ff',  // 主题色
  fontSize: '16px',         // 字号
  isUseIndent: true,        // 首行缩进
  isUseJustify: true,       // 两端对齐
  citeStatus: true,         // 显示脚注引用
  isMacCodeBlock: true,     // Mac 风格代码块
  author: '作者名',         // 作者
};

const result = await mdToWechatHtml(markdown, options);
```

### 获取原始 HTML（不带内联样式）

```typescript
import { mdToWechatHtmlRaw } from '@synccaster/core';

const { html, css } = await mdToWechatHtmlRaw(markdown);

// html: 带 class 的 HTML
// css: 对应的 CSS 样式
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| theme | 'default' \| 'grace' \| 'simple' | 'default' | 主题名称 |
| primaryColor | string | '#3f51b5' | 主题色 |
| fontFamily | string | 系统字体 | 字体 |
| fontSize | string | '15px' | 字号 |
| isUseIndent | boolean | false | 首行缩进 |
| isUseJustify | boolean | false | 两端对齐 |
| citeStatus | boolean | true | 显示脚注引用 |
| countStatus | boolean | false | 显示阅读时间 |
| isMacCodeBlock | boolean | true | Mac 风格代码块 |
| isShowLineNumber | boolean | false | 显示行号 |
| legend | 'alt' \| 'title' \| 'alt-title' | 'alt' | 图片说明格式 |
| author | string | - | 作者名称 |

## 主题预览

### Default 主题
- 经典风格
- 二级标题使用主题色背景
- 三级标题使用左边框

### Grace 主题
- 优雅风格
- 渐变色标题
- 引用块带装饰引号

### Simple 主题
- 简约风格
- 下划线标题
- 最小化装饰

## 在适配器中使用

微信公众号适配器已集成格式化器：

```typescript
import { wechatAdapter } from '@synccaster/adapters';

// 在 transform 中自动使用格式化器
const payload = await wechatAdapter.transform(post, {
  config: {
    theme: 'default',
    primaryColor: '#3f51b5',
  }
});

// payload.contentHtml 是格式化后的 HTML
```

## 预览组件

`PublishPreview.vue` 组件支持微信公众号专用预览：

```vue
<PublishPreview
  :title="post.title"
  :content="post.body_md"
  :selected-platforms="['wechat']"
  :wechat-options="{
    theme: 'default',
    primaryColor: '#3f51b5',
  }"
/>
```

## 技术实现

1. **渲染器**：基于 marked.js 自定义渲染器
2. **主题系统**：CSS 变量 + 内联样式转换
3. **代码高亮**：简单的正则匹配高亮
4. **脚注系统**：自动收集外链并生成脚注
5. **DOM 自动化**：支持 UEditor 和 ProseMirror 两种编辑器

### 内容填充策略

`fillAndPublish` 方法按优先级尝试以下方式填充内容：

1. **微信官方 JS API**（推荐）- 使用 `__MP_Editor_JSAPI__.invoke({ apiName: 'mp_editor_set_content' })`
2. **UEditor API**（传统编辑器）- 直接调用 `ue.setContent(html)`
3. **剪贴板方案**（备用）- 将内容复制到剪贴板，提示用户手动按 Ctrl+V 粘贴

如果所有自动填充方式都失败，会将内容复制到剪贴板并提示用户手动粘贴。

### 微信官方 JS API

微信公众号提供了官方的编辑器 JS API，参考文档：
- https://developers.weixin.qq.com/doc/offiaccount/MP_Editor_JsApi/mp_editor_jsapi.html

主要使用的 API：
```javascript
window.__MP_Editor_JSAPI__.invoke({
  apiName: 'mp_editor_set_content',
  apiParam: { content: htmlContent },
  sucCb: (res) => { /* 成功回调 */ },
  errCb: (err) => { /* 失败回调 */ }
});
```

### 微信公众号编辑器迁移说明

微信公众号正在从 UEditor 迁移到 ProseMirror 编辑器。新版编辑器提供了官方 JS API，可以更可靠地设置内容。

如果遇到格式问题，建议：
1. 在文章编辑页点击"打开公众号编辑器"按钮
2. 在公众号编辑器中点击"复制"按钮
3. 手动粘贴到微信公众号编辑器

## 注意事项

1. 微信公众号不支持 CSS 变量，所有变量会被替换为实际值
2. 微信公众号会过滤 `<style>` 标签，所以样式必须内联
3. 图片需要上传到微信服务器，外链图片可能无法显示
4. LaTeX 公式不被支持，建议转换为图片

## 相关文件

- `packages/core/src/wechat/` - 格式化器核心代码
- `packages/adapters/src/wechat.ts` - 微信适配器
- `apps/extension/src/ui/options/components/PublishPreview.vue` - 预览组件
