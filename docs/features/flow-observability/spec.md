# Flow cockpit: design

Status: approved at Gate 1 (2026-10-28); four items changed by plan review round 1 (marked **(review 1)**), waiting for re-approval. Terms follow `GLOSSARY.md` § Flow cockpit. Calls marked
**(my call)** were made by Claude, not by the user. The shape is recorded in
[ADR 0005](../../adr/0005-flow-cockpit-outside-claude-code.md).

## Intent

The user runs one, at most two, Claude sessions at a time and works alongside them: they read what the agent edits
and thinks, think about the problem too, and step in where needed. The conductors (`plugins/flows`) already split the
work well. What is missing is seeing it:

- which flow runs are open, where each one stands, and which were never finished;
- during a build: what each task is for, which one is running, what went wrong (fix rounds, findings, decisions);
- what the main session and its subagents are doing right now.

Today that lives in long Markdown files written for agents, in the SDD build log and in transcripts, and the only
in-session view (the flows band) was turned off as "too much". The user wants a separate window that shows all of it
and is easy and nice to read. They don't want a website they host, and they want the app easy to change by agents,
the way pi's extensions are.

## Goals

1. **Everything at a glance.** A project picker and a list of what ran in that project's checkouts and worktrees:
   - **flow runs**, with conductor, phase, gates, open deviations, task progress during a build, status and last
     activity, with filter and sort; unfinished ones stand out;
   - **audits**, with their scope line, findings per severity, the user's picks and how many were fixed; an audit is
     open while a pick has no fix recorded;
   - **loose sessions** from the last 7 days, in their own group, so any Claude session's activity can be found.
2. **A flow run you can read.** Selecting one shows, built from the documents' structure rather than rendered
   Markdown: the `now:` sentence, the phases and gates as a stepper, the decisions taken, open deviations, and during a
   build each task as a card with what it does, its state and what went wrong, and a graph when the plan names
   dependencies.
3. **Docs drawn properly.** spec.md, plan.md and flow.md shown through the same enhancer: recognised parts as UI,
   everything else as Markdown, Mermaid blocks as diagrams.
4. **Live activity.** What the Claude session and each subagent are doing: tool calls with their input (edits as
   diffs, commands), replies, agent start and stop, questions and permission prompts that came up. The raw
   conversation is one click away, not the main view.
5. **Readable documents at the source.** flow.md and plan.md follow a format the app recognises (below). The build
   adds the format's parts to all three templates (`feature-flow`, `research-flow`, the shared `build-template.md`)
   and the conductor text that keeps them filled; the user reshapes the rest of the wording afterwards, and the checks
   catch a part that goes missing.
6. **Changeable by agents.** Every view, the built-in ones included, is a TypeScript file in a folder the app watches
   and reloads on change, against a documented interface. A skill tells Claude how to write or change a view.
7. **Linux (through Nix) and Windows x64.**

## Non-goals

- Interacting with Claude from the app: no answering questions or permissions, no starting or resuming flows, no
  typing into sessions. Also no command in Claude Code that opens the app.
- Notifications from the app. The existing ones (Stop, questions, permission prompts) stay as they are.
- Model-written summaries (Haiku). Considered and not picked: the documents get better instead.
- A readable format for the SDD build log, or for audit reports beyond the `Picks:`/`Fixed` lines. The app reads the
  rest as it is.
- Migrating older flow.md files.
- Running plan tasks in parallel. `Depends on:` is for drawing; the build still runs tasks in order.
- A hosted or browser web UI, macOS, ARM, Linux outside Nix, team or multi-user use, tickets.

## Anti-goals

- **A second place where work is managed.** flow.md stays the record; the app never writes to a repository or to
  Claude Code's files. No tickets, no state of its own about runs beyond caches it can rebuild.
- **Noise.** Detail stays one step away (E4, E5, E10 in flow.md's Evidence): the list shows state, a run shows its
  shape, the raw conversation and tool output open on demand.
- **Hard to read.** If a part of a run can't be shown as a short sentence or a small component, it waits for the
  format to say it better rather than being dumped as text.

## Constraints

- Repo rules (CLAUDE.md): one version for everything, `check-repo` consistency, the installer downloads binaries per
  `BIN_TARGETS`, no runtime npm dependencies in the installer, vendored packs are never edited (changes to pack rules
  go through conductor text with an `overrides` marker).
- Claude Code formats are not stable: hook payloads are documented, transcript JSONL and `~/.claude/jobs/` are not.
  Subagent transcripts keep tool calls and text, but thinking blocks are stored empty (checked in this session).
- Hooks run per event; on every tool call they must not slow Claude Code (async, no output).
- Transcripts and build logs carry text from web pages and tools: untrusted.
- The user's terminal setup (Ghostty, tmux, Windows Terminal, Night City) stays as it is.

## Approaches

Recorded in flow.md **Options** with the evidence, and in ADR 0005. Picked: Claude Code stays in the user's terminal;
hooks record what transcripts lack; a separate desktop window (Tauri: Rust core,
TypeScript views, the system's webview) reads that capture plus the run documents. Rejected: a pane inside Claude Code,
a terminal viewer, a cockpit hosting Claude Code in embedded terminals, agent teams in tmux panes, a local web server,
Electron, Rust views.

The throwaway prototype (scratchpad, recorded in flow.md) settled the list's shape ("the shape feels right") and
showed that styling raw agent text doesn't make it readable.

## The document format (the contract)

The app recognises these parts. Wording around them is free; a document without them still shows, as Markdown.

**flow.md**

- Frontmatter: `flow:` and `phase:` (as today), plus `now:`, one plain sentence of where the run stands and what comes
  next. **(my call: frontmatter, so it parses without reading the body)** The conductor rewrites it after every phase
  and at every stop where it waits for the user (a gate, a deviation, a question); a conductor called inline writes
  into its caller's flow.md. At every such stop it starts with `Waiting for you` **(review 2)**. Example:
  `now: Waiting for you to approve the plan (Gate 2).`
- `## Gates`: one line per gate, `- Gate <n>, <what>: <date>[, <extra>]`; empty after the colon while open; a
  reopening appended as `Reopened <date>: <why>`. (Today's shape, made strict.)
- `## Options`: one `### <decision>` per decision, with a `Picked:` line naming the choice in plain words, then the
  reasons and rejected options as free text.
- `## Deviations`: one `### <deviation>` each, with a `Status: open` or `Status: decided <date>: <what>` line.
- Other sections (Request, Grounding, Prior art, Tasks, Rulings, Walkthrough, Run verdict) keep their headings so the
  app can place them; their content is shown as Markdown.
- An older flow.md without these parts shows what parses (phase, gates, the build log) and Markdown for the rest; with
  no `now:`, the app shows the phase in its place.

**plan.md**

- Each task stays `### Task <n>: <title>` and gains, right below it:
  - `**Does:** <one plain sentence: what this task changes, for a reader who doesn't know the code>`
  - `**Depends on:** Task <n>, Task <m>` or `none`
- `**Files:**` and the rest stay as `writing-plans` writes them.
- `writing-plans` is vendored, so the requirement goes into flows' Phase 4 text with an
  `<!-- overrides superpowers/skills/writing-plans/SKILL.md: "..." -->` marker if it contradicts a pack sentence.

**Diagrams.** One line in `flow-rules.md`: the user reads specs, plans and flow.md in a viewer that draws Mermaid;
use a diagram where it explains something better than prose. Never required.

**Audit reports** **(review 1)**. flow-rules' Reports section gains one line shape: `Picks: <finding numbers> | none`,
and per picked finding a `Fixed <date>: <number>` line once its fix passed its check. An audit is open while a pick has
no `Fixed` line. Older reports without these lines show as Markdown with their state unknown.

**Gates in the build conductors** **(review 1)**. `/implement`, `/fix-flow` and `/upgrade` write numbered gate lines
in the same shape (`- Gate 1, <what>: <date>`), and the templates leave the date empty while open instead of a
`<date>` placeholder.

**Checks.** check-repo fails when a template lacks a contract part (`now:`, the Gates shape, `Does:`/`Depends on:` in
the plan instructions of feature-flow, implement and upgrade, the `Picks:` line). The app's parser tests run against the real templates and against older flow.md files from
`docs/features/`, which must still load.

## Design checkpoint

The flow run view is the part the user found unreadable twice. The plan stops once the core reads the new format:
a clickable mockup of the flow run view, built from this run's own flow.md and plan in the new format, goes to the
user, and the real views are built only after they approve it.

## Status

- **Waiting on you** **(review 1)**: the capture shows an AskUserQuestion that started and hasn't ended (no later
  result, failure or prompt), or a permission prompt with no later event in that Claude session; or the flow run's
  `now:` starts with `Waiting for you`. Without capture, only `now:` counts. (A Stop doesn't fire while a question
  dialog is open, so "Stop after a question" is not a signal.)
- **Working** **(review 1)**: the Claude session's transcript grew in the last 2 minutes. Transcripts are written as
  the session runs, so this needs no capture.
- **Idle:** not done, not waiting, not working.
- **Stale:** not done and nothing happened for 3 days.
- **Done:** `phase: done`.

## The parts

1. **The flow-cockpit plugin** (a plain opt-in under `plugins/opt-in/flow-cockpit`; flows doesn't depend on it). It
   holds the capture hooks and the skill that teaches Claude to write or change a view. Command hooks, one
   stdlib Node script like `plugins/default/hooks/notify.mjs`, async, append one JSON line per event to a
   per-session file under the user's home (outside any repo, user-only permissions). **(review 1)** The capture
   records only what transcripts lack: SessionStart, SessionEnd, UserPromptSubmit, Stop, SubagentStart, SubagentStop,
   Notification, PermissionRequest (observed only, never decided), and PreToolUse, PostToolUse and PostToolUseFailure
   for AskUserQuestion only. Tool calls, edits, replies and results come from the transcripts. No mod (recorded in
   flow.md Options; revisited only if a gap shows).
2. **The flow-cockpit app** (Rust, `crates/flow-cockpit`, binary `flow-cockpit`). The core discovers projects from the folders
   Claude Code has run in (checkouts folded by git remote, by folder name without one; a project can be hidden in the
   config), their worktrees, flow runs, audits and Claude sessions; parses flow.md, plan.md and audit reports into a
   typed model; reads SDD build logs; links Claude sessions to flow runs (a session that wrote or edited the run's
   flow.md); takes activity from transcripts and live state from the capture; checks the known folders for changes
   and pushes them to the views. Read-only on everything it
   doesn't own.
3. **Views** (TypeScript, in the Tauri window). The built-in ones (list, flow run, docs, activity) are embedded in
   the app binary; `flow-cockpit --print-view <id>` prints one **(review 1)**. A same-named file in a views folder replaces one, a new name adds one:
   - global: `~/.config/flow-cockpit/views/` on Linux, `%APPDATA%\flow-cockpit\views\` on Windows;
   - per repository: `.flow-cockpit/views/`, loaded only for repositories trusted in the config;
   - settings: `config.toml` next to the global views folder (trusted repositories, hidden projects).
     To change a built-in, the skill writes the printed copy into the global folder and edits it; the app marks replaced views,
     deleting the copy restores the original, and app updates never touch the copies. `flow-cockpit --print-types`
     prints the view interface and data types for views outside the repo **(review 2)**. Types are stripped on load; the
     interface is a generated `.d.ts`. Shared building blocks: sanitised Markdown, Mermaid, diffs, stepper, cards.
4. **Distribution.** Linux: a package in the repo's `flake.nix` (`nix run`, or the user's system config), because a
   Tauri window links the system's GTK and WebKit and can't be a static musl download like tui-review and web-mcp.
   Windows x64: a release build the installer downloads. The installer offers the flow-cockpit plugin as opt-in on
   both; on Windows it also downloads the app to `%USERPROFILE%\.claude\bin\flow-cockpit.exe` and prints that path
   (no shortcut) **(review 1)**; on Linux it prints how to get it, pinned to the installed release
   (`nix run github:deadmade/dead-claude-skills/v<version>#flow-cockpit`, or the package for the system config).

## Slices **(review 1)**

1. **Slice 1, used daily before slice 2 starts:** the format, the parsers, the index (status from `now:`, transcripts
   and documents), the window, the view runtime, the built-in views, the views skill, the Nix package and CI.
   On Windows the plugin stays hidden until slice 2 ships the app there **(review 2)**.
2. **Slice 2:** the capture hooks and live "waiting" state, per-repository views and trust, the Windows release and
   installer step.

## Trust and history **(my calls, from the builder check)**

- **Views are code.** The built-in views and the user's global views folder load always. A repository's own views
  folder loads only for repositories the user has listed in the app's config file; a repository can't put code in the
  window by being cloned. Views run under a strict content policy (no network, no remote scripts) and get data only
  through the core's read-only interface.
- **History without capture.** Every Claude session shows its conversation and tool calls from its transcript, as the
  prototype did. Without capture, only "waiting on you" is limited (to `now:`). The transcript reader is the fallback, not a second
  event source, and it tolerates entries it doesn't know.

## Where each cross-cutting concern is decided

- The document format (flow.md, plan.md, audit reports): resolved in the core's document parser; never seen by the
  views (they get the typed model plus raw Markdown for unrecognised parts) or by capture.
- Which Claude session belongs to which flow run, and status: resolved in the core's run index; never seen by capture
  (it records session facts only) or by the views.
- Project identity (several checkouts, worktrees): resolved in the core's project index; the views see a project id
  and name.
- Claude Code's formats (hook payloads, transcript JSONL): resolved in capture (payload to event line) and in the
  core's transcript reader; never seen by the views.
- Untrusted text to HTML: resolved in the views' shared Markdown block (sanitiser); the core emits text, never HTML;
  individual views never inject raw HTML from data.
- Types across Rust and TypeScript: resolved in the generated `.d.ts`; never written by hand in a view.

## Decided by the user

- One or two sessions, working alongside them; not a fleet of parallel agents (2026-10-28).
- A separate window, not a hosted website; Claude Code stays in the terminal (2026-10-28).
- Watch only, no interaction for now (2026-10-28).
- Rust core, TypeScript views (2026-10-28).
- Agents may write diagrams, never forced to (2026-10-28).
- The app easy to change by agents, like pi (2026-10-28).
- Readable documents at the source, flow.md and plan.md, not Haiku summaries (2026-10-28).
- Easy and nice to read is a goal of its own (2026-10-28).
- The prototype's list-then-run shape (2026-10-28).
- No measurable target; moved from `/research-flow` to `/feature-flow` (2026-10-28).
- Linux through a Nix package, Windows through a release download (2026-10-28, builder check).
- The build adds the format parts to the templates; the user polishes the wording (2026-10-28, builder check).
- The list holds flow runs, audits and loose sessions (2026-10-28, builder check).
- Grill round 1 (2026-10-28): the glossary terms; the names flow-cockpit and flow-capture (merged into one plugin, flow-cockpit, in round 2); the plugin a plain
  opt-in, the Rust app in `crates/`; who rewrites `now:`; the status rules; audits as written; loose sessions from 7
  days; projects found automatically; no migration of older runs; no command to open the app from Claude Code; no
  notifications from the app; ADR 0005; the six seam lines.
- Plan review round 2 (2026-10-28): all fixes applied, including `now:` starting with `Waiting for you` at every stop
  and the plugin hidden on Windows during slice 1.
- Plan review round 1 (2026-10-28): two slices; capture only what transcripts lack; built-in views embedded, the
  Windows app at a fixed path with no shortcut; the review's technical fixes, including the audit `Picks:` line.
- Grill round 2 (2026-10-28): one plugin named flow-cockpit (capture hooks and the views skill); the installer prints
  the Nix command on Linux; the views and config paths; built-ins changed through copies in the global folder;
  `Depends on:` for drawing only; the design checkpoint before the views.

## Left to the builder

The Tauri, file-watching, type-stripping, type-generation, Markdown, sanitiser and Mermaid libraries and versions;
the exact view interface (within: small, typed, hot-reloaded); where capture files live and how long they are kept;
the "working" threshold; the visual design within the Night City palette and the readability bar the prototype set.
