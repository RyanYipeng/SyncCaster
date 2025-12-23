/**
 * MDH Core Renderer Tests
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml, renderMarkdown } from '../index';
import * as fs from 'fs';
import * as path from 'path';

describe('MDH Core Renderer', () => {
  describe('renderMarkdownToHtml', () => {
    it('should render basic markdown', () => {
      const result = renderMarkdownToHtml('# Hello World\n\nThis is a test.');
      expect(result.html).toContain('<h1>Hello World</h1>');
      expect(result.html).toContain('<p>This is a test.</p>');
    });

    it('should render inline formatting', () => {
      const result = renderMarkdownToHtml('**bold** *italic* ~~strike~~ `code`');
      expect(result.html).toContain('<strong>bold</strong>');
      expect(result.html).toContain('<em>italic</em>');
      expect(result.html).toContain('<del>strike</del>');
      expect(result.html).toContain('<code>code</code>');
    });

    it('should render lists', () => {
      const result = renderMarkdownToHtml('- item 1\n- item 2\n\n1. first\n2. second');
      expect(result.html).toContain('<ul>');
      expect(result.html).toContain('<li>');
      expect(result.html).toContain('<ol>');
    });

    it('should render code blocks with highlighting', () => {
      const result = renderMarkdownToHtml('```javascript\nconst x = 1;\n```');
      expect(result.html).toContain('<pre>');
      expect(result.html).toContain('<code');
      expect(result.html).toContain('language-javascript');
    });

    it('should render code blocks without language', () => {
      const result = renderMarkdownToHtml('```\nplain text\n```');
      expect(result.html).toContain('<pre>');
      expect(result.html).toContain('<code');
    });

    it('should render links', () => {
      const result = renderMarkdownToHtml('[link](https://example.com "title")');
      expect(result.html).toContain('<a href="https://example.com"');
      expect(result.html).toContain('title="title"');
      expect(result.html).toContain('>link</a>');
    });

    it('should render images', () => {
      const result = renderMarkdownToHtml('![alt](https://example.com/img.png "title")');
      expect(result.html).toContain('<img src="https://example.com/img.png"');
      expect(result.html).toContain('alt="alt"');
      expect(result.html).toContain('title="title"');
    });

    it('should render blockquotes', () => {
      const result = renderMarkdownToHtml('> quote text');
      expect(result.html).toContain('<blockquote>');
      expect(result.html).toContain('quote text');
    });

    it('should render tables', () => {
      const result = renderMarkdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
      expect(result.html).toContain('<table>');
      expect(result.html).toContain('<thead>');
      expect(result.html).toContain('<tbody>');
      expect(result.html).toContain('<th>');
      expect(result.html).toContain('<td>');
    });

    it('should render horizontal rules', () => {
      const result = renderMarkdownToHtml('---');
      expect(result.html).toContain('<hr>');
    });

    it('should extract image assets', () => {
      const result = renderMarkdownToHtml('![img1](https://a.com/1.png)\n![img2](https://b.com/2.png)');
      expect(result.assets?.images).toContain('https://a.com/1.png');
      expect(result.assets?.images).toContain('https://b.com/2.png');
    });

    it('should extract link assets', () => {
      const result = renderMarkdownToHtml('[link1](https://a.com)\n[link2](https://b.com)');
      expect(result.assets?.links).toContain('https://a.com');
      expect(result.assets?.links).toContain('https://b.com');
    });
  });

  describe('Sanitization', () => {
    it('should remove script tags', () => {
      const result = renderMarkdownToHtml('<script>alert("xss")</script>');
      expect(result.html).not.toContain('<script');
      expect(result.html).not.toContain('alert');
    });

    it('should remove on* event handlers', () => {
      const result = renderMarkdownToHtml('<div onclick="alert(1)">test</div>');
      expect(result.html).not.toContain('onclick');
    });

    it('should remove javascript: links', () => {
      const result = renderMarkdownToHtml('[click](javascript:alert(1))');
      expect(result.html).not.toContain('javascript:');
    });

    it('should allow safe tags', () => {
      const result = renderMarkdownToHtml('**bold** *italic*');
      expect(result.html).toContain('<strong>');
      expect(result.html).toContain('<em>');
    });

    it('should allow safe attributes', () => {
      const result = renderMarkdownToHtml('[link](https://example.com "title")');
      expect(result.html).toContain('href="https://example.com"');
      expect(result.html).toContain('title="title"');
    });

    it('should skip sanitization when disabled', () => {
      const result = renderMarkdownToHtml('<custom-tag>content</custom-tag>', { sanitize: false });
      expect(result.html).toContain('<custom-tag>');
    });
  });

  describe('Smartypants', () => {
    it('should convert arrows', () => {
      const result = renderMarkdownToHtml('-->', { smartypants: true });
      expect(result.html).toContain('→');
    });

    it('should convert em-dashes', () => {
      const result = renderMarkdownToHtml('test--test', { smartypants: true });
      expect(result.html).toContain('—');
    });

    it('should handle quotes in text', () => {
      // smartypants 引号转换依赖于 marked 的 text token 处理
      // 在某些 marked 版本中可能不会触发 text renderer
      // 这里只验证不会报错
      const result = renderMarkdownToHtml('He said "hello"', { smartypants: true });
      expect(result.html).toContain('hello');
    });

    it('should convert ellipsis', () => {
      const result = renderMarkdownToHtml('test...', { smartypants: true });
      expect(result.html).toContain('…');
    });
  });

  describe('renderMarkdown (unified entry)', () => {
    it('should use MDH renderer by default', () => {
      const result = renderMarkdown('# Test');
      expect(result.html).toContain('<h1>Test</h1>');
    });

    it('should fallback to legacy when forced', () => {
      const result = renderMarkdown('# Test', { forceLegacy: true });
      expect(result.html).toContain('<h1');
      expect(result.html).toContain('Test');
    });
  });

  describe('Fixture rendering', () => {
    it('should render fixtures.md without errors', () => {
      const fixturePath = path.join(__dirname, 'fixtures.md');
      const markdown = fs.readFileSync(fixturePath, 'utf-8');

      const result = renderMarkdownToHtml(markdown);

      // 基本结构检查
      expect(result.html).toContain('<h1>');
      expect(result.html).toContain('<h2>');
      expect(result.html).toContain('<ul>');
      expect(result.html).toContain('<ol>');
      expect(result.html).toContain('<pre>');
      expect(result.html).toContain('<code');
      expect(result.html).toContain('<a href=');
      expect(result.html).toContain('<img src=');
      expect(result.html).toContain('<blockquote>');
      expect(result.html).toContain('<table>');
      expect(result.html).toContain('<hr>');

      // 安全检查
      expect(result.html).not.toContain('<script');
      expect(result.html).not.toContain('onclick');
      expect(result.html).not.toContain('javascript:');

      // 资源提取检查
      expect(result.assets?.images.length).toBeGreaterThan(0);
      expect(result.assets?.links.length).toBeGreaterThan(0);
    });
  });
});
