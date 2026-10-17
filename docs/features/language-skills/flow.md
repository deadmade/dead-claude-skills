---
phase: done
---

# Language skills (C#, Rust): flow

## Request

> Hey, could we make a plan to add Language Specific skills for c# and rust?

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs: [0001-vendor-language-skills](../../adr/0001-vendor-language-skills.md)
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md) (domain-modeling writes GLOSSARY.md in this version, not CONTEXT.md)

## Gates

- Gate 1, spec approved: 2026-10-13 ("approved, write the plan"). Reopened 2026-10-13: `paths` ignored for plugin skills; user chose router skills (D); re-approved 2026-10-13 ("approved, write the plan")
- Gate 2, plan approved: 2026-10-13 ("approved"), execution: subagent-driven.
  - The keep-bar changes and the fallback were approved at the same time, as was dropping the scratch files.
  - The user authorized merging `feat/tob-picks` into main first.

## Skipped

## Grounding

- Language support today is only the LSP opt-ins: `rust-analyzer-lsp` and `csharp-lsp` from claude-plugins-official
  (`installer/core.mjs:6-13`, binary table `:234-243`, `lsp` category `:313-318`). No plugin skill targets one
  language. tob-picks (staged on `feat/tob-picks`) only has language references inside sharp-edges
  (`lang-rust.md`, `lang-csharp.md`). Its sync skips trailofbits `rust-review`, `modern-cpp` and `modern-python`
  (`scripts/sync-tob.mjs` `SKIPPED`).
- What a new plugin has to touch: a `marketplace.json` entry, `plugins/<name>/.claude-plugin/plugin.json` (same
  version as package.json), an `installer/core.mjs` `CATEGORIES` key (`:299-311`, otherwise it lands in "Other"),
  the opt-ins list in `installer/core.test.mjs:53-70`, and the README opt-in list. A vendored plugin also needs
  `scripts/sync-<x>.mjs` (shape: sparseClone → fail on missing → reportNew → copy → REWRITES → finish),
  `.github/workflows/sync-<x>.yml`, UPSTREAM/LICENSE, THIRD_PARTY.md, the CLAUDE.md vendored list, and the
  `flake.nix:20`/`treefmt.toml:8` excludes. `check-repo.mjs` needs no change.
- Defaults are the dependencies of `plugins/dead-skills/.claude-plugin/plugin.json`. Everything else is opt-in.
- `plugins/dead-skills/rules.md` says nothing about languages or coding style.
- The working tree sits on `feat/tob-picks` with staged, uncommitted changes, including unrelated hookify edits.
  This feature should get its own branch.

**Router spike (Task 1, claude 2.1.296, `claude -p ... --plugin-dir`, scratch plugin `rprobe`):**

- Listing: with `skills/area/`, `library/zebra-lib/` and `skills/area/lib/yak-lib/`, the model lists only `rprobe:area`
  (checked twice, both layouts). Skills outside `skills/` are not listed, and neither is a nested `lib/` skill.
- (a) No `--allowedTools`: fails twice. The router loads, but the read of
  `${CLAUDE_PLUGIN_ROOT}/library/zebra-lib/SKILL.md` is denied.
- (b) `--allowedTools "Read(<abs>/rprobe/**)"`: fails twice, because a single leading `/` means project-root-relative.
  `Read(//<abs>/rprobe/**)` (absolute form) passes twice: reply `OKAPI`. The installer's `Read(~/.claude/plugins/**)`
  rule uses the home-relative form instead.
- In-skill alternative `skills/area/lib/yak-lib/`: fails (a) twice (read denied), so it gains nothing.
- Decision: only (b) passes, so keep `library/` at the plugin root. The router skills depend on the installer's
  `Read(~/.claude/plugins/**)` rule; without it the library read is denied in non-interactive runs. No deviation.

## Prior art

Report from 2026-10-13. These sources were fetched by the research agent and have not been re-checked in this flow.

- **Rust:**
  - [apollographql/skills `rust-best-practices`](https://raw.githubusercontent.com/apollographql/skills/main/skills/rust-best-practices/SKILL.md):
    MIT, active. One 4.4 KB SKILL.md plus 9 chapter references. The closest fit for idiom guidance.
  - [trailofbits `rust-review`](https://raw.githubusercontent.com/trailofbits/skills/main/plugins/rust-review/skills/rust-review/SKILL.md):
    a heavy security-audit orchestrator (44 KB SKILL.md, about 50 prompts, subagents), not day-to-day guidance.
  - [actionbook/rust-skills](https://raw.githubusercontent.com/actionbook/rust-skills/main/skills/rust-router/SKILL.md):
    about 40 skills with an over-broad router and no LICENSE file. Rejected.
- **C#:**
  - [dotnet/skills](https://raw.githubusercontent.com/dotnet/skills/main/.claude-plugin/marketplace.json):
    Microsoft's own Claude Code marketplace. MIT, very active, about 16 plugins and about 100 skills. The core
    `dotnet` plugin bundles its own LSP, which overlaps with our `csharp-lsp`.
  - [`csharp-expert`](https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet/skills/csharp-expert/SKILL.md)
    routes requests to specialist skills.
  - ToB has nothing for C# beyond the `lang-csharp.md` reference we already vendor.
- **Generic persona agents and instruction files:** wshobson, VoltAgent, awesome-copilot. Mostly generic and stale.
  Rejected.
- **Constraints from the docs:**
  - [Skills docs](https://code.claude.com/docs/en/skills): every description costs context on every turn (1% of the
    window as a budget). SKILL.md should stay under 500 lines. `paths` globs gate auto-loading.
  - [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices): only add what
    Claude doesn't know, and write evaluations first.
- **Approaches:**
  - A: vendor picks via a sync script.
  - B: url-sourced marketplace entries. Release tags are unverified for both upstreams.
  - C: our own thin, `paths`-gated skills.
  - D: persona subagents. Rejected.

## Options

- **Why the user wants this (2026-10-13):** Claude's C# and Rust output isn't wrong so much as inconsistent. It
  recommends different things from one session to the next. The user wants a grounded "base truth" for best
  practices and for how specific things are used, and hopes it also improves quality. They haven't used skills like
  this before, so whether they help is still open; an eval or spike can show it.
- **Sources (picked 2026-10-13):** Apollo `rust-best-practices` for Rust and Microsoft `dotnet/skills` for C#. The
  user: "that honestly sounds exactly what I want". Rejected: ToB `rust-review` (a security audit, not guidance),
  generic persona agents and copilot instruction files (generic, stale), and actionbook (no license, over-broad
  triggers).
- **C# scope:** the user writes "everything mainly", web, Blazor, desktop and libraries, some more than others.
- **Scoping to C#/Rust projects (picked option 1, 2026-10-13):**
  - Offered:
    - Option 1: `paths` frontmatter globs (`**/*.cs`, `**/*.csproj`, `**/*.rs`, `Cargo.toml`) added through the sync
      transform.
    - Option 2: enable the plugins per project in `.claude/settings.json`.
  - Recommended option 1 because it needs no step per repo. The user picked option 1.
  - Docs fetched: the [skills docs](https://code.claude.com/docs/en/skills) say "When set, Claude loads the skill
    automatically only when working with files matching the patterns."
  - **Unverified:** whether the skill's one-line description still sits in the listing in projects without matching
    files. To verify during planning or with a spike.
  - Implication: adding `paths` means vendoring through a sync script. A url-sourced marketplace entry can't
    rewrite frontmatter.
- **Vendor vs point at upstream (picked vendor, 2026-10-13):**
  - Pointing directly loses `paths` and carries `dotnet`'s bundled LSP, which duplicates `csharp-lsp`. In exchange
    there is nothing to maintain.
  - The user asked why not point directly, then picked sync ("Then we sync").
  - Checked 2026-10-13: none of the sampled skills set `paths` (dotnet `csharp-expert`, dotnet `run-tests`, Apollo
    `rust-best-practices`). This is a sample, not every skill, so the transform should add `paths` only where it's
    missing.
  - Both upstreams publish release tags: dotnet/skills `v1.0.0`, apollographql/skills `v1.4.0`.

- **What to sync (2026-10-13):** "lets sync everything pls". That means all 16 plugins in dotnet/skills'
  marketplace minus the bundled LSP. `dotnet-experimental` (unlisted upstream) is left out, Claude's call.
- **Before/after consistency test (2026-10-13):** the user said yes.
- **Builder check (2026-10-13):** it raised three questions.
  - Release tags vs main:
    - Offered: follow `main` (recommended), or tags. dotnet/skills has only `v1.0.0` from April, which lacks
      Blazor, WinForms and .NET 11.
    - The user: "We follow Main".
  - Microsoft's 15 agents:
    - Offered: skip them (recommended; agents can't be `paths`-gated), take them anyway, or a separate plugin.
    - The user: skip for now, look into them later.
  - Marketplace list vs `plugins/` folders: Claude's call, the marketplace list.
- **Layout (2026-10-13):**
  - Offered:
    - 1: flat names.
    - 2: `plugins/languages/<x>` folders, which touch check-repo, release and install.mjs.
    - 3: a "Languages" installer page.
  - Recommended 1+3. The user picked 2+3, "just wanted it a bit more sorted".
  - Names: `csharp-skills` and `rust-skills`.

- **Grilling (2026-10-13):**
  - The test uses `claude plugin eval` plus an agreement script, run as a one-off.
  - The 12 questions were accepted as drafted.
  - Keep bar: at least 8/12 more consistent and none worse.
  - No issues for new upstream skills.
  - Rewrite csharp-expert's install advice (B).
  - ADR 0001: yes.
  - Fact check: `paths` hides the listing entry. That came from one project-skill test; the plan re-verifies it
    with a plugin skill.

- **`paths` doesn't gate plugin skills (2026-10-13, found while writing the plan):**
  - Found via the comment at `sync-hallmark.mjs:9-10`, then tested with `--plugin-dir` on 2.1.296: a plugin skill
    with `paths` was listed from the start of the session.
  - Offered:
    - A: enable per repo.
    - B: A plus splitting C# by area.
    - C: install as project skills.
    - D: router skills.
    - A hook hack (not recommended).
  - The user pushed back ("is there really no option?"). The plugins reference has no conditional-activation field
    (`defaultEnabled` is the nearest). Recommended D. The user: "go with D".
  - Spec, ADR 0001 and the glossary were updated. Gate 1 is reopened for this change.

## Plan review

### Round 1 (2026-10-13)

- **Reviewers:**
  - correctness: 12 findings
  - fit: 6 findings, plus a blast-radius check
  - simpler: 9 findings
- **After merging duplicates:** 21 findings, none dropped.
- **The user's decisions:**
  - Merge feat/tob-picks first, then branch: **A**.
  - Keep bar scored per pair of answers, counting only questions where the without-arm disagrees: **A**. This
    changes the spec and reopens Gate 1 for this item.
  - Hidden upstream skills are left out of the indexes: **A**.
  - Scratch `.cs`/`.rs` files in eval runs: dropped.
- **Applied as Claude's fixes (the user didn't object):**
  - Languages page moved before the plugin tasks.
  - `LICENSE` dropped from the cone-mode clone.
  - Idempotence checked after the commit.
  - Relative paths in the csharp-expert rewrite, which also covers the update and Codex lines.
  - The sync fails on a missing SKILL.md or a name mismatch. Indexes come from the copied folders, and the
    `checkIndex`/`collisions` helpers became inline checks.
  - Added/removed lines in the PR body.
  - A fallback for finding eval reply text.
  - Vendored scope narrowed to the generated paths.
  - Agent names taken from frontmatter.
  - The spike runs with and without the Read rule.
  - `/` paths for Windows.
  - `renderRouter` and `addPaths` kept local, and the parser handles only the forms upstream uses.
  - One `manifestPath` used for both install.mjs lookups.
- **Claude's addition, flagged for the user:** the keep-bar fallback "or all of them if fewer than 8 qualify".
- **Skipped (consider):**
  - Running the agent-mention scan only once.
  - Session-judged agreement instead of judge calls.
  - A single `plugins/**` files glob.

## Deviations

Each of these was ruled during execution and logged in the SDD ledger. None changes a public interface.

- **Task 1 (spike):** library reads need a Read grant. The installer's `Read(~/.claude/plugins/**)` covers installed
  plugins; the controller verified this on 2026-10-13. Eval runs get `--allow-tools "Read(//<abs plugin>/**)"`.
- **Task 2:** the install.mjs `shippedVersions` lookup was left as is. It already resolves by marketplace `source`.
- **Task 6:** csharp-expert's leftover install and restart advice is neutralized by an inserted "In the csharp-skills
  plugin…" note plus a fixed index summary, rather than more line rewrites.
- **Security notes (not changed):**
  - `create-pull-request@v8` is tag-pinned, like every other workflow.
  - 2 automated findings in Microsoft's vendored `.ps1` helper scripts, which are vendored and so not edited here.

## Walkthrough

| spec goal                                                       | plan task | file:line                                                                                                         | test                                                                       |
| --------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Two opt-in plugins under `plugins/languages/`                   | T5, T6    | `.claude-plugin/marketplace.json`, `plugins/languages/*/.claude-plugin/plugin.json`                               | `installer/core.test.mjs` opt-ins, check-repo                              |
| Routers over an unscanned library; `paths` kept                 | T1, T6    | `scripts/sync-csharp.mjs` (`ROUTERS`, `renderRouter`), `plugins/languages/csharp-skills/skills/*/SKILL.md`        | `scripts/sync-csharp.test.mjs`; `claude -p` listing check (6 routers only) |
| Weekly sync from main, fails loudly on drift                    | T5, T6    | `scripts/sync-rust.mjs`, `scripts/sync-csharp.mjs`, `.github/workflows/sync-{rust,csharp}.yml`                    | idempotence reruns; sync-csharp tests                                      |
| New upstream skills and plugins picked up (unmapped go to core) | T6        | `scripts/sync-csharp.mjs` (`assignRouter`)                                                                        | `assignRouter` test                                                        |
| Hidden skills out of the indexes                                | T6        | `scripts/sync-csharp.mjs` (`isHidden`)                                                                            | `isHidden` test; 98 of 102 indexed                                         |
| csharp-expert install advice rewritten                          | T6        | `scripts/sync-csharp.mjs` (`REWRITES`, `SUMMARY_OVERRIDES`)                                                       | must-match rewrites; override test                                         |
| Description parsing for indexes                                 | T3        | `scripts/sync-lib.mjs` (`frontmatterDescription`, `summary`)                                                      | `scripts/sync-lib.test.mjs`                                                |
| Nested plugin dirs in check-repo, release and installer         | T2        | `scripts/plugin-dirs.mjs`, `scripts/check-repo.mjs`, `scripts/release.mjs`, `installer/core.mjs` (`manifestPath`) | `scripts/plugin-dirs.test.mjs`, `installer/core.test.mjs`                  |
| Installer "Languages" page                                      | T4        | `installer/core.mjs` `CATEGORIES` (`lsp`)                                                                         | `installer/core.test.mjs`                                                  |
| Before/after test                                               | T8        | `plugins/languages/*/evals/`, `docs/features/language-skills/agreement.mjs`, `eval-results.md`                    | the eval run itself (0/12 questions qualified)                             |
| Docs and excludes                                               | T7        | README, THIRD_PARTY, CLAUDE.md, `flake.nix`, `treefmt.toml`                                                       | `npm test`; prettier check                                                 |
