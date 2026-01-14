<div align="center">

# <img src="apps/extension/public/assets/icon-128.png" alt="SyncCaster" width="36" align="absmiddle" /> SyncCaster：多平台文章同步助手

_**一次编辑，处处发布 —— 多平台内容同步 Chrome 扩展**_

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome&logoColor=white)](#)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](#)

</div>

SyncCaster 是一个浏览器扩展，帮助内容创作者将文章一键同步到多个博客平台。

> 🔒 本扩展完全本地运行，不收集、不存储任何用户信息。**如需添加更多平台或改善同步准确度，欢迎提 Issue 或 PR**。

## ✨ 特性

- 📝 内置 Markdown 编辑器，支持实时预览
- 🔍 智能采集任意网页文章内容
- 🚀 一键同步到 17+ 主流博客平台
- 🔐 自动检测各平台登录状态
- 📁 同步的标签页自动归入分组，便于管理
- 🎨 微信公众号同步时完整保留渲染样式
- 🧮 支持 LaTeX 数学公式渲染

## 🌐 已支持的平台

| 平台 | Markdown | LaTeX | 备注 |
|:----:|:--------:|:-----:|:-----|
| 掘金 | ✅ | ✅ | |
| CSDN | ✅ | ✅ | |
| 博客园 | ✅ | ✅ | 需开启数学公式支持 |
| 51CTO | ✅ | ✅ | |
| 腾讯云 | ✅ | ✅ | |
| 知乎 | ✅ | ✅ | 富文本编辑器 |
| 简书 | ✅ | ✅ | |
| 阿里云 | ✅ | ✅ | |
| 思否 | ✅ | ✅ | |
| 哔哩哔哩 | ✅ | ✅ | |
| 微信公众号 | ✅ | ✅ | 富文本编辑器，支持主题样式 |
| 开源中国 | ✅ | ✅ | |
| 今日头条 | ✅ | ✅ | 富文本编辑器 |
| InfoQ | ✅ | ✅ | |
| 百家号 | ✅ | ✅ | 富文本编辑器 |
| 网易号 | ✅ | ✅ | 富文本编辑器 |
| Medium | ✅ | ✅ | 英文平台 |

## 🛠️ 技术栈

- **前端框架**: Vue 3 + TypeScript
- **构建工具**: Vite + pnpm (monorepo)
- **UI 框架**: Naive UI + UnoCSS
- **数据存储**: IndexedDB (Dexie.js)
- **Markdown**: marked + highlight.js + KaTeX + Mermaid
- **扩展 API**: Chrome Extension Manifest V3

## ⚙️ 核心功能

### 1. 内容采集
- 从任意网页采集文章内容
- 智能提取标题、正文、图片、公式
- 基于 AST 的规范化处理（CanonicalAST）
- 转换为统一的 Markdown 格式
![alt text](docs/SyncCaster小窗.png)

### 2. Markdown 编辑器
- 内置功能完整的 Markdown 编辑器
- 实时预览，支持代码高亮
- LaTeX 数学公式渲染（KaTeX）
- Mermaid 图表支持
- 多种主题样式
![alt text](docs/SyncCaster文章编辑页.png)

### 3. 多平台发布
- 支持 17+ 主流博客平台
- DOM 自动化模拟人工发布
- 统一的适配器接口
- 智能图片处理和上传
![alt text](docs/SyncCaster主页.png)

### 4. 账号管理
- 自动检测平台登录状态
- Cookie 过期预警
- 一键刷新账号状态
- 支持重新登录
![alt text](docs/SyncCaster账号管理页.png)

### 5. 任务管理
- 发布任务队列
- 实时进度跟踪
- 详细日志记录
- 失败重试机制
![alt text](docs/SyncCaster任务中心页.png)

## 📁 项目结构

```
SyncCaster/
├── apps/
│   └── extension/              # Chrome 扩展应用
│       ├── src/
│       │   ├── background/     # Service Worker（后台脚本）
│       │   │   ├── index.ts              # 消息处理、任务调度
│       │   │   ├── account-service.ts    # 账号管理服务
│       │   │   ├── platform-api.ts       # 平台 API 调用
│       │   │   ├── publish-engine.ts     # 发布引擎核心
│       │   │   ├── publish-progress.ts   # 发布进度管理
│       │   │   ├── tab-group-manager.ts  # 标签页分组管理
│       │   │   ├── wechat-md-publish.ts  # 微信公众号发布
│       │   │   └── inpage-runner.ts      # 站内脚本执行器
│       │   ├── content-scripts/          # 内容脚本（页面注入）
│       │   │   ├── index.ts              # 入口
│       │   │   ├── auth-detector.ts      # 登录状态检测
│       │   │   ├── canonical-collector.ts # 内容采集器
│       │   │   └── collector-utils.ts    # 采集工具函数
│       │   └── ui/                       # 用户界面
│       │       ├── popup/                # 弹出窗口
│       │       ├── sidepanel/            # 侧边栏
│       │       └── options/              # 设置页面（主界面）
│       │           ├── views/            # 页面视图
│       │           │   ├── Dashboard.vue # 仪表盘
│       │           │   ├── Editor.vue    # Markdown 编辑器
│       │           │   ├── Posts.vue     # 文章管理
│       │           │   ├── Accounts.vue  # 账号管理
│       │           │   └── Tasks.vue     # 任务管理
│       │           └── components/       # 组件
│       ├── public/
│       │   └── md-editor/      # 内嵌 Markdown 编辑器
│       └── dist/               # 构建输出
├── packages/
│   ├── adapters/               # 平台适配器
│   │   └── src/
│   │       ├── base-adapter.ts # 适配器基类
│   │       ├── juejin.ts       # 掘金
│   │       ├── csdn.ts         # CSDN
│   │       ├── zhihu.ts        # 知乎
│   │       ├── jianshu.ts      # 简书
│   │       ├── cnblogs.ts      # 博客园
│   │       ├── wechat.ts       # 微信公众号
│   │       ├── 51cto.ts        # 51CTO
│   │       ├── tencent-cloud.ts # 腾讯云
│   │       ├── aliyun.ts       # 阿里云
│   │       ├── segmentfault.ts # 思否
│   │       ├── bilibili.ts     # 哔哩哔哩
│   │       ├── oschina.ts      # 开源中国
│   │       ├── toutiao.ts      # 今日头条
│   │       ├── infoq.ts        # InfoQ
│   │       ├── baijiahao.ts    # 百家号
│   │       ├── wangyihao.ts    # 网易号
│   │       ├── medium.ts       # Medium
│   │       └── index.ts        # 适配器注册
│   ├── core/                   # 核心模块
│   │   └── src/
│   │       ├── types/          # TypeScript 类型定义
│   │       ├── db/             # IndexedDB 数据库（Dexie）
│   │       ├── ast/            # AST 处理（DOM → 规范化）
│   │       │   ├── canonical-ast.ts   # 规范化 AST 定义
│   │       │   ├── dom-to-ast.ts      # DOM 转 AST
│   │       │   ├── ast-transformer.ts # AST 转换器
│   │       │   ├── ast-serializer.ts  # AST 序列化
│   │       │   └── pipeline.ts        # 处理管道
│   │       ├── collector/      # 内容采集
│   │       │   ├── canonical-collector.ts # 规范化采集器
│   │       │   └── platform-rules.ts      # 平台规则
│   │       ├── renderer/       # Markdown 渲染
│   │       │   └── mdh-core.ts # MDH 渲染核心
│   │       ├── wechat/         # 微信公众号专用
│   │       │   ├── wechat-formatter.ts # 格式化器
│   │       │   ├── renderer.ts         # 渲染器
│   │       │   └── themes.ts           # 主题样式
│   │       ├── assets/         # 资源处理
│   │       │   ├── image-pipeline.ts   # 图片处理管道
│   │       │   └── platform-strategies.ts # 平台策略
│   │       └── storage/        # 存储桥接
│   │           └── chrome-storage-bridge.ts
│   └── utils/                  # 工具函数
├── md/                         # Markdown 编辑器子项目
│   └── apps/web/               # Web 编辑器应用
├── docs/                       # 项目文档
│   ├── WECHAT_PUBLISH_FLOW.md  # 微信发布流程
│   ├── WECHAT_FORMATTER.md     # 微信格式化器
│   ├── CROSS_PLATFORM_PUBLISH.md # 跨平台发布
│   ├── CANONICAL_AST_UPGRADE.md  # AST 升级说明
│   ├── LOGIN_STATE_MANAGEMENT.md # 登录状态管理
│   └── ...
└── scripts/                    # 构建脚本
```

## 🔌 适配器架构

### 适配器接口

```typescript
interface PlatformAdapter {
  id: PlatformId;           // 平台标识
  name: string;             // 平台名称
  kind: 'dom' | 'api';      // 适配器类型
  capabilities: {           // 平台能力
    supportsMarkdown: boolean;
    supportsHtml: boolean;
    supportsTags: boolean;
    supportsLatex: boolean;
    // ...
  };
  
  ensureAuth(ctx): Promise<AuthSession>;     // 认证检查
  transform(post, ctx): Promise<Payload>;    // 内容转换
  publish(payload, ctx): Promise<Result>;    // 发布
  
  dom?: {                   // DOM 自动化配置
    matchers: string[];     // 匹配的 URL 模式
    fillAndPublish(payload): Promise<Result>;
  };
}
```

### 发布流程

```
1. 用户选择文章和目标平台
2. 创建发布任务（Job）
3. 对每个目标平台：
   a. 获取适配器
   b. 检查认证状态
   c. 转换内容格式（Markdown/HTML）
   d. 处理图片资源
   e. 执行发布：
      - DOM 模式：打开目标页面，执行 fillAndPublish
      - API 模式：直接调用平台 API
   f. 记录结果
4. 更新任务状态
5. 标签页自动归入分组
```

## 📊 数据模型

### CanonicalPost（统一内容模型）

```typescript
interface CanonicalPost {
  id: string;
  title: string;
  body_md: string;      // Markdown 正文
  summary?: string;
  cover?: AssetRef;
  tags?: string[];
  categories?: string[];
  assets?: AssetRef[];  // 图片等资源
  formulas?: MathNode[]; // 提取的公式
}
```

### Account（账号模型）

```typescript
interface Account {
  id: string;
  platform: PlatformId;
  nickname: string;
  avatar?: string;
  status: 'active' | 'expired';
  cookieExpiresAt?: number;
  lastError?: string;
}
```

### Job（发布任务）

```typescript
interface Job {
  id: string;
  postId: string;
  targets: PublishTarget[];
  state: 'PENDING' | 'RUNNING' | 'PAUSED' | 'FAILED' | 'DONE';
  progress: number;
  logs: LogEntry[];
}
```
## 🚀 快速开始

```bash
# 克隆仓库
git clone git@github.com:RyanYipeng/SyncCaster.git
cd SyncCaster

# 安装依赖
pnpm install

# 构建扩展
pnpm build
```

#### 加载本地扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `apps/extension/dist` 目录

#### 开发者命令

```bash
pnpm dev    # 开发模式（热更新）
pnpm test   # 运行测试
```

## 📖 开发指南

### 添加新适配器

1. 在 `packages/adapters/src/` 创建新文件
2. 继承 `BaseAdapter` 或实现 `PlatformAdapter` 接口
3. 在 `index.ts` 中导出并注册
4. 在 `packages/core/src/types/platforms.ts` 添加平台 ID

```typescript
// newplatform.ts
import { BaseAdapter } from './base-adapter';

export class NewPlatformAdapter extends BaseAdapter {
  id = 'newplatform' as const;
  name = '新平台';
  
  dom = {
    matchers: ['https://newplatform.com/editor*'],
    async fillAndPublish(payload) {
      // 实现 DOM 自动化逻辑
    },
  };
}
```

### 调试技巧

1. **查看后台日志**: 右键扩展图标 → 检查 Service Worker
2. **查看页面日志**: 在目标平台页面打开开发者工具
3. **调试模式**: 修改 `publish-engine.ts` 中的 `closeTab: false` 保持标签页打开

## 📚 相关文档

- [微信公众号发布流程](./docs/WECHAT_PUBLISH_FLOW.md)
- [微信格式化器](./docs/WECHAT_FORMATTER.md)
- [跨平台发布](./docs/CROSS_PLATFORM_PUBLISH.md)
- [规范化 AST 升级](./docs/CANONICAL_AST_UPGRADE.md)

## 🙏 致谢
感谢下面的开源项目：
- [md](https://github.com/doocs/md)

## ⭐ Star History
[![Star History Chart](https://api.star-history.com/svg?repos=RyanYipeng/SyncCaster&type=date&legend=top-left)](https://www.star-history.com/#RyanYipeng/SyncCaster&type=date&legend=top-left)

## 📄 License

本项目基于 [MIT 许可证](./LICENSE) 开源。


如有问题或建议，欢迎提交 [Issue](https://github.com/RyanYipeng/SyncCaster/issues) 或 [Pull Request](https://github.com/RyanYipeng/SyncCaster/pulls)。
