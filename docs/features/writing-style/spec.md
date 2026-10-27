# Writing style: spec

Status: draft, revised 2026-10-27 after research and a measured comparison of checkers. Not yet approved.

## Intent

The documents the flows write are hard to read. Specs, plans, flow.md files and audit reports run to thousands of
words, and their prose shows the habits of AI writing: nouns where verbs belong, hidden actors, filler, and shorthand
that only makes sense to the agent that was in the conversation (`grill Q11`, `round 2`, `my call`). The user reads
these documents at every gate, so their readability decides how much the flows cost the user in attention.

The goal is prose a person can read without effort. It is not shorter documents: each document stays as long as its
content needs. It is not a paper style either, and it does not ban words.

The standard is Joseph M. Williams and Joseph Bizup, _Style: Lessons in Clarity and Grace_ (12th ed., Pearson, 2016).
It covers in one established rulebook what the alternatives cover in pieces: Pinker's reader who wasn't there,
Strunk's "omit needless words" made concrete, and Gopen and Swan's old-before-new cohesion. One test from Michael
Welles' [technical-writing-density](https://github.com/mlwelles/technical-writing-density) (MIT) limits the cutting: a
word that carries a reason, a constraint or a disambiguation that matters to the topic stays.

## Goals

1. **One rule, stated first.** Every part of this feature serves one sentence: _write for a smart reader who wasn't
   there, and omit needless words._
2. **A skill that teaches the rule.** It summarizes the lessons of _Style_ that matter for technical documents, in our
   own words, in about two pages. Claude reads it whenever it writes prose a person will read.
3. **Checks on every write.** When Claude writes or edits a Markdown file under `docs/`, two hooks check the new text
   and return their findings to Claude, which revises. A short script checks what code can decide reliably; Claude
   Haiku checks what needs judgment.
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

| Checker                                    | Findings | Worth fixing | Real problems caught |
| ------------------------------------------ | -------- | ------------ | -------------------- |
| Harper 3.0.0, every lint                   | 176      | 2.5%         | 1 of 47              |
| Vale 3.25.1, five published styles         | 539      | 2.8%         | 9 of 47              |
| LanguageTool 6.6, picky                    | 163      | 0%           | 4 of 47              |
| proselint 0.16.0, every check              | 1,231    | 0%           | 3 of 47              |
| A parser prototype (spaCy and WordNet)     | 107      | 47%          | 28 of 47             |
| Claude Haiku with this spec's rules        | 42       | 86%          | 31 of 47             |

The published linters failed the second anti-goal: about 97% of what they flagged wasn't worth fixing. Rules that
match patterns for passive voice or negatives were mostly wrong in every tool. Shorthand, though, was caught reliably
by a pattern (22 of 25) and by Haiku (29 of 29), and only Haiku caught any problem that needs understanding the text.

The user chose Haiku plus a small code check, and asked for the best result rather than the easiest build: size and
implementation language were not criteria. A local model was considered and left out; prompt hooks call only Claude
models, and a small local model's precision is unmeasured.

## The skill

A skill named `writing` in a new plugin, `prose` (see [Where it lives](#where-it-lives)). Its description triggers on
any prose a person will read: specs, plans, reports, READMEs, PR descriptions, commit messages and chat answers.

It opens with the rule, then follows the order of _Style_. Each section is two or three lines of principle, plus a
before/after example where one helps. Examples come from this repo's own flow documents.

| Lesson                   | In the skill                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 1 Understanding Style    | One line: readers judge prose by how it feels to read, so the writer's job is the reader's         |
| 2 Correctness            | Left out                                                                                           |
| 3 Actions                | Actions as verbs, not nouns: "decide", not "make a decision"                                       |
| 4 Characters             | Characters as subjects; passive only when the actor doesn't matter or the topic needs to come first |
| 5 Cohesion and Coherence | Old information first, new at the end; keep the same topic across a paragraph                      |
| 6 Emphasis               | The important words at the end of the sentence                                                     |
| 7 Motivation             | An introduction states the problem (a condition and its cost) before the solution                  |
| 8 Global Coherence       | State each document's and each section's point early, so the reader can skim                       |
| 9 Concision              | The cutting operations (below), limited by the density test                                        |
| 10 Shape                 | Reach the subject and verb quickly; break up sentences that sprawl                                 |
| 11 Elegance              | Left out                                                                                           |
| 12 The Ethics of Style   | One line: don't hide uncertainty or who is responsible                                             |

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

And one aimed at the flows' worst habit:

- **No conversation shorthand.** A reader who wasn't there doesn't know what `Q11`, `round 2` or `D4` means. Record
  who decided what in one place (a **Decisions** section), not as a tag on every line. Quote the user only where the
  exact words matter.

The skill is written in our own words. It cites the book and copies no passages. It also credits the free sources
it was checked against: Gopen and Swan's "The Science of Scientific Writing" (1990), Strunk's _The Elements of Style_
(1920, public domain) and Pinker's "The Source of Bad Writing" (2014).

## The checks

Both checks run as `PostToolUse` hooks of the `prose` plugin, on `Write` and `Edit` of Markdown files under the
project's `docs/` folder. Claude Code runs matching hooks in parallel, so a write waits only for the slower one.

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

### The code check

A Node script with no dependencies, `hooks/check.mjs`, run as a command hook. It reads the hook's JSON on stdin and
the whole file from disk. With findings, it prints at most 10 to stderr and exits 2, which Claude Code shows to Claude.
Without findings, or on any error, it exits 0 and prints nothing.

| Rule        | Flags                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `shorthand` | Conversation references in the new text: `Q` or `D` followed by a number, `round` followed by a number, "my call", unless the file defines the label |
| `undefined` | An abbreviation of two to six capitals in the new text that the file doesn't define before it, and that isn't on the common-terms list |

The common-terms list (API, URL, JSON, CLI, MCP, PR, CI and the like) is a data file next to the script, so it grows
without code changes. Reading the whole file is what this check adds over the model check: it sees definitions made
anywhere earlier in the document.

### The model check

A prompt hook (`type: "prompt"`) with `model` set to Haiku and `continueOnBlock: true`, so its reason goes back to
Claude and the turn continues. Its prompt carries the rules below and the hook's input. It answers `ok: true` when it
finds nothing worth fixing, and otherwise `ok: false` with at most 10 findings as its reason.

| Rule             | Flags                                                                                      | Lesson |
| ---------------- | ------------------------------------------------------------------------------------------ | ------ |
| `nominalization` | An action buried in a noun: "make a decision", "The removal doesn't depend on…"            | 3      |
| `hidden actor`   | A passive that hides an actor the reader needs                                              | 4      |
| `wordy`          | A phrase with a shorter equivalent, a redundant pair or modifier, a negative with an affirmative form | 9 |
| `list`           | Four or more parallel items in running prose that would read better as a list             | —      |
| `sprawl`         | A sentence the reader has to reread to parse                                               | 10     |
| `unclear`        | A pronoun without a clear antecedent, or a term used before it is explained                 | 5, 8   |

It leaves shorthand and abbreviations to the code check. It doesn't flag a passive that keeps the paragraph's topic,
or a long sentence that reads easily.

## The copyedit pass

`plugins/flows/references/flow-rules.md` gets one rule: before a gate shows the user a `spec.md` or an audit report, a
fresh `general-purpose` agent copyedits it. Its prompt is the skill's text plus: _"Copyedit this document for a reader
who wasn't in the conversation. Don't change its decisions, requirements, quotes or code. Return the edited
document."_

- The conductor commits the document, writes the copyedited version over it, and commits again, so `git diff HEAD~1`
  shows every change the pass made. The gate message says the document was copyedited and gives that command.
- The copyedit agent also returns a list of anything it removed rather than reworded. The conductor shows that list
  at the gate, so a lost requirement is visible before approval.
- The pass runs each time the document goes to a gate, including after a revision round.

Plans and flow.md files get only the hooks. Plans are written for the implementing agents, and flow.md changes after
every phase, so a copyedit each time would cost more than it gives.

## Where it lives

- `plugins/shared/prose/`: the plugin, with `skills/writing/SKILL.md`, `hooks/hooks.json`, `hooks/check.mjs` and its
  test, and the common-terms list. It sits in `shared/` because flows pulls it in, and it is also offered on its own,
  like tui-review.
- flows lists `prose` in its conductors' `uses.json`, so `scripts/flows-uses.mjs` adds it to flows' `dependencies`.
- No crate, binary, installer step or release workflow. `npm test` runs the script's tests with the other hook tests.
- The plugin's version joins the one-version scheme, so `check-repo.mjs` covers it.
- README.md, CLAUDE.md and THIRD_PARTY.md describe the plugin and the credit to technical-writing-density.

## Success criteria

1. The code check's tests pass, with one fixture per rule: text it must flag and text it must not.
2. The checks, run in the exact shape the hooks use over `docs/features/web-mcp-search/spec.md`, produce findings
   that are mostly real: of 20 sampled findings, the user judges at least 15 worth fixing.
3. The copyedit pass, run on one existing spec, produces a version the user finds easier to read, with no decision,
   requirement or quote lost.
4. In a session that writes a spec, the hooks' findings reach Claude and it revises without looping.

Criterion 2 is a gate. The checks are built and run from the command line first; the hooks are switched on only after
the user has reviewed the sample. On a miss, the rules with the most wrong findings are tuned or dropped and the sample
is run again. The same run shows whether the code check catches anything the model check misses; if it catches
nothing, the code check is dropped.

## Decisions

The user decided:

- Readable prose for the flow documents is the goal, not shorter documents or a paper style.
- No length limits and no banned words.
- Use established sources, combined with checks.
- _Style_ (Williams and Bizup) is the standard, summarized in our own words rather than copied.
- The density test is part of it.
- The skill follows the book's lessons.
- Free public sources are read before anything is built (done; see [flow.md](flow.md#prior-art)).
- The best result counts, not the easiest build. This replaced the earlier "checker in Rust, not npm".
- Haiku plus a code check, chosen after the comparison above.

Claude decided, open to change:

- The rule's wording, and the three additions to the lessons (density test, lists, no conversation shorthand).
- Which lessons are in or out, and the split of rules between the two checks.
- No fixed sentence-length limit: the model judges sprawl, because no sentence in the sample passed 40 words and the
  published 25- and 30-word limits flagged sentences that read well.
- A new plugin `prose` in `shared/` rather than adding to the dead-skills bundle.
- The hooks check only `docs/**/*.md` and report without blocking; shorthand is off in flow.md, and the flow templates
  and grilling pack stay unchanged.
- The copyedit pass covers specs and audit reports, not plans or flow.md. It commits before and after, and lists what
  it removed.
- The sample review (success criterion 2) gates the hooks.
- Density's test is paraphrased with credit, not vendored, because it is one paragraph and needs no sync.

## Left to the builder

- The common-terms list, and what counts as "the file defines the label".
- How the code check finds the new text of an `Edit` in the file, for line numbers.
- The model check's prompt, within the rules above.
- Whether a plugin's `hooks.json` accepts `type: "prompt"` and an `if` filter: the hooks docs don't say. Check it
  before relying on it.
- The before/after examples in the skill, picked from existing flow documents.
