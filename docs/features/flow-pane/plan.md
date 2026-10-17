# Flow pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A band above the prompt that shows where the current feature-flow / research-flow run stands, read from
`docs/features/*/flow.md`, with one key that resumes it.

**Architecture:** A mod inside `plugins/feature-flow`. A pure module (`hooks/flow.ts`) parses flow.md, picks the
current run and lays out the band's lines; `hooks/register.tsx` polls the files every 5 s through `$.fs`, notes which
run this session writes through `tool.call`, keeps the result in one `$.state` atom and draws it on `AbovePrompt`.
Both skills learn to resume a run named by its slug.

**Tech Stack:** Claude Code mod API (`'claude-code'`, `'claude-code/testing'`), TypeScript, no npm dependencies.

**Spec:** [spec.md](spec.md)

## Global Constraints

- No npm dependencies; only the `$` engine interface (`$.fs`, `$.clock`, `$.command`, `$.ui`).
- One repo version: never bump `version` by hand (`check-repo.mjs` fails on drift).
- The mod only reads. It never writes flow.md or any other file.
- A field it can't read shows `?`, never a guess; a gate counts as approved only per the spec's date rule.
- Poll interval: 5 seconds. Resume hotkey: `1`.
- Look in `docs/features/*/flow.md` of the working directory and of every `.worktrees/*/` and `.claude/worktrees/*/`;
  per slug the newest `mtimeMs` wins.
- Yield (`next(e)`) when there is no run, when `e.props.hasSurvey`, when `e.props.view.agentId !== undefined`, and
  when a hook beneath drew a band.
- Generated `.claude-plugin/types/` stays gitignored. Commit messages: one sentence, no co-author lines.

## Review Focus

1. **Windows paths:** a Write/Edit `file_path` like `C:\repo\docs\features\x\flow.md` must still mark run `x`
   (Task 2 `slugOf` test).
2. **CRLF files:** a flow.md checked out with `\r\n` parses the same as with `\n` (Task 1 test).
3. **No `docs/features`, no worktree folders:** listing a missing directory must not throw out of the poll; the band
   yields (Task 3 test "no runs").
4. **A flow.md deleted or unreadable between list and read:** that run is skipped, the others still show (Task 3 test).
5. **Resume command not found:** if no command from the feature-flow plugin is listed, the key is not drawn rather
   than calling an unknown name (Task 2 `resumeCommand` test, Task 3 test).

---

### Task 1: Parse flow.md

**Files:**

- Create: `plugins/feature-flow/hooks/flow.ts`, `plugins/feature-flow/types/index.d.ts`
- Test: `plugins/feature-flow/hooks/flow.test.ts`

**Interfaces:**

- Produces (`types/index.d.ts`, imported by `flow.ts` as `import type { Run } from '../types'`, the cswap pattern):

```ts
export type Run = {
  slug: string;
  path: string; // as read: relative to cwd, or absolute when this session wrote it
  mtimeMs: number;
  research: boolean; // frontmatter flow: research
  phase: string; // frontmatter phase:, '?' when missing
  gates: [string | null, string | null]; // approved date (YYYY-MM-DD) or null = open
  deviations: boolean;
  spec: string | null; // link target of '- Spec:' under ## Artifacts, as written
  baseline: string; // Results 'numbers' cell, '' when empty or absent
  feature: string;
  verdict: 'supported' | 'not supported' | 'inconclusive' | null;
};
```

- Produces (`flow.ts`):

```ts
export function parseFlow(text: string): Omit<Run, 'slug' | 'path' | 'mtimeMs'>;
export function gateDate(line: string): string | null;
export function claimOf(spec: string): string | null;
```

- [ ] **Step 1: Write the failing tests** in `flow.test.ts` (`import { expect, test } from 'claude-code/testing'`):
  - `gateDate`:
    - `'- Gate 1, spec approved:'` → `null`
    - `'- Gate 2, plan approved: <date>, execution: subagent-driven | native'` → `null`
    - `'- Gate 1, spec approved: 2026-10-13 ("go", in reply to "Do you approve the spec as written?")'` → `'2026-10-13'`
    - the full `language-skills` Gate 1 line (`docs/features/language-skills/flow.md:20`, three equal dates, last
      after "re-approved") → `'2026-10-13'`
    - `'- Gate 1, spec approved: 2026-10-11. Reopened 2026-10-12: x changed'` → `null`
    - `'- Gate 1, spec approved: 2026-10-11. reopened 2026-10-12, re-approved 2026-10-14'` → `'2026-10-14'`
  - `parseFlow`:
    - the template from `references/flow-template.md` (inline) → `phase 'ground'`, `research false`,
      `gates [null, null]`, `deviations false`, `spec null`, `verdict null`
    - no frontmatter → `phase '?'`
    - Deviations whose first content line is `None that change an interface…` or `- None to the plan's interfaces`
      → `false`; `1. **Task 2: …**` → `true`; only an HTML comment → `false`
    - research template with `- Spec: [spec.md](spec.md)`, Results rows `| baseline | x | 412ms | 2026-10-17 |`,
      `| feature | x | | |` and `Verdict: supported` → `spec 'spec.md'`, `baseline '412ms'`, `feature ''`,
      `verdict 'supported'`; the unfilled template line `Verdict: supported | not supported | inconclusive.` → `null`
    - the same research text with `\r\n` line endings → the same result
  - `claimOf`: a spec with `## Hypothesis` and `- **Claim:** if we build X, p95 drops 30%` → that text after
    `**Claim:** `; no section or no claim → `null`.

- [ ] **Step 2: Run** `claude plugin test .` in `plugins/feature-flow`. Expected: FAIL, `./flow` not found.

- [ ] **Step 3: Implement** `parseFlow`, `gateDate`, `claimOf` in `flow.ts`. Split on `/\r?\n/`; frontmatter by the
      regex in `scripts/sync-lib.mjs:33`; a section is from its `## ` heading to the next `## `. `gateDate`: every
      `\d{4}-\d{2}-\d{2}` after the first `:` with its index; null when none; null when the last match is the first
      match after the last case-insensitive `reopened` (compare indices, not values); else the last match.

- [ ] **Step 4: Run** `claude plugin test .`. Expected: PASS.

- [ ] **Step 5: Commit** `flow.ts`, `flow.test.ts`.

---

### Task 2: Choose the run and lay out the band

**Files:**

- Modify: `plugins/feature-flow/hooks/flow.ts`
- Test: `plugins/feature-flow/hooks/flow.test.ts`

**Interfaces:**

- Consumes: `Run` (Task 1); `CommandInfo` from `'claude-code'`.
- Produces:

```ts
export function slugOf(filePath: string): string | null; // slug of a .../docs/features/<slug>/flow.md path
export function newest(copies: Run[]): Run[]; // one Run per slug, the greatest mtimeMs
export function pickCurrent(runs: Run[], touched: string | null): { current: Run | null; others: number };
export function bandLines(run: Run, claim: string | null, others: number, columns: number): string[];
export function resumeCommand(commands: CommandInfo[], research: boolean): string | null;
```

- [ ] **Step 1: Write the failing tests:**
  - `slugOf('/r/docs/features/flow-pane/flow.md')` → `'flow-pane'`;
    `slugOf('C:\\r\\docs\\features\\flow-pane\\flow.md')` → `'flow-pane'`;
    `slugOf('/r/docs/features/flow-pane/spec.md')` → `null`.
  - `newest`: two copies of `a` (mtime 1 and 2) and one `b` → `a` with mtime 2, and `b`.
  - `pickCurrent`:
    - no touch → the open run with the greatest mtime; `others` = open runs minus that one
    - touch `x` where `x` is `phase: done` → current `x`; `others` = all open runs
    - touch a slug with no run → falls back as with no touch
    - only done runs, no touch → `{ current: null, others: 0 }`
  - `bandLines` (feature run `flow-pane`, phase `plan`, gate 1 `2026-10-17`, gate 2 open, deviations, others 3):
    - at 100 columns, one line that contains `flow-pane`, `plan`, `10-17`, `deviations`, `+3 open`
    - at 40 columns, every line ≤ 40 chars, and `+3 open` dropped before `deviations`, both before the slug is cut
    - a research run gets a second line holding the claim, `412ms` and `supported`; empty cells are left out
    - `others 0` → no `+0 open`
  - `resumeCommand`: list with `{ name: 'feature-flow:feature-flow', source: 'plugin', plugin: 'feature-flow' }` and
    `'feature-flow:research-flow'` → those names for `false` / `true`; list without them → `null`.

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL on the new names.

- [ ] **Step 3: Implement** the five functions. `slugOf` normalises `\` to `/`. `resumeCommand` matches on
      `plugin === 'feature-flow'` and a name ending in `feature-flow` / `research-flow` (the namespaced form isn't
      fixed by the types). `bandLines` builds segments in order slug · phase · gate 1 · gate 2 · deviations ·
      `+N open` and drops from the right, then truncates the slug with `…`. The key's label is drawn by Task 3, not
      here; reserve 10 columns for it.

- [ ] **Step 4: Run** `claude plugin test .`. Expected: PASS.

- [ ] **Step 5: Commit.**

---

### Task 3: The mod

**Files:**

- Create: `plugins/feature-flow/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`),
  `plugins/feature-flow/hooks/register.tsx`,
  `plugins/feature-flow/tsconfig.json` (copy of `plugins/night-city/tsconfig.json`)
- Modify: `plugins/feature-flow/types/index.d.ts` (add `Band` and the state contract),
  `plugins/feature-flow/.claude-plugin/plugin.json` (add `"types": "./types/index.d.ts"`)
- Test: `plugins/feature-flow/hooks/register.test.ts`

**Interfaces:**

- Consumes: everything in `flow.ts`.
- Produces (added to `types/index.d.ts`):

```ts
export type Band = { run: Run; claim: string | null; others: number; touched: boolean; command: string | null };
declare module 'claude-code' {
  interface PluginState {
    'feature-flow': { band: Band | null; touched: { slug: string; path: string } | null };
  }
}
```

- [ ] **Step 1: Write the failing tests** in `register.test.ts`. A `host(on, files)` helper fakes the engine like
      `plugins/cswap/hooks/register.test.ts:21-47`: `mock.clock(on)`; `fs.list`, `fs.stat`, `fs.read` answer from a
      `Record<path, { text, mtimeMs }>` (missing path → `{ deny: 'ENOENT' }`); `command.list` returns the two
      feature-flow commands; `command.run` records `{ command, args }`; a bottom `ui.render` hook returns
      `{ type: 'engine', ref: 0 }` unless the test sets a band of its own. Render with
      `$.ui.render({ surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false,
      maxRows: 10, bodyColumns: 100, scroll: …, view: {} } })` as in `night-city/hooks/register.test.ts:122-127`.
  - "no runs": no `docs/features` → the engine's result comes back unchanged.
  - "shows the newest open run": two open runs → text contains the newer slug and `+1 open`.
  - "a worktree copy wins": `docs/features/a/flow.md` at `phase: plan` (mtime 1) and
    `.worktrees/wt/docs/features/a/flow.md` at `phase: execute` (mtime 2) → shows `execute`.
  - "follows edits": change a file's text and mtime, `clock.advance(5000)` → the new phase shows.
  - "unreadable run skipped": a listed flow.md whose read denies → the other run still shows.
  - "this session's write wins": a `tool.call` for `Write` with `file_path` `/abs/docs/features/b/flow.md` → `b` is
    current even though `a` is newer; the key is gone.
  - "a subagent's write counts": the same with `agentId: 'x'` on the call.
  - "resume": with no write yet, pressing hotkey `1` runs `{ command: 'feature-flow:feature-flow', args: 'a' }`; for a
    `flow: research` run, `feature-flow:research-flow`.
  - "no key while working": `isWorking: true` → no Button in the tree.
  - "yields": `hasSurvey: true`, `view: { agentId: 'x' }`, and a band from the hook beneath each return what's
    beneath.
  - "research line": a research run with `- Spec: [spec.md](spec.md)` and that spec holding a Claim → the claim is
    drawn.

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL (no module).

- [ ] **Step 3: Implement `register.tsx`.**
  - Atoms `band` and `touched` (`atom({ plugin: 'feature-flow', key }, null)`).
  - `refresh($)`: list `docs/features`, `.worktrees`, `.claude/worktrees` (each `$.fs.list` in try/catch → `[]`);
    for every `dir` entry under them `fs.stat` its `flow.md`; re-read only paths whose `mtimeMs` changed since the
    last poll (module `Map<path, Run>`); add the `touched.path` copy; `newest`, `pickCurrent`; for a research
    current run read its spec relative to the flow.md's folder and `claimOf`; resolve `resumeCommand` from
    `$.command.list()`; `update` the `band` atom only when the value changed.
  - `session.start`: `refresh`, then `$.clock.every(5000, () => void refresh($))`; return `next(e)`.
  - `tool.call` with `{ tool: 'Write' }` and `{ tool: 'Edit' }`: `const r = await next(e)`; when
    `slugOf(e.file_path)` matches, set `touched` and `refresh`; return `r`.
  - `ui.render` on `{ component: 'AbovePrompt' }`: yield per Global Constraints; `const below = await next(e)`, and
    return `below` unless `below.type === 'engine'`; else draw `bandLines(…, e.props.bodyColumns)` as `Text` rows,
    plus `<Button hotkey="1" plain onPress={() => $.command.run({ command, args: run.slug })}>resume</Button>` when
    `!band.touched && !e.props.isWorking && command !== null && run.phase !== 'done'`.

- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .` in `plugins/feature-flow`, and
      `tsc -p .` once the engine has laid `.claude-plugin/types/`. Expected: all pass; validate lists the
      `session.start`, `tool.call` and `ui.render` hooks and no refusals.

- [ ] **Step 5: Commit.**

---

### Task 4: Resume a run by its slug

**Files:**

- Modify: `plugins/feature-flow/skills/feature-flow/SKILL.md:42-48` (Start or resume)
- Modify: `plugins/feature-flow/skills/research-flow/SKILL.md:40-46` (Start or resume)

- [ ] **Step 1: Rewrite feature-flow's "With an argument"** as two bullets:
  - **An existing run's slug** (`docs/features/<arg>/flow.md` exists in the working directory or a worktree under
    `.worktrees/*/` or `.claude/worktrees/*/`): read the newest copy. `flow: research` → say it belongs to
    `/research-flow` and stop. `phase: done` → say it's done and ask what to do. Else continue at its phase, as
    "Without one" does. Never create a flow.md over an existing one.
  - **Anything else:** as today (derive a slug, create flow.md, Phase 1); if the derived slug exists, ask before
    choosing another.
- [ ] **Step 2: Mirror it in research-flow** (resumes `flow: research` runs, sends the others to `/feature-flow`).
- [ ] **Step 3: Check:** `grep -n "existing run's slug" plugins/feature-flow/skills/*/SKILL.md` shows both;
      `npm test` passes (it runs `claude plugin validate` on the plugin when `claude` is on PATH).
- [ ] **Step 4: Commit.**

---

### Task 5: CI and docs

**Files:**

- Modify: `.github/workflows/test.yml` (after "night-city mod tests"; also the header comment)
- Modify: `CLAUDE.md` (Layout: a `plugins/feature-flow/` line; Checks: mod tests list)
- Modify: `.claude-plugin/marketplace.json:119` and `plugins/feature-flow/.claude-plugin/plugin.json` `description`

- [ ] **Step 1:** add

```yaml
- name: feature-flow mod tests
  working-directory: plugins/feature-flow
  run: claude plugin test .
```

and make the header comment say "the mods' tests" instead of "cswap's mod tests".

- [ ] **Step 2:** CLAUDE.md: under Layout, `plugins/feature-flow/`: the two skills plus a mod (`hooks/flow.ts` parses
      flow.md, `register.tsx` draws the band above the prompt and resumes by slug); under Checks, "mod tests:
      `claude plugin test .` in `plugins/cswap`, `plugins/night-city` and `plugins/feature-flow`".
- [ ] **Step 3:** both descriptions end with: "A band above the prompt shows the current run's phase, gates and
      deviations; 1 resumes it." (the same text in both).
- [ ] **Step 4: Check:** `npm test` passes; `claude plugin test .` in `plugins/feature-flow` passes.
- [ ] **Step 5: Commit.**
