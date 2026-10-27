---
flow: feature
phase: ground
---

# Writing style: flow

## Request

> Hey, the goal would be to execute the feature-flow to implement this spec [the spec, kept as given in
> [spec.md](spec.md)] … Important here is that we first utilize free public sources for you to read the content
> before we implement anything!!

Started 2026-10-27 on branch `claude/relaxed-newton-cr62u9` (from `main` 753ba2c).

## Artifacts

- Spec: [spec.md](spec.md) (the user's draft of 2026-10-24, not yet approved)
- Plan:
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md)

## Gates

- Gate 1, spec approved:
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

## Options

## Plan review

## Tasks

## Rulings

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
