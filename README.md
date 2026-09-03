# hexo-recover

Rebuild the Markdown sources of a [Hexo](https://hexo.io) blog from its generated
HTML — and prove the rebuild is faithful by rendering it back and diffing.

You have `public/` (or the `.deploy_git` folder Hexo leaves behind, or the
`username.github.io` repo). You do not have `source/`. This gets it back.

```sh
pip install hexo-recover

hexo-recover recover ./belyenochi.github.io ./blog --url https://belyenochi.github.io
cd blog && npm install && npx hexo generate
hexo-recover verify ../belyenochi.github.io ./public
```

## What you get

```
blog/
  _config.yml          Hexo 8 site config; title/author/language/permalink/search read from the HTML
  _config.next.yml     NexT 8 theme config; menu, social links, avatar, excerpts, counters read from the HTML
  package.json         Hexo 8 + NexT 8 + the plugins the site evidently used
  source/_posts/*.md   one file per post, with title / date / categories / tags front matter
  source/images/       copied
  source/about/        if the site had one
  source/tags/  source/categories/   the index pages NexT needs
  RECOVERY-REPORT.json per-post inventory
```

Posts you do not want back online go to `_private/` (gitignored) with
`--private PATH=reason`, or nowhere at all with `--drop PATH=reason`. Both are
recorded in the report so the decision is on file.

## Why not a generic HTML→Markdown converter

Because they break exactly the things a Hexo site is made of. Each rule below
was found by rendering the recovered Markdown back through Hexo and diffing
against the original until every post matched:

| the markup | what a generic tool does | what this does |
|---|---|---|
| code as a `<table>` with a line-number gutter (`figure.highlight`) | numbers interleaved with code, or a Markdown table | reassemble lines from `span.line`, fence with the language |
| bare `<pre><code>` (indented code in the source, never highlighted) | a fence, which Hexo then highlights | 4-space indent, so it stays plain |
| heading anchors `<a class="headerlink">` | `[](#anchor)` litter | dropped |
| `<li><h5>` — a heading inside a list item | `- ##### text` on one line: hashes become text | heading on its own indented line |
| `<br>` inside a list item | continuation line un-indented: the list splits | indented continuation |
| `*`, `_`, `###`, `1.` that are literal in the text | left alone, so they become emphasis/headings/lists | escaped — but not inside headings, where `1. 前言` cannot be a list |
| `~` in prose | `\~` (old marked prints the backslash) or a strikethrough pair (new marked) | `&#126;` |
| `**[text]**` glued to a word | CommonMark refuses to open emphasis; asterisks print | `<strong>` |
| image file names with spaces | broken link | `%20` |
| bare text nodes outside `<p>` | lost or glued to the previous heading | a paragraph |

Everything else — headings, paragraphs, nested lists, tables, blockquotes,
links, images, inline code, emphasis — is straightforward and handled.

## Site settings recovered from the HTML

Nothing here is guessed from a template; each is read off the pages:

- title, author, language, avatar, description
- menu items and social links (NexT 5 markup and NexT 8 markup both)
- whether a `search.xml` was shipped → `hexo-generator-searchdb` + `local_search`
- whether the busuanzi counter was loaded → `busuanzi_count`
- **excerpt length**: the median length of the excerpts on the index pages,
  rounded to 10. NexT 5 cut at 150 by default and NexT 8 removed the feature;
  `hexo-auto-excerpt` with that length reproduces the index without a
  `<!-- more -->` in any post

## Verification

`hexo-recover verify ORIGINAL REGENERATED` compares every post's body:

- `ratio` — difflib similarity of visible text (gutters and read-more buttons
  removed, whitespace collapsed)
- `nospace` — identical once spaces are removed; the remaining differences are
  spaces around inline elements, which Markdown cannot always reproduce and
  which do not render
- structural tag counts (h1–h6, lists, tables, images, links, code figures,
  emphasis, blockquotes) must match exactly; `<p>` is excluded because bare text
  nodes become paragraphs

Exit code 0 only when every post is identical no-space and no structure
differs. On the 25-post site this was written for, that is the result on both
the original toolchain (Hexo 3.9, NexT 5.1.4) and the current one (Hexo 8,
NexT 8).

## Other themes

The converter is generic to Hexo's own markup (code figures come from Hexo, not
the theme). The selectors for the article body and title default to NexT's
(`.post-body`, `.post-title`); pass `--body-selector` / `--title-selector` for
another theme, e.g. landscape uses `.article-entry` / `.article-title`. Menu and
social extraction currently understands NexT's sidebar only.

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

MIT.
