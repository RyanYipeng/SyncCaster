/**
 * 微信公众号主题样式
 * 基于 doocs/md 项目的主题系统
 * 
 * 注意：微信公众号不支持 CSS 变量，所以需要在导出时替换为实际值
 */

/**
 * 基础样式 - 所有主题共用
 */
export const BASE_CSS = `
/* 容器样式 */
section.container {
  font-family: var(--md-font-family);
  font-size: var(--md-font-size);
  line-height: 1.75;
  text-align: left;
  color: #333;
}

/* 去除第一个元素的 margin-top */
section.container > :first-child {
  margin-top: 0 !important;
}
`;

/**
 * 默认主题 - 经典风格
 */
export const DEFAULT_THEME = `
/* 一级标题 */
h1 {
  display: table;
  padding: 0 1em;
  border-bottom: 2px solid var(--md-primary-color);
  margin: 2em auto 1em;
  color: #333;
  font-size: 1.2em;
  font-weight: bold;
  text-align: center;
}

/* 二级标题 */
h2 {
  display: block;
  width: fit-content;
  padding: 4px 16px;
  margin: 2em auto 1em;
  color: #fff;
  background: var(--md-primary-color);
  font-size: 1.2em;
  font-weight: bold;
  text-align: center;
  border-radius: 2px;
}

/* 三级标题 */
h3 {
  padding-left: 8px;
  border-left: 3px solid var(--md-primary-color);
  margin: 2em 8px 0.75em 0;
  color: #333;
  font-size: 1.1em;
  font-weight: bold;
  line-height: 1.2;
}

/* 四级标题 */
h4 {
  margin: 2em 8px 0.5em;
  color: var(--md-primary-color);
  font-size: 1em;
  font-weight: bold;
}

/* 段落 */
p {
  margin: 1.5em 8px;
  letter-spacing: 0.1em;
  color: #333;
}

/* 引用块 */
blockquote {
  font-style: normal;
  padding: 1em;
  border-left: 4px solid var(--md-primary-color);
  border-radius: 6px;
  color: #333;
  background: rgba(0, 0, 0, 0.03);
  margin: 0 8px 1em;
}

blockquote p {
  display: block;
  font-size: 1em;
  letter-spacing: 0.1em;
  color: #333;
  margin: 0;
}

/* 代码块 */
pre.hljs {
  font-size: 90%;
  overflow-x: auto;
  border-radius: 8px;
  padding: 0 !important;
  line-height: 1.5;
  margin: 10px 8px;
  background: #1e1e1e;
}

pre.hljs code {
  display: block;
  padding: 0.5em 1em 1em;
  overflow-x: auto;
  color: #dcdcdc;
  background: none;
  white-space: pre;
  margin: 0;
}

/* 行内代码 */
code {
  font-size: 90%;
  color: #d14;
  background: rgba(27, 31, 35, 0.05);
  padding: 3px 5px;
  border-radius: 4px;
}

/* 图片 */
img {
  display: block;
  max-width: 100%;
  margin: 0.1em auto 0.5em;
  border-radius: 4px;
}

/* 图片说明 */
figure {
  margin: 1.5em 8px;
  color: #333;
}

figcaption {
  text-align: center;
  color: #888;
  font-size: 0.8em;
}

/* 列表 */
ol {
  padding-left: 1em;
  margin-left: 0;
  color: #333;
}

ul {
  list-style: circle;
  padding-left: 1em;
  margin-left: 0;
  color: #333;
}

li {
  display: block;
  margin: 0.2em 8px;
  color: #333;
}

/* 脚注 */
p.footnotes {
  margin: 0.5em 8px;
  font-size: 80%;
  color: #333;
}

/* 分隔线 */
hr {
  border-style: solid;
  border-width: 2px 0 0;
  border-color: rgba(0, 0, 0, 0.1);
  height: 0;
  margin: 1.5em 0;
}

/* 强调 */
em {
  font-style: italic;
}

/* 链接 */
a {
  color: #576b95;
  text-decoration: none;
}

/* 粗体 */
strong {
  color: var(--md-primary-color);
  font-weight: bold;
}

/* 表格 */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 8px;
  color: #333;
}

thead {
  font-weight: bold;
  color: #333;
}

th {
  border: 1px solid #dfdfdf;
  padding: 0.25em 0.5em;
  color: #333;
  word-break: keep-all;
  background: rgba(0, 0, 0, 0.05);
}

td {
  border: 1px solid #dfdfdf;
  padding: 0.25em 0.5em;
  color: #333;
  word-break: keep-all;
}

/* 数学公式 - 行内 */
.math-inline {
  font-family: 'Times New Roman', 'KaTeX_Main', serif;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-style: italic;
}

/* 数学公式 - 块级 */
.math-block {
  display: block;
  text-align: center;
  padding: 1em;
  margin: 1em 8px;
  background: #f8f9fa;
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'Times New Roman', 'KaTeX_Main', serif;
  font-style: italic;
}
`;

/**
 * 优雅主题
 */
export const GRACE_THEME = `
/* 一级标题 */
h1 {
  padding-bottom: 0.5em;
  border-bottom: 2px solid var(--md-primary-color);
  margin: 2em 8px 1em;
  color: #333;
  font-size: 1.3em;
  font-weight: bold;
  text-align: left;
}

/* 二级标题 */
h2 {
  position: relative;
  padding-left: 16px;
  margin: 2em 8px 1em;
  color: var(--md-primary-color);
  font-size: 1.2em;
  font-weight: bold;
  text-align: left;
}

h2::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--md-primary-color);
  border-radius: 2px;
}

/* 三级标题 */
h3 {
  margin: 1.5em 8px 0.75em;
  color: #333;
  font-size: 1.1em;
  font-weight: bold;
}

/* 段落 */
p {
  margin: 1.5em 8px;
  letter-spacing: 0.05em;
  color: #333;
  line-height: 1.8;
}

/* 引用块 */
blockquote {
  font-style: normal;
  padding: 1em 1.5em;
  border-left: none;
  border-radius: 8px;
  color: #666;
  background: linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.05) 100%);
  margin: 1em 8px;
  position: relative;
}

blockquote::before {
  content: '"';
  position: absolute;
  left: 10px;
  top: -10px;
  font-size: 3em;
  color: var(--md-primary-color);
  opacity: 0.3;
}

blockquote p {
  margin: 0;
  color: #666;
}
`;

/**
 * 简约主题
 */
export const SIMPLE_THEME = `
/* 一级标题 */
h1 {
  margin: 2em 8px 1em;
  color: #333;
  font-size: 1.4em;
  font-weight: bold;
  text-align: center;
}

/* 二级标题 */
h2 {
  margin: 2em 8px 1em;
  color: #333;
  font-size: 1.2em;
  font-weight: bold;
  text-align: left;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #eee;
}

/* 三级标题 */
h3 {
  margin: 1.5em 8px 0.75em;
  color: #333;
  font-size: 1.1em;
  font-weight: bold;
}

/* 段落 */
p {
  margin: 1.2em 8px;
  color: #333;
  line-height: 1.8;
}

/* 引用块 */
blockquote {
  padding: 0.8em 1em;
  border-left: 3px solid #ddd;
  color: #666;
  background: #fafafa;
  margin: 1em 8px;
}

blockquote p {
  margin: 0;
}
`;

/**
 * 主题映射
 */
export const THEME_MAP: Record<string, string> = {
  default: DEFAULT_THEME,
  grace: GRACE_THEME,
  simple: SIMPLE_THEME,
};

/**
 * 获取主题 CSS
 */
export function getThemeCSS(theme: string = 'default'): string {
  const themeCSS = THEME_MAP[theme] || THEME_MAP.default;
  return BASE_CSS + '\n' + themeCSS;
}

/**
 * 替换 CSS 变量为实际值（微信公众号不支持 CSS 变量）
 */
export function replaceCSSVariables(
  css: string,
  primaryColor: string,
  fontFamily: string,
  fontSize: string
): string {
  return css
    .replace(/var\(--md-primary-color\)/g, primaryColor)
    .replace(/var\(--md-font-family\)/g, fontFamily)
    .replace(/var\(--md-font-size\)/g, fontSize);
}
