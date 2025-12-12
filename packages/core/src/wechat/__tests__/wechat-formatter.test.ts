/**
 * 微信公众号格式化器测试
 */

import { describe, it, expect } from 'vitest';
import { mdToWechatHtml, mdToWechatHtmlRaw } from '../wechat-formatter';

describe('mdToWechatHtml', () => {
  it('should convert basic markdown to HTML', async () => {
    const markdown = `# Hello World

This is a test paragraph.

## Features

- Item 1
- Item 2
- Item 3
`;

    const result = await mdToWechatHtml(markdown);
    
    expect(result.html).toContain('Hello World');
    expect(result.html).toContain('This is a test paragraph');
    expect(result.html).toContain('Features');
    expect(result.html).toContain('Item 1');
    expect(result.meta?.wordCount).toBeGreaterThan(0);
  });

  it('should apply inline styles', async () => {
    const markdown = `# Title

**Bold text** and *italic text*.
`;

    const result = await mdToWechatHtml(markdown);
    
    // 检查是否有内联样式
    expect(result.html).toContain('style=');
  });

  it('should handle code blocks', async () => {
    const markdown = `
\`\`\`javascript
const hello = 'world';
console.log(hello);
\`\`\`
`;

    const result = await mdToWechatHtml(markdown);
    
    expect(result.html).toContain('const');
    expect(result.html).toContain('hello');
    expect(result.html).toContain('hljs');
  });

  it('should handle blockquotes', async () => {
    const markdown = `
> This is a quote
> with multiple lines
`;

    const result = await mdToWechatHtml(markdown);
    
    expect(result.html).toContain('blockquote');
    expect(result.html).toContain('This is a quote');
  });

  it('should handle links with footnotes', async () => {
    const markdown = `
Check out [Google](https://google.com) for more info.
`;

    const result = await mdToWechatHtml(markdown, { citeStatus: true });
    
    expect(result.html).toContain('Google');
    expect(result.html).toContain('引用链接');
  });

  it('should handle images', async () => {
    const markdown = `
![Alt text](https://example.com/image.png "Image title")
`;

    const result = await mdToWechatHtml(markdown);
    
    expect(result.html).toContain('img');
    expect(result.html).toContain('example.com/image.png');
    expect(result.html).toContain('Alt text');
  });

  it('should handle tables', async () => {
    const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
`;

    const result = await mdToWechatHtml(markdown);
    
    expect(result.html).toContain('table');
    expect(result.html).toContain('Header 1');
    expect(result.html).toContain('Cell 1');
  });

  it('should apply custom theme color', async () => {
    const markdown = `# Title`;

    const result = await mdToWechatHtml(markdown, {
      primaryColor: '#ff0000',
    });
    
    expect(result.css).toContain('#ff0000');
  });

  it('should use different themes', async () => {
    const markdown = `# Title`;

    const defaultResult = await mdToWechatHtml(markdown, { theme: 'default' });
    const graceResult = await mdToWechatHtml(markdown, { theme: 'grace' });
    const simpleResult = await mdToWechatHtml(markdown, { theme: 'simple' });
    
    // 不同主题应该有不同的 CSS
    expect(defaultResult.css).not.toBe(graceResult.css);
    expect(graceResult.css).not.toBe(simpleResult.css);
  });
});

describe('mdToWechatHtmlRaw', () => {
  it('should return raw HTML without inline styles', async () => {
    const markdown = `# Hello World`;

    const result = await mdToWechatHtmlRaw(markdown);
    
    expect(result.html).toContain('Hello World');
    expect(result.css).toBeTruthy();
  });
});
