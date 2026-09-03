"""Turn a generated Hexo site back into a Hexo project."""
import json
import re
import shutil
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from bs4 import BeautifulSoup

from .convert import Converter

POST_DIR = re.compile(r"^\d{4}/\d{2}/\d{2}/[^/]+$")


@dataclass
class Selectors:
    """CSS selectors for the theme's post markup. Defaults are NexT's; the
    landscape theme, for instance, uses .article-entry / .article-title."""
    body: str = ".post-body"
    title: str = ".post-title"
    meta_time: str = ".post-meta time"
    categories: str = ".post-meta a[href^='/categories/']"
    tags: str = ".post-tags a"
    index_article: str = "article"
    index_title_link: str = ".post-title-link, .post-title a"


@dataclass
class Options:
    url: Optional[str] = None
    private: Dict[str, str] = field(default_factory=dict)   # path -> reason, written to _private/
    drop: Dict[str, str] = field(default_factory=dict)      # path -> reason, written nowhere
    selectors: Selectors = field(default_factory=Selectors)
    post_glob: str = "[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]/*/index.html"


def soup_of(p: Path) -> BeautifulSoup:
    return BeautifulSoup(p.read_text(encoding="utf-8"), "lxml")


def parse_post(path: Path, rel: str, sel: Selectors):
    soup = soup_of(path)
    title_el = soup.select_one(sel.title)
    title = title_el.get_text(" ", strip=True) if title_el else ""
    date, upd = None, None
    for t in soup.select(sel.meta_time):
        dt = t.get("datetime")
        if not dt:
            continue
        item = t.find_parent(class_="post-meta-item")
        txt = item.get_text(" ", strip=True) if item else t.get_text()
        if "更新" in txt or "Edited" in txt or "updated" in txt.lower():
            upd = dt
        elif date is None:
            date = dt
    if date is None:
        date = rel[:10].replace("/", "-") + "T00:00:00+08:00"
    cats = list(dict.fromkeys(a.get_text(strip=True) for a in soup.select(sel.categories) if a.get_text(strip=True)))
    tags = list(dict.fromkeys(a.get_text(strip=True).lstrip("#").strip() for a in soup.select(sel.tags)))
    tags = [t for t in tags if t]
    body = soup.select_one(sel.body)
    if body is None:
        raise RuntimeError(f"{rel}: no element matches {sel.body!r}; pass --body-selector for this theme")
    md = Converter().convert(body)
    plain = re.sub(r"\s+", " ", body.get_text(" ")).strip()
    return {"slug": rel.split("/")[-1], "path": rel, "title": title, "date": date, "updated": upd,
            "categories": cats, "tags": tags, "markdown": md, "plain_len": len(plain)}


def yaml_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def write_post(post, dest: Path):
    fm = [f"title: {yaml_str(post['title'] or post['slug'])}",
          f"date: {post['date'][:19].replace('T', ' ')}"]
    if post["updated"]:
        fm.append(f"updated: {post['updated'][:19].replace('T', ' ')}")
    for key in ("categories", "tags"):
        if post[key]:
            fm.append(f"{key}:")
            fm += [f"  - {yaml_str(v)}" for v in post[key]]
    dest.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + post["markdown"], encoding="utf-8")


# ----------------------------------------------------------------------- site
def site_facts(deploy: Path, sel: Selectors):
    """Everything about the site that leaves a trace in the generated HTML."""
    index = deploy / "index.html"
    soup = soup_of(index) if index.exists() else BeautifulSoup("", "lxml")

    def g(css, attr=None):
        e = soup.select_one(css)
        if not e:
            return ""
        return (e.get(attr) or "") if attr else e.get_text(strip=True)

    facts = {
        "title": g(".site-title") or (g("title").split(" | ")[-1] if g("title") else ""),
        "subtitle": g(".site-subtitle"),
        "author": g(".site-author-name"),
        "description": g(".site-description"),
        "avatar": g(".site-author-image", "src"),
        "lang": (soup.html.get("lang") if soup.html else "") or "en",
        "generator": g("meta[name=generator]", "content"),
        "canonical": g("link[rel=canonical]", "href") or g("meta[property='og:url']", "content"),
        "menu": [(a.get_text(" ", strip=True), a.get("href", "")) for a in soup.select(".menu-item a")],
        "social": [(a.get_text(" ", strip=True) or a.get("title", ""), a.get("href", ""))
                   for a in soup.select(".links-of-author-item a, .social-link, .links-of-author a")],
        "has_search_xml": (deploy / "search.xml").exists(),
        "has_busuanzi": "busuanzi" in (index.read_text(encoding="utf-8") if index.exists() else ""),
        "theme": "", "theme_version": "", "excerpt_length": None,
    }
    m = re.search(r"NexT\.(\w+) v([\d.]+)", soup.get_text()) or re.search(r"hexo-theme-next/([\d.]+)", str(soup))
    if m:
        facts["theme"] = "next"
        facts["theme_version"] = m.group(m.lastindex)
        if m.lastindex == 2:
            facts["scheme"] = m.group(1)
    # Excerpt length: the median visible length of the index excerpts. If every
    # entry on the index is a full post there is no excerpting to reproduce.
    lens, buttons = [], 0
    for pg in [index] + sorted(deploy.glob("page/*/index.html")):
        if not pg.exists():
            continue
        for art in soup_of(pg).select(sel.index_article):
            b = art.select_one(sel.body)
            if b is None:
                continue
            if art.select_one("a.btn[href*='#more'], .post-button a"):
                buttons += 1
            for x in b.select("a.btn"):
                x.decompose()
            lens.append(len(re.sub(r"\s+", " ", b.get_text(" ")).strip()))
    if lens and buttons:
        med = int(statistics.median(lens))
        facts["excerpt_length"] = int(round(med / 10.0) * 10)  # 148..154 -> 150
    return facts


_MENU_ICONS = {"home": "fa fa-home", "categories": "fa fa-th", "archives": "fa fa-archive",
               "tags": "fa fa-tags", "about": "fa fa-user", "schedule": "fa fa-calendar", "sitemap": "fa fa-sitemap"}
_MENU_ZH = {"首页": "home", "分类": "categories", "归档": "archives", "标签": "tags", "关于": "about", "搜索": "search"}


def _social_icon(href: str) -> str:
    for dom, icon in (("github.com", "fab fa-github"), ("twitter.com", "fab fa-twitter"), ("x.com", "fab fa-x-twitter"),
                      ("zhihu.com", "fab fa-zhihu"), ("weibo.com", "fab fa-weibo"), ("youtube.com", "fab fa-youtube"),
                      ("stackoverflow.com", "fab fa-stack-overflow"), ("linkedin.com", "fab fa-linkedin")):
        if dom in href:
            return icon
    if "@" in href:
        return "fa fa-envelope"
    return "fa fa-link"


_LANG_NEXT8 = {"zh-Hans": "zh-CN", "zh-hans": "zh-CN", "zh-Hant": "zh-TW", "zh-hant": "zh-TW"}


def write_site_config(out: Path, f, url: str, permalink: str):
    lang = _LANG_NEXT8.get(f["lang"], f["lang"])
    lines = [
        "# Rebuilt by hexo-recover from the generated site. Values marked (read) were",
        "# taken from the deployed HTML; everything else is a Hexo 8 default.",
        f"title: {yaml_str(f['title'])}          # (read)",
        f"subtitle: {yaml_str(f['subtitle'])}",
        f"description: {yaml_str(f['description'])}",
        "keywords:",
        f"author: {yaml_str(f['author'])}        # (read)",
        f"language: {yaml_str(lang)}        # (read as {f['lang']}; NexT 8 names the language files zh-CN / zh-TW)",
        "timezone: ''",
        "",
        f"url: {url}",
        f"# (read) The deployed URLs follow this shape; changing it breaks every inbound link.",
        f"permalink: {permalink}",
        "permalink_defaults:",
        "pretty_urls:",
        "  trailing_index: true",
        "  trailing_html: true",
        "",
        "source_dir: source",
        "public_dir: public",
        "tag_dir: tags",
        "archive_dir: archives",
        "category_dir: categories",
        "code_dir: downloads/code",
        "i18n_dir: :lang",
        "skip_render:",
        "",
        "new_post_name: :title.md",
        "default_layout: post",
        "titlecase: false",
        "external_link:",
        "  enable: true",
        "  field: site",
        "  exclude: ''",
        "filename_case: 0",
        "render_drafts: false",
        "post_asset_folder: false",
        "relative_link: false",
        "future: true",
        "",
        "syntax_highlighter: highlight.js",
        "highlight:",
        "  line_number: true",
        "  auto_detect: false",
        "  tab_replace: ''",
        "  wrap: true",
        "  hljs: false",
        "",
        "index_generator:",
        "  path: ''",
        "  per_page: 10",
        "  order_by: -date",
        "",
        "per_page: 10",
        "pagination_dir: page",
        "",
        "theme: next",
    ]
    if f["has_search_xml"]:
        lines += ["", "# (read) The site shipped a search.xml, i.e. hexo-generator-searchdb was installed.",
                  "search:", "  path: search.xml", "  field: post", "  content: true", "  format: html"]
    if f["excerpt_length"]:
        lines += ["", f"# (read) Index excerpts were cut at about {f['excerpt_length']} characters with a read-more",
                  "# button. hexo-auto-excerpt reproduces that without a <!-- more --> tag in any post.",
                  f"excerpt_length: {f['excerpt_length']}"]
    lines += ["", "deploy:", "  type: git", "  repo: <your github pages repo>", "  branch: master", ""]
    (out / "_config.yml").write_text("\n".join(lines), encoding="utf-8")


def write_theme_config(out: Path, f):
    menu = []
    for name, href in f["menu"]:
        key = _MENU_ZH.get(name, name.lower())
        if key == "search":
            continue  # NexT 8 renders search from local_search, not a menu page
        href = href if href.endswith("/") or "." in href.split("/")[-1] else href + "/"
        menu.append(f"  {key}: {href} || {_MENU_ICONS.get(key, 'fa fa-link')}")
    social = []
    for name, href in f["social"]:
        if not href:
            continue
        if "@" in href and not href.startswith("mailto:"):
            href = "mailto:" + href
        social.append(f"  {name or href}: {href} || {_social_icon(href)}")
    scheme = f.get("scheme") or "Muse"
    text = f"""# NexT 8 theme config, rebuilt by hexo-recover. Put this at the root of the Hexo
# project as _config.next.yml (Hexo 5+ theme-config location). Every value below
# reproduces something visible on the old site; everything else is the NexT 8
# default (see node_modules/hexo-theme-next/_config.yml).

scheme: {scheme}

menu:
{chr(10).join(menu) or '  home: / || fa fa-home'}

menu_settings:
  icons: true
  badges: false

avatar:
  url: {f['avatar'] or '/images/avatar.jpg'}
  rounded: false
  rotated: false

social:
{chr(10).join(social) or '  # none found in the generated HTML'}

social_icons:
  enable: true
  icons_only: false

excerpt_description: true
read_more_btn: true

post_meta:
  item_text: true
  created_at: true
  updated_at:
    enable: false
  categories: true

codeblock:
  theme:
    light: default
    dark: stackoverflow-dark
  copy_button:
    enable: true

busuanzi_count:
  enable: {'true' if f['has_busuanzi'] else 'false'}

local_search:
  enable: {'true' if f['has_search_xml'] else 'false'}
  trigger: auto
  top_n_per_article: 1
"""
    (out / "_config.next.yml").write_text(text, encoding="utf-8")


def write_package_json(out: Path, f):
    deps = {
        "hexo": "^8.0.0", "hexo-generator-archive": "^2.0.0", "hexo-generator-category": "^2.0.0",
        "hexo-generator-index": "^4.0.0", "hexo-generator-tag": "^2.0.0", "hexo-renderer-ejs": "^2.0.0",
        "hexo-renderer-marked": "^7.0.0", "hexo-renderer-stylus": "^3.0.1", "hexo-server": "^3.0.0",
        "hexo-theme-next": "^8.0.0", "hexo-deployer-git": "^4.0.0",
    }
    if f["has_search_xml"]:
        deps["hexo-generator-searchdb"] = "^1.5.0"
    if f["excerpt_length"]:
        deps["hexo-auto-excerpt"] = "^1.1.2"
    pkg = {"name": "blog", "private": True, "hexo": {"version": "8.0.0"},
           "scripts": {"build": "hexo generate", "clean": "hexo clean", "deploy": "hexo deploy", "server": "hexo server"},
           "dependencies": dict(sorted(deps.items()))}
    (out / "package.json").write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")


def write_pages(deploy: Path, out: Path, sel: Selectors, report):
    """about page, plus the tags/categories index pages NexT needs."""
    about = deploy / "about" / "index.html"
    if about.exists():
        soup = soup_of(about)
        body = soup.select_one(sel.body)
        if body is not None:
            t = soup.select_one(sel.title)
            title = t.get_text(strip=True) if t else "about"
            d = out / "source" / "about"
            d.mkdir(parents=True, exist_ok=True)
            (d / "index.md").write_text(f"---\ntitle: {yaml_str(title)}\ndate: 2000-01-01 00:00:00\n---\n\n"
                                        + Converter().convert(body), encoding="utf-8")
            report["about"] = True
    for kind in ("tags", "categories"):
        if (deploy / kind / "index.html").exists():
            d = out / "source" / kind
            d.mkdir(parents=True, exist_ok=True)
            (d / "index.md").write_text(f"---\ntitle: {kind}\ndate: 2000-01-01 00:00:00\ntype: {kind}\ncomments: false\n---\n",
                                        encoding="utf-8")
            report["pages"].append(kind)


def recover(deploy_dir: str, out_dir: str, opt: Options) -> dict:
    deploy, out = Path(deploy_dir), Path(out_dir)
    sel = opt.selectors
    (out / "source" / "_posts").mkdir(parents=True, exist_ok=True)
    (out / "scaffolds").mkdir(exist_ok=True)
    report = {"public": [], "private": [], "dropped": [], "images": 0, "about": False, "pages": []}

    posts: List[dict] = []
    for idx in sorted(deploy.glob(opt.post_glob)):
        rel = str(idx.parent.relative_to(deploy))
        if POST_DIR.match(rel):
            posts.append(parse_post(idx, rel, sel))

    used = set()
    for p in posts:
        if p["path"] in opt.drop:
            report["dropped"].append({"path": p["path"], "why": opt.drop[p["path"]]})
            continue
        slug = p["slug"] if p["slug"] not in used else p["date"][:10] + "-" + p["slug"]
        used.add(slug)
        if p["path"] in opt.private:
            (out / "_private").mkdir(exist_ok=True)
            dest = out / "_private" / f"{slug}.md"
            write_post(p, dest)
            report["private"].append({"path": p["path"], "title": p["title"], "why": opt.private[p["path"]]})
        else:
            dest = out / "source" / "_posts" / f"{slug}.md"
            write_post(p, dest)
            report["public"].append({"path": p["path"], "title": p["title"], "date": p["date"], "chars": p["plain_len"],
                                     "categories": p["categories"], "tags": p["tags"],
                                     "code_blocks": p["markdown"].count("\n```") // 2, "file": dest.name})

    for asset_dir in ("images", "img", "uploads"):
        src = deploy / asset_dir
        if src.exists() and src.is_dir():
            dst = out / "source" / asset_dir
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            report["images"] += sum(1 for x in dst.rglob("*") if x.is_file())
    for fav in ("favicon.ico",):
        if (deploy / fav).exists():
            shutil.copy2(deploy / fav, out / "source" / fav)

    facts = site_facts(deploy, sel)
    url = opt.url or (facts["canonical"].rstrip("/").rsplit("/", 1)[0] if facts["canonical"] else "http://example.com")
    write_site_config(out, facts, url, ":year/:month/:day/:title/")
    write_theme_config(out, facts)
    write_package_json(out, facts)
    write_pages(deploy, out, sel, report)
    (out / "scaffolds" / "post.md").write_text("---\ntitle: {{ title }}\ndate: {{ date }}\ncategories:\ntags:\n---\n", encoding="utf-8")
    (out / ".gitignore").write_text("node_modules/\npublic/\ndb.json\n.deploy_git/\n_private/\n", encoding="utf-8")
    report["site"] = facts
    (out / "RECOVERY-REPORT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
