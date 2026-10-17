# md-pane

Click a `.md` path in Claude's reply and the file opens, rendered, in a pane beside the chat. Made for reading the
specs, plans and flow files Claude writes during a feature workflow without leaving Claude Code.

## Install

    /plugin install md-pane@dead-claude-skills

The installer offers it on its Tools page. It needs nothing else.

## Use

Turn on Claude Code's fullscreen renderer once (`/tui fullscreen`): only there do plain clicks reach a mod.

- Any path in Claude's reply that names an existing `.md` file becomes a link: bare (`docs/x/flow.md`), in backticks,
  or as a Markdown link. Relative paths count from the session's folder; `~/…` and absolute paths work too, Windows
  ones included. A `:12` or `#section` after the path is fine; the file still opens at the top.
- **Click** opens it in the pane (docked beside the chat from 110 columns, above the prompt below that). Clicking
  another path swaps the document. **Ctrl+click** (cmd+click where your terminal keeps it) opens the file in your
  system app, as before.
- Links and paths inside the open document work the same way: relative to the document's folder, falling back to the
  session's folder for repo-relative paths.
- The pane follows the file: when Claude (or you) edits it, the pane redraws within a second.
- Scroll with the wheel, arrows or page keys; close with `q`, Esc, the frame's close mark or ctrl+x x. A new
  conversation (`/clear`, a resume) closes it.

## Limits

- Only `.md` files, only Claude's reply text: not tool rows, your own messages or fenced code blocks.
- A path becomes a link only if the file exists when the reply is drawn; a reply that named a file before Claude wrote
  it keeps it plain until that reply is drawn again.
- Replies that contain a link are drawn by the mod, so they can differ slightly from Claude Code's own drawing.
- Files over 4 MiB aren't opened; documents past 99 000 characters are cut at a line with a note.
- Outside the fullscreen terminal (main-screen renderer, desktop, VS Code, mobile) nothing changes.
