# 修复"Receiving end does not exist"错误

## 问题原因
Content script 被构建成了 ES module 格式（使用 `import` 语句），导致无法在页面中执行。Chrome 扩展的 content scripts 必须是自包含的 IIFE 格式。

## 解决方案
1. **添加 esbuild 作为构建工具**
   - 安装：`pnpm add -D esbuild`

2. **修改 Vite 配置**
   - 在 `vite.config.ts` 中添加自定义插件 `buildExtension()`
   - 该插件在主构建完成后，使用 esbuild 单独将 content-scripts 打包为 IIFE 格式
   - 配置参数：
     ```typescript
     format: 'iife',           // 立即执行函数表达式
     bundle: true,             // 打包所有依赖
     globalName: 'ContentScript', // 全局变量名
     ```

3. **构建产物验证**
   - 之前（错误）：
     ```javascript
     import{r as j,T as H,g as W}from"./assets/turndown-plugin-gfm...
     ```
   - 现在（正确）：
     ```javascript
     "use strict";
     var ContentScript = (() => {
       // ... 所有代码打包在 IIFE 中
     })();
     ```

## 测试步骤

### 1. 刷新扩展
```
1. 打开 chrome://extensions
2. 找到 SyncCaster 扩展
3. 点击「刷新」图标 🔄
```

### 2. 打开测试页面
推荐测试页面：
- 简单文章：https://www.zhihu.com/question/xxxxx
- 带图片：https://juejin.cn/post/xxxxx
- 带代码：https://github.com/xxx/README.md
- 带公式：CSDN 数学相关文章

### 3. 点击扩展图标
- Popup 界面应正常打开
- 点击「采集当前页面」按钮

### 4. 查看 Console
正确的日志输出应该是：
```
[content:init] Content script loaded { url: "..." }
[content:message] Received message { type: "COLLECT_CONTENT" }
[content:collect] 开始采集页面内容 { url: "..." }
[content:collect] 初始内容指标 { images: X, formulas: X, ... }
[content:collect] 提取公式 { count: X }
[content:collect] 提取图片 { count: X }
[content:collect] 质量校验 { pass: true, ... }
[content:collect] 采集成功 { title: "...", len: XXX, ... }
```

### 5. 验证结果
- ✅ Popup 显示「内容采集并保存成功！」
- ✅ 自动打开 Options 页面的「文章管理」
- ✅ 列表中出现新采集的文章
- ✅ 点击「编辑」可以看到 Markdown 内容和图片

## 如果仍然报错

### 错误 1: "Receiving end does not exist"
**可能原因**：
- 扩展没有刷新，仍在使用旧版本
- 页面打开时间早于扩展安装/刷新，需要刷新页面

**解决方法**：
1. 刷新扩展：chrome://extensions → 刷新
2. 刷新测试页面：F5 或 Ctrl+R
3. 重新打开扩展 Popup
4. 点击采集

### 错误 2: Content script 未注入
**可能原因**：
- manifest.json 中的 matches 不包含当前网站
- 页面是特殊页面（chrome://、about:、file://）

**解决方法**：
1. 检查 manifest.json：
   ```json
   "content_scripts": [{
     "matches": [
       "http://*/*",
       "https://*/*"
     ]
   }]
   ```
2. 确保不在以下页面测试：
   - chrome:// 开头的页面
   - 扩展商店页面
   - about: 开头的页面

### 错误 3: 采集成功但没有图片
**可能原因**：
- 图片是懒加载的，需要先滚动页面
- 图片地址不是标准的 src 属性

**解决方法**：
1. 测试前先滚动页面到底部
2. 查看 Console 日志中的图片数量
3. 检查 `[content:collect] 提取图片 { count: X }`

## 构建文件结构

正确的 dist 目录应包含：
```
dist/
├── manifest.json           ← 生成的清单文件
├── background.js          ← Service Worker (ES module)
├── content-scripts.js     ← Content Script (IIFE) ← 关键！
├── assets/
│   ├── popup-xxx.js       ← Popup UI
│   ├── options-xxx.js     ← Options UI
│   └── ...
└── src/
    └── ui/
        ├── popup/index.html
        └── options/index.html
```

## 技术细节

### esbuild 配置说明
```typescript
await build({
  entryPoints: [contentScriptPath],
  bundle: true,              // 打包所有依赖（turndown/readability等）
  format: 'iife',            // IIFE 格式，可直接在页面执行
  globalName: 'ContentScript', // 不会污染全局，仅用于内部命名
  outfile: resolve(distDir, 'content-scripts.js'),
  platform: 'browser',       // 浏览器环境（非 Node.js）
  target: 'es2020',          // 目标语法版本
  minify: false,             // 不压缩，便于调试
});
```

### IIFE vs ES Module
- **IIFE**（立即执行函数表达式）
  ```javascript
  var ContentScript = (() => {
    // 所有代码在闭包中
    return { /* 导出 */ };
  })();
  ```
  - ✅ 可直接执行
  - ✅ 自包含，无外部依赖
  - ✅ 适合 content scripts

- **ES Module**
  ```javascript
  import { something } from './module.js';
  export default something;
  ```
  - ❌ 需要模块加载器
  - ❌ 依赖外部文件
  - ❌ 不适合 content scripts

## 后续优化
如果采集功能正常，可以考虑：
1. 启用压缩：`minify: true`
2. 优化文件大小：tree-shaking
3. 添加 source map：`sourcemap: true`
