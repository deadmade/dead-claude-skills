"""Mechanical preservation check (throwaway): which code spans, code blocks, quotes, link targets, numbers and
headings of the original are missing from an edited version.

usage: preserve.py <orig.md> <edit.md>...
"""
import collections
import re
import sys


def reflow(text):
    # line wrapping isn't content: join wrapped lines, keeping list items and blank lines
    return re.sub(r"(?<=\S)\n[ \t]*(?=[^\s\-*|#\d>])", " ", text)


def items(text):
    fences = re.findall(r"^```.*?^```", text, re.S | re.M)
    body = re.sub(r"^```.*?^```", "", text, flags=re.S | re.M)
    return {
        "code blocks": collections.Counter(f.strip() for f in fences),
        "code spans": collections.Counter(re.findall(r"`[^`\n]+`", body)),
        "quotes": collections.Counter(q for q in re.findall(r"(?:^|[\s(_:])\"([^\"\n]{3,}?)\"(?=[\s).,;:_!?]|$)", reflow(re.sub(r"`[^`\n]+`", "", body)), re.M)),
        "link targets": collections.Counter(re.findall(r"\]\(([^)\s]+)", body)),
        "numbers": collections.Counter(re.findall(r"(?<![\w.])\d+(?:[.,]\d+)*(?:\s?(?:%|ms|s|MB|KB|min))?",
                                                  re.sub(r"`[^`\n]+`|\]\([^)]*\)", "", body))),
        "headings": collections.Counter(re.findall(r"^#+ .*$", body, re.M)),
    }


def main():
    o = items(open(sys.argv[1], encoding="utf-8").read())
    for p in sys.argv[2:]:
        e = items(open(p, encoding="utf-8").read())
        print(f"== {p}")
        for k in o:
            miss = o[k] - e[k]
            total = sum(o[k].values())
            print(f"  {k:13} missing {sum(miss.values()):3} of {total:4}" + (f"   e.g. {list(miss)[:6]}" if miss else ""))


if __name__ == "__main__":
    main()
