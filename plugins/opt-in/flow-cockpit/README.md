# flow-cockpit

The flow cockpit is a desktop window that shows what your flow runs are doing: every project's flow runs, audits and
loose Claude sessions in a list, and for one run its phases, gates, tasks, decisions, documents and the sessions that
worked on it. It reads the flow files, plans, build logs and Claude Code's transcripts, writes nothing, and redraws
within a few seconds when they change.

Each screen is a **view**, a TypeScript file in an **extension**, a folder the app loads from disk. The four default
extensions ship with the app; your own add to them or replace them, and any of them can be switched off. The app needs
nothing from Claude Code for that. This plugin carries the `views` skill, which teaches Claude to write and change
views: ask for a new screen or tab, or for a change to one, and it appears in the open window without a restart.

Linux only for now; Windows comes with the next slice.

The plugin also carries **capture hooks**. They record what transcripts lack: questions Claude asked you, permission
prompts, agents starting and stopping, turns ending. Each Claude session gets one line-per-event file
`<session id>.jsonl` in `$XDG_STATE_HOME/flow-cockpit/capture/` (default `~/.local/state/flow-cockpit/capture/`;
`%LOCALAPPDATA%\flow-cockpit\capture\` on Windows), the folder readable by you only. A session start deletes capture
files older than 30 days. The hooks only watch: they never answer a prompt, block a tool or print anything, and they
write nothing outside that folder. A permission prompt records which tool asked, not its input. Long text is shortened: once the questions pass 16 KiB each keeps only its text (cut to 4,096
characters) and its header (cut to 64), the options are dropped and trailing questions are dropped until it fits, and a notification message is cut at 1,024 characters; such a line carries
`questions_cut` or `message_cut`.

The window shows a run as waiting on you while one of its sessions has a question or permission prompt open. Allowing a prompt writes nothing it can see, so the run keeps saying it waits on you until the allowed tool finishes.

## Install

1. The app, from this repository's flake (it links the system's GTK and WebKit, so it is not a plain download):
   `nix run github:deadmade/dead-claude-skills#flow-cockpit`, or `packages.x86_64-linux.flow-cockpit` from the flake
   in your system config. From a checkout: `nix build .#flow-cockpit`.
2. The plugin: pick it in the installer (see the [main README](../../../README.md)), on its Tools page. The installer
   hides it on Windows until the app is built there.

## Use

- `flow-cockpit` opens the window. `flow-cockpit --version`, `--print-types` (the view interface and data types as one
  `.d.ts`, declaring the module `flow-cockpit` that views import their types from) and `--print-paths` (the default
  extensions folder in use, yours, and `config.toml`) print and exit.
- An extension is a folder `<name>/` with one or more view files `<id>.ts` and an optional `style.css`. The defaults,
  `list`, `run`, `docs` and `activity`, are installed with the app (`share/flow-cockpit/extensions/` in the Nix
  package). Yours live in `~/.config/flow-cockpit/extensions/` (`$XDG_CONFIG_HOME`): a new name adds views, a
  default's name replaces that whole default, and deleting it brings the default back. To change a default, copy its
  folder there. Links are ignored: put real folders and files there. The old `~/.config/flow-cockpit/views/` folder
  is no longer read.
- `~/.config/flow-cockpit/config.toml`, edited by hand, can switch extensions off (`disabled = ["<name>"]`) and hide
  projects (`hidden = ["<id or name>"]`). The open window picks a change up within a few seconds.
- `FLOW_COCKPIT_EXTENSIONS=<folder>` loads the defaults from another folder, such as a checkout's
  `crates/flow-cockpit/extensions`, so edits to them show without a rebuild.
- On Linux the app turns WebKitGTK's DMA-BUF renderer off, because it crashes the window on NVIDIA under Wayland;
  `WEBKIT_DISABLE_DMABUF_RENDERER=0` turns it back on.
- A view that breaks shows its error in its own place; the rest of the window keeps working.
