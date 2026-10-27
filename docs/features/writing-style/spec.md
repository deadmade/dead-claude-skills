# Writing style: spec

Status: draft, revised 2026-10-27 after research, a measured comparison of checkers and two rounds of questions. Not
yet approved.

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
3. **Checks on every write.** When Claude writes or edits any Markdown file, two hooks check the new text and return
   their findings to Claude, which revises. A short script checks what code can decide reliably; Claude Haiku checks
   what needs judgment.
4. **A copyedit pass at the gates.** Before a flow shows the user a spec or an audit report, a fresh agent copyedits it
   against the skill. It catches what a check of one edit can't see: a whole document read as a reader would.

## Non-goals

- No length limits on documents or sections.
- No banned-word lists. The checks say what to write instead; they don't list AI vocabulary.
- No grammar, spelling or usage checking (Williams' Lesson 2). Claude rarely breaks those rules, and the comparison
  below showed that tools which check them mostly flag product names and identifiers.
- No rewriting of existing documents. The rule applies to what Claude writes from now on.

## Anti-goals

The feature fails, even if it works, when:

- it turns documents into choppy, telegraphic prose that drops reasons and caveats;
- the checks nag so often that Claude rewrites good sentences to silence them, or loops on its own fixes;
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

The user chose Haiku plus a small code check, and asked for the best result rather than the easiest build: size and
implementation language were not criteria. A local model was considered and left out; prompt hooks call only Claude
models, and a small local model's precision is unmeasured.

For how a document reaches the rules, three paths were weighed: hooks on every write plus a fresh agent at the gates;
a fresh agent writing every flow document; hooks only. The user chose the first. A writer agent for every flow.md
update would be slow, and the main session would have to pass every decision across.

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

## The checks

Both checks run as `PostToolUse` hooks of the flows plugin, on `Write` and `Edit` of any Markdown file (`*.md`).
Claude Code runs matching hooks in parallel, so a write waits only for the slower one.

- Each check sees only the new text: a `Write`'s content, an `Edit`'s `new_string`. Old prose doesn't trigger findings
  on every edit.
- In `flow.md` files the shorthand rule is off. The flow templates structure flow.md by `Round N` and the grilling
  pack numbers its questions, and flow.md is the log where those numbers belong. The templates and the pack stay as
  they are; the skill tells Claude not to carry the numbers into specs and reports.
- Neither check looks inside code (fenced or inline), front matter, link targets or block quotes, so the user's quoted
  words stay as they are.
- Each finding names the place, the problem and a replacement, because feedback with a concrete alternative is what
  helps a model revise.
- Each report ends with: _"Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is
  wrong."_ Claude doesn't need to silence every finding.
- The write has already happened when the checks run, so nothing is blocked.
- There is no counter against loops. Checking only new text and the closing line are the guard; success criterion 4
  tests it in a real session, and a counter is added only if that test shows looping.

### The code check

A Node script with no dependencies, `plugins/flows/hooks/check.mjs`, run as a command hook. It reads the hook's JSON
on stdin and the whole file from disk. With findings, it prints at most 10 to stderr and exits 2, which Claude Code
shows to Claude. Without findings, or on any error, it exits 0 and prints nothing.

| Rule        | Flags                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shorthand` | Conversation references in the new text: `Q` or `D` followed by a number, `round` followed by a number, "my call", unless the file defines the label |
| `undefined` | An abbreviation of two to six capitals in the new text that the file doesn't define before it, and that isn't on the common-terms list |

The common-terms list (API, URL, JSON, CLI, MCP, PR, CI and the like) is a data file next to the script, so it grows
without code changes. Reading the whole file is what this check adds over the model check: it sees definitions made
anywhere earlier in the document.

### The model check

A prompt hook (`type: "prompt"`) with `model` set to Haiku and `continueOnBlock: true`, so its reason goes back to
Claude and the turn continues. Its prompt carries the rules below and the hook's input. It answers `ok: true` when it
finds nothing worth fixing, and otherwise `ok: false` with at most 10 findings as its reason.

| Rule             | Flags                                                                                                  | Lesson |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| `nominalization` | An action buried in a noun: "make a decision", "The removal doesn't depend on…"                        | 3      |
| `hidden actor`   | A passive that hides an actor the reader needs                                                         | 4      |
| `wordy`          | A phrase with a shorter equivalent, a redundant pair or modifier, a negative with an affirmative form | 9      |
| `list`           | Four or more parallel items in running prose that would read better as a list                         | —      |
| `sprawl`         | A sentence the reader has to reread to parse                                                           | 10     |
| `unclear`        | A pronoun without a clear antecedent, or a term used before it is explained                            | 5, 8   |

It leaves shorthand and abbreviations to the code check. It doesn't flag a passive that keeps the paragraph's topic,
or a long sentence that reads easily.

## The copyedit pass

`plugins/flows/references/flow-rules.md` gets one rule: before a gate shows the user a `spec.md` or an audit report, a
fresh `general-purpose` agent copyedits it. Its prompt is the skill's text plus: _"Copyedit this document for a reader
who wasn't in the conversation. Don't change its decisions, requirements, quotes or code. Return the edited
document."_

- The conductor commits the document, writes the copyedited version over it, and commits again, so `git diff HEAD~1`
  shows every change the pass made. These two commits are an explicit exception to flow-rules' "commit only when the
  user asks". The gate message says the document was copyedited and gives that command.
- The copyedit agent also returns a list of anything it removed rather than reworded. The conductor shows that list
  at the gate, so a lost requirement is visible before approval.
- The pass runs each time the document goes to a gate, including after a revision round.

Plans and flow.md files get only the hooks. Plans are written for the implementing agents, and flow.md changes after
every phase, so a copyedit each time would cost more than it gives.

## Where each concern is resolved

- Which files are checked: resolved in flows' `hooks/hooks.json` (matchers and `if` filters) and in `check.mjs` (the
  flow.md exception); never seen by the skill, the copyedit pass or the conductors.
- The model and its settings: resolved in `hooks/hooks.json`; never seen by `check.mjs` or the skill.
- When a document is copyedited: resolved in `flow-rules.md`; never seen by the hooks or by each conductor's own gate
  text.
- What the writing standard says: resolved in the `writing` skill; the conductors and the copyedit pass name the
  skill and never restate its rules.

## Where it lives

- All of it ships in the flows plugin, because it improves every flow: `skills/writing/SKILL.md`, `hooks/hooks.json`,
  `hooks/check.mjs` with its test, and the common-terms list. There is no separate plugin.
- No crate, binary, installer step or release workflow. `npm test` runs the script's test with the other hook tests.
- flows' version already follows the one-version scheme.
- flows' README describes the skill and the hooks. README.md, CLAUDE.md and THIRD_PARTY.md describe the change, the
  credit to technical-writing-density, and the two pstack skills no longer vendored.

## Success criteria

1. The code check's tests pass, with one fixture per rule: text it must flag and text it must not.
2. The skill passes a source check before it ships. A fresh agent compares it with the free sources (each lesson of
   _Style_ stated faithfully, no copied passages) and with `technical-writing` and `unslop` (nothing worth keeping
   lost). Its findings are fixed or answered.
3. The checks, run in the exact shape the hooks use over `docs/features/web-mcp-search/plan.md` (which the comparison
   didn't see) and its spec, produce findings that are mostly real: of 20 sampled findings, the user judges at least
   15 worth fixing.
4. In a session that writes a spec, the hooks' findings reach Claude and it revises without looping.
5. The copyedit pass, run on one existing spec, produces a version the user finds easier to read, with no decision,
   requirement or quote lost.

Criterion 3 is a gate. The checks are built and run from the command line first; the hooks are switched on only after
the user has reviewed the sample. On a miss, the rules with the most wrong findings are tuned or dropped and the sample
is run again. The same run shows whether the code check catches anything the model check misses; if it catches
nothing, the code check is dropped.

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
- Haiku plus a code check, chosen after the comparison above.
- Hooks on every write plus a copyedit agent at the gates, rather than an agent that writes every document.
- The unified skill replaces pstack's `technical-writing` and `unslop`, keeping and dropping their rules as listed
  above; the pack stops vendoring them.
- The hooks cover every Markdown file Claude writes.
- Everything ships inside flows.
- The skill is verified against the sources before it ships, and the hooks are gated by the sample review.
- Accepted as recommended: the copyedit pass commits before and after; both checks run on plans and flow.md; no loop
  counter unless criterion 4 shows looping; the sample review runs on `web-mcp-search/plan.md` and its spec; the
  concern lines above.

Claude decided, open to change:

- The rule's wording, and the three additions to the lessons (density test, lists, no conversation shorthand).
- Which lessons are in or out, and the split of rules between the two checks.
- No fixed sentence-length limit: the model judges sprawl, because no sentence in the sample passed 40 words and the
  published 25- and 30-word limits flagged sentences that read well.
- Shorthand stays allowed in flow.md, and the flow templates and grilling pack stay unchanged.
- The copyedit pass covers specs and audit reports, not plans or flow.md, and lists what it removed.
- Density's test is paraphrased with credit, not vendored, because it is one paragraph and needs no sync.

## Left to the builder

- The common-terms list, and what counts as "the file defines the label".
- How the code check finds the new text of an `Edit` in the file, for line numbers.
- The model check's prompt, within the rules above.
- Whether a plugin's `hooks.json` accepts `type: "prompt"`, and which `if` pattern matches Markdown files at any
  depth: the hooks docs don't say. Check both before relying on them.
- How the sync transform rewrites the three "through unslop" lines, and the pstack-picks plugin description that names
  `unslop`.
- The before/after examples in the skill, picked from existing flow documents.
