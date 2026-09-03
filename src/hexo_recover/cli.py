import argparse
import sys

from . import __version__
from .recover import Options, Selectors, recover
from .verify import verify


def _kv(items):
    """--private 2021/05/19/love="removed by hand in 2025"  ->  {path: reason}"""
    out = {}
    for it in items or []:
        path, _, why = it.partition("=")
        out[path.strip("/")] = why or "excluded"
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexo-recover",
                                 description="Rebuild a Hexo project from its generated HTML, and verify the rebuild.")
    ap.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("recover", help="generated site dir (public/ or .deploy_git) -> Hexo project")
    r.add_argument("site", help="directory holding the generated HTML")
    r.add_argument("out", help="directory to write the Hexo project into")
    r.add_argument("--url", help="site URL for _config.yml (default: read from <link rel=canonical>, else example.com)")
    r.add_argument("--private", action="append", metavar="PATH[=WHY]",
                   help="post path (YYYY/MM/DD/slug) to write under _private/ instead of source/_posts/; repeatable")
    r.add_argument("--drop", action="append", metavar="PATH[=WHY]",
                   help="post path to leave out entirely; repeatable")
    r.add_argument("--body-selector", default=".post-body", help="CSS selector of the article body (NexT: .post-body)")
    r.add_argument("--title-selector", default=".post-title", help="CSS selector of the article title")

    v = sub.add_parser("verify", help="compare a regenerated site with the original, post by post")
    v.add_argument("original", help="the original generated site")
    v.add_argument("regenerated", help="public/ produced by `hexo generate` from the recovered sources")
    v.add_argument("--body-selector", default=".post-body")

    a = ap.parse_args(argv)
    if a.cmd == "recover":
        opt = Options(url=a.url, private=_kv(a.private), drop=_kv(a.drop),
                      selectors=Selectors(body=a.body_selector, title=a.title_selector))
        rep = recover(a.site, a.out, opt)
        f = rep["site"]
        print(f"public posts : {len(rep['public'])}")
        print(f"private posts: {len(rep['private'])}")
        print(f"dropped      : {len(rep['dropped'])}")
        print(f"images       : {rep['images']}")
        print(f"pages        : {'about ' if rep['about'] else ''}{' '.join(rep['pages'])}")
        print(f"site         : {f['title']!r} by {f['author']!r}, lang {f['lang']}, "
              f"theme {f['theme'] or '?'} {f['theme_version']}, excerpt {f['excerpt_length'] or 'none'}")
        print(f"report       : {a.out}/RECOVERY-REPORT.json")
        return 0
    return verify(a.original, a.regenerated, a.body_selector)


if __name__ == "__main__":
    sys.exit(main())
