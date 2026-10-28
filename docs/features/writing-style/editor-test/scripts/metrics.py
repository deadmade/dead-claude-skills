"""Measures of Williams & Bizup's lessons over a Markdown file's prose (throwaway).

usage: metrics.py <out.json> <file.md>...   writes {file: {metric: value}, ...} and per-sentence flags

Lessons measured:
  actions/characters: nominalizations per 100 words; share of clauses whose subject is a nominalization or an
                      expletive ("there is", "it is ... that"); passive share
  shape:              words before the subject; subject length; words between subject and verb; long sentences
  cohesion:           adjacent sentences in a paragraph sharing a content lemma; sentences whose opening (up to the
                      main verb) carries something old: a lemma from the previous sentence or a pronoun/demonstrative
  concision:          filler, hedges and metadiscourse per 1,000 words
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BAKE = os.path.join(HERE, "../../bakeoff")
sys.path.insert(0, os.path.join(BAKE, "scripts"))
from mdmask import compact  # noqa: E402

NOM_SUFFIX = ("tion", "sion", "ment", "ance", "ence", "ancy", "ency")
OLD_OPENERS = {"this", "that", "these", "those", "it", "they", "its", "their", "such", "both", "each", "he", "she",
               "the latter", "the former"}
FILLER = [r"it is important to note", r"it should be noted", r"note that", r"it is worth noting", r"importantly",
          r"basically", r"essentially", r"actually", r"really", r"very", r"quite", r"simply", r"just",
          r"in order to", r"as mentioned", r"as noted", r"as described above", r"as discussed",
          r"in this section", r"the following", r"in terms of", r"with respect to", r"with regard to",
          r"the fact that", r"in other words", r"overall", r"of course", r"clearly", r"obviously",
          r"arguably", r"generally", r"typically", r"potentially", r"possibly", r"perhaps", r"somewhat",
          r"robust", r"seamless(?:ly)?", r"leverag(?:e|es|ed|ing)", r"comprehensive", r"ensure that"]
FILLER_RE = re.compile(r"\b(?:" + "|".join(FILLER) + r")\b", re.I)


def wn_has_verb(noun, cache={}):
    if noun not in cache:
        from nltk.corpus import wordnet as wn
        ok = False
        for lem in wn.lemmas(noun, pos="n"):
            for d in lem.derivationally_related_forms():
                v = d.name()
                if d.synset().pos() == "v" and "_" not in v and len(os.path.commonprefix([v, noun])) >= min(4, len(v) - 1):
                    ok = True
        cache[noun] = ok
    return cache[noun]


def is_nom(t):
    return t.pos_ == "NOUN" and t.lemma_.lower().endswith(NOM_SUFFIX) and wn_has_verb(t.lemma_.lower())


def words(toks):
    return [t for t in toks if not t.is_punct and not t.is_space]


def content(s):
    return {t.lemma_.lower() for t in s if t.pos_ in ("NOUN", "PROPN", "VERB", "ADJ") and not t.is_stop
            and t.text != "Foo" and len(t.text) > 2}


def measure(nlp, path):
    text = open(path, encoding="utf-8").read()
    ctext, cmap, blocks = compact(text, code_rep="Foo")
    doc = nlp(ctext)
    para = []  # paragraph id of each sentence: blocks are separated by a blank line in ctext
    sents = []
    for s in doc.sents:
        para.append(ctext.count("\n\n", 0, s.start_char))
        sents.append(s)
    m = {k: 0 for k in ("words", "sentences", "clauses", "long35", "passive", "noms", "abstract_subj", "opener_words",
                        "opener_long", "subj_words", "subj_long", "gap_words", "gap_long", "pairs", "overlap",
                        "old_open", "filler")}
    flags = []
    prev, prev_para = None, None
    for s, p in zip(sents, para):
        w = words(s)
        if len(w) < 4:
            prev, prev_para = None, p
            continue
        m["sentences"] += 1
        m["words"] += len(w)
        m["long35"] += len(w) > 35
        m["noms"] += sum(is_nom(t) for t in s)
        m["filler"] += len(FILLER_RE.findall(s.text))
        line = text.count("\n", 0, cmap[s.start_char]) + 1
        f = []
        if any(t.dep_ in ("auxpass", "nsubjpass") for t in s):
            m["passive"] += 1
            f.append("passive")
        root = s.root
        subj = next((c for c in root.children if c.dep_ in ("nsubj", "nsubjpass", "csubj", "expl")), None)
        if root.pos_ in ("VERB", "AUX") and subj is not None:
            m["clauses"] += 1
            st = list(subj.subtree)
            before = words([t for t in s if t.i < st[0].i])
            sw = words(st)
            gap = words([t for t in s if st[-1].i < t.i < root.i and t.dep_ not in ("aux", "auxpass", "neg")])
            m["opener_words"] += len(before)
            m["subj_words"] += len(sw)
            m["gap_words"] += len(gap)
            if len(before) > 8:
                m["opener_long"] += 1
                f.append(f"opener {len(before)} words")
            if len(sw) > 7:
                m["subj_long"] += 1
                f.append(f"subject {len(sw)} words")
            if len(gap) > 4:
                m["gap_long"] += 1
                f.append(f"subject-verb gap {len(gap)} words")
            if subj.dep_ == "expl" or is_nom(subj):
                m["abstract_subj"] += 1
                f.append(f"abstract subject '{subj.text}'")
            opening = [t for t in s if t.i <= root.i]
        else:
            opening = list(s)[: max(1, len(s) // 3)]
        if prev is not None and prev_para == p:
            m["pairs"] += 1
            pc = content(prev)
            m["overlap"] += bool(pc & content(s))
            otext = " ".join(t.lower_ for t in opening)
            old = bool(pc & content(opening)) or any(t.lower_ in OLD_OPENERS for t in opening[:3])
            m["old_open"] += old
            if not old:
                f.append("opens with nothing from the previous sentence")
        if f:
            flags.append({"line": line, "sentence": s.text.strip()[:300], "flags": f})
        prev, prev_para = s, p
    r = lambda a, b: round(100 * a / b, 1) if b else 0.0
    return {
        "words": m["words"],
        "sentences": m["sentences"],
        "mean sentence words": round(m["words"] / max(1, m["sentences"]), 1),
        "% sentences over 35 words": r(m["long35"], m["sentences"]),
        "% passive sentences": r(m["passive"], m["sentences"]),
        "nominalizations per 100 words": r(m["noms"], m["words"]),
        "% abstract subjects (nominalization or expletive)": r(m["abstract_subj"], m["clauses"]),
        "mean words before subject": round(m["opener_words"] / max(1, m["clauses"]), 2),
        "% openers over 8 words": r(m["opener_long"], m["clauses"]),
        "mean subject words": round(m["subj_words"] / max(1, m["clauses"]), 2),
        "% subjects over 7 words": r(m["subj_long"], m["clauses"]),
        "% subject-verb gaps over 4 words": r(m["gap_long"], m["clauses"]),
        "% adjacent sentences sharing a content word": r(m["overlap"], m["pairs"]),
        "% sentences opening with old information": r(m["old_open"], m["pairs"]),
        "filler per 1,000 words": round(1000 * m["filler"] / max(1, m["words"]), 1),
    }, flags


def main():
    import nltk
    nltk.data.path.insert(0, os.path.join(BAKE, "dl/nltk_data"))
    import spacy
    nlp = spacy.load("en_core_web_trf")
    out = {}
    for p in sys.argv[2:]:
        metrics, flags = measure(nlp, p)
        out[os.path.basename(p)] = metrics
        with open(os.path.splitext(sys.argv[1])[0] + "." + os.path.basename(p) + ".flags.json", "w") as fh:
            json.dump(flags, fh, indent=1)
    json.dump(out, open(sys.argv[1], "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
