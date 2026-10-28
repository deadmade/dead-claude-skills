"""spaCy candidates for /copyedit.

Reads a Markdown document masked by prose.mjs's mask(text, { code: 'X' }) on stdin (code, front matter, link targets
and block quotes are blank, code spans read as "X", every line is where the document has it) and writes JSON to
stdout: {"candidates": [{"line", "kind", "text", "note"}], "totals": {...}}, lines 1-based.

The measures and thresholds are those of the writing-style editor test (docs/features/writing-style/editor-test/
scripts/metrics.py and prototype/parse_check.py), without WordNet: a noun counts as made from a verb by its part of
speech and its suffix.

Exit 1 on input that isn't UTF-8, 3 with one line on stderr when spaCy or the model can't load.
"""
import bisect
import json
import re
import sys
import warnings

# Nouns made from verbs: a NOUN whose lemma has one of these suffixes and at least 5 letters.
NOM_SUFFIX = ("tion", "sion", "ment", "ance", "ence", "al", "ing", "ure", "ancy", "ency", "ity", "sis", "age", "ery")
# A verb that carries little when its object is such a noun ("make a decision"), and one that carries little when
# such a noun is its subject ("the installation happens"). "carry" counts with "out", "take" with "place".
LIGHT = {"make", "give", "take", "have", "do", "perform", "conduct", "provide", "reach", "achieve", "effect",
         "carry", "undertake", "gain"}
WEAK = {"be", "occur", "happen", "depend", "take"}
# Words that open a sentence with something the reader already has.
OLD_OPENERS = {"this", "that", "these", "those", "it", "they", "its", "their", "such", "both", "each", "he", "she",
               "latter", "former"}

OPENER_MAX, SUBJECT_MAX, GAP_MAX, LIST_MIN = 8, 7, 4, 4
MIN_WORDS = 4  # shorter sentences (headings, labels) are skipped and break the chain of adjacent sentences

HEADING = re.compile(r" {0,3}#{1,6}(?:[ \t]+|$)")
CLOSING_HASHES = re.compile(r"[ \t]+#+[ \t]*$")
LIST_MARK = re.compile(r"[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?:[ \t]+|$)")
RULE = re.compile(r"[ \t]*(?:([-*_=])[ \t]*)(?:\1[ \t]*){2,}$")  # thematic break or setext underline
TABLE_SEPARATOR = re.compile(r"[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$")
CELL = re.compile(r"(?:\\\||[^|])+")


def blocks(text):
    """The document's blocks, each a list of (offset, text) pieces: a paragraph's lines, a heading, a list item and
    its continuation lines, a table cell. Blank lines, rules, headings, list markers and table rows start a new one."""
    out, current, current_kind = [], None, None
    offset = 0
    for raw in text.split("\n"):
        start, offset = offset, offset + len(raw) + 1
        line = raw.rstrip("\r")
        if not line.strip() or RULE.match(line):
            current = None
            continue
        heading = HEADING.match(line)
        if heading:
            body = CLOSING_HASHES.sub("", line[heading.end():])
            out.append(("heading", [(start + heading.end(), body)]))
            current = None
            continue
        if line.lstrip().startswith("|"):
            current = None
            if not TABLE_SEPARATOR.match(line):
                out += [("cell", [(start + m.start(), m.group())]) for m in CELL.finditer(line) if m.group().strip()]
            continue
        item = LIST_MARK.match(line)
        if item:
            current, current_kind = [], "item"
            out.append((current_kind, current))
            current.append((start + item.end(), line[item.end():]))
            continue
        if current is None:
            current, current_kind = [], "para"
            out.append((current_kind, current))
        current.append((start, line))
    return out


def flatten(pieces):
    """One line of text per block with runs of white space as one space, and each character's offset in the input."""
    chars, offsets = [], []
    for start, piece in pieces:
        for i, ch in enumerate(piece + " "):
            if ch.isspace():
                if chars and chars[-1] != " ":
                    chars.append(" ")
                    offsets.append(start + i)
            else:
                chars.append(ch)
                offsets.append(start + i)
    while chars and chars[-1] == " ":
        chars.pop()
        offsets.pop()
    return "".join(chars), offsets


def words(tokens):
    return [t for t in tokens if not t.is_punct and not t.is_space]


def content(tokens):
    return {t.lemma_.lower() for t in tokens if t.pos_ in ("NOUN", "PROPN", "VERB", "ADJ") and not t.is_stop
            and len(t.text) > 2}


def is_nominalization(t):
    lemma = t.lemma_.lower()
    return t.pos_ == "NOUN" and len(lemma) >= 5 and lemma.endswith(NOM_SUFFIX)


def span_text(doc, tokens):
    tokens = sorted(tokens, key=lambda t: t.i)
    return doc[tokens[0].i:tokens[-1].i + 1].text


def clip(tokens, n=12):
    """The tokens' text without punctuation at either end, cut after n tokens."""
    ws = [t for t in tokens if not t.is_space]
    while ws and ws[0].is_punct:
        ws.pop(0)
    while ws and ws[-1].is_punct:
        ws.pop()
    text = "".join(t.text_with_ws for t in ws[:n]).strip()
    return text + " ..." if len(ws) > n else text


def nominalizations(doc, sent):
    found = []
    for t in sent:
        if not is_nominalization(t):
            continue
        h = t.head
        verb = h.lemma_.lower()
        if t.dep_ == "dobj" and h.pos_ in ("VERB", "AUX") and verb in LIGHT:
            if verb == "carry" and not any(c.lower_ == "out" for c in h.children):
                continue
            found.append((h, span_text(doc, [h, t]), f"the action is in the noun '{t.text}' after '{h.text}'"))
        elif t.dep_ in ("nsubj", "nsubjpass") and verb in WEAK:
            if verb == "take" and not any(c.lower_ == "place" for c in h.children):
                continue
            dets = [c for c in t.children if c.dep_ == "det" and c.i < t.i]
            found.append((t, span_text(doc, dets + [t, h]),
                          f"the subject '{t.text}' hides the action; '{h.text}' carries little"))
    return found


def third_person(verb):
    if verb.endswith(("s", "sh", "ch", "x", "z", "o")):
        return verb + "es"
    if len(verb) > 1 and verb.endswith("y") and verb[-2] not in "aeiou":
        return verb[:-1] + "ies"
    return verb + "s"


def passives(doc, sent):
    found, seen = [], set()
    for t in sent:
        if t.dep_ not in ("auxpass", "nsubjpass"):
            continue
        v = t.head
        if v.i in seen or v.pos_ == "ADJ" or v.dep_ in ("acomp", "amod") or v.tag_ == "JJ":
            continue
        if any(c.dep_ == "agent" for c in v.children):
            continue
        aux = [c for c in v.children if c.dep_ == "auxpass"]
        if not aux:
            continue
        seen.add(v.i)
        first = min(a.i for a in aux)
        found.append((doc[first], doc[first:v.i + 1].text, f"no agent: who {third_person(v.lemma_.lower())}?"))
    return found


def lists(doc, sent):
    found = []
    for t in sent:
        if t.dep_ == "conj":
            continue
        items, stack = [t], [t]
        while stack:
            for c in stack.pop().children:
                if c.dep_ == "conj":
                    items.append(c)
                    stack.append(c)
        if len(items) >= LIST_MIN:
            covered = sorted({x.i for item in items for x in item.subtree})
            found.append((doc[covered[0]], clip(doc[covered[0]:covered[-1] + 1]), f"{len(items)} parallel items"))
    return found


def measure(nlp, text):
    starts = [0] + [m.end() for m in re.finditer("\n", text)]
    line_of = lambda offset: bisect.bisect_right(starts, offset)
    parts = [(block_kind, *flatten(pieces)) for block_kind, pieces in blocks(text)]
    parts = [p for p in parts if p[1]]
    m = dict.fromkeys(("words", "sentences", "noms", "passive", "abstract", "no_link", "opener", "subject", "gap",
                       "list", "pairs", "overlap"), 0)
    candidates, seen = [], set()

    def add(offsets, token, kind, text, note):
        key = (offsets[token.idx], kind, text)
        if key not in seen:
            seen.add(key)
            candidates.append({"line": line_of(offsets[token.idx]), "kind": kind, "text": text, "note": note})

    for (block_kind, _, offsets), doc in zip(parts, nlp.pipe([p[1] for p in parts], n_process=1)):
        prev = None
        for s in doc.sents:
            w = words(s)
            if len(w) < MIN_WORDS:
                prev = None
                continue
            m["sentences"] += 1
            m["words"] += len(w)
            flags = set()

            def flag(name, token, kind, text, note):
                flags.add(name)
                add(offsets, token, kind, text, note)

            noms = nominalizations(doc, s)
            m["noms"] += len(noms)
            for token, text, note in noms:
                add(offsets, token, "nominalization", text, note)
            for token, text, note in passives(doc, s):
                flag("passive", token, "passive", text, note)
            if block_kind not in ("item", "cell"):
                for token, text, note in lists(doc, s):
                    flag("list", token, "list in a sentence", text, note)

            root = s.root
            subj = next((c for c in root.children if c.dep_ in ("nsubj", "nsubjpass", "csubj", "expl")), None)
            if root.pos_ in ("VERB", "AUX") and subj is not None:
                st = sorted(subj.subtree, key=lambda t: t.i)
                before = [t for t in s if t.i < st[0].i]
                gap = [t for t in s if st[-1].i < t.i < root.i]
                n_before, n_subject = len(words(before)), len(words(st))
                n_gap = len(words([t for t in gap if t.dep_ not in ("aux", "auxpass", "neg")]))
                if n_before > OPENER_MAX:
                    flag("opener", s[0], "long opener", clip(before), f"{n_before} words before the subject")
                if n_subject > SUBJECT_MAX:
                    flag("subject", st[0], "long subject", clip(st), f"{n_subject}-word subject")
                if n_gap > GAP_MAX:
                    flag("gap", gap[0], "subject-verb gap", clip(gap),
                         f"{n_gap} words between the subject and its verb '{root.text}'")
                if subj.dep_ == "expl":
                    flag("abstract", subj, "abstract subject", f"{subj.text} {root.text}",
                         f"'{subj.text}' as the subject")
                elif is_nominalization(subj):
                    flag("abstract", st[0], "abstract subject", clip(st), f"the subject '{subj.text}' is an action")
                opening = [t for t in s if t.i <= root.i]
            else:
                opening = list(s)[: max(1, len(s) // 3)]

            if prev is not None:
                m["pairs"] += 1
                shared = content(prev)
                m["overlap"] += bool(shared & content(s))
                if not (shared & content(opening) or any(t.lower_ in OLD_OPENERS for t in opening[:3])):
                    flag("no_link", s[0], "no link to the previous sentence", clip(opening),
                         "opens with nothing from the sentence before")
            for name in flags:
                m[name] += 1
            prev = s

    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0
    n = m["sentences"]
    totals = {
        "words": m["words"],
        "sentences": n,
        "nominalizations per 100 words": pct(m["noms"], m["words"]),
        "% passive sentences": pct(m["passive"], n),
        "% abstract subjects": pct(m["abstract"], n),
        "% sentences with no link to the previous sentence": pct(m["no_link"], n),
        "% long openers (over 8 words)": pct(m["opener"], n),
        "% long subjects (over 7 words)": pct(m["subject"], n),
        "% subject-verb gaps (over 4 words)": pct(m["gap"], n),
        "% lists in a sentence": pct(m["list"], n),
        "% adjacent sentences sharing a content word": pct(m["overlap"], m["pairs"]),
    }
    candidates.sort(key=lambda c: c["line"])
    return {"candidates": candidates, "totals": totals}


def main():
    try:
        text = sys.stdin.buffer.read().decode("utf-8")
    except Exception as e:
        print(f"measure.py: can't read the input: {e}", file=sys.stderr)
        return 1
    warnings.filterwarnings("ignore")
    try:
        import spacy
        nlp = spacy.load("en_core_web_trf")
    except Exception as e:
        line = f"measure.py: can't load spaCy's en_core_web_trf: {type(e).__name__}: {e}".splitlines()[0]
        print(line, file=sys.stderr)
        return 3
    sys.stdout.write(json.dumps(measure(nlp, text)) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
