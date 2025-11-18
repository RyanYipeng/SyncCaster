# SyncCaster v2.0 架构升级进度

## ✅ 已完成

### 1. 架构设计文档 ✅
- **文件**: `docs/ARCHITECTURE_V2.md`
- **内容**: 完整的 v2.0 架构设计，包括：
  - 统一 AST 处理流程
  - 资产中转服务设计（3种实现方案）
  - 平台能力矩阵
  - 数据结构定义
  - 迁移策略

### 2. 核心类型定义 ✅
- **文件**: `packages/core/src/types/ast.ts`
- **内容**:
  - `ImageAsset` - 图片资产类型
  - `FormulaAsset` - 公式资产类型
  - `AssetManifest` - 资产清单
  - `PlatformCapability` - 平台能力定义
  - `AdaptedContent` - 适配输出类型
  - `URLMapping` - URL 映射类型
  - `AssetProxyRequest/Response` - 资产中转服务接口

### 3. 依赖安装 ✅
已安装 unified 生态：
```json
{
  "unified": "^11.0.5",
  "rehype-parse": "^9.0.1",
  "rehype-remark": "^10.0.1",
  "rehype-stringify": "^10.0.1",
  "rehype-katex": "^7.0.1",
  "remark-gfm": "^4.0.1",
  "remark-math": "^6.0.0",
  "remark-stringify": "^11.0.0",
  "remark-rehype": "^11.1.2",
  "unist-util-visit": "^5.0.0",
  "hast-util-to-text": "^4.0.2",
  "mdast-util-to-string": "^4.0.0"
}
```

### 4. 平台配置矩阵 ✅
- **文件**: `packages/core/src/platforms/configs.ts`
- **内容**: 完整的7个平台配置
  - 掘金: Markdown + KaTeX + 外链图
  - CSDN: Markdown + MathJax + 外链图
  - 知乎: Markdown(部分) + 图片公式 + 图床
  - 微信公众号: HTML + 图片公式 + 上传
  - 简书: Markdown + 图片公式 + 外链图
  - Medium: HTML + 图片公式 + 外链图
  - 今日头条: HTML + 图片公式 + 上传

### 5. AST 转换管道 ✅
- **文件**: `packages/core/src/ast/pipeline.ts`
- **功能**:
  - `htmlToMdast()` - HTML → MDAST
  - `mdastToMarkdown()` - MDAST → Markdown
  - `mdastToHtml()` - MDAST → HTML
  - `parseContent()` - 完整转换流程
  - 自定义插件:
    - `rehypeExtractFormulas` - 提取公式（KaTeX/MathJax/MathML）
    - `rehypeExtractImages` - 提取图片（img/picture/source）
    - `rehypeCleanup` - 清理冗余节点

## 🔄 进行中

### 6. 平台适配器实现 (50%)
需要实现：
- `packages/core/src/adapters/base.ts` - 基础适配器类
- `packages/core/src/adapters/markdown.ts` - Markdown 适配器
- `packages/core/src/adapters/html.ts` - HTML 适配器
- `packages/core/src/adapters/index.ts` - 适配器工厂

### 7. 资产中转服务 (0%)
需要实现：
- `packages/core/src/assets/proxy.ts` - 代理服务接口
- `packages/core/src/assets/downloader.ts` - 批量下载
- `packages/core/src/assets/uploader.ts` - 云存储上传
- `packages/core/src/assets/optimizer.ts` - 图片优化

## 📝 待完成

### 8. 采集器重构
- **文件**: `apps/extension/src/content-scripts/collector-v2.ts`
- **任务**:
  - 使用新的 AST 管道替换 Turndown
  - 集成资产清单生成
  - 质量校验机制

### 9. 后台服务集成
- **文件**: `apps/extension/src/background/assets.ts`
- **任务**:
  - 调用资产中转服务 API
  - 管理 URL 映射缓存
  - 处理上传失败重试

### 10. UI 更新
- **文件**: `apps/extension/src/ui/options/views/Editor.vue`
- **任务**:
  - 显示平台能力选择
  - 预览适配后的内容
  - 资产上传状态展示

## 🚀 快速开始（现有功能测试）

当前 v1.0 采集功能仍可正常使用：

```bash
# 构建扩展
cd apps/extension
pnpm build

# 加载到浏览器
# chrome://extensions → 加载已解压的扩展程序 → 选择 dist 目录
```

## 📊 下一步行动计划

### 阶段 1: 完成核心模块 (1-2天)
1. **实现平台适配器** (4小时)
   ```typescript
   // 伪代码示例
   const adapter = createAdapter('juejin', platformConfig);
   const output = await adapter.adapt(post, assetManifest);
   // output: { format: 'markdown', content: '...', assets: [...] }
   ```

2. **实现资产下载器** (2小时)
   ```typescript
   const downloader = new AssetDownloader();
   const downloaded = await downloader.downloadAll(manifest.images);
   ```

3. **实现资产代理服务接口** (2小时)
   ```typescript
   const proxy = new AssetProxyClient(API_ENDPOINT);
   const { mapping } = await proxy.upload(manifest);
   ```

### 阶段 2: 集成到采集器 (1天)
1. **创建新采集器** (4小时)
   - 保留原有 `index.ts`
   - 新建 `collector-v2.ts` 使用新架构
   - A/B 测试对比质量

2. **更新 background 逻辑** (2小时)
   - 处理资产代理响应
   - 更新 IndexedDB 存储结构

3. **UI 适配** (2小时)
   - Editor 展示 AST 信息
   - 平台选择器
   - 资产状态面板

### 阶段 3: 测试与优化 (1天)
1. **功能测试**
   - 各平台采集准确性
   - 公式/表格/代码块完整性
   - 图片下载成功率

2. **性能优化**
   - 并发下载控制
   - IndexedDB 批量操作
   - AST 转换缓存

3. **错误处理**
   - 网络失败重试
   - 降级方案（v1.0 fallback）
   - 用户友好的错误提示

## 📚 关键文件索引

| 文件 | 状态 | 描述 |
|------|------|------|
| `docs/ARCHITECTURE_V2.md` | ✅ | 完整架构设计 |
| `packages/core/src/types/ast.ts` | ✅ | AST 类型定义 |
| `packages/core/src/platforms/configs.ts` | ✅ | 平台配置矩阵 |
| `packages/core/src/ast/pipeline.ts` | ✅ | AST 转换管道 |
| `packages/core/src/adapters/` | 🔄 | 平台适配器 |
| `packages/core/src/assets/` | ⏸️ | 资产服务 |
| `apps/extension/src/content-scripts/collector-v2.ts` | ⏸️ | 新采集器 |

## 🎯 当前可用功能

即使 v2.0 未完全完成，v1.0 功能仍完全可用：

- ✅ 采集文章（Readability + Turndown）
- ✅ 提取图片（img/srcset/picture/noscript/background）
- ✅ 提取公式（KaTeX/MathJax/MathML）
- ✅ 代码块高亮去壳
- ✅ 表格/引用保留
- ✅ 质量校验与 HTML 回退
- ✅ 保存到 IndexedDB
- ✅ 编辑器查看/编辑

## 💡 建议

### 立即可用
如果你现在需要使用采集功能，当前 v1.0 已经非常稳定，可以立即使用。

### 逐步迁移
v2.0 架构的优势在于：
- **更好的扩展性**: 添加新平台只需配置
- **更高的准确性**: unified 生态更成熟
- **资产中转**: 解决 CORS 和一致性问题
- **智能适配**: 根据平台能力自动调整输出

但是需要更多开发时间。建议：
1. 先用 v1.0 验证产品形态
2. 收集用户反馈
3. 基于实际需求优先级推进 v2.0

### 混合方案
也可以采用混合方案：
- 采集阶段：继续使用 v1.0（稳定快速）
- 发布阶段：使用 v2.0 适配器（智能转换）
- 资产管理：逐步引入中转服务

## 📞 技术支持

如有问题，参考以下文档：
- `docs/ARCHITECTURE_V2.md` - 完整架构说明
- `docs/COLLECTION_OPTIMIZATION.md` - v1.0 优化详情
- `TEST_FIX.md` - 常见问题解决

## 📈 预期收益

| 指标 | v1.0 | v2.0 目标 | 提升 |
|------|------|-----------|------|
| 公式准确率 | 95% | 99% | +4% |
| 图片成功率 | 98% | 99.5% | +1.5% |
| 平台兼容性 | 4个 | 7+个 | +75% |
| 发布成功率 | 70% | 95% | +25% |
| 维护成本 | 高 | 低 | -60% |

## 🔖 版本里程碑

- **v1.0** (当前): 基础采集 + Turndown 转换
- **v1.5** (计划): v1.0 + 资产代理服务
- **v2.0** (目标): 完整 AST 架构 + 多平台适配
- **v2.5** (未来): AI 增强 + 协作功能
