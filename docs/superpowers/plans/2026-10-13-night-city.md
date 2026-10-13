# Night City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in `night-city` plugin: a loud Night City color theme, a mod with an animated intro, reactions and
flavor text that switches to the theme once, and installer support for a Night City ccstatusline config.

**Architecture:** One plugin folder `plugins/night-city/` holding `themes/night-city.json` and a TypeScript mod
(`hooks/`). The scene generator and word list are pure files with tests; `register.tsx` wires them to engine events.
Installer changes are small pure functions in `installer/core.mjs` with tests, called from `install.mjs`.

**Tech Stack:** Claude Code mod API 2.1.296 (`claude-code` types, `claude-code/testing`), Node stdlib (installer),
ccstatusline 2.2.32 config format.

**Spec:** `docs/superpowers/specs/2026-10-13-night-city-design.md`

API facts below cite `claude-code.d.ts` = `/tmp/claude-1000/bundled-skills/2.1.296/7113eacfb305f821af3fbefeb2fbce69/plugin-authoring/types/claude-code.d.ts`
(once the mod has loaded, the same file is at `plugins/night-city/.claude-plugin/types/claude-code/index.d.ts`).

## Global Constraints

- Plugin name `night-city`; theme file `themes/night-city.json`, `"name": "Night City"`, `"base": "dark"`.
- Version = `package.json` version (0.2.0 today); never bump by hand (`check-repo.mjs` fails on drift).
- Opt-in: not in `plugins/dead-skills` `dependencies`; listed on the installer's **System** page.
- Installer: Node standard library only; new logic in `core.mjs`/`files.mjs` with a test, not in `install.mjs`.
  The installer never writes `~/.claude.json`.
- Palette starts from ccthemes Cyberpunk Neon (MIT) → `THIRD_PARTY.md` entry. Anchor colors: Claude `#FF2E97`,
  cyan `#00F0FF`, yellow `#FCEE0A`, red `#FF003C`, purple `#B57CFF`/`#C04DFF`, user bar `#2b0a3d`, bash bar `#06213a`.
- Intro: about 4 s, any keypress skips, fresh session start only (not `/clear`, resume, compact or fork). Pane when
  Claude Code places it (`isPlaced`), `AbovePrompt` band (~6 rows) otherwise.
- Auto-switch the theme **once** per install, regardless of the previous theme; remembered in `$.store`.
- Glitch at most once per main turn on a tool result with `isError`; flare when a main turn ends (not a subagent's);
  both < 1 s.
- Nothing in the transcript animates; no sound; no terminal escape sequences.
- Commit messages are one sentence; no co-author lines.

## Review Focus

1. Terminal resized while the intro plays: no denied-blit errors, no crash, never both pane and band. → Task 4.
2. User types immediately at startup: the first keypress skips the intro and still lands in the prompt. → Task 4.
3. `-p` / SDK runs (`isInteractive: false`, `surface: null`): no intro, no theme switch, no errors. → Tasks 2 and 4.
4. Theme switch refused or throwing: the mod records the attempt and doesn't retry every session. → Task 2.
5. A turn with ten failing tool calls glitches once; the next main turn can glitch again; subagent turns don't
   flare. → Task 5.

---

### Task 1: Plugin skeleton and the theme

**Files:**
- Create: `plugins/night-city/.claude-plugin/plugin.json` (fields as `plugins/cswap/.claude-plugin/plugin.json`
  minus `userConfig`), `plugins/night-city/themes/night-city.json`, `plugins/night-city/README.md`
- Modify: `.claude-plugin/marketplace.json` (entry like `nix-lsp`'s at lines 43-46; its `description` is the
  installer's label), `installer/core.mjs` (add `'night-city'` to the System page `keys`, line 355, and update that
  page's blurb at line 354 to mention the theme), `README.md:6-11` (opt-in list), `THIRD_PARTY.md` (new section:
  palette derived from github.com/livlign/ccthemes `plugins/theme-gallery/themes/cyberpunk.json`, MIT)
- Test: `npm test` (check-repo + `installer/core.test.mjs:372-379` "every opt-in on exactly one page")

- [ ] **Step 1:** Add the marketplace entry only; run `npm test`. Expected: FAIL (no plugin.json / not on a page).
- [ ] **Step 2:** Create `plugin.json`, the README, the `CATEGORIES` entry and blurb, README and THIRD_PARTY lines.
- [ ] **Step 3:** Theme content: every documented token the palette touches — text, status, input box and modes,
  diff, backgrounds, `*_FOR_SUBAGENTS_ONLY`, shimmer pairs. Foregrounds neon on the dark base; background tokens
  (`diff*`, `*Background*`, `selectionBg`) dark tints; dim text purple, not grey. Check `text`, `error`, `inactive`
  and diff text against their backgrounds at WCAG ≥ 4.5:1 (one-off node snippet; record the ratios in the README).
- [ ] **Step 4:** `npm test` and `claude plugin validate plugins/night-city` → PASS, no warnings.
- [ ] **Step 5:** Commit: `"Add the night-city plugin with its Night City theme."`

---

### Task 2: Verify the undocumented facts, then switch to the theme once

Steps 1-4 are checks against this plugin, loaded with `claude --plugin-dir plugins/night-city` and a temporary
logging hook that is deleted before the commit. Write the findings into `docs/features/cyberpunk-theme/flow.md`
under **Grounding**; Tasks 4 and 6 depend on them. If Step 2 or 3 fails, stop and report: that's a deviation.

**Files:**
- Create: `plugins/night-city/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`),
  `plugins/night-city/hooks/register.tsx`, `plugins/night-city/types/index.d.ts`,
  `plugins/night-city/tsconfig.json` (copy of `plugins/tui-review/tsconfig.json`)
- Modify: `plugins/night-city/.claude-plugin/plugin.json` (`"types": "./types/index.d.ts"`),
  `.github/workflows/test.yml:35-37` (a `claude plugin test .` step in `plugins/night-city`, mirroring cswap's)
- Test: `plugins/night-city/hooks/register.test.ts`

**Interfaces:**
- Produces: `export const THEME = '<value from Step 2>'`, `export const SWITCHED_KEY = 'theme-switched'` in
  `register.tsx`; `register` as the module's `Register`.

- [ ] **Step 1:** Pick Night City in `/theme`. Record the stored value (expected `custom:night-city:night-city`), the
  file it lands in (`~/.claude/settings.json` `theme`, or `~/.claude.json`), and that a fresh start keeps it.
- [ ] **Step 2:** From a hook, `$.config.set` that value (grep `set:` under `config` in `claude-code.d.ts`); record
  whether it's accepted.
- [ ] **Step 3:** Confirm the fresh-start signal: classic `SessionStart` `source` (`claude-code.d.ts:11653`,
  `'startup' | 'resume' | 'clear' | 'compact' | 'fork'`) and its order relative to `session.start`.
- [ ] **Step 4:** Find where `$.store` keeps this plugin's values (`claude-code.d.ts` ~3352: a JSON file under the
  config dir): exact path and key layout, so the installer can delete `SWITCHED_KEY` on removal (Task 6).
- [ ] **Step 5: Failing tests** (pattern: `plugins/cswap/hooks/register.test.ts`; mock `config.set`/`store.*`):
  - `switches the theme on the first interactive session` — one `config.set` with `{ key: 'theme', value: THEME }`.
  - `does not switch again once the store says so` — store holds `SWITCHED_KEY: true` → no `config.set`.
  - `does nothing in a -p run` — `isInteractive: false` → no `config.set`.
  - `a denied switch is remembered and not retried` — `config.set` answers `{ deny }` → flag set, no throw.
  - `a throwing switch is remembered and not retried` — `config.set` rejects → flag set (in `finally`), no throw.
- [ ] **Step 6:** `claude plugin test plugins/night-city` → FAIL. **Step 7:** implement in `session.start`.
- [ ] **Step 8:** `claude plugin test plugins/night-city` and `tsc -p plugins/night-city` → PASS.
- [ ] **Step 9:** Commit: `"Switch to the Night City theme once on the first session after install."`

---

### Task 3: Mod: flavor text

**Files:**
- Create: `plugins/night-city/hooks/words.ts`
- Modify: `plugins/night-city/hooks/register.tsx`
- Test: `plugins/night-city/hooks/register.test.ts`

**Interfaces:**
- Produces: `export const SPINNER_WORDS: readonly string[]` (≥ 12, e.g. "Breaching ICE", "Jacking in", "Running the
  net", "Spoofing the Blackwall"), `export const TURN_WORDS: readonly string[]` (past tense that reads before
  "for 3s", e.g. "Jacked out", "Flatlined the bug", "Ghosted the ICE"), `export function pick(words: readonly
  string[], seed: string): string` (stable for one seed).

- [ ] **Step 1: Failing tests:**
  - `the spinner shows a Night City word` — render `Spinner` with `{ word: 'Sauteing', message: null, suffix: '…' }`
    → `word` ∈ `SPINNER_WORDS`; `message` and `suffix` untouched.
  - `the turn line shows a Night City verb` — render `TurnDuration` with `{ word: 'Baked', durationMs: 3000,
    onScreen }` (`claude-code.d.ts:10151-10169`) → `word` ∈ `TURN_WORDS`, `durationMs` and `onScreen` unchanged.
  - `pick` is stable for one seed.
- [ ] **Step 2:** Run → FAIL. **Step 3:** `ui.render` hooks on `Spinner` and `TurnDuration` calling
  `next({ ...e, props: { ...e.props, word } })`. **Step 4:** tests + `tsc` → PASS.
- [ ] **Step 5:** Commit: `"Give the spinner and turn line Night City words."`

---

### Task 4: Mod: the intro

**Files:**
- Create: `plugins/night-city/hooks/scene.ts`
- Modify: `plugins/night-city/hooks/register.tsx`
- Test: `plugins/night-city/hooks/scene.test.ts`, `plugins/night-city/hooks/register.test.ts`

**Interfaces:**
- Produces: `export function frame(width: number, height: number, t: number): Cells` in `scene.ts` — one frame at
  time `t` ms (skyline with blinking windows, rain, "NIGHT CITY" sign whose `I` drops out for part of each cycle),
  `Cells` being what `$.ui.blit` takes (grep `UiBlitArgs`; tui-review's `[codePoint, fg, bg]` layout,
  `plugins/tui-review/hooks/paint.ts:1-2`). Deterministic. `export const INTRO_MS = 4000`, `export const BAND_ROWS = 6`.

Design (from review): one `<Raster key="scene">` mounted by whichever form plays — the pane's `ui.render` on
`{ component: 'Pane', requestId }` or `AbovePrompt`'s — and **one** `$.clock.every(66, …)` loop blitting `frame()` to
that form's `requestId` (`RasterBlitArgs.requestId` accepts a band; tui-review mounts and blits a Raster at
`plugins/tui-review/hooks/register.tsx:149-161, 584-594`). Start from classic `SessionStart` with `source ===
'startup'` and `isInteractive`. Open the pane **without** `focus`; if `(await $.ui.open(…)).isPlaced` is false, use
the band. Always `$.ui.close` the pane id at the end, placed or not. Read the size from the latest render props
each tick and ignore a `{ deny }` from `blit` (a resize is a redraw). Skip on the first `prompt.edit` carrying a
`key` (`claude-code.d.ts:8552`), always `return next(e)`. The band hook returns `next(e)` when `hasSurvey` or when
the intro isn't playing. The art is original, not copied.

- [ ] **Step 1: Failing tests** in `scene.test.ts`:
  - `frame is width × height` for (80, 6), (144, 30), (200, 40); `frame(20, 3, 0)` doesn't throw.
  - `same t gives the same frame`; `the sign is present at t = 0`; `the I is dark at some t in one cycle`.
- [ ] **Step 2: Failing tests** in `register.test.ts` (mocked clock):
  - `a placed pane plays and closes after INTRO_MS`.
  - `an unplaced pane falls back to the band, and the pane id is still closed`.
  - `the first keypress ends the intro and reaches the prompt` (the `prompt.edit` result is `next(e)`'s).
  - `clear, resume, compact and fork play no intro`; `a -p run plays no intro`.
  - `a denied blit after a resize doesn't stop or throw`.
  - `the band yields to a survey`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** tests + `tsc` → PASS; watch it once at ≥ 144 and
  at ~100 columns with `--plugin-dir`.
- [ ] **Step 6:** Commit: `"Play an animated Night City intro at session start."`

---

### Task 5: Mod: reactions

**Files:**
- Modify: `plugins/night-city/hooks/register.tsx`
- Test: `plugins/night-city/hooks/register.test.ts`

**Interfaces:**
- Produces: `GLITCH_MS = 400`, `FLARE_MS = 600` in `register.tsx`; a module-level `let glitched = false`.

- [ ] **Step 1: Failing tests:**
  - `ten failing tool calls in one turn glitch once`; `the next turn can glitch again` (`tool.call` awaits
    `next(e)`, glitches on `isError`; `turn.start` resets `glitched`).
  - `a main turn end flares`; `a subagent's turn.complete doesn't flare` (it carries the agent id,
    `claude-code.d.ts` ~13308).
  - `reactions clear themselves` after `GLITCH_MS`/`FLARE_MS`, and render only in the status line.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement as short-lived `$.ui.status` text in Night City colors.
- [ ] **Step 4:** tests + `tsc` → PASS. **Step 5:** Commit: `"Glitch once per turn on failures and flare at turn end."`

---

### Task 6: Installer: Night City status line, theme reset and the switch flag

**Files:**
- Create: `installer/ccstatusline-night-city.json` (same `lines` as `installer/ccstatusline.json`, every widget
  kept, truecolor `colorLevel` and hex colors / gradient / powerline per ccstatusline's README:
  `$(dirname $(readlink -f $(command -v ccstatusline)))/../README.md`)
- Modify: `installer/core.mjs` (`mergeSettings` :98, `resetSettings` :164), `installer/install.mjs`
  (`applyCcstatusline` :173-188, toggles :579), `installer/files.mjs` if the flag delete needs a file helper
- Test: `installer/core.test.mjs`

**Interfaces:**
- Produces in `core.mjs`:
  - `export const NIGHT_CITY_THEME = '<Task 2 value>'`
  - `export const isShipped = (text, shippedTexts) => …` — true when `text` parses to JSON equal to any shipped one.
  - `mergeSettings(settings, { statusLine, sandbox, version, nightCity })`: when `nightCity === false` and
    `settings.theme === NIGHT_CITY_THEME`, delete `theme`; otherwise leave `theme` alone. `resetSettings` keeps
    `theme` when it is `NIGHT_CITY_THEME` and `nightCity` is true.
  - Only if Task 2 found the theme in `settings.json`. If it lives in `~/.claude.json`, skip the theme reset and
    instead add a summary line: "pick another theme in /theme".

- [ ] **Step 1: Failing tests:**
  - `isShipped`: equal to stock → true; equal to Night City → true; whitespace-only difference → true;
    customized → false.
  - `mergeSettings` with `nightCity: false` removes the Night City theme, keeps any other theme; with `nightCity:
    true` keeps it.
  - `resetSettings` with `nightCity: true` keeps the Night City theme (the `clean` path).
  - Night City config has the same widget `type`s, in the same order, as the stock one.
- [ ] **Step 2:** `node --test installer/core.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. `applyCcstatusline` keeps its structure and its newer-version warning: the target file
  is `ccstatusline-night-city.json` when night-city is selected; a current file that `isShipped` (but isn't the
  target) is replaced without asking. Pass `nightCity: selected night-city` in the toggles at :579. When night-city
  goes from installed to not selected, delete `SWITCHED_KEY` from the store file Task 2 Step 4 found (atomic write
  via `writeAtomic`); if Task 2 found no reliable path, skip it — the README covers it.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `"Write a Night City ccstatusline config and undo the theme when night-city is removed."`

---

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md` (Layout: one line for `plugins/night-city/`, a theme + mod; its tests run with
  `claude plugin test .` there), `plugins/night-city/README.md` (what it does, the pane-or-band rule, the
  diff-color limitation #57036, how to switch back, and that after `/plugin uninstall` + reinstall the theme must be
  picked in `/theme` by hand)

- [ ] **Step 1:** Write both. **Step 2:** `npm test` → PASS.
- [ ] **Step 3:** Commit: `"Document the night-city plugin."`
