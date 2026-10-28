# Writing style: spec

Status: approved 2026-10-27, after research, a measured comparison of checkers and three rounds of questions.
Revised and approved again 2026-10-28, after the Haiku hook failed its sample review and a second test measured an
editor that applies the book: the write-time check is code only, and an Opus editor, fed candidates that spaCy
measures, copyedits documents before the user reads them.

## Intent

AI agents write documents nobody wants to read. The specs, plans, flow.md files and audit reports the flows write run
to thousands of words, and their prose shows the habits of AI writing: nouns where verbs belong, hidden actors,
filler, and shorthand that only makes sense to the agent that was in the conversation (`grill Q11`, `round 2`,
`my call`). The user reads these documents at every gate, so their readability decides how much the flows cost the
user in attention.

The goal is to turn an established book on clear writing into a skill, and to enforce it, so that agents stop writing
10,000-word files of slop. The result is prose a person can read without effort. It is not shorter documents: each
document stays as long as its content needs. It is not a paper style either, and it does not ban words.

The standard is Joseph M. Williams and Joseph Bizup, _Style: Lessons in Clarity and Grace_ (12th ed., Pearson, 2016).
It covers in one established rulebook what the alternatives cover in pieces: Pinker's reader who wasn't there,
Strunk's "omit needless words" made concrete, and Gopen and Swan's old-before-new cohesion. One test from Michael
Welles' [technical-writing-density](https://github.com/mlwelles/technical-writing-density) (MIT) limits the cutting: a
word that carries a reason, a constraint or a disambiguation that matters to the topic stays.

## Goals

1. **One rule, stated first.** Every part of this feature serves one sentence: _write for a smart reader who wasn't
   there, and omit needless words._
2. **One writing skill.** It summarizes the lessons of _Style_ that matter for technical documents, in our own words,
   in about three pages. It replaces the two writing skills flows uses today, pstack's `technical-writing` and
   `unslop`, and keeps what they add that _Style_ lacks. Claude reads it whenever it writes prose a person will read.
3. **A check on every write.** When Claude writes or edits any Markdown file, a short script checks the new text for
   conversation shorthand and undefined abbreviations, and Claude revises. Only the writer can fix shorthand, because
   only the writer knows what the labels mean.
4. **An editor that applies the book.** `/copyedit` measures a document against the book's lessons in code, then a
   fresh Opus agent judges each candidate the code found, runs the book's diagnoses on the rest, and returns the edited
   document. The flows run it before a gate shows the user a spec, a plan or an audit report; the user can run it on
   any Markdown file.

## Non-goals

- No length limits on documents or sections.
- No banned-word lists. The checks say what to write instead; they don't list AI vocabulary.
- No grammar, spelling or usage checking (Williams' Lesson 2). Claude rarely breaks those rules, and the comparison
  below showed that tools which check them mostly flag product names and identifiers.
- No model call on every write. The measured model check found too little to be worth its wait and its context.
- No rewriting of existing documents. The rule applies to what Claude writes from now on.

## Anti-goals

The feature fails, even if it works, when:

- it turns documents into choppy, telegraphic prose that drops reasons and caveats;
- the check nags so often that Claude rewrites good sentences to silence it, or loops on its own fixes;
- the editor loses a fact, a condition or a decision while it rewrites;
- it changes the user's quoted words.

## Approaches

Six checkers ran on one real flow document, `docs/features/web-mcp-search/spec.md` (2,467 words). An expert annotator,
who saw no tool's output, marked the 47 places where a rewrite would help a reader; 31 of them were conversation
shorthand. Two judges, who didn't know which tool produced a finding, labelled a sample of 260 findings. The
evidence is in [flow.md](flow.md#options).

| Checker                                | Findings | Worth fixing | Real problems caught |
| -------------------------------------- | -------- | ------------ | -------------------- |
| Harper 3.0.0, every lint               | 176      | 2.5%         | 1 of 47              |
| Vale 3.25.1, five published styles     | 539      | 2.8%         | 9 of 47              |
| LanguageTool 6.6, picky                | 163      | 0%           | 4 of 47              |
| proselint 0.16.0, every check          | 1,231    | 0%           | 3 of 47              |
| A parser prototype (spaCy and WordNet) | 107      | 47%          | 28 of 47             |
| Claude Haiku with this spec's rules    | 42       | 86%          | 31 of 47             |

The published linters failed the second anti-goal: about 97% of what they flagged wasn't worth fixing. Rules that
match patterns for passive voice or negatives were mostly wrong in every tool. Shorthand, though, was caught reliably
by a pattern (22 of 25) and by Haiku (29 of 29), and only Haiku caught any problem that needs understanding the text.

The user first chose Haiku plus a small code check, and asked for the best result rather than the easiest build:
size and implementation language were not criteria. Built as a hook, the Haiku check failed its sample review. It
found 6 problems in about 7,800 words of real flow documents. A recount of the comparison showed why: 27 of Haiku's 31
catches were shorthand, and it caught only 4 of the 16 other problems.

A second test measured editors instead of checkers. Four editors rewrote the same spec and a findings report, and two
judges ranked the versions blind, section by section. The editors were Opus with a plain prompt, Opus with the book's
method, Opus with the book's method plus a list of candidates that code measured, and Sonnet with the book's method.
Opus with the book and the candidates ranked best in all four rankings. It fixed 12 of the 16 known problems that
aren't shorthand, against 6 for the plain prompt, and lost none of the 304 claims the two documents make. No editor
could repair shorthand, because none of them was there. The evidence is in [flow.md](flow.md#editor-test-2026-10-27-after-the-missed-sample-gate).

So code checks shorthand at write time, while the writer still knows what the labels mean, and the editor does the
rest on whole documents. The measures stay in Python with spaCy rather than a Rust port, at the user's choice, with the
large transformer model the test used.

## The skill

A skill named `writing` in the flows plugin, `plugins/flows/skills/writing/SKILL.md`. Unlike the conductors, Claude
may load it on its own: its description triggers on any prose a person will read, such as specs, plans, reports,
READMEs, PR descriptions, commit messages and chat answers.

It opens with the rule, then follows the order of _Style_. Each section is two or three lines of principle, plus a
before/after example where one helps. Examples come from this repo's own flow documents.

| Lesson                   | In the skill                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| 1 Understanding Style    | One line: readers judge prose by how it feels to read, so the writer's job is the reader's          |
| 2 Correctness            | Left out                                                                                            |
| 3 Actions                | Actions as verbs, not nouns: "decide", not "make a decision"                                        |
| 4 Characters             | Characters as subjects; passive only when the actor doesn't matter or the topic needs to come first |
| 5 Cohesion and Coherence | Old information first, new at the end; keep the same topic across a paragraph                       |
| 6 Emphasis               | The important words at the end of the sentence                                                      |
| 7 Motivation             | An introduction states the problem (a condition and its cost) before the solution                   |
| 8 Global Coherence       | State each document's and each section's point early, so the reader can skim                        |
| 9 Concision              | The cutting operations (below), limited by the density test                                         |
| 10 Shape                 | Reach the subject and verb quickly; break up sentences that sprawl                                  |
| 11 Elegance              | Left out                                                                                            |
| 12 The Ethics of Style   | One line: don't hide uncertainty or who is responsible                                              |

The lesson numbers and titles match the contents Pearson publishes for the 12th edition.

Lesson 9's operations, as the skill states them:

- delete words that mean little or nothing ("basically", "actually", "kind of");
- delete redundant pairs ("each and every", "full and complete");
- delete words implied by others ("final outcome", "future plans");
- replace a phrase with a word ("in the event that" → "if", "due to the fact that" → "because");
- turn negatives into affirmatives ("not many" → "few", "not the same" → "different");
- cut comments about the writing itself ("in this section we will…"), but keep a hedge where a claim isn't always
  true.

Two additions that _Style_ doesn't state:

- **The density test.** Before cutting, ask: does removing this lose a reason, a constraint or a disambiguation that
  matters to the topic and prevents a likely misreading? If so, keep it, even if the sentence gets longer. The skill
  credits technical-writing-density and links to it.
- **Lists for lists.** Four or more parallel items go into a list, or a table when they share attributes.

One aimed at the flows' worst habit:

- **No conversation shorthand.** A reader who wasn't there doesn't know what `Q11`, `round 2` or `D4` means. Record
  who decided what in one place (a **Decisions** section), not as a tag on every line. Quote the user only where the
  exact words matter.

And the rules of the two skills it replaces that _Style_ doesn't cover, restated in our own words:

- From `technical-writing`:
  - the codebase is the word list: real file, flag and command names, not synonyms;
  - a README or guide picks one mode (tutorial, how-to, reference, explanation);
  - "only" and "not" sit next to the word they change;
  - one name per thing;
  - "this" and "it" point at one obvious thing;
  - headings state the point;
  - code goes in code font.
- From `unslop`:
  - no over-compression: dropped articles, arrows and symbol-speak;
  - say what a thing does, not how it feels;
  - no chatbot phrases or flattery;
  - the plain word instead of a metaphor noun.

Left out on purpose: their bans on em dashes, semicolons and colons, which Williams allows; the 25-word sentence limit;
the AI-vocabulary word list, which the non-goals rule out; and formatting tells (curly quotes, title-case headings,
emoji), which the comparison's judges rated not worth fixing.

The skill is written in our own words. It cites the book and copies no passages. It also credits the free sources it
was checked against: Gopen and Swan's "The Science of Scientific Writing" (1990), Strunk's _The Elements of Style_
(1920, public domain) and Pinker's "The Source of Bad Writing" (2014).

### Replacing the old skills

- `/doc-audit` and `/integrate` name `writing` where they named `technical-writing` and `unslop`, in their `SKILL.md`
  and `uses.json`.
- `scripts/sync-pstack.mjs` stops vendoring `technical-writing` and `unslop`. Three vendored pstack skills tell Claude
  to write "through unslop" (`blast-radius`, `recall`, `show-me-your-work`); the sync's transform points those lines at
  flows' `writing` skill, so no vendored text names a skill that is gone.

## The check

The check runs as a `PostToolUse` hook of the flows plugin, on `Write` and `Edit` of any Markdown file (`*.md`).

- It sees only the new text: a `Write`'s content, an `Edit`'s `new_string`. Old prose doesn't trigger findings on
  every edit.
- In `flow.md` files the shorthand rule is off. The flow templates structure flow.md by `Round N` and the grilling
  pack numbers its questions, and flow.md is the log where those numbers belong. The templates and the pack stay as
  they are; the skill tells Claude not to carry the numbers into specs and reports.
- It doesn't look inside code (fenced or inline), front matter, link targets or block quotes, so the user's quoted
  words stay as they are.
- Each finding names the place, the problem and a replacement, because feedback with a concrete alternative is what
  helps a model revise.
- Each report ends with: _"Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is
  wrong."_ Claude doesn't need to silence every finding.
- The write has already happened when the check runs, so nothing is blocked.
- There is no counter against loops. Checking only new text and the closing line are the guard; success criterion 5
  tests it in a real session, and a counter is added only if that test shows looping.

The script is `plugins/flows/hooks/prose-check.mjs`, with its logic in `prose.mjs`: Node, no dependencies, run as a
command hook. It reads the hook's JSON on stdin and the whole file from disk. With findings, it prints at most 10 to
stderr and exits 2, which Claude Code shows to Claude. Without findings, or on any error, it exits 0 and prints
nothing.

| Rule        | Flags                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shorthand` | Conversation references in the new text: `Q` or `D` followed by a number (not a quarter followed by a year, as in "Q1 2027"), `round` followed by a number, "my call", unless the file defines the label |
| `undefined` | An abbreviation of two to six capitals in the new text that the file doesn't define before it, and that isn't on the common-terms list                                                                   |

The common-terms list (API, URL, JSON, CLI, MCP, PR, CI and the like) is a data file next to the script, so it grows
without code changes. It also holds the capitals that aren't abbreviations in this repo's prose: PASS and FAIL, HEAD,
emphasis words such as NOT and ONLY, units and file types. A capital word followed by a file extension (`SKILL.md`) is a
file name, not an abbreviation. A definition counts in either form, `ABBR (words)` or `words (ABBR)`, in a table row
(`| ABBR | words |`), or in code font. The check reads the whole file, so it sees definitions made anywhere earlier in
the document.

The sample review found two defects to fix: an abbreviation inside code font was flagged, and a label defined in the
middle of a line ("everything marked _(my call)_ was decided by Claude") wasn't recognized as defined.

## The editor

A skill named `copyedit` in flows, `plugins/flows/skills/copyedit/SKILL.md`, run as `/copyedit <file>`. Like the
conductors, it runs only when called. It runs three steps.

1. **Measure.** Node masks the document as the check does (one masking rule, shared with `prose.mjs`), with inline
   code read as a placeholder word so sentences still parse, and finds the phrase candidates. A Python script,
   `skills/copyedit/scripts/measure.py`, parses the masked text with spaCy and `en_core_web_trf` for the rest. The
   candidates are the kinds the test used, minus shorthand and abbreviations, which the check owns:

   | Lesson       | Candidates                                                                                                   |
   | ------------ | ------------------------------------------------------------------------------------------------------------ |
   | 3 Actions    | Nouns made from verbs after a weak verb ("make", "perform", "provide"), or as a sentence's subject           |
   | 4 Characters | Passive sentences; subjects that are abstractions or "there is" / "it is"                                    |
   | 5 Cohesion   | A sentence that opens with nothing from the sentence before it, in the same paragraph                        |
   | 9 Concision  | Wordy phrases, redundant pairs and modifiers, negatives with a positive form                                 |
   | 10 Shape     | A long opening before the subject, a long subject, words between subject and verb, a long list in a sentence |

   The phrase lists come from plainlanguage.gov (CC0) and Strunk (public domain). A noun counts as made from a verb by
   its part of speech and its suffix; no word table ships. The script also prints the document's totals for these kinds, so the effect of an edit can be compared.

2. **Edit.** The skill first saves the document's current version to the scratchpad. A fresh `general-purpose` agent
   on Opus then gets the document, the candidate list and the editing guide, `skills/copyedit/references/edit.md`.
   The guide is the book's method as diagnoses: for each lesson, what to look for and how to revise. The agent judges
   each candidate (many passives and long openers are fine), runs the diagnoses on the sentences the list doesn't
   name, and writes the whole edited document to a scratchpad file (`.txt`, since subagents may not write Markdown
   files), plus a list of anything it removed rather than reworded. It keeps every fact, number, quote, code span,
   link and heading, every checkbox step and numbered item, and every table. It leaves conversation labels alone: it
   can't know what they meant.
3. **Check and show.** Code compares the edited file with the saved copy: every heading in order, every code block and
   code span, every link target, number, checkbox step and table row must still be there. If anything is missing,
   nothing is written and the skill names what was lost. Otherwise it copies the edited file over the document (a
   copy, so the write-time check doesn't report the whole document as new), runs the check on both versions and
   reports only findings the saved copy didn't have, and shows `git diff --no-index <saved copy> <document>`, the
   removed-text list, and the measures before and after. Nothing is committed, so it works the same on any branch and
   inside audits.

Without the Python environment, step 1 runs only its Node part and says that spaCy's measures were skipped; the editor
still applies the book. The test ranked the editor without any list second, ahead of the plain prompt.

`plugins/flows/references/flow-rules.md` gets one rule: before a gate shows the user a `spec.md`, a `plan.md` or an
audit report, the conductor runs `/copyedit` on it, each time the document goes to a gate. The gate message says the
document was copyedited. flow.md files get only the check; they change after every phase.

## Installing the measures

The installer sets up the Python environment for `measure.py` on Linux x64 and Windows x64, the platforms the other
binaries ship for. It's a toggle on the tools page, on by default when flows is selected, because the environment is
about 1.5 GB. Ticking it is the consent; there is no second question. Once the user unticks it, it stays off on later
runs.

- **uv** comes from PATH. When it's missing, the installer's "Missing on PATH" note prints the command that installs
  it, as it does for graphify's uv.
- **The environment.** A small Python project in `installer/assets/prose/`, a `pyproject.toml` and a `uv.lock`, pins
  CPython 3.13 (uv-managed, not the system one), spaCy 3.8, CPU-only PyTorch from PyTorch's own index, and
  `en_core_web_trf` 3.8.0 from its GitHub release wheel with its hash. On Linux, PyPI's default PyTorch wheel pulls in
  about 1.8 GB of CUDA libraries, so the CPU index is required. The installer runs `uv sync --frozen` into
  `~/.claude/flows-prose/`, with uv's cache and its Python inside that folder too, so unticking the toggle frees the
  whole 1.5 GB and never touches graphify's uv files.
- **NixOS isn't supported yet.** uv's Python and PyTorch's Linux wheels expect the system library layout other Linux
  distributions have, and nixpkgs' `en_core_web_trf` doesn't load (tested 2026-10-28: nixpkgs pairs it with a newer
  spacy-curated-transformers, whose weight layout doesn't match). The installer hides the toggle on NixOS, so
  `/copyedit` edits there without spaCy's measures. A later change adds NixOS; in a test, the same uv environment ran
  inside an FHS environment (`buildFHSEnv`) and loaded the model.
- **Installed** means the model loads: the installer's last check, and the summary line, run spaCy, not just look for
  the folder. The step runs last, after the settings, so cancelling the download leaves everything else applied.
- **Finding it.** `/copyedit` runs the Python in `~/.claude/flows-prose/`. Without it, spaCy's measures are skipped.

The installer managing a Python toolchain is recorded in [ADR 0005](../../adr/0005-prose-python-environment.md).

## Where each concern is resolved

- Which files are checked: resolved in flows' `hooks/hooks.json` (matchers and `if` filters) and in `prose.mjs` (the
  flow.md exception); never seen by the skill, the editor or the conductors.
- When a document is copyedited: resolved in `flow-rules.md`; never seen by the hook or by each conductor's own gate
  text.
- How a document is edited: resolved in `/copyedit` and its guide; the conductors run it and never restate its steps.
- Where the Python environment is: resolved in the installer's prose step and `/copyedit`'s measure step; never seen by `measure.py`, the editor agent or the conductors.
- What the writing standard says: resolved in the `writing` skill and the editing guide; the conductors name them and
  never restate their rules.

## Where it lives

- The plugin parts ship in flows, because they improve every flow: `skills/writing/`, `skills/copyedit/` with its
  scripts, phrase data and guide, `hooks/hooks.json`, `hooks/prose.mjs` and `prose-check.mjs` with their test, and the
  common-terms list. There is no separate plugin.
- Every flows user gets the check in every project. It costs no model call. Setting `FLOWS_PROSE_CHECK=off` in the
  environment turns it off without turning off flows or other hooks; flows' README says so.
- `scripts/flows-uses.mjs` learns that a skill Claude may load on its own (no `disable-model-invocation`) is not a
  conductor, so the writing skill needs no `uses.json`, and conductors may list it under `flows`.
- The installer gets one step, one toggle and the prose environment's project files. No crate and no release change.
- `npm test` runs the check's and `/copyedit`'s Node tests. The spaCy measures are tested against a fixture when the
  environment exists, and skip otherwise.
- flows' version already follows the one-version scheme.
- flows' README describes the skill, the check and `/copyedit`. README.md, CLAUDE.md and THIRD_PARTY.md describe the
  change, the credit to technical-writing-density, the phrase data, the downloaded Python packages, and the two pstack skills
  no longer vendored.

## Success criteria

1. The check's tests pass, with one fixture per rule: text it must flag and text it must not, including the two
   defects the sample review found.
2. The skill and the editing guide pass a source check before they ship. A fresh agent compares them with the free
   sources (each lesson of _Style_ stated faithfully, no copied passages) and the skill with `technical-writing` and
   `unslop` (nothing worth keeping lost). Its findings are fixed or answered.
3. The installer sets up the environment on Linux, and `measure.py` runs from it on a fixture. On Windows the user
   runs the installer once; until then, Windows is marked untested. On NixOS the toggle is hidden.
4. The editor test, re-run with the shipped pieces (the shipped `measure.py`, guide and `/copyedit` prompt) on the
   same two documents: `/copyedit`'s version has a better mean rank than the plain prompt's over the four blind
   rankings (two judges, two documents) and a worse one in none, and loses or changes no more than 1 of the 304
   claims. In the test, the book with candidates averaged 1.94 against 2.64, and tied once.
5. In a session that writes a spec, the check's findings reach Claude and it revises without looping.

## Decisions

The user decided:

- The goal: turn the book into a skill, and enforce it, so agents stop writing slop. Readable prose, not shorter
  documents or a paper style.
- No length limits and no banned words.
- Use established sources, combined with checks.
- _Style_ (Williams and Bizup) is the standard, summarized in our own words rather than copied.
- The density test is part of it.
- The skill follows the book's lessons.
- Free public sources are read before anything is built (done; see [flow.md](flow.md#prior-art)).
- The best result counts, not the easiest build. This replaced the earlier "checker in Rust, not npm".
- Haiku plus a code check, chosen after the comparison above; then, after the sample review, no model on every write
  (2026-10-27, "Clearly haiku failed").
- No hard limits on length either: "I dont mind a long text for a long feautre. I just dont want slop text".
- The book's method inside the agents, tested before it was chosen; the editor with code candidates, as tested.
- The measures in Python with spaCy, not Rust ("Let's just stay on python"), with the large model ("Large pls").
- After the second plan review (2026-10-28, "a, all as recommended"): uv comes from PATH, with an install hint, not a
  pinned download; the core is built before the Python half; the editor writes its version to a scratchpad file and
  code checks it before it replaces the document; masking and phrase matching run in Node, shared with the check, and
  only the tested candidate kinds ship, without a WordNet table; `FLOWS_PROSE_CHECK=off` turns the check off; the
  toggle's behaviour above; an ADR for the Python toolchain.
- After the third plan review (2026-10-28): NixOS waits for a later change ("lets ignore nixos for now will come to
  fix that later"); the two pstack writing skills are retired against the vendored commit, `519d36a`, and pstack's
  upstream update gets its own PR ("yes retire the two writing skills pls").
- A check on every write plus an editor before the gates, rather than an agent that writes every document.
- The unified skill replaces pstack's `technical-writing` and `unslop`, keeping and dropping their rules as listed
  above; the pack stops vendoring them.
- The hooks cover every Markdown file Claude writes.
- Everything ships inside flows.
- The skill is verified against the sources before it ships.
- Accepted as recommended: the check runs on plans and flow.md; no loop counter unless criterion 5 shows looping; the
  concern lines above.
- After the first plan review: the copyedit pass shows a diff against a saved copy instead of committing (this
  replaced the earlier "commit before and after"); `flows-uses.mjs` learns non-conductor skills; the `undefined` rule
  stays, with the common-terms and file-name fixes.

Claude decided, open to change:

- The rule's wording, and the three additions to the lessons (density test, lists, no conversation shorthand).
- Which lessons are in or out, and the split of rules between the two checks.
- No fixed sentence-length limit: the model judges sprawl, because no sentence in the sample passed 40 words and the
  published 25- and 30-word limits flagged sentences that read well.
- Shorthand stays allowed in flow.md, and the flow templates and grilling pack stay unchanged.
- The copyedit pass covers specs, plans and audit reports, not flow.md, and lists what it removed. Plans were left
  out before; the user reads them at Gate 2 too.
- The editor runs on Opus: Sonnet's edit was the weakest in the test.
- The editor leaves conversation labels alone instead of guessing what they meant.
- Python setup: a toggle on by default with flows; a uv project with a lock in `installer/assets/prose/`; CPython
  3.13 managed by uv; the environment in `~/.claude/flows-prose/`.
- Density's test is paraphrased with credit, not vendored, because it is one paragraph and needs no sync.

## Left to the builder

- The common-terms list, and what counts as "the file defines the label".
- The measures' thresholds, within the table above, and the candidate list's format.
- How `/copyedit` finds the Claude config folder when `CLAUDE_CONFIG_DIR` is set, and the Python path inside the
  environment on Windows (`Scripts\python.exe`).

- How the sync transform rewrites the three "through unslop" lines, and the pstack-picks plugin description that names
  `unslop`.
- The before/after examples in the skill, picked from existing flow documents.
