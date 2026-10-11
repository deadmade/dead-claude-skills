# Installer UX: tabbed chooser, spec

Approved 2026-10-11 (Gate 1).

## Context
`installer/install.mjs` walks 6 category pages of `p.multiselect` in a fixed order (`install.mjs:408-462`).
The user can't go back a page, doesn't see where they are or what comes next, finds the dim (grey) hints hard to
read, and is confused that space toggles while enter leaves the page. clack 1.8.1 has no back navigation or tab
prompt ([clack#39](https://github.com/bombshell-dev/clack/issues/39), open). Goal: one tabbed screen to pick
everything, then the existing review.

## Grounding
- `installer/install.mjs`: I/O + UI; `installer/core.mjs`: pure decisions (`CATEGORIES`, `categorize`, `HINTS`,
  `TOGGLES`, `unavailable`), tested in `core.test.mjs` with `node:test`. Tests run via `node --test installer/*.test.mjs`
  (release.yml, flake.nix).
- UI deps: `@clack/prompts` 1.8.1; `@clack/core` 1.5.1 already in `npm-shrinkwrap.json` (transitive).
- `@clack/core` exports `Prompt` (events `cursor: (Action)`, `key: (char, info)`, `state`, `value`, `prompt()`),
  actions `up/down/left/right/space/enter/cancel`, `isCancel`; `@clack/prompts` exports `S_CHECKBOX_*`,
  `limitOptions` usable in a custom render (verified on unpkg 1.5.1 / 1.8.1 d.ts).

## Prior art
- huh (Go) pages forms with shift+tab back; sv / create-vue use one big clack multiselect; inquirer checkbox has
  no back. Rejected options: **hub menu** (p.select of categories, ~20 lines, not a tab bar),
  **one groupMultiselect** (long list, no blurbs, `a`/`i` broken there per clack#550).
- Chosen: custom `@clack/core` prompt.

## Spec
### Screen
```
◆ Choose what to install
  Workflows 3 │ Language servers 1 │ Integrations │ Tools │ System │ Danger
  ─────────────────────────────────────────────────────────────────
  MCP servers for the services you work with.

  ❯ ◼ mcp-github
    + mcp-azure
    − atlassian

  GitHub's MCP server. Needs a fine-grained PAT you enter in Claude Code.

  ←/→ category · ↑/↓ move · space select · a all · enter review · esc quit
```
- Tab bar: active tab bold + inverse; each tab shows its selected count when > 0.
- Category blurb under the bar; item names in normal color; separators dim.
- The box shows each item against what's installed now: green ◼ kept, green + will install, red − will uninstall,
  dim ◻ off. No `(installed)` suffix: a tag at the line end starts at a different column each line and is hard to scan.
- Detail line: full description of the focused item (marketplace description first sentence / `HINTS`, plus the
  existing notes "token entered in Claude Code", "from claude-plugins-official") in normal color. No clipping.
- Danger tab items render red.
- Narrow terminal: if the full bar exceeds the width, fall back to short labels (first word); long lists scroll via
  `limitOptions`.

### Keys
- ←/→ switch tab (wraps); cursor clamps into the new tab's list.
- ↑/↓ move within the tab (wraps).
- space toggles the focused item; `a` toggles all items in the tab (all on unless all are on → all off),
  **disabled on the Danger tab** (`bulk: false` on its `CATEGORIES` entry in core.mjs) and omitted from its footer.
- The existing "dead-skills is always installed" note stays, shown once before the chooser (plan review 2026-10-11).
- enter from any tab → review. esc / ctrl-c → cancel (existing `must()` → quit, nothing installed).

### Review
- Same +/−/· note as today (`changes()`, hidden-options list).
- `p.select`: **Apply** · **Back to choices** (reopens tabs on the last active tab with picks kept) · **Quit**.
  "Change a category" removed. Clean-slate "type clean" confirm unchanged.
- `--clean` / `--strip-defaults` still preselect.

### Code
- New `installer/tabs.mjs`:
  - `move(state, action, pages)` pure: `{ tab, cursor, chosen }` → new state.
  - `render(state, pages, { width, describe })` pure → string.
  - `chooseTabs({ pages, chosen, tab, describe })`: a plain `@clack/core` `Prompt` wiring cursor/key events to
    `move` and render to `render`; resolves `{ chosen, tab }` or the cancel symbol.
- `install.mjs`: replace `page()` + review loop with `chooseTabs` → review → select loop. Reuse `option()` data
  for labels/descriptions; drop `clip()`. Everything after the review unchanged.
- `package.json`: add `"@clack/core": "1.5.1"` (exact); regenerate `npm-shrinkwrap.json`.
- README installer paragraph updated (no CLAUDE.md exists).

### Testing
- `installer/tabs.test.mjs` (`node:test`): tab wrap, cursor clamp on tab switch, space toggle, `a` toggle-all and
  its no-op on Danger, tab counts in render, narrow-width fallback, danger items red, footer without `a` on Danger.
- Existing `core.test.mjs` keeps passing.
- Manual: `node installer/install.mjs` in a terminal: switch tabs, toggle, enter → review → Back to choices keeps
  picks → Quit (no changes made).

### Out of scope
- clack accessible / screen-reader mode (add if someone needs it).
- Changes to apply steps or summary output.
