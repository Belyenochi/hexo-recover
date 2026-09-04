# Changelog

## 0.2.0 — 2026-09-04

- Theme presets for Butterfly, Fluid, Icarus, Volantis, Stellar, Keep, Redefine
  and Landscape, next to NexT; each derived from a site generated with the
  theme's current release and pinned by a fixture test. `--theme` now defaults
  to auto-detection.
- Title, dates, tags, site name and author are read from the Open Graph tags
  and JSON-LD Hexo writes into every page, theme markup second. Local times are
  recovered when the page shows one; otherwise the exact UTC instant is written.
- Code blocks whose lines are separated by `<br>` (Fluid) convert correctly.
- `verify` detects the theme of each side, so the original and the rebuilt site
  may run different themes; inline `<code>` is still compared, highlighted-block
  internals are not.
- Index excerpt length is measured against the post each card links to, so
  themes without a read-more button are measured too.

## 0.1.1 — 2026-09-03

No code changes. First release published by the GitHub Actions workflow through
npm trusted publishing (OIDC, with provenance); 0.1.0 was published by hand.

## 0.1.0 — 2026-09-03

First release. An npm package, because Hexo users already have Node. HTML is
parsed per the HTML5 algorithm (parse5), so a block element inside an unclosed
`<p>` — which hexo-renderer-marked does emit — is handled the way a browser
renders it. Extracted from the script that recovered a 25-post NexT blog
whose Markdown had been lost, generalised, and verified by rendering the
result back through Hexo 8 + NexT 8 and diffing against the original: 24/24
posts identical once spaces are removed, no structural differences.

- `hexo-recover recover SITE OUT` — posts with front matter, images, about /
  tags / categories pages, Hexo 8 `_config.yml`, NexT 8 `_config.next.yml`,
  `package.json`, per-post report. `--private`, `--drop`, `--url`, `--theme`,
  `--body-selector`, `--title-selector`, `--post-glob`.
- `hexo-recover verify ORIGINAL REGENERATED` — per-post body comparison;
  exit 0 only on a faithful rebuild.
- Converter rules for Hexo/NexT markup: line-numbered code tables, heading
  anchors, headings and hard breaks inside list items, indented vs fenced
  code, minimal escaping, CommonMark emphasis flanking, image names with
  spaces, bare text nodes.
- Site facts read from the HTML: title, author, language (zh-Hans → zh-CN),
  menu, social links, avatar, search index, busuanzi counter, excerpt length
  (median of the index excerpts).
