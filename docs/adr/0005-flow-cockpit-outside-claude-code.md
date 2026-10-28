# The flow cockpit is a desktop window of its own, fed by hooks

Everything else this repo adds to Claude Code's interface is a mod drawn inside it. The flow cockpit isn't: it is a
separate desktop window (Tauri: a Rust core, TypeScript views, the system's webview) that reads the flow runs' documents,
the SDD build logs, the transcripts and a capture that hooks write per Claude session. The user wanted to see their
flow runs and what each agent does, with real diagrams and on Linux and Windows, without a website they host, and
found the in-session flows band "too much". Claude Code stays in the user's terminal; the window only watches.

## Considered options

- **A mod pane or band inside Claude Code.** Rejected: a mod sees only its own session, draws diagrams only as text,
  and shares the chat's width; the flows band was already switched off.
- **A terminal viewer in its own pane.** Rejected: diagrams as text, which the user ruled out.
- **A cockpit that runs Claude Code inside it** (embedded terminals). Rejected: the riskiest part, and it gives up the
  user's terminal setup.
- **Agent teams in tmux split panes.** Not picked: no split panes in Windows Terminal.
- **A local web server and browser UI** (like the Nexus harness). Rejected by the user: no website to host.
- **Electron.** Rejected for a much larger download and a release kind the repo doesn't build; Tauri fits the existing
  Rust release builds.

## Consequences

- **Two places to keep in step:** the flows' document format is a contract with the app's parser, guarded by
  check-repo.
- **Linux ships through Nix,** not as a downloaded static binary like tui-review and web-mcp: a Tauri window links
  the system's GTK and WebKit.
- **"Waiting on you" needs the capture plugin.** Everything else, live activity included, comes from the documents
  and the transcripts.
