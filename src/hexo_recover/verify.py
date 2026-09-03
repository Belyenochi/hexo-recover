"""Compare a regenerated site against the original, post by post.

This is the evidence that the recovered Markdown is faithful: not "the
converter ran without errors" but "rendering the recovered sources back
through Hexo produces the same article body".

Three measures per post:
  ratio    difflib similarity of the visible body text (line-number gutters
           and read-more buttons removed, whitespace collapsed)
  nospace  whether the text is identical once all spaces are removed -- the
           remaining differences are spaces around inline elements, which
           Markdown cannot always reproduce and which do not render
  struct   count of each structural tag; <p> is excluded because bare text
           nodes in the original become paragraphs in Markdown, which is not
           a content difference
"""
import difflib
import html
import re
from pathlib import Path

from bs4 import BeautifulSoup

TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "img", "a",
        "figure.highlight", "pre", "code", "strong", "em", "blockquote"]


def _body(p: Path, selector: str):
    return BeautifulSoup(p.read_text(encoding="utf-8"), "lxml").select_one(selector)


def _text(el) -> str:
    for b in el.select("a.btn"):
        b.decompose()
    for g in el.select("td.gutter"):
        g.decompose()
    return re.sub(r"\s+", " ", html.unescape(el.get_text(" "))).strip()


def _struct(el):
    return {k: len(el.select(k)) for k in TAGS}


def verify(orig_dir: str, new_dir: str, body_selector: str = ".post-body") -> int:
    orig, new = Path(orig_dir), Path(new_dir)
    rows, bad_struct = [], []
    for page in sorted(new.glob("[0-9]*/[0-9]*/[0-9]*/*/index.html")):
        rel = page.parent.relative_to(new)
        old = orig / rel / "index.html"
        if not old.exists():
            rows.append((str(rel), None, False, "not in original"))
            continue
        eo, en = _body(old, body_selector), _body(page, body_selector)
        if eo is None or en is None:
            rows.append((str(rel), None, False, f"no {body_selector}"))
            continue
        a, b = _text(eo), _text(en)
        r = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
        rows.append((str(rel), r, a.replace(" ", "") == b.replace(" ", ""), ""))
        sa, sb = _struct(eo), _struct(en)
        d = {k: (sa[k], sb[k]) for k in sa if sa[k] != sb[k]}
        if d:
            bad_struct.append((str(rel), d))

    scored = [r for r in rows if r[1] is not None]
    print(f"{'post':<44} {'ratio':>7}  nospace")
    for rel, r, same, note in sorted(rows, key=lambda x: (x[1] is None, x[1] or 0)):
        print(f"{rel:<44} {('%.4f' % r) if r is not None else '   -   ':>7}  {'yes' if same else 'NO '}  {note}")
    print()
    print(f"posts compared     : {len(scored)}")
    print(f"text identical     : {sum(1 for r in scored if r[1] == 1.0)}")
    print(f"identical no-space : {sum(1 for r in scored if r[2])}")
    if scored:
        print(f"mean ratio         : {sum(r[1] for r in scored) / len(scored):.4f}")
    print(f"structure diffs    : {len(bad_struct)}")
    for rel, d in bad_struct:
        print(f"  {rel}: {d}")
    return 0 if scored and all(r[2] for r in scored) and not bad_struct else 1
