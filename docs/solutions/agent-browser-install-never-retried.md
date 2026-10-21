# agent-browser's browser download is never retried after a failed first run

- **Seen:** 2026-10-21, self-review of `fix/agent-browser-binary`: `installer/install.mjs` `applyAgentBrowser` ran
  `agent-browser install` only right after downloading the binary.
- **Cause:** once `~/.claude/bin/agent-browser --version` matched the pin, the plan was `skip`, so a failed browser
  download (network, a declined sudo) was never run again and `browser` failed at runtime while reruns looked clean.
- **Fix:** `applyAgentBrowser` runs `<bin> install` on every run that uses the installer's own copy; the choice lives in
  `agentBrowserPlan` (`installer/core.mjs`), with a test.
- **Spot it next time:** a setup step that runs only after a download is never retried: run idempotent setup on every
  run, gated on the binary in use, not on whether it was just fetched.
