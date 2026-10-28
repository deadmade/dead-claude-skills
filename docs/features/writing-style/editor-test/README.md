# Editor test

The test behind the writing-style design, run 2026-10-27 (results in [../flow.md](../flow.md), under **Options**).
It is kept here so the acceptance run (spec success criterion 4) can repeat it with the shipped pieces.

## What was compared

Two documents at commit `8281c59`: `docs/features/web-mcp-search/spec.md` and `docs/features/web-mcp-search/findings.md`.
Each was edited four ways, by fresh subagents that read only the files named in their prompt:

| version      | model  | prompt                                                                |
| ------------ | ------ | --------------------------------------------------------------------- |
| `plain`      | Opus   | the base prompt                                                       |
| `book`       | Opus   | the base prompt plus the book paragraph                               |
| `bookcand`   | Opus   | the base prompt plus the book paragraph plus the candidates paragraph |
| `booksonnet` | Sonnet | the base prompt plus the book paragraph                               |

The edited documents are in `versions/`. The editing guide was [book.md](book.md); the shared rules were
[common.txt](common.txt); the candidates were `data/<doc>.candidates.txt`, made by the spaCy prototype in
`scripts/prototype/` (`parse_check.py`) plus `scripts/metrics.py`'s per-sentence flags.

Base prompt:

```
You are a copy editor. S=<test folder>

Edit the Markdown document S/docs/<doc>.orig.md so it reads clearly to a smart reader who was not in the conversation that produced it.

Read the rules in S/common.txt and follow them. Output path: S/docs/<doc>.<version>.md
```

Book paragraph, before the last line:

```
Edit by the method in S/book.md: run its diagnoses on every sentence and paragraph, then revise where a diagnosis shows a problem and the change helps the reader.
```

Candidates paragraph, after the book paragraph:

```
A code check has already measured the document against the book and listed candidate problems by line in S/out/<doc>.candidates.txt (in it, code spans appear as "Foo"). Judge each candidate by the book: fix it when the fix helps the reader, leave it when it doesn't (many passives and openers are fine). The list is a starting point, not a limit: diagnose the sentences it doesn't mention too.
```

## How it was scored

- **Blind ranking.** `scripts/packets.py <doc> orig plain book bookcand booksonnet` splits every version at its
  headings and shuffles the versions per section (seeded) into `judge/<doc>.packet.md` and `judge/<doc>.key.json`. A
  Sonnet judge and a Fable judge each ranked every section's five versions, best to worst, for "a smart, technical
  reader who was not in the conversation", and noted meaning problems. `scripts/ranks.py <doc> sonnet fable` decodes
  the rankings.
- **Facts.** A Fable agent listed the originals' claims (`data/<doc>.facts.jsonl`, 141 and 163). A Sonnet agent
  checked each claim in all four versions at once: kept, changed or missing (`results/facts.spec.jsonl`; the findings
  check found none).
- **Known problems.** `data/spec.gold.txt` holds the 47 problems an annotator marked in the spec before the test. One
  Fable judge decided fixed, remains or lost for all four versions together, by one rule: a conversation label counts
  as fixed only when it is gone or explained in place, never by a legend elsewhere (`results/gold.spec.all.jsonl`).
- **Measures.** `scripts/metrics.py` (spaCy `en_core_web_trf`) computed the book's measures for every version
  (`results/<doc>.metrics.json`).
- **Preservation.** `scripts/preserve.py <orig> <edit>...` lists code spans, quotes, numbers, link targets and headings
  missing from an edit.

The scripts are throwaway: `metrics.py` imports the prototype's `mdmask.py` and reads NLTK's WordNet from the bake-off
folder it was written in, so a re-run points those paths at `scripts/prototype/` and a local `nltk_data`.
