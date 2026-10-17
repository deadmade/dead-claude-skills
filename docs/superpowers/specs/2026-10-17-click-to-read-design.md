# Click-to-read: design (`md-pane` plugin)

## Intent

The user runs feature workflows (feature-flow, superpowers) where Claude writes Markdown documents the user has to
read and approve: `docs/features/<slug>/flow.md`, specs, plans. Claude names the path in its reply, and today the
user has to leave Claude Code to read it (a tmux split with `glow`, or ctrl+click handing the file to the OS opener).
They want what Claude Desktop gives them: click the path, read the document rendered beside the chat, keep the
conversation in view.

## Goals

1. In Claude's reply text, every path to an existing `.md` file becomes a link: bare (`docs/x/flow.md`), in inline
   code (`` `docs/x/flow.md` ``), or as a Markdown link Claude wrote (`[spec](docs/superpowers/specs/x.md)`).
   Relative paths resolve against the session cwd (`$.session.cwd()`); `~/` and absolute paths work too (so
   plan-mode plans under `~/.claude/plans/` open).
2. A plain click on such a link (Claude Code's fullscreen terminal renderer) opens the file in a pane beside the
   chat, rendered as Markdown the way replies are rendered, titled with the file name.
3. Ctrl/alt/cmd+click keeps today's behaviour: the terminal opens the `file://` link with the system opener.
4. One pane. Clicking another path swaps its document; clicking the open one keeps it as is.
5. The pane refreshes by itself when the open file changes on disk (Claude edits the spec after feedback).
6. Scroll with the wheel, arrows and page keys (the engine's pane scrolling); close with `q`, Esc, the frame's close
   mark or ctrl+x x.
7. Inside the pane, links and paths to existing `.md` files (relative to the open document's own folder) are
   clickable too, by the same rules as goal 1: a plain click swaps the pane to that document.
8. A missing, unreadable or too large (over `$.fs.read`'s 4 MiB) file shows a one-line message in the pane instead
   of the document.

## Non-goals

- Other file types than `.md`.
- Paths in tool rows (`Write(…)`, `Read(…)`, tool output), in user messages, or inside fenced code blocks.
- Comments, editing, or telling Claude what the user is reading (no `prompt.submit` context).
- Anything outside the fullscreen terminal: where plain clicks don't reach Claude Code (main-screen renderer,
  desktop, VS Code, mobile) the mod changes nothing the user relies on.

## Anti-goals (a failure even if it works)

- Replies look clearly different from today: same renderer, same text. Small differences on replies that contain a
  link (a missing bullet, a changed indent) are acceptable (user, 2026-10-17); replies without one are untouched.
- The chat gets slower while Claude streams a reply.
- Ctrl/cmd+click stops opening the file in the system app.

## Constraints

- A Claude Code mod in this repo: `plugins/md-pane/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.tsx`, `types/index.d.ts`, `tsconfig.json`, README; no npm dependencies. Mod API of Claude Code
  2.1.302 (`claude-code.d.ts` from the plugin-authoring skill).
- Mechanism (from the API, see flow.md Grounding): a `ui.render` hook on `AssistantMessage` returns a `Markdown`
  element with `key`, `onLinkPress` and `pressableLinks`, its `text` the reply with matched paths rewritten to
  `[label](file:///abs/path)` links. Only a plugin-drawn `Markdown` with `onLinkPress` receives plain clicks; links
  left out of `pressableLinks` keep the surface's behaviour. `isSummary` blocks pass through untouched (`next(e)`).
- A path becomes a link only if `$.fs.exists` says the file exists (the false-positive defence VS Code uses; see
  flow.md Prior art). Existence checks must not run per streamed token unbounded.
- `file:` hrefs: absolute, percent-encoded outside printable ASCII (OSC 8 spec); the press handler decodes them.
- Limits: 100 000 characters per drawing, `pressableLinks` ≤ 256 entries of ≤ 2048 characters. Past either, the
  reply draws without interception (paths may still be links for ctrl+click) rather than failing.
- Opt-in plugin: marketplace entry (description ends "Opt-in."), installer `CATEGORIES` `tools` page, the opt-in list
  in `installer/core.test.mjs`, root README plugin prose, `claude plugin test .` step in `.github/workflows/test.yml`
  (Linux and Windows) like cswap/night-city. Not in the dead-skills bundle. Version stays the repo's one version.

## Decided by the user

- Markdown only; read-only; reply text only; automatic refresh on change.
- Small visual differences on redrawn replies are fine; links inside the open document swap the pane.

## Settled in the grill (2026-10-17, user accepted every recommendation)

- Name `md-pane`.
- A bare name like `flow.md` resolves against the session cwd only; no project search.
- A `:line[:col]` suffix or `#fragment` is accepted, stripped, and the document opens at the top.
- Refresh: while the pane is open, check the file's mtime (`$.fs.stat`) about once a second and re-render on change;
  nothing runs while it's closed. Catches Claude's edits and the user's own.
- No back key; the reply's link opens the previous document again.
- The pane closes on session end (`/clear`, resume, new session) like tui-review's; the open document survives only a
  mod reload (`$.state`).
- A reply drawn before its file existed keeps the path plain until the engine redraws that reply; a negative
  existence result is never cached for the session.
- It ships as an opt-in plugin in this marketplace (accepted the playback).

## Builder's calls (made in brainstorming)

- Path detection: VS Code-style, a regex for path-shaped tokens ending in `.md` (suffixes per the grill), trailing
  `.,;:'")]` trimmed, then the existence check. Paths with spaces only when Claude
  wrote them as a Markdown link or in backticks.
- Pane width, title format, the error message wording: the builder's.
- Ctrl+click target is the same `file://` URL the mod writes; no OSC 8 hostname (the API draws the link).
- Only replies containing at least one matched path are redrawn by the mod; every other reply is `next(e)`.
- Rewriting runs only in the fullscreen terminal (`viewport.isFullscreen`); main screen, desktop, VS Code and
  mobile get `next(e)`.
- Documents over 100 000 characters (the API's per-drawing cap) are cut there with a one-line note; the largest
  flow/spec/plan in the repo today is ~28 000.
- Below 110 columns the pane opens inline above the prompt, as tui-review's does; no other way to open it.
- Windows paths count (the user runs Windows Terminal too): `C:\…\x.md`, `C:/…`, `file:///C:/…`, and `~` from the
  home directory on both OSes.
- The file name goes in a header line inside the pane (a lone pane draws no title).

## Open (no API doc says; the builder verifies early)

- Whether `e.link.href` for a `file:` link arrives percent-encoded.
- Whether `AssistantMessage` re-renders per streaming delta (drives the caching of existence checks).
- Whether a pane opened from a `Markdown` link press counts as "asked" for the width floor (documented for Button
  presses).
- How close the mod's `Markdown` draws to the engine's own reply drawing (anti-goal 1 allows small differences).
