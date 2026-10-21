# agent-browser's browser download is never retried after a failed first run

- **Seen:** 2026-10-21, self-review of `fix/agent-browser-binary`: `installer/install.mjs` `applyAgentBrowser` ran
  `agent-browser install` only right after downloading the binary.
- **Cause:** once `~/.claude/bin/agent-browser --version` matched the pin, the plan was `skip`, so a failed browser
  download (network, a declined sudo) was never run again and `browser` failed at runtime while reruns looked clean.
- **Fix:** `applyAgentBrowser` runs `install` on every run, on whichever copy is in use (`useAgentBrowser`): the
  installer's own, or a current one on PATH, which the first fix still skipped (an npm copy from an earlier install, or
  `~/.claude/bin` put on PATH). Which copy is used lives in `agentBrowserPlan` (`installer/core.mjs`), with a test.
- **Spot it next time:** a setup step that runs only after a download is never retried: run idempotent setup on every
  run, gated on the binary in use, not on whether it was just fetched.
