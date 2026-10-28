---
flow: feature
phase: execute
---

# Writing style: flow

## Request

> Hey, the goal would be to execute the feature-flow to implement this spec [the spec, kept as given in
> [spec.md](spec.md)] … Important here is that we first utilize free public sources for you to read the content
> before we implement anything!!

Started 2026-10-27 on branch `claude/relaxed-newton-cr62u9` (from `main` 753ba2c).

## Artifacts

- Spec: [spec.md](spec.md) (the user's draft of 2026-10-24, rewritten 2026-10-27 after the bake-off; approved 2026-10-27)
- Plan: [plan.md](plan.md) (8 tasks, written 2026-10-27)
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md) (writing skill, conversation shorthand, prose check, copyedit pass)

## Gates

- Gate 1, spec approved: 2026-10-27, by the user ("I approve lets go"), after grill rounds 1–3.
  Reopened 2026-10-27 for the copyedit pass (no commits; a diff against a saved copy) and four smaller points, plan
  review round 1. Re-approved the same day ("yes to all").
  Reopened 2026-10-27: the Task 3 sample gate missed (Haiku hook); Options reopened, see the editor test and
  Deviations. Re-approved 2026-10-28 ("Large pls and I approve"): code check only at write time, the book's method in
  the writing skill, an Opus editor agent fed spaCy candidates (`en_core_web_trf`), Python set up by the installer.
- Gate 1, reopened 2026-10-28 for the second plan review's decisions (NixOS, uv, the editor's hand-back, the
  measures' scope, the off switch, the toggle); approved the same day ("a, all as recommended"). Reopened 2026-10-28
  for the third plan review (NixOS deferred, pstack pinned); approved the same day ("lets ignore nixos for now will
  come to fix that later. yes retire the two writing skills pls").
- Gate 2, plan approved: 2026-10-27, by the user ("approve, subagent-driven"), after plan review round 1; superseded
  by the rewritten plan.
- Gate 2, rewritten plan approved: 2026-10-28, by the user ("Mixed (Recommended)"), after plan review rounds 2, 3 and
  3b. Execution: mixed. A subagent writes the code tasks (3, 7, 9, 10, 11, 12), I write the tasks that are mostly
  `.md` (4, 5, 6, 8; subagents here can't write `.md` files), and every task gets a review. I run Task 13. One
  commit per task on `claude/relaxed-newton-cr62u9`.

## Skipped

## Grounding

### Shipping a third binary (Explore agent, 2026-10-27)

- **Installer.** `BIN_PLUGINS` (`installer/core/binaries.ts:42-45`) maps a plugin to its `userConfig` key; `BIN_TARGETS`
  (`:47-50`) is Windows and Linux x64 only; `binAsset` (`:53-59`) is generic. `applyBin` (`installer/steps/binaries.ts:24-53`)
  is generic too, but `binVersionAt` (`:18-22`) needs `prose --version` to print `prose <version>`, and the fallback
  hint at `:35` hardcodes "web-mcp else tui-review". `install.ts:254-255` calls `applyBin` once per binary plugin. The
  key is written through `claude plugin configure --values-stdin` (`binaries.ts:47`), not settings.json. A binary on
  PATH means no `binPath` is written (`binaries.ts:71-85`).
- **Tests that list binaries:** `installer/core/binaries.test.ts:54-84`, `plugins.test.ts:28-48` (the opt-in list),
  `options.test.ts:64-72`. The "tools" category is `options.ts:70`.
- **Hardcoded crate lists:** `scripts/check-repo.mjs:94-97`, `scripts/release.mjs:48-54`, `.github/dependabot.yml:12`,
  `flake.nix:84-114`, `release.yml` (`needs` at `:36`, notes at `:69-70`). `build-<x>.yml` and `<x>.yml` are copies
  differing only in the crate name. `test.yml` builds no crate.
- **Plugin discovery is automatic:** `scripts/plugin-dirs.mjs:6-18` picks up `plugins/shared/prose/`; marketplace entries
  look like `.claude-plugin/marketplace.json:83-94`.
- **How plugins reach their binary today:** web-mcp's `.mcp.json:4` uses `"${user_config.binPath}"`; tui-review reads
  `options.binPath` in mod code (`register.tsx:500-504`); graphify's hooks call a bare `graphify` on PATH
  (`plugins/shared/graphify/hooks/hooks.json:7,11`). **No hooks.json uses `${user_config.*}`, and the repo has no
  PostToolUse hook.**
- **flows dependencies** come from the union of `uses.json` keys (`scripts/flows-uses.mjs:141-183`); each listed name
  must exist as a skill in the plugin and appear in the conductor's SKILL.md (`:40-87`).
- **Crate conventions:** edition 2024, `rust-version = "1.97"`, MIT, `publish = false`, clippy pedantic warn, thin LTO,
  strip (`crates/tui-review/Cargo.toml`); `--version` prints `<name> <version>` (`crates/web-mcp/src/main.rs:40-41`).
  Fixtures live in `tests/fixtures/`; no crate embeds production data with `include_str!` yet.
- **Node:** `engines` says >=26, but the suite passes on this sandbox's Node 22.22 (117 installer tests, 72 script
  tests; coverage 82.1% against a floor of 79).
- **Already in flows:** pstack-picks ships `technical-writing` (Diátaxis, Google style, STE, Global English) and
  `unslop` (an AI-tell catalog); `/doc-audit` Phase 5 and `/integrate` Phase 2 use them
  (`plugins/flows/skills/doc-audit/uses.json:5`, `integrate/uses.json:3`). Both are vendored and overlap the new skill.

### Gates, writing rules and the sample document (Explore agent, 2026-10-27)

- **Where a spec reaches a gate:** feature-flow Gate 1 (`plugins/flows/skills/feature-flow/SKILL.md:103-104`, reopened
  from Phase 5 at `:117-120`) and research-flow Gate 1 (`research-flow/SKILL.md:82`, reopened at `:39-40`, `:103`).
  implement, upgrade and fix-flow gate plans or causes, not specs.
- **Audit reports** go to `docs/audits/<date>-<flow>-<scope>.md` (`flow-rules.md:19-20`) and reach the user at
  test-audit Phase 4, doc-audit Phase 6 and harden Phase 3. No `docs/audits/` exists yet.
- **Commit conflict:** flow-rules says "The spec and plan aren't committed when written" and "Commit or push only when
  the user asks" (`flow-rules.md:96-101`). The spec's copyedit pass commits before and after on its own.
- **A precedent for a fresh agent reading the spec:** brainstorming's builder check
  (`plugins/flows/packs/superpowers/skills/brainstorming/SKILL.md:228-245`).
- **Rules that conflict with Williams:** `unslop` 13 bans em dashes and 14 limits colons; `technical-writing:87` bans
  semicolons; `technical-writing:56` and `unslop` 29 allow passive only when the actor is unknown or doesn't matter
  (Williams also allows it to keep old information first); `technical-writing:70` splits sentences over about 25
  words (the spec's `long` rule says 40).
- **Where the shorthand comes from:** `Round N` is a comment in the templates (`flow-template.md:52`,
  `research-template.md:60`) and in `plan-review.md:35`; `Q1, Q2…` is the grilling pack's question format
  (`grilling/SKILL.md:8-22`); `D1…` has no source in any skill.
- **`uses.json` and overrides:** a `prose` entry must name a skill that exists in the plugin and appears in that
  conductor's own SKILL.md (`scripts/flows-uses.mjs:40-87`); overrides markers only point into packs (`:101-118`).
  flow-rules' "A missing piece" table (`:176-186`) would need a `prose` row.
- **The sample document** (`docs/features/web-mcp-search/spec.md`, 2,467 words; plan 5,305; flow 2,389): no sentence
  over 40 words (longest 36); 21 Q/D/round tags (`Q1` means a grill question at `:35` and a bench threshold at
  `:166`); hidden actors (`:118`, `:144`, `:161`); undefined CMP (`:68`) and BM25 (`:126`).

- **Prompt hooks in a plugin, checked 2026-10-27** (Claude Code 2.1.311, a probe plugin in the scratchpad run with
  `claude -p --plugin-dir`): a plugin `hooks.json` accepts `type: "prompt"` on PostToolUse; `if: "Write(**/*.md)"`
  matches a file in a nested folder; with `continueOnBlock: true` the reason reaches Claude; a command hook's exit-2
  stderr reaches Claude too. `"model": "haiku"` fails: the log shows `unrecognized_model` and the hook passes
  silently; `"model": "claude-haiku-5-5"` works. `claude plugin validate` accepts the file.
- **pstack upstream** HEAD was `519d36a`, the vendored commit, on 2026-10-27, so re-running the sync changes only
  what this feature changes.

## Prior art

### Prose checkers and Claude Code hooks (background agent, 2026-10-27; every source fetched or cloned in that run)

- **Harper** (`harper-core` 3.0.0, Apache-2.0, edition 2024;
  [Cargo.toml](https://github.com/Automattic/harper/blob/master/harper-core/Cargo.toml)). It parses Markdown with
  pulldown-cmark and skips code, math, HTML and link targets, but **lints block quotes**. It has `LongSentences` (a
  hardcoded `> 40`), about 20 redundancy lints and a phrase DSL (`weir_rules/`). It has **no passive, nominalization or
  undefined-acronym lint**. It pulls about 255 crates, `burn` (an ML framework) among them, and embeds about 3 MB of
  dictionary and tagger models that can't be turned off.
- **Vale** (Go). Styles map onto our rules: Microsoft, Google and write-good `Passive.yml` (a "be" verb plus `\w+ed` or
  about 170 irregulars; Microsoft's own test flags "are related"); Microsoft `Wordiness.yml` (about 127 swaps, MIT);
  proselint `RASSyndrome.yml` and `Needless.yml` (BSD-3); Microsoft and Google `Acronyms.yml` (a defined-before-use
  check with an exceptions list, MIT). None checks nominalizations or negatives with affirmative forms.
- **Data lists we could reuse with credit:** [retext-simplify](https://github.com/retextjs/retext-simplify)
  `lib/patterns.js` (phrase → replacements, MIT); [retext-passive](https://github.com/retextjs/retext-passive)
  `lib/list.js` (215 participles, MIT); [passive-voice](https://github.com/btford/passive-voice) (MIT);
  proselint `checks/misc/composition.py` (negatives with affirmative forms from Strunk & White, BSD-3).
- **Anti-slop linters:** [vale-ai-tells](https://github.com/tbhb/vale-ai-tells) (MIT) calibrates each rule on
  pre-LLM corpora and keeps a must-stay-clean fixture; [slopless](https://github.com/berelevant-ai/slopless) (MIT) is a
  textlint preset with a Claude skill. A paper the agent fetched, arXiv 2607.14167, reports that feedback naming the
  location **and an admissible alternative** repairs better than raw diagnostics.
- **Claude Code hooks** ([hooks reference](https://code.claude.com/docs/en/hooks)):
  - PostToolUse exit 2 "Shows stderr to Claude; the tool already ran". Stderr of an exit 0 is never shown.
  - Write's input has `file_path` and `content`; Edit's has `file_path`, `old_string`, `new_string`, `replace_all`.
    Edit's `tool_response` is undocumented, so the hook re-reads the file and finds `new_string`.
  - **`${user_config.*}` expands in plugin hooks only in exec form (`args` set).** Shell form reads
    `$CLAUDE_PLUGIN_OPTION_<KEY>` instead.
  - **MultiEdit no longer appears** in the hooks or tools reference (Edit, Write, NotebookEdit only).
  - An `if` field takes one permission rule per handler (`"Edit(docs/**)"`), so Write and Edit get a handler each.
- **Pitfalls:** regex passives flag adjectival participles ("is based", "is required"); proselint's philosophy is
  "Better to say nothing than to say the wrong thing"; a PostToolUse loop is possible, so the feedback reports only new
  text and always names a replacement.

**Approaches for the checker** (the agent's grouping):

- **A, harper-core as a library plus our own linters.** Good sentence splitting and POS tags. Costs about 255 crates and
  3 MB of models, and most rules are still ours.
- **B, our own small engine with data tables.** pulldown-cmark for masking, phrase tables vendored from MIT/BSD lists,
  hand-written passive, acronym and shorthand rules. Few dependencies; passive stays heuristic.
- **C, Vale with a custom style.** Mature scoping and rule DSL, but a second downloaded Go binary, against the user's
  "in Rust" decision.

### Writing sources (background agent, 2026-10-27; free public pages only, every one fetched in that run)

- **_Style_, 12th edition, contents** ([Pearson](https://pearson.com/en-us/subject-catalog/p/style-lessons-in-clarity-and-grace/P200000008731/9780134080413),
  ISBN 9780134080413, 2016): I Style as Choice (1 Understanding Style, 2 Correctness); II Clarity (3 Actions,
  4 Characters, 5 Cohesion and Coherence, 6 Emphasis); III Clarity of Form (7 Motivation, 8 Global Coherence);
  IV Grace (9 Concision, 10 Shape, 11 Elegance); V Ethics (12 **The Ethics of Style**); appendices on punctuation and
  using sources. The spec's table is right except Lesson 12's full title. The 11th edition has the same lessons.
- **Lesson summaries** come from Greg Baker's SFU course notes on the 11th edition
  ([index](https://www2.cs.sfu.ca/CC/376/ggbaker/notes/); e.g.
  [characters](https://www2.cs.sfu.ca/CC/376/ggbaker/notes/content/characters.html),
  [concision](https://www2.cs.sfu.ca/CC/376/ggbaker/notes/content/concision.html)), a
  [Boston University lesson](https://www.bu.edu/teaching-writing/resources/essential-lesson-10), Justin Taylor's
  [notes](https://www.thegospelcoalition.org/blogs/justin-taylor/style-some-notes-on-clarity-and-grace/) (blog) and
  Williams' own essay [Problems into PROBLEMS](https://wacclearinghouse.org/docs/comppile/pd/JWilliamsProblemsdw.htm)
  (condition plus cost; the point at the end of the introduction). Points the spec's table misses: passive is also
  right when it keeps a paragraph's topic string consistent (L4); hedges stay where a claim isn't universal (L9);
  metadiscourse is one of the cuts (L9); a section opens with its own short introduction (L8).
- **Gopen and Swan, "The Science of Scientific Writing"** (1990,
  [Michigan copy](https://prod.lsa.umich.edu/content/dam/sweetland-assets/sweetland-documents/Graduates/DWG/The-Science-of-Scientific-Writing.pdf)):
  verb right after its subject; new, emphasized information in the stress position; the sentence's "whose story" and
  old information in the topic position; action in the verb; context before the new. They warn these are reader
  expectations, not rules.
- **Strunk, _The Elements of Style_** (1920, public domain, [Gutenberg 37134](https://www.gutenberg.org/ebooks/37134.txt.utf-8)):
  rules 10 (active voice; passive allowed when the paragraph's topic needs it), 11 (positive form: "did not remember"
  → "forgot"), 13 (omit needless words: "the question as to whether" → "whether", "owing to the fact that" →
  "since"), 18 (emphatic words at the end). Its phrase pairs are free to reuse.
- **Pinker, "The Source of Bad Writing"** (WSJ 2014, [his site](https://stevenpinker.com/publications/source-bad-writing)):
  the curse of knowledge, "a difficulty in imagining what it is like for someone else not to know something that you
  know"; remedies: a test reader, or rereading after time has passed.
- **technical-writing-density** ([repo](https://github.com/mlwelles/technical-writing-density), MIT confirmed, one
  `SKILL.md`). The test verbatim: "Does removing this lose a reason, constraint, or disambiguation that matters to the
  topic and prevents a likely misreading?" The spec's paraphrase drops "that matters to the topic" and the limit "Keep
  the ones that matter, not every one you can think of". It also puts four or more distinct items in a list, and a
  table when they share attributes.
- **Phrase data free to reuse:**
  [plainlanguage.gov "Use simple words and phrases"](https://github.com/GSA/plainlanguage.gov/blob/main/_pages/guidelines/words/use-simple-words-phrases.md)
  (about 235 entries, US public domain plus CC0), its `avoid-hidden-verbs.md` (light verbs achieve, effect, give, have,
  make, reach, take; "make an application" → "apply") and `use-positive-language.md` ("no fewer than" → "at least");
  Strunk's pairs. GOV.UK's A–Z guide is OGL v3 (attribution); Wikipedia lists are CC BY-SA (share-alike). Williams'
  own example lists are not reusable as data.

## Options

- **The checker's approach** (2026-10-27). Offered A harper-core plus own rules, B own engine with data tables, C Vale
  with a custom style; recommended B. The user rejected the criteria: "im locking for the best way not the easiest!! it
  sounds like harper and vale are ruled out because to big or no rust pls take this req out and evaluate again." So the
  spec's "the checker in Rust, not npm" no longer binds, and size and dependency weight don't count. Re-evaluated on
  finding quality, measured: a bake-off on `docs/features/web-mcp-search/spec.md`, with prototypes and tool installs in
  the scratchpad only (throwaway, not building; nothing enters the repo).

- **Bake-off results** (2026-10-27; scripts, outputs and verdicts in the session scratchpad, `bakeoff/`). Sample:
  `docs/features/web-mcp-search/spec.md`. A blind annotator (opus) marked 47 places worth fixing: 31 shorthand,
  3 passive, 2 redundant, 2 negative, 2 undefined, 1 nominalization, 1 list, 5 other (lost antecedent, term used before
  it's defined, contradictions); no sentence over 40 words. Two blind judges (opus) labelled 260 findings sampled per
  tool and category; precision is extrapolated per stratum. Recall counts a gold item as caught when a finding of the
  same category overlaps it.

  | tool (version, settings)                                             | findings | precision | worth fixing | recall |
  | -------------------------------------------------------------------- | -------- | --------- | ------------ | ------ |
  | Harper 3.0.0, all 937 lints                                          | 176      | 2.5%      | about 4      | 1/47   |
  | Vale 3.25.1, Microsoft, Google, write-good, proselint, vale-ai-tells | 539      | 2.8%      | about 15     | 9/47   |
  | LanguageTool 6.6, picky, 28 style rules                              | 163      | 0%        | 0            | 4/47   |
  | proselint 0.16.0, all checks                                         | 1,231    | 0%        | 0            | 3/47   |
  | parser prototype (spaCy trf, WordNet, CC0/PD tables)                 | 107      | 47%       | about 51     | 28/47  |
  | LLM checker (haiku, rules.md)                                        | 42       | 86%       | 36           | 31/47  |

  Per rule: shorthand is precise for both the prototype (22/25) and the LLM (29/29); mechanical passive was 2/18 in
  Vale, 0/6 in LanguageTool and 3/22 in the prototype; negative-to-affirmative suggestions were 0/6 (WordNet antonyms
  like "not clear" → "bounce"). Only the LLM caught any of the five "other" problems (1/5). Masking: only the prototype
  and LanguageTool (fed through a Markdown runner) skipped all of code, front matter, link targets and block quotes.
  Caveats: one document; the annotator and judges are LLMs; the haiku run was an agent with time to reread, not one
  hook-shaped call.

- **Local model** (2026-10-27): the user asked about one ("my first thought was local model but I dont think this is
  really doable"). Prompt hooks call only Claude models; a local model would need a command hook and a local server,
  and its precision is unmeasured. Offered to measure one; the user moved on.
- **Picked** (2026-10-27): "yes, go with Haiku plus the code check". A Haiku prompt hook for the judgment rules and a
  dependency-free Node script for shorthand and undefined abbreviations (whole-file definitions). No crate, binary,
  installer step or release workflow. The code check is dropped if the sample review shows it adds nothing over Haiku.
  Rejected: Harper, Vale, LanguageTool, proselint (precision 0–3%), a hardened spaCy checker (47%, Python plus a
  500 MB model per machine), an agent hook (experimental, slower). The spec was rewritten around the pick the same day.
- **Hooks docs, checked 2026-10-27** ([hooks.md](https://code.claude.com/docs/en/hooks.md), "Prompt-based hooks",
  "Common fields"): PostToolUse supports `type: "prompt"`; `model` is settable; default timeout 30 s; on `ok: false`
  with `continueOnBlock: true` the reason goes back to Claude and the turn continues; matching hooks run in parallel;
  `if` holds one permission rule per handler. Whether plugin `hooks.json` accepts prompt hooks isn't stated.

- **Grill round 1** (2026-10-27): eight questions asked (copyedit commits, the pstack writing skills, hook scope, checks
  on plans and flow.md, loop guard, gate sample, plugin home, seam lines). The user answered with the goal instead:
  "the generall goal of this was that either claude writes the md file and it is imediatly checked or that the main
  session uses a subagent or something to respect the rules and write it. It was also the goal to replace the current
  writing skills with this unified one". Settled by that: the unified skill replaces pstack `technical-writing` and
  `unslop`. Re-asked in round 2: which write path, what the unified skill keeps from the two, how the pack copies go.

- **Grill round 2** (2026-10-27): the user answered "a, lgtm but let if verify. The goal is to convert the book on how
  to write good to a skill so AI agents stop writing 10k slop files.. a, / let the hook cover all md files that are
  wriiten / pls vendor the plugin in the stacks since its goal is to be an enhancement of all the flows". Settled:
  the write path is hooks on every write plus the copyedit subagent at gates; the keep/drop list for the unified skill
  stands, with a verification step; the pstack copies stop being vendored and the sync rewrites the three references;
  the hooks cover every Markdown file Claude writes, not only `docs/`. To confirm: where the skill and hooks ship
  ("vendor the plugin in the stacks"), what "let it verify" checks, and the round 1 items the answer didn't name.

- **Grill round 3** (2026-10-27, AskUserQuestion): placement "Inside flows"; verification "Source check + sample";
  the five remaining round 1 recommendations "Yes, accept all". The spec was revised with every settled decision the
  same day. New glossary terms: writing skill, conversation shorthand, prose check, copyedit pass. No ADR: the choice
  of a model hook over linters is easy to reverse, and the spec's Approaches section records the trade-off.

### Editor test (2026-10-27, after the missed sample gate)

Two real documents, `web-mcp-search/spec.md` (2,467 words, 47 known problems) and `web-mcp-search/findings.md`
(2,901 words), each edited four ways: Opus with a plain prompt ("reads clearly to a smart reader who was not there"),
Opus with the book's method (a guide written from the free sources above), Opus with the book's method plus the code's
list of candidate problems, and Sonnet with the book's method. The same rules held for all: keep every fact, quote,
code span and heading. Scored by blind section rankings (Sonnet and Fable judges, 28 sections), a fact check (304
claims), the 47 known problems (one judge, one standard), and code measures of the book's lessons. Work files are in
the scratchpad's `edittest/`.

| version           | mean rank, 4 judgings (1 best, 5 worst) | sections ranked first (of 56) | known non-shorthand problems fixed (of 16) | shorthand fixed (of 31) | claims lost or changed (of 304) |
| ----------------- | --------------------------------------- | ----------------------------- | ------------------------------------------ | ----------------------- | ------------------------------- |
| book + candidates | 1.94                                    | 24                            | 12                                         | 0                       | 0                               |
| book              | 2.46                                    | 11                            | 10                                         | 1                       | 1                               |
| plain             | 2.64                                    | 17                            | 6                                          | 2                       | 0                               |
| book, Sonnet      | 3.68                                    | 4                             | 6                                          | 16                      | 0                               |
| original          | 4.28                                    | 0                             | 0                                          | 0                       | (none)                          |

- The book's method beats a plain prompt, and the code's candidate list improves it further. Book + candidates
  ranked best in all four judgings. It also moved the book's measures furthest. On the spec, adjacent sentences sharing
  a content word went from 31.9% to 58.1% (plain: 44.7%), passive sentences from 25.3% to 14.0% (plain: 27.2%), and
  abstract subjects from 5.2% to 1.9% (plain: 6.8%).
- No editor can repair conversation shorthand, because none of them was there. Opus kept the labels and added a
  legend. Sonnet replaced them with "the user agreed in the grill", which the judges read as lost meaning; Sonnet's
  spec ranked below the original. Shorthand has to be fixed by the writer while it still has the context, which is
  what the code check at write time does.
- Sonnet's book edit was the weakest edit, so the model matters.
- Filler and nominalizations were already rare in both originals (0.4–2.1 filler phrases per 1,000 words, about 1
  nominalization per 100 words). These documents' problems are shorthand, cohesion and shape.
- Limits: two documents, one run per version, model judges rather than people, and parser-based measures with known
  noise.

## Plan review

### Plan review round 1 (2026-10-27)

Reviewers: correctness (fable), fit with pstack `blast-radius` (opus), simpler with ponytail-review (sonnet). Two
claims were checked with a probe plugin the same day: Edit's and an overwriting Write's hook input carry the whole old
file in `tool_response.originalFile` (confirmed); `if: "Write(**/*.md)"` matches a root-level `README.md` and an
absolute path outside the project (confirmed, so the reviewers' worry about out-of-tree files is dropped).

Decisions for the user:

- **Copyedit commits.** They land on whatever branch is checked out (often `main` at feature-flow Gate 1, the audited
  branch for audits); `git add -u` sweeps unrelated work in; an unchanged copyedit makes `HEAD~1` wrong; pre-commit
  prettier can rewrap. Options: harden the commits (document only, refuse on the default branch, record both hashes),
  or drop them for a saved copy and `git diff --no-index`. Recommended: drop them.
- **Old text reaches Haiku on edits.** Options: the prompt says to judge only `tool_input` and ignore
  `tool_response`, measured by an Edit run in the sample; or a command hook that calls Haiku on `new_string` only.
  Recommended: the prompt, with the command hook as the fallback if the sample shows old-text findings.
- **Every flows user gets the hooks everywhere.** Descriptions in `marketplace.json` and flows' `plugin.json` become
  untrue; "Q1 2027" in another project's docs would be flagged; a provider without `claude-haiku-5-5` makes the
  model check pass silently; a prompt hook can't read a userConfig switch. Recommended: update both descriptions with
  the per-write cost, tighten the shorthand pattern (no year after a Q number), and document how to turn the hooks
  off (disable flows' hooks or flows).
- **`uses.json` can't name `writing`.** `checkUses` rejects a `flows` key and `readUses` treats every folder in
  `skills/` as a conductor. Recommended: teach `flows-uses.mjs` that a skill without `disable-model-invocation` is not
  a conductor and may be listed under `flows`, with tests.
- **The `undefined` rule is noisy on this repo's prose:** 163 first uses over 36 docs, mostly PASS/FAIL, SKILL (from
  `SKILL.md`), HEAD, all-caps emphasis, units and file types. Options: keep it with a seeded common-terms list, a
  file-name skip and must-not-flag fixtures from real docs; or build shorthand first and add `undefined` only if the
  sample shows Haiku misses abbreviations. Recommended: keep it with the fixes, measured at the sample gate.

Plan fixes with no spec change (proposed as one batch): `readUses` skips non-conductors (Task 4); the two tests that
contradict each other on "technical-writing-density"; `sync-pstack.yml`'s skill count 18 → 16; pack rewrites name
`flows:writing` through the Skill tool, and conductors load it the same way; the pstack-picks `plugin.json`
description is hand-written, so it is edited by hand; `flake.nix`'s test `files` regex gains `plugins/flows/hooks/`;
the Task 2 probe also checks `--plugin-dir` with the whole flows plugin; empty `new_string` returns no ranges; CRLF
edits find `new_string`; table and code-font definitions count; the copyedit agent returns text and the conductor
writes once; Task 3 adds an Edit run and takes findings from the hook events; the command hook uses exec form; the
dropped-name guard extends `GUARD` instead of a new check; wording tests shrink to the two verbatim strings, the
handler structure and equal prompt copies; the wall-clock test becomes a one-time measurement.

The user's decision (2026-10-27): "yes to all". The spec and plan were revised the same day. The plan keeps its task
order and modules (`flows-uses.mjs` joins Task 4), so no second review round; I checked the edits myself.

### Plan review round 2 (2026-10-28, the rewritten plan)

Three reviewers: Correctness (Fable), Fit (Opus, with pstack `blast-radius`), Simpler (Sonnet, with ponytail
`ponytail-review`). 40 findings; duplicates merged, none dropped. Every `file:line` the plan cited matched the tree.

- **Blocking:** the environment won't run on NixOS, the installer's Linux (`installer/core/binaries.ts:12,36,106`):
  uv's Python and PyTorch's manylinux wheels need the usual system library layout. nixpkgs packages spaCy and
  `en_core_web_trf` 3.8.0 (`pkgs/development/python-modules/spacy/models.json`, `models.nix`, fetched). Decided: (a), a
  `flake.nix` package `flows-prose` on NixOS; uv everywhere else.
- **Decided as recommended** ("a, all as recommended"):
  - uv from PATH with an install hint; no pin, no helper renames, no sync workflow.
  - Core first (check, skill, `/copyedit` without measures, gates, pstack, docs), then the Python half, then
    acceptance; this also fixes `npm test` breaking on a skill folder without `SKILL.md`.
  - The editor writes its version to a scratchpad `.txt` file (subagents may not write `.md`); the original is saved
    first; code checks headings, code, links, numbers, checkbox steps and table rows before a `cp` replaces the
    document, so the write-time check doesn't report the whole document; only findings new against the saved copy
    are reported; the prompt protects checkbox steps, numbered items and tables.
  - Masking and phrase matching in Node, shared with the check; Python only for spaCy; only the tested candidate
    kinds, without shorthand and abbreviations; no WordNet table.
  - pstack's upstream moved (`519d36a` → `c742dd6`: `arena`, `interrogate`, four deleted reference files, none used by
    a conductor); the update rides along with retiring the two writing skills.
  - `FLOWS_PROSE_CHECK=off` turns the check off (`disableAllHooks` would also turn off dcg and the notifications).
  - The toggle: on by default only with flows; off stays off once unticked (a marker, written only when the user
    unticks); no second question; uv's cache and Python inside `~/.claude/flows-prose/`; "installed" is the
    environment's Python, confirmed by loading the model after a sync; Windows-safe removal; the step runs last.
  - ADR 0005 for the Python toolchain.
- **Fixes without a decision:** the `flows-uses` test fixture gains frontmatter; `/copyedit`'s paths work when another
  conductor reads it (`${CLAUDE_SKILL_DIR}/../copyedit/`); tests and process-spawning code stay out of skill folders
  (the skill scanner); the installer tests run on Node 22 here, and the typecheck is `npm ci && npm run typecheck`;
  the project path goes through `UV_PROJECT`; the measure step has a timeout; THIRD_PARTY.md changes with the data it
  credits; CI checks the lock ships in the installer package; the wording tests keep only what a machine reads; the
  test environment comes from the real project files; a summary line when prose is ticked without flows.

The decisions changed the plan's shape (task order, new modules), so the review runs again on the revised plan.

### Plan review round 3 (2026-10-28, the plan revised for round 2)

Same three angles and models. 31 findings; duplicates merged, none dropped.

- **Blocking, NixOS:** nixpkgs' `en_core_web_trf` doesn't build (its runtime-deps check: spacy-curated-transformers
  2.1.2 against `<1.0.0`). Tested here: with the check relaxed it builds, but `spacy.load` fails with `Error(s) in
loading state_dict` (the weights are laid out for 0.x). The uv environment inside a `buildFHSEnv` installed and
  loaded the model and parsed a passive correctly (in this container, not on NixOS). Decided: NixOS waits ("lets
  ignore nixos for now will come to fix that later"); the toggle is hidden there.
- **Blocking, pstack:** upstream `c742dd6` fails the sync's `GUARD` (`arena/SKILL.md:19,30`, `interrogate/SKILL.md:19`),
  names the skipped `in-your-own-words`, and turns `interrogate` into adversaries that run code in worktrees. This
  reverses round 2's "rides along". Decided: retire the two skills against `519d36a` ("yes retire the two writing
  skills pls"); `sync-pstack.mjs` gains `--ref`; upstream's update gets its own PR.
- **Fixes applied as recommended:** the toggle follows `web-builtins-off` (default on where offered unless the
  marker, the effect gated on flows, the marker written whenever the user unticks, `remove` before `needs-flows`,
  the state in `core/prose.ts`); a missing uv goes into `BINARIES`' "Missing on PATH" note, not a failure;
  `hasBuild` shared with `BIN_TARGETS`; `removeDir` takes an injectable `rm`; CRLF test cases, and `/copyedit` keeps
  the document's line endings; quoted paths and `git diff`'s exit code in `SKILL.md`; a per-run folder emptied first,
  a missing edit as one lost line, `before/` and `after/` measures; `measure.mjs` holds the Python lookup, timeout and
  fallback with tests; Python splits blocks itself and Node merges and formats; the totals cover the candidate kinds
  only; one variable, `FLOWS_PROSE_PYTHON`, for the spaCy test; `loadTerms` shared; the pre-commit regex covers
  `plugins/flows/skills/`; the `flows-uses` tests check what they claim; the density credit lands with the skill;
  `/copyedit` in flow-rules' **State** list and `"general-purpose"` in its `uses.json`; Task 13 uses the Task 10
  environment; a run with a Python that can't load the model.

The revision changes the plan's shape a little (`measure.mjs`, the pinned sync), so one Correctness reviewer checks
the changed tasks before Gate 2.

### Plan review round 3b (2026-10-28, Correctness on the changed tasks)

One Fable reviewer. Every round-3 decision landed; no NixOS or upstream-pstack remnants; the `file:line` references
and Task 7's expected results checked out (a commit fetch with `--depth 1` then `checkout` works on git 2.43). Seven
findings, all applied:

- **Blocking:** `unticked: chosen.prose && !on('prose')` was always false, since `Object.assign(chosen,
state.chosen)` runs first (`install.ts:225`); the marker would never be written. Now compared against a copy taken
  before the screens.
- `proseDefault` now needs flows, as the spec and ADR say ("on by default when flows is selected"); without it every
  run without flows showed a prose change and a "needs flows" line.
- `measure.mjs`'s timeout is 540000 ms, below the Bash tool's 600000, so its timeout fallback can run.
- A test for an empty edit; the commit fetch honours `depth`, and its test commits with an explicit identity over
  `file://`; the fixture's markers sit on their own lines, outside parsed sentences; `measure.mjs` consumes
  `loadPhrases` and counts words itself.

## Tasks

- Task 1: base cf3ed1c, untracked at start: none; files clean; review clean after one fix round (2287a4c).
- Task 2: base 3ce519e, untracked at start: none; files clean; review clean after one fix round (1ba2a0e).
  Probe (on the dependency-free copy): the code check exited 2 naming `Q4` and `CMP`, not `Q9`; the model check's reason
  named the nominalization and ended with the closing line. The model reason is in no hook event; it reaches Claude
  after Claude Code repeats the prompt twice, and appears in the stream only in Claude's own text and the final `result`.
- Task 3: base 1ba2a0e, untracked at start: none. Sample review gate missed: the model check found 6 problems in about
  7,800 words. Execution stopped after Task 3; see Deviations.
- 2026-10-28: the plan was rewritten for the re-approved design (Tasks 1 and 2 kept as built; Tasks 3–12 new). The
  first plan's Task 3 (the sample review) is the gate that missed, recorded above.

## Rulings

- 2026-10-27, Task 2: probes and the sample run load a scratchpad copy of `plugins/flows` with `dependencies` removed, because on Claude Code 2.1.311 an unsatisfied dependency (graphify) disables flows under `--plugin-dir` — the copy is test scaffolding and changes nothing in the repo — if wrong, the measured hooks differ from the shipped ones only in the manifest.
- 2026-10-28, Task 4: the writing skill's source check found near-copies of technical-writing-density, unslop and
  technical-writing, two misquoted examples and Lessons 3 and 4 out of order; all fixed in a3d381e. Lesson 1's line
  stays (the spec asks for it), reworded to what the free sources support.
- 2026-10-28, Task 5: the editing guide differs from the tested `book.md` in more than the labels rule. Its source
  check found that "If not, cut it" could cut facts, that it invited guessing at actors, abbreviations and referents,
  and that it quoted technical-writing-density word for word. The guide now says to revise only with what the
  document states, to cut words but never content, and gives a diagnosis for every lesson. If that is wrong, Task 13's
  re-run of the editor test (criterion 4) shows it, since it uses the shipped guide.
- 2026-10-28, Task 5: "four or more parallel items" is the spec's own count, not technical-writing-density's (which
  gives none); Prior art above credits the count to it by mistake. Kept as the spec states it.
- 2026-10-28, Tasks 5–6: when `/copyedit` refuses an edit (something was lost, or compare.mjs failed), the flow goes
  on to its gate with the unedited document and `/copyedit`'s lines, and the gate message says the copyedit was
  refused; the plan didn't decide this, and stopping the whole flow over an editor's slip costs more than showing the
  original. If wrong, a refusal should stop the flow and ask the user instead.
- 2026-10-28, Task 5: compare.mjs counts every token with a digit (`v0.3.0`, `x64`, `Q11`) as a number to keep, and
  checkbox states and table columns as well as counts, after the review showed versions and labels could vanish
  unnoticed; its line-joining uses prose.mjs's block-start rule, which took honest rewraps of this repo's specs and
  plans from 27 of 92 refused to 0. The guide no longer asks for tables, which compare.mjs refuses by design.
- 2026-10-28, Task 10: without WordNet, the prototype's 14 nominalization suffixes flag ordinary nouns (message,
  package, feature) as actions. The light-verb rule ("make a decision") keeps the 14, since its context keeps false
  hits rare; the weak-verb-subject and abstract-subject rules use the 7 suffixes the editor test's `metrics.py` used,
  and a token gets one candidate, not two. If wrong, the editor sees fewer nominalization and abstract-subject
  candidates than the prototype's list would give.

## Deviations

- 2026-10-27, Task 3 (sample review gate): the Haiku hook found too little to be worth its cost. A recount of the
  comparison data shows why: Haiku's 31 of 47 were 27 shorthand, and it caught 4 of the 16 other problems; the hook
  prompt then told it to skip shorthand. The user: "Clearly haiku failed". The user also said length is not the
  problem ("I dont mind a long text for a long feautre. I just dont want slop text"), so hard limits are out, and wants
  the book's method in the agents. Gate 1 is reopened at Options. Next, by the user's decision ("yes go ahead with the
  test"): a test of an editor agent that applies the book's diagnosis against a plain editing prompt and no edit,
  scored by code measures of the book's lessons, facts kept, known problems left, and blind judges.

- 2026-10-28, Options: the candidate measures stay in Python (spaCy), not a Rust port on Harper's tagger and chunker
  (user: "Let's just stay on python").

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
