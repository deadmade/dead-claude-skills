---
phase: done
---

# Cyberpunk theme: flow

## Request

could we design our own theme? Would be awesome to have like a cyberpunk style theme

## Artifacts

- Spec: [2026-10-13-night-city-design.md](../../superpowers/specs/2026-10-13-night-city-design.md) (builder check
  running)
- Plan: [2026-10-13-night-city.md](../../superpowers/plans/2026-10-13-night-city.md)
- ADRs: none (no decision met domain-modeling's three conditions)
- CONTEXT.md: none (terms are local to one plugin; the spec defines them)
- Grill: one round, 9 questions (name, auto-switch, intro trigger/length, reactions, flavor text, status line,
  removal, installer page); user accepted all recommendations 2026-10-13; folded into the spec's Behaviour section.

## Gates

- Gate 1, spec approved: 2026-10-13 ("go", in reply to "Do you approve the spec as written?")
- Gate 2, plan approved: 2026-10-13 ("approved, subagent-driven"), execution: subagent-driven

## Skipped

## Grounding

- Smallest plugin shape: `plugins/nix-lsp/` = `.claude-plugin/plugin.json` (name, version, description, author,
  repository) + one content file; marketplace entry `.claude-plugin/marketplace.json:43-46`. A theme plugin would be
  `plugin.json` + `themes/<slug>.json`.
- `scripts/check-repo.mjs`: every plugin dir listed in the marketplace (l.46-48), version = package.json (l.55-59),
  `claude plugin validate` per plugin (l.17-24, the only check that sees theme JSON).
- Installer: non-bundle plugins are opt-ins (`installer/core.mjs:70-73`); a new opt-in must join a `CATEGORIES`
  `keys` list (`core.mjs:302-365`) or `installer/core.test.mjs:372-379` fails. Nothing in installer/scripts touches
  `~/.claude/themes` or the `theme` setting.
- Existing palette: `plugins/tui-review/hooks/theme.ts` (One Dark-ish, diff pane only); no Claude Code theme exists.
- Docs to touch: README opt-in list (`README.md:6-11`); THIRD_PARTY.md only if the palette is derived from others.
- Task 2 facts (Claude Code 2.1.296; "runtime" = a temporary probe hook in `plugins/night-city`, logged from both a
  `claude -p --plugin-dir` run and an interactive `--plugin-dir` session; "binary" = the minified bundle):
  - Theme value: `custom:night-city:night-city`. Binary: plugin themes get slug `${plugin.name}:${file basename}`
    (`Kvt` → `kQn(themesPath, {plugin}, "<name>:")`), stored as `custom:<slug>` (`TX`).
  - **`$.config.set` cannot set it (deviation).** Runtime, `-p` and interactive alike:
    `$.config.set({ key: 'theme', value: 'custom:night-city:night-city' })` →
    `{ deny: "takes one of: auto, dark, light, light-daltonized, dark-daltonized, light-ansi, dark-ansi" }`, theme
    stays `dark`. Binary: the `theme` row is `options: Uxe` (built-ins only, `optionsHint: "For custom themes, use
/theme."`) and core's `config.set` bottom denies any `choice` value outside `options` before writing; only the
    `/theme` picker's own writer (`commitTheme`/`themeWriter`) accepts `custom:`.
  - Where it is stored: binary. `theme` is a user-intent setting: written with `saveUserIntentSetting` to
    `userSettings` (`~/.claude/settings.json` `theme`), read via `resolveSetting` from the settings sources first,
    then the legacy `~/.claude.json` value. The settings schema accepts `custom:*`; at startup a `custom:` value
    triggers `loadCustomThemes`. Fresh-start persistence not observed at runtime (no `/theme` pick possible here).
  - Fresh-start signal: runtime. `classic.SessionStart` fires with `source: 'startup'` **before** `session.start`
    (both in `-p` and interactive); `session.start` itself has no source field (`isInteractive`, `surface`, `cwd`).
  - `$.store` file: runtime + binary. `<config dir>/plugins/store/<file>.json`, one flat JSON object keyed by store
    key (`{ "probe": true }`). `<file>` is the plugin id `<name>@<source>` with non-`[A-Za-z0-9_-]` replaced by `_`
    plus `-` and the first 12 hex of its sha256: `night-city@inline` → `night-city_inline-b97a3b1f8941.json`;
    installed from this marketplace, `night-city@dead-claude-skills` → `night-city_dead-claude-skills-9efd3f81de9d.json`
    (computed, not observed).

## Prior art

- Format and tokens: [terminal-config#create-a-custom-theme](https://code.claude.com/docs/en/terminal-config#create-a-custom-theme)
  (`name`, `base`, `overrides`; unknown tokens/invalid colors ignored; `custom:<slug>`).
- Plugin themes: [plugins/components](https://code.claude.com/docs/en/plugins/components#themes-and-output-styles)
  (`themes/<slug>.json`, read-only, edits fork to a user copy); `experimental.themes` is optional and replaces the
  folder scan ([plugins-reference](https://code.claude.com/docs/en/plugins-reference)).
- [livlign/ccthemes](https://github.com/livlign/ccthemes) ships a plugin with ~48 themes incl.
  [cyberpunk.json](https://raw.githubusercontent.com/livlign/ccthemes/main/plugins/theme-gallery/themes/cyberpunk.json)
  (33 tokens, neon foregrounds, dark-tint backgrounds), no manifest key.
- Reference palettes: Synthwave '84 (cyan `#03edf9`, magenta `#ff7edb`), Tokyo Night (`#ff007c`, `#7dcfff`).
- Pitfalls: diff overrides ignored by the syntax-highlighted renderer
  ([#57036](https://github.com/anthropics/claude-code/issues/57036)); `custom:` in settings.json not applied at
  startup on 2.1.132 ([#58153](https://github.com/anthropics/claude-code/issues/58153), likely fixed by 2.1.296,
  untested); backgrounds need dark tints, `inverseText` sits on neon fills. Plugin theme stored value
  `custom:<plugin>:<slug>` is from the minified binary, undocumented.
- Approaches: A plugin-shipped theme in this marketplace; B installer writes `~/.claude/themes/`; C copy-paste file.

## Options

- Own theme vs install ccthemes' Cyberpunk Neon: user picked **own theme in this marketplace, starting from
  ccthemes' cyberpunk.json palette** (MIT, so THIRD_PARTY.md needs an entry).
- Recolor-only mockups (3 subtle, 3 loud) rejected as "a bit restyle here restyle there". User wants a Night City
  look people stop and ask about, that stays usable.
- Direction (mockup `alive.html`): theme for the transcript + a mod drawing an animated Night City intro (skyline,
  rain, flickering sign) **at session start only, not permanent**; brief reactions; flavor text. User wants the
  terminal background/glow too (runs Ghostty 1.3.1 inside tmux).
- Terminal layer: mods can't set terminal bg/shaders; offered a dedicated Night City terminal profile (Ghostty
  launcher / Windows Terminal profile). **Rejected: stay inside Claude Code** (theme + mod only), on all platforms.
- QUEST/EDDIES/RAM band dropped as a ccstatusline duplicate; instead ccstatusline keeps all its items, restyled
  Night City. Theme switches automatically on install. Size: project with a written design.
- Builder check: pane only from 144 cols unasked. Options A band only / **B pane ≥144 + band elsewhere (picked)** /
  C band + `/night-city` command. Recommended A. Glitch rate, auto-switch over an existing theme, ccstatusline
  custom-file handling and removal settled as Claude's calls in the spec.

## Plan review

Round 1 (correctness, fit, simpler reviewers; 23 raw findings merged into 11, none dropped; key API claims
spot-checked in claude-code.d.ts: TurnDuration props, turn.complete subagent id, prompt.edit `key`, hasSurvey):

1. [blocking] TurnDuration has `{word, durationMs}`, no string → rewrite `word` only ("Jacked out for 3s").
2. [should-fix] Task 5 rework: one Raster + blit loop for pane and band; choose by `isPlaced`, always close; skip
   via `prompt.edit` (pane unfocused); fresh start from classic `SessionStart` `source === 'startup'`; ignore
   denied blits / re-read size on resize; yield the band to `hasSurvey`.
3. [should-fix] Theme reset: a `nightCity` toggle in `mergeSettings`/`resetSettings` (also keeps the theme on
   `clean`); settings.json only, never `~/.claude.json` (print a hint instead).
4. [should-fix] `$.store` flag survives uninstall → reinstall never re-switches.
5. [should-fix] ccstatusline: keep `applyCcstatusline`, add an `isShipped` helper (keeps the newer-version warning).
6. [should-fix] No subagent flares: skip `turn.complete` with an agent id.
7. [should-fix] `tsc` needs a tsconfig (copy tui-review's).
8. [consider] CI step moves to Task 3; label in marketplace description, not HINTS, and update the System blurb;
   `react.ts` → a boolean in register.tsx; spike runs against Task 2's plugin; try/finally around `config.set`.

Decisions 2026-10-13: user accepted all recommendations ("yes to all"). Plan rewritten: spike folded into Task 2, react.ts dropped, 7 tasks. Spec example changed to "Jacked out for 3s" (wording only; Gate 1 stands).

## Deviations

1. **Task 2: a mod can't switch to a custom theme.** `$.config.set('theme', 'custom:night-city:night-city')` is
   denied at runtime ("takes one of: auto, dark, light, light-daltonized, dark-daltonized, light-ansi, dark-ansi");
   only the `/theme` picker writes `custom:` values. The theme lives in `~/.claude/settings.json` `theme` (from the
   binary). Options: A installer writes `theme` into settings.json when night-city is selected (+ mod toast hint
   for `/plugin install` users); B mod writes settings.json itself; C drop auto-switch. Recommended A. Decision
   2026-10-13: **C** (user). Spec goal 6 and the auto-switch behaviour removed; plan Task 2 becomes mod scaffolding
   only; Task 6 keeps the removal reset of `theme` (spec, grill Q8) but drops the store flag.
2. **Task 4: the pane shows on the side, and the scene doesn't match the mockup** (user, after watching it live).
   In fullscreen from 110 columns Claude Code docks every pane beside the transcript (`Pane.placement: 'dock'`); no
   component sits at the top of the screen. The `AbovePrompt` band is full width above the prompt, up to half the
   terminal's rows in fullscreen. Proposed: drop the pane, always use the band at its full height. Decision
   2026-10-13: **band only, full height** (user). Screenshot of the live pane: flat grey sky, black towers, the sign
   boxed like a label, stray navy blocks; the mockup's deep-purple sky, purple skyline and glowing sign are missing.
   Task 4 reworked to match `alive.html` as far as cells allow.
3. **The terminal background after all** (2026-10-14, user asked why Claude Code can't paint the whole background).
   No theme token reaches the empty cells, but OSC 11 sets the terminal's background (worked in Ghostty inside tmux
   3.6a, per pane). A mod can't write to the terminal, but a `$.process.run` child can: `sh` walks up to the first
   ancestor with a tty and writes there (verified live as a dev mod); on Windows a PowerShell child writes to
   `CONOUT$` (untested). The plugin sets the theme's `background` while Night City is the selected theme and resets
   with OSC 111 on exit or a theme switch. Non-goal "terminal background" narrowed to glow, shaders and profiles.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
