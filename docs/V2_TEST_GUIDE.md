# v2.0 集成测试指南

## ✅ 已完成集成

v2.0 处理器已成功集成到 background service！

### 更新内容

- ✅ `apps/extension/src/background/index.ts` 已更新
- ✅ 导入 `content-processor-v2.ts`
- ✅ `saveCollectedPost` 函数现在自动使用 v2.0 增强
- ✅ 向后兼容：v2.0 失败会自动降级到 v1.0
- ✅ 构建成功，无错误

### 工作流程

```
用户点击「采集」
    ↓
Content Script (v1.0)
    - Readability 提取
    - Turndown 转换
    - 公式/图片提取
    ↓
发送消息到 Background
    ↓
Background (自动 v2.0 增强) 🚀
    - 检测到 body_html
    - 使用 unified 管道重新解析
    - 生成多平台适配版本
    - 下载图片资产
    - 保存 AST 和适配内容
    ↓
存储到 IndexedDB
    - version: 2 (v2.0 增强)
    - meta.v2.ast
    - meta.v2.adaptedContent
```

## 🚀 立即测试

### 1. 刷新扩展

```
1. 打开 chrome://extensions
2. 找到 SyncCaster
3. 点击「刷新」按钮 🔄
```

### 2. 测试采集

```
1. 打开任意技术文章页面（例如掘金/CSDN/知乎）
2. 点击 SyncCaster 扩展图标
3. 点击「采集当前页面」
4. 等待采集完成（会看到通知）
5. 打开「文章管理」查看结果
```

### 3. 查看 v2.0 增强效果

#### 在 Console 中查看

打开扩展的 Background Service Worker Console：

```
chrome://extensions → SyncCaster → Service Worker → 检查视图

查找日志：
[v2] Processing content with v2.0 pipeline
[v2] v2.0 processing successful { imageCount: X, formulaCount: Y, platforms: 4 }
[db] Post saved { version: 2, v2Enhanced: true }
```

#### 在 IndexedDB 中查看

```
1. 打开 chrome://extensions
2. 点击 SyncCaster 的 Service Worker「检查视图」
3. 切换到 Application 标签
4. 左侧 Storage → IndexedDB → synccaster → posts
5. 查看最新的文章记录
```

你会看到：

```json
{
  "id": "...",
  "version": 2,  // ⭐ v2.0 标记
  "title": "...",
  "body_md": "...",  // v2.0 生成的 Markdown
  "meta": {
    "v2": {  // ⭐ v2.0 增强数据
      "ast": { ... },  // 统一 AST
      "manifest": {
        "images": [...],  // 增强的图片信息
        "formulas": [...]  // 公式列表
      },
      "adaptedContent": {
        "juejin": { format: "markdown", content: "..." },
        "csdn": { format: "markdown", content: "..." },
        "zhihu": { format: "markdown", content: "..." },
        "wechat": { format: "html", content: "..." }
      },
      "metadata": {
        "wordCount": 1234,
        "imageCount": 5,
        "formulaCount": 3
      }
    }
  }
}
```

## 📊 对比测试

### v1.0 vs v2.0

找一篇**包含公式和图片**的文章测试：

| 特征 | v1.0 | v2.0 |
|------|------|------|
| `version` 字段 | 1 | 2 |
| `meta.v2` | 不存在 | 存在 |
| 适配内容 | 无 | 4 个平台 |
| AST | 无 | 完整 MDAST |
| 图片下载 | 否 | 是 |
| 公式解析 | 基础 | 增强（4种引擎） |

## 🔍 日志查看

### Background Console

```javascript
// 打开 Service Worker 检查视图
chrome://extensions → SyncCaster → Service Worker

// 你会看到的日志：
[background] message: Received message: SAVE_POST
[background] v2: Processing content with v2.0 pipeline
[background] v2-progress: parsing: 20%
[background] v2-progress: converting: 40%
[background] v2-progress: downloading: 50%
[background] v2-progress: downloading: 80%
[background] v2-progress: adapting: 80%
[background] v2-progress: complete: 100%
[background] v2: v2.0 processing successful {
  imageCount: 5,
  formulaCount: 3,
  platforms: 4
}
[background] db: Post saved {
  id: "...",
  version: 2,
  len: 2345,
  images: 5,
  v2Enhanced: true
}
```

### 如果 v2.0 失败

```javascript
[background] v2: v2.0 processing failed, falling back to v1.0 { error: "..." }
[background] db: Post saved {
  version: 1,  // ⭐ 降级到 v1.0
  v2Enhanced: false
}
```

## 🎯 验证 v2.0 特性

### 1. 多平台适配

```javascript
// 在 Options 页面 Console
const posts = await db.posts.toArray();
const latestPost = posts[posts.length - 1];

// 查看适配内容
console.log(latestPost.meta.v2.adaptedContent);

// 输出：
// {
//   juejin: { format: 'markdown', content: '# Title\n\n$x^2$' },
//   csdn: { format: 'markdown', content: '# Title\n\n$x^2$' },
//   zhihu: { format: 'markdown', content: '# Title\n\n![公式](...)' },
//   wechat: { format: 'html', content: '<h1>Title</h1>...' }
// }
```

### 2. 公式识别

```javascript
const formulas = latestPost.meta.v2.manifest.formulas;
console.log('找到公式:', formulas.length);
console.log('公式详情:', formulas);

// 输出：
// [
//   { id: 'formula-0', latex: 'x^2', display: false, engine: 'katex' },
//   { id: 'formula-1', latex: '\\frac{a}{b}', display: true, engine: 'mathjax3' }
// ]
```

### 3. 图片资产

```javascript
const images = latestPost.meta.v2.manifest.images;
console.log('图片数量:', images.length);
console.log('下载状态:', images.filter(i => i.status === 'ready').length);

// 查看是否有 localBlob
const downloadedImages = images.filter(i => i.localBlob);
console.log('已下载到本地:', downloadedImages.length);
```

## 🐛 故障排查

### 问题 1: v2.0 总是失败

**检查**:
```javascript
// Background Console
// 查找错误日志
[background] v2: v2.0 processing failed, falling back to v1.0
```

**可能原因**:
- `body_html` 为空
- unified 解析错误
- 内存不足

**解决**:
```javascript
// 查看采集数据
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SAVE_POST') {
    console.log('body_html length:', msg.data.body_html?.length);
  }
});
```

### 问题 2: 图片下载失败

**检查**:
```javascript
const failedImages = latestPost.meta.v2.manifest.images
  .filter(i => i.status === 'failed');
console.log('下载失败:', failedImages);
```

**可能原因**:
- CORS 限制
- 超时
- URL 无效

### 问题 3: 看不到 v2.0 数据

**检查**:
```javascript
const post = await db.posts.get('your-post-id');
console.log('Version:', post.version);
console.log('Has v2:', !!post.meta?.v2);

// 如果 version === 1 且没有 meta.v2
// 说明 v2.0 处理失败或未启用
```

## 📈 性能监控

### 测试处理时间

```javascript
// 在 background/index.ts 的 saveCollectedPost 函数开头添加：
const startTime = Date.now();

// 在 v2.0 处理完成后：
logger.info('v2-perf', 'Processing time', {
  total: Date.now() - startTime,
  enhanced: !!v2Enhanced
});
```

### 预期性能

| 操作 | v1.0 | v2.0 | 说明 |
|------|------|------|------|
| 采集 | ~200ms | ~200ms | 相同（content script） |
| 保存 | ~50ms | ~300ms | v2.0 额外处理 |
| **总计** | **~250ms** | **~500ms** | 可接受 |

## 🎉 成功标志

如果你看到以下内容，说明 v2.0 工作正常：

✅ Background Console 有 `[v2] v2.0 processing successful` 日志
✅ 文章的 `version` 字段为 `2`
✅ `meta.v2` 包含完整数据
✅ `adaptedContent` 包含 4 个平台的适配版本
✅ 图片有 `localBlob` 或 `proxyUrl`
✅ 公式被正确识别和分类

## 🚀 下一步

现在 v2.0 已经在后台默默工作了！

你可以：

1. **立即测试** - 采集几篇不同类型的文章
2. **查看数据** - 检查 IndexedDB 中的 v2.0 增强数据
3. **编辑器集成** - 在编辑器中展示多平台预览
4. **发布测试** - 使用适配后的内容发布到各平台

v2.0 的强大之处在于它**透明地增强了内容**，用户无需任何改变就能享受到：
- 更准确的内容提取
- 智能的平台适配
- 完整的资产管理
- 可扩展的架构

享受全新的 v2.0 体验！🎊
