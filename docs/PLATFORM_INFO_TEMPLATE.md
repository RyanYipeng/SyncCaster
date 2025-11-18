# 平台信息收集模板

## 如何收集信息

### 步骤 1：打开平台编辑器

访问该平台的文章编辑页面（创建新文章或编辑草稿）。

### 步骤 2：打开浏览器开发者工具

按 `F12` 打开 Chrome DevTools。

### 步骤 3：使用元素选择器

点击 DevTools 左上角的"选择元素"图标（或按 `Ctrl+Shift+C`），然后：

1. 点击**标题输入框**
2. 在 Elements 面板中右键该元素
3. 选择 "Copy" → "Copy selector"
4. 粘贴到下面的模板中

对每个关键元素重复此操作。

---

## 平台 1：微信公众号

### 基本信息
```yaml
平台ID: wechat
平台名称: 微信公众号
编辑器URL: https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=10
新建文章URL: https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit
```

### 认证检测
```yaml
# 如何判断用户已登录？
登录状态检测选择器: .user_info .nickname
登录状态检测文本: 包含用户昵称

# 如何判断需要重新登录？
未登录重定向: 跳转到 https://mp.weixin.qq.com/?token=&lang=zh_CN
```

### 关键 DOM 选择器

#### 标题输入框
```css
选择器: #js_title
类型: input[type="text"]
填充方式: 直接赋值 element.value = "标题"
验证方式: element.value === "标题"
```

#### 正文编辑器
```css
选择器: #ueditor_0
类型: 富文本编辑器（UEditor）
填充方式: 需要使用编辑器 API
  - 方式1: editorCtrl.setContent(html)
  - 方式2: document.querySelector('#ueditor_0').innerHTML = html
验证方式: 编辑器中能看到内容
```

#### 封面上传
```css
上传按钮选择器: .js_editImg
上传方式: 
  - 点击按钮打开文件选择对话框
  - 或通过拖拽上传
文件输入选择器: input[type="file"][name="uploadfile"]
上传后预览选择器: .pic_preview img
```

#### 摘要（选填）
```css
选择器: #js_summary
类型: textarea
最大字数: 120
```

#### 作者（选填）
```css
选择器: #js_author
类型: input
```

#### 原文链接（选填）
```css
选择器: #js_content_source_url
类型: input
```

#### 发布/草稿按钮
```css
保存草稿按钮: #js_submit
预览按钮: #js_preview
发布按钮: #js_send
```

#### 成功/失败提示
```css
成功提示选择器: .success_tips
成功提示文本: "保存成功" 或 "发送成功"
失败提示选择器: .error_tips
```

### 特殊处理
```yaml
图片处理:
  - 微信需要先上传图片到微信服务器
  - 使用 <img data-src="..."> 格式
  - 支持的格式: jpg, png, gif
  - 最大大小: 10MB

代码高亮:
  - 微信不原生支持代码高亮
  - 需要转换为图片或使用第三方工具（如 mdnice）
  - 或使用内联样式

样式处理:
  - 微信需要内联 CSS
  - 不支持 <style> 标签
  - 所有样式必须写在 style 属性中
```

### 限制和注意事项
```yaml
- 标题最多64个字符
- 正文最多 20万字符
- 图片数量限制: 无限制
- 视频需要先上传到微信视频号
- 不支持外链（除白名单域名）
```

---

## 平台 2：知乎

### 基本信息
```yaml
平台ID: zhihu
平台名称: 知乎
编辑器URL: https://zhuanlan.zhihu.com/write
新建文章URL: https://zhuanlan.zhihu.com/write
```

### 认证检测
```yaml
登录状态检测选择器: .AppHeader-userInfo
登录状态检测方法: 检查元素是否存在
```

### 关键 DOM 选择器

#### 标题输入框
```css
选择器: [待填写]
类型: [待填写]
填充方式: [待填写]
```

#### 正文编辑器
```css
选择器: [待填写]
类型: [待填写：Markdown编辑器 or 富文本编辑器]
填充方式: [待填写]
```

#### 封面上传
```css
选择器: [待填写]
```

#### 发布按钮
```css
选择器: [待填写]
```

#### 成功提示
```css
选择器: [待填写]
```

### 特殊处理
```yaml
[待填写：该平台的特殊要求]
```

---

## 平台 3：掘金

### 基本信息
```yaml
平台ID: juejin
平台名称: 掘金
编辑器URL: https://juejin.cn/editor/drafts/[ID]
新建文章URL: https://juejin.cn/editor/drafts/new?v=2
```

### 关键 DOM 选择器

[待填写：参考微信公众号的格式]

---

## 平台 4：CSDN

### 基本信息
```yaml
平台ID: csdn
平台名称: CSDN
编辑器URL: https://editor.csdn.net/md/?articleId=[ID]
新建文章URL: https://editor.csdn.net/md/
```

### 关键 DOM 选择器

[待填写：参考微信公众号的格式]

---

## 收集工具脚本

### 自动提取选择器工具

在编辑器页面的控制台运行以下脚本，它会帮你找出关键元素：

```javascript
// 复制这段代码到浏览器控制台运行
(function() {
  console.log('=== SyncCaster 选择器提取工具 ===\n');
  
  // 查找标题
  const titleSelectors = ['[placeholder*="标题"]', 'input[name*="title"]', '#title', '.title-input'];
  titleSelectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) {
      console.log(`✓ 找到标题: ${sel}`);
      console.log(`  元素类型: ${el.tagName}`);
      console.log(`  当前值: ${el.value || el.textContent}\n`);
    }
  });
  
  // 查找编辑器
  const editorSelectors = [
    '.editor', '.edit-area', '[contenteditable="true"]',
    '#editor', 'textarea[name*="content"]', '.CodeMirror'
  ];
  editorSelectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) {
      console.log(`✓ 找到编辑器: ${sel}`);
      console.log(`  元素类型: ${el.tagName}`);
      console.log(`  类名: ${el.className}\n`);
    }
  });
  
  // 查找发布按钮
  const publishSelectors = [
    'button[class*="publish"]', 'button[class*="submit"]',
    'button:contains("发布")', 'button:contains("提交")'
  ];
  publishSelectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) {
      console.log(`✓ 找到发布按钮: ${sel}`);
      console.log(`  按钮文本: ${el.textContent}\n`);
    }
  });
  
  console.log('=== 提取完成 ===');
  console.log('请将上述信息复制到 PLATFORM_INFO_TEMPLATE.md');
})();
```

---

## 提交方式

### 方式 1：填写 Markdown 文件

将上述信息填写完整后，发送给我。

### 方式 2：使用提取脚本

运行上述脚本，将控制台输出发送给我。

### 方式 3：录屏演示

录制一个简短视频，展示：
1. 打开编辑器页面
2. 填写标题
3. 填写正文
4. 上传封面
5. 点击发布

我可以通过视频分析 DOM 结构。

---

## 优先级

请按以下顺序提供信息：

1. **微信公众号**（最复杂，优先处理）
2. **知乎**（使用较多）
3. **掘金**（使用较多）
4. **CSDN**（补充）

只需提供你实际使用的平台即可！
