# Writing style: spec

Status: draft, 2026-10-24. Not yet approved.

## Intent

The documents the flows write are hard to read. Specs, plans, flow.md files and audit reports run to thousands of
words, and their prose shows the habits of AI writing: nouns where verbs belong, hidden actors, filler, and shorthand
that only makes sense to the agent that was in the conversation (`grill Q11`, `round 2`, `my call`). The user reads
these documents at every gate, so their readability decides how much the flows cost the user in attention.

The goal is prose a person can read without effort. It is not shorter documents: each document stays as long as its
content needs. It is not a paper style either, and it does not ban words.

The standard is Joseph M. Williams and Joseph Bizup, _Style: Lessons in Clarity and Grace_ (12th ed., 2016). It covers
in one established rulebook what the alternatives cover in pieces: Pinker's reader who wasn't there, Strunk's "omit
needless words" made concrete, and Gopen's old-before-new cohesion. One test from Michael Welles'
[technical-writing-density](https://github.com/mlwelles/technical-writing-density) (MIT) limits the cutting: a word
that carries a reason, a constraint or a disambiguation stays.

## Goals

1. **One rule, stated first.** Every part of this feature serves one sentence: _write for a smart reader who wasn't
   there, and omit needless words._
2. **A skill that teaches the rule.** It summarizes the lessons of _Style_ that matter for technical documents, in our
   own words, in about two pages. Claude reads it whenever it writes prose a person will read.
3. **A checker that enforces what code can check.** A Rust binary flags the mechanical symptoms of bad prose in the
   Markdown Claude writes, and a hook returns the findings to Claude, which revises.
4. **A copyedit pass for what code can't check.** Before a flow shows the user a spec or an audit report, a fresh
   agent copyedits it against the skill.

## Non-goals

- No length limits on documents or sections.
- No banned-word lists. The checker's phrase tables come from Williams' concision operations and say what to write
  instead; they are not a list of AI vocabulary.
- No grammar or usage checking (Williams' Lesson 2). Claude rarely breaks those rules.
- No rewriting of existing documents. The rule applies to what Claude writes from now on.

## Anti-goals

The feature fails, even if it works, when:

- it turns documents into choppy, telegraphic prose that drops reasons and caveats;
- the checker nags so often that Claude rewrites good sentences to silence it, or loops on its own fixes;
- it changes the user's quoted words.

## The skill

A skill named `writing` in a new plugin, `prose` (see [Where it lives](#where-it-lives)). Its description triggers on
any prose a person will read: specs, plans, reports, READMEs, PR descriptions, commit messages and chat answers.

It opens with the rule, then follows the order of _Style_. Each section is two or three lines of principle, plus a
before/after example where one helps. Examples come from this repo's own flow documents.

| Lesson                   | In the skill                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| 1 Understanding Style    | One line: readers judge prose by how it feels to read, so the writer's job is the reader's     |
| 2 Correctness            | Left out                                                                                       |
| 3 Actions                | Actions as verbs, not nouns: "decide", not "make a decision"                                   |
| 4 Characters             | Characters as subjects; passive only when the actor doesn't matter or the topic needs it first |
| 5 Cohesion and Coherence | Old information first, new at the end; keep the same topic across a paragraph                  |
| 6 Emphasis               | The important words at the end of the sentence                                                 |
| 7 Motivation             | An introduction states the problem before the solution                                         |
| 8 Global Coherence       | State each section's and each document's point early, so the reader can skim                   |
| 9 Concision              | The cutting operations (below), limited by the density test                                    |
| 10 Shape                 | Short subjects; break up sentences that sprawl                                                 |
| 11 Elegance, 12 Ethics   | Left out, except one line from 12: don't hide uncertainty or who is responsible                |

Lesson 9's operations, as the skill states them:

- delete words that mean little or nothing ("basically", "actually", "kind of");
- delete redundant pairs ("each and every", "full and complete");
- delete words implied by others ("final outcome", "future plans");
- replace a phrase with a word ("in the event that" → "if", "due to the fact that" → "because");
- turn negatives into affirmatives ("not many" → "few", "not the same" → "different").

Two additions that _Style_ doesn't state:

- **The density test.** Before cutting, ask: does removing this lose a reason, a constraint or a disambiguation that
  prevents a likely misreading? If so, keep it, even if the sentence gets longer. The skill credits
  technical-writing-density and links to it.
- **Lists for lists.** Four or more parallel items go into a list, or a table when they share attributes.

And one aimed at the flows' worst habit:

- **No conversation shorthand.** A reader who wasn't there doesn't know what `Q11`, `round 2` or `D4` means. Record
  who decided what in one place (a **Decisions** section), not as a tag on every line. Quote the user only where the
  exact words matter.

The skill is written in our own words and cites the book. It copies no passages. The lesson numbers and titles above
are from memory of the 12th edition; the user checks them against the table of contents before the skill is written.

## The checker

A Rust binary, `prose`, in `crates/prose/`. It reads Markdown and prints one finding per line:

```
docs/features/x/spec.md:14:3 nominalization: "make a decision" → "decide"
```

It skips fenced and inline code, front matter, link targets and block quotes (the user's quoted words stay as they
are).

### Rules

| Rule             | Flags                                                                                                     | Lesson |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| `nominalization` | A light verb with a nominalization as its object: "make a decision", "perform an analysis of"             | 3      |
| `passive`        | A form of "be" followed by a past participle, with no "by" naming the actor in the same sentence          | 4      |
| `wordy`          | A phrase from the concision table, with its replacement                                                   | 9      |
| `redundant`      | A redundant pair or an implied modifier from the table                                                    | 9      |
| `negative`       | A negative from the table that has an affirmative form                                                    | 9      |
| `list`           | Four or more comma-separated items in one sentence of running prose                                       | —      |
| `undefined`      | An abbreviation of two to six capitals used before it is defined, and not on the common-terms list        | 1      |
| `shorthand`      | Conversation references: `Q` followed by a number, `round` followed by a number, `D` followed by a number | —      |
| `long`           | A sentence of more than 40 words                                                                          | 10     |

The phrase tables and the common-terms list (API, URL, JSON, CLI, MCP, PR, CI and the like) are data files in the
crate, so they grow without code changes.

Before writing the rules, the builder checks [Harper](https://github.com/Automattic/harper) (Apache-2.0), a Rust prose
linter. If `harper-core` already implements some of these rules well, `prose` uses it as a library for those and
implements only the rest. Harper's own grammar and spelling lints stay off.

### The hook

A `PostToolUse` hook on `Write`, `Edit` and `MultiEdit` in the `prose` plugin runs the binary with the hook's JSON on
stdin.

- It checks only Markdown files under the project's `docs/` folder (`$CLAUDE_PROJECT_DIR/docs/**/*.md`).
- In `flow.md` files the `shorthand` rule is off. The flow templates structure flow.md by `Round N` and the grilling
  pack numbers its questions, and flow.md is the log where those numbers belong. The templates and the pack stay as
  they are; the skill tells Claude not to carry the numbers into specs and reports.
- For `Edit` and `MultiEdit`, it reports findings only in the new text, so old prose doesn't trigger findings on every
  edit.
- With findings, it prints at most 10 to stderr and exits 2, which Claude Code returns to Claude. The write has already
  happened, so nothing is blocked.
- The message ends with: _"Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is
  wrong."_ Claude doesn't need to silence every finding.
- Without findings, or when the binary is missing, it exits 0 and prints nothing.

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

Plans and flow.md files get only the checker. Plans are written for the implementing agents, and flow.md changes after
every phase, so a copyedit each time would cost more than it gives.

## Where it lives

- `plugins/shared/prose/`: the plugin, with `skills/writing/SKILL.md` and `hooks/hooks.json`. It sits in `shared/`
  because flows pulls it in, and it is also offered on its own, like tui-review.
- `crates/prose/`: the checker, with its own `Cargo.lock`.
- flows lists `prose` in its conductors' `uses.json`, so `scripts/flows-uses.mjs` adds it to flows' `dependencies`.
- The installer downloads the binary like tui-review's and web-mcp's: a `BIN_PLUGINS` entry, Windows and Linux x64
  only, `binPath` set in the plugin's config.
- CI: `prose.yml` (cargo test and clippy) on PRs touching the crate, `build-prose.yml` on PRs touching that workflow
  and from `release.yml`.
- The crate's and the plugin's versions join the one-version scheme, so `check-repo.mjs` covers them.
- README.md, CLAUDE.md and THIRD_PARTY.md describe the plugin, the crate and the credit to technical-writing-density.

## Success criteria

1. The checker's tests pass, with one fixture per rule: a sentence it must flag and one it must not.
2. Run over `docs/features/web-mcp-search/spec.md`, the checker's findings are mostly real: of 20 sampled findings,
   the user judges at least 15 worth fixing.
3. The copyedit pass, run on one existing spec, produces a version the user finds easier to read, with no decision,
   requirement or quote lost.
4. In a session that writes a spec, the hook's findings reach Claude and it revises without looping.

Criterion 2 is a gate. The checker is built and run as a command first; the hook, the installer step and the release
workflow come only after the user has reviewed the sample. On a miss, the rules with the most wrong findings are
tuned or dropped and the sample is run again.

## Decisions

The user decided:

- Readable prose for the flow documents is the goal, not shorter documents or a paper style.
- No length limits and no banned words.
- Use established sources, combined with a checker; the checker in Rust, not npm.
- _Style_ (Williams and Bizup) is the standard, summarized in our own words rather than copied.
- The density test is part of it.
- The skill follows the book's lessons.

Claude decided, open to change:

- The rule's wording, and the three additions to the lessons (density test, lists, no conversation shorthand).
- Which lessons are in or out, and the checker's rules and the 40-word threshold.
- A new plugin `prose` in `shared/` rather than adding to the dead-skills bundle.
- The hook checks only `docs/**/*.md` and reports without blocking; `shorthand` is off in flow.md, and the flow
  templates and grilling pack stay unchanged.
- The copyedit pass covers specs and audit reports, not plans or flow.md. It commits before and after, and lists what
  it removed.
- The sample review (success criterion 2) gates the hook.
- Density's test is paraphrased with credit, not vendored, because it is one paragraph and needs no sync.
- Harper is evaluated before the rules are written.

## Left to the builder

- The exact phrase tables and the common-terms list, starting from the examples above.
- The past-participle list for `passive`, including the common irregular verbs.
- How the hook finds the new text of an `Edit` in the file (line numbers for its findings).
- How the hook command reaches the binary. No `hooks.json` in this repo uses `${user_config.binPath}` yet (tui-review
  starts its binary from mod code), so test that it expands before relying on it.
- The before/after examples in the skill, picked from existing flow documents.
