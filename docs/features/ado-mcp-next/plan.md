# ado-mcp next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `search`, `repo_file` and `wiki` to ado-mcp, test results to `pipeline_view`, `since` to `pr_files`
(with the latest iteration in `pr_view`), and every link to `wi_view`.

**Architecture:** Each new tool is a module (`src/search.rs`, `src/file.rs`, `src/wiki.rs`) with an args struct and
one `pub(crate) async fn` returning `Result<String, ApiError>`, registered as a read tool in `src/tools.rs`. Calls go
through Microsoft's crate: the `search`, `wiki` and `test` areas are switched on and get one client each in `Api`,
built by the existing `area!` macro. The three extensions stay inside `pipeline.rs`, `pr.rs` and `wi.rs`.

**Tech Stack:** Rust 2024 (1.97), rmcp =3.5.1, reqwest =0.13.5, azure_devops_rust_api =0.39.1, azure_core =1.1.0.
Stack skill for every builder and reviewer: rust-skills `rust-best-practices` (load it with the Skill tool).

**Spec:** [spec.md](spec.md), on top of the [base spec](../ado-mcp/spec.md). Executors read both.

**Before Task 1** (plan review round 1): the fix flows `ado-mcp-default-project-400` and
`ado-mcp-wi-comments-missing-url` are finished and committed on `main`'s line, so the build starts from a clean tree
that already holds them (no default project; `wi_view` comments read into our own struct).

**First slice:** Tasks 1–3 (search and `repo_file`) can merge on their own; Tasks 4–7 are independent of them and of
each other; Task 8 follows the tasks it documents.

## Global Constraints

- Search scope (collection, project or repo): resolved in the `search` module; never seen by `ctx`, `api` or `out`.
- Search unavailable or indexing: resolved in the `search` module (its `infoCode` and status mapping); never seen by
  `api` beyond the generic status line.
- New PAT scopes: resolved in `api.rs`'s 403 wording (the area → scope map) and the README; never seen by the tool
  modules.
- Highlight markup: resolved in the `search` module's pure hit formatting; never seen by `out`.
- Test results: resolved in `pipeline.rs` (`pipeline_view`); never seen by other tools.
- Which repo and branch a file is read from: resolved by `ctx.scope` as for every tool, plus `repo_file`'s own
  default-branch lookup; never seen by `search` (its hits print project, repo and path; Claude passes them).
  _Plan note:_ the "lookup" is the server's own default: an items GET without a version reads the default branch,
  so `repo_file` sends no extra request.
- `repo_file`'s items GET is sent by hand (`api.get`), not through the crate (spec goal 1a, plan review round 1):
  the crate's items call puts `path` into the URL raw and again escaped (`git/mod.rs:2912`, `:2835`).
- A 404 reply never prints an id or GUID: relabel it with `ApiError::with_what` (base goal 4).
- Everything in the base spec's Constraints: Rust 2024, `rust-version = "1.97"`, own `Cargo.lock`, clippy pedantic,
  exact pins `rmcp =3.5.1`, `reqwest =0.13.5`, `azure_devops_rust_api =0.39.1`, `azure_core =1.1.0`; `reqwest` stays
  the one azure_core uses (`cargo tree -d -i reqwest` shows one).
- Enable the crate features `search`, `wiki` and `test`, not `test_results` (its default host is the Services-only
  `vstmr`). Every new client goes through `area!` (endpoint, our transport, `RetryOptions::none()`, the `Guard`).
- A crate model the server's answer doesn't satisfy gets the D1 fallback: the raw body (`.send()` +
  `into_raw_response().into_body()`) and a small struct of ours, named in a comment, its fixture in `HAND_WRITTEN`.
- All new tools are read tools: `annotations(read_only_hint = true)`, not in `WRITES`; added to `READS` and the 401
  sweep in `tests/mcp.rs`.
- Output per the base spec's goal 4: plain text, one line per item, id first, no URLs or GUIDs, lists default to 20
  with `… more: <call> limit=<2×>`, long text cut with the call that shows the rest. Every reply goes out through
  `out::finish`.
- No `retry_stale` around a search (a POST): sent once.
- Fixtures are shaped from the Server 7.1 docs and each one is mapped in `tests/fixtures.rs` `TABLE` (or
  `HAND_WRITTEN`).
- Commits: one sentence, no co-author lines; stage the task's **Files** by name (`git add <paths>`), never
  `git add -A`.
- If clippy's pedantic `large_futures` flags a tool's future, box it in `tools.rs` as `pr_files` already is
  (`tools.rs:117`).
- If a task asks you to pass a new signal through types, schemas, pipelines, or similar layers, stop and look for a
  more direct path.
- TDD wins here: every change, trivial ones too, gets its failing test first.

**Before you write** (ponytail, verbatim): Read the task and the code it touches. List every place your change must
reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would
destroy or expose, callers that stop working. That is scope. Extra features are not.

Checks for every task, from `crates/ado-mcp`: `cargo test` and `cargo clippy --all-targets -- -D warnings`.

## Review Focus

1. Search text holding `"` (code search phrases, `path:"a b"`): the `… more:` line must still be a call that
   repeats the same text. Test in Task 1.
2. Search highlights holding HTML entities (`&lt;T&gt;`) besides `<highlighthit>`: printed decoded, as text. Test in
   Task 1.
3. Project names with spaces (`My Proj`) in `search project=`, `repo_file` and `wiki`: paths use ids, filters use
   the name verbatim. Tests in Tasks 1, 3 and 4 use `My Proj`.
4. A test-results call that fails (403) on a run with stages: `pipeline_view` still shows the stages and issues,
   plus one line. Test in Task 5.
5. `repo_file` on a file whose one line is longer than the reply cap (minified JS): the reply still ends with a
   usable `start=` call. Test in Task 3.
6. A path holding `#`, `+`, `&` or a space (`/src/C#/a+b&c.cs`): `repo_file` reads exactly that file (one `path`
   query value, escaped once). Test in Task 3.
7. A search the server rejects (`*Parser`: infoCode 4) answers 200 with zero results: the reply says the query was
   rejected, not `0 hits`. Test in Task 1.

---

### Task 1: `search` for work items, with the search plumbing

**Files:**
- Modify: `crates/ado-mcp/Cargo.toml` (feature `search`), `crates/ado-mcp/Cargo.lock`
- Modify: `crates/ado-mcp/src/api.rs` (`Api.search` field, `area!(search)`; `scope()`: `"search"` →
  `"Code, Work Items or Wiki (Read), for what you searched"`)
- Create: `crates/ado-mcp/src/search.rs`; Modify: `crates/ado-mcp/src/main.rs` (`mod search;`)
- Modify: `crates/ado-mcp/src/tools.rs` (tool method, `INSTRUCTIONS` line)
- Create: `crates/ado-mcp/tests/search.rs`, `crates/ado-mcp/tests/fixtures/search-wi.json`
- Modify: `crates/ado-mcp/tests/fixtures.rs`, `crates/ado-mcp/tests/mcp.rs`, `crates/ado-mcp/tests/api.rs`

**Interfaces:**
- Produces: `pub(crate) enum Kind { Code, Wi, Wiki }` (serde `rename_all = "lowercase"`, JsonSchema);
  `pub(crate) struct SearchArgs { kind: Kind, text: String, project: Option<String>, repo: Option<String>,
  limit: Option<u16> }`; `pub(crate) async fn search(ctx: &Ctx, a: &SearchArgs) -> Result<String, ApiError>`;
  pure `fn plain(highlight: &str) -> String` (strips `<highlighthit>`/`</highlighthit>`, decodes entities via
  `out::html_to_text`); pure `fn info(code: i32) -> Option<&'static str>`; pure `fn more_call(a: &SearchArgs,
  limit: usize) -> String`.
- Task 2 adds the `Code` and `Wiki` arms; in this task they return `ApiError::local("…")` placeholders that Task 2
  replaces (not shipped: Task 2 follows directly).

Behaviour: `kind` and `text` required. No `project` → the crate call gets `""` as project (the Guard squeezes `//`:
path `/tfs/Coll/_apis/search/workitemsearchresults`), no filters. `project` → `ctx.scope(project, None, None)`, the
path uses `seg(&scope.project_id)`, filter `{"System.TeamProject": [scope.project]}`. `$top = limit + 1`,
`includeFacets: false`. Header line `N hits` from `count`; then per hit `#<id> [<type>] <state>  <title>` and an
indented snippet line (`plain`, one line, ≤ 200 chars). The result's `fields` keys are lower-case and their values
strings (`"system.id": "2"`, `system.workitemtype`, `system.state`, `system.title`; Server 7.1 Work Item Search
sample): look them up by those lower-case names. The snippet is the first hit whose `fieldReferenceName` isn't
`system.title`, else the first hit. `infoCode` ≠ 0 and known → its line first:
- `1`, `6`, `7`, `9`: "the search index is being rebuilt; results may be incomplete"
- `2`: "search indexing hasn't started on this collection"
- `11`: "work items aren't searchable for this PAT"
- `3`, `4`, `5`, `19`, `20`: "the server rejected the query: <the doc's reason>" (invalid request; prefix wildcard
  not supported; several words with a code filter not supported; phrase with a code filter not supported; wildcard
  with a code filter not supported)
- `8`: "the server trimmed the results to its maximum"
- 0 or unknown → nothing.

A 404 on the search route with no `project` → `"Search isn't installed or is turned off on this collection"`; with
`project`, the generic not-found relabelled `with_what("project <name>")` (a stale cached id is the likelier cause).

- [ ] **Step 1: Write the failing tests** in `tests/search.rs` (helpers copied from `tests/wi.rs`: `env`, `ok`,
  `bodies`):
  - `wi_hits_one_line_each`: route the collection-wide path to `search-wi.json`, shaped from the Server 7.1 sample
    (lower-case string `fields`; 3 results, `count: 3`; one result whose hits are a `system.title` highlight and a
    `system.description` highlight `fix <highlighthit>login</highlighthit> &lt;T&gt;`); assert the reply has
    `3 hits`, `#101 [Bug] Active  Login fails`, the snippet line `fix login <T>` (not the title), and no
    `highlighthit`, `http` or `url`.
  - `wi_project_filter`: `project: "My Proj"` → one request to `/tfs/Coll/<PROJ>/_apis/search/workitemsearchresults`
    whose body has `filters["System.TeamProject"] == ["My Proj"]`, `searchText`, `$top == 21`.
  - `limit_and_more_quotes`: 2 results with `limit: 1`, text `path:"a b"` → reply ends with
    `… more: search kind=wi text="path:\"a b\"" limit=2`.
  - `info_code_line`: `infoCode: 2` → first line `search indexing hasn't started on this collection`.
  - `query_rejected` (Review Focus 7): `infoCode: 4`, no results → the rejected-query line, no `0 hits` alone.
  - `trimmed`: `infoCode: 8` → the trimmed line, then the hits.
  - `not_installed`: 404 without `project` → is_error and the reply equals the not-installed line;
    `project_404`: 404 with `project: "My Proj"` → names `project My Proj`, no GUID.
  - `kind_required`: a call without `kind` → `Mcp::request_raw("tools/call", …)` returns a JSON-RPC error whose
    `message` contains `kind` (`ok`/`call` would panic on a reply with no `result`).
  - In `tests/api.rs`, a 403 on `_apis/search/…` names `Code, Work Items or Wiki (Read)`.
- [ ] **Step 2:** `cargo test --test search --test api` → FAIL (no tool `search`).
- [ ] **Step 3:** Add `search` to the crate features, `Api.search`, the `scope()` arm; write `search.rs` per the
  Interfaces and Behaviour above; register `#[tool(description = "Search the collection's work items, code or wiki
  with the server's own search (ranked). kind and text are required; project (and repo, for code) narrow it.",
  annotations(read_only_hint = true))]`; add one `INSTRUCTIONS` line: "- search finds work items, wiki pages and
  code in repos that aren't cloned; for the clone itself, search locally."
- [ ] **Step 4:** Add `search` to `READS` (12) and the 401 sweep with `{"kind": "wi", "text": "x"}` (Task 2 moves
  it to `kind: code`); map
  `search-wi.json` → `search::models::WorkItemSearchResponse` in `TABLE`.
- [ ] **Step 5:** `cargo test` and clippy → PASS. The `INSTRUCTIONS` length test still passes.
- [ ] **Step 6:** Commit: "Add the search tool for work items over the server's Search."

### Task 2: `search` for code and wiki

**Files:**
- Modify: `crates/ado-mcp/src/search.rs`, `crates/ado-mcp/tests/search.rs`, `crates/ado-mcp/tests/fixtures.rs`,
  `crates/ado-mcp/tests/mcp.rs` (the sweep's `search` call becomes `{"kind": "code", "text": "x"}`: the sweep merges
  `repo: R` into every call, `repo` with another kind is refused before any request, and code search's first request,
  the repo lookup, is already routed to 401)
- Create: `crates/ado-mcp/tests/fixtures/search-code.json`, `crates/ado-mcp/tests/fixtures/search-wiki.json`,
  `crates/ado-mcp/tests/fixtures/search-repo-status.json`

**Interfaces:**
- Consumes: Task 1's `SearchArgs`, `plain`, `info`, `more_call`.
- Produces: pure `fn matches(m: Option<&serde_json::Value>) -> usize` (length of `matches.content`).

Behaviour: code → `fetch_code_search_results`, lines `<project>/<repo>:<path>  (N matches)` (`1 match` singular).
`project` → filter `{"Project": [name]}`; `repo` → also `{"Repository": [repo]}` (needs `project` or a clone: the
scope from `ctx.scope(project, Some(repo), None)`). `repo` with `kind` ≠ code → error "repo narrows code search
only". Code search with `repo` and zero hits → one more request, the crate's repository index status
(`search/status/repositories/<repo>`, passing `seg(project_id)` and the scope's `repo_id`: the crate puts both into
the URL raw); a 404 or a repo with no indexed branch adds `"<repo> isn't indexed by Search yet"` (spec goal 1's third
case); any other failure of the status call adds nothing. Wiki → `fetch_wiki_search_results`, lines
`<project>/<wiki.name>:<path>` and an indented snippet from the first hit whose `fieldReferenceName` is `content`,
else the first hit; `project` → filter `{"Project": [name]}`.

- [ ] **Step 1: Write the failing tests:** `code_hits` (fixture with 2 results, 3 and 1 offsets →
  `Shop/Orders:/src/OrderParser.cs  (3 matches)` and `… (1 match)`; no `contentId`/`changeId` value in the reply);
  `code_repo_filter` (body filters `Project` and `Repository`); `code_repo_not_indexed` (zero hits + a status
  fixture with no indexed branches → the not-indexed line; the status fixture goes in `TABLE` as the crate's
  repository status model); `code_repo_status_404` (zero hits + status 404 → the same line); `repo_needs_code` (kind wi + repo → error);
  `wiki_hits` (`Shop/Shop.wiki:/Runbooks/Deploy` and the `content` hit's snippet without markup, not the
  `fileNames` hit).
- [ ] **Step 2:** `cargo test --test search` → FAIL.
- [ ] **Step 3:** Implement the two arms.
- [ ] **Step 4:** Map `search-code.json` → `CodeSearchResponse`, `search-wiki.json` → `WikiSearchResponse`.
- [ ] **Step 5:** `cargo test` and clippy → PASS.
- [ ] **Step 6:** Commit: "Let search find code and wiki pages."

### Task 3: `repo_file`

**Files:**
- Create: `crates/ado-mcp/src/file.rs`, `crates/ado-mcp/tests/file.rs`, `crates/ado-mcp/tests/fixtures/item.json`,
  `crates/ado-mcp/tests/fixtures/item-folder.json`
- Modify: `crates/ado-mcp/src/main.rs`, `crates/ado-mcp/src/tools.rs`, `crates/ado-mcp/tests/fixtures.rs`,
  `crates/ado-mcp/tests/mcp.rs`

**Interfaces:**
- Produces: `pub(crate) struct RepoFileArgs { project: Option<String>, repo: Option<String>, path: String,
  branch: Option<String>, start: Option<u32> }`; `pub(crate) async fn repo_file(ctx: &Ctx, a: &RepoFileArgs) ->
  Result<String, ApiError>`; pure `fn numbered(content: &str, start: usize, max_lines: usize, max_chars: usize) ->
  (String, Option<usize>)` returning the lines `{n:>5}  {line}` and the next start line if cut.

Behaviour: scope `ctx.scope(project, repo, None)` (the clone's repo by default; `branch` is not taken from the
clone: no `branch` → no version, so the server reads the default branch). No `repo_id` in the scope (a `project`
without `repo`, or no clone) → error `"pass repo (repo_list names them)"` before any request. The request is sent by
hand, not through the crate (Global Constraints): `api.get` on
`{seg(project_id)}/_apis/git/repositories/{repo_id}/items` with the query `path=<path>` (escaped once by the query
builder), `includeContent=true`, `includeContentMetadata=true`, `$format=json`, and `versionDescriptor.version=<branch>`
plus `versionDescriptor.versionType=branch` when given, at `V71_PREVIEW`; read into our own
`struct Item { is_folder: Option<bool>, content: Option<String>, content_metadata: Option<Meta> }` with
`struct Meta { is_binary: Option<bool> }` (camelCase serde), named in a comment as the D1 fallback for the crate's
items call. `isFolder` → `"<path> is a folder"`; `contentMetadata.isBinary` → `"<path> is a binary file"`; 404 →
`with_what("<path>")` so it reads `not found: <path>` with no GUID. Text: at most 200 lines from `start` (default 1)
within `out::REPLY_MAX - 1000` characters; a line longer than that is cut at a char boundary and still counts as one
line; if more remains, the last line is `… more: repo_file path=<p> start=<next>` plus the given `project`, `repo` and
`branch` (via `out::args`, only those the call gave: the scope holds no repo name).

- [ ] **Step 1: Write the failing tests:** `numbered` unit tests in `file.rs` (start 1 of 3 lines → no next; 250
  lines → 200 shown, next 201; one 50,000-char line → cut, next 2); stdio tests `reads_lines` (`My Proj`, numbered
  `    1  using System;`, the query has exactly one `path`, `includeContent=true` and `$format=json`, and no
  `versionDescriptor` without `branch`), `branch_passed`, `odd_path` (Review Focus 6: path `/src/C#/a+b&c.cs` arrives
  decoded as exactly that one `path` value), `folder`, `binary`, `missing` (no GUID in the reply), `needs_repo`
  (`project` without `repo` → the pass-repo line, no request), and `long_line_more` (Review Focus 5).
- [ ] **Step 2:** `cargo test --test file` → FAIL.
- [ ] **Step 3:** Implement and register as a read tool: description "Read a file from any repo on the server (default
  branch unless branch), 200 numbered lines per call from start. For search hits in repos that aren't cloned."
- [ ] **Step 4:** `READS` (13), the 401 sweep (`{"path": "/a"}`, which carries the sweep's `repo: R`), and both
  fixtures in `HAND_WRITTEN` (our own struct reads them).
- [ ] **Step 5:** `cargo test` and clippy → PASS.
- [ ] **Step 6:** Commit: "Add repo_file to read a file from any repo on the server."

### Task 4: `wiki`

**Files:**
- Modify: `crates/ado-mcp/Cargo.toml` (feature `wiki`), `crates/ado-mcp/Cargo.lock`, `crates/ado-mcp/src/api.rs`
  (`Api.wiki`; `scope()`: `"wiki"` → `"Wiki (Read)"`), `crates/ado-mcp/src/main.rs`, `crates/ado-mcp/src/tools.rs`
- Create: `crates/ado-mcp/src/wiki.rs`, `crates/ado-mcp/tests/wiki.rs`, fixtures `wikis.json`, `wikis-one.json`,
  `wiki-page.json`, `wiki-tree.json`
- Modify: `crates/ado-mcp/tests/fixtures.rs`, `crates/ado-mcp/tests/mcp.rs`, `crates/ado-mcp/tests/api.rs`

**Interfaces:**
- Produces: `pub(crate) struct WikiArgs { project: Option<String>, wiki: Option<String>, path: Option<String>,
  full: Option<bool>, limit: Option<u16> }`; `pub(crate) async fn wiki(ctx: &Ctx, a: &WikiArgs) -> Result<String,
  ApiError>`; pure `fn tree(page: &WikiPage, depth: usize, out: &mut Vec<String>)` (two spaces per level).

Behaviour: scope `ctx.scope(project, None, None)`. No `wiki` → list the project's wikis; one → use it; several →
`"several wikis: <a>, <b>; pass wiki="`; none → `"<project> has no wiki"`. The page calls take the picked wiki's `id` from the list as `wikiIdentifier` (the crate
puts it into the URL raw; an id holds no `/` or space), and for a code wiki (`versions` not empty) also
`version_descriptor_version(versions[0].version)`. A 404 on a page → `with_what("page <path>")`, no GUID. With `path`:
`get_page` with `include_content(true)`; the reply is `<wiki>:<path>` then the content, `out::clip(content, DESC_MAX,
"wiki … path=… full=true")` unless `full`. Without `path`: `get_page` at `/` with `recursion_level(Full)`; the tree,
cut at `limit` (default 100) with the more line.

- [ ] **Step 1: Write the failing tests:** `page_text` (content shown, `My Proj`, no URL), `page_clipped` (5000
  chars → cut line naming `full=true`), `tree_default` (indentation, 100 cap with `limit=200` more line on a
  120-page fixture built in the test), `several_wikis`, `no_wiki`, `missing_page` (`not found: page /Nope`, no
  GUID), `code_wiki_version` (a code wiki's query carries `versionDescriptor.version=main`), and the 403 →
  `Wiki (Read)` line in
  `tests/api.rs`.
- [ ] **Step 2:** `cargo test --test wiki --test api` → FAIL.
- [ ] **Step 3:** Implement and register: "Read a wiki page (path) as markdown, or list the wiki's pages without
  path. One wiki per project is picked automatically." Add `INSTRUCTIONS` line: "- wiki reads the project's wiki
  pages; repo_file reads files of repos that aren't cloned."
- [ ] **Step 4:** `READS` (14), the 401 sweep (`{}`), `TABLE` (`wiki::models::WikiV2List`,
  `wiki::models::WikiPage`); a model that doesn't fit → D1 fallback.
- [ ] **Step 5:** `cargo test` and clippy → PASS.
- [ ] **Step 6:** Commit: "Add the wiki tool for reading wiki pages."

### Task 5: test results in `pipeline_view`

**Files:**
- Modify: `crates/ado-mcp/Cargo.toml` (feature `test`), `crates/ado-mcp/Cargo.lock`, `crates/ado-mcp/src/api.rs`
  (`Api.test`; `scope()`: `"test"` → `"Test Management (Read)"`), `crates/ado-mcp/src/pipeline.rs`,
  `crates/ado-mcp/src/tools.rs` (description)
- Create: fixtures `test-runs.json`, `test-results.json`
- Modify: `crates/ado-mcp/tests/pipeline.rs` (also `run_routes` gains an empty test-runs route, so the existing
  whole-reply `assert_eq!` in `view_tree_skips_phase` holds), `crates/ado-mcp/tests/fixtures.rs`,
  `crates/ado-mcp/tests/api.rs`

**Interfaces:**
- Produces (private to `pipeline.rs`): pure `fn newest_per_name(runs: Vec<TestRun>) -> Vec<TestRun>` (highest id
  per `name`); pure `fn test_lines(runs: &[TestRun], failed: &[TestCaseResult], rest: &str) -> Vec<String>`.

Behaviour: resolve the scope first (`ctx.scope`, as `timeline()` does inside `retry_stale`), then the timeline and
`test.runs_client().list(org, project).build_uri("vstfs:///Build/Build/<run>").include_run_details(true)`
concurrently (`tokio::join!`). Without `includeRunDetails` the runs carry no counts (Server 7.1 Runs-List samples). No
runs, or a 404 from the test area (no test area on the server) → nothing added. Else `newest_per_name`, the summary
`tests: <passed> passed, <failed> failed, <skipped> skipped` with passed = `passedTests`, failed = `unanalyzedTests`
("Number of failed tests in the run"), skipped = `totalTests − passedTests − unanalyzedTests` (a framework-skipped
test is published as `NotExecuted`, in neither `notApplicableTests` nor `incompleteTests`), summed over the kept runs.
Then for each kept run with failures, `results_client().list(org, project, run_id).outcomes("Failed").top(remaining +
1)` (remaining = 20 minus the failures already shown), up to 20 failed tests overall: `<testCaseTitle>:
<errorMessage first line>` and the first 5 `stackTrace` lines indented by four spaces; past 20,
`… <failed − 20> more failed tests` from the counts. Any other test-area error → one line
`tests: couldn't be read (<error>)`; the stages and issues still print.

- [ ] **Step 1: Write the failing tests:** unit tests for `newest_per_name` (two runs named `Unit`, ids 5 and 9 → 9
  kept) and `test_lines` (summary wording, 5 stack lines max, 20 cap); stdio tests `tests_summary_and_failures`,
  `no_test_runs_adds_nothing`, `test_area_404_adds_nothing`, `retried_run_counts_newest`, `runs_query`
  (`buildUri` and `includeRunDetails=true`; the failed-results query has `outcomes=Failed` and `$top`),
  `test_403_keeps_stages` (Review Focus 4: stages and issues present, plus `tests: couldn't be read` naming
  `Test Management (Read)`). `test-runs.json` is shaped from the Runs-List `includeRunDetails=true` sample.
- [ ] **Step 2:** `cargo test --test pipeline` → FAIL.
- [ ] **Step 3:** Implement; description gains "and its test results".
- [ ] **Step 4:** `TABLE`: `test::models::TestRunList`, `test::models::TestCaseResultList`.
- [ ] **Step 5:** `cargo test` and clippy → PASS.
- [ ] **Step 6:** Commit: "Show a run's test results in pipeline_view."

### Task 6: `pr_files since` and the latest iteration in `pr_view`

**Files:**
- Modify: `crates/ado-mcp/src/pr.rs` (`PrFilesArgs.since: Option<u32>`, `pr_files`, `pr_view`),
  `crates/ado-mcp/src/tools.rs` (descriptions), `crates/ado-mcp/tests/pr.rs`

**Interfaces:**
- Consumes: the iterations list `pr_files` already sends (`pr.rs:648-660`).

Behaviour: `since` → the iteration-changes call gets `.compare_to(since)`; `since == latest` → `"no changes since
iteration <n> (the latest)"`; `since > latest` or `since == 0` → error `"since must be 1…<latest>"`. The header
names it: `changes since iteration <since> (latest <n>)`. With `since`, the diff line becomes
`git diff <since's sourceRefCommit>..<latest's sourceRefCommit>` (both from the iterations list, plain hex) instead
of the whole-PR diff, and the `--stat` more line likewise. `pr_view` sends the iterations list concurrently with its
other calls and adds `iteration: <latest>` to its status line; if that call fails it prints
`iteration: unavailable (<error>)`, the way `checks` and `latest run` degrade (`pr.rs:472-487`), never failing the
view. `view_routes` (`tests/pr.rs:32-41`) gains the iterations route.

- [ ] **Step 1: Write the failing tests:** `files_since` (query has `$compareTo=2`), `files_since_latest`,
  `files_since_beyond`, `files_since_zero`, `files_since_diff_line` (the two commits from `iterations.json`),
  `view_shows_iteration` (`iteration: 2`: `iterations.json` holds ids 1 and 2), `view_iteration_unavailable`.
- [ ] **Step 2:** `cargo test --test pr` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` and clippy → PASS.
- [ ] **Step 5:** Commit: "Let pr_files list the changes since an iteration and show the latest one in pr_view."

### Task 7: every link in `wi_view`

**Files:**
- Modify: `crates/ado-mcp/src/wi.rs`, `crates/ado-mcp/tests/wi.rs`, `crates/ado-mcp/tests/fixtures/wi.json` (more
  relations)

**Interfaces:**
- Produces (private): pure `fn other_links(w: &WorkItem) -> Vec<String>`.

Behaviour: after parent/children/PRs, the remaining relations: work item links (every relation whose `rel` isn't
`ArtifactLink`, `Hyperlink` or `AttachedFile` and whose `url` contains `/_apis/wit/workItems/`, minus the two
Hierarchy rels; so `Microsoft.VSTS.Common.TestedBy-*`, `Affects-*` and custom types count) grouped by
`attributes.name` (`Related: #4, #9`), in first-seen order; `ArtifactLink` to a commit
(`vstfs:///Git/Commit/…%2F<sha>`) → `commits: <first 8 of sha>, …`; to a branch (`vstfs:///Git/Ref/…%2FGB<name>`,
percent-decoded) → `branches: <name>`; other artifact links, and a commit or branch link that doesn't parse, are left
out; `Hyperlink` and `AttachedFile` →
`links: N` and `attachments: N` counts. No URL reaches the reply.

- [ ] **Step 1: Write the failing tests:** `other_links` unit test (Related ×2, Duplicate Of, a
  `Microsoft.VSTS.Common.TestedBy-Forward` link, a commit, a branch `feature/x`, a malformed commit link, 2
  attachments, 1 hyperlink → six lines in that order, no `vstfs`/`http`); stdio `view_all_links`. In the existing
  `view_lines` (`tests/wi.rs:111`), drop `#99` and `2d9e7b10` from the leak list (`wi.json` links #99 as Related and
  commit `2d9e7b10…`), assert `Related: #99` and `commits: 2d9e7b10` instead, keep `http` and `vstfs`.
- [ ] **Step 2:** `cargo test --test wi` → FAIL.
- [ ] **Step 3:** Implement. `wi.json` still fits `WorkItem` (`cargo test --test fixtures`).
- [ ] **Step 4:** `cargo test` and clippy → PASS.
- [ ] **Step 5:** Commit: "Show every link of a work item in wi_view."

### Task 8: docs, scopes and the smoke checklist

**Files:**
- Modify: `plugins/opt-in/mcp/mcp-azure/README.md` (tool list, PAT scopes + Wiki (Read), Test Management (Read),
  the Limits line that says no wikis or test plans),
  `installer/install.mjs:473-474` (the `HANDOFF` text's PAT scopes),
  `.claude-plugin/marketplace.json:56` and `crates/ado-mcp/Cargo.toml` `description` (now also search, wiki and
  files),
  `plugins/opt-in/mcp/mcp-azure/.claude-plugin/plugin.json` (description, and the PAT description's scopes),
  `docs/features/ado-mcp/smoke.md` (a section per new tool and extension: what to call, what to paste back),
  `docs/features/ado-mcp/spec.md:222` ("wikis" → "wiki writes"), `CLAUDE.md` (mcp-azure line: the tool families
  and `search`, `repo_file`, `wiki`; add `repo_file`'s items GET to the "sent or read by hand" list)

- [ ] **Step 1:** Make the edits. The smoke section also checks that the server accepts `7.1-preview` for search,
  wiki and test (spec Constraints).
- [ ] **Step 2:** `npm test` from the repo root (installer tests included) → PASS (check-repo, prettier-clean JSON/MD via `nix fmt` if
  available).
- [ ] **Step 3:** Commit: "Document search, repo_file, wiki and the new PAT scopes for mcp-azure."
