# 微信公众号发文流程

## 概述

微信公众号发文采用 MD 编辑器整合方案，通过微信官方 `__MP_Editor_JSAPI__` API 实现内容填充，确保格式完整保留。

## 发文流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SyncCaster    │     │   MD 编辑器     │     │  微信公众号     │
│     插件        │────▶│   (预览排版)    │────▶│   编辑器        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
   1. 保存文章到              2. 用户预览              3. 自动填充
   Chrome Storage              调整排版                标题+正文
```

### 详细步骤

1. **用户在插件中点击「发布到微信公众号」**
   - 插件将文章内容（Markdown）保存到 Chrome Storage
   - 跳转到 MD 编辑器页面

2. **用户在 MD 编辑器中预览排版**
   - MD 编辑器自动加载 Chrome Storage 中的文章
   - 用户可以调整主题、字体、颜色等排版选项
   - 实时预览公众号排版效果

3. **用户点击「发布到微信」按钮**
   - 检查是否有微信公众号编辑器标签页
   - 如果没有，提示用户先打开微信公众号后台
   - 如果有，发送内容到编辑器

4. **自动填充内容**
   - 使用微信官方 `mp_editor_set_content` API 设置正文
   - 使用 DOM 操作设置标题（API 不支持标题）
   - 格式完整保留，与手动复制粘贴效果一致

5. **用户手动发布**
   - 检查排版效果
   - 手动点击发布按钮

## 微信官方 API

### mp_editor_get_isready

获取编辑器状态。

```javascript
window.__MP_Editor_JSAPI__.invoke({
  apiName: 'mp_editor_get_isready',
  sucCb: (res) => {
    // res = { isReady: true, isNew: true }
    // isReady: 编辑器是否初始化完毕
    // isNew: 是否为新编辑器（只有 isNew=true 时才能调用 set_content/insert_html）
  },
  errCb: (err) => console.error(err)
});
```

### mp_editor_set_content

设置全文内容（需要 `isNew=true`）。

```javascript
window.__MP_Editor_JSAPI__.invoke({
  apiName: 'mp_editor_set_content',
  apiParam: {
    content: '<div>富文本内容</div>'
  },
  sucCb: (res) => console.log('设置成功', res),
  errCb: (err) => console.error('设置失败', err)
});
```

### mp_editor_insert_html

插入内容（需要 `isNew=true`）。

```javascript
window.__MP_Editor_JSAPI__.invoke({
  apiName: 'mp_editor_insert_html',
  apiParam: {
    html: '<div>要插入的内容</div>',
    isSelect: false  // 是否选中插入的内容
  },
  sucCb: (res) => console.log('插入成功', res),
  errCb: (err) => console.error('插入失败', err)
});
```

## 降级方案

当官方 API 不可用时，按以下顺序尝试：

1. **ProseMirror 编辑器**（微信新编辑器）
   - 查找 `.ProseMirror` 元素
   - 设置 `innerHTML`

2. **UEditor iframe**（微信旧编辑器）
   - 查找 `#ueditor_0 iframe`
   - 设置 `iframe.contentDocument.body.innerHTML`

3. **contenteditable 元素**
   - 查找 `[contenteditable="true"]`
   - 设置 `innerHTML`

4. **剪贴板**（最后方案）
   - 复制内容到剪贴板
   - 提示用户手动粘贴

## 相关文件

- `md/apps/web/src/entrypoints/injected.ts` - 注入脚本，调用官方 API
- `md/apps/web/src/entrypoints/appmsg.content.ts` - Content Script，转发消息
- `md/apps/web/src/utils/wechat-publish.ts` - 发布工具函数
- `md/apps/web/src/components/editor/editor-header/index.vue` - 发布按钮
- `packages/adapters/src/wechat.ts` - 微信适配器

## 注意事项

1. **isNew 字段**：只有 `isNew=true` 时才能调用 `mp_editor_set_content` 和 `mp_editor_insert_html`
2. **标题填充**：官方 API 不支持设置标题，需要使用 DOM 操作
3. **编辑器迁移**：微信正在从 UEditor 迁移到 ProseMirror，需要同时支持两种编辑器
4. **自动化范围**：不执行最终的发布操作，由用户手动完成
