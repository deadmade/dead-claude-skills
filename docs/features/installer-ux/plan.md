# Installer tabbed chooser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the installer's six forced multiselect pages with one tabbed chooser (←/→ tabs, space toggle,
enter → review) and a review that can go back to it.

**Architecture:** New `installer/tabs.mjs` holds two pure functions (`move`, `render`) plus `chooseTabs`, which runs
a plain `@clack/core` `Prompt` wired to them. `installer/install.mjs` swaps its page loop and review loop
(`install.mjs:395-462`) for `chooseTabs` → review note → Apply / Back to choices / Quit.

**Tech Stack:** Node >=20.12 ESM, `@clack/prompts` 1.8.1, `@clack/core` 1.5.1, `node:test`.

**Spec:** [spec.md](spec.md)

## Global Constraints

- `@clack/core` pinned exactly `1.5.1` in `package.json` `dependencies`; no other new packages.
- Footer copy exactly: `←/→ category · ↑/↓ move · space select · a all · enter review · esc quit`; on a page with
  `bulk: false` (Danger) the same without ` · a all`. Module-private constants, not exported.
- Header copy: `Choose what to install`. The existing "dead-skills is always installed" `p.note`
  (`install.mjs:431-432`) stays, shown once before the first chooser.
- Review select labels exactly: `Apply`, `Back to choices`, `Quit`.
- Normal color for item names, blurb and detail line; `dim` only for `(installed)` and separators; Danger items red.
- Tests run with `node --test installer/*.test.mjs`; `tabs.test.mjs` sets `process.env.FORCE_COLOR = '1'` as its
  first statement (`styleText` drops color when stdout isn't a TTY) and asserts raw escape codes.
- Commit messages are one sentence, no co-author lines.

## Review Focus

1. Terminal narrower than even the short tab labels (e.g. 10 columns): render must not throw. Test in Task 2.
2. Terminal shorter than the frame (rows = 14, 7 items, long wrapped detail): the frame must stay ≤ rows lines, list scrolls. Test in Task 2.
3. Switching from a long tab with cursor 6 to a 3-item tab: cursor clamps to 2. Test in Task 1.
4. "Back to choices" then enter immediately: `chooseTabs` resolves the `tab` and `chosen` it was given (never `undefined`). Test in Task 3.
5. Esc / ctrl-c in the chooser resolves to clack's cancel symbol so `must()` quits. Test in Task 3.

---

### Task 1: `move`, the pure state transition (+ `bulk` flag)

**Files:**
- Create: `installer/tabs.mjs`
- Modify: `installer/core.mjs:251` (Danger entry of `CATEGORIES`), `installer/core.test.mjs`
- Test: `installer/tabs.test.mjs`

**Interfaces:**
- Produces: `move(state, action, pages) -> state`, `state = { tab: number, cursor: number, chosen: Record<string, boolean> }`,
  `action ∈ 'left' | 'right' | 'up' | 'down' | 'space' | 'all'`, `pages` = `categorize()` output
  (`[{ id, title, blurb, keys, bulk? }]`). Returns a new state object (a new `chosen` when it changes).
- `CATEGORIES` Danger entry gains `bulk: false`; `categorize()` already spreads it through.

- [ ] **Step 1: Write the failing tests.** In `core.test.mjs`: `categorize keeps bulk:false on danger` —
  `categorize(['strip-defaults','clean']).find(c => c.id === 'danger').bulk === false`.
  In `installer/tabs.test.mjs`, fixture
  `const pages = [{ id: 'workflow', title: 'Workflows & skills', blurb: 'B1', keys: ['a1','a2','a3','a4','a5','a6','a7'] }, { id: 'mcp', title: 'Integrations', blurb: 'B2', keys: ['m1','m2','m3'] }, { id: 'danger', title: 'Danger zone', blurb: 'B3', keys: ['strip-defaults','clean'], bulk: false }]`:
  - `move tabs wrap`: `{tab:0}` `'left'` → tab 2; `{tab:2}` `'right'` → tab 0.
  - `move clamps cursor on tab switch`: `{tab:0,cursor:6}` `'right'` → `{tab:1,cursor:2}`.
  - `move up/down wrap`: `{tab:1,cursor:0}` `'up'` → cursor 2; `{tab:1,cursor:2}` `'down'` → cursor 0.
  - `move space toggles focused item`: `{tab:1,cursor:1,chosen:{}}` `'space'` → `chosen.m2 === true`; again → `false`.
  - `move all selects all, then clears`: `{tab:1,chosen:{m1:true}}` `'all'` → m1..m3 true; again → all false.
  - `move all is a no-op without bulk`: `{tab:2,chosen:{}}` `'all'` → `chosen` deep-equals `{}`.

- [ ] **Step 2: Run** `node --test installer/*.test.mjs` — Expected: FAIL (`move` not exported, `bulk` undefined).

- [ ] **Step 3: Implement** `bulk: false` on the Danger entry, and `export function move(state, action, pages)` in
  `installer/tabs.mjs` (header comment: `// The installer's tabbed chooser: pure state and render, plus the clack prompt that runs them.`).

- [ ] **Step 4: Run** `node --test installer/*.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `git add installer/ && git commit -m "Add the tabbed chooser's state transitions."`

### Task 2: `render`, the pure frame

**Files:**
- Modify: `installer/tabs.mjs`
- Test: `installer/tabs.test.mjs`

**Interfaces:**
- Consumes: `state`, `pages` from Task 1.
- Produces: `render(state, pages, { columns, rows, describe, status }) -> string`.
  `describe(key) -> { label: string, detail: string }` (label may carry styling). `status` is clack's state;
  anything other than `'submit'` / `'cancel'` renders the active frame.

Layout (active), top to bottom: `symbol(status)` from `@clack/prompts` + bold `Choose what to install`; tab bar;
`S_BAR_H` rule; page blurb; blank; the list; blank; focused item's `detail`; blank; footer. Tab bar entry: `title`
plus ` ${n}` when n > 0 selected; active one `styleText(['bold','inverse'], …)`; joined with dim ` │ `. If the bar's
plain width (`stripVTControlCharacters`) exceeds `columns - 2`, use each title's first word. List via
`limitOptions({ cursor, options: keys, style, output: { columns, rows }, rowPadding })` with
`S_CHECKBOX_ACTIVE / SELECTED / INACTIVE`, `❯ ` on the cursor line, red labels on a `bulk: false` page;
`rowPadding` = the number of non-list lines after wrapping each at `columns` (`Math.ceil(width / columns)` per line).
Submit/cancel frame: one line, `symbol(status)` + `Choose what to install` + dim `· ${total} selected`.

- [ ] **Step 1: Write the failing tests** (match on `stripVTControlCharacters(out)` unless noted):
  - `render shows full tab bar with counts`: `{tab:0,cursor:0,chosen:{m1:true,m2:true}}`, columns 200 → contains `Workflows & skills │ Integrations 2 │ Danger zone`.
  - `render falls back to short labels`: same, columns 30 → contains `Workflows │ Integrations 2 │ Danger`, not `Workflows & skills`; columns 10 does not throw.
  - `render shows blurb, detail and footer`: describe `k => ({ label: k, detail: 'D-' + k })`; tab 1 cursor 1 → contains `B2`, `D-m2`, and the full footer copy.
  - `render drops "a all" without bulk`: tab 2 → contains `enter review`, not `a all`.
  - `render colors danger items red`: raw output for tab 2 contains `'\x1b[31m'` adjacent to `clean`.
  - `render fits short terminals`: tab 0 cursor 6, rows 14, columns 40, detail 170 chars → `out.split('\n').length <= 14`, contains `a7`, not `a1`.
  - `render submit frame`: status `'submit'`, 3 chosen → a single line containing `3 selected`.

- [ ] **Step 2: Run** `node --test installer/tabs.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 3: Implement `export function render(...)`** in `installer/tabs.mjs`.

- [ ] **Step 4: Run** `node --test installer/tabs.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Render the tabbed chooser as a pure function."`

### Task 3: `chooseTabs`, the clack prompt

**Files:**
- Modify: `installer/tabs.mjs`, `package.json`, `npm-shrinkwrap.json`
- Test: `installer/tabs.test.mjs`

**Interfaces:**
- Consumes: `move`, `render`.
- Produces: `chooseTabs({ pages, chosen, tab = 0, describe, input?, output? }) -> Promise<{ chosen, tab } | symbol>`
  (cancel symbol from `@clack/core`, same one `p.isCancel` checks).

How: no subclass. Keep `let s = { tab, cursor: 0, chosen }` in a closure;
`const pr = new Prompt({ input, output, render() { return render(s, pages, { columns: this.output.columns ?? 80, rows: this.output.rows ?? 24, describe, status: this.state }) } }, false)`
(omit `input`/`output` keys when undefined so clack's stdin/stdout defaults apply).
`pr.on('cursor', a => …)` passes only `left/right/up/down/space` to `move` (ignore `'cancel'`, `'enter'`);
`pr.on('key', ch => ch === 'a' && …)` → `'all'`. `const r = await pr.prompt(); return isCancel(r) ? r : { chosen: s.chosen, tab: s.tab }`.

- [ ] **Step 1: Pin the dependency.** Add `"@clack/core": "1.5.1"` to `package.json` `dependencies`, run
  `npm install --package-lock-only`, then `git diff npm-shrinkwrap.json` — Expected: root `dependencies` gains
  `@clack/core`, root `engines` becomes `>=20.12`; no new `node_modules/*` entries.

- [ ] **Step 2: Write the failing tests** with `PassThrough` streams for `input`/`output`
  (`output.columns = 120; output.rows = 40`), writing raw key sequences to `input`:
  - `chooseTabs returns picks and last tab`: tab 0, write `'\x1b[C'`, `' '`, `'\r'` → `{ tab: 1, chosen: { m1: true } }`.
  - `chooseTabs resolves its input on plain enter`: `tab: 2, chosen: { m3: true }`, write `'\r'` → `{ tab: 2, chosen: { m3: true } }`.
  - `chooseTabs cancels on escape`: write `'\x1b'` → `isCancel(result) === true`.

- [ ] **Step 3: Run** `node --test installer/tabs.test.mjs` — Expected: new tests FAIL.

- [ ] **Step 4: Implement `export function chooseTabs(...)`** in `installer/tabs.mjs`.

- [ ] **Step 5: Run** `node --test installer/*.test.mjs` — Expected: all PASS.

- [ ] **Step 6: Commit** `git add installer/ package.json npm-shrinkwrap.json && git commit -m "Add the tabbed chooser prompt on @clack/core."`

### Task 4: Wire it into the installer

**Files:**
- Modify: `installer/install.mjs:395-462`, `README.md` (paragraph "The installer walks through one page per category…")

**Interfaces:**
- Consumes: `chooseTabs` from Task 3.

- [ ] **Step 1: Adapt `option()`** (`install.mjs:397-406`): drop `clip()` and the `clip` helper; rename the returned
  `hint` field to `detail`; drop `value`. Pass `describe: option` to `chooseTabs`.

- [ ] **Step 2: Replace `page()`, the page loop and the review loop** (keep the always-installed `p.note` before it):
  `let tab = 0; for (;;) { const r = must(await chooseTabs({ pages, chosen, tab, describe: option })); Object.assign(chosen, r.chosen); tab = r.tab; <existing review note>; select Apply / Back to choices / Quit; apply → break; quit → existing cancel + exit 0; back → continue }`.
  Keep `changes()` and the review note text as now.

- [ ] **Step 3: Update the README paragraph**: one screen with a tab per category (←/→ switch, space selects,
  enter reviews); the review can go back to the tabs before anything runs. Keep the hidden-options and clack sentences.

- [ ] **Step 4: Run** `node --test installer/*.test.mjs` and `node scripts/check-repo.mjs` — Expected: PASS / no problems.

- [ ] **Step 5: Manual check in a terminal** (`node installer/install.mjs`): ←/→ through every tab, space toggles,
  `a` does nothing on Danger, enter → review shows the picks, `Back to choices` reopens on the same tab with picks
  kept, then enter again works, `Quit` exits 0 with "Cancelled before installing anything." Esc in the chooser exits
  via `must()` (code 130).

- [ ] **Step 6: Commit** `git commit -am "Use the tabbed chooser in the installer and let the review go back to it."`
