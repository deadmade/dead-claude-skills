# Headroom trim: design

## Intent

Claude Code sessions spend a large share of their context on tool output. headroom
(https://github.com/headroomlabs-ai/headroom, Python package `headroom-ai`) already has a content router and
compressors that shrink tool results while protecting what must stay exact. Its supported ways in are a proxy that
intercepts every API call and a server of its own with telemetry, and the user wants neither. This plugin uses only
headroom's library, inside a local process we control, and gives Claude the trimmed result through a Claude Code hook.

## Goals

- Shrink tool output before Claude reads it, using headroom's no-ML lossy compression. The transcript replay saved
  7.0% of tool-output tokens for Bash, PowerShell, Grep, Glob and MCP, changing 28.9% of those results.
- headroom decides what to trim, per result, with its own router: Read stays byte-exact, errors, short results and
  recent code are protected, and anything that grows is reverted. We add no trimming rules.
- No noticeable slowdown: a local round trip of a few ms per tool call. When the server is down, Claude gets the
  original output after a refused connection (about 30 ms).
- No network from the compression process: no telemetry, no update check, no model download, nothing outbound.
- Works on every machine the installer sets up (Windows x64, Linux x64), including ones without Python or uv.

## Non-goals

- Retrieving cut content. A cut is final. headroom's `Retrieve more: hash=…` note (common on cut logs) stays
  unresolvable, and Claude
  re-runs the command when it needs more.
- Compressing the conversation history, user messages or anything but a tool result as it arrives.
- ML compression (Kompress): measured, not worth a GPU or 1 GB of models.
- macOS or ARM.

## Anti-goals

- A proxy, headroom's own server, or any headroom code path that sends data out.
- Compression logic or per-tool trimming rules written by us.
- A failure in the plugin that blocks, delays or breaks a tool call. Every failure falls back to the original output.

## Constraints

- headroom-ai pinned (0.42.0 today), no ML extras, `kompress_model="disabled"`.
- Claude Code: SessionStart allows only `command` and `mcp_tool` hooks, not `http`. An http hook's connection
  failure, non-2xx status or non-JSON body is a non-blocking error. `updatedToolOutput` must match the tool's output
  shape, or Claude Code ignores it.
- Repo rules (CLAUDE.md): one repo version in every `plugin.json`; installer logic in `core/` or `system/` with tests,
  Node stdlib only, programs started through `system/proc.ts`; hook scripts are Node stdlib `.mjs` with their logic in
  a tested module.

## Approaches

Decided with the user on 2026-10-30. The rejected options are in flow.md under **Options**.

- **Shape:** one shared server on 127.0.0.1, called by a PostToolUse `type: "http"` hook, started by a SessionStart
  command hook, exiting by itself when idle. Rejected: an MCP server per session, headroom's proxy or server, and the
  Rust core alone.
- **Packaging (D):** the server is a tiny uv project (`pyproject.toml` + `uv.lock`) run by uv from its lockfile. The
  installer keeps a pinned uv and pre-builds the environment. Rejected: uv on PATH only, a PyInstaller exe, an
  installer-built venv, and the launcher downloading uv. A PEP 723 script was the first shape; it became a project so
  Dependabot can bump it (below).
- **Updates (2026-10-30):** headroom is updated like any other dependency. Dependabot's `uv` ecosystem opens the
  weekly bump PR, grouped like Cargo. On a machine, the launcher replaces a server whose lockfile is outdated and
  fetches the new wheels once with `uv sync`.
- **Local port trust (2026-10-30):** no secret between the hook and the server. The user's machines are single-user;
  the README says that whatever holds the port reads every tool result and can rewrite it.
- **Lost content (1):** lossy, and a cut is final. Rejected: a retrieve route, and lossless-only (it saved 0.0%).

## Design

### Parts

A new opt-in plugin, `headroom-trim`, in `plugins/opt-in/headroom-trim/`:

| Part                                | What it does                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/` (`pyproject.toml`, `uv.lock`, `server.py`) | uv project: the network guard, headroom's offline switches, the HTTP server, the response walk, the idle exit, the log.                                                 |
| `hooks/hooks.json`                  | SessionStart: `node launch.mjs`. PostToolUse, matcher `*`: `type: "http"` to `http://127.0.0.1:<port>/hook`, short timeout.                                                |
| `hooks/launch.mjs` + tested module  | Checks `/health`; replaces a server whose lockfile hash differs; finds uv (`~/.claude/bin`, then absolute PATH entries) and starts `uv run --locked` detached and hidden. Returns at once. |
| `README.md`, marketplace entry      | What it does, what it needs, how to turn it off, what the local port means. The description ends "Opt-in."                                                                                             |

Installer:

| Part                                         | What it does                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installer/assets/uv.json`                   | The uv pin: version and sha256 per platform (`x86_64-pc-windows-msvc.zip`, `x86_64-unknown-linux-musl.tar.gz`).                                      |
| `core/` plan + `steps/uv.ts`                 | With headroom-trim selected: once `~/.claude/bin/uv[.exe]` exists it wins and is upgraded when older than the pin (download, check, unpack, replace); a uv on PATH at or above the pin is used only while ours is absent. |
| the same step                                | Run `uv sync` in `<plugin>/server` so Python and the wheels are fetched at install time, then fetch tiktoken's vocabulary into plugin data. |
| `scripts/sync-uv.mjs` + a `SOURCES` entry    | Bumps the uv pin weekly, as `sync-agent-browser.mjs` does for agent-browser.                                                                         |
| `.github/dependabot.yml`                     | A `uv` entry for `plugins/opt-in/headroom-trim/server`, weekly, grouped. If Dependabot can't read it, a `sync.yml` job does the bump instead.        |

### A tool call

1. Claude Code posts the PostToolUse JSON (`tool_name`, `tool_input`, `tool_response`, …) to the server.
2. The server walks `tool_response`. Each string in it goes to headroom's `compress()` as the content of a
   `tool_result` for a `tool_use` named `tool_name`, with no other history. The measured 7.0% came from exactly
   this: one result per `compress()` call, `protect_recent=0`. headroom's router decides whether and how to trim it.
3. If any string came back different, the server answers 200 with
   `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": <the same structure, strings
   replaced>}}`. Otherwise it answers 200 with an empty body, and Claude Code keeps the original.
4. Any exception inside the server answers 200 with an empty body. The hook never blocks.

### Start, stop, update

- The launcher runs on every SessionStart (startup, resume, clear, compact). It returns within a few hundred ms
  whatever happens. The session doesn't wait for the server, so the first tool calls of a session may go untrimmed.
- Two launchers racing both start a server. The second fails to bind the port and exits; the port is the lock.
- The server exits after 30 minutes without a request.
- `HEADROOM_TRIM=off` in a session's environment stops that session's launcher from starting a server. A server
  another session started still trims it; to turn trimming off everywhere, disable the plugin. (Plan review,
  2026-10-30: the per-session header was cut.)
- `/health` reports the server's identity and the plugin version it came from. The identity is a hash of the
  server's code and lockfile (`uv.lock`, `pyproject.toml`, `server/*.py`), so a release that changes only server
  code also replaces it. A launcher whose plugin copy has a different identity and a version at or above the
  server's tells that server to exit (`POST /shutdown`, loopback only), then starts its own. A launcher from an
  older version (a session started before a plugin update) leaves the newer server alone. (Final review,
  2026-10-30: the identity was the lockfile alone, and pre-update sessions swapped the server back.) `uv run --locked` fetches
  the new wheels itself when the lockfile changed, then starts the server; with a current environment it fetches
  nothing. Only uv touches the network, never the server. Until it is up, the session runs untrimmed. Rerunning the installer
  does the same fetch up front.

### No network

- Before importing headroom, the server sets `HEADROOM_OFFLINE=1`, `HEADROOM_BEACON=off`, `HEADROOM_TELEMETRY=off`,
  `DO_NOT_TRACK=1`, `HEADROOM_UPDATE_CHECK=off`, `HF_HUB_OFFLINE=1`, and replaces headroom's session-telemetry
  senders with no-ops. It also points headroom's workspace (`HEADROOM_WORKSPACE_DIR`, default `~/.headroom`) into plugin data
  and keeps CCR in memory (`HEADROOM_CCR_BACKEND=memory`), so nothing is written outside plugin data.
- headroom counts tokens with tiktoken's `o200k_base` vocabulary, which tiktoken downloads on first use. The server
  sets `TIKTOKEN_CACHE_DIR=<plugin data>/tiktoken`, and the installer fetches the vocabulary into it after `uv sync`.
  Without it (the plugin installed without the installer, or the fetch failed) the guard blocks the download and
  headroom falls back to its estimate (about 3.5 characters per token). (Task 3 review, 2026-10-30: the vocabulary
  had come from a cache in `%TEMP%` left by the measurements.)
- It installs a PEP 578 audit hook first, which raises on any `socket.connect`, `socket.sendto`, `socket.sendmsg`
  or name lookup (`getaddrinfo`, `gethostbyname`, `gethostbyname_ex`, `gethostbyaddr`, `getnameinfo`) that isn't
  loopback. Tested before the flow: with every switch
  forced on, it blocked the beacon's DNS lookup, HuggingFace, urllib and raw sockets, and let loopback through.
  headroom's native extension imports no socket library, so everything goes through Python.
- uv fetches from PyPI only when the lockfile changed since the environment was built.

### Visibility

Silent in the session. _My call (the user didn't choose):_ the server appends one line per changed result to a log in
`${CLAUDE_PLUGIN_DATA}` (or the plugin's data folder): time, tool, tokens before and after. No text of the result.
The launcher writes one line per start to `launcher.log`, and the server's own output (uv's errors, a failed import,
the port already taken) goes to `server.log`, cut back when it passes about 1 MB, so a session that stays untrimmed
can be explained. (Final review, 2026-10-30.)

## Decided in the grill (2026-10-30)

- The plugin is `headroom-trim` in `plugins/opt-in/headroom-trim/`. Terms: trim server, launcher, trim (GLOSSARY.md).
- **Port:** a fixed, unusual port (47811), written only in `hooks/hooks.json`: in the http hook's `url`, and as the
  launcher's argument. If another program holds it, sessions go untrimmed.
- **Environment:** `UV_PROJECT_ENVIRONMENT=<plugin data>/venv`, set by the launcher and the installer step. Plugin
  data is `~/.claude/plugins/data/<id>/`, kept across updates and deleted on uninstall.
- **Timings:** hook timeout 5 s; idle exit after 30 min; the launcher returns within about 300 ms.
- **Log:** `<plugin data>/trim.log`, one JSON line per changed result (time, tool, tokens before and after, no text),
  rotated to `trim.log.1` at 1 MB.
- **Python:** `requires-python = "==3.13.*"`.
- **Installer:** the Tools page. If uv can't be placed, the "missing on PATH" hint applies. Deselecting uninstalls the
  plugin, Claude Code deletes its data, and `~/.claude/bin/uv` stays.
- **Tests:** the server uses stdlib `unittest`, run with `uv run` in `test.yml` on both runners (`astral-sh/setup-uv`
  pinned). The launcher uses `node --test`, added to the globs in `package.json` and `flake.nix`.

### Seams

- No network: resolved in the trim server's startup, before headroom is imported; never seen by request handling, the
  response walk, the launcher or the installer.
- Off switch: resolved in the launcher's start check; never seen by the trim server or headroom.
- Port, uv path, plugin data path: resolved in `hooks/hooks.json` and the launcher, passed to the trim server as
  arguments or environment; never seen by the trim server's request handling.
- Tool output shape: resolved in the trim server's response walk; never seen by the launcher, the hook config or
  headroom.
- Lockfile version: resolved between the launcher and `/health`; never seen by request handling.

## Left to the builder

- How to start a hidden, detached process on Windows and Linux from Node so it outlives the session.
- Proving per tool, on the installed Claude Code version, that `updatedToolOutput` with the walked structure is
  accepted, as the first task. Use real `tool_response` samples captured from the installed Claude Code as test
  fixtures. _My call:_ if Bash, PowerShell or Grep isn't honoured, the build stops and the user decides.
- Checking that Dependabot's `uv` ecosystem reads `server/uv.lock`; if not, the `sync.yml` fallback.
- Where the plugin sits on the installer's pages, and the `BINARIES` hint if uv can't be placed.
- CI: how the server's Python tests run on both runners.
