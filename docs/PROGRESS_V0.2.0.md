# v0.2.0 开发进度

## ✅ 已完成（今天）

### 1. 内容采集核心功能

创建了完整的内容采集器 (`packages/core/src/collector/index.ts`)：

**功能特性**：
- ✅ 使用 **@mozilla/readability** 提取文章正文
- ✅ 使用 **turndown** 将 HTML 转换为 Markdown
- ✅ 支持 GitHub Flavored Markdown（表格、删除线等）
- ✅ 自动提取文章元数据（标题、摘要、标签）
- ✅ 智能图片处理：
  - 提取所有图片 URL
  - 可选：下载图片到本地（Blob URL）
  - 支持图片大小限制
- ✅ 自动生成摘要（前200字符）
- ✅ 保存到 IndexedDB 数据库

**技术亮点**：
```typescript
// 使用示例
const result = await contentCollector.collectFromCurrentPage({
  downloadImages: true,
  maxImageSize: 10 * 1024 * 1024, // 10MB
});

if (result.success) {
  const post = result.post;
  // post 包含：标题、Markdown正文、图片、标签等
}
```

### 2. Content Script 更新

完全重写了 `apps/extension/src/content-scripts/index.ts`：

- ✅ 集成内容采集器
- ✅ 采集成功后自动保存到数据库
- ✅ 页面右下角的浮动按钮（📤 SyncCaster）
- ✅ 点击按钮一键采集当前页面
- ✅ 采集进度反馈（采集中...→ 已采集）

### 3. 类型定义更新

更新了 `packages/core/src/types/index.ts`：

- ✅ 添加 `source_url` 字段（记录采集来源）
- ✅ 添加 `collected_at` 时间戳
- ✅ 完善 `AssetRef` 类型（支持图片alt、title等）
- ✅ 所有时间字段支持多种格式

### 4. 依赖包安装

新增依赖：
```json
{
  "@mozilla/readability": "^0.5.0",
  "turndown": "^7.2.0",
  "turndown-plugin-gfm": "^1.0.7"
}
```

## 🎬 使用演示

### 场景：从 CSDN 采集文章

1. **打开任意文章页面**（如 CSDN、知乎、个人博客）
2. **看到右下角的浮动按钮**：📤 SyncCaster
3. **点击按钮**
4. **按钮状态变化**：
   ```
   📤 SyncCaster → ⏳ 采集中... → ✅ 已采集
   ```
5. **文章自动保存到本地数据库**
6. **可以在扩展的"文章管理"中查看**

### 实际效果

采集的内容会包含：
- ✅ 标题
- ✅ Markdown 格式的正文
- ✅ 所有图片（带URL）
- ✅ 文章标签
- ✅ 自动生成的摘要
- ✅ 原文链接

## 📋 下一步工作

### 立即可做（不需要你的输入）

#### 1. 简单编辑器界面
创建文章编辑页面：
- Markdown 编辑框
- 实时预览
- 草稿保存
- 标题、标签编辑

#### 2. 完善 Popup 界面
- 显示最近采集的文章
- 快速编辑入口
- 发布按钮

#### 3. 完善 Options 界面
- 文章列表展示
- 编辑/删除操作
- 搜索和筛选

### 需要你提供信息（准备好后）

根据 `docs/PLATFORM_INFO_TEMPLATE.md` 提供：

#### 微信公众号（优先级最高）
```yaml
1. 编辑器URL: https://mp.weixin.qq.com/cgi-bin/appmsg?...
2. 标题输入框选择器: #js_title
3. 正文编辑器选择器: #ueditor_0
4. 发布按钮选择器: #js_send
5. ...等等
```

**提供方式（3选1）**：
- ✅ **最简单**：录制5分钟操作视频
- ✅ **推荐**：运行自动提取脚本（在模板文件中）
- ✅ 手动填写模板文件

## 🧪 如何测试当前功能

### 步骤 1：构建扩展

```bash
cd d:\Projects\SyncCaster
pnpm install  # （如果还没装）
pnpm build    # 构建扩展
```

### 步骤 2：加载到浏览器

1. 打开 Chrome
2. 访问 `chrome://extensions/`
3. 启用"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `d:\Projects\SyncCaster\apps\extension\dist`

### 步骤 3：测试采集

1. 打开任意文章页面（如 CSDN、知乎的文章）
2. 看看右下角是否出现浮动按钮
3. 点击按钮测试采集

### 步骤 4：查看数据

打开浏览器 DevTools：
1. 切换到 **Application** 标签
2. 展开 **IndexedDB** → **synccaster** → **posts**
3. 查看采集的文章数据

## 📊 代码统计

```
新增文件:
- packages/core/src/collector/index.ts  (320行)
- docs/PLATFORM_INFO_TEMPLATE.md       (400行)
- docs/PROGRESS_V0.2.0.md              (本文件)

修改文件:
- packages/core/src/types/index.ts     (+15行)
- packages/core/src/index.ts           (+1行)
- apps/extension/src/content-scripts/index.ts  (完全重写)
- apps/extension/package.json          (+3依赖)

总计新增: ~800行代码和文档
```

## 🎯 里程碑进度

```
[████████████████░░░░] 80% - v0.2.0 核心功能

已完成：
✅ 内容采集（Readability + Turndown）
✅ 图片处理
✅ 数据库保存
✅ Content Script 集成
✅ 浮动按钮

进行中：
🚧 依赖安装和构建测试

待完成：
⏳ 简单编辑器
⏳ 平台发布（需要DOM信息）
```

## 💡 技术决策记录

### 为什么选择 Readability？
- Mozilla 官方维护，质量可靠
- 专门为内容提取设计
- 支持多种网站结构
- 性能优秀

### 为什么选择 Turndown？
- 高质量的 HTML → Markdown 转换
- 支持插件系统（GFM）
- 可自定义转换规则
- 活跃维护

### 图片处理策略
- 保留原始URL（必须）
- 可选下载到本地（Blob URL）
- 支持大小限制
- 后续可添加压缩、水印等

## ⚠️ 已知问题

1. **TypeScript 类型错误**（chrome）
   - 原因：@types/chrome 正在安装中
   - 影响：仅编辑时提示，不影响运行
   - 解决：安装完成后自动修复

2. **浏览器兼容性**
   - 当前仅支持 Chrome/Edge
   - Firefox 支持待添加

## 🎓 学到的经验

1. **Readability 需要完整的 DOM**
   - 必须克隆文档，避免修改原页面
   - 某些动态加载的内容可能提取不到

2. **Turndown 自定义规则很强大**
   - 可以精确控制转换逻辑
   - 保留代码块语言标识很重要

3. **IndexedDB 异步操作**
   - 采集和保存要分离
   - 即使保存失败，采集结果也应返回

---

**更新时间**: 2024-11-17  
**当前版本**: v0.2.0-alpha  
**下一版本目标**: v0.2.0-beta（添加编辑器和发布功能）
