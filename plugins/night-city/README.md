# night-city

A loud neon Claude Code theme, "Night City": hot-pink Claude, cyan suggestions and bash, signal-yellow permission
prompts, purple instead of grey for dim text, saturated user and bash message bars. Opt-in; pick it in `/theme`.

    /plugin install night-city --marketplace deadmade/dead-claude-skills

The palette starts from the Cyberpunk Neon theme of [ccthemes](https://github.com/livlign/ccthemes) (MIT) and is
pushed louder; see `THIRD_PARTY.md` in the repository root.

## Contrast (WCAG)

Checked with relative luminance; all are at least 4.5:1.

| Foreground          | on `background` | on user bar | on bash bar |
| ------------------- | --------------- | ----------- | ----------- |
| `text` `#F2E9FF`    | 17.06           | 14.73       | 13.90       |
| `error` `#FF4D6D`   | 6.24            | 5.38        | 5.08        |
| `inactive` `#9A8CE0` | 6.87            | 5.93        | 5.60        |

`text` on the diff backgrounds: added 10.71, removed 13.67, added word 5.64, removed word 8.03, added dimmed 14.52,
removed dimmed 15.72.
