import type { PlatformAdapter } from './base';

/**
 * 思否（SegmentFault）适配器
 * 
 * 平台特点：
 * - 入口：https://segmentfault.com/write?freshman=1
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - LaTeX 公式：
 *   - 行内公式和块级公式都使用 $$公式$$ 语法
 * - 结构：标题 + 正文
 */
export const segmentfaultAdapter: PlatformAdapter = {
  id: 'segmentfault',
  name: '思否',
  kind: 'dom',
  icon: 'segmentfault',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: false,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // 思否 LaTeX 语法：行内和块级公式都使用双美元符号 $$...$$
    // 需要将标准 Markdown 的单 $ 行内公式转换为双 $$
    let markdown = post.body_md || '';

    // 使用特殊标记替换，避免 $ 符号的特殊处理问题
    const DOLLAR = '\uFFFF';  // 使用 Unicode 替换字符作为临时标记

    // 1. 先将所有 $$ 替换为临时标记（保护块级公式）
    markdown = markdown.split('$$').join(DOLLAR + DOLLAR);

    // 2. 将剩余的单个 $ 替换为双 $$（转换行内公式）
    markdown = markdown.split('$').join(DOLLAR + DOLLAR);

    // 3. 将临时标记还原为 $
    markdown = markdown.split(DOLLAR).join('$');

    // 4. 规范化分割线：将 "* * *" 转换为 "---"
    markdown = markdown.replace(/^\* \* \*$/gm, '---');
    markdown = markdown.replace(/^\*\*\*$/gm, '---');

    return {
      title: post.title,
      contentMarkdown: markdown,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('segmentfault: use DOM automation');
  },

  dom: {
    matchers: [
      // 注意：直接使用带参数的完整 URL，避免跳转到 howtowrite 提示页
      'https://segmentfault.com/write?freshman=1',
    ],
    fillAndPublish: async function (payload) {
      console.log('[segmentfault] fillAndPublish starting', payload);

      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      async function waitFor(selector: string, timeout = 15000): Promise<HTMLElement> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const el = document.querySelector(selector);
          if (el) return el as HTMLElement;
          await sleep(200);
        }
        throw new Error(`等待元素超时: ${selector}`);
      }

      // 辅助函数：使用原生 setter 设置值，绕过 Vue/React 的受控组件机制
      function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
        // 获取原生的 value setter
        const proto = element instanceof HTMLInputElement
          ? window.HTMLInputElement.prototype
          : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (nativeSetter) {
          nativeSetter.call(element, value);
        } else {
          // 降级：直接设置
          element.value = value;
        }
      }

      // 辅助函数：模拟完整的用户输入，确保触发 Vue/React 表单验证
      async function simulateUserInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
        const title = value;

        // 移除 readonly 属性（如果存在）
        element.removeAttribute('readonly');
        element.removeAttribute('disabled');

        // 聚焦元素
        element.focus();
        element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await sleep(50);

        // 清空当前值
        setNativeValue(element, '');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContent' }));
        await sleep(50);

        // ============ 方法1: 使用原生 setter + InputEvent ============
        setNativeValue(element, title);

        // 触发 Vue v-model 需要的 input 事件
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: title
        }));

        // 触发 change 事件
        element.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(100);

        // 检查是否成功
        if (element.value === title) {
          console.log('[segmentfault] 方法1成功: 原生setter + InputEvent');
          // 触发 blur 以完成验证
          element.blur();
          element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          await sleep(100);
          // 再次聚焦以保持用户体验
          element.focus();
          return true;
        }

        // ============ 方法2: 使用 compositionstart/end 事件模拟中文输入 ============
        console.log('[segmentfault] 尝试方法2: compositionstart/end');
        element.focus();

        // 模拟输入法开始
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));

        setNativeValue(element, title);

        // 模拟输入法更新
        element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: title }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: title, inputType: 'insertCompositionText' }));

        // 模拟输入法结束
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: title }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: title, inputType: 'insertFromComposition' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(100);

        if (element.value === title) {
          console.log('[segmentfault] 方法2成功: compositionend');
          element.blur();
          element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          await sleep(100);
          element.focus();
          return true;
        }

        // ============ 方法3: 使用 document.execCommand ============
        console.log('[segmentfault] 尝试方法3: execCommand');
        element.focus();
        element.select(); // 选中所有文本

        try {
          // 先删除现有内容
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);

          // 插入新内容
          const insertOk = document.execCommand('insertText', false, title);
          if (insertOk && element.value === title) {
            console.log('[segmentfault] 方法3成功: execCommand');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.blur();
            element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await sleep(100);
            element.focus();
            return true;
          }
        } catch (e) {
          console.warn('[segmentfault] execCommand 失败:', e);
        }

        // ============ 方法4: 逐字符输入模拟 ============
        console.log('[segmentfault] 尝试方法4: 逐字符输入');
        element.focus();
        setNativeValue(element, '');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContent' }));

        for (let i = 0; i < title.length; i++) {
          const char = title[i];
          const currentValue = title.substring(0, i + 1);

          element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
          setNativeValue(element, currentValue);
          element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
          element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));

          // 每输入一些字符就稍微等待
          if (i % 5 === 4) await sleep(10);
        }

        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await sleep(100);
        element.focus();

        if (element.value === title) {
          console.log('[segmentfault] 方法4成功: 逐字符输入');
          return true;
        }

        console.warn('[segmentfault] 所有方法都未能完全匹配，当前值:', element.value);
        return false;
      }

      try {
        // 1. 填充标题
        console.log('[segmentfault] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .title-input input') as HTMLInputElement;
        const titleText = (payload as any).title || '';

        // 尝试填充标题，最多重试3次
        let titleFilled = false;
        for (let attempt = 0; attempt < 3 && !titleFilled; attempt++) {
          if (attempt > 0) {
            console.log(`[segmentfault] 标题填充重试 ${attempt + 1}/3`);
            await sleep(200);
          }
          titleFilled = await simulateUserInput(titleInput, titleText);
        }

        if (!titleFilled) {
          console.warn('[segmentfault] 标题可能未完全填充，但继续处理内容');
        }

        await sleep(300);

        // 2. 填充内容 - 思否使用 Markdown 编辑器
        console.log('[segmentfault] Step 2: 填充内容');
        const markdown = (payload as any).contentMarkdown || '';

        // 尝试 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：textarea
          const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到思否编辑器');
          }
        }
        await sleep(500);

        // 3. 内容填充完成，不执行发布操作
        console.log('[segmentfault] 内容填充完成');
        console.log('[segmentfault] ⚠️ 发布操作需要用户手动完成');

        return {
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[segmentfault] 填充失败:', error);
        return {
          url: window.location.href,
          __synccasterError: {
            message: error?.message || String(error),
            stack: error?.stack,
          },
        } as any;
      }
    },
  },
};
