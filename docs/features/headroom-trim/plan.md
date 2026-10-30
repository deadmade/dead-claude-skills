# Headroom trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in plugin, `headroom-trim`, whose shared local trim server shrinks every tool result with headroom's
no-ML lossy compression before Claude reads it, installed with an installer-managed uv.

**Architecture:** A PostToolUse `type: "http"` hook (matcher `*`) posts each tool call to a Python trim server on
127.0.0.1:47811. The server walks `tool_response`, trims each string through headroom's `compress()`, and answers with
`updatedToolOutput` or an empty body. A SessionStart Node launcher finds uv and starts the server (`uv run --locked`)
detached and hidden when none, or an outdated one, answers `/health`. The installer keeps a pinned uv and pre-builds the
environment into the plugin's data folder.

**Tech Stack:** Python 3.13 + `headroom-ai==0.42.0` (uv project, stdlib `http.server`, `logging`, `unittest`); Node 26
stdlib `.mjs` hooks (`node --test`); the TypeScript installer (Node stdlib, erasable syntax).

**Spec:** [spec.md](spec.md). ADR: [0008](../../adr/0008-python-through-installer-uv.md).

## Global Constraints

- No network: resolved in the trim server's startup, before headroom is imported; never seen by request handling, the
  response walk, the launcher or the installer.
- Off switch: resolved in the launcher's start check; never seen by the trim server or headroom.
- Port, uv path, plugin data path: resolved in `hooks/hooks.json` and the launcher, passed to the trim server as
  arguments or environment; never seen by the trim server's request handling.
- Tool output shape: resolved in the trim server's response walk; never seen by the launcher, the hook config or
  headroom.
- Lockfile version: resolved between the launcher and `/health`; never seen by request handling. (Final review: the
  identity covers `uv.lock`, `pyproject.toml` and `server/*.py`, and `/health` also reports the plugin version; a
  launcher never replaces a server from a newer version.)
- Port 47811, written only in `plugins/opt-in/headroom-trim/hooks/hooks.json`.
- Hook timeout 5 s; idle exit after 30 min; the launcher returns within about 300 ms.
- `requires-python = "==3.13.*"`; `headroom-ai==0.42.0`, no extras; `CompressConfig(protect_recent=0,
  kompress_model="disabled")`.
- `UV_PROJECT_ENVIRONMENT=<plugin data>/venv`. Plugin data is `CLAUDE_PLUGIN_DATA` in the hook, and
  `<CONFIG>/plugins/data/headroom-trim-dead-claude-skills/` for the installer (the id with `@` replaced by `-`, as in
  `web-mcp-dead-claude-skills`).
- uv lookup (launcher and installer agree): `<CONFIG>/bin/uv.exe` or `uv`, else the first `uv[.exe]` in an absolute
  PATH entry. Never a bare name, never the current folder.
- Server env before importing headroom: `HEADROOM_OFFLINE=1`, `HEADROOM_BEACON=off`, `HEADROOM_TELEMETRY=off`,
  `DO_NOT_TRACK=1`, `HEADROOM_UPDATE_CHECK=off`, `HF_HUB_OFFLINE=1` (the last two are inert in 0.42.0 and kept as
  belt and braces), `HEADROOM_WORKSPACE_DIR=<plugin data>/headroom` (default `~/.headroom`),
  `HEADROOM_CCR_BACKEND=memory` and `TIKTOKEN_CACHE_DIR=<plugin data>/tiktoken`. Patch `headroom.telemetry.session.post_session_event` and `_post_blocking` to no-ops
  before anything calls `get_session_aggregator`.
- Log: `<plugin data>/trim.log` via `logging.handlers.RotatingFileHandler(maxBytes=1_000_000, backupCount=1)`, one JSON
  line per changed result: `time`, `tool`, `before`, `after` (tokens of the result text alone), no text.
- Every failure gives Claude the original output: the server answers 200 with an empty body on any exception; the
  launcher exits 0 always.
- uv pin 0.13.6: `uv-x86_64-pc-windows-msvc.zip` (sha256
  `a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f`, `uv.exe` at the archive root) and
  `uv-x86_64-unknown-linux-musl.tar.gz` (sha256 `5d61f26b6c7213779eda90edc6971ea6b0b796bfb8d49a574c8ad69b59838548`,
  `uv-x86_64-unknown-linux-musl/uv` inside). Installed as `<CONFIG>/bin/uv[.exe]`.
- Repo rules: `plugin.json` at `package.json`'s version; installer logic in `core/`/`system/` with tests, programs via
  `system/proc.ts`, the installer's line-coverage floor (79) must hold; commit messages one sentence, no co-author
  line, `git add -u` plus new paths by name.
- Claude Code here is 2.1.292: don't use `onFailure` on the http hook (needs 2.1.295); the default is non-blocking.

**Before you write** (every task): Read the task and the code it touches. List every place your change must reach:
callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or
expose, callers that stop working. That is scope. Extra features are not.

## Review Focus

1. **Parallel tool calls.** Claude Code fires PostToolUse concurrently; two requests at once must both be answered
   (headroom's pipeline is a singleton, so calls are serialised by a lock). Test in Task 3.
2. **Image and binary results.** An MCP image block carries base64 data. The answer must leave it byte-identical or send
   nothing. Fixture test in Task 2, with an MCP tool name (Read is excluded by headroom anyway).
3. **A restart right after a shutdown, and the port held by something else.** On Linux a new server must bind at once
   after the old one exits; the launcher must still return within ~300 ms when the port is busy. Tests in Tasks 3 and 4.
4. **uv missing.** The session starts normally, with one line in the launcher's log. Test in Task 4.
5. **No console window on Windows, and the server outlives the session**, including a `claude -p` run. Check in Task 7.

---

### Task 1: Probe the installed Claude Code and capture tool_response fixtures

Prove that an http PostToolUse hook is dispatched and that `updatedToolOutput` with the same structure is honoured for
Bash, PowerShell, Grep, Glob, Read and one MCP tool, and capture real `tool_response` samples. **If the hook isn't
dispatched, or the replacement is ignored for Bash, PowerShell or Grep, stop and report: the user decides.**

**Files:**
- Create: `plugins/opt-in/headroom-trim/server/tests/fixtures/<tool>.json` (one per tool above: the full PostToolUse
  JSON Claude Code posted, plus one MCP result that carries an image block if any MCP tool here returns one)
- Modify: `docs/features/headroom-trim/flow.md` (a **Probe** note under **Grounding**: version, per tool honoured or not)
- Throwaway (scratchpad, not committed): a probe plugin with an http hook and a small Node capture server

- [ ] **Step 1:** Write a probe plugin in the scratchpad: `hooks/hooks.json` with a PostToolUse `*` http hook to
  `http://127.0.0.1:47899/hook`; a Node server that saves each body to `<tool_name>.json` and answers
  `updatedToolOutput` equal to `tool_response` with every string of 20+ characters replaced by `PROBE-REPLACED`.
- [ ] **Step 2:** Run `claude -p --plugin-dir <probe> "<prompt that runs each tool once>"`, asking Claude to quote the
  first line of each result. Expected: the captured JSON files exist, and Claude quotes `PROBE-REPLACED` for each
  honoured tool.
- [ ] **Step 3:** Copy the captured files into `server/tests/fixtures/`, personal paths replaced by `C:/x` or `/x`.
  Write the per-tool result into flow.md.
- [ ] **Step 4:** Commit the fixtures and flow.md: "Capture Claude Code PostToolUse fixtures for headroom-trim."

### Task 2: The uv project and the response walk

**Files:**
- Create: `plugins/opt-in/headroom-trim/server/pyproject.toml`, `server/uv.lock`, `server/trim.py`,
  `server/tests/__init__.py`, `server/tests/test_trim.py`

**Interfaces:**
- Consumes: Task 1's fixtures.
- Produces: `trim.walk(tool: str, response: object, trim_text: Callable[[str, str], str]) -> object | None`: the same
  structure with each string replaced by `trim_text(tool, s)`, or `None` when no string changed.
  `trim.headroom_text(tool: str, text: str) -> tuple[str, int, int]`: one `compress()` call on
  `[user "Continue the task.", assistant tool_use {name: tool}, user tool_result {content: text}]` with the Global
  Constraints' `CompressConfig`; returns the tool_result's text and the token counts of the input and output text
  alone (headroom's token counter applied to each string).

- [ ] **Step 1:** `pyproject.toml`: `[project] name = "headroom-trim-server"`, `version = "0.0.0"`, `requires-python =
  "==3.13.*"`, `dependencies = ["headroom-ai==0.42.0"]`; `[tool.uv] package = false`. Run `uv lock` in `server/`.
  Expected: `uv.lock` written.
- [ ] **Step 2: Failing tests** in `test_trim.py` (`unittest`):
  - `test_walk_returns_none_when_nothing_changes`: `walk("Bash", fixture, lambda t, s: s) is None`.
  - `test_walk_keeps_structure`: with `lambda t, s: s.upper()`, every key, list length, bool and number of the Bash
    fixture is unchanged and every string is upper-cased.
  - `test_walk_passes_tool_name`: the callback receives `"Grep"` for the Grep fixture.
  - `test_mcp_image_left_alone`: a response with `{"type": "image", "source": {"type": "base64", "data": <10 KB
    base64>}}` through `walk("mcp__x__y", ..., lambda t, s: headroom_text(t, s)[0])` returns `None` or keeps `data`
    byte-identical. If headroom changes it, the walk skips `{"type": "image"}` blocks (shape handling, not a trim rule).
  - `test_headroom_trims_a_long_log`: `headroom_text("Bash", <600 log lines with timestamps>)[0]` is shorter, and the
    returned `before` is greater than `after`.
  - `test_headroom_keeps_read`: `headroom_text("Read", <the same text>)[0]` equals the input.
- [ ] **Step 3:** Run `uv run --locked python -m unittest discover -s tests` in `server/` with `UV_PROJECT_ENVIRONMENT`
  pointed at a scratch folder. Expected: FAIL (no `trim` module).
- [ ] **Step 4:** Implement `walk` and `headroom_text` in `server/trim.py`.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: "Add headroom-trim's uv project and response walk."

### Task 3: The trim server process

**Files:**
- Create: `plugins/opt-in/headroom-trim/server/guard.py`, `server/server.py`, `server/tests/test_guard.py`,
  `server/tests/test_server.py`

**Interfaces:**
- Consumes: `trim.walk`, `trim.headroom_text`.
- Produces: `python <abs>/server.py --port <int> --data <dir> --lock-hash <hex> [--idle <seconds>]`. Exit code 75 when
  the port can't be bound. Routes: `POST /hook` (PostToolUse JSON in; 200 with `{"hookSpecificOutput":
  {"hookEventName": "PostToolUse", "updatedToolOutput": ...}}` or an empty body); `GET /health` →
  `{"ok": true, "lock": "<hex>"}`; `POST /shutdown` (from 127.0.0.1 only) → 200, then the server stops.
  `guard.install() -> None`.

- [ ] **Step 1: Failing tests:**
  - `test_guard_blocks_dns_and_connect` (in a subprocess, since an audit hook can't be removed):
    `socket.getaddrinfo("example.com", 443)` and a connect to `1.1.1.1:443` raise `PermissionError`; a connect to a
    listening `127.0.0.1` socket works.
  - `test_server_process_has_no_network`: import `server` in a subprocess and assert there that a non-loopback
    connect raises `PermissionError` and that the Global Constraints' env values are set in `os.environ`.
  - `test_hook_trims` / `test_hook_unchanged_is_empty` / `test_hook_bad_json_is_empty` /
    `test_hook_exception_is_empty` (a `trim_text` that raises), against a server on an ephemeral port in a thread.
  - `test_parallel_requests`: 8 concurrent `POST /hook` all answer 200 within 5 s.
  - `test_health_reports_lock`, `test_shutdown_stops`, and `test_shutdown_waits_for_inflight`: a 0.5 s `trim_text` in
    flight, `/shutdown` sent, the slow request still answers 200 and its log line is written.
  - `test_idle_exit`: with `--idle 1` the process exits within 3 s.
  - `test_port_taken_exits_75`: with the port already bound, the process exits 75 within 2 s.
  - `test_rebind_after_shutdown` (Linux only): serve, answer a request, shut down, start again on the same port at
    once. Expected: binds.
  - `test_log_line`: a trim writes one JSON line with `time`, `tool`, `before`, `after` and no text.
  - `test_no_files_outside_data`: with `HOME`/`USERPROFILE` pointed at an empty temp folder, a trim writes nothing
    under it.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `guard.py` (a PEP 578 hook that raises on non-loopback `socket.connect`, `socket.sendto`
  and `socket.getaddrinfo`, shaped like the scratchpad `netguard.py`) and `server.py`: the guard and env first, then
  the telemetry no-ops, then headroom; `ThreadingHTTPServer` with `daemon_threads = True` and
  `allow_reuse_address = sys.platform != "win32"`; a lock around `compress()`; the idle timer reset on each request;
  `/shutdown` and the idle timer call `server.shutdown()` from another thread, and the main thread takes the compress
  lock once after `serve_forever()` returns, so an in-flight trim finishes before exit.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: "Add headroom-trim's trim server with the network guard."

### Task 4: The plugin, the launcher and the hooks

**Files:**
- Create: `plugins/opt-in/headroom-trim/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/launch.mjs`,
  `hooks/launcher.mjs`, `hooks/launcher.test.mjs`, `hooks/hooks.test.mjs`, `README.md`
- Modify: `.claude-plugin/marketplace.json`, `package.json` (the test glob), `flake.nix` (the run-tests glob and the
  pre-commit `files` regex), `README.md` (the opt-in paragraph)

**Interfaces:**
- Consumes: Task 3's command line, exit code and routes.
- Produces in `launcher.mjs`: `decide({ env, health, lockHash }) -> 'off' | 'running' | 'replace' | 'start'` (pure);
  `lockHashOf(text: string) -> string` (sha256 hex); `findUv({ config, path, platform, isFile }) -> string |
  undefined` (the Global Constraints' lookup); `startArgs({ uv, serverDir, port, data, lock }) -> { cmd, args, env }`;
  `main({ argv, env, fetch, spawn, readFile, isFile }) -> Promise<void>`, never throwing.

- [ ] **Step 1: Failing tests** in `launcher.test.mjs`:
  - `decide`: `HEADROOM_TRIM=off` → `'off'`; health `{lock: same}` → `'running'`; health `{lock: other}` →
    `'replace'`; no health → `'start'`.
  - `findUv`: `<config>/bin/uv.exe` on win32 when it exists; else the first absolute PATH entry holding `uv.exe`;
    a relative PATH entry (`.`) is skipped; `undefined` when none.
  - `startArgs`: `cmd` is the uv path; `args` are `['run', '--locked', '--project', <serverDir>, 'python',
    <serverDir>/server.py, '--port', '47811', '--data', <data>, '--lock-hash', <hash>]` (absolute script path);
    `env.UV_PROJECT_ENVIRONMENT` is `<data>/venv`.
  - `main` with no uv found resolves and writes one line to `<data>/launcher.log`, creating `<data>` first.
  - `main` with a `fetch` that never answers resolves within 400 ms (health check aborted at 250 ms).
  - `main` on `'replace'` posts `/shutdown`, polls `/health` until it fails (at most 1 s), then spawns; total under
    1.4 s, and it still spawns if the old server never goes away (the new one then exits 75 on its own).
  - `main` spawns with `{ detached: true, windowsHide: true, stdio: 'ignore' }` and calls `unref()`.
- [ ] **Step 2:** `hooks.test.mjs`, like `plugins/flows/hooks/hooks.test.mjs`: SessionStart is one exec-form command
  hook `node` with `args` `["${CLAUDE_PLUGIN_ROOT}/hooks/launch.mjs", "47811"]`; PostToolUse matcher `*` is one
  `type: "http"` hook with `url` `http://127.0.0.1:47811/hook` and `timeout` 5; the port is the same in both; every
  `${CLAUDE_PLUGIN_ROOT}` path exists.
- [ ] **Step 3:** Run `node --test plugins/opt-in/headroom-trim/hooks/*.test.mjs`. Expected: FAIL.
- [ ] **Step 4:** Implement `launcher.mjs`, the four-line `launch.mjs` (reads argv and env, `await main(...)`), and
  `hooks.json`. The launcher reads `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDE_CONFIG_DIR` (default
  `~/.claude`) from its environment.
- [ ] **Step 5:** `plugin.json` at `package.json`'s version, no `userConfig`; the marketplace entry (category
  `productivity`, description ending "Needs uv, which the installer downloads. Opt-in."); the plugin README: what it
  does, the 7.0% measurement, no network, `HEADROOM_TRIM=off` (stops this session's launcher; disable the plugin to
  stop all trimming), "whatever listens on 127.0.0.1:47811 reads every tool result and can rewrite it", and that an
  `allowedHttpHookUrls` setting without `http://127.0.0.1:47811/hook` silently turns the hook off; the root README's
  opt-in paragraph; the test globs in `package.json` and `flake.nix`.
- [ ] **Step 6:** Run `npm test` and `claude plugin validate plugins/opt-in/headroom-trim`. Expected: PASS.
- [ ] **Step 7:** Commit: "Add the headroom-trim plugin with its launcher and hooks."

### Task 5: The installer's uv step

**Files:**
- Create: `installer/assets/uv.json`, `installer/steps/uv.ts`, `installer/core/fixtures/installed_plugins.json`
  (captured from this machine, personal paths replaced)
- Modify: `installer/core/binaries.ts` (+ `binaries.test.ts`), `installer/core/plugins.ts` (+ `plugins.test.ts`),
  `installer/core/options.ts` (+ `options.test.ts`), `installer/steps/agent-browser.ts`, `installer/install.ts`

**Interfaces:**
- Produces in `core/binaries.ts`, generalised from the agent-browser code so both tools share one path:
  - `interface UpstreamPin { upstream?: string; sha256?: Record<string, string> }` (replaces `AgentBrowserPin`).
  - `upstreamAction({ installed, pinned })` and `upstreamPlan({ theirs, ours, pinned })` (renamed from
    `agentBrowserAction`/`agentBrowserPlan`, same behaviour).
  - `UV_FILES: Record<string, { file: string; inner: string }>` (`win32-x64` → `uv-x86_64-pc-windows-msvc.zip`,
    `uv.exe`; `linux-x64` → `uv-x86_64-unknown-linux-musl.tar.gz`, `uv-x86_64-unknown-linux-musl/uv`).
  - `uvAsset(platform, arch, pin) -> { file, url, digest, exe } | undefined`, a plain object like `agentBrowserAsset`,
    with `exe` the path inside the archive; url `https://github.com/astral-sh/uv/releases/download/<ver>/<file>`.
- Produces in `core/plugins.ts`: `pluginInstallPath(installed: object, id: string) -> string | undefined` and
  `pluginDataDir(config: string, id: string) -> string`.
- Produces in `steps/uv.ts`: `HEADROOM_TRIM` (the plugin id); `installUv(): Promise<string | undefined>` (the uv path
  in use, installed to `<CONFIG>/bin/uv[.exe]`); `prepareTrimServer(uv: string): Promise<void>`.

- [ ] **Step 1: Failing tests:**
  - `binaries.test.ts`: `uvAsset` for both platforms against an inline pin (url, digest, `exe`); `undefined` for
    `darwin-arm64`, a bad version or a missing hash; the agent-browser tests pass unchanged against the renamed
    functions; `missingBinaries` does not report uv for `headroom-trim`.
  - `plugins.test.ts`: `pluginInstallPath` against the captured fixture; `pluginDataDir(config,
    'headroom-trim@dead-claude-skills')` is `<config>/plugins/data/headroom-trim-dead-claude-skills`.
  - `options.test.ts`: `unavailable('headroom-trim', 'darwin', 'arm64', v)` returns a reason; on `win32-x64` and
    `linux-x64` it returns nothing.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement them; write `uv.json` from the Global Constraints; add `'headroom-trim'` to the Tools keys;
  switch `steps/agent-browser.ts` to the renamed functions.
- [ ] **Step 4:** `steps/uv.ts`: like `installAgentBrowser`, ask before downloading (default yes), install to
  `<CONFIG>/bin/uv[.exe]` (not `asset.exe`), every failure one `failures` line ("uv: …; headroom-trim stays off until
  uv is installed"). `prepareTrimServer`: `POST /shutdown` to `127.0.0.1:47811` and wait up to 2 s for the port, then
  `uv sync --locked --project <installPath>/server` with `UV_PROJECT_ENVIRONMENT=<pluginDataDir>/venv`; a failed sync
  is a `failures` line saying the first session will retry it. After a good sync, fetch tiktoken's vocabulary:
  `uv run --locked --project <installPath>/server python -c "import tiktoken; tiktoken.get_encoding('o200k_base')"`
  with the same `UV_PROJECT_ENVIRONMENT` and `TIKTOKEN_CACHE_DIR=<pluginDataDir>/tiktoken` (no headroom import, so
  no telemetry); a failure is a `failures` line ("headroom-trim: token counts are estimated until the installer
  fetches tiktoken's vocabulary"). Wire it in `install.ts` after the agent-browser step:
  `if (selected.includes(HEADROOM_TRIM)) { const uv = await installUv(); if (uv) await prepareTrimServer(uv); }`.
- [ ] **Step 5:** Run `npm test` and `npm run typecheck`. Expected: PASS, line coverage still at or above 79.
- [ ] **Step 6:** Commit: "Install a pinned uv and the trim server's environment for headroom-trim."

### Task 6: Updates, CI and docs

**Files:**
- Create: `scripts/sync-uv.mjs`
- Modify: `scripts/sync-agent-browser.mjs` (shared with `sync-uv.mjs` through one helper in `scripts/sync-lib.mjs`),
  `scripts/sync-sources.mjs`, `.github/dependabot.yml`, `.github/workflows/test.yml`, `flake.nix` (devShell `uv`),
  `THIRD_PARTY.md`, `CLAUDE.md`

- [ ] **Step 1:** Move the "latest release → tag and per-file sha256 digests → write the pin" logic of
  `sync-agent-browser.mjs` into a `syncPin({ repo, files, out, tagPattern })` helper in `sync-lib.mjs`; both scripts
  call it. uv's tags have no `v`.
- [ ] **Step 2:** The `uv` `SOURCES` entry: `paths: ['installer/assets/uv.json']`, `scan: false`, a `check` asserting
  a semver `upstream` and a 64-hex sha256 for both keys, title "Pin uv to <tag>", and a `body` naming the release URL
  and that the installer downloads this uv for headroom-trim.
- [ ] **Step 3:** Run `node scripts/sync-agent-browser.mjs`, `node scripts/sync-uv.mjs` and `npm test` (which runs
  `sync.test.mjs`). Expected: both pins written with both hashes; tests PASS.
- [ ] **Step 4:** Dependabot: a `uv` entry, `directory: /plugins/opt-in/headroom-trim/server`, weekly on Monday,
  grouped `uv: ['*']`. Check GitHub's Dependabot docs (supported ecosystems) that `uv` reads a project `uv.lock`; if
  not, stop and report: the fallback (a sync job with uv on its runner) is a deviation.
- [ ] **Step 5:** `test.yml`: after Node setup, `astral-sh/setup-uv` pinned by commit sha with its version comment and
  `enable-cache: true`; a step "headroom-trim server tests" running `uv run --locked python -m unittest discover -s
  tests` in `plugins/opt-in/headroom-trim/server` with `UV_PROJECT_ENVIRONMENT=${{ runner.temp }}/trim-venv`; the
  "Installer package" step's asset grep also checks `assets/uv.json`. `flake.nix`: `uv` in the devShell packages.
- [ ] **Step 6:** THIRD_PARTY.md: headroom-ai (Apache-2.0) and uv, fetched at runtime at pinned versions, not
  vendored. CLAUDE.md: a Layout bullet for `plugins/opt-in/headroom-trim/` (server, launcher, port 47811, ADR 0008) and
  the server tests under Checks.
- [ ] **Step 7:** Run `npm test`. Expected: PASS.
- [ ] **Step 8:** Commit: "Keep uv and headroom current and test the trim server in CI."

### Task 7: End-to-end, after the merge's release

The installer adds the marketplace from the `release` branch, so this runs once the PR is merged and released
(user's decision, plan review 2026-10-30).

**Files:** none beyond fixes the check turns up, each a new change.

- [ ] **Step 1:** Run the released installer with headroom-trim selected. Expected: uv placed or found, `uv sync`
  done, no failures.
- [ ] **Step 2:** Start a new Claude Code session, run a long `git log` through Bash. Expected: `trim.log` gains a
  line, `/health` answers, no console window appeared, and the server is still running after the session exits.
- [ ] **Step 3:** Run `claude -p "run git log -n 200 with Bash"` with no server running. Expected: the server is up
  afterwards.
- [ ] **Step 4:** With `HEADROOM_TRIM=off` and no server running, a new session starts none.
- [ ] **Step 4b (final review):** an update that changes only server code replaces the running server; a `/compact`
  in a session from before an update leaves the newer server alone; a first start offline leaves the reason in
  `server.log`; while the server is down or starting, note whether Claude Code shows a hook error on each tool call.
- [ ] **Step 5:** Record the results in flow.md's **Walkthrough**.
