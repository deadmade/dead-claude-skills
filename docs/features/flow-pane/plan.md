# Flow pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A band above the prompt that shows where the current feature-flow / research-flow run stands, read from
`docs/features/*/flow.md`, with one key that resumes it.

**Architecture:** A mod inside `plugins/feature-flow`. A pure module (`hooks/flow.ts`) parses flow.md, picks the
current run and lays out the band's lines; `hooks/register.tsx` scans the repository root and its worktrees every
5 s through `$.fs`, notes which run this session writes through `tool.call`, keeps the drawn value in one `$.state`
atom and draws it on `AbovePrompt`. Both skills learn to resume a run named by its slug before the key ships.

**Tech Stack:** Claude Code mod API (`'claude-code'`, `'claude-code/testing'`), TypeScript, no npm dependencies.

**Spec:** [spec.md](spec.md)

## Global Constraints

- No npm dependencies; only the `$` engine interface (`$.fs`, `$.clock`, `$.command`, `$.session`, `$.ui`).
- One repo version: never bump `version` by hand (`check-repo.mjs` fails on drift).
- The mod only reads. It never writes flow.md or any other file.
- A field it can't read shows `?`, never a guess; a gate counts as approved only per the spec's date rule.
- Poll interval: 5 seconds. Resume hotkey: `1`.
- Scan base: `(await $.session.repo())?.root ?? (await $.session.cwd())` (both async); folders `<base>`, `<base>/.worktrees/*`,
  `<base>/.claude/worktrees/*`, each with `docs/features/*/flow.md`; per slug the newest `mtimeMs` wins.
- Yield (`next(e)`) when there is no run, when `e.props.hasSurvey`, when `e.props.view.agentId !== undefined`, and
  when a hook beneath drew a band (`next(e)` didn't come back as `{ type: 'engine' }`).
- Module variables for bookkeeping, one atom (`band`) for what's drawn, as cswap and night-city do.
- Generated `.claude-plugin/types/` stays gitignored. No tsconfig, no `tsc` (cswap's pattern). Commit messages: one
  sentence, no co-author lines.

## Review Focus

1. **Windows paths:** a Write/Edit `file_path` like `C:\repo\docs\features\x\flow.md` must still mark run `x`
   (Task 2 `slugOf` test).
2. **CRLF files:** a flow.md checked out with `\r\n` parses the same as with `\n` (Task 1 test).
3. **No `docs/features`, no worktree folders:** listing a missing directory must not throw out of the poll; the band
   yields (Task 4 test "no runs").
4. **A flow.md deleted or unreadable between list and read, or a worktree removed:** that copy drops out, the others
   still show (Task 4 tests).
5. **A failing check:** a first poll that throws must not stop later polls (Task 4 test "survives a failed poll").

---

### Task 1: Parse flow.md

**Files:**

- Create: `plugins/feature-flow/hooks/flow.ts`, `plugins/feature-flow/types/index.d.ts`,
  `plugins/feature-flow/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`),
  `plugins/feature-flow/hooks/register.tsx` (`export const register: Register = () => {}` for now)
- Modify: `plugins/feature-flow/.claude-plugin/plugin.json` (add `"types": "./types/index.d.ts"`)
- Test: `plugins/feature-flow/hooks/flow.test.ts`

**Interfaces:**

- Produces (`types/index.d.ts`, imported as `import type { Run } from '../types'`, the cswap pattern):

```ts
export type Run = {
  slug: string;
  path: string; // absolute
  mtimeMs: number;
  research: boolean; // frontmatter flow: research
  phase: string; // frontmatter phase:, '?' when missing
  gates: [string | null, string | null]; // approved date (YYYY-MM-DD) or null = open
  deviations: boolean;
};
```

- Produces (`flow.ts`):

```ts
export function parseFlow(text: string): Omit<Run, 'slug' | 'path' | 'mtimeMs'>;
export function gateDate(line: string): string | null;
```

- [ ] **Step 1: Write the failing tests** in `flow.test.ts` (`import { expect, test } from 'claude-code/testing'`):
  - `gateDate`:
    - `'- Gate 1, spec approved:'` → `null`
    - `'- Gate 2, plan approved: <date>, execution: subagent-driven | native'` → `null`
    - `'- Gate 1, spec approved: 2026-10-13 ("go", in reply to "Do you approve the spec as written?")'` → `'2026-10-13'`
    - the full `language-skills` Gate 1 line (`docs/features/language-skills/flow.md:20`, three equal dates, last
      after "re-approved") → `'2026-10-13'`
    - `'- Gate 1, spec approved: 2026-10-11. Reopened 2026-10-12: x changed'` → `null`
    - `'- Gate 1, spec approved: 2026-10-11, reopened: spec changed'` → `null`
    - `'- Gate 1, spec approved: 2026-10-11. reopened 2026-10-12, re-approved 2026-10-14'` → `'2026-10-14'`
  - `parseFlow`:
    - the template from `references/flow-template.md` (inline) → `toMatchObject` (Task 5 adds fields)
      `{ phase: 'ground', research: false, gates: [null, null], deviations: false }`
    - no frontmatter → `phase '?'`; `flow: research` → `research true`
    - Deviations whose first content line is `None that change an interface…` or `- None to the plan's interfaces`
      → `false`; `1. **Task 2: …**` → `true`; only an HTML comment → `false`
    - the same text with `\r\n` line endings → the same result

- [ ] **Step 2: Run** `claude plugin test .` in `plugins/feature-flow`. Expected: FAIL, `./flow` exports missing.

- [ ] **Step 3: Implement** `parseFlow` and `gateDate`. Split on `/\r?\n/`; frontmatter by the regex in
      `scripts/sync-lib.mjs:33`; a section runs from its `## ` heading to the next `## `. `gateDate`: every
      `\d{4}-\d{2}-\d{2}` after the first `:`, with its index; none → null. If the line has a case-insensitive
      `reopened`, take its last index `r`: no date after `r` → null; the first date after `r` is the last date →
      null; else the last date. No reopen → the last date. Compare indices, never values.

- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: PASS, no refusals.

- [ ] **Step 5: Commit.**

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
export function bandLines(run: Run, others: number, columns: number): string[];
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
  - `bandLines` (run `flow-pane`, phase `plan`, gate 1 `2026-10-17`, gate 2 open, deviations, others 3):
    - at 100 columns, one line that contains `flow-pane`, `plan`, `10-17`, `deviations`, `+3 open`
    - at 40 columns, every line ≤ 40 − 10 chars; `+3 open` dropped before `deviations`, both before the slug is cut
    - `others 0` → no `+0 open`
  - `resumeCommand`:
    - `{ name: 'feature-flow:feature-flow', plugin: 'feature-flow' }` and `'feature-flow:research-flow'` → those names
      for `false` / `true`
    - the same entries without `plugin` → still found (names starting `feature-flow:`)
    - a list without them → `null`

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL on the new names.

- [ ] **Step 3: Implement** the five functions. `slugOf` normalises `\` to `/`. `resumeCommand` takes an entry with
      `plugin === 'feature-flow'` or a name starting `feature-flow:`, whose name ends in `feature-flow` /
      `research-flow`. `bandLines` builds segments slug · phase · gate 1 · gate 2 · deviations · `+N open`, drops
      from the right, then truncates the slug with `…`, within `columns − 10` (the key's room, drawn by Task 4).

- [ ] **Step 4: Run** `claude plugin test .`. Expected: PASS.

- [ ] **Step 5: Commit.**

---

### Task 3: Resume a run by its slug

Lands before the key (Task 4): with today's skills, `/feature-flow <slug>` creates a new flow.md over the run.

**Files:**

- Modify: `plugins/feature-flow/skills/feature-flow/SKILL.md:1-6` (frontmatter) and `:42-48` (Start or resume)
- Modify: `plugins/feature-flow/skills/research-flow/SKILL.md:1-6` and `:40-46`

- [ ] **Step 1: Rewrite feature-flow's "With an argument"** as two bullets:
  - **An existing run's slug** (`docs/features/<arg>/flow.md` exists in the repository root or a worktree under
    `.worktrees/*/` or `.claude/worktrees/*/`): read the newest copy. `flow: research` → say it belongs to
    `/research-flow` and stop. `phase: done` → say it's done and ask what to do. When the newest copy is in a
    worktree, work in that worktree (EnterWorktree with its path) and write that copy; if the switch is refused
    (EnterWorktree only switches into `.claude/worktrees/` from inside another worktree), say so and ask the user
    to start the session in that worktree. Then continue at its phase,
    as "Without one" does. Never create a flow.md over an existing one.
  - **Anything else:** as today (derive a slug, create flow.md, Phase 1); if the derived slug exists, ask before
    choosing another.
- [ ] **Step 2: Frontmatter:** `description` ends "…; no argument resumes the active feature, a run's slug resumes
      that run."; `argument-hint` becomes `'What do you want to build (or a run''s slug)?'`.
- [ ] **Step 3: Mirror both in research-flow** (resumes `flow: research` runs, sends the others to
      `/feature-flow`).
- [ ] **Step 4: Check:** `grep -n "existing run's slug" plugins/feature-flow/skills/*/SKILL.md` shows both;
      `npm test` passes (it runs `claude plugin validate` when `claude` is on PATH).
- [ ] **Step 5: Commit.**

---

### Task 4: The mod

**Files:**

- Modify: `plugins/feature-flow/hooks/register.tsx`, `plugins/feature-flow/types/index.d.ts`
- Test: `plugins/feature-flow/hooks/register.test.ts`

**Interfaces:**

- Consumes: `flow.ts` (Tasks 1–2).
- Produces (added to `types/index.d.ts`):

```ts
export type Band = { run: Run; lines: string[]; showKey: boolean; command: string | null };
declare module 'claude-code' {
  interface PluginState {
    'feature-flow': { band: Band | null };
  }
}
```

`showKey` is the touch half only (no write by this session yet, run not done); `isWorking` is checked while drawing.

- [ ] **Step 1: Write the failing tests** in `register.test.ts`. A `host(on, files, { root })` helper fakes the
      engine like `plugins/cswap/hooks/register.test.ts:21-47`, every fake answering `{ value }`: `mock.clock(on)`;
      `on('session.start', () => ({ cwd }))` and `await $.session.start(START)` in each test (cswap test:28, :53);
      `session.repo` answers `{ root: '/repo', remote: null, internal: false }` (or null); `session.cwd` the given
      cwd; `fs.list` from a `Record<absPath, { text, mtimeMs }>` (directories as `kind: 'dir'` entries; missing →
      `{ deny: 'ENOENT' }`); `fs.read` and `fs.stat` from the same record; `command.list` returns the two
      feature-flow commands; `command.run` records `{ command, args }`; `ui.toast` records; a bottom
      `on('tool.call', () => ({ result: 'ok' }))` unless a test answers otherwise; a bottom
      `on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)` (nothing sits
      beneath test hooks, reference.md:81; night-city test:10-17). Draw with
      `$.ui.mount({ plugin: 'feature-flow', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false,
      isWorking: false, maxRows: 10, bodyColumns: 100, scroll: …, view: {} } })` and read it with `ui.find` /
      `ui.press({ key })`.
  - "no runs": no `docs/features` anywhere → nothing of ours drawn.
  - "a worktree copy wins": `/repo/docs/features/a/flow.md` at `phase: plan` (mtime 1) and
    `/repo/.worktrees/wt/docs/features/a/flow.md` at `phase: execute` (mtime 2) → shows `execute`.
  - "started inside a worktree": cwd `/repo/.worktrees/wt`, runs in `/repo/docs/features/{a,b}` → both counted
    (`+1 open`).
  - "no repository": `session.repo` answers null → the scan uses cwd.
  - "follows edits": change a file's text and mtime, `clock.advance(5000)` → the new phase shows.
  - "copies drop out": a listed flow.md whose read denies, and a worktree removed between polls → the other copy
    shows.
  - "survives a failed poll": `session.repo` denies on the first call only → the band shows after `advance(5000)`.
  - "this session's write wins": a `Write` to `/repo/docs/features/b/flow.md` and an `Edit` with `agentId: 'x'` to
    another slug, each followed by a poll → the last-written slug is current even though another is newer; no
    Button `resume`.
  - "a refused or failed write doesn't count": a `Write` answered `{ deny: 'no' }`, and one answered
    `{ isError: true, result: 'x' }` (night-city test:57) → current unchanged, key still there.
  - "a write outside the scanned folders": a `Write` to `/elsewhere/docs/features/c/flow.md` → `c` is current.
  - "resume": `ui.find({ key: 'resume' })` has hotkey `1`; `ui.press({ key: 'resume' })` runs
    `{ command: 'feature-flow:feature-flow', args: 'a' }`; a `command.run` that rejects → a toast.
  - "no key while working": `isWorking: true` → no Button `resume`.
  - "yields": `hasSurvey: true`, `view: { agentId: 'x' }`, and a band from a hook beneath → ours isn't drawn.

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.

- [ ] **Step 3: Implement `register.tsx`.**
  - Atom `band` (`atom({ plugin: 'feature-flow', key: 'band' }, null)`); module `let touched: { slug, path } | null`,
    `let command: { feature: string | null; research: string | null }`, `const seen = new Map<path, Run>()` (parse
    cache keyed by path + mtime), and `busy` / `again` flags.
  - `refresh($)`: if `busy`, set `again` and return; else `busy = true` and loop while `again`, inside
    `try { … } finally { busy = false }`. Base per Global Constraints. Each
    `$.fs.list` in try/catch → `[]`. For each folder: `list(<f>/docs/features)`, then for each `dir` entry
    `list(<f>/docs/features/<slug>)` and take its `flow.md` entry's `mtimeMs` (no entry → skip). Parse only when
    `seen` misses that path + mtime; a read that rejects drops the copy. Build the copies from this poll's listing
    only, plus `touched.path` with its `mtimeMs` from `$.fs.stat` (try/catch → left out). `newest`, `pickCurrent`, `bandLines`; `update($, band, () => value)` on every poll.
  - `session.start`: `command` from `$.command.list()` via `resumeCommand` (in try/catch); `$.clock.every(5000, …)`
    first, then the first refresh; every call is `void refresh($).catch(() => {})`. Return `next(e)`.
  - `tool.call` with `{ tool: 'Write' }` and `{ tool: 'Edit' }`: `const r = await next(e)`; when `slugOf(e.file_path)`
    matches and `r.deny === undefined && r.isError !== true`, set `touched` and `void refresh($)`; return `r`.
  - `ui.render` on `{ component: 'AbovePrompt' }`: `const b = await read($, band)` first (the read is what redraws
    on update); yield per Global Constraints, then `const below = await next(e)`;
    return `below` unless `below.type === 'engine'`; else draw `lines` as `Text` rows and, when
    `showKey && !e.props.isWorking && command`, `<Button key="resume" hotkey="1" plain onPress={…}>resume</Button>`
    whose press runs `$.command.run({ command, args: run.slug })` and toasts the error on rejection.

- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: PASS; validate lists the
      `session.start`, `tool.call` and `ui.render` hooks and no refusals.

- [ ] **Step 5: Commit.**

---

### Task 5: The research line

**Files:**

- Modify: `plugins/feature-flow/types/index.d.ts`, `plugins/feature-flow/hooks/flow.ts`,
  `plugins/feature-flow/hooks/register.tsx`
- Test: `plugins/feature-flow/hooks/flow.test.ts`, `plugins/feature-flow/hooks/register.test.ts`

**Interfaces:**

- `Run` gains `spec: string | null` (link target of `- Spec:` under `## Artifacts`, as written), `baseline: string`,
  `feature: string` (Results `numbers` cells, `''` when empty or absent), and
  `verdict: 'supported' | 'not supported' | 'inconclusive' | null`.
- `flow.ts` gains `claimOf(spec: string): string | null`; `bandLines(run, others, columns, claim: string | null = null)`,
  so Tasks 2 and 4's three-argument calls keep working.

- [ ] **Step 1: Write the failing tests:**
  - `parseFlow` on the research template with `- Spec: [spec.md](spec.md)`, rows `| baseline | x | 412ms | d |` and
    `| feature | x | | |`: `spec 'spec.md'`, `baseline '412ms'`, `feature ''`.
  - Verdict lines: `Verdict: supported` → `supported`; `Verdict: not supported. Threats…` → `not supported`;
    `Verdict: inconclusive` → `inconclusive`; the template line `Verdict: supported | not supported | inconclusive.`
    → `null`.
  - `claimOf`: `## Hypothesis` with `- **Claim:** if we build X, p95 drops 30%` → the text after `**Claim:** `; no
    section or no claim → `null`.
  - `bandLines` on a research run with a claim → a second line holding the claim, `412ms` and `supported`; empty
    cells left out. A feature run → still one line.
  - mod: "research line" draws the claim from the linked spec; "spec unreadable" (read denies) → no claim, first line
    still drawn.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement.** Verdict: `^Verdict:\s*(not supported|supported|inconclusive)\b` and not followed by
      `\s*\|`. In `refresh`, for a research current run read `spec` relative to the flow.md's folder in try/catch →
      `null`.
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 6: CI and docs

**Files:**

- Modify: `.github/workflows/test.yml` (after "night-city mod tests"; and the header comment)
- Modify: `CLAUDE.md` (Layout: a `plugins/feature-flow/` line; Checks: mod tests list)
- Modify: `README.md` (feature-flow named in the opt-in list, `README.md:9-13`)
- Modify: `.claude-plugin/marketplace.json:119` and `plugins/feature-flow/.claude-plugin/plugin.json` `description`

- [ ] **Step 1:** add

```yaml
- name: feature-flow mod tests
  working-directory: plugins/feature-flow
  run: claude plugin test .
```

and make the header comment say "the mods' tests" instead of "cswap's mod tests".

- [ ] **Step 2:** CLAUDE.md: under Layout, `plugins/feature-flow/`: the two skills plus a mod (`hooks/flow.ts` parses
      flow.md, `register.tsx` draws the band above the prompt and resumes by slug; scans the repo root and its
      worktrees); under Checks, "mod tests: `claude plugin test .` in `plugins/cswap`, `plugins/night-city` and
      `plugins/feature-flow`".
- [ ] **Step 3:** README.md: add feature-flow to the opt-in list with a few words that it draws a band with the current run's phase, gates and
      deviations, and `1` resumes it.
- [ ] **Step 4:** descriptions: insert "A band above the prompt shows the current run's phase, gates and deviations;
      1 resumes it." before "Opt-in." in marketplace.json, and at the end of plugin.json's.
- [ ] **Step 5: Check:** `npm test` passes; `claude plugin test .` in `plugins/feature-flow` passes.
- [ ] **Step 6: Commit.**
