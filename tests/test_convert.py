"""Each test is one rule from the README table, on the smallest HTML that
exercises it. They are the regression net for the converter; the end-to-end
check is `hexo-recover verify` against a real site."""
from bs4 import BeautifulSoup

from hexo_recover.convert import Converter


def md(html: str) -> str:
    soup = BeautifulSoup(f'<div class="post-body">{html}</div>', "lxml")
    return Converter().convert(soup.select_one(".post-body"))


def test_highlight_table_becomes_fence_with_language():
    html = ('<figure class="highlight javascript"><table><tr>'
            '<td class="gutter"><pre><span class="line">1</span><br><span class="line">2</span></pre></td>'
            '<td class="code"><pre><span class="line">const a = 1;</span><br>'
            '<span class="line">  return a &amp;&amp; b;</span></pre></td></tr></table></figure>')
    assert md(html) == "```javascript\nconst a = 1;\n  return a && b;\n```\n"


def test_bare_pre_stays_indented_not_fenced():
    assert md("<pre><code>S -&gt; F\nF -&gt; a</code></pre>") == "    S -> F\n    F -> a\n"


def test_heading_anchor_dropped():
    html = '<h3 id="x"><a class="headerlink" href="#x" title="x"></a>1 目录</h3>'
    assert md(html) == "### 1 目录\n"


def test_heading_inside_list_item_gets_own_line():
    html = "<ul><li>intro<h5>Sub</h5><p>body</p></li></ul>"
    assert md(html) == "- intro\n  ##### Sub\n  body\n"


def test_br_inside_list_item_keeps_list_together():
    html = "<ul><li>one<br>more</li><li>two</li></ul>"
    out = md(html)
    assert out.count("\n- ") == 1 and out.startswith("- one")
    assert "\n  more" in out


def test_literal_markers_are_escaped_only_where_they_bite():
    assert md("<p>512*256 px</p>") == "512\\*256 px\n"
    assert md("<p>### not a heading</p>") == "\\### not a heading\n"
    assert md("<h3>1. 前言</h3>") == "### 1. 前言\n"          # no escape inside headings


def test_tilde_uses_entity():
    assert md("<p>hi~ there~</p>") == "hi&#126; there&#126;\n"


def test_emphasis_uses_html_tag_when_commonmark_would_not_open_or_close():
    # opener followed by punctuation, preceded by a word: cannot open
    assert md("<p>为何物<strong>[本篇]</strong></p>") == "为何物<strong>\\[本篇\\]</strong>\n"
    # closer preceded by punctuation 】, followed by a word: cannot close
    assert md("<p><strong>【英雄难度】</strong>parser</p>") == "<strong>【英雄难度】</strong>parser\n"
    # both flanks fine: plain Markdown, including CJK punctuation on the outside
    assert md("<p>a <strong>bold</strong> word</p>") == "a **bold** word\n"
    assert md("<p>说，<strong>基本原则</strong>是少</p>") == "说，**基本原则**是少\n"
    assert md("<p><strong>【英雄难度】</strong> parser</p>") == "**【英雄难度】** parser\n"


def test_image_space_percent_encoded():
    assert md('<p><img src="/images/a b.jpg" alt="x"></p>') == "![x](/images/a%20b.jpg)\n"


def test_bare_text_node_becomes_paragraph():
    assert md("<h3>T</h3>loose text<p>para</p>") == "### T\n\nloose text\n\npara\n"


def test_table():
    html = "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>x|y</td></tr></table>"
    assert md(html) == "| a | b |\n|---|---|\n| 1 | x\\|y |\n"


def test_tag_and_category_links_become_plain_text():
    assert md('<p>see <a href="/tags/parser/">parser</a> and <a href="https://x/">x</a></p>') == \
        "see parser and [x](https://x/)\n"
