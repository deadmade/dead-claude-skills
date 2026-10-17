# dead-skills

The default bundle, on every machine:

- **Global rules**: `rules.md`, added to the context at session start.
- **Context7** (`.mcp.json`): up-to-date library docs.
- **Night City**: the theme and its mod, below.
- The core plugins as dependencies: code-review, claude-code-setup, claude-md-management, security-guidance,
  claude-security, superpowers and ponytail.

  /plugin install dead-skills@dead-claude-skills

Night City and Context7 were plugins of their own (night-city, mcp-basic) until 0.3.0; the installer removes those and keeps Night City picked in `/theme`.

## Night City

<img src="assets/mascot-512.png" width="192" align="right" alt="Onibi: a hooded netrunner in a respirator, her chrome cybereye a glowing eight-point spark">

A toned-down synthwave Claude Code theme, "Night City": a dusk-indigo background, lavender text, dusty-pink Claude,
peach inline code and permission prompts, soft teal suggestions and bash, muted violet instead of grey for dim text. It is the house look: tui-review's pane,
notify's popups and the installer's screens use the same palette. Pick it in `/theme` (Claude Code does not let a plugin
select a custom theme).

Beyond the theme:

- While Night City is the selected theme, the terminal's own background turns the theme's dusk indigo, so
  the empty space matches (OSC 11, reset when Claude exits or you pick another theme). Linux and macOS; Windows
  Terminal untested. If Claude is killed, the color stays until you run `printf '\033]111\007'`.
- Night City spinner words and turn-end verbs ("Jacked out for 3s").
- Short status-line reactions: `▚▞ FLATLINE ▞▚` once per turn on a failing tool, `◢◤ JACKED OUT ◢◤` when a main turn
  ends.
- Onibi drops by: after about one main turn in five (never more than once every three minutes) she pops up above the
  prompt for six seconds with a one-liner ("good work, choom.", "what are you even doing?"), a sorrier one after a
  failing tool, an impatient one after a turn over two minutes. The `Onibi` setting in `/config` makes her come
  `always` (every turn) or turns her `off`.
- A Night City ccstatusline config: Powerline segments with slanted edges in the theme's colours, icons, context as tokens
  and percent, the cost in eddies (`€$1.23`) and a ナイトシティ sign fading pink to teal. It needs a Nerd Font in the terminal. The installer writes it with the ccstatusline toggle
  and replaces the stock config earlier versions wrote.
- The installer turns syntax highlighting off (`syntaxHighlightingDisabled`) and sets
  `CLAUDE_CODE_TMUX_TRUECOLOR=1`: inside tmux Claude Code otherwise draws in 256 colours and the theme's indigos turn
  grey.

Syntax highlighting: Claude Code colours code and diffs with a fixed Monokai palette for every dark theme, which a
theme can't change, and it ignores the theme's diff colours while highlighting is on (anthropics/claude-code#57036).
With it off (ctrl+t in `/theme`), diffs use Night City's mint and coral and code takes the theme's text colour.

The palette starts from the Cyberpunk Neon theme of [ccthemes](https://github.com/livlign/ccthemes) (MIT) and is
retuned to softer synthwave colours; see `THIRD_PARTY.md` in the repository root.

### Mascot

**Onibi** (鬼火, "demon fire": the ghost lights of Japanese folklore that drift through the dark and lead people to
their end). The netrunner above is the theme's mascot, an original 64×64 pixel-art character in the theme's palette: a
respirator with an LED bar, an undercut with a circuit tattoo, and a chrome plate whose cybereye is an eight-point
spark, a nod to Claude rather than Anthropic's logo. `assets/mascot.png` is the 1x original, `assets/mascot-512.png`
the 8x nearest-neighbour scale; she is also the notify plugin's notification icon. All are drawn by `scripts/draw-mascot.mjs` in the repository root; edit the drawing
there and rerun it rather than editing the PNGs.

### Contrast (WCAG)

Checked with relative luminance; all are at least 4.5:1. `background` is an undocumented token that the theme sets
anyway.

| Foreground             | on `background` | on user bar | on bash bar |
| ---------------------- | --------------- | ----------- | ----------- |
| `text` `#E6DCF7`       | 13.44           | 11.29       | 11.15       |
| `permission` `#F5B97A` | 10.20           | 8.57        | 8.46        |
| `error` `#F2788C`      | 6.61            | 5.55        | 5.48        |
| `inactive` `#9A90C2`   | 6.02            | 5.06        | 5.00        |

`text` on the diff backgrounds: added 9.80, removed 10.56, added word 5.94, removed word 7.03, added dimmed 11.25,
removed dimmed 12.22.
