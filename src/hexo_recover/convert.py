"""HTML -> Markdown, written against the markup Hexo and the NexT theme emit.

Generic HTML-to-Markdown converters mangle exactly the parts that matter in a
Hexo site: code blocks are rendered as a <table> with a line-number gutter,
every heading carries an anchor <a>, and headings can sit inside list items.
This converter knows those shapes. It escapes only the characters that would
change meaning in Markdown, because over-escaped Markdown is unpleasant to
keep editing -- and the whole point of recovering the source is to edit it.

The rules here were each earned against a real 25-post site, rendered back
through Hexo and diffed against the original HTML until every article body
matched. Comments say which rule fixed which failure.
"""
import html
import re
import unicodedata

from bs4 import NavigableString, Tag

HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")


class Converter:
    """Depth-first walk producing Markdown.

    Contract: block elements return text that already ends with the right
    number of newlines; inline elements return text with no trailing newline.
    Keeping that contract is what stops the output from growing stray blank
    lines.
    """

    # Characters that are literal in the rendered HTML but would be markup in
    # Markdown. No `~`: old marked does not treat `\~` as an escape and prints
    # the backslash; new marked turns a pair into strikethrough. It is handled
    # as an entity in text() instead.
    _INLINE_ESC = re.compile(r"([*_`\\\[\]])")
    _LINE_START_ESC = re.compile(r"^(\s*)(#{1,6}|[>+-]|\d+\.)(\s)", re.M)
    _PUNCT_START = re.compile(r"^[\\\[\](){}<>\"'!?.,:;#*_~`|-]")

    def convert(self, node) -> str:
        out = "".join(self.block(c) for c in node.children)
        out = re.sub(r"\n{3,}", "\n\n", out)
        # Strip newlines only: a document that opens with an indented code
        # block must keep the four spaces on its first line.
        return out.strip("\n") + "\n"

    # ------------------------------------------------------------------ blocks
    def block(self, n) -> str:
        if isinstance(n, NavigableString):
            # Bare text at block level: hexo-renderer-marked emits this when a
            # heading is followed by text without a blank line in the source.
            # It is a paragraph in every sense but the tag.
            t = self.guard_line_start(self.text(n).strip())
            return t + "\n\n" if t else ""
        if not isinstance(n, Tag):
            return ""
        name = n.name
        if name in HEADINGS:
            return "#" * int(name[1]) + " " + self.inline_children(n).strip() + "\n\n"
        if name == "p":
            body = self.guard_line_start(self.inline_children(n).strip())
            return body + "\n\n" if body else ""
        if name == "figure" and "highlight" in n.get("class", []):
            return self.code_figure(n)
        if name == "pre":
            # A bare <pre><code> with no highlight figure around it is what
            # marked emits for an INDENTED code block; Hexo only runs the
            # highlighter on fenced ones. Re-emit it indented so the re-render
            # is a bare <pre> too, not a highlight table.
            code = html.unescape(n.get_text()).rstrip("\n")
            return "\n".join("    " + ln if ln else "" for ln in code.split("\n")) + "\n\n"
        if name in ("ul", "ol"):
            return self.list(n, ordered=(name == "ol"), depth=0) + "\n"
        if name == "blockquote":
            inner = "".join(self.block(c) for c in n.children).strip()
            return "\n".join("> " + ln if ln else ">" for ln in inner.split("\n")) + "\n\n"
        if name == "table":
            return self.table(n)
        if name == "hr":
            return "---\n\n"
        if name == "div":
            return "".join(self.block(c) for c in n.children)
        if name == "img":
            return self.img(n) + "\n\n"
        if name == "br":
            return "\n"
        if name in ("script", "style"):
            return ""
        t = self.inline(n).strip()
        return t + "\n\n" if t else ""

    def code_figure(self, fig) -> str:
        lang = ""
        for c in fig.get("class", []):
            if c != "highlight":
                lang = c
        if lang == "plain":
            lang = ""
        caption = fig.find("figcaption")
        cap = caption.get_text(" ", strip=True) if caption else ""
        code_td = fig.select_one("td.code")
        if code_td is None:
            pre = fig.find("pre")
            code = pre.get_text() if pre else fig.get_text()
        else:
            lines = code_td.select("span.line")
            code = "\n".join(self.raw_text(ln) for ln in lines) if lines else code_td.get_text()
        code = code.rstrip("\n")
        fence = "```"
        while fence in code:
            fence += "`"
        head = fence + lang + (" " + cap if cap else "")
        return f"{head}\n{code}\n{fence}\n\n"

    @staticmethod
    def raw_text(node) -> str:
        # Code must not be Markdown-escaped; only entity-decoded.
        return html.unescape(node.get_text())

    def list(self, lst, ordered, depth) -> str:
        """Each <li> becomes one or more lines. Inline runs are joined into the
        first line; block children (headings, nested lists, code, further
        paragraphs) go on their own lines indented under the marker, so the
        renderer re-parses them as blocks inside the item. A heading glued
        onto the item text on one line is just text with hashes in it."""
        out = []
        i = 0
        for li in lst.find_all("li", recursive=False):
            i += 1
            marker = f"{i}. " if ordered else "- "
            pad = " " * len(marker)
            blocks, inline_run = [], []

            def flush():
                # Concatenate as the DOM had it; text nodes carry their own
                # spaces. A hard break ("  \n" from <br>) must survive, so it is
                # protected while runs of spaces are collapsed.
                s = "".join(inline_run).replace("  \n", "\0")
                s = re.sub(r"[ \t]+", " ", s).strip().replace("\0", "  \n")
                if s:
                    blocks.append(s)
                inline_run.clear()

            for c in li.children:
                if isinstance(c, Tag) and c.name in ("ul", "ol"):
                    flush()
                    blocks.append(self.list(c, ordered=(c.name == "ol"), depth=0).rstrip("\n"))
                elif isinstance(c, Tag) and c.name in HEADINGS:
                    flush()
                    blocks.append("#" * int(c.name[1]) + " " + self.inline_children(c).strip())
                elif isinstance(c, Tag) and c.name == "figure":
                    flush()
                    blocks.append(self.code_figure(c).rstrip("\n"))
                elif isinstance(c, Tag) and c.name == "pre":
                    flush()
                    blocks.append(self.block(c).rstrip("\n"))
                elif isinstance(c, Tag) and c.name in ("p", "div"):
                    flush()
                    blocks.append(self.inline_children(c).strip())
                elif isinstance(c, Tag) and c.name == "br":
                    inline_run.append("  \n")
                else:
                    inline_run.append(self.inline(c) if isinstance(c, Tag) else self.text(c))
            flush()
            if not blocks:
                blocks = [""]
            first, rest = blocks[0], blocks[1:]
            # A <br> inside the item yields "  \n"; the continuation must be
            # indented under the marker or it ends the list.
            first_lines = first.split("\n")
            lines = [marker + first_lines[0]] + [pad + ln if ln.strip() else "" for ln in first_lines[1:]]
            for b in rest:
                lines.extend(pad + ln if ln else "" for ln in b.split("\n"))
            out.append("\n".join(lines))
        body = "\n".join(out)
        return self.indent(body, depth) + "\n" if depth else body + "\n"

    @staticmethod
    def indent(s, depth) -> str:
        pad = "  " * depth
        return "\n".join(pad + ln if ln else ln for ln in s.split("\n"))

    def table(self, t) -> str:
        rows = []
        for tr in t.find_all("tr"):
            cells = [self.inline_children(td).strip().replace("|", "\\|").replace("\n", " ")
                     for td in tr.find_all(["th", "td"])]
            rows.append(cells)
        if not rows:
            return ""
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        head, body = rows[0], rows[1:]
        lines = ["| " + " | ".join(head) + " |", "|" + "---|" * width]
        lines += ["| " + " | ".join(r) + " |" for r in body]
        return "\n".join(lines) + "\n\n"

    # ------------------------------------------------------------------ inline
    def inline_children(self, n) -> str:
        return "".join(self.inline(c) if isinstance(c, Tag) else self.text(c) for c in n.children)

    def inline(self, n) -> str:
        name = n.name
        cls = n.get("class", [])
        if name == "a":
            if "headerlink" in cls:  # theme heading anchor: drop it
                return ""
            href = n.get("href", "")
            txt = self.inline_children(n)
            if not txt.strip():
                return ""
            if href.startswith("/tags/") or href.startswith("/categories/"):
                return txt
            return f"[{txt}]({href})"
        if name == "img":
            return self.img(n)
        if name in ("strong", "b"):
            return self.emphasis(n, "**", "strong")
        if name in ("em", "i"):
            if any(c.startswith("fa") for c in cls):  # icon fonts
                return ""
            return self.emphasis(n, "*", "em")
        if name in ("del", "s"):
            return "~~" + self.inline_children(n).strip() + "~~"
        if name == "code":
            t = html.unescape(n.get_text())
            fence = "`" * (max([len(m) for m in re.findall(r"`+", t)] + [0]) + 1)
            return f"{fence}{t}{fence}"
        if name == "br":
            return "  \n"
        if name == "span" and "line" in cls:
            return self.raw_text(n)
        if name in ("sup", "sub", "kbd", "mark"):
            return f"<{name}>{self.inline_children(n)}</{name}>"
        if name in ("figure", "pre", "ul", "ol", "table", "blockquote", "div", "p"):
            return self.block(n)
        return self.inline_children(n)

    @staticmethod
    def _is_punct(ch: str) -> bool:
        # CommonMark's "punctuation character": ASCII punctuation or any Unicode
        # P* category -- which includes ，。（）【】 and friends, the characters
        # that actually surround emphasis in Chinese prose.
        return bool(ch) and (ch in "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" or unicodedata.category(ch).startswith("P"))

    def emphasis(self, n, marks: str, tag: str) -> str:
        """`**text**` when CommonMark will accept it; an HTML tag otherwise.

        The delimiter run has to be left-flanking to open and right-flanking to
        close, and prose in Chinese trips both rules constantly: 为何物**[本篇]**
        (opener followed by punctuation but preceded by a word), and
        **加粗**（注） (closer followed by a word... or preceded by punctuation
        and followed by more). The old marked ignored the rules; the current one
        follows them and prints the asterisks. The HTML tag says the same thing
        in both and keeps the text byte-identical, so it is used exactly when the
        Markdown form would not render."""
        inner = self.inline_children(n).strip()
        if not inner:
            return ""
        prev, nxt = n.previous_sibling, n.next_sibling
        before = str(prev)[-1:] if isinstance(prev, NavigableString) else ""
        after = str(nxt)[:1] if isinstance(nxt, NavigableString) else ""
        first, last = inner[0], inner[-1]
        # left-flanking: not followed by whitespace, and (not followed by
        # punctuation, or preceded by whitespace/punctuation/start)
        can_open = not first.isspace() and (not self._is_punct(first) or before == "" or before.isspace() or self._is_punct(before))
        # right-flanking: not preceded by whitespace, and (not preceded by
        # punctuation, or followed by whitespace/punctuation/end)
        can_close = not last.isspace() and (not self._is_punct(last) or after == "" or after.isspace() or self._is_punct(after))
        if can_open and can_close:
            return f"{marks}{inner}{marks}"
        return f"<{tag}>{inner}</{tag}>"

    @staticmethod
    def img(n) -> str:
        src = n.get("data-src") or n.get("src", "")
        # A bare space ends the URL in Markdown and the image renders as text.
        src = src.replace(" ", "%20")
        alt = n.get("alt", "") or n.get("title", "")
        return f"![{alt}]({src})"

    def text(self, s) -> str:
        t = html.unescape(str(s))
        t = re.sub(r"[ \t\r\f\v]+", " ", t).replace("\n", " ")
        t = self._INLINE_ESC.sub(r"\\\1", t)
        return t.replace("~", "&#126;")

    def guard_line_start(self, t: str) -> str:
        """Escape a leading heading/list marker. Only for text that will sit at
        the start of a paragraph line: inside a heading "1. 前言" cannot be a
        list, and escaping it there puts a literal backslash into the page."""
        return self._LINE_START_ESC.sub(r"\1\\\2\3", t, count=1)
