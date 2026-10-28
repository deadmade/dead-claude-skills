"""Markdown masking with offset mapping, shared by the LanguageTool runner and parse_check.py.

segments(text) covers the whole document with contiguous segments:
  ("text", start, end)                 prose kept as-is
  ("markup", start, end, interpretAs)  syntax or masked content, read as `interpretAs`
Masked: front matter, fenced/indented code, HTML blocks, `>` block quotes, inline code
(read as "X"), link/image targets, autolinks, reference definitions, heading/list markers,
emphasis markers, table pipes. Each paragraph/heading/list item/table cell is its own block,
separated by "\n\n" so no sentence spans two blocks.
"""
import re
import sys
from bisect import bisect_right
from markdown_it import MarkdownIt


def line_starts(text):
    starts = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            starts.append(i + 1)
    return starts


def offset_to_linecol(starts, off):
    i = bisect_right(starts, off) - 1
    return i + 1, off - starts[i] + 1


INLINE_PATTERNS = [
    ("code", re.compile(r"(`+)(?:(?!\1)[\s\S])+?\1")),
    ("autolink", re.compile(r"<(?:https?|mailto|ftp):[^>\s]+>")),
    ("target", re.compile(r"\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+\"[^\"]*\")?\)")),
    ("refdef", re.compile(r"\]\[[^\]]*\]")),
    ("bang", re.compile(r"!(?=\[)")),
    ("bracket", re.compile(r"[\[\]]")),
    ("emph", re.compile(r"\*+|(?<![\w])_+|_+(?![\w])|~~")),
    ("html", re.compile(r"</?[A-Za-z][^>]*>|<!--[\s\S]*?-->")),
]


def inline_masks(text, start, end, code_rep="X"):
    """Masks inside [start,end): list of (s, e, interpretAs). Earlier patterns win."""
    masks = []
    taken = []

    def free(s, e):
        return all(e <= a or s >= b for a, b in taken)

    seg = text[start:end]
    for kind, pat in INLINE_PATTERNS:
        for m in pat.finditer(seg):
            s, e = start + m.start(), start + m.end()
            if not free(s, e):
                continue
            if kind == "code":
                rep = code_rep
            elif kind == "target":
                rep = ""
                # also mask the "]" (keep the link text); target starts with "]("
            else:
                rep = ""
            masks.append((s, e, rep))
            taken.append((s, e))
    masks.sort()
    return masks


def blocks(text):
    """Returns (masked_line_kinds, blocks) where blocks = list of dict(start,end,kind,in_list,in_table)."""
    lines = text.split("\n")
    starts = line_starts(text)
    n = len(lines)
    kind = [None] * n
    # front matter
    if lines and lines[0].strip() == "---":
        for j in range(1, n):
            if lines[j].strip() in ("---", "..."):
                for k in range(0, j + 1):
                    kind[k] = "frontmatter"
                break
    src = "\n".join("" if kind[i] else lines[i] for i in range(n))
    md = MarkdownIt("commonmark").enable("table")
    toks = md.parse(src)
    out = []
    stack = []
    for t in toks:
        if t.nesting == 1:
            stack.append(t.type)
        elif t.nesting == -1 and stack:
            stack.pop()
        if t.map and t.type in ("fence", "code_block", "html_block"):
            for k in range(t.map[0], t.map[1]):
                kind[k] = kind[k] or t.type
        if t.map and t.type == "blockquote_open":
            for k in range(t.map[0], t.map[1]):
                kind[k] = kind[k] or "blockquote"
    # reference definitions: "[x]: url" lines that markdown-it consumed
    refdef = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*\S+")
    for i, l in enumerate(lines):
        if kind[i] is None and refdef.match(l):
            kind[i] = "refdef"
    stack = []
    for t in toks:
        if t.nesting == 1:
            stack.append(t.type)
        elif t.nesting == -1 and stack:
            stack.pop()
        if t.type != "inline" or not t.map:
            continue
        a, b = t.map
        if any(kind[k] for k in range(a, b)):
            continue
        in_list = "list_item_open" in stack
        in_table = any(s in ("table_open", "th_open", "td_open") for s in stack)
        heading = "heading_open" in stack
        if in_table:
            # one block per cell of this row (cells repeat the same map; handle each row once)
            if out and out[-1].get("row") == a:
                continue
            row = lines[a]
            base = starts[a]
            for m in re.finditer(r"(?:\\\||[^|])+", row):
                cs, ce = base + m.start(), base + m.end()
                if text[cs:ce].strip() and not re.fullmatch(r"\s*:?-+:?\s*", text[cs:ce]):
                    out.append(dict(start=cs, end=ce, kind="cell", in_list=in_list, in_table=True, row=a))
            continue
        out.append(dict(start=starts[a], end=starts[b - 1] + len(lines[b - 1]),
                        kind="heading" if heading else "para", in_list=in_list, in_table=False,
                        first_line=a, last_line=b - 1))
    return kind, out


LIST_MARK = re.compile(r"^\s*(?:(?:[-*+]|\d+[.)])\s+)+")
HEAD_MARK = re.compile(r"^\s*#{1,6}\s+")
LEAD_WS = re.compile(r"^\s+")


def segments(text, code_rep="X"):
    kind, bl = blocks(text)
    starts = line_starts(text)
    marks = []  # (s, e, interpretAs)  -- inside blocks
    for b in bl:
        if b["kind"] == "cell":
            s, e = b["start"], b["end"]
            # strip leading/trailing spaces
            m = re.match(r"\s*", text[s:e])
            if m.end():
                marks.append((s, s + m.end(), ""))
            marks += inline_masks(text, s, e, code_rep)
            continue
        for li in range(b["first_line"], b["last_line"] + 1):
            ls = starts[li]
            line = text[ls:(starts[li + 1] - 1 if li + 1 < len(starts) else len(text))]
            if li == b["first_line"]:
                pat = HEAD_MARK if b["kind"] == "heading" else (LIST_MARK if b["in_list"] else LEAD_WS)
                m = pat.match(line)
                # list item first line: the marker is on the item's first line only if the paragraph starts it
                if m and m.end():
                    marks.append((ls, ls + m.end(), ""))
            else:
                # previous newline + indentation -> one space
                m = LEAD_WS.match(line)
                e = ls + (m.end() if m else 0)
                marks.append((ls - 1, e, " "))
            if b["kind"] == "heading":
                m = re.search(r"\s+#+\s*$", line)
                if m:
                    marks.append((ls + m.start(), ls + len(line), ""))
        for s, e, r in inline_masks(text, b["start"], b["end"], code_rep):
            marks.append((s, e, r))
    # resolve overlaps: keep earliest-starting, longest
    marks.sort(key=lambda x: (x[0], -(x[1] - x[0])))
    clean = []
    last = -1
    for s, e, r in marks:
        if s < last:
            continue
        clean.append((s, e, r))
        last = e
    # build contiguous segments
    segs = []
    pos = 0
    bi = 0
    blk = sorted(bl, key=lambda b: b["start"])
    # gaps between blocks are markup "\n\n"
    inside = []
    for b in blk:
        inside.append((b["start"], b["end"]))
    mi = 0
    for (bs, be) in inside:
        if bs > pos:
            segs.append(("markup", pos, bs, "\n\n"))
        elif bs < pos:
            bs = pos
        p = bs
        while mi < len(clean) and clean[mi][0] < be:
            s, e, r = clean[mi]
            mi += 1
            if s < p:
                continue
            if s > p:
                segs.append(("text", p, s))
            segs.append(("markup", s, min(e, be), r))
            p = min(e, be)
        if p < be:
            segs.append(("text", p, be))
        pos = max(pos, be)
    if pos < len(text):
        segs.append(("markup", pos, len(text), "\n\n"))
    return segs, blk, kind


def compact(text, code_rep="X"):
    """Returns (ctext, cmap, blocks): cmap[i] = original offset of ctext[i]; cmap has a sentinel at the end."""
    segs, blk, _ = segments(text, code_rep)
    out = []
    cmap = []
    for sg in segs:
        if sg[0] == "text":
            _, s, e = sg
            out.append(text[s:e])
            cmap.extend(range(s, e))
        else:
            _, s, e, r = sg
            out.append(r)
            cmap.extend([s] * len(r))
    cmap.append(len(text))
    return "".join(out), cmap, blk


if __name__ == "__main__":
    t = open(sys.argv[1], encoding="utf-8").read()
    c, m, b = compact(t)
    print(c)
