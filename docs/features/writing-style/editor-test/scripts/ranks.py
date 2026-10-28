"""Turns blind rankings back into conditions (throwaway). usage: ranks.py <doc> <judge>..."""
import collections, json, sys
doc = sys.argv[1]
key = json.load(open(f"judge/{doc}.key.json"))
for j in sys.argv[2:]:
    rows = [json.loads(l) for l in open(f"judge/rank.{doc}.{j}.jsonl")]
    pos, first, probs = collections.defaultdict(list), collections.Counter(), collections.Counter()
    for r in rows:
        k = key[r["section"] - 1]
        for i, L in enumerate(r["ranking"]):
            pos[k[L]].append(i + 1)
        first[k[r["ranking"][0]]] += 1
        for L in (r.get("meaning_problems") or {}):
            probs[k[L]] += 1
    print(f"== {doc} / {j}: {len(rows)} sections (mean rank, 1 = best; sections ranked first; sections with a meaning problem)")
    for c in sorted(pos, key=lambda c: sum(pos[c]) / len(pos[c])):
        print(f"  {c:11} {sum(pos[c]) / len(pos[c]):.2f}   first {first[c]:2}   meaning problems {probs[c]}")
