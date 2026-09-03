// Each test is one rule from the README table, on the smallest HTML that
// exercises it. Same cases as python/tests/test_convert.py, by design: the two
// implementations must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { Converter } from '../src/convert.js';

const md = (html) => new Converter().convert(cheerio.load(`<div class="post-body">${html}</div>`)('.post-body').get(0));

test('highlight table becomes a fence with the language', () => {
  const html = '<figure class="highlight javascript"><table><tr>'
    + '<td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span></pre></td>'
    + '<td class="code"><pre><span class="line">const a = 1;</span><br>'
    + '<span class="line">  return a &amp;&amp; b;</span></pre></td></tr></table></figure>';
  assert.equal(md(html), '```javascript\nconst a = 1;\n  return a && b;\n```\n');
});

test('bare <pre> stays indented, not fenced', () => {
  assert.equal(md('<pre><code>S -&gt; F\nF -&gt; a</code></pre>'), '    S -> F\n    F -> a\n');
});

test('heading anchor dropped', () => {
  assert.equal(md('<h3 id="x"><a class="headerlink" href="#x" title="x"></a>1 目录</h3>'), '### 1 目录\n');
});

test('heading inside list item gets its own line', () => {
  assert.equal(md('<ul><li>intro<h5>Sub</h5><p>body</p></li></ul>'), '- intro\n  ##### Sub\n  body\n');
});

test('<br> inside list item keeps the list together', () => {
  const out = md('<ul><li>one<br>more</li><li>two</li></ul>');
  assert.equal(out.split('\n- ').length - 1, 1);
  assert.ok(out.startsWith('- one'));
  assert.ok(out.includes('\n  more'));
});

test('literal markers are escaped only where they bite', () => {
  assert.equal(md('<p>512*256 px</p>'), '512\\*256 px\n');
  assert.equal(md('<p>### not a heading</p>'), '\\### not a heading\n');
  assert.equal(md('<h3>1. 前言</h3>'), '### 1. 前言\n'); // no escape inside headings
});

test('tilde uses an entity', () => {
  assert.equal(md('<p>hi~ there~</p>'), 'hi&#126; there&#126;\n');
});

test('emphasis uses an HTML tag when CommonMark would not open or close', () => {
  assert.equal(md('<p>为何物<strong>[本篇]</strong></p>'), '为何物<strong>\\[本篇\\]</strong>\n');
  assert.equal(md('<p><strong>【英雄难度】</strong>parser</p>'), '<strong>【英雄难度】</strong>parser\n');
  assert.equal(md('<p>a <strong>bold</strong> word</p>'), 'a **bold** word\n');
  assert.equal(md('<p>说，<strong>基本原则</strong>是少</p>'), '说，**基本原则**是少\n');
  assert.equal(md('<p><strong>【英雄难度】</strong> parser</p>'), '**【英雄难度】** parser\n');
});

test('image space percent-encoded', () => {
  assert.equal(md('<p><img src="/images/a b.jpg" alt="x"></p>'), '![x](/images/a%20b.jpg)\n');
});

test('bare text node becomes a paragraph', () => {
  assert.equal(md('<h3>T</h3>loose text<p>para</p>'), '### T\n\nloose text\n\npara\n');
});

test('table', () => {
  assert.equal(md('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>x|y</td></tr></table>'),
    '| a | b |\n|---|---|\n| 1 | x\\|y |\n');
});

test('tag and category links become plain text', () => {
  assert.equal(md('<p>see <a href="/tags/parser/">parser</a> and <a href="https://x/">x</a></p>'),
    'see parser and [x](https://x/)\n');
});
