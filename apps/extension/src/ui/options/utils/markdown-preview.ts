import { marked, type RendererExtension, type TokenizerExtension } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';

import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

let configured = false;

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureConfigured() {
  if (configured) return;

  const mathBlock: TokenizerExtension = {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const index = src.indexOf('$$');
      return index >= 0 ? index : undefined;
    },
    tokenizer(src) {
      const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
      if (!match) return;
      return {
        type: 'mathBlock',
        raw: match[0],
        text: match[1].trim(),
      };
    },
  };

  const mathInline: TokenizerExtension = {
    name: 'mathInline',
    level: 'inline',
    start(src) {
      const index = src.indexOf('$');
      return index >= 0 ? index : undefined;
    },
    tokenizer(src) {
      if (src.startsWith('$$')) return;
      const match = /^\$([^\n$]+?)\$/.exec(src);
      if (!match) return;
      return {
        type: 'mathInline',
        raw: match[0],
        text: match[1].trim(),
      };
    },
  };

  const mathBlockRenderer: RendererExtension = {
    name: 'mathBlock',
    renderer(token) {
      const text = String((token as any).text ?? '');
      return `<div class="md-math md-math-block">${katex.renderToString(text, { displayMode: true, throwOnError: false })}</div>`;
    },
  };

  const mathInlineRenderer: RendererExtension = {
    name: 'mathInline',
    renderer(token) {
      const text = String((token as any).text ?? '');
      return `<span class="md-math md-math-inline">${katex.renderToString(text, { displayMode: false, throwOnError: false })}</span>`;
    },
  };

  const renderer = new marked.Renderer();
  const originalTable = renderer.table;
  renderer.table = function (token) {
    return `<div class="md-table-wrap">${originalTable.call(this, token)}</div>`;
  };

  renderer.code = function ({ text, lang }) {
    const source = text ?? '';
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';

    let highlighted = escapeHtml(source);
    try {
      highlighted =
        language === 'plaintext'
          ? hljs.highlightAuto(source).value
          : hljs.highlight(source, { language }).value;
    } catch {
      // fallback to escaped source
    }

    return `<pre class="hljs md-code-block"><code class="hljs language-${language}">${highlighted}</code></pre>`;
  };

  marked.use({ extensions: [mathBlock, mathInline, mathBlockRenderer, mathInlineRenderer] });
  marked.setOptions({
    gfm: true,
    breaks: true,
    mangle: false,
    headerIds: true,
    renderer,
  });

  configured = true;
}

export function renderMarkdownPreview(markdown: string) {
  ensureConfigured();
  return marked.parse(markdown, { async: false }) as string;
}

