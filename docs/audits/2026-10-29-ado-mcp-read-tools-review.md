# ado-mcp read tools review: 2026-10-29

Scope: the 14 read tools of `crates/ado-mcp` at `7e86fc7`: `pr_list`, `pr_view`, `pr_threads`, `pr_files`,
`wi_view`, `wi_query`, `pipeline_runs`, `pipeline_view`, `pipeline_log`, `repo_list`, `project_list`, `search`,
`repo_file`, `wiki`, and the shared layers they run on (`api.rs`, `out.rs`, `ctx.rs`, `remote.rs`).

Method: four code reviews in parallel (pr.rs; wi.rs; pipeline.rs; search, wiki, file, ctx and remote), each finding
then checked against the code, plus a live pass calling every read tool against the work Azure DevOps Server 2022.
Work data (names, titles, step names, ids) is left out below.

Tags: **live** reproduced on the server, **code** confirmed in the code, **plausible** the code reads that way but the
server's side is unverified.

No crash, no crate deserialization error on the live answers, no way found to steer the PAT elsewhere. The findings are
wrong or missing information, and follow-up calls that don't lead where they claim.

## High

1. **`pipeline_log` can't tell apart same-named steps in different jobs** (`src/pipeline.rs:888`, `:940`). Live + code.
   A run with two jobs printed two steps of the same name with no job name. Every follow-up call names a step by name
   only and resolves to the first one, while its `start=` was computed from the second log's window, so the model pages
   the wrong log at the wrong line. The "not shown" call repeats the first log, so the model can loop. There is no job
   argument, and a job name passed as `step` is refused. Default step names (Bash, CmdLine) make this common.
2. **`pr_files` can fail on renames or force-pushed iterations** (`src/pr.rs:662`, `:711`). Code + plausible. The
   crate's `ChangeType` knows only two flag combinations (`"edit, rename"`, `"delete, sourceRename"`), so e.g.
   `"edit, sourceRename"` fails the whole answer. The iteration `Reason` knows none (`"forcePush, rebase"`). Same trap
   as D8; untested. Fix: our own struct, as with D1.
3. **`wi_view` never shows a Bug's Repro Steps** (`src/wi.rs:309`). Code. Only `System.Description` and
   `Microsoft.VSTS.Common.AcceptanceCriteria` are rendered; on the stock Agile, Scrum and CMMI processes a Bug's body is
   `Microsoft.VSTS.TCM.ReproSteps` (and `SystemInfo`). The work process keeps it in Description, so it doesn't show
   there yet. The `wi.json` Bug fixture carries a Description, which hides it.

## Medium

4. **One missing linked work item hides all of them in `pr_view`** (`src/pr.rs:344`). Code. The batch keeps the
   default error policy (fail) and isn't chunked by 200; `wi_query` uses `ErrorPolicy::Omit`. A deleted or unreadable
   item turns the section into "work items: unavailable (not found: …)".
5. **`pr_threads` line numbers can be stale** (`src/pr.rs:585`). Code. The thread list is fetched without
   `$iteration`, so positions are where the comment was made, not tracked to the latest iteration.
6. **Without `id`, the branch's PR is picked arbitrarily** (`src/pr.rs:279`). Code. `top(1)` with no note that more
   exist; one branch can have active PRs into two targets. Shared by `pr_view`, `pr_threads`, `pr_files`, and also
   `pr_vote` and `pr_complete`.
7. **`pr_files`' diff command uses local branch names** (`src/pr.rs:749`). Live + code. `git diff target...source` is
   wrong when the local target is behind, the source branch was pushed by someone else, the PR is completed (source
   deleted, target already merged), or `repo=` names another repo than the clone. `origin/…` refs or the PR's last
   merge commits would hold.
8. **`repo_file branch=refs/heads/x` answers "not found"** (`src/file.rs:289`). Live. The branch goes through as given;
   every other tool takes both forms (`full_ref`/`ref_name`). The model concludes the file doesn't exist. Tags and
   commit ids can't be read either.
9. **Text past the 40,000-character reply cap can't be reached.** Code. `finish()` cuts, and its hint ("limit, id,
   step") names arguments these tools lack:
   - `wiki full=true` (`src/wiki.rs:139`);
   - `wi_view full=true` (the non-full clip line promises text the full call can't deliver);
   - one line longer than the budget in `repo_file` (`src/file.rs:254`, e.g. minified JS);
   - threads past the cut in `pr_threads` (no skip, `limit` and `full` only make it longer).
     Fix: a `start` like `pipeline_log`'s.
10. **`html_to_text` loses structure** (`src/out.rs:97`). Code. Closing `h1`–`h6`, `tr`, `td`, `th`, `pre` and
    `blockquote` add no break, so tables and headings run together on one line. Only five named entities decode;
    `&auml;`, `&rsquo;`, `&ndash;`, `&apos;` stay raw.
11. **`wi_query assigned=<name>` is an exact WIQL match** (`src/wi.rs:411`). Code. `wi_create`/`wi_update` resolve
    names via `ctx.user`; here a partial name answers "no work items", which reads as nothing assigned.
12. **`wi_view`'s "PRs: !N" line drops the repo** (`src/wi.rs:299`). Code. The repo id is in the artifact URL but is
    discarded; `pr_view id=N` then looks in the clone's repo and says "not found" for a PR elsewhere.
13. **`pr_list` with only `project` fails** with "no repo". Live. The server can list a project's PRs across repos.

## Low

- Approval counts include group reviewers (`src/pr.rs:136`): one approval can read as two. Code.
- Policy check lines drop `isBlocking` and the build policy's display name (`src/pr.rs:306`): two build policies read
  as two identical lines; an optional failure looks blocking. Code.
- A run that failed YAML validation shows no reason (`src/pipeline.rs:545`, `:861`): `pipeline_view` says "no stages or
  jobs yet", `pipeline_log` "no failed step"; the build's `validationResults` are never read. Code + plausible.
- `pipeline_view`'s "N more issues: pipeline_log" (`src/pipeline.rs:527`) points at a tool that shows only failed
  steps; extra warnings are unreachable. Code.
- `pipeline_log`'s cut line points at `start=1` instead of the cut (`src/pipeline.rs:807`). Code.
- A `full` page with an unknown line count can end with no more line (`src/pipeline.rs:750`). Code.
- Test counts treat analyzed failures as skipped (`unanalyzedTests`, `src/pipeline.rs:428`). Plausible.
- Work item lines are ambiguous: a custom state with a space runs into the type, the title's quotes aren't escaped,
  and `search` prints the type as `[Type]` while `wi_query`/`wi_view` don't. Live.
- Images in descriptions vanish without a marker. Live.
- A wiki parent page with no content prints "(empty page)" and hides its subpages (`src/wiki.rs:135`). Code.
- An item without `content` (a submodule) reads as an empty file (`src/file.rs:320`). Code.
- A comments 404 in `wi_view` prints the project GUID and API path (no `with_what`); so do `wi_query`'s WIQL and batch
  404s. Code.
- `wi_query`'s batch is project-scoped (`src/wi.rs:514`), unlike D2's reasoning: raw WIQL spanning projects might lose
  items silently. Plausible.
- `search` never evicts a stale cached scope (no `retry_stale`). Code, rare.
- Remote errors: `http://` remotes and a trailing `/` after the repo say "open Claude Code in a clone" inside one; the
  other-host and other-collection errors don't say "pass project" (`src/remote.rs:428`, `:463`, `:514`). Code.
- `pr.rs:266`'s comment says an id 404 gets no `retry_stale`, but `find_pr` wraps it in one, so an unknown id refetches
  the scope and sends the GET twice. Code.
- `pr_files` shows only a rename's new path, and an empty PR prints only the `diff:` line. Code.

## Refuted or sound

- Code search's `repo` filter is not case-sensitive: an upper-cased repo name found the hit live.
- Sound: the PAT guard and URL building, WIQL escaping and 200-id chunking, log line arithmetic and 1-based paging,
  remote parsing, the limit and more lines of the list tools, char-safe cutting.
- Worth a smoke check: `Build.triggeredByBuild` is a boxed crate `Build` with required fields; a sparse shape would
  fail every `pipeline_runs` that lists a build-completion-triggered run.

## Test gaps, first

- `pr_files` fixtures with combined change types and a rebase/force-push iteration (`iterations.json` has the same
  commit for both iterations, so a from/to mix-up passes).
- Two failed steps of the same name in different jobs, in default `pipeline_log` mode.
- A Bug fixture with `ReproSteps`.
- `pr_view` with a deleted linked work item, and with over 200 links.
- `wiki` and `wi_view` text over 40,000 characters.
- `repo_file` with `branch=refs/heads/…`, a submodule, a BOM.
- `html_to_text` with headings, tables, `<pre>` and named entities.
- Two active PRs from one branch; group reviewers in the approval count.
- `pipeline_view` with an empty timeline or a run that failed validation.
