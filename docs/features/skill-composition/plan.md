# Skill composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the marketplace so that only the flows conductors activate pack skills. Builds must stop and ask on
decisions the plan didn't make, and a sync must fail when a conductor's override goes stale.

**Architecture:**

- The six skill packs move into the flows plugin as `plugins/flows/packs/<pack>/`. They are still one synced folder per
  pack, and they leave the marketplace. Claude Code only scans a plugin's `skills/`, `agents/` and `hooks/hooks.json`
  (docs plugins/components, fetched 2026-10-23), so nothing under `packs/` lists or fires on its own. Conductors read
  the packs by path.
- The shared conductor rules (flow-rules.md) carry the build stop, the Rulings log, ponytail's steps, stack detection
  and pack loading.
- A check in `flows-uses.mjs` verifies every quoted override sentence against the pack.

**Tech Stack:** Node stdlib (`.mjs` scripts and the type-stripped `.ts` installer, Node 26+), Markdown skills, and
`npm test`.

**Spec:** `docs/features/skill-composition/spec.md`. Gate 1 was approved 2026-10-23 and reopened for the pack home
after the plan review. State is in `flow.md`, step owners in `skill-map.md`, and the review in flow.md "Plan review
round 1".

## Global Constraints

- **Packs:**
  - `superpowers`, `ponytail`, `mattpocock-picks`, `pstack-picks`, `tob-picks`, `paper-lookup` live at
    `plugins/flows/packs/<pack>/`, written there by their sync scripts.
  - They leave `.claude-plugin/marketplace.json`; the installer then retires existing installs.
  - The pack list is the directory listing of `plugins/flows/packs/`; there is no hand-kept list.
- **Reading packs:**
  - Each conductor's SKILL.md states the packs folder once as `${CLAUDE_PLUGIN_ROOT}/packs`. That text is
    substituted; flow-rules.md and files read by path are not.
  - A pack skill is read by path, never through the Skill tool.
  - Inside a pack file:
    - `<pack>:<name>` means `<packs>/<pack>/skills/<name>/SKILL.md`;
    - `${CLAUDE_SKILL_DIR}` means the folder of the file being read.
  - A pack's agents run as `general-purpose`, with the agent file's text as the prompt.
- dead-skills `dependencies` lose `superpowers`, `ponytail` and `code-review@claude-plugins-official`. Domain skills and
  security-guidance's hooks stay.
- Deviation classes (spec, verbatim): a new or changed public interface, a new library or outside call, a changed data
  flow or error handling, files the task didn't list. Private names and small cleanups inside the task's files are not
  deviations.
- Builder brief line, from pstack `principle-laziness-protocol`: "a new signal through types, schemas or pipelines:
  stop, find a more direct path".
- **Stack packs:** only the detected stack's router or single skill goes into a brief, never a whole library (review,
  E9 and E2).
- **Repo rules:**
  - Specs and plans live in `docs/features/<slug>/`.
  - Commit or push only when the owner asks. Commit messages are one sentence, with no co-author lines; stage with
    `git add -u` plus explicit new paths.
  - Vendored folders are changed only through `scripts/sync-*.mjs` transforms.
  - No env vars or toggles.
  - Installer logic goes in `core/` or `system/`, with a test.

## Review Focus

1. **A pack drops or renames a file upstream.** The sync replaces the pack folder rather than merging into it, as the
   existing syncs do. Task 3 checks each moved sync script still clears its target.
2. **An override sentence that wraps across lines or gets reformatted.** The quote check normalises whitespace and
   `*`/`_` emphasis on both sides. Tested in Task 5.
3. **A run already in progress (an old flow.md) resumed after the change.** The phase names stay the same, and a
   missing **Rulings** or verdict line is added rather than required. Task 6 rule.
4. **Old installs come back.** Retiring runs before updates in `applyPlugins`, and old dead-skills or flows still
   declare the packs as dependencies, so they could be reinstalled. The installer asserts afterwards that no pack is
   installed. Tested in Task 4.
5. **A nested `.claude-plugin/` under `packs/`.** `claude plugin validate plugins/flows` must still pass, and nothing in
   `packs/` may load. Checked in Task 3.

---

### Task 0: Commit the vendoring session's work (on main, before branching)

- [ ] Show the owner the file list, then commit only that session's files with a one-sentence message:
  - the superpowers vendoring and the sync-release rename;
  - the installer/scripts/docs edits;
  - `.gitattributes` and `docs/features/vendor-superpowers/flow.md`.
- [ ] Do not commit sandbox placeholder paths (`.claude/*`, dotfiles, `.idea`, `.vscode`), other flows' folders, or
      this flow's folder.
- [ ] Run `npm test` first. Expected: PASS.
- [ ] Then create the branch `skill-composition`, or a worktree for it.

### Task 1: Baseline measurement (rough, by owner's choice)

**Files:**

- Create: `docs/features/skill-composition/measure.mjs`
- Create: `docs/features/skill-composition/measure.test.mjs` and `fixtures/` (two small `.jsonl` transcripts)
- Modify: flow.md **Results**

**Interfaces:**

- Produces: `node docs/features/skill-composition/measure.mjs [--since D] [--until D]`, which prints one row per run:
  `slug | conductor | sessions | m1 | m2 loaded/listed | missing`.
- Above the table it prints a **Limits** block:
  - m1 can't see Bash edits; it prints the number of Bash commands that look like edits next to it;
  - an early question excuses every later edit;
  - it compares against the whole plan text, not each task's Files list;
  - it doesn't count new public interfaces;
  - m2 uses today's `uses.json` and ignores order and optional skills;
  - runs before 2026-10-17 had no `uses.json`;
  - sessions that only read a flow.md are joined into its run.

Steps:

- [ ] Write the failing tests:
  - two fixture sessions that read the same `docs/features/demo/flow.md` form one run with 2 sessions;
  - m1 = 1: after the gate the run edits `a.ts` (named in `plan.md`), `b.ts` (unnamed, no question before it) and
    `c.ts` (unnamed, with an AskUserQuestion earlier in the build);
  - m2 = `1/2` with `grilling` missing: `uses.json` lists `writing-plans` and `grilling`, and only `writing-plans` is
    loaded (a Read of a path ending `/writing-plans/SKILL.md`, or a Skill call naming it).
- [ ] Run `node --test docs/features/skill-composition/measure.test.mjs`. Expected: FAIL.
- [ ] Implement:
  - read the main and `subagents/**` `.jsonl` files under `~/.claude/projects`;
  - a run is the `docs/features/<slug>/flow.md` its sessions read or write;
  - m1 is the number of files edited (Edit/Write) after the plan gate that the run's last-read `plan.md` doesn't name
    and that no AskUserQuestion came before;
  - m2 is loaded/listed against the conductor's current `uses.json`.
  - The plan gate is the first **dated** `Gate 2, plan approved: 20` line, since the templates pre-fill the undated
    one. Without that line, the gate is the first edit outside `docs/features/<slug>/`.
  - Edits under `docs/features/<slug>/` are never counted.
  - The skill-composition slug is excluded.
- [ ] Run the tests. Expected: PASS. The test is manual: `npm test` doesn't glob `docs/`.
- [ ] Run `measure.mjs --until 2026-10-23` before any later task touches `plugins/`. Paste the table, the Limits
      block, the command and the date into flow.md as the `baseline` row.

### Task 2: Vendor `principle-laziness-protocol`

**Files:** `scripts/sync-pstack.mjs:9-55` (move the name from `SKIPPED` to `SKILLS`), `.github/workflows/sync-pstack.yml:54`
(`-eq 19`), `THIRD_PARTY.md`.

- [ ] Run `node scripts/sync-pstack.mjs`. It pulls upstream HEAD, not the pin.
      Expected: `skills/principle-laziness-protocol/SKILL.md` contains "through types, schemas or pipelines".
- [ ] Record in flow.md what else changed upstream (`git diff --stat` on the pack, plus one line per changed skill).
- [ ] Run `npm test`. Expected: PASS.

### Task 3: Move the packs into flows

**Files:**

- `git mv plugins/shared/{superpowers,ponytail,mattpocock-picks,pstack-picks,tob-picks,paper-lookup}` to
  `plugins/flows/packs/`.
- Retarget each sync to the new path:
  - `scripts/sync-{mattpocock,pstack,tob,paper-lookup}.mjs`, `scripts/sync-release.mjs`;
  - their `.github/workflows/sync-*.yml` (`add-paths`, `jq`, the count checks);
  - `treefmt.toml:6-12`, `flake.nix` and `.pre-commit-config.yaml` excludes.
- `scripts/sync-tob.mjs`: a transform that rewrites `workflows/spec-compliance.js`'s `CHECKER`/`agentType`
  (`:364`, `:392`) to `general-purpose`, with the checker agent's text as the prompt.

- [ ] Each moved sync script still clears its target before writing (Review Focus 1). Run its test if it has one.
- [ ] Run `claude plugin validate plugins/flows`. Expected: passes.
  - Start a session with `claude --plugin-dir plugins/flows` and list its skills. Expected: only the conductors;
    nothing from `packs/` and no pack hooks (Review Focus 5).
  - Record both outputs in flow.md.
- [ ] Decide the packs' own `.claude-plugin/plugin.json`:
  - keep them (sync-release writes superpowers' and ponytail's), and make `release.mjs:46` and check-repo's version
    check include `plugins/flows/packs/*`;
  - or let the transforms drop them.

  This is the builder's call; record it under Rulings.

- [ ] Run `npm test`. Expected: PASS.

### Task 4: Marketplace, bundle, installer, flows wiring

**Files:**

- `.claude-plugin/marketplace.json`: remove the six entries and update flows' `description`.
- `plugins/default/.claude-plugin/plugin.json:10-18`: dependencies.
- `installer/core/plugins.ts:72`: `INCLUDED` becomes `['self-review']`.
- `installer/core/plugins.test.ts:30-55,63`, `installer/core/options.test.ts:24-31`: expectations.
- `installer/steps/plugins.ts` (`applyPlugins`): after it runs, read `claude plugin list --json` and record a failure
  naming any pack still installed (Review Focus 4). The pure check `stillInstalled(rows, packs)` goes in `core/plugins.ts`
  with a test.
- `scripts/flows-uses.mjs` and its test:
  - `packs(root)` lists `plugins/flows/packs/*`;
  - `checkUses` resolves a `uses.json` key that is a pack to its folder;
  - `expectedDeps` leaves packs out.
- `installer/install.ts:149`: comment that the flows default now keys on self-review only.

- [ ] Failing tests first:
  - `checkUses` accepts `{"superpowers": ["writing-plans"]}` with no marketplace entry and rejects
    `{"superpowers": ["nope"]}`;
  - `expectedDeps` omits packs;
  - `stillInstalled` returns the installed packs.
- [ ] Implement, run `node scripts/flows-uses.mjs`, then `npm test` and `npm run typecheck`. Expected: PASS, with the
      coverage floor held.

### Task 5: Override quote check

**Files:** `scripts/flows-uses.mjs` (`checkOverrides(root)`) with its test; `scripts/check-repo.mjs`; and
`sync-{mattpocock,pstack,tob,paper-lookup}.yml`, which each get a `node scripts/check-repo.mjs` step before the PR step
(their PRs trigger no other workflow, `sync-release.yml:28-29`).

**Interfaces:**

- Marker: `<!-- overrides <pack>/<path inside pack>: "<sentence>" -->` in any `plugins/flows/**/*.md` outside `packs/`.
- `checkOverrides(root): string[]` returns one problem per marker whose file is missing or whose sentence isn't found.

- [ ] Failing tests:
  - a found sentence passes;
  - a changed one fails, naming the file and line;
  - a sentence that wraps across lines with `**bold**` in the pack still matches (Review Focus 2).
- [ ] Implement, wire it in, and run `npm test`. Expected: PASS.

### Task 6: flow-rules and templates

**Files:**

- `plugins/flows/references/flow-rules.md`
- `references/build-template.md`, `feature-flow/references/flow-template.md`,
  `research-flow/references/research-template.md`

Each section below carries markers for the pack sentences it overrides.

- **Loading skills:**
  - the pack rules from Global Constraints;
  - the existing `${CLAUDE_SKILL_DIR}` glob, kept for installed plugins such as self-review;
  - tob's spec-compliance workflow through the Workflow tool's path form (the builder confirms the parameter name).
- **A missing piece:** the five pack rows collapse into one ("a pack file is missing: flows is broken, reinstall it").
- **Deviations:** extend the existing bullet.
  - **The fifth stop:** a deviation-class decision is never ruled. The coordinator records it under **Deviations** and
    asks the owner with AskUserQuestion. This overrides SDD's "Continuous execution" and "Rulings, not stalls" (with
    markers).
  - **The brief clause:** deviation classes, the laziness line and the task's Files list, pasted into every
    implementer and task-review prompt.
  - **The files check:**
    - record each task's base SHA in flow.md when the task starts;
    - after the task, run `git diff --name-only <base>` (working tree included) and `git ls-files -o --exclude-standard`;
    - compare the result with the task's Files list; an extra file is a deviation.
  - **Rulings:** every other call the build makes alone is one line under **Rulings**, written as it is made.
- **ponytail at chosen steps:** a table from spec goal 3, with the rule text read from
  `<packs>/ponytail/skills/ponytail/SKILL.md`. TDD wins over the no-test-for-trivial rule.
- **Stack packs:** `*.csproj` → the matching csharp router, `Cargo.toml` → rust-best-practices, SQL migrations →
  postgres-database-migration, a web frontend → hallmark. Only these go into the briefs.
- **Homes and commits:** override brainstorming's and writing-plans' paths and commits (markers).
- **Templates:** add **Rulings**, and a **Verdict** line at Finish (the owner: worked as a whole y/n, clean y/n). Old
  runs get both added (Review Focus 3).

- [ ] Write it, then run `npm test`. Expected: PASS, with every marker found.

### Task 7: Design and build conductors

**Files:** `SKILL.md` and `uses.json` of feature-flow, research-flow, implement, fix-flow, upgrade and harden;
`feature-flow/references/plan-review.md`.

Each SKILL.md:

- states the packs folder;
- names its step owners from `skill-map.md` (drop any whose path doesn't exist, with a Rulings line);
- carries markers.

Changes per conductor:

- **feature-flow, research-flow:**
  - Brainstorm and Grill ask the seam question (where each cross-cutting concern is resolved and which modules never
    see it) using `codebase-design`, `principle-boundary-discipline` and `principle-redesign-from-first-principles`;
  - Plan copies each answer verbatim into Global Constraints;
  - Execute runs the build stop;
  - plan-review's Simpler angle is `ponytail-review`.
- **implement:** Read asks the seam question when the input doesn't answer it; the Gate reads back the Files lists;
  Execute runs the build stop.
- **fix-flow:** `uses.json` names `systematic-debugging`, and the text points at its `defense-in-depth.md`, used only
  when picked at the Cause gate; Fix runs the build stop.
- **upgrade:** Impact plans with `writing-plans`; with more than two affected areas, Bump runs implement's Execute.
- **harden:** the architecture pass adds `principle-boundary-discipline`; Fix runs the build stop.

- [ ] Edit, run `node scripts/flows-uses.mjs`, then `npm test`. Expected: PASS.

### Task 8: Check and learn conductors, duplicates

**Files:** `SKILL.md` and `uses.json` of verify, test-audit, doc-audit, understand and learn;
`plugins/shared/self-review/skills/self-review/SKILL.md` (hand-written).

- **verify:**
  - runs the suite once and reuses the output;
  - passes self-review's pr-test-analyzer report to test-audit;
  - adds a **Decisions** row to its verdict: Rulings, Deviations, and new `shortcut:` lines
    (`git diff <base> | rg '^\+.*shortcut:'`), each confirmed or reopened by the owner.
- **learn:** reads Rulings.
- **doc-audit, test-audit, understand:** owners from the skill map.
- **Skill writing:** writing-skills owns it; skill-creator is used only for its eval tooling.
- **self-review:** its fix step offers /fix-flow for findings that need a cause.

- [ ] Edit, run `node scripts/flows-uses.mjs`, then `npm test`. Expected: PASS.

### Task 9: `/integrate` and the vendor checklist

**Files:** `plugins/flows/skills/integrate/{SKILL.md,uses.json}`, `docs/vendor-a-pack.md`.

**integrate** (dmi), phases `commit | pr | ci | done`:

1. **Commit:** reuse /verify's result when the caller's flow.md has one, otherwise run the checks fresh. Show the
   commits before making them.
2. **PR:** write a short body inline (why, what, blast radius from `blast-radius`, verification), then pass it through
   `unslop`. **Gate:** title and body. Push and `gh pr create` go to the owner as `!` lines.
3. **CI:** `Monitor` on `gh pr checks`. A red check runs `systematic-debugging`, then stops with the cause and options.
   Never push.

**vendor-a-pack.md:** the touch-point checklist:

- `sync-lib.mjs`, `sync-*.yml`, the transform;
- `plugins/flows/packs/` or a marketplace entry;
- THIRD_PARTY.md, CLAUDE.md, `flake.nix`, `treefmt.toml`, `.pre-commit-config.yaml`;
- check-repo, READMEs, `uses.json`, markers.

- [ ] Write, run `node scripts/flows-uses.mjs`, then `npm test`. Expected: PASS.

### Task 10: Docs

**Files:**

- `README.md`: drop the `/plugin install` route and explain the packs;
- `CLAUDE.md`:
  - Layout: `plugins/flows/packs/`, plus a note that nothing there loads;
  - the quote check under Checks;
  - the "Vendored content" paths;
- `plugins/flows/README.md`, `plugins/default/README.md`, `THIRD_PARTY.md`.

- [ ] Edit, check every named path exists, then run `npm test` and `nix fmt`. Expected: PASS, with no diff after
      formatting.

### Task 11: Final measurement and the owner's verdict

- [ ] The owner merges and cuts a release (`npm run release -- patch`, then `! git push --follow-tags origin main`).
      The installer pins the marketplace to its own release tag (`installer/core/release.ts:10`), so a branch build would
      install the old flows.
- [ ] The owner runs that release's installer. Then `claude plugin list --json` must show no pack installed and flows
      at the new version.
- [ ] The owner runs conductors on real work, as many runs as they decide. Each run's flow.md **Verdict** line is
      filled in at Finish.
- [ ] Run `measure.mjs --since <install date>`, the same script on the same machine, and put it under **Results** as
      the `feature` row with the Limits block. The m2 change is reported as is, with no paper number to compare against.
- [ ] Record the owner's verdict (supported, not supported or inconclusive), the threats that showed up, and the
      keep/iterate/revert decision.
