/**
 * HTML -> Markdown, written against the markup Hexo and the NexT theme emit.
 *
 * Generic HTML-to-Markdown converters mangle exactly the parts a Hexo site is
 * made of: code blocks are a <table> with a line-number gutter, every heading
 * carries an anchor <a>, headings and hard breaks appear inside list items.
 * This converter knows those shapes and escapes only what would change meaning
 * in Markdown, because over-escaped Markdown is unpleasant to keep editing --
 * and the whole point of recovering the source is to edit it.
 *
 * Every rule here was earned against a real 25-post site, rendered back
 * through Hexo and diffed against the original HTML until every article body
 * matched. Comments say which rule fixed which failure. The Python
 * implementation in python/ is the reference; scripts/parity.js checks the two
 * produce byte-identical Markdown.
 *
 * Nodes are domhandler nodes as produced by cheerio: {type, name, attribs,
 * children, prev, next, data}.
 */

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Characters that are literal in the rendered HTML but would be markup in
// Markdown. No `~`: old marked does not treat `\~` as an escape and prints the
// backslash; new marked turns a pair into strikethrough. It becomes an entity.
const INLINE_ESC = /([*_`\\[\]])/g;
const LINE_START_ESC = /^(\s*)(#{1,6}|[>+-]|\d+\.)(\s)/m;

const isText = (n) => n && n.type === 'text';
const isTag = (n) => n && n.type === 'tag';
const classes = (n) => (n.attribs && n.attribs.class ? n.attribs.class.split(/\s+/).filter(Boolean) : []);
const attr = (n, k) => (n.attribs && n.attribs[k]) || '';

/** All descendant text, concatenated (cheerio decodes entities once). */
export function getText(n) {
  if (isText(n)) return n.data;
  if (!n.children) return '';
  let s = '';
  for (const c of n.children) s += getText(c);
  return s;
}

function findFirst(n, pred) {
  if (!n.children) return null;
  for (const c of n.children) {
    if (pred(c)) return c;
    const r = findFirst(c, pred);
    if (r) return r;
  }
  return null;
}

function findAll(n, pred, out = []) {
  if (!n.children) return out;
  for (const c of n.children) {
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

const isPunct = (ch) => !!ch && (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(ch) || /\p{P}/u.test(ch));

export class Converter {
  convert(node) {
    let out = '';
    for (const c of node.children || []) out += this.block(c);
    out = out.replace(/\n{3,}/g, '\n\n');
    // Strip newlines only: a document that opens with an indented code block
    // must keep the four spaces on its first line.
    return out.replace(/^\n+|\n+$/g, '') + '\n';
  }

  // ------------------------------------------------------------------ blocks
  block(n) {
    if (isText(n)) {
      // Bare text at block level: hexo-renderer-marked emits this when a
      // heading is followed by text without a blank line in the source. It is
      // a paragraph in every sense but the tag.
      const t = this.guardLineStart(this.text(n).trim());
      return t ? t + '\n\n' : '';
    }
    if (!isTag(n)) return '';
    const name = n.name;
    if (HEADINGS.has(name)) return '#'.repeat(+name[1]) + ' ' + this.inlineChildren(n).trim() + '\n\n';
    if (name === 'p') {
      const body = this.guardLineStart(this.inlineChildren(n).trim());
      return body ? body + '\n\n' : '';
    }
    if (name === 'figure' && classes(n).includes('highlight')) return this.codeFigure(n);
    if (name === 'pre') {
      // A bare <pre><code> with no highlight figure around it is what marked
      // emits for an INDENTED code block; Hexo only runs the highlighter on
      // fenced ones. Re-emit it indented so the re-render is a bare <pre> too.
      const code = getText(n).replace(/\n+$/, '');
      return code.split('\n').map((ln) => (ln ? '    ' + ln : '')).join('\n') + '\n\n';
    }
    if (name === 'ul' || name === 'ol') return this.list(n, name === 'ol', 0) + '\n';
    if (name === 'blockquote') {
      let inner = '';
      for (const c of n.children) inner += this.block(c);
      inner = inner.trim();
      return inner.split('\n').map((ln) => (ln ? '> ' + ln : '>')).join('\n') + '\n\n';
    }
    if (name === 'table') return this.table(n);
    if (name === 'hr') return '---\n\n';
    if (name === 'div') {
      let s = '';
      for (const c of n.children) s += this.block(c);
      return s;
    }
    if (name === 'img') return this.img(n) + '\n\n';
    if (name === 'br') return '\n';
    if (name === 'script' || name === 'style') return '';
    const t = this.inline(n).trim();
    return t ? t + '\n\n' : '';
  }

  codeFigure(fig) {
    let lang = '';
    for (const c of classes(fig)) if (c !== 'highlight') lang = c;
    if (lang === 'plain') lang = '';
    const caption = findFirst(fig, (c) => isTag(c) && c.name === 'figcaption');
    const cap = caption ? getText(caption).replace(/\s+/g, ' ').trim() : '';
    const codeTd = findFirst(fig, (c) => isTag(c) && c.name === 'td' && classes(c).includes('code'));
    let code;
    if (!codeTd) {
      const pre = findFirst(fig, (c) => isTag(c) && c.name === 'pre');
      code = pre ? getText(pre) : getText(fig);
    } else {
      const lines = findAll(codeTd, (c) => isTag(c) && c.name === 'span' && classes(c).includes('line'));
      code = lines.length ? lines.map((l) => getText(l)).join('\n') : getText(codeTd);
    }
    code = code.replace(/\n+$/, '');
    let fence = '```';
    while (code.includes(fence)) fence += '`';
    const head = fence + lang + (cap ? ' ' + cap : '');
    return `${head}\n${code}\n${fence}\n\n`;
  }

  /**
   * Each <li> becomes one or more lines. Inline runs are joined into the first
   * line; block children (headings, nested lists, code, further paragraphs) go
   * on their own lines indented under the marker, so the renderer re-parses
   * them as blocks inside the item. A heading glued onto the item text on one
   * line is just text with hashes in it.
   */
  list(lst, ordered, depth) {
    const out = [];
    let i = 0;
    for (const li of lst.children.filter((c) => isTag(c) && c.name === 'li')) {
      i += 1;
      const marker = ordered ? `${i}. ` : '- ';
      const pad = ' '.repeat(marker.length);
      const blocks = [];
      let run = [];
      const flush = () => {
        // Concatenate as the DOM had it; text nodes carry their own spaces. A
        // hard break ("  \n" from <br>) must survive, so it is protected while
        // runs of spaces are collapsed.
        let s = run.join('').split('  \n').join('\0');
        s = s.replace(/[ \t]+/g, ' ').trim().split('\0').join('  \n');
        if (s) blocks.push(s);
        run = [];
      };
      for (const c of li.children) {
        if (isTag(c) && (c.name === 'ul' || c.name === 'ol')) {
          flush();
          blocks.push(this.list(c, c.name === 'ol', 0).replace(/\n+$/, ''));
        } else if (isTag(c) && HEADINGS.has(c.name)) {
          flush();
          blocks.push('#'.repeat(+c.name[1]) + ' ' + this.inlineChildren(c).trim());
        } else if (isTag(c) && c.name === 'figure') {
          flush();
          blocks.push(this.codeFigure(c).replace(/\n+$/, ''));
        } else if (isTag(c) && c.name === 'pre') {
          flush();
          blocks.push(this.block(c).replace(/\n+$/, ''));
        } else if (isTag(c) && (c.name === 'p' || c.name === 'div')) {
          flush();
          blocks.push(this.inlineChildren(c).trim());
        } else if (isTag(c) && c.name === 'br') {
          run.push('  \n');
        } else {
          run.push(isTag(c) ? this.inline(c) : this.text(c));
        }
      }
      flush();
      if (!blocks.length) blocks.push('');
      const [first, ...rest] = blocks;
      // A <br> inside the item yields "  \n"; the continuation must be
      // indented under the marker or it ends the list.
      const firstLines = first.split('\n');
      const lines = [marker + firstLines[0], ...firstLines.slice(1).map((ln) => (ln.trim() ? pad + ln : ''))];
      for (const b of rest) for (const ln of b.split('\n')) lines.push(ln ? pad + ln : '');
      out.push(lines.join('\n'));
    }
    const body = out.join('\n');
    return depth ? this.indent(body, depth) + '\n' : body + '\n';
  }

  indent(s, depth) {
    const pad = '  '.repeat(depth);
    return s.split('\n').map((ln) => (ln ? pad + ln : ln)).join('\n');
  }

  table(t) {
    const rows = [];
    for (const tr of findAll(t, (c) => isTag(c) && c.name === 'tr')) {
      const cells = tr.children
        .filter((c) => isTag(c) && (c.name === 'th' || c.name === 'td'))
        .map((td) => this.inlineChildren(td).trim().split('|').join('\\|').split('\n').join(' '));
      rows.push(cells);
    }
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    for (const r of rows) while (r.length < width) r.push('');
    const [head, ...body] = rows;
    const lines = ['| ' + head.join(' | ') + ' |', '|' + '---|'.repeat(width)];
    for (const r of body) lines.push('| ' + r.join(' | ') + ' |');
    return lines.join('\n') + '\n\n';
  }

  // ------------------------------------------------------------------ inline
  inlineChildren(n) {
    let s = '';
    for (const c of n.children || []) s += isTag(c) ? this.inline(c) : this.text(c);
    return s;
  }

  inline(n) {
    const name = n.name;
    const cls = classes(n);
    if (name === 'a') {
      if (cls.includes('headerlink')) return ''; // theme heading anchor: drop it
      const href = attr(n, 'href');
      const txt = this.inlineChildren(n);
      if (!txt.trim()) return '';
      if (href.startsWith('/tags/') || href.startsWith('/categories/')) return txt;
      return `[${txt}](${href})`;
    }
    if (name === 'img') return this.img(n);
    if (name === 'strong' || name === 'b') return this.emphasis(n, '**', 'strong');
    if (name === 'em' || name === 'i') {
      if (cls.some((c) => c.startsWith('fa'))) return ''; // icon fonts
      return this.emphasis(n, '*', 'em');
    }
    if (name === 'del' || name === 's') return '~~' + this.inlineChildren(n).trim() + '~~';
    if (name === 'code') {
      const t = getText(n);
      const longest = Math.max(0, ...(t.match(/`+/g) || []).map((m) => m.length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}${t}${fence}`;
    }
    if (name === 'br') return '  \n';
    if (name === 'span' && cls.includes('line')) return getText(n);
    if (['sup', 'sub', 'kbd', 'mark'].includes(name)) return `<${name}>${this.inlineChildren(n)}</${name}>`;
    if (['figure', 'pre', 'ul', 'ol', 'table', 'blockquote', 'div', 'p'].includes(name)) return this.block(n);
    return this.inlineChildren(n);
  }

  /**
   * `**text**` when CommonMark will accept it; an HTML tag otherwise.
   *
   * The delimiter run has to be left-flanking to open and right-flanking to
   * close, and Chinese prose trips both rules constantly: 为何物**[本篇]**
   * (opener followed by punctuation but preceded by a word) and
   * **【英雄难度】**parser (closer preceded by punctuation, followed by a word).
   * Old marked ignored the rules; the current one follows them and prints the
   * asterisks. The HTML tag says the same thing in both and keeps the text
   * byte-identical, so it is used exactly when the Markdown form would not
   * render. Unicode P* counts as punctuation, so ，。（）【】 behave like ASCII.
   */
  emphasis(n, marks, tag) {
    const inner = this.inlineChildren(n).trim();
    if (!inner) return '';
    const before = isText(n.prev) ? n.prev.data.slice(-1) : '';
    const after = isText(n.next) ? n.next.data.slice(0, 1) : '';
    const first = inner[0];
    const last = inner[inner.length - 1];
    const ws = (c) => /\s/.test(c);
    const canOpen = !ws(first) && (!isPunct(first) || before === '' || ws(before) || isPunct(before));
    const canClose = !ws(last) && (!isPunct(last) || after === '' || ws(after) || isPunct(after));
    return canOpen && canClose ? `${marks}${inner}${marks}` : `<${tag}>${inner}</${tag}>`;
  }

  img(n) {
    // A bare space ends the URL in Markdown and the image renders as text.
    const src = (attr(n, 'data-src') || attr(n, 'src')).split(' ').join('%20');
    const alt = attr(n, 'alt') || attr(n, 'title');
    return `![${alt}](${src})`;
  }

  text(s) {
    let t = s.data.replace(/[ \t\r\f\v]+/g, ' ').split('\n').join(' ');
    t = t.replace(INLINE_ESC, '\\$1');
    return t.split('~').join('&#126;');
  }

  /**
   * Escape a leading heading/list marker. Only for text that will sit at the
   * start of a paragraph line: inside a heading "1. 前言" cannot be a list, and
   * escaping it there puts a literal backslash into the page.
   */
  guardLineStart(t) {
    return t.replace(LINE_START_ESC, '$1\\$2$3');
  }
}
