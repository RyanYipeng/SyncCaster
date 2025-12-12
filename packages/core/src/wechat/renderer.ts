/**
 * 微信公众号 Markdown 渲染器
 * 基于 marked 实现，专门为微信公众号优化
 * 参考 doocs/md 项目的实现
 */

import type { WechatFormatOptions } from './types';
import type { RendererObject, Tokens, MarkedExtension } from 'marked';
import { marked } from 'marked';

// Mac 风格代码块 SVG
const MAC_CODE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" x="0px" y="0px" width="45px" height="13px" viewBox="0 0 450 130">
  <ellipse cx="50" cy="65" rx="50" ry="52" stroke="rgb(220,60,54)" stroke-width="2" fill="rgb(237,108,96)" />
  <ellipse cx="225" cy="65" rx="50" ry="52" stroke="rgb(218,151,33)" stroke-width="2" fill="rgb(247,193,81)" />
  <ellipse cx="400" cy="65" rx="50" ry="52" stroke="rgb(27,161,37)" stroke-width="2" fill="rgb(100,200,86)" />
</svg>
`.trim();

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * 简单的代码高亮（不依赖 highlight.js）
 */
function simpleHighlight(code: string, lang: string): string {
  let highlighted = escapeHtml(code);

  if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
    highlighted = highlighted.replace(
      /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof)\b/g,
      '<span style="color:#569cd6">$1</span>'
    );
    highlighted = highlighted.replace(
      /(&quot;[^&]*&quot;|&#39;[^&]*&#39;|`[^`]*`)/g,
      '<span style="color:#ce9178">$1</span>'
    );
    highlighted = highlighted.replace(/(\/\/.*$)/gm, '<span style="color:#6a9955">$1</span>');
    highlighted = highlighted.replace(/\b(\d+)\b/g, '<span style="color:#b5cea8">$1</span>');
  } else if (['python', 'py'].includes(lang)) {
    highlighted = highlighted.replace(
      /\b(def|class|import|from|return|if|elif|else|for|while|try|except|raise|with|as|lambda|yield|pass|break|continue|True|False|None|and|or|not|in|is)\b/g,
      '<span style="color:#569cd6">$1</span>'
    );
    highlighted = highlighted.replace(
      /(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g,
      '<span style="color:#ce9178">$1</span>'
    );
    highlighted = highlighted.replace(/(#.*$)/gm, '<span style="color:#6a9955">$1</span>');
  } else if (['html', 'xml'].includes(lang)) {
    highlighted = highlighted.replace(
      /(&lt;\/?[a-zA-Z][a-zA-Z0-9]*)/g,
      '<span style="color:#569cd6">$1</span>'
    );
    highlighted = highlighted.replace(/(\s[a-zA-Z-]+)=/g, '<span style="color:#9cdcfe">$1</span>=');
  } else if (['css', 'scss', 'less'].includes(lang)) {
    highlighted = highlighted.replace(
      /([.#][a-zA-Z_-][a-zA-Z0-9_-]*)/g,
      '<span style="color:#d7ba7d">$1</span>'
    );
    highlighted = highlighted.replace(/([a-zA-Z-]+):/g, '<span style="color:#9cdcfe">$1</span>:');
  }

  return highlighted;
}

/**
 * 生成带 CSS 类的内容
 */
function styledContent(styleLabel: string, content: string, tagName?: string): string {
  const tag = tagName ?? styleLabel;
  const className = styleLabel.replace(/_/g, '-');
  return `<${tag} class="${className}">${content}</${tag}>`;
}

/**
 * 数学公式扩展
 * 由于微信公众号不支持 MathJax/KaTeX，我们保持公式原样显示
 */
function createMathExtension(): MarkedExtension {
  return {
    extensions: [
      // 块级公式 $$...$$
      {
        name: 'mathBlock',
        level: 'block',
        start(src: string) {
          return src.match(/\$\$/)?.index;
        },
        tokenizer(src: string) {
          const match = src.match(/^\$\$([\s\S]+?)\$\$/);
          if (match) {
            return {
              type: 'mathBlock',
              raw: match[0],
              text: match[1].trim(),
            };
          }
          return undefined;
        },
        renderer(token: any) {
          const escaped = escapeHtml(token.text);
          return `<section class="math-block">$$${escaped}$$</section>`;
        },
      },
      // 行内公式 $...$
      {
        name: 'mathInline',
        level: 'inline',
        start(src: string) {
          return src.match(/\$/)?.index;
        },
        tokenizer(src: string) {
          // 匹配 $...$ 但不匹配 $$
          const match = src.match(/^\$([^\$\n]+?)\$/);
          if (match) {
            return {
              type: 'mathInline',
              raw: match[0],
              text: match[1].trim(),
            };
          }
          return undefined;
        },
        renderer(token: any) {
          const escaped = escapeHtml(token.text);
          return `<span class="math-inline">$${escaped}$</span>`;
        },
      },
    ],
  };
}

/**
 * 创建微信公众号渲染器
 */
export function createWechatRenderer(options: WechatFormatOptions = {}) {
  const footnotes: Array<[number, string, string]> = [];
  let footnoteIndex = 0;
  const listOrderedStack: boolean[] = [];
  const listCounters: number[] = [];

  // 注册数学公式扩展
  marked.use(createMathExtension());

  /**
   * 添加脚注
   */
  function addFootnote(title: string, link: string): number {
    const existing = footnotes.find(([, , l]) => l === link);
    if (existing) return existing[0];
    footnotes.push([++footnoteIndex, title, link]);
    return footnoteIndex;
  }

  /**
   * 构建脚注 HTML
   */
  function buildFootnotes(): string {
    if (!footnotes.length) return '';

    const footnotesHtml = footnotes
      .map(([index, title, link]) =>
        link === title
          ? `<code style="font-size: 90%; opacity: 0.6;">[${index}]</code>: <i style="word-break: break-all">${title}</i><br/>`
          : `<code style="font-size: 90%; opacity: 0.6;">[${index}]</code> ${title}: <i style="word-break: break-all">${link}</i><br/>`
      )
      .join('\n');

    return styledContent('h4', '引用链接') + styledContent('footnotes', footnotesHtml, 'p');
  }

  /**
   * 重置状态
   */
  function reset() {
    footnotes.length = 0;
    footnoteIndex = 0;
    listOrderedStack.length = 0;
    listCounters.length = 0;
  }

  /**
   * 处理图片说明
   */
  function transformLegend(legend: string, text: string | null, title: string | null): string {
    const opts = legend.split('-');
    for (const opt of opts) {
      if (opt === 'alt' && text) return text;
      if (opt === 'title' && title) return title;
    }
    return '';
  }

  // 创建 marked 渲染器
  const renderer: RendererObject = {
    heading({ tokens, depth }: Tokens.Heading) {
      const text = this.parser.parseInline(tokens);
      const tag = `h${depth}`;
      return styledContent(tag, text);
    },

    paragraph({ tokens }: Tokens.Paragraph): string {
      const text = this.parser.parseInline(tokens);
      const isFigureImage = text.includes('<figure') && text.includes('<img');
      const isEmpty = text.trim() === '';
      if (isFigureImage || isEmpty) return text;
      return styledContent('p', text);
    },

    blockquote({ tokens }: Tokens.Blockquote): string {
      const text = this.parser.parse(tokens);
      return styledContent('blockquote', text);
    },

    code({ text, lang = '' }: Tokens.Code): string {
      const langText = lang.split(' ')[0] || 'plaintext';
      const highlighted = simpleHighlight(text, langText);

      const macSign =
        options.isMacCodeBlock !== false
          ? `<span class="mac-sign" style="padding: 10px 14px 0; display: block;">${MAC_CODE_SVG}</span>`
          : '';

      const code = `<code class="language-${langText}">${highlighted}</code>`;
      return `<pre class="hljs code__pre">${macSign}${code}</pre>`;
    },

    codespan({ text }: Tokens.Codespan): string {
      return styledContent('codespan', escapeHtml(text), 'code');
    },

    list({ ordered, items, start = 1 }: Tokens.List) {
      listOrderedStack.push(ordered);
      listCounters.push(Number(start));

      const html = items.map((item) => this.listitem(item)).join('');

      listOrderedStack.pop();
      listCounters.pop();

      return styledContent(ordered ? 'ol' : 'ul', html);
    },

    listitem(token: Tokens.ListItem) {
      const ordered = listOrderedStack[listOrderedStack.length - 1];
      const idx = listCounters[listCounters.length - 1]!;
      listCounters[listCounters.length - 1] = idx + 1;

      const prefix = ordered ? `${idx}. ` : '• ';

      let content: string;
      try {
        content = this.parser.parseInline(token.tokens);
      } catch {
        content = this.parser.parse(token.tokens).replace(/^<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/, '$1');
      }

      return styledContent('listitem', `${prefix}${content}`, 'li');
    },

    image({ href, title, text }: Tokens.Image): string {
      const legend = options.legend || 'alt';
      const subText = styledContent('figcaption', transformLegend(legend, text, title));
      const titleAttr = title ? ` title="${title}"` : '';
      return `<figure><img src="${href}"${titleAttr} alt="${text}"/>${subText}</figure>`;
    },

    link({ href, title, text, tokens }: Tokens.Link): string {
      const parsedText = this.parser.parseInline(tokens);

      // 微信公众号内链保持原样
      if (/^https?:\/\/mp\.weixin\.qq\.com/.test(href)) {
        return `<a href="${href}" title="${title || text}">${parsedText}</a>`;
      }

      if (href === text) return parsedText;

      // 添加脚注引用
      if (options.citeStatus !== false) {
        const ref = addFootnote(title || text, href);
        return `<a href="${href}" title="${title || text}">${parsedText}<sup>[${ref}]</sup></a>`;
      }

      return `<a href="${href}" title="${title || text}">${parsedText}</a>`;
    },

    strong({ tokens }: Tokens.Strong): string {
      return styledContent('strong', this.parser.parseInline(tokens));
    },

    em({ tokens }: Tokens.Em): string {
      return styledContent('em', this.parser.parseInline(tokens));
    },

    del({ tokens }: Tokens.Del): string {
      return styledContent('del', this.parser.parseInline(tokens));
    },

    table({ header, rows }: Tokens.Table): string {
      const headerRow = header
        .map((cell) => styledContent('th', this.parser.parseInline(cell.tokens)))
        .join('');

      const body = rows
        .map((row) => {
          const rowContent = row.map((cell) => this.tablecell(cell)).join('');
          return styledContent('tr', rowContent);
        })
        .join('');

      return `
        <section style="max-width: 100%; overflow: auto">
          <table class="preview-table">
            <thead><tr>${headerRow}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </section>
      `;
    },

    tablecell(token: Tokens.TableCell): string {
      const text = this.parser.parseInline(token.tokens);
      return styledContent('td', text);
    },

    hr(_: Tokens.Hr): string {
      return '<hr class="hr"/>';
    },
  };

  return {
    renderer,
    buildFootnotes,
    reset,
  };
}
