# Installer rewrite: zero-dependency start screen, spec

Approved 2026-10-11 (Gate 1).

## Context

The installer's UI is `@clack/prompts` 1.8.1 + `@clack/core` 1.5.1 (the package's only dependencies, plus their
transitive `sisteransi`, `fast-wrap-ansi`, …). The user wants no npm dependency an attacker could compromise, and a
flow that is readable: today's tabbed checkbox chooser (`installer/tabs.mjs`) packs "installed" and "selected" into one
glyph per row (◼ + −), uses six keys, shows no versions and so nothing as outdated. The user can't tell what's
installed.

Goal: rebuild the UI on Node's stdlib only, as a framed start screen (mockup A2) that shows what's installed per
category, with versions and pending updates, and a review that lists only what changes.

## Grounding

- `installer/core.mjs`: pure decisions (`CATEGORIES`, `categorize`, `HINTS`, `TOGGLES`, `unavailable`, `planPlugins`, …),
  no deps; stays as is apart from the additions below.
- `installer/install.mjs`: I/O. clack is used for intro/outro, spinners, notes, `log.*`, `confirm`, `select`, `text`
  (clean-slate word) and `isCancel`; the chooser loop is `install.mjs:419-447`.
- `installer/tabs.mjs` + `tabs.test.mjs`: the clack chooser; removed.
- `claude plugin list --json` gives each installed plugin's `version` and `enabled`. Plugins from this repo ship
  `plugins/<name>/.claude-plugin/plugin.json` with the release version (all `0.1.1` now); the user's machine has
  `0.1.0` and git-sha versions for them. Plugins from a url source (superpowers, ponytail, …) and the official ones
  have no shipped version to compare against.
- `claude plugin update <plugin>` updates one plugin to the marketplace's version.
- `npm-shrinkwrap.json` is read by `scripts/release.mjs` and `scripts/check-repo.mjs` (version lines only).

## Prior art (fetched this session)

- State as one line per setting with its current value: archinstall's main menu
  ([global_menu.py](https://raw.githubusercontent.com/archlinux/archinstall/master/archinstall/lib/global_menu.py)).
- State as words/versions, not glyphs: rustup `(installed)`, Homebrew `jq 1.8.1 -> 1.8.2`
  ([brew manpage](https://docs.brew.sh/Manpage)); confirm lists only changes (`brew upgrade --dry-run`).
- Zero-dep prompt mechanics: `readline.emitKeypressEvents` + `setRawMode` (raw mode means ctrl-c is a key, not
  SIGINT: [tty docs](https://nodejs.org/docs/latest-v22.x/api/tty.html)); restore raw mode and cursor on every exit
  ([prompts' close()](https://raw.githubusercontent.com/terkelg/prompts/master/lib/elements/prompt.js)); Windows loses
  keys when one raw-mode prompt hands over to the next without `setRawMode(false)`
  ([nodejs#38663](https://github.com/nodejs/node/issues/38663)).
- Rejected layouts (mockups shown 2026-10-11): status groups (mason/lazy-style), one question per screen
  (Debian/create-vite-style), and color styles A1 (tags) and A3 (counters).

## Spec

### Start screen

```
╭─ dead-claude-skills 0.1.1 ──────────────────────────╮
│                                                     │
│   Core            dead-skills + 7, always installed │
│ ❯ ● Workflows & skills  feature-flow, self-review   │
│   ● Language servers    none                        │
│   ● Integrations        + mcp-azure  − atlassian    │
│   ● Tools               cswap, graphify, tui-review │
│   ● System              sandbox on                  │
│   ● Danger zone         off                         │
│                                                     │
│   ↑ 5 updates                                       │
╰─────────────────────────────────────────────────────╯
   Apply 7 changes   Quit                ↑↓  enter  esc
```

- Rounded frame in the accent color (magenta). Title: name + version.
- One row per category from `categorize()` (hidden options already filtered). Each category has its own color for
  dot and name; Danger zone is red. Value column: what's on after the pending changes. Unchanged items appear
  as their names. A pending install is shown as green `+ name` and a pending removal as red `− name`. Shows
  `none` when the category is empty.
  Toggles read `sandbox on`, `status line off`.
- `Core` line: not selectable, says what's always installed.
- `Updates` row (yellow, only when something is outdated): `↑ N updates`. Enter opens the Updates screen.
- Below the frame: `Apply N changes` (green button, N = installs + removals + updates + toggle changes; reads
  `Nothing to change` when N = 0) and `Quit`; key hint on the right.
- Value column too long for the width → cut with `…`. Frame always fits the terminal width; it's redrawn on resize.

### Keys (every screen)

- ↑/↓ move (wraps over the selectable rows: categories, Updates, Apply, Quit).
- enter: on a category → its screen; on Updates → updates screen; on Apply → review; on Quit → quit.
- esc: on a sub-screen → back to the start screen; on the start screen → quit, but with changes pending it first
  asks `Quit without applying N changes?  Yes / No` (default No).
- ctrl-c: quit anywhere, no question. Nothing else: no select-all key (`a` is gone).
- Quit before Apply: `Cancelled before installing anything.`, exit 0.

### Category screen

```
╭─ Integrations ──────────────────────────────────────╮
│ MCP servers for the services you work with.         │
│                                                     │
│   ← Back                                            │
│ ❯ mcp-azure     will install                        │
│   mcp-github    not installed                       │
│   atlassian     will remove (installed 0.1.0)       │
│                                                     │
│ Azure DevOps Server MCP. Needs a collection URL     │
│ and a PAT, which you enter in Claude Code.          │
╰─────────────────────────────────────────────────────╯
   ↑↓ move   enter install/remove   esc back
```

- The frame and category color match the start screen. The rows are `← Back` followed by the category's items.
- Each item's state is a word, with color added:
  - `installed 0.1.1` and `on` are green.
  - `not installed` and `off` are in the normal color.
  - `will install` and `will turn on` are green and bold.
  - `will remove` and `will turn off` are red and bold, followed by the installed version.
  - `outdated 0.1.0 → 0.1.1` is yellow.
  - A plugin disabled in Claude Code (`enabled: false`) reads `installed 0.1.1, disabled`; Apply never enables
    or disables anything.
- enter on an item flips it between installed and not installed; on an item that has a pending change, enter undoes it.
  enter on `← Back` returns to the start screen.
- Below the list: the focused item's description, word-wrapped, in the normal color. It comes from the first
  sentence of the marketplace description or from `HINTS`, plus the existing notes "token entered in Claude Code"
  and "from claude-plugins-official".
- Danger zone items are named in red. `strip-defaults` keeps its "one-way, nothing to undo" note.
- `--clean` and `--strip-defaults` still preselect their option.
- The list scrolls when the terminal is too short.

### Updates screen

- Same frame. One row per outdated plugin: `cswap  0.1.0 → 0.1.1  will update`. Enter toggles the row to
  `skip`. All rows start as `will update`.
- Outdated means a plugin from this repo (shipped `plugin.json` exists) is installed and selected, and its installed
  version string differs from the shipped one (an installed `X.Y.Z` newer than the shipped one doesn't count).
  Plugins without a shipped version (url-sourced, official) are never
  outdated.

### Review screen (Apply)

```
╭─ This will change ──────────────────────────────────╮
│ Install   mcp-azure                                 │
│ Remove    atlassian                                 │
│ Update    cswap          0.1.0   → 0.1.1            │
│           graphify       29c78da → 0.1.1            │
│ Turn on   status line                               │
│ Danger    clean slate: back up, then reset …        │
│                                                     │
│ Unchanged: 9 installed, 14 not installed            │
│ Not available on win32-x64: sandbox (needs WSL2)    │
╰─────────────────────────────────────────────────────╯
 ❯ Apply 7 changes    Back    Quit
```

- Only the change groups that have entries are listed. Install and Turn on are green, Remove and Turn off red,
  Update yellow, Danger red and bold.
- Tokens: an install that needs a token reads `mcp-github (finish in Claude Code)`.
- The choices are a horizontal row: ←/→ or ↑/↓ moves between them, enter picks one. Back returns to the
  start screen with all picks kept.

### Running

- One line per step, no animation: `Installing mcp-azure … done` with `done` in green, or `failed` in red and the reason
  on the next line. Same for uninstall, update, prune, brv/cswap download, marketplace add.
- The existing yes/no questions (write settings.json changes, run dcg's installer, download cswap.exe, uninstall
  duplicates) become a framed note plus a one-line `confirm` (`Write these changes?  Yes / No`, ←/→ + enter, y/n
  as shortcuts).
- The clean-slate confirmation stays a typed word: line input `Type "clean" to continue:` (readline line mode).
- Summary: framed, green `✓ …` lines from `done`, red `✗ …` lines from `failures`, then the handoff notes, missing
  binaries and the restart hint as today.

### Updating plugins

- After installs and uninstalls, each plugin left on Updates runs `claude plugin update <id>`. The result is
  recorded in `done` and `failures` like the other steps.

### Terminal

- Colors: `util.styleText` with the 16 standard ANSI colors only, so the terminal theme decides the shades.
  No dim/grey anywhere.
- Unicode frame and symbols always (no ASCII fallback, no NO_COLOR handling beyond what `styleText` does).
- Raw mode with `emitKeypressEvents` while a screen is shown; `setRawMode(false)` between screens, so the next
  prompt on Windows gets its keys. The cursor is hidden while a screen is up. Raw mode and the cursor are
  restored on every exit path: submit, quit, ctrl-c, an uncaught error, and `process.on('exit')`.
- Redraw: clear the previous frame (cursor up N lines plus `clearScreenDown`), then write the new one. Redraw
  on keypress and on `resize`.
- Not a TTY: exits with the same error as today.

### Code

(Amended 2026-10-11 after plan review: signatures from the plan; shrinkwrap deleted.)

- `installer/ui.mjs` (new), the only code touching the TTY: `screen(state, { move, render }, io)`,
  `confirm(message, initial, io)` (built on `screen`), `line(message, io)`, `note(title, lines)` (wraps, never cuts),
  `progress(label, fn)`, `log(kind, text)`.
- `installer/view.mjs` (new), pure and tested: `frame`, `wrap`, `initial`, `changeList(state, data)` (the review
  grouping), `move(state, key, data)` and `render(state, data, { columns, rows })` for the start, category, updates
  and review screens.
- `installer/core.mjs`: adds `outdated(rows, shipped)`. It is pure and returns installed plugins of this repo whose
  version differs from the shipped one, once per id. An installed `X.Y.Z` newer than the shipped one doesn't count.
  Tested.
- `installer/install.mjs`: every `p.*` call and `dim` is replaced with `ui.mjs` calls or plain text. The chooser loop
  becomes start screen → sub-screens → review. The apply steps keep their logic, and the update step
  (`claude plugin update <id> --json`) is added.
- Deleted: `installer/tabs.mjs`, `installer/tabs.test.mjs`, `npm-shrinkwrap.json`.
- `package.json`: `dependencies` removed, so `@clack/prompts` and `@clack/core` are gone and nothing imports them.
  The shrinkwrap entry leaves `files`. Its bump and check go from `scripts/release.mjs` and `scripts/check-repo.mjs`,
  and from the `flake.nix` hook regex. Engines stays `>=20.12`.
- README installer paragraph rewritten (it currently names `@clack/prompts`).

### Testing

- `installer/view.test.mjs` (`node:test`, `FORCE_COLOR=1` for color asserts):
  - start screen values with pending + and −, and `none` for empty categories
  - the Apply count
  - value column cut with `…` at 40 columns, frame width ≤ columns
  - category states as words (`will install`, `will remove (installed 0.1.0)`)
  - enter toggles and undoes
  - esc returns to start; ↑/↓ wraps
  - updates rows toggle to `skip`
  - review lists only non-empty groups
- `core.test.mjs`: tests for `outdated` (shipped vs. installed, url-sourced never outdated, no downgrade, deduped).
- `ui.mjs`: one test that runs `screen()` on a fake TTY stream pair (`PassThrough` with `isTTY`, `setRawMode` stubs).
  Pressing ↓ then enter resolves, and raw mode is off again afterwards.
- Manual: `node installer/install.mjs` in a pty against a fake `claude` and a scratch home (as in the previous
  feature's Task 4). Walk start → category → toggle → back → updates → review → Back → Quit, and check no changes
  were made. Repeat at 40 columns.

### Out of scope

- Screen-reader / line-by-line mode, `--status`, `--add/--remove` flags (offered, not picked).
- NO_COLOR, `TERM=dumb`, ASCII fallback (user picked "always Unicode + color").
- Updating url-sourced and official plugins (no version to compare).
