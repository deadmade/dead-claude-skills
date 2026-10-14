# night-city

A loud neon Claude Code theme, "Night City": hot-pink Claude, cyan suggestions and bash, signal-yellow permission
prompts, purple instead of grey for dim text, saturated user and bash message bars. Opt-in; pick it in `/theme` (Claude Code does not let a plugin select a custom theme).

Beyond the theme:

- An animated intro (skyline, rain, glowing NIGHT CITY sign) plays for about 4 s in the band above the prompt on a
  fresh session start only (not `/clear`, resume, compact or fork). Any key skips it. It runs in a terminal in
  interactive mode only, uses up to half the terminal's height and 256-colour-safe backgrounds. The block-letter sign
  needs about 32 terminal rows; shorter terminals get a one-row sign.
- While Night City is the selected theme, the terminal's own background turns the theme's near-black purple, so
  the empty space matches (OSC 11, reset when Claude exits or you pick another theme). Linux and macOS; Windows
  Terminal untested. If Claude is killed, the color stays until you run `printf '\033]111\007'`.
- Night City spinner words and turn-end verbs ("Jacked out for 3s").
- Short status-line reactions: `▚▞ FLATLINE ▞▚` once per turn on a failing tool, `◢◤ JACKED OUT ◢◤` when a main turn
  ends.
- The installer writes a Night City ccstatusline config when night-city and the ccstatusline toggle are both on, and
  removes the theme from `settings.json` when night-city is deselected.

Known limit: Claude Code ignores theme diff colours while syntax highlighting is on
(anthropics/claude-code#57036).

    /plugin install night-city@dead-claude-skills

The palette starts from the Cyberpunk Neon theme of [ccthemes](https://github.com/livlign/ccthemes) (MIT) and is
pushed louder; see `THIRD_PARTY.md` in the repository root.

## Contrast (WCAG)

Checked with relative luminance; all are at least 4.5:1. `background` is an undocumented token that the theme sets
anyway.

| Foreground           | on `background` | on user bar | on bash bar |
| -------------------- | --------------- | ----------- | ----------- |
| `text` `#F2E9FF`     | 17.06           | 14.73       | 13.90       |
| `error` `#FF4D6D`    | 6.24            | 5.38        | 5.08        |
| `inactive` `#9A8CE0` | 6.87            | 5.93        | 5.60        |

`text` on the diff backgrounds: added 10.71, removed 13.67, added word 5.64, removed word 8.03, added dimmed 14.52,
removed dimmed 15.72.
