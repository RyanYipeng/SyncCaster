import { Marked } from 'marked';

export type RenderMarkdownToHtmlForPasteOptions = {
  /**
   * Strip `$...$` and `$$...$$` wrappers.
   * Useful for platforms that don't support LaTeX rendering.
   */
  stripMath?: boolean;
};

const markedForPaste = new Marked({
  gfm: true,
  breaks: false,
  headerIds: false,
  mangle: false,
});

export function renderMarkdownToHtmlForPaste(markdown: string, options: RenderMarkdownToHtmlForPasteOptions = {}): string {
  let md = markdown || '';
  md = md.replace(/\r\n/g, '\n');

  if (options.stripMath) {
    md = md.replace(/\$([^$\n]+)\$/g, '$1');
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, '\n$1\n');
  }

  return String(markedForPaste.parse(md));
}

