---
flow: feature
phase: execute
---

# Headroom trim: flow

## Request

> lets do that properly pls!

Said after this design was proposed in the same session: an opt-in plugin that shrinks tool output with headroom's
Python library (`headroom-ai`, no ML, no headroom server, no telemetry, network cut for the process). A PostToolUse
`type: "http"` hook posts each tool result to a shared local Python server on 127.0.0.1, which returns
`updatedToolOutput`; a SessionStart command hook starts the server when it isn't running, and the server stops itself
after an idle timeout. Constraints the user set: no rules of our own on what gets trimmed (headroom's router decides),
no noticeable agent slowdown, no compression logic written by us.

Measured before the flow (scratchpad, not in the repo): headroom without ML saves 7.0% of hook-scope tool-output
tokens at p50 1.4 ms per call in-process; a resident no-ML process uses about 100 MB; a refused loopback connect costs
about 32 ms on Windows; a PEP 578 audit hook blocked every non-loopback connect and DNS lookup, beacon included.

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs: [0007 Python runs through an installer-managed uv](../../adr/0007-python-through-installer-uv.md)
- Glossary: trim server, launcher, trim ([GLOSSARY.md](../../../GLOSSARY.md))

## Gates

- Gate 1, spec approved: 2026-10-30. Reopened 2026-10-30: plan review changed the uv start (no `--offline`, no
  fallback), how the launcher finds uv (no `uvPath` setting) and the off switch (no header). Re-approved
  2026-10-30.
- Gate 2, plan approved: 2026-10-30, execution: subagent-driven

## Skipped

## Grounding

Three Explore agents (plugin anatomy, installer, runtime patterns), 2026-10-30. The synthesis is written here, not
by a separate explainer.

- **Plugin:** goes in `plugins/opt-in/<name>/`, found by `scripts/plugin-dirs.mjs`. It needs:
  - a marketplace entry whose description ends "Opt-in."
  - a `plugin.json` at the repo version (0.6.0 now; check-repo fails on drift; `release.mjs` bumps it)
  - `hooks/hooks.json`, which Claude Code discovers on its own
  - check-repo doesn't look at Python files. treefmt has no Python formatter and skips them silently.
- **Hooks today:** all are `type: "command"`. The only SessionStart hook prints `rules.md`. notify is `async` and
  swallows every error (`plugins/default/hooks/lib.mjs`). prose-check uses the exec form (`command` + `args`) and
  fails open (`plugins/flows/hooks/prose-check.mjs`). No http hook, no `CLAUDE_PLUGIN_DATA`, and no process outlives
  a hook anywhere.
- **Long-lived processes** exist only through Claude Code's lifecycles: web-mcp is a stdio MCP server (`.mcp.json`,
  `${user_config.binPath}`), and tui-review is spawned by its mod. web-mcp's file lock (`crates/web-mcp/src/profile.rs`
  `lock_file`) is the only single-instance pattern.
- **Tests:** `npm test` globs only `plugins/default/hooks/*.test.mjs` and `plugins/flows/hooks/*.test.mjs`. The globs
  are repeated in `flake.nix` (the run-tests command and the pre-commit `files` regex). CI (`test.yml`) sets up no
  Python, and Windows runners have `python`/`py`, not `python3`.
- **Installer:**
  - A new marketplace plugin becomes an opt-in on its own; the "Other" page holds it unless `CATEGORIES` lists it.
  - It installs no Python, uv or venv. `BINARIES` in `core/binaries.ts` only prints hints for missing tools on PATH:
    `uv` for graphify, `python3` for the bundle.
  - Tool paths reach a plugin through `claude plugin configure <id> --values-stdin` into `userConfig`, used as
    `${user_config.X}` in `.mcp.json`; unverified whether hooks.json substitutes it.
  - `mergeSettings` never writes `allowedHttpHookUrls` or hooks.
  - Deselecting a plugin uninstalls it but leaves its files in `~/.claude/bin` and its userConfig.
  - Per-tool steps are hard-wired in `install.ts` (`applyBin` for tui-review and web-mcp).
- **Plugin variables** (https://code.claude.com/docs/en/plugins-reference, "User configuration" and "Environment
  variables", fetched 2026-10-30):
  - `${user_config.KEY}` is substituted in exec-form hook `args`. Hook processes also get `CLAUDE_PLUGIN_OPTION_<KEY>`,
    `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDE_PROJECT_DIR`.
  - `${...}` resolves only in hook `command`/`args`, so an http hook's `url` is a literal.
  - `CLAUDE_PLUGIN_DATA` is `~/.claude/plugins/data/<id>/`; it is kept across updates and deleted on uninstall.
  - `CLAUDE_PLUGIN_ROOT` moves with each update.
- **Retrieve markers (checked 2026-10-30 on the 200-result speed sample, no ML):**
  - 57 of 200 results changed, and 2 of those carry a `Retrieve more: hash=…` marker, e.g. "[99 lines compressed to
    35. Retrieve more: hash=…]".
  - Without headroom's MCP server or proxy the model has no way to follow that marker.
- **Probe** (2026-10-30, Claude Code 2.1.292, Windows, `claude -p` with a plugin-dir http PostToolUse `*` hook, no
  `allowedHttpHookUrls`): the hook is dispatched for every tool and a same-shaped `updatedToolOutput` (strings of 20+
  characters replaced) is honoured for Bash, PowerShell, Grep, Glob and Read. Fixtures are in
  `plugins/opt-in/headroom-trim/server/tests/fixtures/`. MCP not captured: headless, the tool could not be loaded
  (ToolSearch returned "Tool references removed", with the hook replacing and with it passing through), so no MCP
  result or image block was seen. ToolSearch also fires the hook.

## Prior art

Background agent, 2026-10-30. Nothing found that pairs a hook with a shared helper process.

- Approaches: **A** hook to a shared on-demand daemon (the daemon half as in eslint_d, sccache, gopls `-remote=auto`;
  the hook half unprecedented); **B** command rewriting in PreToolUse (rtk, Bash only, search snippets only);
  **C** an MCP sandbox plus index that the model has to call (context-mode); **D** proxy (headroom's own path, ruled
  out).
- Daemons: eslint_d keeps a port/pid file and idles out after 15 min (https://github.com/mantoni/eslint_d.js); sccache
  uses a fixed port 4226 and idles out after 10 min (https://github.com/mozilla/sccache); gopls exits 1 min after its
  last client (https://github.com/golang/tools/blob/master/gopls/doc/daemon.md). None documents start races.
- Claude Code hooks (https://code.claude.com/docs/en/hooks):
  - **SessionStart takes only `command` and `mcp_tool` hooks, not `http`.**
  - An http hook's connection failure, non-2xx or non-JSON body is a non-blocking error. The default timeout is
    600 s. `onFailure` needs 2.1.295+. `allowedHttpHookUrls` applies from every settings source.
  - `updatedToolOutput` must match the tool's output shape, or it is silently ignored.
  - Parallel tool calls fire PostToolUse concurrently.
  - `${CLAUDE_PLUGIN_DATA}` survives plugin updates.
- Open issue titles (search only, unverified): `updatedToolOutput` ignored for built-in tools on 2.1.173, and http
  PostToolUse hooks not dispatched (closed March 2026). The exact shape needs testing per tool on the current Claude Code.
- headroom README: CCR keeps originals locally, and only the MCP server's `headroom_retrieve` reads them back. A
  hook-only setup has no retrieve path.
- Windows: Node's `detached` gives the child its own console unless `windowsHide`
  (https://nodejs.org/api/child_process.html). Microsoft recommends `SO_EXCLUSIVEADDRUSE` over `SO_REUSEADDR` for
  servers (learn.microsoft.com, "Using SO_REUSEADDR and SO_EXCLUSIVEADDRUSE"). Python's socketserver defaults to no
  reuse, and `daemon_threads` is false.
- uv: `uv venv --python 3.12` downloads Python if it is missing (https://docs.astral.sh/uv/pip/environments/), and
  `--require-hashes` checks hashes when syncing.

## Options

- **Server shape (before the flow):** one shared loopback HTTP server, PostToolUse `type: "http"` hook, SessionStart
  command launcher, idle exit. Rejected: an MCP server per session (100 MB per session, a tool in Claude's list),
  headroom's own proxy/server (telemetry, intercepts every call), the Rust core alone (its protections live in the
  Python router), ML (no gain worth its cost).
- **Packaging, 2026-10-30. Picked D:** the server is one PEP 723 script (`server.py` + `server.py.lock` from
  `uv lock --script`), run with `uv run --locked --offline`. The installer keeps a pinned uv the way it keeps
  agent-browser (version + per-platform sha256 in `installer/assets/uv.json`, a PATH copy at or above the pin wins,
  otherwise `~/.claude/bin`, path into the plugin's `userConfig`, a sync script bumps the pin), then pre-builds the
  environment with `uv sync --script`. uv 0.13.6 ships `x86_64-pc-windows-msvc.zip` and
  `x86_64-unknown-linux-musl.tar.gz` with `.sha256` files. Rejected:
  - A: uv on PATH only. The user doesn't have uv on every machine.
  - B: PyInstaller/Nuitka exe built in CI. Fragile with headroom's native extension, and the user is unsure about it.
  - C: the installer builds a venv itself. Same as D with more of our own code.
  - E: the launcher downloads uv. A hook would fetch and run a binary.
- **Lost content, 2026-10-30. Picked 1:** headroom's lossy no-ML mode, and a cut is final. A rare
  `Retrieve more: hash=…` note stays unresolvable, and Claude re-runs the command when it needs more. Rejected:
  - 2: keep originals and add a retrieve route (an MCP tool or curl). More code and a tool in Claude's list.
  - 3: `mode="agent"`, lossless only. It saved 0.0% on every tool in the transcript replay (2,498 hook-scope
    results). Lossy saved 7.0% and changed 28.9% of them.
- **Tool scope, 2026-10-30:** every tool (matcher `*`). The server walks `tool_response` and hands each string to
  headroom, which decides. Rejected: a list of tools whose output shape we rebuild.
- **Builder check, 2026-10-30.** Answered by the user:
  - Updates: headroom is bumped like any other dependency. The server becomes a uv project so Dependabot's `uv`
    ecosystem can bump it, and the launcher replaces an outdated server and runs `uv sync` once.
  - Local port: no secret, the README says so.
  My calls: a per-session off switch via the `X-Headroom-Trim` header; a first-task probe of `updatedToolOutput`
  that stops the build if Bash, PowerShell or Grep isn't honoured; silent, with a before/after log in plugin data.

## Plan review

Round 1, 2026-10-30. Reviewers: correctness (fable), fit (opus), simpler (sonnet). 33 findings, 28 after merging
duplicates, none dropped. The user decided:

1. The launcher's offline start plus fallback sync couldn't return in ~300 ms (all three reviewers). **Picked A:** drop
   `--offline`; `uv run --locked` fetches by itself when the lockfile changed. Rejected: a detached supervisor, an
   async SessionStart hook.
2. A bare `uv` from the hook could run a `uv.exe` from the project folder on Windows (fit). **Picked A:** the launcher
   finds uv itself (`~/.claude/bin`, then absolute PATH entries); no `uvPath` setting or configure call. Rejected:
   keep the setting and resolve it safely.
3. Task 7 can't install from the checkout before a release (fit). **Picked B:** run the end-to-end after the merge's
   release. Rejected: a `--plugin-dir` run plus a driver script now.
4. The per-session off header (simpler). **Picked B:** cut it; `HEADROOM_TRIM=off` only stops a session's launcher.
5. One PR or two (simpler). **One PR.**

Applied without a decision, as proposed: absolute `server.py` path; `SO_REUSEADDR` on Linux only and exit code 75 on
a failed bind; `/shutdown` and idle exit from another thread, draining the in-flight trim; the image test with an MCP
tool name; a behavioural no-network test instead of the import-order one, no `BLOCKED` list or subprocess logging;
`RotatingFileHandler`; token counts on the result text alone; `/health` polled after `/shutdown`; the data folder
created first; telemetry patched before the session aggregator; the agent-browser pin, plan and sync code
generalised instead of copied; uv's path in the archive kept apart from its install path; installer logic in `core/`
with a captured `installed_plugins.json` fixture; a running server stopped before the installer's `uv sync`; no
`BINARIES` row for uv; the option hidden without a uv build; inline pins in tests; "package.json's version"; the sync
entry's `check` and `body`; `uv` in the dev shell; `uv.json` in the package check; README notes on the port and
`allowedHttpHookUrls`; a `claude -p` lifetime check.

## Tasks

- Task 1: base 888ac98, untracked at start: docs/adr/0007-python-through-installer-uv.md, docs/features/headroom-trim/{flow,plan,spec}.md

## Rulings

- 2026-10-30, pre-flight: the installer reads the port from the installed plugin's `hooks/hooks.json` instead of a
  second literal — the port stays written in one place — a little parsing code if wrong.
- 2026-10-30, pre-flight: the pin-sync helper takes `files: key → asset name`; uv maps `UV_FILES` to it — one helper
  shape — trivial to change.
- 2026-10-30, pre-flight: `npm test` is red on origin/main (`claude plugin validate plugins/default`, register.tsx,
  Claude Code 2.1.292); tasks accept exactly that failure and also run the `node --test` parts directly — a new
  failure can't hide behind it.
- 2026-10-30, pre-flight: Task 7 runs after the merge's release, so the build ends after Task 6.

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
