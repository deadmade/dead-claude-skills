# headroom-trim

Shrinks every tool result with [headroom](https://github.com/headroomlabs-ai/headroom)'s no-ML lossy compression before
Claude reads it. A `PostToolUse` http hook (matcher `*`) posts each tool call to a small Python server on
`127.0.0.1:47811`; the server trims the result's text and answers with the replacement, or with nothing when it has
nothing to change. Any failure leaves the original output untouched.

Measured on real sessions, it saves 7.0% of tool-result tokens.

## How it runs

- A `SessionStart` hook runs `hooks/launch.mjs`, which returns within about 300 ms. It starts the server with
  `uv run --locked` (detached and hidden, so it outlives the session) when none answers `/health`. `/health` reports
  the server's identity (a hash of its code and lockfile) and the plugin version it came from: a launcher replaces a
  server of another identity, unless that server came from a newer version (a session started before a plugin update
  leaves it alone). The server exits after 30 minutes without a request.
- The launcher uses `~/.claude/bin/uv` when it exists, and a uv on PATH (absolute entries only) only while that one is
  absent. The installer downloads that pinned uv and builds the environment ahead of time; without the installer the
  first session builds it.
- The environment lives in `<plugin data>/venv`, and the server writes only to the plugin data folder. uv keeps its
  download cache and the Python it installs in its own folders (`uv cache dir`, `uv python dir`). The server is shared
  by every session, so the launcher and the installer leave out the session's `UV_*`, `PYTHON*` and `VIRTUAL_ENV`
  variables. That includes uv's index and cache settings (`UV_INDEX_URL`, `UV_CACHE_DIR`, …), so the environment is
  always built from PyPI with uv's default folders; proxy variables (`HTTPS_PROXY`) still apply.
- There is no network: the server sets headroom's offline and telemetry switches before importing it, and blocks
  outgoing connections. Without the installer (or if its fetch of tiktoken's vocabulary failed) headroom estimates
  token counts instead of using that vocabulary; trims still work.
- A result that waited more than about 4 s behind larger ones goes to Claude untrimmed, so no tool call outlives the
  hook's 5 s timeout.
- Cut results are final. headroom's `Retrieve more: hash=…` note is common on cut logs and can't be followed: re-run
  the command for the full output.

## When nothing is trimmed

Look in the plugin data folder (`~/.claude/plugins/data/headroom-trim-dead-claude-skills/`):

- `launcher.log`: one line per server start (uv path and process id), or why none started (no uv).
- `server.log`: the server's own output: uv's errors, a failed import, the port already taken. Emptied once it passes
  about 1 MB.
- `trim.log`: one JSON line per changed result (time, tool, tokens before and after, no text), rotated at 1 MB.

## Switching it off

`HEADROOM_TRIM=off` in the environment stops this session's launcher from starting a server. A server already running
keeps trimming; disable the plugin to stop all trimming.

## Security

Whatever listens on `127.0.0.1:47811` reads every tool result and can rewrite it. The port is fixed, so another local
process could take it before the server starts. Any local process or web page can also `POST /shutdown`, which only
turns trimming off until the next session starts the server again.

If your settings have an `allowedHttpHookUrls` list that lacks `http://127.0.0.1:47811/hook`, Claude Code silently
skips the hook and nothing is trimmed.
