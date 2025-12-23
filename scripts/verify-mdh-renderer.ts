#!/usr/bin/env npx tsx
/**
 * MDH Renderer 验证脚本
 *
 * 用法：
 *   npx tsx scripts/verify-mdh-renderer.ts
 *
 * 输出：
 *   - 控制台显示渲染结果摘要
 *   - 生成 dist/mdh-output.html 可在浏览器中查看
 */

import * as fs from 'fs';
import * as path from 'path';

// 动态导入渲染器（避免编译问题）
async function main() {
  console.log('🚀 MDH Renderer Verification\n');
  console.log('='.repeat(50));

  // 读取 fixture
  const fixturePath = path.join(__dirname, '../packages/core/src/renderer/__tests__/fixtures.md');
  const markdown = fs.readFileSync(fixturePath, 'utf-8');
  console.log(`📄 Input: fixtures.md (${markdown.length} chars)\n`);

  // 动态导入
  const { renderMarkdownToHtml, renderMarkdown } = await import('../packages/core/src/renderer');

  // 测试新渲染器
  console.log('🔧 Testing MDH Core Renderer...');
  const startNew = performance.now();
  const resultNew = renderMarkdownToHtml(markdown);
  const timeNew = (performance.now() - startNew).toFixed(2);
  console.log(`   ✅ Rendered in ${timeNew}ms`);
  console.log(`   📊 Output: ${resultNew.html.length} chars`);
  console.log(`   🖼️  Images: ${resultNew.assets?.images.length || 0}`);
  console.log(`   🔗 Links: ${resultNew.assets?.links.length || 0}`);

  // 测试旧渲染器（回退）
  console.log('\n🔧 Testing Legacy Renderer (fallback)...');
  const startLegacy = performance.now();
  const resultLegacy = renderMarkdown(markdown, { forceLegacy: true });
  const timeLegacy = (performance.now() - startLegacy).toFixed(2);
  console.log(`   ✅ Rendered in ${timeLegacy}ms`);
  console.log(`   📊 Output: ${resultLegacy.html.length} chars`);

  // 安全检查
  console.log('\n🔒 Security Check...');
  const hasScript = resultNew.html.includes('<script');
  const hasOnClick = /\son\w+\s*=/i.test(resultNew.html);
  const hasJsLink = resultNew.html.includes('javascript:');
  console.log(`   Script tags: ${hasScript ? '❌ FOUND' : '✅ Clean'}`);
  console.log(`   Event handlers: ${hasOnClick ? '❌ FOUND' : '✅ Clean'}`);
  console.log(`   JS links: ${hasJsLink ? '❌ FOUND' : '✅ Clean'}`);

  // 生成输出文件
  const distDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outputHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MDH Renderer Output</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
  <style>
    body {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
    }
    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 85%;
    }
    :not(pre) > code {
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
    blockquote {
      border-left: 4px solid #dfe2e5;
      margin: 0;
      padding-left: 16px;
      color: #6a737d;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #dfe2e5;
      padding: 8px 12px;
    }
    th {
      background: #f6f8fa;
    }
    img {
      max-width: 100%;
    }
    hr {
      border: none;
      border-top: 1px solid #dfe2e5;
      margin: 24px 0;
    }
    .meta {
      background: #f0f9ff;
      border: 1px solid #0ea5e9;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .meta h3 {
      margin: 0 0 8px 0;
      color: #0369a1;
    }
  </style>
</head>
<body>
  <div class="meta">
    <h3>🔧 MDH Renderer Output</h3>
    <p>
      <strong>Render time:</strong> ${timeNew}ms |
      <strong>Output size:</strong> ${resultNew.html.length} chars |
      <strong>Images:</strong> ${resultNew.assets?.images.length || 0} |
      <strong>Links:</strong> ${resultNew.assets?.links.length || 0}
    </p>
  </div>
  ${resultNew.html}
</body>
</html>`;

  const outputPath = path.join(distDir, 'mdh-output.html');
  fs.writeFileSync(outputPath, outputHtml);
  console.log(`\n📁 Output saved to: ${outputPath}`);

  console.log('\n' + '='.repeat(50));
  console.log('✅ Verification complete!\n');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
