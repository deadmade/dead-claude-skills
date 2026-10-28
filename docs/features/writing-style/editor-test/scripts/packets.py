"""Builds blind ranking packets (throwaway): each version split at its headings, sections aligned by position,
versions shown under shuffled letters per section.

usage: packets.py <doc> <cond>...   reads docs/<doc>.<cond>.md, writes judge/<doc>.packet.md and judge/<doc>.key.json
"""
import json
import random
import re
import sys


def sections(text):
    parts = re.split(r"(?m)^(?=#{1,6} )", text)
    return [p.strip() for p in parts if p.strip()]


def main():
    doc, conds = sys.argv[1], sys.argv[2:]
    secs = {c: sections(open(f"docs/{doc}.{c}.md", encoding="utf-8").read()) for c in conds}
    n = {c: len(s) for c, s in secs.items()}
    if len(set(n.values())) != 1:
        sys.exit(f"section counts differ: {n}")
    rng = random.Random(f"{doc}-2026-10-27")
    letters = "ABCDEFGH"[: len(conds)]
    key, out = [], [f"# {doc}: {n[conds[0]]} sections, {len(conds)} versions each\n"]
    for i in range(n[conds[0]]):
        order = conds[:]
        rng.shuffle(order)
        key.append(dict(zip(letters, order)))
        head = secs[conds[0]][i].splitlines()[0]
        out.append(f"\n======== SECTION {i + 1}: {head}\n")
        for L, c in zip(letters, order):
            out.append(f"\n-------- Version {L}\n\n{secs[c][i]}\n")
    open(f"judge/{doc}.packet.md", "w", encoding="utf-8").write("".join(out))
    json.dump(key, open(f"judge/{doc}.key.json", "w"), indent=1)
    print(doc, n[conds[0]], "sections")


if __name__ == "__main__":
    main()
