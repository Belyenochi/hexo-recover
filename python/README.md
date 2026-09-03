# hexo-recover (Python)

Rebuild the Markdown sources of a Hexo blog from its generated HTML, and prove
the rebuild is faithful.

```sh
pip install hexo-recover
hexo-recover recover ./my-site-html ./blog --url https://you.github.io
hexo-recover verify ./my-site-html ./blog/public
```

This is the Python implementation. The npm package of the same name is the
primary one (Hexo users already have Node); the two are kept byte-for-byte
equivalent by a parity check in CI. Full documentation, the conversion rules
and the verification method: https://github.com/Belyenochi/hexo-recover
