/**
 * Compare a regenerated site against the original, post by post.
 *
 * This is the evidence that the recovered Markdown is faithful: not "the
 * converter ran without errors" but "rendering the recovered sources back
 * through Hexo produces the same article body".
 *
 * Three measures per post:
 *   ratio    similarity of the visible body text (Python difflib's
 *            SequenceMatcher.ratio, ported without the autojunk heuristic), with
 *            line-number gutters and read-more buttons removed and whitespace
 *            collapsed
 *   nospace  whether the text is identical once all spaces are removed -- the
 *            remaining differences are spaces around inline elements, which
 *            Markdown cannot always reproduce and which do not render
 *   struct   count of each structural tag; <p> is excluded because bare text
 *            nodes in the original become paragraphs in Markdown, which is not
 *            a content difference
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'img', 'a',
  'figure.highlight', 'pre', 'code', 'strong', 'em', 'blockquote'];

function body(p, selector) {
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const el = $(selector).first();
  return el.length ? { $, el } : null;
}

function text({ $, el }) {
  el.find('a.btn').remove();
  el.find('td.gutter').remove();
  return el.text().replace(/\s+/g, ' ').trim();
}

const struct = ({ el }) => Object.fromEntries(TAGS.map((k) => [k, el.find(k).length]));

/** difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() */
export function ratio(a, b) {
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(j);
  }
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  const total = a.length + b.length;
  return total ? (2 * matches) / total : 1;
}

function* postPages(root) {
  const walk = (dir, depth) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (depth < 3) { if (/^\d+$/.test(e.name)) out.push(...walk(p, depth + 1)); }
      else if (fs.existsSync(path.join(p, 'index.html'))) out.push(path.join(p, 'index.html'));
    }
    return out;
  };
  yield* walk(root, 0);
}

export function verify(origDir, newDir, bodySelector = '.post-body', log = console.log) {
  const orig = path.resolve(origDir);
  const nw = path.resolve(newDir);
  const rows = [];
  const badStruct = [];
  for (const page of postPages(nw)) {
    const rel = path.relative(nw, path.dirname(page)).split(path.sep).join('/');
    const old = path.join(orig, rel, 'index.html');
    if (!fs.existsSync(old)) { rows.push([rel, null, false, 'not in original']); continue; }
    const eo = body(old, bodySelector);
    const en = body(page, bodySelector);
    if (!eo || !en) { rows.push([rel, null, false, `no ${bodySelector}`]); continue; }
    const sa = struct(eo);
    const sb = struct(en);
    const a = text(eo);
    const b = text(en);
    rows.push([rel, ratio(a, b), a.split(' ').join('') === b.split(' ').join(''), '']);
    const d = {};
    for (const k of TAGS) if (sa[k] !== sb[k]) d[k] = [sa[k], sb[k]];
    if (Object.keys(d).length) badStruct.push([rel, d]);
  }
  const scored = rows.filter((r) => r[1] !== null);
  log(`${'post'.padEnd(44)} ${'ratio'.padStart(7)}  nospace`);
  for (const [rel, r, same, note] of [...rows].sort((x, y) => (x[1] === null) - (y[1] === null) || (x[1] || 0) - (y[1] || 0))) {
    log(`${rel.padEnd(44)} ${(r === null ? '   -   ' : r.toFixed(4)).padStart(7)}  ${same ? 'yes' : 'NO '}  ${note}`);
  }
  log('');
  log(`posts compared     : ${scored.length}`);
  log(`text identical     : ${scored.filter((r) => r[1] === 1).length}`);
  log(`identical no-space : ${scored.filter((r) => r[2]).length}`);
  if (scored.length) log(`mean ratio         : ${(scored.reduce((s, r) => s + r[1], 0) / scored.length).toFixed(4)}`);
  log(`structure diffs    : ${badStruct.length}`);
  for (const [rel, d] of badStruct) log(`  ${rel}: ${JSON.stringify(d)}`);
  return scored.length && scored.every((r) => r[2]) && !badStruct.length ? 0 : 1;
}
