# Doc audit, branch: 2026-10-28

Scope: `branch: claude/loving-goodall-syqcul ← e8542cb` (uncommitted), the docs the two ado-mcp fix flows
(`ado-mcp-default-project-400`, `ado-mcp-wi-comments-missing-url`) changed or name: `plugins/opt-in/mcp/mcp-azure/README.md`,
`CLAUDE.md` (mcp-azure bullet), `docs/features/ado-mcp/spec.md` and `flow.md`, the server instructions and tool
descriptions in `crates/ado-mcp/src/tools.rs`. Run inside `/verify`; the CLAUDE.md step (Phase 3) was skipped,
self-review's audit covered it.

Phase 2: six `flows:spec-compliance-checker` runs, one per claim (analyses in the session scratchpad,
`doc-audit/claim1-6.md`): all six partial, none contradicted outright. Phase 4: every repo path named exists; `claude
plugin validate plugins/opt-in/mcp/mcp-azure` passed.

| #   | severity | where | finding | evidence | fix (recommended) |
| --- | -------- | ----- | ------- | -------- | ----------------- |
| 1 | med | `crates/ado-mcp/src/wi.rs:261` | `wi_view`'s fallback to the item's project checks `project.is_none()`, so `project: ""` outside a clone still fails; the rest of the server treats an empty value as absent (`given`, `ctx.rs:90`) | claim 1 | test, then `given(a.project.as_deref()).is_none()` |
| 2 | med | `crates/ado-mcp/src/tools.rs:40` | the server instructions say "Outside an Azure DevOps clone, pass project" with no `wi_view` exception; the README has it | claim 1 | add "(wi_view takes the work item's own)" |
| 3 | med | `docs/features/ado-mcp/spec.md` goal 5, `README.md:8`, `tools.rs:40` | "every tool takes `project` and `repo`": only the `pr_*` tools take `repo`; `wi_update` takes neither | claim 6, claim 1 | "pass `project` (and `repo` for the `pr_*` tools)"; spec: "Every tool but `project_list` and `wi_update` takes `project`; the `pr_*` tools also `repo`" |
| 4 | low | `README.md:10`, `tools.rs:49` | the list rule misses `pr_files` (up to 2000 files, more via `git diff --stat`) and `pipeline_view`'s issues (20, more via `pipeline_log`) | claim 2 | name both exceptions |
| 5 | low | `README.md` Install, spec goal 9 | the installer asks only for keys not yet saved; with both saved it asks nothing (`core.mjs:390`) | claims 3, 6 | "asks for the collection URL and PAT unless both are saved" |
| 6 | low | `README.md:27` | `pipeline_log` reads "at most its last 20,000 lines" only when the server reports the log's line count; otherwise the whole log | claim 5 | add "(when the server reports the length)" |
| 7 | low | `README.md:21` | `pr_files` prints the `git diff` command only for shell-safe branch names | claim 5 | "and, for plain branch names, the `git diff` command" |
| 8 | low | `README.md:30` | `project_list`: "every project in the collection"; the code lists those the PAT can see, up to 10,000 | claim 5 | "every project the PAT can see, by name" |
| 9 | low | `CLAUDE.md:70` | the own-struct examples miss `pr_threads`' `Props` (`pr.rs`); the build log is read as text and `wi_comment`'s reply isn't decoded | claim 4 | name `Props` in `pr.rs` too |
| 10 | low | `docs/features/ado-mcp/flow.md:97` (D7) | names the struct `Notes`; it is `RawComments` now | claim 4 | rename in D7 |
| 11 | low | `README.md:9` | `wi_view`'s fallback fires on any scope error without an HTTP status (a clone of another server, an unreachable `/vsts/info`), wider than "outside an Azure DevOps clone" | claim 1 | say "when the clone names no project of this collection" |

Not checked: whether Claude Code keeps userConfig after an uninstall, whether `configure --values-stdin` merges or
replaces stored keys (claim 3's open question; it decides whether URL and PAT carry over when only `binPath` is sent),
and whether the tool schemas carry `additionalProperties: false`.

## Picks

2026-10-28: "all".

## Fixed

- 1: `wi_view` falls back on `given(project)`; `tests/wi.rs::view_outside_clone_uses_the_items_project` now also calls
  with `project: ""` (failed first, then passed).
- 2, 3, 4: server instructions (`tools.rs`), README and spec goal 5 name the `pr_*`-only `repo`, `wi_update`, the
  `wi_view` fallback and the `pr_files` / `pipeline_view` list exceptions.
- 5: README Install and spec goal 9: "unless both are saved already".
- 6, 7, 8: README `pipeline_log`, `pr_files`, `project_list` lines qualified.
- 9: CLAUDE.md names `Props` in `pr.rs`. 10: D7 names `RawComments`. 11: README says "when the clone names no project
  of this collection".
- Re-check: the wording now matches the six checkers' code findings; `cargo fmt --check`, clippy, `cargo test` (177
  passed) and `npm test` (141 passed, 1 failed: the Windows symlink `EPERM`, untouched code) on e8542cb + tree.
