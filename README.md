<h1 align="center">hexo-recover</h1>

<p align="center">
  Get the Markdown sources of a <a href="https://hexo.io">Hexo</a> blog back from its generated HTML — and prove nothing was lost.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hexo-recover"><img alt="npm version" src="https://img.shields.io/npm/v/hexo-recover.svg?color=cb3837&logo=npm"></a>
  <a href="https://github.com/Belyenochi/hexo-recover/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Belyenochi/hexo-recover/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="node 20 or newer" src="https://img.shields.io/node/v/hexo-recover.svg?logo=node.js">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <img alt="terminal session: recover, rebuild, verify" src="docs/demo.svg" width="860">
</p>

## The problem

The site is still online. The `source/` folder with the Markdown is gone — the
laptop died, the repo was never pushed, or the backup turned out to hold a
fresh `hexo init`. All you have is `public/`, `.deploy_git/`, or the
`username.github.io` repository.

Rewriting posts from rendered pages by hand is slow, and generic HTML→Markdown
converters mangle exactly what a Hexo site is made of: line-numbered code
tables, heading anchors, nested lists.

## Quick start

```sh
npx hexo-recover recover ./my-site-html ./blog --url https://you.github.io   # 1. HTML -> Hexo project
cd blog && npm install && npx hexo generate                                  # 2. build it
npx hexo-recover verify ../my-site-html ./public                              # 3. prove it matches
```

No install step: if you have Hexo you have Node, and `npx` does the rest.
Requires Node ≥ 20.

## How it works

<p align="center"><img alt="recover, generate, verify" src="docs/flow.svg" width="900"></p>

Hexo's HTML is a deterministic rendering of the Markdown, so the structure can
be read back — as long as the converter knows the exact shapes Hexo and NexT
emit (line-numbered code tables, heading anchors, headings inside list items)
instead of treating it as generic HTML. `verify` then renders the recovered
sources and diffs every post against the original; it exits 0 only when text
and structure match. What HTML cannot give back: your source formatting (blank
lines, list markers), drafts, and theme settings that leave no trace on the page.

## Example

What Hexo renders for one code block, and what comes back out:

<table>
<tr><th>generated HTML</th><th>recovered Markdown</th></tr>
<tr><td>

```html
<figure class="highlight javascript"><table><tr>
<td class="gutter"><pre>
  <span class="line">1</span><br>
  <span class="line">2</span></pre></td>
<td class="code"><pre>
  <span class="line">class Parser {</span><br>
  <span class="line">  run() { … }</span></pre></td>
</tr></table></figure>
```

</td><td>

````markdown
```javascript
class Parser {
  run() { … }
```
````

</td></tr>
</table>

And a post page becomes a post file:

```markdown
---
title: "Writing a Recursive Descent Parser"
date: 2018-09-06 21:39:10
categories:
  - "Compilers"
tags:
  - "parser"
---

This post walks through parsing an LL(1) grammar by recursive descent, with
and without backtracking, and compares the two.

### 1 Contents
…
```

## What you get

```
blog/
├── _config.yml           Hexo 8 site config — title, author, language, permalink, search (read from the pages)
├── _config.next.yml      NexT 8 theme config — menu, social links, avatar, excerpt length, counters
├── package.json          Hexo 8, NexT 8, and the plugins the site evidently used
├── source/
│   ├── _posts/*.md       one file per post, front matter included
│   ├── images/           copied
│   └── about/ tags/ categories/
└── RECOVERY-REPORT.json  what was recovered, what was skipped, and why
```

## Options

| Flag | Meaning |
|---|---|
| `--url URL` | Site URL for `_config.yml`. Default: `<link rel=canonical>` if present |
| `--private PATH=WHY` | Write this post to `_private/` (gitignored) instead of publishing it. Repeatable |
| `--drop PATH=WHY` | Leave this post out entirely. Repeatable |
| `--theme next\|landscape` | Selector preset for the theme's post markup. Default `next` |
| `--body-selector CSS` | Override the article-body selector for another theme |
| `--title-selector CSS` | Override the article-title selector |
| `--post-glob GLOB` | Where post pages live. Default `YYYY/MM/DD/slug/index.html` |

`PATH` is the post's URL path, e.g. `2021/05/19/love`. Excluded posts are listed
in the report, so the decision is on file.

## Fidelity rules

Each of these is a real case from a recovered site, pinned by a test:

| Hexo markup | Handling |
|---|---|
| Code as `<table>` with a line-number gutter | Lines reassembled from `span.line`, fenced with the language |
| Bare `<pre><code>` (indented code, never highlighted) | Emitted indented, so it stays plain |
| Heading anchors `<a class="headerlink">` | Dropped |
| `<li><h5>` — heading inside a list item | Own indented line |
| `<br>` inside a list item | Continuation indented, so the list does not split |
| Literal `*` `_` `###` `1.` in prose | Escaped — but not inside headings |
| `~` in prose | `&#126;` (old marked prints `\~`; new marked pairs them as strikethrough) |
| `**[text]**` glued to a word | `<strong>` — CommonMark will not open emphasis there |
| Image file names with spaces | `%20` |

## Limitations

- Menu and social-link extraction understands the NexT sidebar. Other themes
  get correct posts and a default theme config.
- Posts are found by the date-based permalink shape unless `--post-glob` says otherwise.
- `verify` needs the rebuilt site; it does not run Hexo for you.

## Contributing

```sh
git clone https://github.com/Belyenochi/hexo-recover && cd hexo-recover
npm install
npm test
```

Bug reports with a small HTML sample and the Markdown you expected are the most
useful kind. Every fidelity rule above started as one of those.

## License

[MIT](LICENSE)
