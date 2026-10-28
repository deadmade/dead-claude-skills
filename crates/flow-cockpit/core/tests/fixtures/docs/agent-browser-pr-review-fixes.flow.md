---
flow: fix
phase: done
---

# agent-browser PR review fixes: flow

## Request

lets fix these issus

(The "Fix before PR" findings 1–4 of the self-review of `fix/agent-browser-binary` ← main, now PR #68.)

## Artifacts

- Branch `fix/agent-browser-binary`, commits e564369..8a1cfcf.

## Gates

- 2026-10-21 cause and fix plan approved: 1 with `agent-browser install` on the copy in use, PATH or ours; 2–4 as
  proposed.

## Skipped

- Ground: pstack `how`/`blast-radius` not re-run; the self-review's blast-radius pass on this same diff covers it.

## Findings

- 1: `installer/install.mjs:377`: with a current agent-browser on PATH (`plan.use === 'path'`) the installer returns
  before `agent-browser install`, so a failed browser download is never retried for an old npm copy, or for our own
  copy when `~/.claude/bin` is on PATH. By reading.
- 2: `docs/features/agent-browser-review-fixes/flow.md:38`: item 9 says the branch doesn't touch `.web/index`, but
  17cd70a and e4b3139 change `rank::Index::open` and `Writer::commit`; Artifacts names only e564369.
- 3: `installer/files.mjs` `replaceBin`: `rmSync(staged)` in the `finally` throws past `throw e`, so its error
  replaces the swap's. Reproduced: a staged directory that can't be renamed onto `bin` reports
  `ERR_FS_EISDIR … rm returned EISDIR` instead of the rename's ENOTDIR.
- 4: `installer/install.mjs:293-302` `downloadBin`: the comparison of the download's sha256 with the pinned or
  fetched digest has no test.

## Fix

- 1: `useAgentBrowser` (`installer/install.mjs`) runs `agent-browser install` on the copy in use, PATH (with `shell`
  on Windows) or ours, then sets `agentBrowserPath`. No unit test: it is I/O; the copy choice stays in
  `agentBrowserPlan`.
- 2: the old flow.md's item 9 and Artifacts.
- 3: `replaceBin`'s staged cleanup in its own try; test sends a staged directory, failed first with `ERR_FS_EISDIR`.
- 4: `sha256Matches` (`installer/core.mjs`) used by `downloadBin`; test failed first (missing export).
- Docs: web-mcp README agent-browser bullet, `docs/solutions/agent-browser-install-never-retried.md`.

## Deviations

## Verify

- Checks: `npm test` 139/139. No Rust changed. `nix fmt`/prettier not run (sandbox: no network, nix needs it off).
- Review (user's pick: the fixed passes on the delta): none of substance; fixed one wording slip in the solution note.
  Left: cswap's inline hash check (`install.mjs:245`) could use `sha256Matches` (outside the approved fix).
- Docs: covered by the delta review; CLAUDE.md unchanged and still true. Tests: no test-audit (delta review found no
  gaps beyond I/O in install.mjs).

## Learned

- [docs/solutions/agent-browser-install-never-retried.md](../../solutions/agent-browser-install-never-retried.md):
  updated with the PATH case; nothing else kept (user's pick).
- Branch: committed and pushed (user's pick, 2026-10-21).
