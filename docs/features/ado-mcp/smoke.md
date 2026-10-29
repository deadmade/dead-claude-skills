# ado MCP server: smoke checklist

Run this at work, against the real Azure DevOps Server 2022.2, once a release with `ado-mcp` exists. Ask Claude to
make each call; the calls are written the way the tools print them (`pipeline_log run=7 full=true`).

Paste back only the tool's output lines and error lines. Never paste raw JSON, and never work data: replace names,
titles and log text with `…`, or describe the problem in your own words. Each step ends with what to paste back.

Writes run on scratch items only, and each says how to clean it up.

## 1. Install

1. Run `npx --allow-git=root github:deadmade/dead-claude-skills#semver:*`.
2. Tick mcp-azure, then enter the collection URL (`https://…/tfs/<Collection>`) and the PAT.
   The PAT prompt must not echo what you type.
3. Start Claude Code and check that `/mcp` shows the `ado` server as connected.

If the old npm version of mcp-azure was installed before, also note whether Claude Code warned about the removed
`ado_api_version` setting.

Paste back: the installer's lines that name mcp-azure or ado-mcp, the `/mcp` line for `ado`, and whether the
`ado_api_version` warning appeared.

## 2. Connection

In a clone of a repo on the server, call `repo_list`. This covers TLS through ESET, the PAT and API version
`7.1-preview` at once.

- A certificate error means the TLS check through ESET failed.
- A version error means the server needs 7.0, and the `ado_api_version` option comes back.

Paste back: the number of lines `repo_list` printed, or its error line.

### Optional: the versions the server offers

To see which resource versions the server offers, run this in PowerShell. It reads the PAT without echoing it and
never puts it on the command line:

```powershell
$collection = "https://tfs.company/tfs/DefaultCollection"  # yours
$pat = Read-Host "PAT" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $pat).Password
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$plain"))
$plain = $null
$r = Invoke-RestMethod -Method Options "$collection/_apis/git" -Headers @{ Authorization = "Basic $auth" }
$r.value | Sort-Object resourceName | Select-Object resourceName, releasedVersion, maxVersion -Unique | Format-Table
```

Paste back: the table (resource names and versions only).

## 3. Remote resolution

1. In the clone, call `pr_list` with no arguments.
2. In a git worktree of the same repo, call `pr_list` again, then `pr_view branch=<the worktree's branch>` (that
   branch needs an active PR).

Paste back: whether each call found the right repo (yes or no), and any error line.

## 4. Reads

Pick a real PR, a real work item and a real failed run. Call `pr_view id=<pr>`, `pr_threads id=<pr>`,
`pr_files id=<pr>`, `wi_view id=<wi>`, `wi_query assigned=me`, `pipeline_runs`, `pipeline_view run=<run>` and
`pipeline_log run=<run>`.

Paste back: for each tool, "ok" or what is noisy or wrong, in your own words, and every error line.

Then check these in particular:

- **Crate models (D1).** A line `unexpected answer from the server: missing field …` means the server leaves out a
  field the crate's model requires. Paste back: the line and the tool. The fix is a small struct of ours for that
  call.
- **pipeline_view.** The crate asks for the run's timeline at `…/timeline/` (an empty timeline id and a trailing
  slash), which only a real server can confirm. Paste back: whether stages and jobs show, or the error line.
- **pipeline_log on the failed run.** The crate sends no `Accept: text/plain`. Check that the log reads as text and
  not as lines of JSON. On a YAML run without stages, check whether a `__default` stage line shows. Paste back: text
  or JSON, and whether `__default` showed.
- **pipeline_log paging.** Pick a run with a step log over 2000 lines. Call
  `pipeline_log run=<run> step="<step>" full=true`, then the `start=` call its last line offers. The second page must
  start right after where the first stopped; a server that ignores `startLine` repeats the opening lines. Paste back:
  the line numbers where page one ended and page two began.
- **pr_files.** Run it on a PR with a renamed file and, if you find one, a file whose encoding changed. The crate's
  change-type enum knows only some flag combinations. Paste back: the line for each such file, with the path replaced
  by `…`, or the error line.

## 5. Search, files, wikis and test results

`search`, `wiki` and `pipeline_view`'s test results go through the crate's search, wiki and test areas, which send
`7.1-preview` like the rest; this section checks that the server accepts it for each. A line naming the API version
means the server refuses it for that area, which then moves to hand-sent requests in a fix flow. A line
`unexpected answer from the server: …` means the answer lacks a field the crate's model requires (D1) or holds an
enum value it doesn't know (D8). Paste back every such line, with the tool it came from.

### search

1. `search kind=wi text=<a word from a work item title>`.
2. `search kind=code text=<a function or class name> project=<project>`, then the same with `repo=<repo>`. Code hits
   carry the repo's type in a closed enum (git, tfvc or custom), so this checks it on a live answer.
3. `search kind=wiki text=<a word from a wiki page>`.

Each answer starts with `1 hit` or `N hits`, after a line when the server reports something about the index or the
query. Paste back: for each call those first lines, how many hit lines followed, one hit line with names and paths
replaced by `…`, and any error line. If Search isn't installed, paste back that line, take the `repo_file` path from
`repo_list` and the repo's web UI, and skip step 3 of the wiki section.

### repo_file

Take a code hit from a repo you haven't cloned. Call `repo_file project=<project> repo=<repo> path=<path>` with the
path as the hit printed it, then the `start=` call its last line offers (on a file over 200 lines), then the same file
with `branch=<another branch>`.

Paste back: the line numbers of the first and last line of each page, and any error line.

### wiki

1. `wiki` in a clone, with no arguments: the page tree. If the project has several wikis, the error names them; pass
   `wiki=<name>`.
2. `wiki path=<a page path from the tree>`, then the `full=true` call on a page over 4000 characters.
3. If a project has a code wiki published from a subfolder of its repo (not the repo root), run
   `search kind=wiki text=<a word from one of its pages>`. The hit's path must start at the wiki's root, not with the
   folder. Open that hit with `wiki project=<project> wiki=<name> path=<the hit's path>`.

Paste back: the number of tree lines, whether the page and its `full=true` call read as markdown, and for step 3
whether the hit's path started with the folder (yes or no) and whether `wiki` opened it, or the error lines.

### pipeline_view test results

Pick a run whose tests failed. Call `pipeline_view run=<run>`. After the stages, jobs and issues it prints
`tests: <n> passed, <n> failed, <n> skipped`, then up to 20 failed tests, each with its error's first line and up to 5
stack trace lines. Compare the counts with the run's Tests tab in the web UI.

Then pick a run of a pipeline that publishes several result files, or has several test jobs, with failures in more
than one of them, and call `pipeline_view run=<run>` again. Every test run's failures must show, and the counts must
match the Tests tab. If you find a run where a test job was rerun (Rerun failed jobs), check that only the rerun's
results count.

Paste back: the `tests:` line, whether the counts match the web UI (and, if not, the web UI's), how many failed tests
were listed, and any `couldn't be read` line; for the second run, its `tests:` line, whether failures from each result
file or job showed, and whether the counts match the web UI; for a rerun job, whether the first attempt's failures
were left out.

### pr_files since

Pick a PR with 2 or more iterations (pushed to after it was opened). Call `pr_view id=<pr>` and note its
`iteration: <n>`, then `pr_files id=<pr> since=<n - 1>` and `pr_files id=<pr> since=<n>`.

Paste back: the `iteration:` value, the first line of the `since=<n - 1>` answer (`changes since iteration …`) and
its `diff:` line if it has one (commit ids replaced by `…`), whether its files are those pushed in the last iteration,
and the `since=<n>` answer.

### wi_view links

Pick a work item linked to a commit and a branch (from the work item's Development section) and, if you find one,
to a work item by a link other than parent or child (Related, Duplicate, …). Call `wi_view id=<wi>`.

Paste back: the `commits:` and `branches:` lines with values replaced by `…`, the other link lines' names
(`Related: …`), whether the counts on the `links:`/`attachments:` line match the web UI, and any link the web UI
shows that `wi_view` left out.

## 6. Writes

On scratch items only. Make two scratch branches from the default branch and push them:

```sh
git switch -c smoke/base origin/<default branch> && git push -u origin smoke/base
git switch -c smoke/a && git commit --allow-empty -m "smoke a" && git push -u origin smoke/a
git switch smoke/base && git switch -c smoke/b && git commit --allow-empty -m "smoke b" && git push -u origin smoke/b
```

Then, in order (each write tool once):

1. `wi_create type=Task title="ado-mcp smoke test"`
2. `wi_comment id=<wi> text="smoke"`
3. `wi_update id=<wi> assigned="<a colleague's display name>"`, then `wi_update id=<wi> assigned=me`. The assignee
   is sent as a display name, so watch for an "ambiguous" or "unknown identity" error.
4. `pr_create branch=smoke/a target=smoke/base title="ado-mcp smoke a" draft=true work_items=[<wi>]`
5. `pr_update id=<pr a> title="ado-mcp smoke a, renamed"`
6. `pr_comment id=<pr a> text="smoke"`, then `pr_reply id=<pr a> thread=<its thread id> text="smoke reply"`
7. `pr_thread_status id=<pr a> thread=<its thread id> status=fixed`
8. `pr_vote id=<pr a> vote=approve`
9. `pr_create branch=smoke/b target=smoke/base title="ado-mcp smoke b"`, then `pr_complete id=<pr b>` without `auto`
   (D4). It sends no `lastMergeSourceCommit`; if the server insists on that field, D4 goes back to the user.
10. Pick a short pipeline: `pipeline_run pipeline=<name> branch=smoke/a`, then `pipeline_cancel run=<its run id>`.

Every one of these must show Claude Code's approval prompt, also in auto mode. Switch to auto mode (Shift+Tab) for at
least one of them.

Clean up:

- PR a: `pr_update id=<pr a> status=abandoned`.
- PR b is merged into `smoke/base` only, and its source branch is deleted.
- The work item: `wi_update id=<wi> state=<your process's closed state, e.g. Closed or Done>`.
- The run: cancelled in step 10. If it already finished, there is nothing to undo.
- The branches: `git push origin --delete smoke/base smoke/a` (and `smoke/b` if it is still there).

Paste back: for each call its output or error line (they hold only the scratch titles), whether the prompt appeared
every time, and especially any error line from step 3 or naming `lastMergeSourceCommit` from step 9.

## 7. Minimal PAT

Make a second PAT with only the scopes the plugin's README lists, and set it with `/plugin configure mcp-azure`.
Repeat steps 2, 5 and 6 with new scratch items. Afterwards, set your usual PAT again and revoke the minimal one.

Paste back: every 403 line, with the tool it came from.
