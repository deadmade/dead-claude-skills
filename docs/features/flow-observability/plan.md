# Flow cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only desktop window (flow-cockpit) that shows every flow run, audit and loose Claude session of a
project, built from readable flow.md and plan.md files, the transcripts, and a small capture written by hooks.

**Architecture:** The flows' templates and conductor text gain a small format contract (`now:`, numbered Gates,
`###` decisions with `Picked:`, `###` deviations with `Status:`, `Does:`/`Depends on:` per plan task, `Picks:`/`Fixed`
in audits). A Cargo workspace `crates/flow-cockpit` holds a pure core library (parsers, transcripts, project index)
and a Tauri 2 app. The app serves its own runtime and building blocks from `app/shell/` and hands TypeScript views
their stripped source over IPC. An opt-in plugin `flow-cockpit` holds the views skill (slice 1) and capture hooks for
"waiting on you" (slice 2).

**Tech Stack:** Rust 2024 edition; `tauri` 2.12.5, `tauri-build` 2.7.4; `ts-rs` 12.0.1; `serde`, `serde_json`; `toml`;
`jiff` (as in web-mcp) for time; `include_dir` for the embedded views; `oxc_parser`, `oxc_transformer`, `oxc_codegen`,
`oxc_semantic`, `oxc_allocator`, `oxc_span` pinned `=0.156.0` (only those used directly); vendored `marked` 18.1.2
(`lib/marked.esm.js`), `dompurify` 3.4.17 (`dist/purify.es.mjs`), `mermaid` 12.2.0 (`dist/mermaid.min.js`, a classic
script); `jsdom` as a devDependency for the views tests; stdlib Node 26 for the hooks; Nix
(`rustPlatform.buildRustPackage`, `wrapGAppsHook3`, `pkg-config`, `webkitgtk_4_1`, `gtk3`, `libsoup_3`, `librsvg`).

**Spec:** [spec.md](spec.md). Background and decisions: [flow.md](flow.md). ADR: `docs/adr/0005-flow-cockpit-outside-claude-code.md`.

## Global Constraints

- The document format (flow.md, plan.md, audit reports): resolved in the core's document parser; never seen by the
  views (they get the typed model plus raw Markdown for unrecognised parts) or by capture.
- Which Claude session belongs to which flow run, and status: resolved in the core's run index; never seen by capture
  (it records session facts only) or by the views.
- Project identity (several checkouts, worktrees): resolved in the core's project index; the views see a project id
  and name.
- Claude Code's formats (hook payloads, transcript JSONL): resolved in capture (payload to event line) and in the
  core's transcript reader; never seen by the views.
- Untrusted text to HTML: resolved in the views' shared Markdown block (sanitiser); the core emits text, never HTML;
  individual views never inject raw HTML from data.
- Types across Rust and TypeScript: resolved in the generated `.d.ts`; never written by hand in a view.
- Every type that crosses to the views derives `TS` (no `#[ts(export)]`). One `#[ignore]`d test per crate,
  `export_bindings`, writes them all to `crates/flow-cockpit/bindings/`; `bindings_are_current` exports to a temp
  folder and compares, ignoring line endings. A task that adds or changes such a type regenerates and commits them.
- One version for everything: the plugin's `plugin.json`, `[workspace.package] version` in
  `crates/flow-cockpit/Cargo.toml`, and every workspace package's entry in `crates/flow-cockpit/Cargo.lock`.
- The app writes nothing anywhere (the user edits `config.toml` by hand). The hooks write only capture files.
- Hooks are `async: true`, print nothing, exit 0 on every error.
- Capture files: `$XDG_STATE_HOME/flow-cockpit/capture/<session_id>.jsonl` (default `~/.local/state/...`) on Linux,
  `%LOCALAPPDATA%\flow-cockpit\capture\<session_id>.jsonl` on Windows; the folder `0700`, files `0600` where the OS has
  modes; files older than 30 days deleted by the SessionStart hook.
- Views and config: global `~/.config/flow-cockpit/views/` and `config.toml` (`%APPDATA%\flow-cockpit\` on Windows);
  per repository `.flow-cockpit/views/`, loaded only for repositories listed under `trusted` in `config.toml`.
- The runtime, the building blocks, the vendored libraries and `tokens.css` live in `app/shell/` and load from
  `'self'`: JavaScript modules with JSDoc types, checked by `tsc --checkJs` against `app/shell/api.d.ts`. Views are
  TypeScript, reach the window only as source text from `view_source`, and are imported from a
  `Blob([src], { type: 'text/javascript' })` URL that is revoked after import. A view gets everything through `ctx`;
  only `import type` is allowed in a view, a value `import` is a load error naming the line. The shell has no inline
  `<style>` or `<script>`.
- `now:` starts with `Waiting for you` at every stop where a conductor waits for the user; that prefix is what the
  status reads.
- Vendored packs (`plugins/flows/packs/`, `plugins/flows/agents/`) are never edited. Vendored view libraries
  (`crates/flow-cockpit/app/shell/vendor/`) and generated bindings (`crates/flow-cockpit/bindings/`) are excluded from
  treefmt and end-of-file-fixer and kept LF by `.gitattributes`.
- The views tests (jsdom) run only in `flow-cockpit.yml` after `npm ci`, never in `npm test` or the pre-commit hook.
- The installer keeps no runtime npm dependencies and only erasable TypeScript syntax; programs start through
  `system/proc.ts`.
- Rust tasks load the `rust-skills:rust-best-practices` skill; view tasks load `hallmark:hallmark` (app scope) and
  keep `sloplint --scope app` clean.
- Commit messages are one sentence, no co-author lines; stage with `git add -u` plus new paths by name.
- Before you write: Read the task and the code it touches. List every place your change must reach: callers, tests,
  fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers
  that stop working. That is scope. Extra features are not.

## Review Focus

1. **Real flow.md files in every old shape load without error:** no frontmatter, CRLF line endings, `<date>`
   placeholders, wrapped and `Reopened` Gate lines, numbered or `**D1 –**` deviations. Pinned by
   `parses_every_flow_md_in_repo` in Task 2.
2. **Transcripts and captures are read while being written:** a half-written last line never fails a read; parallel
   hook processes never interleave a line, at the largest line size. Pinned by `ignores_partial_last_line` (Task 3)
   and `parallel_appends_stay_whole` (Task 10).
3. **Large history doesn't freeze the window:** 1,100+ transcripts, some tens of megabytes. Pinned by
   `second_link_scan_reads_under_2mb` (Task 4) and `first_paint_before_link_scan` (Task 6).
4. **A broken view** (syntax error, a value `import`, throws, missing export) shows its error in its own place; the
   built-in for that id and the other views keep working. Pinned by `broken_view_falls_back` (Task 7).
5. **Untrusted text never runs:** script tags, event handlers and `javascript:` links in transcript or document text
   are stripped before display; a repository's views load only when trusted. Pinned by
   `markdown_strips_script_and_handlers` (Task 7) and `untrusted_repo_views_ignored` (Task 12).

---

## Slice 1

### Task 1: The format contract in the flows

**Does:** Makes every new flow run write a `now:` line, numbered gate lines, `###` decisions and deviations, a plain
purpose and dependencies for each plan task, and audit picks and fixes, and makes check-repo fail when one goes missing.
**Depends on:** none

**Files:**

- Modify: `plugins/flows/skills/feature-flow/references/flow-template.md`,
  `plugins/flows/skills/research-flow/references/research-template.md`, `plugins/flows/references/build-template.md`
- Modify: `plugins/flows/references/flow-rules.md` (State :13-18, Gates :36-37, the fifth stop :46-47, Calling another
  conductor :132, Reports :201-211, one diagram line), `plugins/flows/skills/feature-flow/SKILL.md` (:28, Phase 2
  Options :67-70, Phase 4 :106-111), `plugins/flows/skills/implement/SKILL.md` (plan input :42-47, Gate :49-51),
  `plugins/flows/skills/fix-flow/SKILL.md` (Gate :48), `plugins/flows/skills/upgrade/SKILL.md` (plan :38, Gate :39-40)
- Modify: `scripts/flows-uses.mjs` (new `checkTemplates`), `scripts/check-repo.mjs:63`, `scripts/flows-uses.test.mjs`

**Interfaces:**

- Produces: `export function checkTemplates(root: string): string[]`; the template shapes below (Task 2 parses them).

- [ ] **Step 1: Write the failing tests** in `scripts/flows-uses.test.mjs`:
      `checkTemplates on the real repo returns []`; one fixture test per missing part, each asserting one problem string naming the file: `now:` in a template's
      frontmatter, the `Waiting for you` rule in flow-rules State, the Gates line shape (`- Gate <n>, <what>:` in the
      comment), `Picked:`, `Status:`, `**Does:**` and `**Depends on:**` in feature-flow, implement and upgrade
      SKILL.md, `Picks:` and `Fixed` in flow-rules Reports.
- [ ] **Step 2:** `node --test scripts/flows-uses.test.mjs`; expect FAIL (`checkTemplates is not a function`).
- [ ] **Step 3: Templates.** In all three: `now: <one plain sentence: where the run stands and what comes next>`
      after `phase:`; `## Gates` with a comment giving `- Gate <n>, <what>: <date>[, <extra>]`, the date empty while
      open (replace the `<date>` placeholders), a reopening appended as `Reopened <date>: <why>`; `## Options` (added to
      build-template) with `### <decision>` then `Picked: <the choice in plain words>`; `## Deviations` with
      `### <deviation>` then `Status: open` or `Status: decided <date>: <what>`.
- [ ] **Step 4: Conductor text.** flow-rules State: the conductor rewrites `now:` after every phase and at every stop
      where it waits for the user, and at such a stop it starts with `Waiting for you`; a flow.md without `now:` gets it
      when resumed (next to the Tasks/Rulings sentence); a conductor called inline writes into its caller's `now:`.
      Gates: the line shape. Fifth stop: `### <deviation>` with `Status: open`, then `Status: decided <date>: <what>`.
      Reports: `Picks: <finding numbers> | none` and `Fixed <date>: <number>` per pick once its check passes.
      feature-flow :28 adds `now:`; Phase 2 Options: `###` with `Picked:`; Phase 4, implement's plan input (next to the
      Files rule) and upgrade's plan line: every task gets
      `**Does:** <one plain sentence for a reader who doesn't know the code>` and `**Depends on:** Task <n>, … | none` right below its heading. implement, fix-flow and upgrade name
      their gate lines (`- Gate 1, <what>: <date>`). One line in flow-rules: "The user reads specs, plans and flow.md in
      the flow cockpit, which draws Mermaid: use a diagram where it explains something better than prose; never
      required." No `overrides` marker is needed.
- [ ] **Step 5: Implement `checkTemplates(root)`;** spread it into `check-repo.mjs:63`.
- [ ] **Step 6:** `npm test`; expect PASS (`checkOverrides` included).
- [ ] **Step 7:** Commit: `Give flow.md, plans and audits a format the flow cockpit can read.`

### Task 2: The core crate and the document parsers

**Does:** Creates the Rust core that turns flow.md, plan.md, audit reports and SDD build logs into typed data, old
shapes included.
**Depends on:** Task 1

**Files:**

- Create: `crates/flow-cockpit/Cargo.toml` (`[workspace] members = ["core"]`, `[workspace.package] version` and
  edition 2024), `crates/flow-cockpit/Cargo.lock`, `crates/flow-cockpit/core/Cargo.toml` (package
  `flow-cockpit-core`; `serde`, `ts-rs`), `core/src/lib.rs`, `core/src/doc/{mod,flow,plan,audit,ledger}.rs`,
  `core/src/bindings.rs` (`export_bindings`, `bindings_are_current`), `core/tests/fixtures/docs/` (the three templates
  filled in; real old flow.md files: click-to-read, cyberpunk-theme, language-skills, web-mcp, web-mcp-search,
  flow-pane, agent-browser-pr-review-fixes; web-mcp's build-log excerpt; an audit report in the new shape and one
  without `Picks:`), `crates/flow-cockpit/bindings/` (generated, committed)
- Modify: `scripts/check-repo.mjs:94-101` (`CRATES` gains `crates/flow-cockpit` with lock name `flow-cockpit-core`),
  `scripts/release.mjs` (the crate list), `treefmt.toml` and `flake.nix` `vendored` (exclude
  `crates/flow-cockpit/bindings/`), `.gitattributes` (`crates/flow-cockpit/bindings/** eol=lf`)

**Interfaces (all `#[derive(Serialize, TS)]`):**

- `pub fn parse_flow(text: &str) -> FlowDoc`;

  `FlowDoc { flow: Option<String>, phase: Option<String>, now: Option<String>, title: Option<String>, gates: Vec<Gate>, decisions: Vec<Decision>, deviations: Vec<Deviation>, sections: Vec<Section> }`; `Gate { n: u8, what: String, approved: Option<String>, reopened: bool, raw: String }`;
  `Decision { title: String, picked: Option<String>, body: String }`;
  `Deviation { title: String, status: DeviationStatus, body: String }`;
  `DeviationStatus = Open | Decided { date: Option<String>, what: String } | Unknown`; `Section { heading: String, markdown: String }`.

- `pub fn parse_plan(text: &str) -> PlanDoc`; `PlanDoc { title: Option<String>, tasks: Vec<PlanTask> }`;
  `PlanTask { n: u32, title: String, does: Option<String>, depends_on: Option<Vec<u32>>, markdown: String }`
  (`None` = not written, `Some(vec![])` = `none`).
- `pub fn parse_audit(text: &str) -> AuditDoc`;
  `AuditDoc { scope: Option<String>, findings: Vec<Finding>, picks: Option<Vec<u32>>, fixed: Vec<u32>, open: Option<bool> }` (`open: None` without a `Picks:` line);
  `Finding { n: u32, severity: String, location: String, text: String }`.
- `pub fn parse_ledger(text: &str) -> Ledger`;
  `Ledger { plan: Option<String>, tasks: Vec<LedgerTask>, rulings: Vec<String> }`;
  `LedgerTask { n: u32, state: TaskState, fix_rounds: u32, security: Vec<String>, later: Vec<String>, story: Vec<String>, model: Option<String> }`; `TaskState = NotStarted | Building | Review | Waiting | Done`.

- [ ] **Step 1: Write the failing tests:** `flow_reads_now_and_numbered_gates`; `gate_without_date_is_open` (empty
      and `<date>`); `gate_reopened_without_reapproval_is_open` and `gate_reopened_then_reapproved` (the removed band's
      rule: the last date counts only if it comes after the last "reopened"); `decisions_read_picked`;
      `deviation_status_open_and_decided`; `old_deviation_shapes_are_unknown_not_lost`; `missing_frontmatter_is_none`;
      `crlf_is_read`; `plan_reads_does_and_depends`; `ledger_joins_wrapped_lines`;
      `ledger_counts_fix_rounds_and_security` (web-mcp excerpt → task 5: 2 fix rounds); `audit_reads_picks_and_fixed`
      (open while a pick lacks `Fixed`); `audit_without_picks_is_unknown`; `parses_every_flow_md_in_repo` (walks
      `docs/features/*/flow.md` from the repo root: no panic, `phase` read where present);
      `templates_parse_with_every_part`; `bindings_are_current`.
- [ ] **Step 2:** `cargo test -p flow-cockpit-core` in `crates/flow-cockpit`; expect FAIL.
- [ ] **Step 3: Implement** the parsers line by line: frontmatter as flat `key: value` lines between the first two
      `---` (no YAML crate); sections split on `## `; `###` entries inside Options and Deviations; `<!-- -->` stripped.
      No input panics. Generate the bindings with `cargo test -p flow-cockpit-core export_bindings -- --ignored`.
- [ ] **Step 4:** `cargo test -p flow-cockpit-core`,
      `cargo clippy -p flow-cockpit-core --all-targets -- -D warnings`, `npm test`; expect PASS, and `git status` shows no untracked file outside this task's list.
- [ ] **Step 5:** Commit: `Add the flow cockpit core with parsers for flow runs, plans, audits and build logs.`

### Task 3: Activity from transcripts

**Does:** Lets the core show what a Claude session and each of its subagents did, turn by turn, from the transcripts.
**Depends on:** Task 2

**Files:**

- Create: `core/src/activity/{mod,transcript}.rs`, `core/tests/fixtures/transcripts/` (trimmed real main and subagent
  transcripts with their `.meta.json`, one ending in a half line)
- Modify: `core/Cargo.toml` and `crates/flow-cockpit/Cargo.lock` (`serde_json`), `core/src/lib.rs`,
  `core/src/bindings.rs`, `crates/flow-cockpit/bindings/`

**Interfaces (crossing types derive `TS`):**

- Produces: `pub fn read_transcript(main: &Path) -> Transcript` (subagents from `<session>/subagents/agent-*.jsonl`
  and their `.meta.json`); `pub fn activity(t: &Transcript) -> Activity`;
  `Activity { turns: Vec<Turn>, agents: Vec<AgentInfo>, live: Live }`; `Turn { prompt: Option<Text>, replies: Vec<Text>, tools: Vec<ToolCall> }`;
  `Text { at: String, text: String }`;
  `ToolCall { id: String, at: String, agent: Option<String>, tool: String, summary: String, detail: ToolDetail, failed: bool }`;
  `ToolDetail = Edit { file, old, new } | Write { file, content } | Command { command, description: Option<String> } | Other { json }`;
  `AgentInfo { id, description: Option<String>, kind: Option<String>, model: Option<String>, started: Option<String>, ended: Option<String> }`;
  `Live { waiting: Option<String> }` (always `None` until Task 11). `Transcript` is internal.

- [ ] **Step 1: Write the failing tests:** `ignores_partial_last_line`; `skips_unknown_entries`;
      `turns_group_by_prompt`; `tool_results_mark_failures`; `subagent_tools_carry_agent`; `edit_detail_has_old_and_new`;
      `thinking_blocks_are_skipped` (empty thinking never becomes a reply).
- [ ] **Step 2:** `cargo test -p flow-cockpit-core activity`; expect FAIL.
- [ ] **Step 3: Implement.** A user entry with string content not starting with `<` opens a turn. Regenerate bindings.
- [ ] **Step 4:** Tests (`bindings_are_current` included) and clippy PASS.
- [ ] **Step 5:** Commit: `Read transcripts into turns, tool calls and agents.`

### Task 4: Projects, entries and status

**Does:** Finds the user's projects and, per project, its flow runs, audits and loose sessions with their status.
**Depends on:** Task 2, Task 3

**Files:**

- Create: `core/src/index/{mod,projects,entries,status,links,config}.rs`, `core/tests/fixtures/home/` (a fake
  `~/.claude/projects` with two checkouts of one repo, a `.claude/worktrees/x` and a `.worktrees/y` no session ran in,
  a `docs/audits/` report, transcripts, and a `config.toml`)
- Modify: `core/Cargo.toml` and `crates/flow-cockpit/Cargo.lock` (`toml`, `jiff`), `core/src/lib.rs`,
  `core/src/bindings.rs`, `crates/flow-cockpit/bindings/`

**Interfaces (crossing types derive `TS`):**

- Produces: `pub struct Index` with `pub fn build(home: &Home, config: &Config, now: jiff::Timestamp) -> Index` (no
  link scan), `pub fn scan_links(&mut self, cache: &mut LinkCache)`,
  `pub fn rebuild_project(&mut self, id: &str, now: jiff::Timestamp)`, `projects(&self) -> Vec<Project>`, `entries(&self, project: &str) -> Vec<Entry>`,
  `flow_run(&self, project: &str, slug: &str) -> Option<FlowRun>`,
  `doc(&self, project: &str, slug: &str, name: DocName) -> Option<String>`, `session(&self, id: &str) -> Option<Activity>`.
- `Home { claude_projects: PathBuf, capture_dir: PathBuf }`; `Config { trusted: Vec<PathBuf>, hidden: Vec<String> }`
  from `config.toml`; `LinkCache` keyed by (path, size, mtime), in memory.
- `Project { id, name, roots: Vec<PathBuf> }`;
  `Entry = FlowRun(FlowRunSummary) | Audit(AuditSummary) | Loose(SessionSummary)`;
  `FlowRunSummary { slug, conductor, phase, now: Option<String>, status: Status, gates: Vec<Gate>, open_deviations: u32, progress: Option<(u32, u32)>, last_activity: String, copies: u32 }`;

  `AuditSummary { file: String, date: String, conductor: String, scope: Option<String>, findings_by_severity: Vec<(String, u32)>, open: Option<bool> }`;
  `SessionSummary { id: String, started: String, last_activity: String, first_prompt: Option<String> }`; `Status = Working | Waiting | Idle | Stale | Done`;
  `FlowRun { summary, flow: FlowDoc, plan: Option<PlanDoc>, ledger: Option<Ledger>, sessions: Vec<String> }`; `DocName = Flow | Spec | Plan`.

- [ ] **Step 1: Write the failing tests:** `folds_checkouts_by_remote` (same `origin` url in `.git/config`);
      `folds_by_folder_name_without_remote`; `finds_worktrees_without_sessions` (`.claude/worktrees/*`, `.worktrees/*`,
      `.git/worktrees/*/gitdir`); `hidden_project_is_left_out`; `newest_copy_wins`; `finds_audits_with_picks_state`;
      `session_links_by_editing_flow_md` (after `scan_links`); `mention_does_not_link`; `status_rules` (a table: `now:`
      starting `Waiting for you` → Waiting; done → Done; 4 days quiet → Stale; transcript grew 1 minute ago → Working;
      else Idle); `loose_sessions_only_last_7_days`; `rebuild_project_touches_one_project`;
      `second_link_scan_reads_under_2mb` (a 50 MB transcript generated in the test: the first `scan_links` may read it,
      a second with the same `LinkCache` reads under 2 MB).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.** Project identity from `.git/config` `[remote "origin"] url`, else the folder name; no
      `git` process. A session's cwd from the first `cwd` field in its first 40 lines. Links from Edit/Write tool inputs
      whose path ends in `docs/features/<slug>/flow.md`. Regenerate bindings.
- [ ] **Step 4:** Tests and clippy PASS.
- [ ] **Step 5:** Commit: `Index projects, flow runs, audits and loose sessions with their status.`

### Task 5: Design checkpoint: the flow run view

**Does:** Shows the user a clickable mockup of the flow run view built from this run's own documents in the new
format, and stops until they approve it; the approved page is what the real view is ported from.
**Depends on:** Task 2

**Files:**

- Modify: `docs/features/flow-observability/flow.md` (rewritten into the new format; content kept)
- Create: `core/tests/dump_this_run.rs` (an `#[ignore]`d test writing this run's `FlowDoc`, `PlanDoc` and `Ledger`
  JSON to the design folder), `crates/flow-cockpit/design/run-view.html` and its JSON (kept as the reference for Task 8)

- [ ] **Step 1:** Rewrite this run's flow.md into the new format; `parses_every_flow_md_in_repo` still passes.
- [ ] **Step 2:** Build the mockup with hallmark (app scope, Night City tokens): the `now:` header, the phase stepper
      with gates, task cards from plan.md (`Does:`, state, problems, the dependency graph in Mermaid), decisions,
      deviations, docs. Sentences, not log lines; detail one click away.
- [ ] **Step 3:** Stop. Show the user the mockup; record their decision under Options (`### Flow run view`,
      `Picked: …`). Changes they ask for go into this file before Task 8 starts.
- [ ] **Step 4:** Commit: `Add the approved flow run view design.`

### Task 5b: Typed rulings, phases and deferred items in the core

**Does:** Moves the three bits of document format the approved mockup still reads itself into the core, so the views
get typed data only (Global Constraint 1): the Rulings list, each conductor's phases with their gates, and the
`minor (deferred):` tag.
**Depends on:** Task 2, Task 5
**Added:** 2026-10-29, by the user's decision "The approved mockup reads document format in the view".

**Files:**

- Modify: `core/src/doc/flow.rs`, `core/src/doc/ledger.rs`, `core/src/doc/mod.rs`, `core/tests/docs.rs`,
  `core/src/bindings.rs`, `crates/flow-cockpit/bindings/`
- Create: `core/src/doc/phases.rs` (the conductors' phase lists)
- Modify: `crates/flow-cockpit/design/run-view.html` and the design JSON (re-dumped with
  `cargo test -p flow-cockpit-core --test dump_this_run -- --ignored`): the page reads the new fields and its own
  `PHASES` table, `untag()` and Rulings parsing are removed; nothing else on the page changes (it is approved).

**Interfaces (all `#[derive(Serialize, TS)]`, no `#[ts(export)]`):**

- `Ruling { date: Option<String>, scope: Option<String>, call: String, why: Option<String>, cost: Option<String>, raw: String }`.
  Shapes, read from real files: flow.md's `## Rulings` bullets `- <date>, <scope>: <call> — <why> — costs <cost>`
  (wrapped with a two-space indent), and the build log's `Ruling: <call> — <why> — costs <cost>`. Anything that
  doesn't split keeps `call` = the whole text and the parts `None`; `raw` is always the joined original.
- `FlowDoc` gains `rulings: Vec<Ruling>` and `phases: Vec<Phase>`.
- `Ledger.rulings` becomes `Vec<Ruling>` (same parser).
- `Phase { key: String, name: String, state: PhaseState, gate_after: Option<u8> }`;
  `PhaseState = Done | Now | Later`. Built in `parse_flow` from the `flow:` and `phase:` frontmatter and the
  conductor's phase list in `phases.rs`; `gate_after` is the gate number that follows that phase, taken from the
  conductor's list; an unknown conductor or phase gives an empty list (never a panic, never a guess).
- `LedgerTask.later` holds the item text without its `minor (deferred):` (or `minor:`) tag.
- Phase lists: one per conductor that writes a flow.md (`flow:` values in the templates and the SKILL.md files under
  `plugins/flows/skills/`): its phases in order, the `phase:` key each one writes, its display name, and where its
  gates sit, taken from each conductor's SKILL.md phase table and flow-rules. A test reads each conductor's SKILL.md
  phase table and fails when `phases.rs` no longer matches it.

- [ ] **Step 1: Write the failing tests:** `rulings_split_into_parts` (flow.md shape, wrapped); `ledger_rulings_are_typed`;
      `unsplittable_ruling_keeps_raw`; `phases_follow_the_conductor` (feature flow at `phase: execute` → earlier
      phases Done, Build Now, later Later; gates after Grill and Evaluate); `unknown_conductor_has_no_phases`;
      `phase_lists_match_skill_tables`; `deferred_items_lose_their_tag`. `parses_every_flow_md_in_repo` stays green.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement**; regenerate bindings; re-dump the design JSON; switch the page to the new fields.
- [ ] **Step 4:** `cargo test -p flow-cockpit-core`, clippy `--all-targets -D warnings`, `npm test`; open the page
      headless and compare Build, Decisions and Docs against the approved screenshots: no visible change.
- [ ] **Step 5:** Commit: `Give the core typed rulings, conductor phases and deferred items.`

### Task 6: The Tauri app shell

**Does:** Opens the window and gives views read-only access to the core's data and to their own code, refreshed when
files change.
**Depends on:** Task 4

**Files:**

- Create: `crates/flow-cockpit/app/Cargo.toml` (package `flow-cockpit`; `tauri`, `tauri-build`, `include_dir`, the oxc
  crates, `flow-cockpit-core`), `app/build.rs`, `app/tauri.conf.json`, `app/capabilities/default.json`
  (`"windows": ["main"]`, `"permissions": ["core:default"]`), `app/icons/` (`icon.png`, `icon.ico`, generated once from
  the mascot PNG that `scripts/draw-mascot.mjs` writes, committed),
  `app/src/{main,commands,poll,strip,views,paths, bindings}.rs`, `app/shell/index.html`, `app/shell/boot.js`, `app/views/builtin/.gitkeep`
- Modify: `crates/flow-cockpit/Cargo.toml` (`members = ["core", "app"]`), `crates/flow-cockpit/Cargo.lock`,
  `scripts/check-repo.mjs` and `scripts/release.mjs` (lock name `flow-cockpit` added), `.gitignore`
  (`crates/flow-cockpit/app/gen/`), `crates/flow-cockpit/bindings/`

**Interfaces:**

- Consumes: Task 4's `Index` and types.
- Produces (Tauri commands, read-only): `projects()`, `entries(project)`, `flow_run(project, slug)`,
  `doc(project, slug, name)`, `session(id)`, `views() -> Vec<ViewInfo>` with
  `ViewInfo { id, source: Builtin | Global | Repo, replaced: bool }` (derives `TS`), `view_source(id) -> Result<String, String>` (types stripped; the error names the
  line). Events: `changed { project: Option<String> }`, `views-changed {}`.
- `flow-cockpit --version` prints `flow-cockpit <version>`; `--print-view <id>` prints a built-in's TypeScript;
  `--print-types` prints `api.d.ts` and the bindings as one declaration file.
- `pub fn capture_dir(env, platform) -> PathBuf` and `pub fn config_dir(env, platform) -> PathBuf` in `paths.rs`;
  `paths_match_capture_rules` defines the cases (XDG_STATE_HOME set and unset, LOCALAPPDATA) that Task 10 mirrors.

- [ ] **Step 1: Write the failing tests:** `strip_keeps_es_syntax` (optional chaining, class fields, `export default`
      stay; annotations, `interface`, `import type` go); `value_import_is_an_error` (names the line);
      `strip_reports_syntax_errors`; `view_lookup_order` (global replaces built-in and is marked `replaced`);
      `print_view_prints_builtin`; `poll_emits_once_per_change` (10 writes within one 2 s interval → one `changed`);
      `poll_sees_folders_created_later`; `first_paint_before_link_scan`; `paths_match_capture_rules`;
      `bindings_are_current` (app types).
- [ ] **Step 2:** `cargo test -p flow-cockpit`; expect FAIL.
- [ ] **Step 3: Implement.** `tauri.conf.json`: `identifier: "dev.deadmade.flow-cockpit"`, `frontendDist: "shell"`,
      `withGlobalTauri: true`, `bundle.active: false`, one window labelled `main` titled "Flow cockpit", CSP

      `default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost`. `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`;
      `--version`, `--print-view` and `--print-types` write to the inherited std handles and call `AttachConsole` only
      when those are invalid, so a pipe still reads them. Built-ins embedded with
      `include_dir!("$CARGO_MANIFEST_DIR/views/builtin")`. A poll thread stats, every 2 s, the Claude projects folder,
      the capture folder, each project's `docs/` and `.superpowers/sdd/`, and the views folders, checking each tick
      whether they exist; it calls `rebuild_project` for changed projects and runs `scan_links` after the first
      `entries` answer.

- [ ] **Step 4:** Tests and `cargo clippy --all-targets -- -D warnings` PASS (on Linux inside
      `nix shell nixpkgs#pkg-config nixpkgs#webkitgtk_4_1 nixpkgs#gtk3 nixpkgs#libsoup_3` until Task 9 adds the dev shell).
- [ ] **Step 5:** `cargo run -p flow-cockpit` opens a window titled "Flow cockpit"; `--version` prints the version
      through a pipe.
- [ ] **Step 6:** Commit: `Add the flow cockpit window with read-only commands and view loading over IPC.`

### Task 7: The view runtime and shared blocks

**Does:** Lets views be plain TypeScript files the window loads, replaces and reloads, with shared, sanitised building
blocks so no view handles raw HTML.
**Depends on:** Task 5, Task 6

**Files:**

- Create: `app/shell/runtime.js`, `app/shell/api.d.ts`, `app/shell/blocks/{markdown,mermaid,diff,stepper,card}.js`,
  `app/shell/vendor/` (marked, DOMPurify, mermaid and their LICENSE files), `app/shell/tokens.css`,
  `app/shell/tsconfig.json` (`checkJs`, `noEmit`, includes `api.d.ts` and the bindings), `app/shell/runtime.test.mjs`
- Modify: `app/shell/index.html` (links `tokens.css`, `vendor/mermaid.min.js` as a classic script, `boot.js`),
  `app/shell/boot.js`, `app/src/main.rs` (`--print-types` reads `app/shell/api.d.ts` via `include_str!`),
  `package.json` (devDependency `jsdom`), `treefmt.toml`, `flake.nix` `vendored` and `.gitattributes` (the vendor
  folder), `THIRD_PARTY.md` (marked MIT, DOMPurify Apache-2.0 or MPL-2.0, mermaid MIT)

**Interfaces:**

- Produces (`api.d.ts`):
  `export interface View { id: string; title: string; slot: 'list' | 'run' | 'run-tab' | 'doc'; render(ctx: ViewContext): Node | Promise<Node> }`;
  `ViewContext { data: DataApi; blocks: Blocks; navigate(to: Route): void }`; `DataApi` mirrors Task 6's commands with the bindings' types;

  `Blocks { markdown(text: string): Node; mermaid(source: string): Node; diff(old: string, next: string): Node; stepper(steps: Step[]): Node; card(opts: CardOpts): Node }`. A view file `export default`s a `View`.

- [ ] **Step 1: Write the failing tests** (jsdom): `markdown_strips_script_and_handlers` (`<script>`, `<img onerror>`,
      `javascript:` links gone); `mermaid_fences_become_diagram_nodes` (a fenced `mermaid` block becomes a node handed
      to mermaid with `securityLevel: 'strict'`); `broken_view_falls_back` (a view whose `view_source` errors, that
      throws, or that has no default export shows its error card; the built-in renders below it; other views
      unaffected); `reload_replaces_view_on_change`; `blob_urls_are_revoked`.
- [ ] **Step 2:** `npm ci && node --test crates/flow-cockpit/app/shell/runtime.test.mjs`; expect FAIL.
- [ ] **Step 3: Implement** the runtime (`view_source` → `Blob` with `type: 'text/javascript'` → `import()` → revoke;
      listens to `views-changed`) and the blocks.
- [ ] **Step 4:** Tests PASS; `npx tsc -p crates/flow-cockpit/app/shell` PASS; `sloplint --scope app` clean; in the
      real window on Linux, one test view loads and one Mermaid diagram renders.
- [ ] **Step 5:** Commit: `Add the view runtime and sanitised building blocks.`

### Task 8: The built-in views

**Does:** Draws the list, the flow run, the docs and the activity views as replaceable view files, the run view ported
from the approved design.
**Depends on:** Task 7

**Files:**

- Create: `app/views/builtin/{list,run,docs,activity}.ts`, `app/views/builtin/views.test.ts`,
  `app/views/builtin/fixtures/*.json` (written by an `#[ignore]`d core test `dump_view_fixtures` from the Task 4 home
  fixture), `core/tests/dump_view_fixtures.rs`, `app/views/tsconfig.json` (type-checks the views against
  `../shell/api.d.ts`)
- Delete: `app/views/builtin/.gitkeep`

**Interfaces:**

- Consumes: Task 7's `View` and `Blocks`; `crates/flow-cockpit/design/run-view.html`.

- [ ] **Step 1: Write the failing tests** (jsdom; Node strips the views' types): `list_groups_runs_audits_loose`;
      `list_filters_and_sorts` (status, conductor, search; activity, needs-you-first, furthest along, name);
      `run_shows_now_or_phase`; `run_task_cards_use_does_and_graph_only_when_all_depends_written`;
      `docs_enhances_known_parts` (Gates as stepper, Options as decision cards, the rest Markdown);
      `activity_groups_turns_newest_first`; `audit_shows_unknown_without_picks`.
- [ ] **Step 2:** `node --test crates/flow-cockpit/app/views/builtin/views.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the four views; only `import type` in them.
- [ ] **Step 4:** Tests PASS; `npx tsc -p crates/flow-cockpit/app/views` PASS; `sloplint --scope app` clean;
      `cargo run -p flow-cockpit` shows this repository's runs.
- [ ] **Step 5:** Commit: `Add the built-in list, flow run, docs and activity views.`

### Task 8b: The list view reworked to the user's layout

**Does:** Separates projects from runs in the built-in `list` view: the left rail holds only Projects; the runs side
gets a switch between Flow runs and Loose sessions, a filter bar, and a table with column headings.
**Depends on:** Task 8, Task 10
**Added:** 2026-10-29, by the user's decision "The list mixes projects, filters and runs".

**Files:**

- Modify: `crates/flow-cockpit/app/views/builtin/list.ts`, `crates/flow-cockpit/app/views/builtin/views.test.ts`,
  `crates/flow-cockpit/app/shell/tokens.css` (append or adjust the list's own rules only; the run, docs and activity
  views must look exactly as before), the list fixtures under `app/views/builtin/fixtures/` only if a case is missing
  (re-dump with `dump_view_fixtures`, invented text only).
- `plugins/opt-in/flow-cockpit/skills/views/SKILL.md` only if it describes the list's layout.

**Shape:**

```
┌ Flow cockpit  dead-claude-skills ───────────────────────────────┐
│ Projects       │ [Flow runs 19]  Loose sessions 17                │
│                │                                                  │
│ Desktop        │ Status [Any ▾] Conductor [Any ▾] Sort [Latest ▾] │
│ dead-claude-   │ Search …                                         │
│  skills  ←     │                                                  │
│ gitluxe        │ Name        Conductor  Now / phase  Gates Tasks Last │
│ nix-config…    │ ──────────────────────────────────────────────── │
│ …              │ Flow observ… Feature    Building T…  ‖    7/13  08:49 │
│                │ Web mcp      Research   In execute.  ‖          28 Oct│
└────────────────┴──────────────────────────────────────────────────┘
```

- **Rail:** the "Projects" heading and the project rows, as now (selected row, same-name marks). Nothing else.
- **Switch:** two tabs above the content, "Flow runs" and "Loose sessions", each with its count, styled like the run
  view's tab bar (reuse its classes) and wired as a tablist (`role="tab"`, `aria-selected`, `aria-controls`). The
  pick lives in module state per project, like the other filters, and survives redraws. Left/right keys move between
  the two tabs.
- **Filter bar** (one row under the switch): Status, Conductor and Sort as native `<select>`s with an "Any" first
  option (Sort has no "Any"; latest activity is the default), and the search field (keep `id="list-search"`). Each
  control has a visible label and a stable `id`/`data-keep` so focus and value survive redraws. Only the controls that
  apply to the shown tab: Loose sessions shows only the search (and a sort if it has more than one order). Options
  list only values present in the selected project, with counts, as the rail rows did; an option the new project lacks
  is cleared (Task 8's M4 rule).
- **Table:** a real `<table>` with `<thead>` headings (`<th scope="col">`). Flow runs: Name, Conductor, Now or phase,
  Gates, Tasks, Last activity, plus the exception mark where Task 8 shows it. Audits (under Flow runs): their own
  table under the runs, with a heading and their columns (name/scope, picks and fixed or "State unknown", last
  activity); not clickable, as now. Loose sessions: first prompt (one line, cut with an ellipsis), started, last
  activity. A row opens its run or session as now: the whole row is clickable, and the name cell holds the real
  `<button>` so keyboard and screen readers get one control per row. Unfinished runs still stand out as in Task 8.
- **Empty states:** a short sentence when a tab has no rows or the filters hide every row ("No flow run matches these
  filters.").
- Everything else Task 8 does stays: typed fields only (no format parsing), text nodes or `ctx.blocks.markdown` for
  data text, no `innerHTML`, no timers or global listeners, `import type` only.

- [ ] **Step 1: Write the failing tests** in `views.test.ts`: the rail holds only projects; the switch shows both tabs
      with counts and switches the table; the filter bar's selects filter and sort (keep the existing filter and sort
      tests' intent, moved to the selects); the tables have column headings; audits sit under Flow runs; loose
      sessions only on their tab; the switch and filters survive a redraw (run the real runtime as Task 8's restore
      tests do); an empty filter result shows the sentence.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Views tests, runtime tests, both `tsc -p`, and `sloplint --scope app` over `tokens.css` as in Task 8.
      Build the app and screenshot the real window under a private Xvfb, as in Task 8: the list on Flow runs, on Loose
      sessions, and with a filter set, at 1880×930 and 1280×800. Also retake the run view's Build tab once to show it
      is unchanged.
- [ ] **Step 5:** Commit: `Give the list a projects rail, a switch between flow runs and loose sessions, a filter bar and tables.`

### Task 8c: The app's own extensions

**Does:** Moves the four built-in views out of the binary into extensions the app loads from disk: default extensions
that ship with the app, the user's own next to them, each one switchable off in `config.toml`. The app runs on its
own; nothing about views depends on the Claude Code plugin.
**Depends on:** Task 8b
**Added:** 2026-10-29, by the user's decision "Built-in views are compiled into the app".

**Files:**

- Move: `crates/flow-cockpit/app/views/builtin/{list,run,docs,activity}.ts` →
  `crates/flow-cockpit/extensions/<name>/<name>.ts`; the tests and fixtures (`views.test.ts`, `fixtures/`) move to a
  place that is not shipped (e.g. `crates/flow-cockpit/extensions/tests/`, which the app and the Nix install skip
  because it holds no view, or outside `extensions/`).
- Modify: `app/src/views.rs` (load extensions from two folders, drop `include_dir!` for views), `app/src/main.rs`
  (folders, CLI), `app/src/paths.rs` (the default folder), `app/src/poll.rs` (watch both folders and `config.toml`),
  `app/src/commands.rs` (if `view_source`'s `builtin` flag changes meaning), `core/src/index/config.rs` (`disabled`),
  `app/shell/runtime.js` and `runtime.test.mjs` (an extension's `style.css`; the fallback from a broken replacement),
  `app/shell/api.d.ts`, `app/views/tsconfig.json` (or its replacement), `flake.nix` (install the defaults; app tests
  that need them), `.github/workflows/flow-cockpit.yml` (test paths), `plugins/opt-in/flow-cockpit/skills/views/SKILL.md`,
  `plugins/opt-in/flow-cockpit/README.md`, `CLAUDE.md` (layout, checks, vendored note if paths move), `treefmt`/flake
  excludes if paths move.

**Shape:**

- **An extension is a folder, no manifest:** `extensions/<name>/` holds one or more view `.ts` files and an optional
  `style.css`. The folder name is the extension's id; each view still declares its own `id`, `slot` and `title`.
- **Defaults ship with the app:** list, run, docs, activity. Nix installs them at `$out/share/flow-cockpit/extensions/`.
  (Windows: Task 13 ships them next to the exe; this task only resolves the folder.)
- **The user's own** live in `<config dir>/flow-cockpit/extensions/` (`~/.config/...`, following `config_dir` in
  `paths.rs`). A user extension with a default's name replaces that whole default.
- **All loaded from disk and reloaded live** when any file in either folder changes.
- **Switching off:** `disabled = ["<name>", …]` in `config.toml`, read live (a change to `config.toml` takes effect
  without a restart, for `hidden` too). The window stays read-only: it never writes anything.
- **The Claude Code plugin** keeps only the views skill and the capture hooks.
- **Default folder lookup, in order:** `FLOW_COCKPIT_EXTENSIONS` (a dev override: one folder, e.g. this repo's
  `crates/flow-cockpit/extensions`, so edits show live without a rebuild); then `<exe dir>/../share/flow-cockpit/extensions`
  (Nix and Linux installs); then `<exe dir>/extensions` (Windows, Task 13). The first that exists wins. None found: the
  window draws a plain note naming where it looked; it never crashes.
- **Type imports:** views import their types from one bare module name, `import type { … } from 'flow-cockpit'`, not
  relative paths. In the repo a tsconfig `paths` entry maps it to the shell's `api.d.ts` and the bindings; for users,
  `flow-cockpit --print-types` declares `module 'flow-cockpit'`. Type-only imports are stripped at load, as now.
- **CLI:** `--print-view` goes (copying a default is copying its folder). Add `--print-paths`, printing the default
  extensions folder in use, the user extensions folder and `config.toml`'s path, one per line with a label. Keep
  `--version` and `--print-types`.
- **The old `<config>/flow-cockpit/views/` folder** is no longer read; the README says so once.
- **`style.css`:** the runtime adds it as one `<style>` for the extension when its views load and removes it when the
  extension is reloaded, disabled or removed. Scoping stays the author's job (under `section[data-view=<id>]`).
- **A broken user replacement** still shows its error with the default drawn below it, as Task 7 does.
- **Two extensions declaring the same view id:** the user's wins over a default; two in the same folder is a load
  error card naming both.
- **Disabling a default the window needs** (`list`, `run`): its slot shows a plain note ("The list extension is
  switched off in config.toml."), never a blank window.

- [ ] **Step 1: Write the failing tests** (Rust unit tests in `views.rs`/`paths.rs`/`config.rs`, jsdom in
      `runtime.test.mjs`): default folder lookup order; a user extension replaces a default by folder name; `disabled`
      removes an extension's views; a `config.toml` change re-reads `disabled` and `hidden` (poll emits the right
      events); a change in either extension folder emits `views-changed`; `style.css` is added once and removed on
      disable; a disabled `list` draws the note; duplicate view ids; `--print-types` declares `module 'flow-cockpit'`;
      `--print-paths` output; the Nix-installed tree holds the four defaults and no tests or fixtures.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement**, move the files with `git mv` so history follows, update the skill (folders, extension
      shape, `disabled`, `--print-paths`, the bare `flow-cockpit` import, copying a default to change it), README and
      CLAUDE.md.
- [ ] **Step 4:** Core and app tests, clippy `-D warnings`, views and runtime tests, both type checks,
      `nix develop -c npm test`, `nix build .#flow-cockpit && ./result/bin/flow-cockpit --print-paths`. Real window
      under a private Xvfb: the Nix build shows the list and a run as before; with `disabled = ["activity"]` added
      while it runs, the Activity tab goes away without a restart; with `FLOW_COCKPIT_EXTENSIONS` pointing at the repo,
      an edit to `list.ts` shows live.
- [ ] **Step 5:** Commit: `Ship the views as the app's own extensions, loaded from disk and switchable off in config.toml.`

### Task 8d: Tasks added during a build show in the cockpit

**Does:** Lets a plan carry tasks added during the build under lettered numbers (`5b`, `8c`), reads them in the core,
and shows them in the run view in their place, so the Build tab shows where the build really is.
**Depends on:** Task 8f
**Added:** 2026-10-29, by the user's decision "Tasks added during a build don't show".

**Files:**

- `crates/flow-cockpit/core/src/doc/plan.rs`, `doc/ledger.rs`, `doc/flow.rs` (wherever a task number is read),
  `core/src/index/*` (wherever task numbers are compared, counted or sorted), `core/tests/docs.rs`, `core/tests/index.rs`,
  the core's fixture docs (invented text), `crates/flow-cockpit/bindings/` (regenerated).
- `crates/flow-cockpit/extensions/run/run.ts` (and any other extension that uses task numbers), its tests and
  fixtures (re-dump with `dump_view_fixtures`), the design JSON only if a test reads it.
- `docs/features/flow-observability/plan.md`: Tasks 5b, 8b, 8c, 8d, 8e, 8f and 8g, each placed right after the task it
  follows, with an `**Added:**` line naming the decision.
- `plugins/flows/references/flow-rules.md`: one short rule on how a task added during a build is numbered and placed.
  `scripts/flows-uses.mjs` (`checkTemplates`, `checkOverrides`) still passes.

**Shape:**

- A task id is a string: digits, then optionally one lowercase letter (`8`, `8b`). Order: by number, then the plain
  task before its lettered ones, letters in order (`8 < 8b < 8c < 9`). Anything else in a heading stays unread (never
  a panic).
- `PlanTask` and `LedgerTask` carry the id as a string (`id`); `depends_on` becomes a list of ids. Ledger lines
  `Task 8b: …` and `Tasks 3-5: …` (ranges stay plain numbers) parse. Counts ("10 of 13 done") include lettered tasks.
- The run view shows lettered tasks in order in the rail, the card and the graph (graph node ids stay valid Mermaid
  ids, e.g. `T8b`); the card follows the task being built.

- [ ] **Step 1: Write the failing tests:** core parses `### Task 8b: …` with `**Depends on:** Task 8, Task 5b`; ledger
      `Task 8b: dispatched …` and a fix round on `8b`; ordering `8 < 8b < 8c < 9`; an index test where the build is on
      a lettered task and the run's current task is it; `parses_every_flow_md_in_repo` and this plan parse with 20
      tasks; the run view draws a lettered task in the rail and the graph.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement**; add the added tasks to this plan; the rule to flow-rules.md; regenerate bindings;
      re-dump the view fixtures.
- [ ] **Step 4:** Core and app tests, clippy `-D warnings`, jsdom, both type checks, `nix develop -c npm test`; the
      real window under Xvfb on this repo's run: the Build tab lists 20 tasks with 5b and 8b–8g in place.
- [ ] **Step 5:** Commit: `Read lettered tasks added during a build and show them in their place.`

### Task 8e: Back, forward and reload keep the page

**Does:** The window gets page history: the mouse's back and forward side buttons move between the pages visited, and a
reload (F5 or Ctrl+R) reopens the page it was on. A fresh start still opens the list. Nothing is written to disk.
**Depends on:** Task 8c, Task 8d
**Added:** 2026-10-29, by the user's decision "No way back, and a reload loses the page".

**Files:**

- Modify: `crates/flow-cockpit/app/shell/runtime.js`, `crates/flow-cockpit/app/shell/runtime.test.mjs`,
  `crates/flow-cockpit/app/shell/api.d.ts` (only if a documented behaviour of `ctx.navigate` or `ctx.route` changes),
  `plugins/opt-in/flow-cockpit/skills/views/SKILL.md` (one line: navigation is history; views keep using
  `ctx.navigate`).
- No view file should need to change; if one does, the report says why.

**Shape:**

- The current route is written to `location.hash` in one stable, readable form (for example `#/run/<project>/<slug>`
  with the run tab as a further part, `#/session/<project>/<id>`, `#/doc/…`), each part URI-encoded. Every
  `ctx.navigate` to a different route pushes one history entry; a same-route redraw (`changed`) pushes nothing.
  Switching run tabs is a navigation (one entry), so back returns to the previous tab.
- `popstate`/`hashchange` draw the route from the hash, through the same draw path `navigate` uses (no second path).
  The per-route restore of scroll, folds and focus works as it does for a same-route redraw where it can; module state
  in views is unaffected.
- **Start:** a valid hash opens that route; an empty, malformed or unknown hash opens the list and replaces the hash
  (`history.replaceState`, no extra entry). A route whose project, run or session no longer exists draws the view's
  normal "not found" state, or the list if the view has none; never a blank window or a thrown error.
- **Mouse:** the side buttons (`MouseEvent.button` 3 = back, 4 = forward) call `history.back()`/`history.forward()`.
  If WebKitGTK already does this by itself, no second handler is added (that would move two steps). The listener
  lives in the shell, not in views, registered once.
- No top-bar buttons, no key bindings.

- [ ] **Step 1: Write the failing tests** in `runtime.test.mjs` (jsdom): navigate writes the hash and one history
      entry; a same-route redraw writes none; back (`history.back()` then the event) draws the previous route; a
      start with a valid hash opens it; a malformed or unknown hash opens the list and replaces the hash; a run tab
      switch is one entry; hash round-trips for every route kind with awkward ids (spaces, `/`, `#`, unicode); a mouse
      side-button `mouseup`/`auxclick` (whichever is used) calls back/forward once.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Runtime and views tests, both `tsc -p`, `nix develop -c npm test` from the root. In the real window
      under a private Xvfb: open a run, switch to Docs, press F5 and check it stays on Docs; send mouse button 8/9
      (X11's back/forward) and check it went back. The report says what WebKitGTK did on its own.
- [ ] **Step 5:** Commit: `Keep the page in the window's address so the mouse's back and forward buttons and a reload work.`

### Task 8f: Activity stays fast on a large running session

**Does:** Makes the Activity tab and a session's own screen open fast and stay responsive while a long session runs:
the core reads a transcript incrementally, the window gets the newest turns first, and tool inputs load on demand.
**Depends on:** Task 8c
**Added:** 2026-10-29, by the user's decision "Activity freezes on a large running session".

**Files:**

- `core/src/activity*` / `core/src/index/*` (incremental reader and cache), `core/tests/*` (new tests, invented
  fixtures only), `app/src/commands.rs` (paging and tool-input commands), `app/src/poll.rs` if the cache needs a hook,
  bindings (regenerated), `app/shell/api.d.ts` and `runtime.js` (the new `DataApi` calls), `runtime.test.mjs`,
  `crates/flow-cockpit/extensions/activity/activity.ts` and its tests/fixtures, the views skill (the new calls),
  CLAUDE.md only if a layout line changes.

**Shape:**

- **Measure first:** an ignored core test or small example (e.g. `core/tests/activity_timing.rs`, `#[ignore]`) takes a
  transcript path from an env var (`FLOW_COCKPIT_TIMING`), times `session()` (cold), times a second call after
  appending one line to a copy (the live tick), and reports the serialised JSON size of what the window receives. Run
  on a scratch copy of a large session before any code change and at the end; only numbers are recorded, never
  transcript text.
- **Incremental reading:** a per-transcript cache (main and each subagent file) keyed by path, holding the byte offset
  read so far and the parsed state, so a grown file parses only its new bytes. A file that shrank or was replaced
  (size smaller, or different inode/mtime pattern) is re-read from the start. A partial last line (no newline yet)
  is left for the next read. Reading happens outside the index lock: take what the session needs (paths) under the
  lock, release it, then read. Bound the cache (e.g. keep the few most recent sessions) so memory doesn't grow with
  every session opened.
- **Paging:** `DataApi.session(id, { before?: number, limit?: number })` or a new call (documented in `api.d.ts`)
  returns the newest `limit` (default 20) turns before a turn index, the total turn count, agents and live state.
  Turn indexes count from the oldest turn so they stay stable as new turns arrive.
- **Lazy tool input:** turns carry each tool call's name, a short summary line and an id, not its full input; a new
  read-only call returns one tool call's input by session and tool-use id. The fold fetches it on open and shows a
  short "Loading…" until it arrives; an error shows in the fold.
- **The view:** draws the newest page; "Show older turns" (a real `<button>`) appends the next page below; the pages
  loaded stay loaded across `changed` redraws (module state per session), and a redraw fetches only the newest page
  again and merges it. Open folds and scroll stay as before. A session with no more older turns has no button.
- No view parses transcript text; no `innerHTML`; no timers or global listeners.

- [ ] **Step 0: Baseline.** Write the timing test, run it, record the numbers (cold open, live tick, JSON size).
- [ ] **Step 1: Write the failing tests:** incremental read equals a full read (fixture appended in pieces, including a
      split last line); a shrunk/replaced file re-reads; reading doesn't hold the index lock; paging returns the newest
      20, then the next 20, with stable indexes after a new turn; tool input fetched by id; the view draws 20 turns
      and the button, loads more on click, keeps loaded pages across a redraw, fetches input on fold open.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Core and app tests, clippy `-D warnings`, jsdom, both type checks, `nix develop -c npm test`; the
      timing test again (numbers next to the baseline); the real window under Xvfb with a large session open in
      Activity while it grows: the window keeps answering clicks.
- [ ] **Step 5:** Commit: `Read transcripts incrementally and page Activity's turns so a large running session stays fast.`

### Task 8g: Diagrams drawn ahead so pages don't flash

**Does:** The window draws Mermaid diagrams ahead of time, in idle moments, so a page opens with its diagrams already
drawn; a diagram not drawn yet shows a quiet placeholder instead of flashing its source text.
**Depends on:** Task 8e
**Added:** 2026-10-29, by the user's decision "Diagrams flash when a page first opens".

**Files:**

- `crates/flow-cockpit/app/shell/blocks/mermaid.js`, `blocks/markdown.js` (only to expose the Mermaid sources of a
  document from its own lexer), `runtime.js`, `runtime.test.mjs` (and a blocks test if one exists), `api.d.ts` (if
  `ctx.blocks` gains a call), `tokens.css` (the placeholder), `crates/flow-cockpit/extensions/run/run.ts` and
  `docs/docs.ts` only if they must hand sources over, the views skill (one line if views gain a call).

**Shape:**

- **Draw ahead, in idle time:** a small queue in the shell that draws one diagram at a time when the window is idle
  (`requestIdleCallback`, or a `setTimeout(0)` chain where WebKitGTK lacks it; this lives in the shell, not in views,
  so the views' no-timers rule is untouched), never more than one Mermaid render at once, and stops when the queue is
  empty. A diagram a page needs now jumps the queue.
- **What gets drawn ahead:** after the list draws, the task graph and the document diagrams (spec, plan, flow.md
  Mermaid blocks) of the shown project's unfinished runs; when a run opens, the rest of that run's documents. Sources
  come from typed data and the markdown block's own lexer; views do no format parsing. The task graph's source is
  built the same way the run view builds it: one shared function, not a copy.
- **Cache:** keyed by source text and the theme tokens it was drawn with; `KEEP` raised so a project's diagrams fit;
  memory only, nothing on disk.
- **Placeholder:** a diagram not drawn yet shows an empty, quiet box sized like the last drawing of that source if
  known, else a modest default height, with `aria-busy="true"`; the source shows only when drawing fails, with the
  reason. No layout jump when a cached drawing exists.
- Drawing ahead must not make the window stutter: measured in the real window, clicking around while the queue runs
  stays responsive.

- [ ] **Step 1: Write the failing tests** (jsdom with a fake `window.mermaid` that resolves after a delay and counts
      calls): a page whose diagram was drawn ahead draws the SVG at once with no `<pre>`; a not-yet-drawn diagram
      shows the placeholder, not its source; a failed drawing shows the source and the reason; the queue renders one at
      a time and stops when empty; a needed diagram jumps the queue; the same source isn't drawn twice.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** jsdom, both type checks, `nix develop -c npm test`; real window under Xvfb: open the list, wait a
      few seconds, open a run's Build tab and its Docs right after the click: diagrams drawn, no flash.
- [ ] **Step 5:** Commit: `Draw diagrams ahead in idle time so pages open without a flash.`

### Task 9: The plugin, the views skill, the Nix package and CI

**Does:** Makes slice 1 usable day to day: Claude can change views through a skill, Linux gets the app from the flake,
and CI checks it.
**Depends on:** Task 8

**Files:**

- Create: `plugins/opt-in/flow-cockpit/.claude-plugin/plugin.json` (md-pane's shape),
  `plugins/opt-in/flow-cockpit/ skills/views/SKILL.md` (`name`, `description`), `plugins/opt-in/flow-cockpit/README.md`,
  `.github/workflows/flow-cockpit.yml`
- Modify: `.claude-plugin/marketplace.json` (entry after md-pane, `"category": "development"`),
  `installer/core/plugins.test.ts:30-52`, `installer/core/options.ts` (`tools` page keys; `unavailable` hides
  `flow-cockpit` on win32 until Task 13), `installer/core/options.test.ts`, `flake.nix` (package `flow-cockpit`:
  `buildRustPackage`, `src = ./crates/flow-cockpit`, `buildAndTestSubdir = "app"`, version from
  `(importTOML …).workspace.package.version`, `nativeBuildInputs = [pkg-config wrapGAppsHook3]`,
  `buildInputs = [webkitgtk_4_1 gtk3 libsoup_3 librsvg]`, `checkFlags` skipping `poll_emits_once_per_change`, `poll_sees_folders_created_later` and
  `first_paint_before_link_scan`; devShell gains those inputs), `README.md`, `CLAUDE.md` (Layout: three crates and the
  plugin; Checks; CI)

- [ ] **Step 1: Write the failing tests:** `opt-ins from the real manifests` lists `flow-cockpit`;
      `flow-cockpit is unavailable on win32 for now` (`unavailable('flow-cockpit','win32','x64',…)` is a string).
- [ ] **Step 2:** `npm test`; expect FAIL.
- [ ] **Step 3:** Plugin, marketplace entry and skill: the folders and `config.toml`, the `View` interface, "save
      `flow-cockpit --print-types` as `flow-cockpit.d.ts` next to your views", "write `flow-cockpit --print-view <id>`
      into the global folder before changing a built-in; delete the copy to restore it", `blocks.markdown` for any text
      from data, never `innerHTML`, no network, only `import type`. Linux only until slice 2.
- [ ] **Step 4:** Flake package and devShell; `flow-cockpit.yml` on PRs touching the crate or the plugin:
      `cargo test -p flow-cockpit-core` and clippy on ubuntu and windows; on windows `cargo build -p flow-cockpit`; on both
      `npm ci`, then the views tests (`node --test` on `app/shell/*.test.mjs` and `app/views/builtin/*.test.ts`) and
      both `tsc -p` checks; on ubuntu `nix build .#flow-cockpit` with a Nix install action pinned by SHA like the
      others.
- [ ] **Step 5:** `npm test`, `nix build .#flow-cockpit && ./result/bin/flow-cockpit --version` PASS. In a session with
      the plugin, ask Claude to add a view listing open deviations; it appears in the running window without a restart.
- [ ] **Step 6:** Commit: `Ship slice 1 of the flow cockpit through Nix with a views skill.`
- [ ] **Step 7: Slice checkpoint.** Stop. The user uses slice 1; record their go for slice 2 in flow.md under
      Options (`### Slice 2`, `Picked: …`) before Task 10 starts.

## Slice 2

### Task 10: Capture hooks

**Does:** Adds hooks that record what transcripts lack (questions, permission prompts, agents starting and stopping,
turns ending) into a per-session capture file.
**Depends on:** Task 9

**Files:**

- Create: `plugins/opt-in/flow-cockpit/hooks/hooks.json`, `hooks/capture.mjs` (stdin → `main`, like `notify.mjs`),
  `hooks/lib.mjs`, `hooks/lib.test.mjs`
- Modify: `package.json` and `flake.nix` `installer-test` (add `plugins/opt-in/flow-cockpit/hooks/*.test.mjs` to the
  `node --test` globs and the `files` regex), `plugins/opt-in/flow-cockpit/README.md`

**Interfaces:**

- Produces (capture line, JSON, `v: 1`):
  `{ v, ts, session, cwd, event, agent?, agent_type?, tool_use_id?, questions?, notification_type?, message?, permission_tool?, transcript?, agent_transcript? }`; `questions` from
  AskUserQuestion input, cut at 16 KiB.
- Produces: `export function captureDir(env, platform): string`, `export function toLine(input, now): string | null`,
  `export function prune(dir, now, maxAgeDays = 30): void`, `export async function main({ stdin, env, platform, now })`.

- [ ] **Step 1: Write the failing tests** (`node:test`): `toLine maps PreToolUse AskUserQuestion with tool_use_id`;
      `toLine maps PermissionRequest without deciding` (no output); `toLine maps SubagentStart with agent_type`;
      `toLine returns null for invalid JSON`; `captureDir follows XDG_STATE_HOME and LOCALAPPDATA` (Task 6's
      `paths_match_capture_rules` cases); `prune deletes files older than 30 days only`;
      `main exits 0 and prints nothing when the capture dir is a file` (ENOTDIR on both OSes); `parallel_appends_stay_whole` (20 spawned
      writers × 50 lines with 16 KiB `questions`, JSON-escaped → every line parses).
- [ ] **Step 2:** `node --test plugins/opt-in/flow-cockpit/hooks/lib.test.mjs`; expect FAIL.
- [ ] **Step 3: Implement.** One `fs.appendFileSync` of the whole line per event; folder
      `mkdirSync(…, { recursive: true, mode: 0o700 })`, file mode `0o600`; `main` swallows every error. `hooks.json`: SessionStart (also prunes),
      SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop, Notification, PermissionRequest, and PreToolUse,
      PostToolUse, PostToolUseFailure with `"matcher": "AskUserQuestion"`; each
      `{"type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/hooks/capture.mjs\"","async":true}`.
- [ ] **Step 4:** Tests and `npm test` PASS. One real session with `--plugin-dir`: an AskUserQuestion and a permission
      prompt show in the capture file.
- [ ] **Step 5:** Commit: `Capture questions, permission prompts and agents per Claude session.`

### Task 11: "Waiting on you" from the capture

**Does:** Makes a flow run show "waiting on you" while one of its sessions has an open question or permission prompt.
**Depends on:** Task 10, Task 4

**Files:**

- Create: `core/src/activity/capture.rs`, `core/tests/fixtures/capture/*.jsonl`
- Modify: `core/src/activity/mod.rs` (`Live`), `core/src/index/{status,entries,mod}.rs` (read each linked session's
  capture file), `core/src/bindings.rs` if a crossing type changes

**Interfaces:**

- Consumes: Task 10's line format.
- Produces: `pub fn read_capture(path: &Path) -> Vec<CaptureEvent>`; `pub fn live(events: &[CaptureEvent]) -> Live`
  (`waiting`: the question, or the tool waiting for permission); `Status::Waiting` when any linked session's
  `live.waiting` is set.

- [ ] **Step 1: Write the failing tests:** `open_question_waits` (PreToolUse AskUserQuestion, no PostToolUse,
      PostToolUseFailure or UserPromptSubmit after it); `answered_question_clears`; `permission_prompt_waits`;
      `any_later_event_clears_permission` (a denial too: a later PreToolUse or Stop); `stop_without_start_is_ignored`;
      `capture_ignores_partial_last_line`; `status_waiting_from_capture`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests and clippy PASS; with the plugin, a question in a running session turns its flow run to
      "Waiting on you" within one poll (Task 6 already polls the capture folder).
- [ ] **Step 5:** Commit: `Show waiting on you from the capture.`

### Task 12: Repository views and trust

**Does:** Lets a repository carry its own views, loaded only when the user has trusted that repository.
**Depends on:** Task 9

**Files:**

- Modify: `app/src/views.rs` (a third root per trusted project root), `app/src/poll.rs` (poll those folders),
  `plugins/opt-in/flow-cockpit/skills/views/SKILL.md`

- [ ] **Step 1: Write the failing tests:** `trusted_repo_view_replaces_global` (lookup order: built-in, global,
      trusted repository); `trust_matches_any_checkout_of_the_project`; `untrusted_repo_views_ignored` (passes before
      this task too; kept as the guard).
- [ ] **Step 2:** Run; expect the first two to FAIL.
- [ ] **Step 3: Implement**, and add the `trusted` setting to the skill.
- [ ] **Step 4:** Tests and clippy PASS.
- [ ] **Step 5:** Commit: `Load a repository's own views once the user trusts it.`

### Task 13: Windows release and installer

**Does:** Lets the installer set the app up on Windows and print the pinned Nix command on Linux.
**Depends on:** Task 9

**Files:**

- Create: `.github/workflows/build-flow-cockpit.yml` (Windows only, `x86_64-pc-windows-msvc`, zip + `.sha256`,
  `--version` smoke test through a pipe)
- Modify: `.github/workflows/release.yml` (job, `needs`, notes line), `installer/core/binaries.ts` (`BIN_PLUGINS`
  entries gain optional `targets: string[]` and `linuxHint: (version: string) => string`; `flow-cockpit` with
  `key: 'appPath'`, `targets: ['win32-x64']`, `linuxHint` giving
  `nix run github:deadmade/dead-claude-skills/v${version}#flow-cockpit`; `binAsset` returns `undefined` outside `targets`),
  `installer/steps/binaries.ts` (`applyBin`: with a `linuxHint` on Linux, push the hint to `done`; the `build` hint
  names the plugin's own crate), `installer/install.ts:254-255` (call `applyBin` for flow-cockpit),
  `installer/core/options.ts` (`unavailable` treats a platform with a `linuxHint` as offered; the win32 hiding from
  Task 9 goes), `installer/core/binaries.test.ts` (`dirs` gains `plugins/opt-in/flow-cockpit`),
  `installer/core/options.test.ts`, `plugins/opt-in/flow-cockpit/.claude-plugin/plugin.json` (`userConfig.appPath`),
  `plugins/opt-in/flow-cockpit/skills/views/SKILL.md` (Windows path), `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write the failing tests:** `binAsset gives the Windows zip for flow-cockpit`;
      `binAsset has no linux asset for flow-cockpit`; `flow-cockpit has a pinned linux hint` (contains `v${version}`);
      `applyBin prints the hint on linux` (in `done`, not `failures`); `flow-cockpit is offered on win32 and linux`.
- [ ] **Step 2:** `npm test`; expect FAIL.
- [ ] **Step 3: Implement**; the summary line on Windows names `%USERPROFILE%\.claude\bin\flow-cockpit.exe`.
- [ ] **Step 4:** `npm test`, `npm run typecheck` PASS. On Windows (or the Windows CI build): the app opens, one view
      loads through a blob in WebView2, and a Mermaid diagram renders. `gh workflow run build-flow-cockpit.yml` only with
      the user's go (it needs a push).
- [ ] **Step 5:** Commit: `Ship the flow cockpit to Windows through the installer.`
