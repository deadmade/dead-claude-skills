# Writing style: spec

Status: approved 2026-10-27 and revised 2026-10-28; cut back 2026-10-30, after the review of the built branch, to the
parts the evidence supports. [flow.md](flow.md) has the history and the measurements.

## Intent

The flows write specs, plans and reports that the user reads at every gate. Agents write them the way they work: in
the order things happened, dense with conversation labels (`grill Q11`, `round 2`, `my call`), with verbs buried in
nouns and actors hidden in passives. But the user reads them cold, so each such document costs attention at every
gate, and the user calls the result slop. This feature gives the flows one writing standard, taken from Joseph M.
Williams and Joseph Bizup, _Style: Lessons in Clarity and Grace_ (12th ed., Pearson, 2016), and applies it in three
places: while Claude writes, after each Markdown write, and before a gate.

The aim is prose a person can read without effort, not shorter documents. There are no length limits and no banned
words.

## Goals

1. **One writing skill.** `plugins/flows/skills/writing/SKILL.md` states _Style_'s method in our own words as checks to
   run on a draft, from the document down to its words. It replaces pstack's `technical-writing` and `unslop`, and
   Claude may load it on its own.
2. **A shorthand check on every write.** A code-only `PostToolUse` hook flags conversation labels in new Markdown text,
   while the writer still knows what they mean.
3. **A copyedit before each gate.** The writing skill's copyedit has a fresh Opus editor revise a spec, plan or audit report by the
   skill, and replaces the document only when code shows nothing was lost.

## Non-goals

- No length limits, banned-word lists, or grammar and spelling checks.
- No model call on every write.
- No pattern rules for passives, nominalizations or wordy phrases: every tool measured flagged mostly sentences that
  read well (see Evidence).
- No rewriting of existing documents.

## The skill

The skill opens with the rule, _write for a smart reader who wasn't there, and omit needless words_, then tells
Claude to draft first and revise from the top down, spending the most time on beginnings. Its sections follow the
book:

| Section                 | From _Style_                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| The document            | Lesson 7: context, problem (condition and cost), point. Lesson 8: the point at the end of a short opening, the outline test, the reader's order instead of the order of discovery, a relevance test |
| Sections and paragraphs | Lesson 5: old before new, topic strings, one name per thing, no faked connectives. Lesson 6: new and important at the end |
| Sentences               | Lessons 3 and 4: the seven-word check, where hidden characters and actions sit, when to keep a noun or a passive. Lesson 10: shape, sprawl and its four fixes |
| Words                   | Lesson 9: the six cuts, metadiscourse, hedges and intensifiers, concise but not terse, with the density test of technical-writing-density |
| Honesty                 | Lesson 12: the subject decides whether a sentence says who acted                                                |

Behind `SKILL.md` sits one reference per lesson and appendix in `references/` (about 14,000 words for a book of about
75,000 in these chapters): every principle, diagnostic, revision technique, exception and caution, as procedures in
our own words with invented software examples. `SKILL.md` is the short form and links them; Lessons 2 and 11 and the
appendices are covered there too, as a last pass, for quoting, and for the rare elegant passage. A last section holds
rules for technical documents that the book doesn't cover: no conversation shorthand, a decision
recorded once, the code's own names, whole sentences in prose, lists for four or more parallel items. Every statement was checked against the book, lesson by lesson (flow.md, **Book check**). The skill
copies no passage and credits technical-writing-density for its one borrowed test.

`/doc-audit` and `/integrate` use it where they used `technical-writing` and `unslop`; `sync-pstack.mjs` stops
vendoring those two and points the three pstack lines that named `unslop` at `flows:writing`.

## The check

`plugins/flows/hooks/prose-check.mjs` runs on `Write` and `Edit` of any `*.md` file. It flags `Q` or `D` with a number
(not a quarter followed by a year), `round` with a number, and "my call", unless the file defines the label. It reads
only new text: an Edit's `new_string`, or the lines a Write added to the file (all of it for a new file). It skips
code, front matter, link targets and block quotes, and it is off in `flow.md`, the log where labels belong. It prints
at most 10 findings and exits 2, so Claude sees them, closing with _"Fix what makes the prose worse for a reader.
Leave a sentence as is when the finding is wrong."_ It exits 0 silently on any error. `FLOWS_PROSE_CHECK=off` turns it
off.

## The copyedit

The copyedit lives in the writing skill (`references/copyedit.md`, `scripts/compare.mjs`) and runs as
`/flows:writing copyedit <file.md>`. It saves the document to the scratchpad, has a fresh `general-purpose` agent on Opus write an
edited version by the skill, and runs `compare.mjs`. The script refuses the edit, and leaves the document as it was,
when a heading, code block, code span, link target, link definition, URL, HTML comment, number, checkbox step, table
shape or quote is gone, when under 60% of the prose words remain, or when the document changed meanwhile. Otherwise
it writes the edit over the document and shows the diff, the editor's list of what it removed, and any new shorthand.
Nothing is committed.

flow-rules runs it before a gate shows a `spec.md`, a `plan.md` or an audit report. A refused edit doesn't stop the
flow: the gate shows the original and says why.

Code can't see meaning: a dropped sentence without a number, or a flipped negation, passes. The skill says so, and
the user reads the diff at the gate.

## Evidence

- **Checkers** (2026-10-27, one flow spec of 2,467 words, 47 problems marked by a blind annotator). Harper, Vale,
  LanguageTool and proselint flagged 0–3% findings worth fixing; a spaCy prototype 47%; Haiku 86%, but 27 of its 31
  catches were shorthand, and as a hook it found 6 problems in 7,800 words. A pattern caught shorthand at 22 of 25.
- **Editors** (2026-10-27 and 28, two documents, blind rankings, 304 claims checked). Every Opus edit beat the
  original by a wide margin and lost no claim. The guide-driven editor with spaCy candidates first ranked best, but
  the shipped version only matched a plain prompt in two acceptance runs. No editor could repair shorthand.

So the write-time check stays code and covers shorthand only, and the editor stays a plain prompt with the skill as
its standard. The spaCy measures, their 1.7 GB environment and its installer step were removed.

## Success criteria

1. The hook's tests pass: shorthand flagged, quarters and defined labels not, code and quotes masked, CRLF positions,
   a rewrite that reports only added lines.
2. `compare.mjs`'s tests pass, including a dropped comment, link definition, autolink, bare URL and setext heading.
3. The skill states each lesson as the book does (checked against the book), copies no passage, and its test finds the
   rule in its first paragraph.
4. `npm test` passes on Linux and Windows.

## Decisions

The user decided:

- _Style_ is the standard, in our own words; no length limits and no banned words.
- The best result counts, not the easiest build.
- No model on every write ("Clearly haiku failed").
- The unified skill replaces pstack's `technical-writing` and `unslop`, retired against pstack `519d36a`.
- Everything ships inside flows; the check covers every Markdown file Claude writes.
- The copyedit shows a diff against a saved copy and commits nothing.
- 2026-10-30: verify the skill against the book, cut the rest, keep what is worth using, and make the skill more
  useful. Then one skill folder, not two ("I just dont enjoy having two writing skills in different folders"): the
  copyedit moved into `skills/writing/`. Then the whole book, not a summary ("im not sure if we really took the whole
  book and converted it"): one reference per lesson and appendix.

Claude decided, open to change:

- What was cut on 2026-10-30: the abbreviation rule (650 findings across 94 of the repo's 130 own docs, mostly
  false), spaCy and its installer step, the phrase list, the editing guide, and the 837 KB of test data. The
  measurements stay summarized under Evidence.
- The skill is organized as top-down revision passes rather than one section per lesson, because the book itself
  says to revise beginnings first and from the whole down.
- The copyedit prompt names the skill as its standard. The tested plain prompt didn't; the guide it replaces tested
  at parity with plain, so this is untested but not expected to be worse.
