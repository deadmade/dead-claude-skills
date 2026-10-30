# headroom-trim

Shrinks every tool result with [headroom](https://github.com/chopratejas/headroom)'s no-ML lossy compression before
Claude reads it. A `PostToolUse` http hook (matcher `*`) posts each tool call to a small Python server on
`127.0.0.1:47811`; the server trims the result's text and answers with the replacement, or with nothing when it has
nothing to change. Any failure leaves the original output untouched.

Measured on real sessions, it saves 7.0% of tool-result tokens.

## How it runs

- A `SessionStart` hook runs `hooks/launch.mjs`, which returns within about 300 ms. It starts the server with
  `uv run --locked` (detached and hidden, so it outlives the session) when none answers `/health`, and replaces one
  built from an older lockfile. The server exits after 30 minutes without a request.
- The environment lives in `<plugin data>/venv`. The installer downloads a pinned uv to `~/.claude/bin` and builds the
  environment ahead of time; without the installer the first session builds it, and a missing uv leaves one line in
  `<plugin data>/launcher.log`.
- There is no network: the server sets headroom's offline and telemetry switches before importing it, and blocks
  outgoing connections. Without the installer (or if its fetch of tiktoken's vocabulary failed) headroom estimates
  token counts instead of using that vocabulary; trims still work.
- `<plugin data>/trim.log` has one JSON line per changed result (time, tool, tokens before and after, no text), rotated
  at 1 MB.

## Switching it off

`HEADROOM_TRIM=off` in the environment stops this session's launcher from starting a server. A server already running
keeps trimming; disable the plugin to stop all trimming.

## Security

Whatever listens on `127.0.0.1:47811` reads every tool result and can rewrite it. The port is fixed, so another local
process could take it before the server starts. Any local process or web page can also `POST /shutdown`, which only
turns trimming off until the next session starts the server again.

If your settings have an `allowedHttpHookUrls` list that lacks `http://127.0.0.1:47811/hook`, Claude Code silently
skips the hook and nothing is trimmed.
