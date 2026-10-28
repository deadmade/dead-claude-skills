"""Parser-based prose checker prototype (throwaway).

usage: parse_check.py <file.md> <out.jsonl> [--model en_core_web_trf]

spaCy (en_core_web_trf) + WordNet over Markdown masked by mdmask.py (front matter, code, link
targets, block quotes, HTML removed; offsets mapped back to the source).
Phrase tables come only from public-domain / CC0 sources:
  plainlanguage.gov (CC0): use-simple-words-phrases.md, avoid-hidden-verbs.md, use-positive-language.md
  Strunk, The Elements of Style (1920, public domain, Gutenberg #37134): rules 11 and 13
Rule ids: passive, nominalization.light_verb, nominalization.weak_verb_subject, nominalization.the_of,
wordy.<source>, redundant.<source>, negative.<source>, negative.antonym, list, undefined, shorthand.<kind>, long.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from mdmask import compact, line_starts, offset_to_linecol  # noqa: E402

PL = os.path.join(B, "dl/plainlanguage-repo/repo/_pages/guidelines")

# ---------------------------------------------------------------- phrase tables
# Multi-word entries of plainlanguage.gov "Use simple words and phrases" are parsed from the page;
# single-word substitutions (provide -> give, ensure -> make sure, ...) are left out on purpose:
# "wordy" here means a phrase with a shorter equivalent.
PL_SKIP = {"it is", "said, some, such", "this activity, command", "a and/or b", "/ (slash)", "your office",
           "for example,______etc.", "not later than 10 May", "not later than 1600", "addressees are requested"}
PL_REDUNDANT = {"close proximity", "time period", "successfully complete", "combat environment"}


def load_plainlanguage_simple():
    rows = []
    for line in open(os.path.join(PL, "words/use-simple-words-phrases.md"), encoding="utf-8"):
        if "|" not in line or line.startswith("**Don") or line.startswith("----"):
            continue
        left, right = [x.strip() for x in line.split("|", 1)]
        left = left.replace("**", "").replace("\\_", "_").strip()
        right = right.replace("**", "").strip()
        for variant in [v.strip() for v in left.split(",")] if left in ("assist, assistance", "utilize, utilization") else [left]:
            if variant in PL_SKIP or left in PL_SKIP or len(variant.split()) < 2:
                continue
            rows.append((variant, right))
    return rows


STRUNK_WORDY = [  # rule 13, "Omit needless words"
    ("the question as to whether", "whether"),
    ("there is no doubt but that", "no doubt (doubtless)"),
    ("used for * purposes", "used for *"),
    ("he is a man who", "he"),
    ("in a * manner", "-ly adverb"),
    ("this is a subject which", "this subject"),
    ("owing to the fact that", "since (because)"),
    ("in spite of the fact that", "though (although)"),
    ("call your attention to the fact that", "remind you (notify you)"),
    ("unaware of the fact that", "unaware that (did not know)"),
    ("the fact that", "revise 'the fact that' out of the sentence"),
    (", who is", "drop 'who is' (often superfluous)"),
    (", which is", "drop 'which is' (often superfluous)"),
    (", which was", "drop 'which was' (often superfluous)"),
    (", who was", "drop 'who was' (often superfluous)"),
]
STRUNK_NEGATIVE = [  # rule 11, "Put statements in positive form"
    ("not honest", "dishonest"),
    ("not important", "trifling"),
    ("do not remember", "forgot"),
    ("do not pay any attention to", "ignored"),
    ("do not have much confidence in", "distrusted"),
    ("not very often", "usually / rarely"),
]
PL_NEGATIVE = [  # plainlanguage.gov "Use positive language"
    ("no fewer than", "at least"),
    ("have not yet attain", "is under"),
    ("may not ... until", "may only ... when"),
    ("be not ... unless", "is ... only if"),
] + [("not " + w, "a positive word") for w in
     ("unless", "fail to", "notwithstanding", "except", "other than", "unlawful", "disallowed", "terminate",
      "void", "insufficient")]

COMMON_ABBR = set("""API APIs URL URLs JSON CLI MCP PR PRs CI CD HTTP HTTPS HTML CSS PDF OS UI ID IDs SQL CPU GPU RAM SDK
IDE LLM AI ML US UK EU OK FAQ TODO README YAML XML SSH DNS IP TLS SSL JS TS NPM PNG SVG VM USB MIT CSV""".split())

LIGHT = {"make", "give", "take", "have", "do", "perform", "conduct", "provide", "reach", "achieve", "effect",
         "carry", "undertake", "gain"}  # carry -> "carry out"; undertake/gain from avoid-hidden-verbs examples
WEAK = {"be", "occur", "happen", "depend", "take"}  # take -> "take place"
NOM_SUFFIX = ("tion", "sion", "ment", "ance", "ence", "al", "ing", "ure", "ancy", "ency", "ity", "sis", "age", "ery")


def wn_verbs(noun):
    from nltk.corpus import wordnet as wn
    out = []
    for lem in wn.lemmas(noun, pos="n"):
        for d in lem.derivationally_related_forms():
            if d.synset().pos() == "v" and "_" not in d.name():
                out.append(d.name())
    # prefer verbs sharing a stem with the noun
    out = sorted(set(out), key=lambda v: (-len(os.path.commonprefix([v, noun])), v))
    return [v for v in out if len(os.path.commonprefix([v, noun])) >= min(4, len(v) - 1)]


def wn_antonyms(word, pos):
    from nltk.corpus import wordnet as wn
    out = []
    for lem in wn.lemmas(word, pos=pos):
        for a in lem.antonyms():
            out.append(a.name().replace("_", " "))
    return sorted(set(out))


def main():
    src, outp = sys.argv[1], sys.argv[2]
    model = "en_core_web_trf"
    if "--model" in sys.argv:
        model = sys.argv[sys.argv.index("--model") + 1]
    import nltk
    nltk.data.path.insert(0, os.path.join(B, "dl/nltk_data"))
    import spacy
    t_load = time.time()
    nlp = spacy.load(model)
    from spacy.language import Language

    @Language.component("block_breaks")
    def block_breaks(doc):
        # each Markdown block (paragraph, heading, list item, cell) starts a new sentence
        for i, t in enumerate(doc):
            if i == 0:
                continue
            prev = doc[i - 1]
            if "\n\n" in prev.whitespace_ or (prev.is_space and "\n\n" in prev.text):
                t.is_sent_start = True
            elif not prev.is_space and not t.is_space:
                pass
        return doc

    nlp.add_pipe("block_breaks", before="parser")
    t_load = time.time() - t_load

    text = open(src, encoding="utf-8").read()
    starts = line_starts(text)
    ctext, cmap, blocks = compact(text, code_rep="Foo")
    t0 = time.time()
    doc = nlp(ctext)

    def block_of(off):
        for b in blocks:
            if b["start"] <= off < b["end"]:
                return b
        return None

    findings = []
    seen = set()

    def emit(rule, cat, cstart, cend, message, sugg):
        s = cmap[cstart]
        e = cmap[cend - 1] + 1 if cend > cstart else s
        key = (rule, s, e)
        if key in seen:
            return
        seen.add(key)
        line, col = offset_to_linecol(starts, s)
        findings.append({"tool": "parse_check", "rule": rule, "category": cat, "line": line, "col": col,
                         "match": text[s:e], "message": message, "suggestion": sugg})

    def tok_span(toks):
        toks = sorted(toks, key=lambda t: t.i)
        return toks[0].idx, toks[-1].idx + len(toks[-1].text)

    # --- lemma phrase matcher
    phrase_tables = []
    for p, r in load_plainlanguage_simple():
        cat = "redundant" if p in PL_REDUNDANT else ("negative" if p.startswith("fail") else "wordy")
        phrase_tables.append((f"{cat}.plainlanguage", cat, p, r))
    for p, r in STRUNK_WORDY:
        phrase_tables.append(("wordy.strunk13", "wordy", p, r))
    phrase_tables.append(("redundant.strunk13", "redundant", "used for * purposes", "used for *"))
    for p, r in STRUNK_NEGATIVE:
        phrase_tables.append(("negative.strunk11", "negative", p, r))
    for p, r in PL_NEGATIVE:
        phrase_tables.append(("negative.plainlanguage", "negative", p, r))
    lemma_cache = {}

    def plem(word):
        if word not in lemma_cache:
            d = nlp(word)
            lemma_cache[word] = d[0].lemma_.lower() if len(d) == 1 else word
        return lemma_cache[word]

    compiled = []
    for rule, cat, p, r in phrase_tables:
        pt = re.findall(r"\.\.\.|\*|[\w'-]+|[,]", p.lower())
        compiled.append((rule, cat, p, r, pt))

    def tok_eq(tok, w):
        low = tok.lower_
        if w == "not" and low in ("not", "n't"):
            return True
        return low == w or tok.lemma_.lower() == plem(w) or tok.lemma_.lower() == w

    for sent in doc.sents:
        toks = [t for t in sent if not t.is_space]
        for rule, cat, p, r, pt in compiled:
            for i in range(len(toks)):
                j = i
                k = 0
                ok = True
                while k < len(pt):
                    w = pt[k]
                    if w == "...":
                        # gap of up to 6 tokens before the next word
                        nxt = pt[k + 1]
                        found = None
                        for g in range(j, min(len(toks), j + 7)):
                            if tok_eq(toks[g], nxt):
                                found = g
                                break
                        if found is None:
                            ok = False
                            break
                        j = found + 1
                        k += 2
                        continue
                    if j >= len(toks):
                        ok = False
                        break
                    if w == "*":
                        if not toks[j].is_alpha:
                            ok = False
                            break
                    elif not tok_eq(toks[j], w):
                        ok = False
                        break
                    j += 1
                    k += 1
                if ok and j > i:
                    s, e = tok_span(toks[i:j])
                    emit(rule, cat, s, e, f"'{p}' has a shorter or plainer form (source: {rule.split('.')[1]})"
                         if cat != "negative" else f"Negative form '{p}'; state it positively (source: {rule.split('.')[1]})",
                         r)

    # --- negative via WordNet antonyms (Strunk rule 11 principle): not + ADJ/ADV/VERB with a direct antonym
    for t in doc:
        if t.dep_ == "neg" or t.lower_ in ("not", "n't"):
            h = t.head
            # "not many/much X": negation on a quantifier
            nxt = doc[t.i + 1] if t.i + 1 < len(doc) else None
            cand = None
            if nxt is not None and nxt.lower_ in ("many", "much", "all", "often", "possible", "able", "enough",
                                                  "different", "same", "important", "necessary", "valid", "visible",
                                                  "available", "known", "clear", "true", "present", "complete"):
                cand = nxt
            elif h.pos_ in ("ADJ", "ADV") and h.i > t.i:
                cand = h
            elif h.pos_ in ("ADJ",) and any(c.dep_ == "acomp" for c in []):
                cand = h
            else:
                acomp = [c for c in h.children if c.dep_ == "acomp" and c.i > t.i]
                if h.lemma_ == "be" and acomp:
                    cand = acomp[0]
                elif h.pos_ == "VERB" and h.i > t.i and h.lemma_ not in ("be", "have", "do"):
                    cand = h
            if cand is None:
                continue
            posmap = {"ADJ": "a", "ADV": "r", "VERB": "v", "DET": "a", "PRON": "a"}
            pos = posmap.get(cand.pos_, "a")
            ants = wn_antonyms(cand.lemma_.lower(), pos) or wn_antonyms(cand.lower_, "s" if pos == "a" else pos)
            if not ants:
                continue
            s, e = tok_span([t, cand])
            emit("negative.antonym", "negative", s, e,
                 f"Negated '{cand.text}' has an affirmative form (WordNet antonym)", ", ".join(ants[:3]))

    # --- passive without agent
    for t in doc:
        if t.dep_ == "auxpass" or (t.dep_ == "nsubjpass"):
            v = t.head
            if v.pos_ == "ADJ" or v.dep_ in ("acomp", "amod") or v.tag_ == "JJ":
                continue
            if any(c.dep_ == "agent" for c in v.children):
                continue
            auxs = [c for c in v.children if c.dep_ in ("auxpass",)]
            if not auxs:
                continue
            first = min([a.i for a in auxs] + [v.i])
            span = [tt for tt in doc[first:v.i + 1]]
            key = ("p", v.i)
            if key in seen:
                continue
            seen.add(key)
            s, e = tok_span(span)
            emit("passive", "passive", s, e, f"Passive '{doc[first:v.i + 1].text}' with no 'by' agent: who {v.lemma_}s?",
                 None)

    # --- nominalizations
    def nom_verbs(n):
        lw = n.lemma_.lower()
        if n.pos_ != "NOUN" or not lw.endswith(NOM_SUFFIX) or len(lw) < 5:
            return []
        return wn_verbs(lw)

    for t in doc:
        if t.pos_ != "NOUN":
            continue
        vs = nom_verbs(t)
        if not vs:
            continue
        h = t.head
        hl = h.lemma_.lower()
        if t.dep_ == "dobj" and h.pos_ in ("VERB", "AUX") and hl in LIGHT:
            if hl == "carry" and not any(c.lower_ == "out" for c in h.children):
                continue
            s, e = tok_span([h, t] + [c for c in t.children if c.dep_ == "det" and c.i > h.i])
            emit("nominalization.light_verb", "nominalization", s, e,
                 f"Action buried in the noun '{t.text}' after the light verb '{h.text}'", vs[0])
        elif t.dep_ in ("nsubj", "nsubjpass") and hl in WEAK:
            if hl == "take" and not any(c.lower_ == "place" for c in h.children):
                continue
            span = [t] + [c for c in t.children if c.dep_ == "det" and c.i < t.i] + [h]
            span = [x for x in doc[min(x.i for x in span):max(x.i for x in span) + 1]]
            s, e = tok_span(span)
            emit("nominalization.weak_verb_subject", "nominalization", s, e,
                 f"Noun subject '{t.text}' hides the action; '{h.text}' carries little", vs[0])
        else:
            # plainlanguage: "the <nominalization> of"
            dets = [c for c in t.children if c.dep_ == "det" and c.lower_ == "the"]
            ofs = [c for c in t.children if c.dep_ == "prep" and c.lower_ == "of"]
            if dets and ofs and t.lemma_.lower().endswith(("tion", "sion", "ment", "ance", "ence", "ing")):
                s, e = tok_span([dets[0], ofs[0]])
                emit("nominalization.the_of", "nominalization", s, e,
                     f"'the {t.text} of' hides the verb", vs[0])

    # --- lists: 4+ coordinated items outside list items / tables
    def conj_chain(t):
        items = [t]
        stack = [t]
        while stack:
            x = stack.pop()
            for c in x.children:
                if c.dep_ == "conj":
                    items.append(c)
                    stack.append(c)
        return items

    for t in doc:
        if t.dep_ == "conj":
            continue
        items = conj_chain(t)
        if len(items) >= 4:
            b = block_of(cmap[t.idx])
            if b and (b["in_list"] or b["in_table"]):
                continue
            subtree = [x for it in items for x in it.subtree]
            s, e = tok_span(subtree)
            emit("list", "list", s, e, f"{len(items)} coordinated items in one sentence; consider a list", None)

    # --- long sentences
    for sent in doc.sents:
        words = [t for t in sent if not t.is_punct and not t.is_space and re.search(r"\w", t.text)]
        if len(words) > 40:
            toks = [t for t in sent if not t.is_space]
            s, e = tok_span(toks)
            emit("long", "long", s, e, f"Sentence of {len(words)} words (over 40)", None)

    # --- undefined abbreviations and shorthand: regex over the masked text
    defined = set()
    flagged = set()
    for m in re.finditer(r"(?<![\w-])([A-Z]{2,6})(s?)(?![\w-])(?!\.\w)", ctext):
        ab = m.group(1)
        if ab in COMMON_ABBR or ab + m.group(2) in COMMON_ABBR:
            continue
        before = ctext[max(0, m.start() - 1):m.start()]
        after = ctext[m.end():m.end() + 2]
        if before == "(" and ctext[m.end():m.end() + 1] == ")":
            defined.add(ab)
            continue
        if after.startswith(" (") or after.startswith("("):
            defined.add(ab)
            continue
        if ab in defined or ab in flagged:
            continue
        flagged.add(ab)
        emit("undefined", "undefined", m.start(), m.end(), f"'{ab}' is used before it is defined", None)

    for kind, pat in (("q", r"(?<![\w-])Q\d+(?:[–-]Q?\d+)?(?![\w-])"), ("d", r"(?<![\w-])D-?\d+(?![\w-])"),
                      ("round", r"(?i)(?<![\w-])rounds? \d+(?:[–-]\d+)?(?![\w-])"), ("my_call", r"(?i)\bmy call\b")):
        for m in re.finditer(pat, ctext):
            emit(f"shorthand.{kind}", "shorthand", m.start(), m.end(),
                 f"'{m.group(0)}' refers to the original conversation", None)

    t_check = time.time() - t0
    findings.sort(key=lambda r: (r["line"], r["col"], r["rule"]))
    with open(outp, "w", encoding="utf-8") as f:
        for r in findings:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{len(findings)} findings; model load {t_load:.1f}s; check {t_check:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
