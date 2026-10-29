# ado-mcp next: search, wiki, test results and three extensions: spec

Status: approved, Gate 1 on 2026-10-28 after grilling the same day ("grill Qn": the user's answer); goal 1a's transport reopened at plan review round 1 (2026-10-28); goal 3's test-run counting changed by the user on 2026-10-29 (final review).

- Written from the chat and the decisions in [flow.md](flow.md) (Brainstorm notes, Options).
- _(my call)_ marks a choice the user didn't make.
- The base is the [ado-mcp spec](../ado-mcp/spec.md); everything there still holds unless this spec changes it.

## Intent

ado-mcp works, and the user has had no problems with it, but hasn't used it much yet. They asked what the other
Azure DevOps MCP servers offer that ours lacks, "to make it truly awesome", and whether semantic search would help.

None of the other servers works with Azure DevOps Server the way ours does: Microsoft's two are Services-only, and
the on-prem community ones shape their output less (flow.md, Prior art). Where they are ahead is **reaching what the
local clone can't show**:

- finding work items, wiki pages and code in repos that aren't cloned
- reading the wiki
- test results of a pipeline run

That is the scope. It stays read-only and adds three tools, so the server stays curated: 26 tools, not 44.

**Semantic search: no embeddings.** The user's server has the Search extension with Code, Work items and Wiki
(asked 2026-10-28). Its Search REST API ranks by relevance and filters by project, repo, path and code element. An
index of our own would crawl the collection with one user's PAT, need keeping in sync, and store vectors; no other
Azure DevOps MCP does it, and web-mcp's H4 experiment found BM25 as good as embeddings.

## Goals

1. **`search`: one read tool over the server's Search.**
   - `text` and `kind` (`code`, `wi` or `wiki`), both required (grill Q1: the user made `kind` required).
   - Scope: the whole collection by default. `project` narrows to one project; `repo` (code only) to one repo,
     and needs `project` or a clone of it (grill Q2: inside a clone the default stays the whole collection, since
     the clone is what local `rg` already covers).
   - Code search passes `text` through, so the server's own syntax works (`def:`, `class:`, `ref:`, `path:`,
     `ext:`). `path` and `branch` filters are left to that syntax _(my call)_.
   - One line per hit, ranked as the server returns them:
     - code: `<project>/<repo>:<path>  (N matches)`. The Server 7.1 code search answer holds only character offsets,
       no lines or snippets ([docs](https://learn.microsoft.com/en-us/rest/api/azure/devops/search/code-search-results/fetch-code-search-results?view=azure-devops-server-rest-7.1),
       fetched 2026-10-28); Claude reads a hit with `repo_file` (goal 1a). Picked by the user, 2026-10-28.
     - wi: `#id [type] state  title`, then one line of the best matching snippet
     - wiki: `<project>/<wiki>:<page path>`, then one line of snippet
   - The server's highlight markers (`<highlighthit>`) are stripped; nothing else of its markup reaches Claude.
   - `limit`, default 20, with the usual `… N more: <call> limit=40` line. The server's total count is shown.
   - The search is sent once (no `retry_stale`): a POST, though it changes nothing.
   - When Search can't answer, one line says why, from the reply's `infoCode` or the HTTP status:
     - not installed or turned off for the collection (a 404 on the search route)
     - the index is still building (indexing hasn't started, or is in progress: results may be partial)
     - code search over a repo the server hasn't indexed

1a. **`repo_file`: read one file in any repo on the server** (the user's pick, 2026-10-28, from the builder check:
    search finds files in repos Claude hasn't cloned and otherwise can't read).
    - `project`, `repo` and `path`; inside a clone, project and repo default to it like the other tools. `branch`
      optional, default the repo's default branch.
    - Returns numbered lines, `start` (default 1) and at most 200 lines or the reply cap per call, ending with the
      call that shows the next lines (grill Q7).
    - A binary file, a folder or a missing path is one line saying so; a folder lists nothing (the agent has
      `repo_list`; browsing trees is out of scope) (grill Q7).
    - Sent by hand (`api.get`, `GET …/_apis/git/repositories/{repo}/items?path=…&includeContent=true&$format=json`)
      into a small struct of ours, not through the crate (plan review round 1, the user's pick, 2026-10-28): the
      crate's items call puts `path` into the URL unescaped and then again escaped (`git/mod.rs:2912`, `:2835`), so
      `#`, `+`, `&` and `%` in a path read the wrong file, and it asks for no JSON, so the server answers with the
      raw file. Same pattern as `pipeline_cancel`.

2. **`wiki`: one read tool for wiki pages.**
   - Scope: the project from the clone, or `project`. `wiki` names the wiki; without it, a project with one wiki
     uses that one, and a project with several lists them and asks for `wiki=` (grill Q3).
   - With `path`: the page's content as the server stores it (markdown, which is already text). Long pages are cut
     with the call that shows the rest (`full=true`), like a work item description.
   - Without `path`: the wiki's page tree, one page path per line, indented by depth, cut at `limit` (default 100,
     grill Q3).
   - Read only. No page writes (the user agreed, 2026-10-28).

3. **`pipeline_view` shows the run's test results.**
   - When the run published test results: one line `tests: 412 passed, 3 failed, 2 skipped`, summed over the run's
     test runs. A retried job publishes a test run per attempt: test runs from the same stage and job count only at
     that job's latest attempt (the run's pipeline reference), so a rerun that passed doesn't report the first
     attempt's failures; a test run without a pipeline reference always counts. Same-named runs from several result
     files or jobs all count _(the user, 2026-10-29, final review; it replaced "newest per name", which dropped them)_. Then each failed test, `<test name>: <error message, first line>`, with the first 5 lines of its
     stack trace indented under it, at most 20 failed tests and the usual more line (grill Q4).
   - When it published none, or the server has no test area (a 404): nothing is added (plan review round 1). Any
     other test-results failure (a 403, a 500) adds one line saying so and never hides the stages, jobs and issues.
   - The test runs are found by `buildUri` (`vstfs:///Build/Build/<run>`), through the crate's `test` area.

4. **`pr_files since=<iteration>`.**
   - Lists only what changed between iteration `since` and the latest (the server's `$compareTo`), for "what
     changed since I last looked".
   - `pr_view` shows the PR's latest iteration number, so Claude knows what to pass later (grill Q5).
   - `since` equal to the latest iteration lists nothing and says so; a `since` beyond it is an error naming the
     latest.

5. **`wi_view` shows every link.**
   - Today it shows parent, children and PRs and drops the rest. It also shows the other work item links, grouped
     by the link's name as the server words it (related, duplicate, duplicate of, predecessor, successor, tested
     by, …) (grill Q6: the server's own name, not a list of ours), and linked commits and branches by name.
   - Hyperlinks and attachments are counted, not listed (`attachments: 2`): their URLs are what goal 4 of the base
     spec keeps out.

6. **Plugin, docs and permissions.**
   - The PAT scopes grow by **Wiki (Read)** and **Test Management (Read)**; search needs the scopes of what it
     searches (Code, Work Items, Wiki). README, `plugin.json`'s PAT description and the 403 wording say so.
   - Server instructions mention `search`, `repo_file` and `wiki` in one line each, still under 4096 characters.
   - The README lists the new tools; `smoke.md` gets a section for each.
   - The base spec's non-goal "wikis" becomes "wiki writes".

7. **Tests**, as the base spec's goal 10: unit tests for the pure parts (highlight stripping, hit lines, numbered file lines, the test
   summary, link grouping, the page tree), and stdio tests against the fake server with fixtures shaped from the
   Server 7.1 docs and mapped to the crate's models in `tests/fixtures.rs`.

## Non-goals

- Embeddings, a local index, or any search of our own.
- Wiki writes, attachments (download or upload), work item history, saved queries by path, build artifacts, retrying
  one stage, sprints and capacity, test-plan management, Advanced Security.
- Toolset filtering or a read-only mode: at 26 tools nothing needs hiding.
- Code search inside the checked-out repo as a replacement for `rg`; the tool says nothing against it, but the
  instructions point Claude at it for other repos.
- Azure DevOps Services, as in the base spec.

## Anti-goals

- Search hits padded with URLs, GUIDs, highlight markup or the server's facet counts.
- A tool that a missing Search extension or test area turns into a bare HTTP error.
- `pipeline_view` failing as a whole because its test results couldn't be read.

## Constraints

- Everything in the base spec's Constraints.
- The crate (Options, A): enable the `search`, `wiki` and `test` features of `azure_devops_rust_api =0.39.1`, not
  `test_results` (its default host is the Services-only `vstmr`). Every new client gets `.endpoint()`, our
  transport, no retries and the `Guard`, like the seven existing ones. A crate model the server's answer doesn't
  satisfy gets the D1 fallback: the raw body and a small struct of ours, named in a comment, its fixture in
  `HAND_WRITTEN`.
- Search, wiki and test calls use the crate's `7.1-preview` versions; the Search area must accept them on Server
  2022.2 (a smoke step). If the server refuses them, that area moves to hand-sent requests in a fix-flow then, as
  the base spec's goal 8 brings the version option back; the plan carries no contingency for it _(my call, from the
  builder check: Server 2022.2 is a 7.1 server)_.

## Seams

- Search scope (collection, project or repo): resolved in the `search` module; never seen by `ctx`, `api` or `out`.
- Search unavailable or indexing: resolved in the `search` module (its `infoCode` and status mapping); never seen by
  `api` beyond the generic status line.
- New PAT scopes: resolved in `api.rs`'s 403 wording (the area → scope map) and the README; never seen by the tool
  modules.
- Highlight markup: resolved in the `search` module's pure hit formatting; never seen by `out`.
- Test results: resolved in `pipeline.rs` (`pipeline_view`); never seen by other tools.
- Which repo and branch a file is read from: resolved by `ctx.scope` as for every tool, plus `repo_file`'s own
  default-branch lookup; never seen by `search` (its hits print project, repo and path; Claude passes them).

## Glossary

New terms in [GLOSSARY.md](../../../GLOSSARY.md) (grill Q8): **Test run** (one set of test results a pipeline run
published) and **Hit** (one search result; a match is a place inside a file).

## Left to the builder

- Module layout (a `search.rs` and a `wiki.rs`, or within existing files).
- Exact argument names beyond those above, descriptions and output wording within the base spec's goal 4.
- How many requests `pipeline_view` sends for test results (runs, then failed results per run), sent concurrently
  with its timeline where possible.
