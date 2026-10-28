# mcp-azure

Azure DevOps Server tools for Claude: pull requests, work items and YAML pipeline runs. The server is `ado-mcp`, a
stdio MCP server (Rust, `crates/ado-mcp/`) that talks to one self-hosted collection with a personal access token. It
calls the REST API through Microsoft's `azure_devops_rust_api` crate, with a few calls sent by hand where the crate
falls short.

Inside a clone, the tools read the git remote (`origin`), so they need no project or repo; pass `project` (and
`repo` for the `pr_*` tools) to override it. When the clone names no project of this collection, pass `project`
(`project_list` names them); `wi_view` takes the work item's own and `wi_update` needs none. Output is plain text,
one line per item, id first; lists show 20 and say how to get more, except `repo_list` and `project_list`, which show
all, `pr_files` (up to 2000 files) and `pipeline_view`'s issues (20; `pipeline_log` shows the rest).

## Tools

Reads, each named `mcp__plugin_mcp-azure_ado__<tool>`:

- `pr_list`: pull requests in the repo, by status (default active), creator, reviewer, source or target branch.
- `pr_view`: reviewers and votes, policy checks, linked work items, the latest run and the description.
- `pr_threads`: review threads with file and line; system threads, and unless `all` resolved ones, are left out.
  Comments are cut at 2000 characters unless `full`.
- `pr_files`: the files the latest iteration changes and, for plain branch names, the `git diff` command for the
  patch.
- `wi_view`: a work item with its parent, children, linked PRs, description, acceptance criteria and last 5 comments
  (`full`: the whole texts and up to 200 comments).
- `wi_query`: work items by assignee (`me` or a name), state, type or title text, or a raw WIQL query.
- `pipeline_runs`: recent runs, newest first, by pipeline, branch, PR or result.
- `pipeline_view`: a run's stages and jobs with result and duration, and its errors and warnings.
- `pipeline_log`: a run's cleaned logs: each failed step's error lines with context and its last 50 lines, read from
  at most its last 20,000 lines when the server reports the log's length (else the whole log); `step` picks one,
  `full` pages through a whole log (at most 2000 lines or 40,000 characters per call).
- `repo_list`: the project's repos with their default branch.
- `project_list`: every project the PAT can see, by name.

Without `id`, the `pr_*` tools use the active PR of the current branch. In a git worktree, pass `branch`. There is no
diff tool: local `git diff` does it.

Writes:

- `pr_create`: from a branch (default: the current one) into a target (default: the repo's default branch),
  optionally as a draft, with reviewers and linked work items.
- `pr_update`: title, description, or abandon and reactivate. It can't switch between draft and published.
- `pr_comment`: a new thread, optionally on a file and line.
- `pr_reply`: a reply on a thread.
- `pr_thread_status`: active, fixed, wontFix, closed, byDesign or pending.
- `pr_vote`: approve, approve-with-suggestions, wait, reject or reset, as the PAT's user.
- `pr_complete`: merge (default squash), deleting the source branch and transitioning work items unless told not
  to; with `auto`, set auto-complete instead. Branch policies always apply.
- `wi_create`: a work item of a type, with a title, and optionally a description, assignee and parent.
- `wi_update`: state, assignee, title, or any field by reference name.
- `wi_comment`: a comment on a work item.
- `pipeline_run`: queue a pipeline on a branch (default: the current one), with template parameters.
- `pipeline_cancel`: cancel a run.

## Permissions

The reads change nothing on the server. Allow each once with "don't ask again"; the installer writes no rules.

Every write carries `anthropic/requiresUserInteraction`, so Claude Code (2.1.214 or later) asks on every call, even in
auto and bypass modes, and allow rules don't skip it. In `dontAsk` mode writes are denied.

## Install

The installer, with mcp-azure ticked, asks for the collection URL (e.g. `https://tfs.company/tfs/DefaultCollection`)
and the PAT (hidden) unless both are saved already, installs the plugin, downloads `ado-mcp` to `~/.claude/bin` and saves it all, `binPath`
included. Enter keeps a value already saved. On a Claude Code older than 2.1.285, or without a PAT, it prints what to
set instead: configure the plugin in Claude Code, then run the installer again.

By hand:

    /plugin install mcp-azure@dead-claude-skills
    /plugin configure mcp-azure

Build the binary with `cargo build --release` in `crates/ado-mcp` (or `nix build .#ado-mcp`), then put it on PATH or
set `binPath` to it.

The PAT needs Code (Read & Write), Work Items (Read & Write), Build (Read & Execute) and Project and Team (Read). It is
stored as a sensitive setting and is only ever sent to the collection URL.

## Limits

- One server, one collection, one PAT.
- API version 7.1 (Azure DevOps Server 2022.1 and later). An older server gets an error.
- YAML pipelines only: no classic release pipelines, wikis, feeds, test plans or TFVC.
- Builds for Windows and Linux x64 only.
- TLS trusts the operating system's certificate store (on Windows, the Windows store).

## Upgrading from the npm server

Before `ado-mcp`, mcp-azure ran `@tiberriver256/mcp-server-azure-devops` through `npx`. Now:

- Re-run the installer, which downloads `ado-mcp` and sets `binPath`, or set `binPath` yourself. Without it, the
  server doesn't start unless `ado-mcp` is on PATH.
- The server is now called `ado`, so old `mcp__plugin_mcp-azure_azure-devops-server__*` allow rules no longer match.
  Remove them and allow the new reads.
- The `ado_api_version` and `ado_default_project` settings are gone; saved values are ignored. The collection URL
  and PAT carry over. Outside an Azure DevOps clone, Claude passes `project`.
