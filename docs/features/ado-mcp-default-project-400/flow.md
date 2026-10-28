---
flow: fix
phase: done
---

# ado-mcp: a refused default project and no project list: flow

## Request

"Currently two issus arrived with the mcp server. Two possible improvements came out of this:
1. A project_list tool. It would have answered your question, and it's useful for any clone that isn't on Azure DevOps.
2. A clearer 400. A bad default project should say which project was rejected, for example "default project X was refused"."

## Artifacts

- Reproduction: below, under Findings.

## Gates

- Cause, 2026-10-28: approved. Fix, 2026-10-28: the user picked "remove the default project everywhere" (asked "can we
  just remove the default project? I often switch between them"), over labelling 400s. Plus `project_list`, names
  only, no limit.

**Task 1 Files:** `crates/ado-mcp/src/{config,ctx,api,pipeline,tools}.rs`, `crates/ado-mcp/tests/{common/mod,ctx,mcp,api,fixtures}.rs`,
`crates/ado-mcp/tests/fixtures/projects.json`, `plugins/opt-in/mcp/mcp-azure/{.mcp.json,.claude-plugin/plugin.json,README.md}`,
`installer/{install.mjs,core.test.mjs}`, `docs/features/ado-mcp/spec.md`, `CLAUDE.md`.

## Skipped

## Findings

**Reproduction (2026-10-28, live server, this repo is a GitHub clone so the default project applies):**

- `repo_list` (no arguments) → `the server refused it: HTTP 400`
- `repo_list project="<project>"` → `the server refused it: HTTP 400`
- `repo_list project="NoSuchProject-xyz"` → `not found: project NoSuchProject-xyz`

**Root cause:**

- The configured default is a placeholder: `ADO_DEFAULT_PROJECT` is the literal `<project>` (`~/.claude.json`,
  project-scoped `ado` server pointing at `crates/ado-mcp/target/release/ado-mcp.exe`, not the plugin install).
- `ctx.rs` `named()` sends it as `_apis/projects/%3Cproject%3E`; the server rejects `<`/`>` in a path with a 400 whose
  body isn't JSON, so `status_error` (`src/api.rs:535-543`) has no message and says `HTTP 400`.
- `named()` labels the error through `ApiError::with_what` (`src/api.rs:71-76`), which only rewrites 404s. A 400 keeps
  the generic "it". `ambient()` (`src/ctx.rs:217-223`) passes the default project through `named()` without saying the
  name came from the config, so neither the project nor where it was set appears.
- Nothing lists projects: the tools are `pr_*`, `wi_*`, `pipeline_*` and `repo_list`, all inside one project, so a
  wrong or unknown default can't be looked up from Claude Code.

**Blast radius:**

- `with_what` callers: `ctx.rs:211` (`/vsts/info`), `named()` (project, repo in project), `pr.rs:260,1019,1061`,
  `wi.rs:202,458,498,524`, `pipeline.rs:250,836,866`. Tests pinning the 400 wording: `src/api.rs:671-673,681-690`,
  `tests/api.rs:159-175` (a 400 on the repos call, not labelled).
- `ambient()` is reached by every tool without a `project` argument outside an Azure clone.
- A new tool: `tests/mcp.rs` pins the tool list (`READS`, `tools_and_marks`), `tests/fixtures.rs` maps every fixture
  to its crate model; `CLAUDE.md`, `plugins/opt-in/mcp/mcp-azure/README.md` and `docs/features/ado-mcp/spec.md` name
  the tools.

## Tasks

Task 1: base e8542cb, untracked at start: this flow.md. Files clean (15 changed, all listed; `tests/common/mod.rs`,
`tests/fixtures.rs` and a `projects.json` fixture weren't needed). Red: `no_default_project_outside_clone`,
`github_clone_needs_project` (default still used), `project_list_names_every_project`, `tools_and_marks`,
`errors_are_tool_errors_without_pat` (no such tool). Green: every ado-mcp test but `view_concurrent` (see Rulings),
clippy `-D warnings` clean; `npm test` 141/143 + check-repo, the one failure `files.test.mjs` clean slate (`EPERM`
creating a symlink on this Windows account, untouched code). Deviation D1 (smoke.md).

## Rulings

- 2026-10-28, Task 1: `view_concurrent` (`tests/pr.rs:283`) left failing — it fails 3/3 at base e8542cb too when the
  `pr` binary runs in parallel (800 ms wall-clock budget), passes alone; unrelated timing — if wrong, a real
  concurrency regression in `pr_view` hides behind it.
- 2026-10-28, Task 1: `project_list` pages with `$top=100`/`$skip`, at most 100 pages, rather than one large `$top` —
  the server's `$top` maximum is unknown — if wrong, two requests where one would do.
- 2026-10-28, Task 1: `project_list` lives in `pipeline.rs` next to `repo_list`, inline JSON in the test instead of a
  fixture file — matches how `repo_list` is placed and how `tests/api.rs` builds project answers — cost: none.
- 2026-10-28, Task 1: `tests/common/mod.rs` still removes `ADO_DEFAULT_PROJECT` from the child's env — keeps a
  developer's own variable from leaking into tests that set it on purpose — cost: one stale-looking line.

## Deviations

- **D1, 2026-10-28: `docs/features/ado-mcp/smoke.md:14`** still says to enter "the default project"; it isn't on the
  Files list. Options: A, drop the words from that step; B, leave it (the smoke checklist is the old feature's
  record). Recommended A: the checklist is meant to be re-run. Decision, 2026-10-28: A.

## Verify

One `/verify` over both ado-mcp fix flows (`ado-mcp-default-project-400`, `ado-mcp-wi-comments-missing-url`), run
from feature-flow `ado-mcp-next` before its build, 2026-10-28; base e8542cb, uncommitted tree.

- **Checks** (latest run, e8542cb + tree): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` clean;
  `cargo test` 177 passed; check-repo passed; `npm test` 141 passed, 1 failed (`installer/files.test.mjs` clean slate:
  Windows `EPERM` creating a symlink, untouched code).
- **Review** (`/self-review`, 9 passes): security and the bug pass found nothing. 14 findings plus noted items, all
  fixed on the user's "fix all pls":
  - `project_list` pages until a page adds nothing, `$skip` follows what came back, says when it stops at 10,000.
  - `RawComments` (was `Notes`) requires `comments`, reads `null` as none.
  - `wi_view` outside an Azure DevOps clone reads the item's own project.
  - `api::json` serves the three raw reads; stricter comment date (`day`); both `view_concurrent` tests measure
    against a baseline call.
  - Docs: old spec and flow rows, README, CLAUDE.md, server instructions.
- **Docs** (`/doc-audit branch`, [report](../../audits/2026-10-28-doc-audit-branch.md)): 11 findings, all fixed
  ("all"); one code fix (`wi_view` treats `project: ""` as none).
- **Decisions** (gate, 2026-10-28): all confirmed. Read: skipped by the user. Commit: one commit for both fixes
  and the verify fixes (the user's pick).
- **Not checked:** whether `claude plugin configure --values-stdin` merges or replaces stored keys (decides whether
  URL and PAT survive an upgrade that sends only `binPath`); no live-server run of the changes.

## Learned

2026-10-28, picked "1-4":
- `docs/solutions/ado-mcp-missing-field-url.md`: the missing-`url` root cause and how to spot it.
- CLAUDE.md, Checks: concurrency tests bound the slow call against a fast first call; the Windows `EPERM` symlink
  failure in `installer/files.test.mjs` is the machine.
- Memory: the user's collection has Search with Code, Work items and Wiki.

## Run verdict
