# Theme fixtures

One generated site per supported theme: the index page, two post pages, and
the about/tags/categories pages. The two source posts are next to this file
(`recursive-descent.md`, `hello-again.md`); between them they contain every
block the converter handles — headings, fenced and indented code, nested and
numbered lists, a table, an image, a blockquote, `<!-- more -->`.

Made on 2026-09-04 with Hexo 8.1.2 and each theme's latest npm release at the
time, no theme config beyond the theme's defaults, `_config.yml` with
`title: Lab Blog`, `author: Jason`, `language: en`, `url: https://lab.example`
and `highlight.line_number: true`:

| theme | package | version |
|---|---|---|
| next | hexo-theme-next | 8.29.0 |
| landscape | hexo-theme-landscape | 1.1.0 |
| butterfly | hexo-theme-butterfly | 5.7.0 |
| fluid | hexo-theme-fluid | 1.9.9 |
| icarus | hexo-theme-icarus | 6.1.1 |
| volantis | hexo-theme-volantis | 6.8.3 |
| stellar | hexo-theme-stellar | 1.44.0 |
| keep | hexo-theme-keep | 4.3.0 |
| redefine | hexo-theme-redefine | 2.9.0 |

To regenerate one: `hexo init lab && cd lab`, install the theme package plus
`hexo-renderer-pug` and `hexo-renderer-stylus` (several themes need them), set
`theme:` in `_config.yml`, copy the two posts into `source/_posts/` and the
about/tags/categories `index.md` pages into `source/`, run `hexo generate`, and
copy the pages listed above out of `public/`. The selectors in
`src/themes.js` are read from these files; change them only against a
regenerated fixture.
