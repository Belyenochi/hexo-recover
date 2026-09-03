# hexo-recover

[![PyPI](https://img.shields.io/pypi/v/hexo-recover.svg)](https://pypi.org/project/hexo-recover/)
[![CI](https://github.com/Belyenochi/hexo-recover/actions/workflows/ci.yml/badge.svg)](https://github.com/Belyenochi/hexo-recover/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Get the Markdown sources of a [Hexo](https://hexo.io) blog back from its generated HTML.

## When you need this

You have the published site — the `public/` folder, the `.deploy_git` folder
Hexo leaves behind, or the `username.github.io` repository — and the `source/`
folder with the Markdown is gone. Laptop died, repo was never pushed, backup
turned out to hold only a fresh `hexo init`. Rewriting posts by hand from the
rendered pages is slow and loses code blocks, tables and list structure.

`hexo-recover` converts every post page back into Markdown with its front
matter, copies the images, reconstructs the site and theme config from what the
pages reveal, and gives you a `verify` command that renders the result back
through Hexo and diffs it against the original so you know nothing was lost.

## Usage

```sh
pip install hexo-recover

# 1. generated site -> Hexo project
hexo-recover recover ./my-site-html ./blog --url https://you.github.io

# 2. build it
cd blog && npm install && npx hexo generate

# 3. prove it matches the original
hexo-recover verify ../my-site-html ./public
```

Step 1 writes:

```
blog/
  _config.yml          Hexo 8 site config — title, author, language, permalink shape read from the pages
  _config.next.yml     NexT 8 theme config — menu, social links, avatar, excerpt length, counters
  package.json         Hexo 8, NexT 8 and the plugins the site evidently used
  source/_posts/*.md   one file per post: title / date / categories / tags + body
  source/images/       copied
  source/about/, source/tags/, source/categories/
  RECOVERY-REPORT.json what was recovered, what was skipped, and why
```

Step 3 exits 0 only when every post body is identical to the original once
spaces are removed and every structural tag count (headings, lists, tables,
images, links, code blocks, emphasis) matches.

### Options

| flag | |
|---|---|
| `--url URL` | site URL for `_config.yml` (default: `<link rel=canonical>` if present) |
| `--private PATH=WHY` | write this post to `_private/` (gitignored) instead of publishing it; repeatable |
| `--drop PATH=WHY` | leave this post out entirely; repeatable |
| `--theme next\|landscape` | selector preset for the theme's post markup (default `next`) |
| `--body-selector` / `--title-selector` | override the preset for another theme |
| `--post-glob` | where post pages live (default `YYYY/MM/DD/slug/index.html`) |

`PATH` is the post's URL path, e.g. `2021/05/19/love`. Both lists end up in the
report, so the decision to leave something out is on file.

## What it gets right that generic HTML→Markdown tools do not

Hexo renders code as a `<table>` with a line-number gutter; headings carry
anchor links; headings and hard breaks appear inside list items; `*`, `_`,
`###`, `1.` and `~` occur as literal text; CommonMark refuses emphasis that old
renderers accepted. Each of these is handled, and each rule is pinned by a unit
test. The converter escapes only what would change meaning, so the recovered
Markdown stays pleasant to edit — which is the point of recovering it.

## Limits

- Menu and social-link extraction understands the NexT sidebar; other themes
  get correct posts and a default theme config.
- Posts are found by the date-based permalink shape unless `--post-glob` says
  otherwise.
- `verify` needs the rebuilt site; it does not run Hexo for you.

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

MIT.
