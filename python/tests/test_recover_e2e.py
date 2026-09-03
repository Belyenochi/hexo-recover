"""End to end on a two-post fake site: the smallest generated site that has
every kind of thing recover() reads, run through the real entry point."""
import json
from pathlib import Path

from hexo_recover.recover import Options, recover
from hexo_recover.verify import verify

POST = """<!DOCTYPE html><html lang="zh-Hans"><head><title>{title} | Fake</title>
<meta name="generator" content="Hexo 3.9.0"></head><body>
<div class="post-body">
<h3 id="a"><a class="headerlink" href="#a"></a>{title}</h3>
<p>正文，<strong>加粗</strong>和 <code>code</code>。</p>
<figure class="highlight javascript"><table><tr><td class="gutter"><pre><span class="line">1</span></pre></td>
<td class="code"><pre><span class="line">let x = 1;</span></pre></td></tr></table></figure>
<ul><li>one<br>two</li><li>three</li></ul>
<p><img src="/images/a b.png" alt="pic"></p>
</div>
<footer class="post-footer"></footer>
<div class="post-meta"><span class="post-meta-item"><time datetime="{date}">x</time></span>
<span class="post-category"><a href="/categories/编译原理/">编译原理</a></span></div>
<div class="post-tags"><a href="/tags/parser/"># parser</a></div>
<h1 class="post-title">{title}</h1>
</body></html>"""

INDEX = """<html lang="zh-Hans"><head><title>Fake</title></head><body>
<a class="site-title">Fake Blog</a><img class="site-author-image" src="/images/avatar.jpg">
<p class="site-author-name">Jason</p>
<ul class="menu"><li class="menu-item"><a href="/">首页</a></li><li class="menu-item"><a href="/archives/">归档</a></li></ul>
<span class="links-of-author-item"><a href="https://github.com/x" title="GitHub">GitHub</a></span>
{articles}
<script src="busuanzi.js"></script></body></html>"""

ARTICLE = """<article><a class="post-title-link" href="/{path}/">{title}</a>
<div class="post-body">{excerpt}<div class="post-button"><a class="btn" href="/{path}/#more">阅读全文 »</a></div></div></article>"""


def make_site(root: Path):
    posts = [("2018/09/06/parser_04", "Parser篇(四)", "2018-09-06T21:39:10+08:00"),
             ("2021/05/19/love", "私信", "2021-05-19T20:00:00+08:00"),
             ("2021/08/29/8.22", "周报", "2021-08-29T09:00:00+08:00")]
    for path, title, date in posts:
        d = root / path
        d.mkdir(parents=True)
        (d / "index.html").write_text(POST.format(title=title, date=date), encoding="utf-8")
    arts = "".join(ARTICLE.format(path=p, title=t, excerpt="摘" * 150) for p, t, _ in posts)
    (root / "index.html").write_text(INDEX.format(articles=arts), encoding="utf-8")
    (root / "search.xml").write_text("<search/>", encoding="utf-8")
    (root / "images").mkdir()
    (root / "images" / "a b.png").write_bytes(b"png")
    (root / "images" / "avatar.jpg").write_bytes(b"jpg")
    for page in ("about", "tags", "categories"):
        (root / page).mkdir()
        (root / page / "index.html").write_text(
            '<html><body><h1 class="post-title">%s</h1><div class="post-body"><p>hi</p></div></body></html>' % page,
            encoding="utf-8")


def test_recover_end_to_end(tmp_path):
    site, out = tmp_path / "site", tmp_path / "out"
    make_site(site)
    rep = recover(str(site), str(out), Options(
        url="https://fake.example",
        private={"2021/05/19/love": "personal"},
        drop={"2021/08/29/8.22": "not a post"}))

    posts = sorted(p.name for p in (out / "source/_posts").glob("*.md"))
    assert posts == ["parser_04.md"]
    assert (out / "_private/love.md").exists()
    assert not list(out.rglob("8.22*"))
    assert [d["path"] for d in rep["dropped"]] == ["2021/08/29/8.22"]

    md = (out / "source/_posts/parser_04.md").read_text(encoding="utf-8")
    assert md.startswith('---\ntitle: "Parser篇(四)"\ndate: 2018-09-06 21:39:10\ncategories:\n  - "编译原理"\ntags:\n  - "parser"\n---\n')
    assert "```javascript\nlet x = 1;\n```" in md
    assert "- one  \n  two\n- three" in md
    assert "![pic](/images/a%20b.png)" in md
    assert "<!-- more -->" not in md

    assert (out / "source/images/a b.png").exists()
    assert (out / "source/about/index.md").exists()
    assert (out / "source/tags/index.md").read_text().count("type: tags") == 1

    cfg = (out / "_config.yml").read_text(encoding="utf-8")
    assert 'title: "Fake Blog"' in cfg and 'author: "Jason"' in cfg
    assert 'language: "zh-CN"' in cfg            # zh-Hans mapped for NexT 8
    assert "url: https://fake.example" in cfg
    assert "excerpt_length: 150" in cfg          # measured from the index, not assumed
    assert "search:" in cfg                      # search.xml was present
    theme = (out / "_config.next.yml").read_text(encoding="utf-8")
    assert "home: / || fa fa-home" in theme and "archives: /archives/ || fa fa-archive" in theme
    assert "GitHub: https://github.com/x || fab fa-github" in theme
    assert "avatar:\n  url: /images/avatar.jpg" in theme
    assert "busuanzi_count:\n  enable: true" in theme
    pkg = json.loads((out / "package.json").read_text())
    assert "hexo-auto-excerpt" in pkg["dependencies"] and "hexo-generator-searchdb" in pkg["dependencies"]


def test_verify_is_zero_for_identical_sites(tmp_path, capsys):
    site = tmp_path / "site"
    make_site(site)
    assert verify(str(site), str(site)) == 0
    out = capsys.readouterr().out
    assert "identical no-space : 3" in out and "structure diffs    : 0" in out
