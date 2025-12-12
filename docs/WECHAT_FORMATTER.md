# 微信公众号格式化器

## 概述

微信公众号格式化器是一个专门为微信公众号设计的 Markdown → HTML 转换模块，核心逻辑参考了 [doocs/md](https://github.com/doocs/md) 项目。

## 特性

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

## 注意事项

1. 微信公众号不支持 CSS 变量，所有变量会被替换为实际值
2. 微信公众号会过滤 `<style>` 标签，所以样式必须内联
3. 图片需要上传到微信服务器，外链图片可能无法显示
4. LaTeX 公式不被支持，建议转换为图片

## 相关文件

- `packages/core/src/wechat/` - 格式化器核心代码
- `packages/adapters/src/wechat.ts` - 微信适配器
- `apps/extension/src/ui/options/components/PublishPreview.vue` - 预览组件
