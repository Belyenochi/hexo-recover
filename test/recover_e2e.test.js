// End to end on a three-post fake site: the smallest generated site that has
// every kind of thing recover() reads. Same fixture as python/tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recover, defaultOptions } from '../src/recover.js';
import { verify } from '../src/verify.js';

const POST = (title, date) => `<!DOCTYPE html><html lang="zh-Hans"><head><title>${title} | Fake</title>
<meta name="generator" content="Hexo 3.9.0"></head><body>
<div class="post-body">
<h3 id="a"><a class="headerlink" href="#a"></a>${title}</h3>
<p>正文，<strong>加粗</strong>和 <code>code</code>。</p>
<figure class="highlight javascript"><table><tr><td class="gutter"><pre><span class="line">1</span></pre></td>
<td class="code"><pre><span class="line">let x = 1;</span></pre></td></tr></table></figure>
<ul><li>one<br>two</li><li>three</li></ul>
<p><img src="/images/a b.png" alt="pic"></p>
</div>
<footer class="post-footer"></footer>
<div class="post-meta"><span class="post-meta-item"><time datetime="${date}">x</time></span>
<span class="post-category"><a href="/categories/编译原理/">编译原理</a></span></div>
<div class="post-tags"><a href="/tags/parser/"># parser</a></div>
<h1 class="post-title">${title}</h1>
</body></html>`;

const ARTICLE = (p, t) => `<article><a class="post-title-link" href="/${p}/">${t}</a>
<div class="post-body">${'摘'.repeat(150)}<div class="post-button"><a class="btn" href="/${p}/#more">阅读全文 »</a></div></div></article>`;

const INDEX = (articles) => `<html lang="zh-Hans"><head><title>Fake</title></head><body>
<a class="site-title">Fake Blog</a><img class="site-author-image" src="/images/avatar.jpg">
<p class="site-author-name">Jason</p>
<ul class="menu"><li class="menu-item"><a href="/">首页</a></li><li class="menu-item"><a href="/archives/">归档</a></li></ul>
<span class="links-of-author-item"><a href="https://github.com/x" title="GitHub">GitHub</a></span>
${articles}
<script src="busuanzi.js"></script></body></html>`;

const POSTS = [
  ['2018/09/06/parser_04', 'Parser篇(四)', '2018-09-06T21:39:10+08:00'],
  ['2021/05/19/love', '私信', '2021-05-19T20:00:00+08:00'],
  ['2021/08/29/8.22', '周报', '2021-08-29T09:00:00+08:00'],
];

export function makeSite(root) {
  for (const [p, t, d] of POSTS) {
    fs.mkdirSync(path.join(root, p), { recursive: true });
    fs.writeFileSync(path.join(root, p, 'index.html'), POST(t, d));
  }
  fs.writeFileSync(path.join(root, 'index.html'), INDEX(POSTS.map(([p, t]) => ARTICLE(p, t)).join('')));
  fs.writeFileSync(path.join(root, 'search.xml'), '<search/>');
  fs.mkdirSync(path.join(root, 'images'));
  fs.writeFileSync(path.join(root, 'images', 'a b.png'), 'png');
  fs.writeFileSync(path.join(root, 'images', 'avatar.jpg'), 'jpg');
  for (const page of ['about', 'tags', 'categories']) {
    fs.mkdirSync(path.join(root, page));
    fs.writeFileSync(path.join(root, page, 'index.html'),
      `<html><body><h1 class="post-title">${page}</h1><div class="post-body"><p>hi</p></div></body></html>`);
  }
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hexo-recover-'));
const rd = (p) => fs.readFileSync(p, 'utf8');

test('recover end to end', () => {
  const root = tmp();
  const site = path.join(root, 'site');
  const out = path.join(root, 'out');
  makeSite(site);
  const opt = defaultOptions();
  opt.url = 'https://fake.example';
  opt.private = { '2021/05/19/love': 'personal' };
  opt.drop = { '2021/08/29/8.22': 'not a post' };
  const rep = recover(site, out, opt);

  assert.deepEqual(fs.readdirSync(path.join(out, 'source/_posts')).sort(), ['parser_04.md']);
  assert.ok(fs.existsSync(path.join(out, '_private/love.md')));
  assert.ok(!fs.existsSync(path.join(out, 'source/_posts/8.22.md')) && !fs.existsSync(path.join(out, '_private/8.22.md')));
  assert.deepEqual(rep.dropped.map((d) => d.path), ['2021/08/29/8.22']);

  const md = rd(path.join(out, 'source/_posts/parser_04.md'));
  assert.ok(md.startsWith('---\ntitle: "Parser篇(四)"\ndate: 2018-09-06 21:39:10\ncategories:\n  - "编译原理"\ntags:\n  - "parser"\n---\n'));
  assert.ok(md.includes('```javascript\nlet x = 1;\n```'));
  assert.ok(md.includes('- one  \n  two\n- three'));
  assert.ok(md.includes('![pic](/images/a%20b.png)'));
  assert.ok(!md.includes('<!-- more -->'));

  assert.ok(fs.existsSync(path.join(out, 'source/images/a b.png')));
  assert.ok(fs.existsSync(path.join(out, 'source/about/index.md')));
  assert.equal(rd(path.join(out, 'source/tags/index.md')).split('type: tags').length - 1, 1);

  const cfg = rd(path.join(out, '_config.yml'));
  assert.ok(cfg.includes('title: "Fake Blog"') && cfg.includes('author: "Jason"'));
  assert.ok(cfg.includes('language: "zh-CN"'));          // zh-Hans mapped for NexT 8
  assert.ok(cfg.includes('url: https://fake.example'));
  assert.ok(cfg.includes('excerpt_length: 150'));        // measured from the index, not assumed
  assert.ok(cfg.includes('search:'));                    // search.xml was present
  const theme = rd(path.join(out, '_config.next.yml'));
  assert.ok(theme.includes('home: / || fa fa-home') && theme.includes('archives: /archives/ || fa fa-archive'));
  assert.ok(theme.includes('GitHub: https://github.com/x || fab fa-github'));
  assert.ok(theme.includes('avatar:\n  url: /images/avatar.jpg'));
  assert.ok(theme.includes('busuanzi_count:\n  enable: true'));
  const pkg = JSON.parse(rd(path.join(out, 'package.json')));
  assert.ok('hexo-auto-excerpt' in pkg.dependencies && 'hexo-generator-searchdb' in pkg.dependencies);
});

test('verify is zero for identical sites', () => {
  const site = path.join(tmp(), 'site');
  makeSite(site);
  const lines = [];
  assert.equal(verify(site, site, '.post-body', (s) => lines.push(s)), 0);
  const out = lines.join('\n');
  assert.ok(out.includes('identical no-space : 3') && out.includes('structure diffs    : 0'));
});
