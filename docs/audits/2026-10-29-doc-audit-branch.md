# Doc audit, branch: 2026-10-29

Scope: `branch: claude/loving-goodall-syqcul ← f30a1b4` (cca5db6 + uncommitted), the docs feature ado-mcp-next changed or
that name what it changed:

- `plugins/opt-in/mcp/mcp-azure/README.md`
- `CLAUDE.md` (mcp-azure bullet)
- `GLOSSARY.md` (Hit, Test run)
- the `description`s in `.claude-plugin/marketplace.json`, mcp-azure `plugin.json` and `crates/ado-mcp/Cargo.toml`
- `installer/install.mjs` `HANDOFF`
- the server instructions, tool descriptions and argument docs in `crates/ado-mcp/src/`
- `README.md` (links mcp-azure)

`docs/features/*/` working files are out of scope. Run inside `/verify`; the CLAUDE.md step (Phase 3) was skipped,
because self-review's CLAUDE.md pass already ran.

- **Phase 2:** four `flows:spec-compliance-checker` runs, one per doc group. tob `spec-to-code-compliance` isn't
  available here. Analyses are in the session scratchpad, `doc-audit/claim1-4.md`:
  - claim 1 (README tools): partial;
  - claim 2 (scopes, limits, descriptions): implemented;
  - claim 3 (instructions and argument docs): partial;
  - claim 4 (CLAUDE.md, glossary): partial, nothing contradicted.
- **Phase 4:** every repo path and relative link in the scoped docs exists. The exceptions are two generic
  `.claude-plugin/…` mentions in CLAUDE.md, older than this branch. The only URLs are examples. No version changed
  (0.4.0 everywhere).
- **Phase 5:** pstack `technical-writing`/`unslop` are not installed. The checkers read every changed sentence, and
  their wording findings are below.

| #   | severity | where | finding | evidence | fix (recommended) |
| --- | -------- | ----- | ------- | -------- | ----------------- |
| 1 | med | `crates/ado-mcp/src/tools.rs:44`, `search.rs:49` | "search without project covers the whole collection" holds only without `repo` too; with `repo` in a clone it narrows to the clone's project | claim 3 A1: `search.rs:267-269`, `ctx.rs:123-128` | "without project or repo" |
| 2 | med | `tools.rs:284` (wiki description) | "One wiki per project is picked automatically": with several wikis and no `wiki=` it refuses | claim 3 A4: `wiki.rs:63-67` | "A project's only wiki is used; with several, pass wiki=" |
| 3 | med | mcp-azure `README.md:13-14`, `tools.rs:55-56` | "pipeline_view … 20 issues (pipeline_log shows the rest)": pipeline_log shows failed steps' error lines, not the remaining issues; older than this branch | claims 1 C1, 3 A2: `pipeline.rs:589-633`, `:664-680` | "(pipeline_log shows the failing steps' logs)" |
| 4 | low | mcp-azure `README.md:22` | "`iteration: <n>`" reads like an argument of `pr_view`; it is output | claim 1 C2: `pr.rs:464`, `:60-63` | "and the latest iteration's number" |
| 5 | low | mcp-azure `README.md` (repo_file, search) | refused inputs aren't named: `repo_file` refuses folders and binary files and may stop before 200 lines at the size budget; `search` refuses `repo` for kinds other than `code` | claims 1, 3 C3/C4: `file.rs:120-137`, `search.rs:263-265` | one clause each |
| 6 | low | `tools.rs:244` (pipeline_log description) | "from at most its last 20,000 lines" holds only when the server reports the log's length; the README already says so; older than this branch | claim 3 A3: `pipeline.rs:686-700` | add "(when the server reports its length)" |
| 7 | low | `GLOSSARY.md` Test run | "one per test task, attempt and, unless merged, result file": the code groups by stage, phase and job, and "merged" names PublishTestResults' `mergeTestResults` without saying so | claim 4 #1: `pipeline.rs:384-388` | "one per job and attempt, and per result file unless the task merges them" |
| 8 | low | `CLAUDE.md` mcp-azure bullet | a new read tool needs `read_only_hint` and a `READS` entry in `tests/mcp.rs`; a mistyped `WRITES` name silently skips the mark, and only that test catches it | claim 4 #3: `tools.rs:70`, `tests/mcp.rs:95-149` | one sentence beside "a new write tool goes there" |
| 9 | low | `GLOSSARY.md` Write tool | "whatever the permission mode": in `dontAsk` mode writes are denied; older than this branch | claim 4 #9: `tools.rs:53-54` | "(denied in dontAsk mode)" |

Not checked, and noted only:
- whether the identities lookup needs a scope beyond Project and Team (Read);
- the README's TLS-store claim (reqwest `rustls-no-provider` defaults);
- live enum values, which smoke.md covers.

These are all older than this branch.

## Picks

2026-10-29: "All 1-9".

## Fixed

- 1-6, 8 in e3291bc:
  - INSTRUCTIONS, the `SearchArgs.project` doc, the README and CLAUDE.md say "without project and repo";
  - the wiki description says a project's only wiki is used and several need `wiki=`;
  - "pipeline_log shows the failing steps' logs";
  - `pr_view` shows "the latest iteration and its number";
  - repo_file refuses folders and binaries and can stop before 200 lines, and search refuses `repo` for other kinds;
  - the pipeline_log description says "when the server reports the log's length";
  - CLAUDE.md names `read_only_hint` and `READS` for a new read tool.

  The `tests/mcp.rs` INSTRUCTIONS phrase checks were updated with the text.
- 7, 9 in GLOSSARY.md (uncommitted, with the flow docs):
  - Test run: "one per job and attempt, and one per result file unless the publishing task merges them";
  - Write tool: "in every permission mode but `dontAsk`, which denies it".
- Re-check: Phase 2 holds for the changed sentences, which now match the code lines the claims cited. Phase 4 holds:
  no paths changed and no new links.
