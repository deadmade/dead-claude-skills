---
flow: feature
phase: evaluate
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
- Gate 2, plan approved:

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

  | tool (version, settings)                              | findings | precision | worth fixing | recall |
  | ----------------------------------------------------- | -------- | --------- | ------------ | ------ |
  | Harper 3.0.0, all 937 lints                           | 176      | 2.5%      | about 4      | 1/47   |
  | Vale 3.25.1, Microsoft, Google, write-good, proselint, vale-ai-tells | 539 | 2.8% | about 15  | 9/47   |
  | LanguageTool 6.6, picky, 28 style rules               | 163      | 0%        | 0            | 4/47   |
  | proselint 0.16.0, all checks                          | 1,231    | 0%        | 0            | 3/47   |
  | parser prototype (spaCy trf, WordNet, CC0/PD tables)  | 107      | 47%       | about 51     | 28/47  |
  | LLM checker (haiku, rules.md)                         | 42       | 86%       | 36           | 31/47  |

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

## Plan review

## Tasks

## Rulings

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
