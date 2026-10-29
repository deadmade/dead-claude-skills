---
flow: feature
phase: done
---

# ado-mcp next: what to add, from other Azure DevOps MCPs: flow

## Request

"Hey, could we analyse the other azure dev ops mcps and check what we could add to this one to make it truly awesome.
Also would semantic search etc be helpful?"

## Artifacts

- Spec: [spec.md](spec.md) (approved 2026-10-28)
- Plan: [plan.md](plan.md) (approved 2026-10-28, 8 tasks)
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md): added **Test run** and **Hit** (grill Q8)
- ADRs: none ("no embeddings" is easy to reverse; it lives in the spec's Intent)

## Gates

- Gate 1, spec approved: 2026-10-28 ("I approve"). Reopened 2026-10-28: goal 1a's transport (repo_file sent by
  hand, plan review round 1, finding 1); re-approved 2026-10-28 at Gate 2
- Gate 2, plan approved: 2026-10-28 ("Approve both"), execution: subagent-driven

## Skipped

- /verify Phase 5 (`/test-audit`) and Phase 6 (reading the branch in tui-review): the user skipped both, 2026-10-29.

## Grounding

<!-- Started 2026-10-28. Note: two fix flows on ado-mcp are open in the working tree, uncommitted
(ado-mcp-default-project-400 at phase fix, ado-mcp-wi-comments-missing-url at phase finish). -->

From pstack `how` (one explainer, 2026-10-28) and the original [spec](../ado-mcp/spec.md):

- **Today: 23 tools** (pr_* 11, wi_* 5, pipeline_* 5, repo_list, project_list), 12 of them writes. Each is a thin
  `#[tool]` in `crates/ado-mcp/src/tools.rs` delegating to `pr.rs` / `wi.rs` / `pipeline.rs`, returning text that
  `out::finish` sanitizes and caps at 40,000 chars (`out.rs:48-56`). Lists fetch `limit+1` and end with the call that
  shows more.
- **Writes**: `WRITES` (`tools.rs:22-35`, a `[&str; 12]`) gets the `anthropic/requiresUserInteraction` mark;
  `INSTRUCTIONS` (`tools.rs:37-49`, < 4096 chars, tested) names them. Reads carry `read_only_hint`.
  `tests/mcp.rs:62-171` requires every tool in READS or WRITES and in the 401 sweep.
- **Context**: `Ctx::scope` (`ctx.rs:113-133`): `project` arg, else the git remote → `/vsts/info`. No default project
  any more (working tree). Ids, not names, go in paths.
- **Calls**: the crate (`api.az`, 429 retried once) or hand-sent (`api.get/send`, `Api::url` keeps them under
  `ADO_ORG_URL`). The `Guard` policy refuses any other host. 403 wording maps by `_apis/<area>` (`api.rs:484-495`).
- **Crate areas**: enabled `git, build, pipelines, policy, wit, core, ims`. Available in 0.39.1 but off: `search`,
  `wiki`, `work` (iterations, boards, backlogs), `test`/`test_plan`/`test_results`, `graph`, `distributed_task`,
  `release`, and more.
- **Adding a tool** touches: the module fn + args, `tools.rs` (method, `WRITES`, `INSTRUCTIONS`), a crate feature +
  `Api` field + 403 scope for a new area, `tests/mcp.rs`, a fixture mapped in `tests/fixtures.rs` (or
  `HAND_WRITTEN`), stdio tests, README, smoke.md, PAT scopes in `plugin.json`.
- **Spec non-goals today** (`spec.md:222`): classic Release pipelines, wikis, Artifacts feeds, test plans, TFVC,
  admin/permissions, project settings. Adding wiki or test plans reverses part of that line.
- **Target**: Azure DevOps Server 2022.2 on-prem, one collection, one PAT. Cloud not targeted.

## Prior art

Report from the prior-art agent, 2026-10-28; every source was fetched in that run.

- **Microsoft local** ([README](https://github.com/microsoft/azure-devops-mcp),
  [TOOLSET.md](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/TOOLSET.md)): ~44 tools / ~97 operations
  behind `action` params; domains core 3, work 8, work-items 26, repos 25, pipelines 15, test-plans 9, wiki 6,
  search 3, advanced-security 2; `-d` domain filter. Services only: the
  [FAQ](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/FAQ.md#does-the-mcp-server-support-both-azure-devops-services-and-on-premises-deployments)
  says "no plans to support Azure DevOps on-prem"; on-prem PR #647 closed.
- **Microsoft remote** ([Learn](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server?view=azure-devops)):
  hosted, Entra ID only, Services only; `X-MCP-Toolsets`/`X-MCP-Readonly` headers; PR iteration diffs.
- **Tiberriver256** ([README](https://github.com/Tiberriver256/mcp-server-azure-devops)): 41 flat tools incl.
  `search_code`/`search_wiki`/`search_work_items`, wiki read, WI links and attachments, pipeline artifacts. On-prem
  with PAT. No tool filtering or read-only mode yet (ROADMAP). (Our former npm server.)
- **@wootz/ado-onprem-mcp** ([mirror](https://www.claudemarket.ai/mcp/Wootz/ado-onprem-mcp)): 30 tools, Server 2022
  only, adds sprints/backlogs, WI history, batch create; needs `NODE_TLS_REJECT_UNAUTHORIZED=0` for internal CAs.
- **Vortiago** ([README](https://github.com/Vortiago/mcp-azure-devops)): unmaintained, points to Microsoft's.
- **Approaches:** A broad REST mirror + toolset toggles (MS local); B hosted remote (MS, Services only); C flat
  community wrappers with PAT on-prem (Tiberriver256, Wootz); D curated workflow tools (ours).
- **Pitfalls:** "Too Many Tools Selected (Over 128 Limit)"
  ([TROUBLESHOOTING](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/TROUBLESHOOTING.md#common-mcp-issues));
  on-prem Search needs an admin install (Elasticsearch 7.17 based; WI and wiki search on by default once configured,
  Code Search an opt-in extension per collection; up to 12 h indexing,
  [install guide](https://learn.microsoft.com/en-us/azure/devops/project/search/install-configure-search?view=azure-devops-2022#feature-availability));
  Code Search indexes the default branch only by default
  ([functional code search](https://learn.microsoft.com/en-us/azure/devops/project/search/functional-code-search?view=azure-devops#search-git-projects-and-repositories)).
- **Semantic search:** none of the servers uses embeddings. ADO's "semantic" WI search is full-text with stemming
  ([Boards](https://learn.microsoft.com/en-us/azure/devops/boards/queries/search-box-queries?view=azure-devops#start-a-semantic-work-item-search)).
  The Server 7.1 Search REST API ranks by relevance, with filters and highlights
  ([WI search](https://learn.microsoft.com/en-us/rest/api/azure/devops/search/work-item-search-results/fetch-work-item-search-results?view=azure-devops-server-rest-7.1),
  [code search](https://learn.microsoft.com/en-us/rest/api/azure/devops/search/code-search-results/fetch-code-search-results?view=azure-devops-server-rest-7.1),
  with `def:`/`class:`/`ref:`/`path:`/`ext:`). Agent's verdict: server-side search, not embeddings (an own index
  would crawl the collection with one user's PAT, sync it and store vectors; web-mcp's H4 found BM25 as good).
- **Gaps ranked high for a coding agent:** WI full-text search, code search across uncloned repos (if the extension is
  installed), wiki read ([Pages API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/wiki/pages/get-page?view=azure-devops-server-rest-7.1)),
  test results for a run ([Runs API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/runs/list?view=azure-devops-server-rest-7.1),
  filter by `buildUri`). Medium: artifacts, stage retry, WI links/attachments/history, saved queries, PR reviewers and
  draft toggle, PR changes between iterations, read-only mode. Low: sprints/capacity, remote file/commit reads,
  test-plan management, Advanced Security.

## Brainstorm notes

- 2026-10-28: no pain so far, little use yet: "Just wonderd if we can improve the server for maybe other uses".
- Proposed focus (my call, not yet rejected): find what the local clone can't show (search, wiki, test results);
  leave out planning, admin and test-plan management; stay under ~30 tools.
- The user's server search box offers **Code, Work items and Wiki**: the Search extension and Code Search are
  installed on their collection.
- Playback approved ("lgtm"): one `search` tool (code | work item | wiki; collection-wide, or a project/repo; ranked
  one line per hit with snippet; limit 20 + more); one wiki tool (a page by path as plain text, or the page list);
  read only, no wiki writes. Tests-tab question left unanswered.

- Test results: question unanswered; proposed folding them into `pipeline_view` (nothing shown when none are
  published), so the answer doesn't matter.
- Scope approved ("good :)", 2026-10-28): new `search` and `wiki` tools; `pipeline_view` shows test results;
  `pr_files since=<iteration>`; `wi_view` shows every link. Skipped: attachments, WI history, saved queries,
  artifacts, stage retry, planning, admin, test-plan management, wiki writes.

- Builder check, 2026-10-28, three questions:
  - Code search on Server 7.1 returns only character offsets (confirmed in the
    [docs](https://learn.microsoft.com/en-us/rest/api/azure/devops/search/code-search-results/fetch-code-search-results?view=azure-devops-server-rest-7.1)):
    theirs. The user picked **path + match count, plus a new `repo_file` read tool** (26 tools). Rejected: fetch
    every hit's file (up to 20 GETs per search); path + count only.
  - Retried jobs publish a test run per attempt: my call, only the newest test run per name counts.
  - Server refusing `7.1-preview` for the new areas: my call, a fix-flow then; no contingency in the plan.

## Options

- **Approach, 2026-10-28: A, the crate** (picked "A"). Enable `search`, `wiki` and `test` in
  `azure_devops_rust_api`; hand-read only where a model doesn't fit the server (the D1 rule). Checked in the crate
  source: search, wiki pages and test runs/results exist, each takes `.endpoint()`; search paths are
  `{endpoint}/{org}/{project}/_apis/search/...`. Use `test`, not `test_results` (that one defaults to the
  Services-only `vstmr` host).
  - Rejected: B, hand-sent requests with own structs for the new areas (drops the D1 rule for no measured gain).
  - Named as the smallest option: search alone.

## Grill

Round 1, 2026-10-28 (answer: "make kind req, yes, yes, yes, yes, yes, yes, yes"):

- Q1 search's default kind → **kind required** (not my recommendation, `wi` default).
- Q2 whole collection by default inside a clone: yes. Q3 wiki tree limit 100, several wikis → list and ask: yes.
- Q4 pipeline_view: 20 failed tests, 5 stack lines: yes. Q5 pr_view shows the latest iteration: yes.
- Q6 wi_view links grouped by the server's names, hyperlinks/attachments counted: yes.
- Q7 repo_file 200 lines per call, a folder only says so: yes.
- Q8 glossary terms Test run and Hit: yes. Q9 the seam lines in the spec stand: yes.
- Frontier empty after round 1.

## Plan review

### Plan review round 1 (2026-10-28)

Reviewers: Correctness (fable), Fit (opus, blast-radius), Simpler (sonnet, ponytail-review). None dropped; duplicates
merged (repo_file Accept/format, the 401 sweep).

1. **repo_file reads raw bytes and mangles paths** (blocking; Correctness 2, Fit 1+2; checked in the crate:
   `git/mod.rs:2912` raw `path=`, `:2835` appended again; `examples/git_items_get.rs:32-49` needs `.format("json")`).
   The user asked "why cant we use the output of the crate?"; answered: the URL bug precedes any output. Picked
   **send it by hand** (`api.get`, own struct). Rejected: crate + `.format("json")` refusing `#+&%` paths; crate raw
   output. Spec goal 1a changed (reopens Gate 1 for it).
2. **The two fix flows are uncommitted under this work** (Fit 3). Picked **finish and commit them first**. Rejected:
   build in this tree staging only listed files. Plan: "Before Task 1" note; commits stage listed files by name.
3. **All other findings applied as recommended** (the user: "Apply all"):
   - Test results: `includeRunDetails=true` (blocking, Correctness 1); skipped = total − passed − failed; `$top`
     bound; 404 from the test area = nothing published; scope resolved before the join; `run_routes` route.
   - Search: lower-case string `fields`; info codes 3/4/5/19/20 and 8; 401 sweep `kind: code` from Task 2;
     snippet prefers non-title/content hits; repo status 404 = not indexed, ids in its path; "not installed" only
     without `project`; `kind_required` via `request_raw`.
   - wi_view: every work-item relation by url (TestedBy, Affects, custom), malformed artifact links skipped,
     `view_lines` leak list updated.
   - pr_view/pr_files: iteration degrades to "unavailable", `view_routes` route, expected iteration 2, `since` diff
     line between the two iterations' commits.
   - Docs: installer HANDOFF scopes, README Limits, marketplace, plugin.json and Cargo descriptions, CLAUDE.md
     hand-sent list.
   - Smaller: repo_file needs a repo, `repo=` only when given, wiki 404 `with_what`, wiki id as identifier, code wiki
     version, `large_futures` boxing, first-slice note.
   - Simpler 1 (repo status call): kept, the spec lists the case.
- Shape unchanged (no new task order, module or library), so no second round; edits checked by me.

## Tasks

Before Task 1: finish and commit the fix flows ado-mcp-default-project-400 and ado-mcp-wi-comments-missing-url
(plan review round 1, finding 2). Done: fix flows verified, learned and committed as f30a1b4, 2026-10-28.
Workspace: in place on claude/loving-goodall-syqcul (the user's pick); SDD ledger `.superpowers/sdd/plan/progress.md`.

Task 1: base f30a1b4, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; 81329cf, files clean (Cargo.lock unchanged: the feature adds no dependency); review Approved, fixes dc047d1 197bafc; done
Task 2: base 197bafc, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; ab046f0, files clean; review Approved, fixes fb0ad4b 751b528; done
Task 3: base 751b528, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; d71f342, files clean; review Approved, fix 82c40f2; done
Task 4: base 82c40f2, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; afdf5ba, files clean (search.rs in fix 50bb8b9 by ruling); review Approved, fixes 50bb8b9 8f78b44; done
Task 5: base 8f78b44, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; dcd2073, files clean (tests/api.rs unchanged by ruling; tests/mcp.rs in fix 2795331 by ruling); review Approved, fix 2795331; done
Task 6: base 2795331, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; e755f9d, files clean; review Needs fixes (404 GUIDs, view_concurrent bound), fix 32854b4, re-review clean; done
Task 7: base 32854b4, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; 99e7d2e, files clean; review Approved, fix 9703373; done
Task 8: base 9703373, untracked at start: docs/features/ado-mcp-next/flow.md docs/features/ado-mcp-next/plan.md docs/features/ado-mcp-next/spec.md; 522b39f, files clean (docs/features/ado-mcp/flow.md by ruling; tools.rs, tests/mcp.rs in fix 4f9ac11 by ruling); review Approved, fix 4f9ac11; done

## Rulings

Copied from the SDD ledger, in the order made; each with what it costs if wrong.

- Ruling: the code moved since the plan was written (commit f30a1b4: verify fixes) — dispatches point at the new shapes: `api::json` in api.rs is the D1 raw-body helper; `wi_view`'s item text is built in `item_text` (T7's links go there); INSTRUCTIONS and the mcp-azure README already name list exceptions (repo_list, project_list, pr_files, pipeline_view) and the pr_*-only `repo` — T1/T4/T8 extend that wording, never revert it — the plan predates f30a1b4 — cost if wrong: a task reverts a verify fix, caught at review.
- Ruling: search's scope() value is "Code, Work Items or Wiki (Read)" — the plan's ", for what you searched" lands inside "it needs the … scope" — cost if wrong: one wording line.
- Ruling: one result reads "1 hit" — the plan's literal "N hits" gives "1 hits"; Task 2 already plans "1 match" — cost if wrong: one wording line.
- Ruling: an infoCode line with no results replaces "0 hits" — Review Focus 7 says "not 0 hits" — cost if wrong: a reply drops a redundant line.
- Ruling: kind_required checks rmcp's tool error (isError, "missing field `kind`"), not a JSON-RPC error — rmcp 3.5.1 answers bad arguments that way — cost if wrong: none, the call is still rejected before anything is sent.
- Ruling: a title-only hit prints no snippet line — the brief's "else the first hit" repeats the title under itself — cost if wrong: a hit loses a line that only repeated its title.
- Ruling: search's 404 with a project reads "not found: project <name>, or Search isn't installed on this collection" — the project was just resolved, so a missing Search is as likely — cost if wrong: one longer error line.
- Ruling: fix-wave-2 item 5 (drop repo from wi's more line) withdrawn — Task 2 refuses repo for any kind but code — cost if wrong: none.
- Ruling: wiki search hits print the page path (strip .md, '-' -> space, percent-decode) — the server returns the git file path, which Task 4's wiki tool can't open — cost if wrong: an exotic page name prints a path that needs adjusting by hand.
- Ruling: a wiki snippet skips fileNames hits (no content hit -> no snippet) — Task 1's rule: a snippet that only repeats the hit line is left out — cost if wrong: a hit loses a line repeating its file name.
- Ruling: the Repository filter takes repo as given — repo is a name in normal use; Scope keeps no repo name — cost if wrong: a repo passed by id filters to nothing.
- Ruling: repo_file's concerns 1-4 accepted (folder/binary as tool errors; a cut line ends in …; no more line after a cut last line; start past the end says how many lines the file has) — choices the plan left open, in line with pipeline_log — cost if wrong: wording.
- Ruling: repo_file's items GET has no retry_stale — like pr.rs:262 a 404 means the thing isn't there — cost if wrong: a stale cached repo id reads "not found: <path>" until the cache entry ages out.
- Ruling: repo_file's items GET goes through retry_stale after all (replaces the earlier ruling) — the reviewer showed ctx caches ids for the server's life; a stale id would send Claude hunting for a file that exists, and the retry costs a lookup only on a real miss — cost if wrong: one extra lookup per genuinely missing file.
- Ruling: search strips a code wiki's mappedPath from hit paths (search.rs added to Task 4's Files for fix wave 1) — the search docs describe path as the file's place in the repo, so a wiki published from /docs would print a path the wiki tool can't open; a path not under the folder is left alone — cost if wrong: a page inside a subfolder named like the mapped folder prints one level short.
- Ruling: wiki sends a version only for type codeWiki, not "versions not empty" as planned — the 7.1 sample gives project wikis versions [wikiMaster] too — cost if wrong: none.
- Ruling: Task 4's extras accepted (unknown wiki= lists the wikis, an empty wiki says so, the tree follows order) — small, tested, in the tool's own scope — cost if wrong: a few lines.
- Ruling: tests/api.rs gets no maps_403_test_scope — a test-area 403 never fails the tool, test_403_keeps_stages checks the whole reply with Test Management (Read), and api.rs's unit test maps both paths — cost if wrong: none.
- Ruling: the INSTRUCTIONS line naming 20 failed tests stays (beyond the brief) — the server's list exceptions must stay true, as Task 4's tree 100 — cost if wrong: one clause.
- Ruling: the test-runs call stays outside retry_stale, with a comment — timeline() has its own retry; joining both under one would need a non-retrying timeline variant for a case that heals on the next call — cost if wrong: one reply without test lines after a project is recreated.
- Ruling: a failed results call keeps the summary and the failures read so far, then "  failed tests couldn't be read (<error>)" — the controller's fix asked for the summary to still print; one line beats losing the counts — cost if wrong: wording.
- Ruling: pr_view's other degraded lines (checks, work items, latest run) get with_what labels in this task — pre-existing GUID leak in the same file, reached by the same view — cost if wrong: none.
- Ruling: `since` not in the iteration list → local "not found: iteration <n> on !<id>" before any request — the changes call's 404 can't say which iteration was missing — cost if wrong: none.
- Ruling: links and attachments share one line `links: N  attachments: N` — the plan's "six lines" — cost if wrong: layout.
- Ruling: a link type without attributes.name groups under its rel's last word — the docs samples carry no name — cost if wrong: a label.
- Ruling: no D1 fallback for WorkItemRelation's required `attributes` — wi_view already decoded relations through this model before this task, and the live server decoded wi_view id=153 through it (2026-10-28; whether that item had relations is unknown — smoke checks one with links) — cost if wrong: wi_view fails on such an item, as it already would have.
- Ruling: Task 8's fix touches tools.rs (INSTRUCTIONS' repo override, wi_view's description) — model-facing text lagging the code from Tasks 3 and 7 — cost if wrong: none.

- Ruling (final review fixes, 2026-10-29): pr_list/pr_view say `1 approval` in the singular (32854b4) — the brief asked for the singular after a one everywhere — cost if wrong: none.
- Ruling (final review fixes): `named()` takes a shown label, so a repo 404 names the clone's project by name for every tool, not its GUID (c98c6b5) — base goal 4: a 404 never prints a GUID — cost if wrong: none.
- Ruling (final review fixes): the more line is left out when failed tests can't be read (59ecabe); search's `repo` asks for a name (6881ee4); `hyperlinks:` replaces `links:` (8395658); a search 404 with only `repo` names the repo (98b9e0a) — final review minors 3-7 — cost if wrong: wording.

## Deviations

- 2026-10-29, final review: spec goal 3's "of the test runs with the same name, only the newest counts" dropped real runs (PublishTestResults makes one run per result file, all same-named). Asked the user: "Retries by job (Recommended)": runs from the same stage/job count at the job's latest attempt (pipelineReference), runs without one always count. Spec goal 3 and GLOSSARY "Test run" updated.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
| 1 `search` (wi, code, wiki; scope, infoCode, 404s, more line) | T1, T2 (+ T4 fix: mappedPath) | `crates/ado-mcp/src/search.rs:253` | `tests/search.rs` (wi_hits_one_line_each … repo_arg_is_a_name) |
| 1a `repo_file` | T3 | `crates/ado-mcp/src/file.rs:79` | `tests/file.rs` (reads_lines … start_past_the_end) |
| 2 `wiki` | T4 | `crates/ado-mcp/src/wiki.rs:74` | `tests/wiki.rs` (page_text, tree_default, …) |
| 3 test results in `pipeline_view` | T5 (+ final fix: latest attempt per job) | `crates/ado-mcp/src/pipeline.rs:470`, `:404` | `tests/pipeline.rs:179-367` (tests_summary_and_failures … test_403_keeps_stages) |
| 4 `pr_files since`, `pr_view` iteration | T6 | `crates/ado-mcp/src/pr.rs:684`, `:656` | `tests/pr.rs:930-1151` (files_since … view_sections_404) |
| 5 `wi_view` every link | T7 | `crates/ado-mcp/src/wi.rs:146` | `src/wi.rs:737` (other_links_*), `tests/wi.rs:125` (view_all_links) |
| 6 plugin, docs, permissions | T8 | mcp-azure `README.md`, `installer/install.mjs` HANDOFF, `crates/ado-mcp/src/api.rs` `scope()`, `src/tools.rs` INSTRUCTIONS | `tests/mcp.rs:78` (READS 14, 401 sweep, INSTRUCTIONS), `tests/api.rs` (maps_403_*), `npm test` |
| 7 tests | T1-T8 | `crates/ado-mcp/tests/` | `cargo test` (272), clippy, fmt |

No goal without code, no code without a goal. Left to the live smoke checklist (`docs/features/ado-mcp/smoke.md`):
the crate's closed enums (D8), mappedPath on a code wiki, `7.1-preview` on search, wiki and test, a run's
`pipelineReference` shape (the 7.1 sample has none), and a rerun job that publishes no test runs.

## Run verdict

/verify, 2026-10-29, on `claude/loving-goodall-syqcul ← f30a1b4`: **ready**.

| Part   | State |
| ------ | ----- |
| Checks | green: ado-mcp `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (282/282); `npm test` 141 pass, 1 skipped, 1 fail (the known Windows symlink `EPERM` in `installer/files.test.mjs`) |
| Review | `/self-review`: 8 passes; the user picked 1-7 and 12-15, all fixed (6985a5e..cca5db6); left 8 (failed count by outcome), 9 (the more-failed-tests pointer), 10 (a real `pipelineReference` fixture, after the smoke run), 11 (missing content) |
| Docs   | `/doc-audit branch`: 9 findings, all fixed (e3291bc, GLOSSARY.md); [report](../../audits/2026-10-29-doc-audit-branch.md) |
| Tests  | skipped by the user: the test analyzer's gaps were filled |
| Read   | skipped by the user |

Before a release: the live smoke checklist (`docs/features/ado-mcp/smoke.md`) at work.

Branch decision, 2026-10-29: commit the flow docs, push and open a PR to main ("Commit docs, push + PR").

## Learned

- `docs/solutions/ado-mcp-test-runs-per-result-file.md`: PublishTestResults publishes one run per result file, all
  alike named; retries are told apart by `pipelineReference` only.
- `docs/solutions/ado-wiki-search-path-vs-page-path.md`: wiki search returns git file paths, not page paths.
- CLAUDE.md (ado-mcp tests): a no-GUID test needs a GUID-shaped id, since the fixtures' ids aren't.
