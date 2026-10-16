---
name: night-city-cast
description: 'Create a new character for the Night City cast: one resident per project, all in the same world and the same 64x64 pixel-art style as Onibi, the dead-claude-skills mascot. Grounds in the project, proposes concepts with a signature hook, draws with the shared kit, checks the art at icon sizes, names the character (a public handle; any real name stays private) and, when asked, ships the PNGs into the project. Use for /night-city-cast <project>, or when the user wants a mascot, avatar or character for one of their projects.'
argument-hint: 'Which project is the character for?'
---

# night-city-cast

Every project gets its own resident of the same Night City. They share one look ([references/style.md](references/style.md))
and one roster ([references/cast.md](references/cast.md)); what differs is who they are. Onibi, the first of them, is the
reference: [scripts/cast/onibi.mjs](scripts/cast/onibi.mjs). Claude proposes and recommends; the user decides.

| Phase     | Does                                                           | Output                              |
| --------- | -------------------------------------------------------------- | ----------------------------------- |
| 1 Ground  | reads the project and the roster                               | what the project is, where art goes |
| 2 Concept | three concepts, each with a role, a hook and an edge           | a chosen concept. **Gate 1**        |
| 3 Draw    | a drawing module on the kit, rendered and fixed until it holds | a draft that passes the checklist   |
| 4 Review  | shows the preview sheet, iterates on feedback                  | approved art. **Gate 2**            |
| 5 Name    | handle (public) and real name (private)                        | names                               |
| 6 Ship    | only when asked: drawing into the cast, PNGs into the project  | commits                             |

## Rules for the whole run

- **The style is fixed.** Read [references/style.md](references/style.md) before drawing and keep to it: the palette,
  framing, lighting and finish are what make the cast one world. No gradients, blur, anti-aliasing or other art styles.
  If the user wants the look itself changed, that is a change to style.md for the whole cast; say so.
- **Original characters only.** Nods, never copies: no existing characters (including Cyberpunk's own cast) and no
  logos. The eight-point spark is the cast's own nod to Claude, not Anthropic's logo.
- **Look before you show.** After every render, Read the `-preview.png` yourself and fix what's off. Never show the user
  art you haven't looked at.
- **Real names stay private.** A character's real name lives in chat only: never in a file, commit, PR, alt text, code
  comment or cast.md. The handle is public. If it's unclear whether something may be public, ask.
- Commit, push or open a PR only when the user asks.

## Phase 1: Ground

Ask nothing yet. Read the project: README, package or plugin descriptions, existing logo or theme colours, and what the
project actually does (the verb: reviews, swaps, deploys, searches). Note its tone, and where the art will appear
(README header, notification icon, favicon, status line), since that sets the sizes that must read. Read
[references/cast.md](references/cast.md) so the new character doesn't repeat a role, hook or silhouette.

## Phase 2: Concept

Propose three concepts with AskUserQuestion, each in a few lines, as in
[references/character.md](references/character.md): a **role** in Night City, a **hook** (one signature element that
stands for what the project does and still reads at 16px), an **edge** (what makes them dangerous or unsettling) and a
**silhouette** different from everyone on the roster. Recommend one and say why.

**Gate 1:** the user picks a concept (or adjusts one). Don't draw before that.

## Phase 3: Draw

1. Copy `scripts/cast/onibi.mjs` to the scratchpad as `<slug>.mjs` and change its import to the kit's absolute path
   (`${CLAUDE_SKILL_DIR}/scripts/pixel-kit.mjs`). Keep the frame: `haze`, `compose`, `rimLight`, `glitchTear`,
   `finish`. Redraw the figure: silhouette first, then face blocks, then the hook, then details.
2. Render: `node ${CLAUDE_SKILL_DIR}/scripts/preview.mjs <slug>.mjs <scratchpad>/<slug>`. That writes `<slug>.png`,
   `<slug>-512.png` and `<slug>-preview.png` (512, 128, 64, then 48/32/16 on dark and light).
3. Read the preview and check it against style.md's checklist. Expect several rounds before it's worth showing.

## Phase 4: Review

Send the preview sheet and the 512 render (SendUserFile when available, else give the paths), say what you changed
since the last round and ask one focused question. Translate vague feedback with the table in
[references/character.md](references/character.md). After two rounds that miss on the same note, ask for a reference
character (real or fictional) whose vibe is closest instead of guessing again. Keep earlier drafts so the user can
compare.

**Gate 2:** the user explicitly approves the art.

## Phase 5: Name

Propose four to six options with meanings and a recommendation, following the naming rules in
[references/character.md](references/character.md): a dark, short handle, not English by default (Japanese fits the
city), and a real name from a brighter past that no longer suits them. The user picks. Only the handle goes anywhere
public.

## Phase 6: Ship (when asked)

- **The cast:** move the drawing to `plugins/night-city/skills/night-city-cast/scripts/cast/<handle>.mjs` in dead-claude-skills (lowercase handle, kit import
  `../pixel-kit.mjs`, a header comment with the handle, its meaning, the project and the hook; never the real name) and
  add a row to [references/cast.md](references/cast.md). If you're not in that repo, give the user both and offer to
  open a PR there.
- **The project:** commit `<handle>.png` (1x) and `<handle>-512.png` (8x nearest neighbour, `encodePng(rgb, 8)`) where
  the project keeps assets, and use the 512 in the README with alt text that names the handle and describes the
  character. Note in the README or a comment next to the PNGs that they're generated from the cast drawing, so nobody
  edits them by hand. If the project wants its own drift test, follow `scripts/draw-mascot.mjs` and
  `scripts/draw-mascot.test.mjs` in dead-claude-skills: they compare decoded scanlines (`decodePng`, `scanlines`), not
  PNG bytes.
