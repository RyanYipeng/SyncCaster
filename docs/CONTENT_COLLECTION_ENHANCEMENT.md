# 文章采集内容识别优化方案

## 问题背景

当前插件在采集文章时，正文文本整体可正常获取，但存在以下问题：

1. **Mermaid 图识别失败**：原始文章中的 Mermaid 语法流程图/结构图被错误转换为普通段落文本
2. **富文本样式丢失**：斜体（Italic）和删除线（Strikethrough）无法被正确识别与保留
3. **任务列表识别错误**：Markdown Task List（如 `- [ ]`、`- [x]`）被误判为普通列表

## 优化方案

### 1. DOM 白名单标签扩展

在 `collector-utils.ts` 的 `WHITELIST_TAGS` 中添加：

```typescript
// 删除线标签
'del', 's', 'strike',
// 上下标
'sub', 'sup',
// SVG（用于 Mermaid 图）
'svg',
// 任务列表相关
'input',
```

### 2. 类名和属性保留

更新 `cleanDOMWithWhitelist` 函数，保留相关的类名和属性：

```typescript
// 保留的类名
c === 'mermaid' || c.includes('mermaid') ||
c === 'task-list-item' || c === 'task-list' || c.includes('checkbox') || c.includes('todo')

// 保留的属性
'data-mermaid', 'data-mermaid-source', 'data-source', 'data-sync-mermaid', 'data-diagram-type',
'type', 'checked', 'disabled', 'data-task', 'data-checked'
```

### 3. Mermaid 预处理

在 `collector-utils.ts` 中实现 `normalizeMermaidInDom` 函数：

- 检测 `.mermaid` 类容器
- 检测 `data-mermaid` 属性元素
- 检测平台特定容器（掘金、CSDN 等）
- 检测 Mermaid SVG
- 将检测到的 Mermaid 图转换为 `<pre><code class="language-mermaid">` 格式
- **优先从 data 属性提取源码**，保留原始换行和格式
- 无法获取源码时返回 null，避免生成错误的代码块

### 4. 任务列表预处理

在 `collector-utils.ts` 中实现 `normalizeTaskListInDom` 函数：

- 处理标准的 checkbox input
- 处理 GitHub 风格的任务列表（`class="task-list-item"`）
- 处理自定义任务列表格式（`data-task`、`.todo-item` 等）
- 处理文本形式的任务标记（`[ ]` 或 `[x]` 开头）
- 统一标记为 `data-task="true"` 和 `data-checked="true/false"`

### 5. Turndown 规则增强

在 `index.ts` 中添加以下 Turndown 规则：

#### Mermaid 图规则
```typescript
td.addRule('mermaid-block', {
  filter: (node) => {
    // 检测 data-sync-mermaid、language-mermaid、.mermaid
  },
  replacement: (content, node) => {
    // 优先从 data 属性获取源码，保留原始格式
    return '\n\n```mermaid\n' + code.trim() + '\n```\n\n';
  },
});
```

#### 任务列表规则
```typescript
td.addRule('taskListItem', {
  filter: (node) => {
    // 检测 checkbox input、task-list-item 类、data-task 属性
  },
  replacement: (content, node) => {
    const isChecked = /* 检测勾选状态 */;
    const marker = isChecked ? '[x]' : '[ ]';
    return '- ' + marker + ' ' + content + '\n';
  },
});
```

#### 删除线规则
```typescript
td.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: (content) => '~~' + content + '~~',
});
```

#### 斜体规则
```typescript
td.addRule('emphasis', {
  filter: (node) => {
    // 匹配 em、i 标签
    // 匹配带有斜体样式的 span（style="font-style: italic"）
    // 匹配 .italic、.em 类名
  },
  replacement: (content) => '_' + content.trim() + '_',
});
```

### 6. 采集流程更新

在 `collectContent` 函数中：

1. 在 `cleanDOMWithWhitelist` 之前调用 `normalizeMermaidInDom`
2. 在 `cleanDOMWithWhitelist` 之前调用 `normalizeTaskListInDom`
3. 调用 `extractMermaidBlocks` 提取 Mermaid 图信息
4. 在返回数据中包含 `mermaid` 和 `mermaidCount` 字段

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/extension/src/content-scripts/collector-utils.ts` | 修改 | 添加白名单标签，添加 Mermaid/任务列表预处理函数 |
| `apps/extension/src/content-scripts/index.ts` | 修改 | 添加 Turndown 规则，更新采集流程 |
| `packages/core/src/ast/canonical-ast.ts` | 修改 | 新增 MermaidBlockNode 类型（AST 层支持） |
| `packages/core/src/ast/dom-to-ast.ts` | 修改 | 添加 Mermaid 检测逻辑（AST 层支持） |
| `packages/core/src/ast/ast-serializer.ts` | 修改 | 支持 Mermaid 节点序列化（AST 层支持） |
| `packages/core/src/collector/platform-rules.ts` | 修改 | 添加 Mermaid 平台配置 |

## 兼容性说明

- 不影响现有已正常工作的内容采集能力
- 采集过程对用户无感知
- 向后兼容：旧版数据仍可正常处理

## 测试验证

修改后需要在以下场景验证：

1. **删除线文本**：包含 `<del>`、`<s>`、`<strike>` 标签的文章 ✅
2. **斜体文本**：包含 `<em>`、`<i>` 标签的文章，以及带有 `font-style: italic` 样式的 span
3. **Mermaid 图**：
   - 代码块形式：` ```mermaid `
   - 渲染后形式：`.mermaid` 容器
   - 平台特定形式：掘金、CSDN 等平台的 Mermaid 容器
   - 验证源码换行和格式是否保留
4. **任务列表**：
   - 标准 checkbox：`<input type="checkbox">`
   - GitHub 风格：`class="task-list-item"`
   - 文本形式：`- [ ]` 或 `- [x]`
   - 验证勾选状态是否正确保留

## 降级策略

对于无法准确识别的内容：

1. **Mermaid 图**：如果无法从 data 属性获取源码，且 SVG 内容无法解析，则跳过该元素（不生成错误的代码块）
2. **任务列表**：如果无法确定是否为任务列表，保持为普通列表项
3. **斜体文本**：如果无法确定是否为斜体，保持原始文本
