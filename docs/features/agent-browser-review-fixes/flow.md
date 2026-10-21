---
flow: fix
phase: done
---

# agent-browser review fixes: flow

## Request

Fix the "Fix before PR" findings (1–4) from the self-review of `fix/agent-browser-binary` and consider 5–10
(the full list is in the session that started this flow).

## Artifacts

- Branch `fix/agent-browser-binary`, commit e564369.

## Gates

- 2026-10-21 verify review: re-run only the fixed passes (user's pick); fix A–D, skip E.
- 2026-10-21 cause and fix plan approved: full plan (1–8 and 10; 9 skipped, not on this branch).

## Skipped

## Findings

Reproduction is by reading: each finding is visible in the code, none needs a run.

- 1: `installer/install.mjs:390` — once `~/.claude/bin/agent-browser` reports the pin, `action` is `skip` and
  `agent-browser install` (the browser download) is never run again, even if it failed the first time.
- 2/10: `installer/install.mjs:326-333` and the same copy in `applyCswap` (`:250-258`) — the second `renameSync` has no
  rollback, and `.old-<pid>` files are never swept. `downloadBin` serves tui-review, web-mcp and agent-browser.
- 3: `downloadBin`'s comment (`:298`) describes only the archive case.
- 4: CLAUDE.md's web-mcp entry: "binary-only crate", "downloads it like web-mcp".
- 5: the PATH-vs-ours choice in `applyAgentBrowser` has no test (CLAUDE.md: logic goes in core.mjs with a test).
- 6: `agentBrowserAsset` returns undefined for both an unsupported platform and a bad pin.
- 7: the early return for a current PATH copy leaves a stale `agentBrowserPath` pointing at ~/.claude/bin.
- 8: `crates/web-mcp/src/browser.rs:56` still says `npm install -g`, asserted by `tests/browser.rs:159`.
- 9: this branch doesn't touch `.web/index` (`rank::Index::open`); the finding belongs to another change.

## Fix

- `replaceBin` (`installer/files.mjs`, tested): sweeps `<bin>.old-*`, moves a Windows exe aside, restores it and
  removes the staged copy when the swap fails. `downloadBin` and cswap use it (2, 10). `downloadBin` comment (3).
- `agentBrowserPlan` (`installer/core.mjs`, table test): PATH copy vs ours; `applyAgentBrowser` runs `install` on every
  run with ours (1), sets `agentBrowserPath` in both cases (7), says "bad pin" vs "no upstream build" (6).
- CLAUDE.md wording (4); `browser.rs` install hint and its test without npm (8).

## Deviations

## Verify

- Checks: `npm test` 138/138, `cargo test --test browser` 22/22, `cargo clippy --all-targets -D warnings` clean
  (crates/web-mcp). `nix fmt` not run (needs the sandbox off).
- Review (silent-failure, tests, comments, CLAUDE.md passes on the delta): fixed A (restore error kept the real
  cause), B (three `replaceBin` cases), C (CLAUDE.md:60), D (web-mcp README). Left: E (CLAUDE.md:12 mention, adds
  little); the old `bin.tmp-<pid>` leak on a failed `cpSync`, which predates this branch.
- Docs: covered by the CLAUDE.md pass (CLAUDE.md, web-mcp README). Tests: gaps filled in review, no test-audit.

## Learned

- [docs/solutions/agent-browser-install-never-retried.md](../../solutions/agent-browser-install-never-retried.md)
- Branch: committed and pushed (user's pick, 2026-10-21).
