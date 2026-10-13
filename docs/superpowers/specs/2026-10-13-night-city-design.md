# Night City: design

## Intent

The user wants Claude Code to look like a netrunner's rig from Cyberpunk's Night City: neon pink and cyan,
striking enough that people walking past stop and ask "what do you have there". Every recolor-only version
(subtle and loud) was rejected as "a bit restyle here, restyle there". What was missing was motion and moments,
not more color. The other hard requirement: **it stays usable** for all-day work.

## Goals

1. A Claude Code color theme, "Night City", that is loud: neon pink / cyan / signal yellow, purple instead of grey
   for dim text, saturated tinted bars behind user messages and bash output. Readable: body text and diffs keep
   strong contrast on a dark base.
2. An animated **intro** when a session starts: pixel skyline with blinking windows, rain, and a neon "NIGHT CITY"
   sign whose letter sputters. It plays for a few seconds, then folds away; it is not permanent.
3. Short **reactions**: a failing tool result triggers a brief glitch; a finished turn flares briefly. Then still.
4. **Flavor text**: Night City spinner words ("Breaching ICE", "Jacking in", …) and turn-end line.
5. **Status line**: everything the installer's ccstatusline config shows today (`installer/ccstatusline.json`: model,
   thinking effort, context, cost, clock; cwd, branch, git changes, ahead/behind), restyled with Night City hex
   colors, gradient and/or powerline.
6. ~~Installing the plugin switches to the theme automatically.~~ Dropped 2026-10-13 (deviation 1, user chose C):
   Claude Code lets only the `/theme` picker select a custom theme; users pick "Night City" there, as the README
   says.
7. Works on every platform the marketplace supports (Linux, macOS, Windows) and in any terminal, tmux included.

## Non-goals

- Terminal background, glow, scanlines, shaders, terminal color schemes or a dedicated terminal profile/launcher.
  Offered and rejected: "just stay in Claude Code".
- A custom QUEST / EDDIES / RAM band: rejected as a duplicate of ccstatusline.
- Sound. *Claude's call; the user never asked for it.*

## Anti-goals

- Anything moving in the transcript or prompt while the user reads or types. Motion lives in the intro and in
  reactions that end on their own.
- Colors that make code, diffs or errors hard to read.
- Looking like a recolor: the intro is the "wow" moment.

## Decided

- Ships as one **opt-in plugin in this marketplace** (user picked "own theme in this marketplace" over installing
  ccthemes).
- Palette **starts from** ccthemes' Cyberpunk Neon
  ([cyberpunk.json](https://raw.githubusercontent.com/livlign/ccthemes/main/plugins/theme-gallery/themes/cyberpunk.json),
  MIT) and is pushed louder. Reference direction: mockup "Night City triad" / `alive.html`: Claude `#FF2E97`,
  cyan `#00F0FF`, yellow `#FCEE0A`, red `#FF003C`, purple `#B57CFF`/`#C04DFF`, user-message bar `#2b0a3d`, bash bar
  `#06213a`. Derived from MIT work → THIRD_PARTY.md entry.
- **Intro in the full-width band above the prompt** (2026-10-13, deviation 2: the user first picked pane ≥144 +
  band, then saw the pane dock beside the transcript and chose the band only): an animated `AbovePrompt` band as
  tall as Claude Code allows (`maxRows`; up to half the terminal in fullscreen), full width, in every terminal. It
  plays at session start and then goes away. It should read like the `alive.html` mockup: deep-purple sky fading
  down, purple skyline with blinking cyan/yellow windows, cyan rain, a big hot-pink NIGHT CITY sign with a faked
  glow (darker pink halo cells) and a sputtering letter, no box around it.
- Status line keeps every ccstatusline item; only its look changes.

## Constraints (verified in this session)

- Theme format: `themes/<slug>.json` with `name`, `base`, `overrides`; unknown tokens and invalid colors are ignored
  ([docs](https://code.claude.com/docs/en/terminal-config#create-a-custom-theme)). Plugin themes are read-only, show in
  `/theme` by `name`; `experimental.themes` is optional ([components](https://code.claude.com/docs/en/plugins/components#themes-and-output-styles)).
- The stored value for a plugin theme (`custom:<plugin>:<slug>`) is **undocumented** (seen in the 2.1.296 binary).
- Diff color overrides are ignored by the syntax-highlighted diff renderer
  ([#57036](https://github.com/anthropics/claude-code/issues/57036)).
- Mod API (2.1.296, `claude-code.d.ts`): `$.ui.open` pane + `$.clock.every` + `$.ui.blit` support frame animation
  (the doc's own example is a 33 ms blit loop); `ui.render` on `Spinner` may rewrite `word`/`message`/`suffix`;
  `TurnDuration` is renderable; `$.store` persists across sessions. `$.config.set('theme', …)` accepts only the
  built-in themes (verified at runtime, Task 2); `custom:` values come only from the `/theme` picker, which writes
  `"theme": "custom:night-city:night-city"` to `~/.claude/settings.json`. **A pane opened unasked is placed only from 144 columns** (110 for an id the user once opened) and waits
  below that (`claude-code.d.ts:2490`, `:14132`).
- Mods cannot write raw escape sequences to the terminal.
- ccstatusline 2.2.32 (installed) supports truecolor hex, line gradients with hex stops, and powerline (its README).
- Repo: new plugin needs a marketplace entry, version = package.json, a `CATEGORIES` key in `installer/core.mjs`
  (else `installer/core.test.mjs:372-379` fails), README opt-in list, THIRD_PARTY.md.

## Behaviour (proposed by Claude, confirmed by the user in the grill, 2026-10-13)

- Plugin `night-city`, theme `name` "Night City". Opt-in (not in the dead-skills bundle), on the installer's
  **System** page next to ccstatusline.
- Intro: about 4 s, any keypress skips it, plays only on a **fresh session start** (not `/clear`, not resume).
  Ideally both sizes share one scene generator drawn at two heights (builder's call).
- Reactions: glitch at most **once per turn** on a tool result with `isError` (failing greps and tests are common;
  firing on each would break "usable"); flare on every turn end. Both well under a second.
- Flavor text always on: spinner words (`Spinner` `word`) and the turn-end line (`TurnDuration`: only its verb can change, e.g. "Jacked out
  for 3s").
- Night City ccstatusline config is written by the installer when `night-city` is chosen together with the
  ccstatusline toggle; otherwise the existing config. Same rule as today's `applyCcstatusline`: a file that matches
  one of the shipped configs (stock or Night City) is replaced silently, a customized one only after asking.
- Removal: when `night-city` leaves the installer's selection, the installer puts back the stock ccstatusline
  config if the file is still the Night City one, and resets `theme` to the default if it is still the Night City
  value. Nothing remembers the user's earlier theme.

## Left to the builder

- Exact token values for every theme token, contrast-checked.
- Intro art, frame rate, and how reactions render (pane, status, toast).
- The spinner word list and turn-end wording.
- Tests: the mod's behaviour via `claude plugin test`; installer logic in `core.mjs`/`files.mjs` with a test.
