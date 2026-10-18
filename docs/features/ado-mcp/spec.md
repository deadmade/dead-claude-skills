# ado-mcp: spec

Status: approved at Gate 1 on 2026-10-18; revised for D1 (flow.md) and approved again on 2026-10-18.

- Written from the chat and the decisions in [flow.md](flow.md) (Options).
- The builder check is done and its two questions were answered on 2026-10-18.
- "(grill Qn)" marks a decision the user made in the grill.
- _(my call)_ marks a choice the user didn't make.

## Intent

The user works against a self-hosted **Azure DevOps Server 2022.2** (`AzureDevopsServer_20240806.7`), mostly on
Windows. They want Claude Code to do everyday developer work there, roughly what `gh` covers for GitHub:

- pull requests and their comment threads
- work items
- YAML pipeline runs and their logs

The tools that exist don't serve that well:

- `az devops` refuses Azure DevOps Server.
- Raw curl is noisy and needs a permission prompt for every call.
- The npm MCP server in `mcp-azure` is third-party code that holds the user's PAT, which they're uneasy about at work.

So this repo ships its own small Rust MCP server. It is fast, its output is tuned for an agent, and nothing is
downloaded when it runs. The user doesn't need a terminal tool: "goal is for claude I can use the ui".

## Goals

1. **One stdio MCP server in Rust, `ado-mcp`** (`crates/ado-mcp/`), replacing the npm server inside the existing
   `mcp-azure` plugin.
   - The plugin keeps its name and its userConfig keys, so existing configuration carries over.
   - It is built, released, downloaded and version-synced like web-mcp: Windows x64 and Linux x64 (musl) only. The
     touch points are listed in flow.md, Grounding.
   - It calls the REST API through Microsoft's `azure_devops_rust_api` crate (pinned `=0.39.1`, only the `git`,
     `build`, `pipelines`, `policy`, `wit`, `core` and `ims` features), so the request shapes and models are
     Microsoft's, not ours (flow.md, D1). The crate's clients point at the collection with `.endpoint()` and send
     through our own `reqwest` client (`.transport()`).
   - Hand-written requests remain only where the crate has no call: `/vsts/info`, `_apis/connectionData`, and
     `pr_list status=all` (the crate's status enum has no `all`; flow.md, D2). A
     crate model that the user's server doesn't satisfy (a required field it leaves out) gets the same: the raw
     response through the crate's `.send()` and a small serde struct of ours, named in a comment.

2. **The tools.** The names are the MCP tool names, seen by Claude as `mcp__plugin_mcp-azure_ado__<tool>`.

   **Reads.** None of them changes anything on the server. They carry no permission mark: the user allows each once
   with "don't ask again", and no installer rules are written. The README lists them.
   - `pr_list`: filter by status (default active), creator, reviewer (`me` allowed), source/target branch; `limit`.
   - `pr_view`:
     - with no id, the PR for the current branch
     - title, status, draft, source → target, author, description
     - reviewers with their votes, policy evaluations (what blocks completion), linked work items, and the latest
       pipeline run of the PR (its merge ref `refs/pull/{id}/merge`, else the source branch; amended at plan review
       round 1, 2026-10-18)
   - `pr_threads`:
     - the PR's comment threads, without system threads (`commentType: system`, or a `CodeReviewThreadType`
       property) or deleted comments
     - by default only active and pending threads; `all: true` shows resolved ones too
     - each thread shows its id, status, `file:line` (from `threadContext`), author and text
   - `pr_files`: the files changed in the latest iteration, with their change type. There is no diff tool: Claude
     reads the patch with local `git diff`.
   - `wi_view`:
     - type, title, state, assignee, area/iteration and description as plain text (HTML stripped)
     - acceptance criteria, parent and children, linked PRs, and the last few comments
   - `wi_query`: either simple filters (assigned to `me`, state, type, text in the title) or a raw WIQL string;
     returns one line per item.
   - `pipeline_runs`: recent runs, filterable by pipeline, branch, PR and result.
   - `pipeline_view`: a run's stages and jobs with result and duration, and its issues (errors and warnings).
   - `pipeline_log`:
     - by default, each failed step's log, cleaned: timestamps, ANSI codes and `##[group]`/`##[section]` noise
       removed; `##[error]` lines kept and marked
     - shows the error lines with ±5 lines of context, plus the step's last 50 lines
     - `step` picks another step
     - `full: true` with `start`/`end` returns the raw lines, at most 2000 per call (grill Q8)
   - `repo_list`: repos in the project.

   **Writes.** Each one carries `_meta["anthropic/requiresUserInteraction"]: true` in `tools/list` (the user's
   choice, 2026-10-18).
   - Claude Code then prompts on every call, even in auto and bypass modes, offers no "don't ask again", and ignores
     allow rules (code.claude.com/docs/en/mcp, "Require approval for a specific tool"; Claude Code ≥ 2.1.214). In
     `dontAsk` mode such calls are denied.
   - `pr_create`: title, description, source (default: current branch), target (default: the repo's default
     branch), draft, reviewers, linked work items.
   - `pr_update`: title, description, draft ↔ published, abandon or reactivate.
   - `pr_comment`: a new thread, optionally anchored to a `file:line`.
   - `pr_reply`: a reply on a thread.
   - `pr_thread_status`: set a thread's status, e.g. fixed, closed or won't fix.
   - `pr_vote`: approve, approve with suggestions, wait for author, reject, reset.
   - `pr_complete`: merge strategy, delete the source branch, transition work items; or set auto-complete. There is
     no bypass-policy option, so Claude can never merge past branch policies (grill Q4).
   - `wi_create`: type, title, description, assignee, parent.
   - `wi_update`: state, assignee, title, and `fields`, a map of field reference name → value (e.g.
     `Microsoft.VSTS.Common.Priority`), so custom process fields work (grill Q5).
   - `wi_comment`.
   - `pipeline_run`: by name or id, branch, parameters.
   - `pipeline_cancel`.
   - Every write answers with one line naming what changed and the item's id.

3. **Server instructions** (MCP `instructions`, under 4096 characters, grill Q6) tell Claude to:
   - use these tools for the Azure DevOps server instead of curl
   - read a PR's patch with local `git diff`
   - pass `branch` when working in a worktree
   - expect every write to prompt the user

   The instructions also help tool search find the deferred tools when the user mentions PRs, work items or
   pipelines.

4. **Output for an agent, not a person.**
   - Plain text: one line per item, id first. No URLs or `_links`, no GUIDs unless needed to act, no colours or emoji.
   - Dates as `2026-10-14`, people as display names.
   - Lists default to 20 items, and every cut says so and how to get more (`… 37 more: limit 100`).
   - Long text is cut, with the exact tool call that shows the rest.
   - Errors are one actionable line (goal 7).

5. **Context comes from the git remote.**
   - The server finds the project folder from `ADO_PROJECT_DIR=${CLAUDE_PROJECT_DIR}` in `.mcp.json`'s `env`.
     web-mcp's `.mcp.json` already does this.
   - It reads the remote and branch by running `git` (`remote get-url`, `rev-parse --abbrev-ref HEAD`) _(my call:
     shelling out handles worktrees and git config for free)_.
   - It resolves the remote once with `GET {remote}/vsts/info`, which returns the collection URL, project id and
     repo id, as `az` does.
   - Both HTTPS and SSH remotes work. An SSH remote (`ssh://host:22/[tfs/]Coll/Proj/_git/Repo`) is mapped to HTTPS
     at its collection segment: `ADO_ORG_URL` plus the rest of the path after the collection.
   - Before any request, the remote's host and collection must match `ADO_ORG_URL`'s, so the PAT only goes to the
     configured server (plan review round 1).
   - Every tool takes optional `project` and `repo` arguments that override the remote. Outside a clone,
     `ado_default_project` applies.
   - Every tool that infers the current branch also takes an optional `branch`. In a worktree the project folder's
     branch isn't Claude's (grill Q2).
   - One server and one PAT (grill Q9). A remote on a different server from `ado_org_url` is an error that names
     both servers.

6. **Fast, and fine when Claude calls several tools at once.**
   - One process holds one `reqwest` client, so connections and TLS sessions are reused.
   - A tool that needs several requests (`pr_view` needs about five) sends them concurrently.
   - Parallel tool calls from Claude run concurrently.
   - An in-memory cache holds what rarely changes: `/vsts/info` per remote, project and repo ids, the PAT's own
     identity (`me`), and pipeline name → id. It lasts for the life of the process, and an id that 404s is
     re-resolved once.
   - Live data (PR state, threads, runs, logs) is never cached.
   - No cache file and no daemon.

7. **Authentication and TLS.**
   - `Authorization: Basic base64(":" + PAT)`. The PAT comes from the existing `ado_pat` userConfig through `env` in
     `.mcp.json`. It is marked `sensitive`, so Claude Code keeps it in the platform's secure credential store.
   - The server never prints or logs the PAT.
   - TLS uses reqwest `=0.13.5` with rustls and `rustls-platform-verifier`, like web-mcp, but with aws-lc-rs as the
     crypto provider, since the crate compiles it in anyway (ring is dropped). That trusts the Windows certificate
     store, which matters because ESET's HTTPS scanning re-signs traffic on the user's work
     machine.
   - Errors map to one line each:
     - 401: the PAT was rejected (expired or wrong); fix it with `/plugin configure mcp-azure`
     - 403: names the PAT scope the area needs
     - 404: names what wasn't found
     - 409/412: a conflict; e.g. when a PR already exists for the branch, it names that PR
     - 429: honours `Retry-After` once, then reports. azure_core's own retry policy is off, so nothing else is
       resent (a resent write could post twice).
     - A response the crate's model can't read: `unexpected answer from the server: {serde error}`, which names the
       missing field, so the smoke test shows which model to replace
     - TLS failure: says the certificate isn't trusted and that the server uses the Windows store

8. **API version 7.1.** Azure DevOps Server 2022.1 and later accept it. Calls through the crate send its
   `7.1-preview` (the newest resource version up to 7.1). Of the hand-written calls, `connectionData` sends
   `7.1-preview.1`, `pr_list status=all` sends `7.1-preview`, and `/vsts/info` takes no version.
   - The `ado_api_version` option is removed (grill Q1). An older server gets a clear error instead of half-working
     calls, and a stale value in someone's settings is ignored.
   - If the smoke test shows the user's server accepts only 7.0, the option comes back.

9. **Plugin and installer.**
   - `plugins/opt-in/mcp/mcp-azure/` gets a `binPath` userConfig (default `ado-mcp`, on PATH) and a `.mcp.json` that
     runs `${user_config.binPath}`.
   - The server's key in `.mcp.json` becomes `ado` (was `azure-devops-server`) _(my call: it is part of every tool's
     permission name, so it is fixed now and never renamed)_.
   - The plugin gets a README listing the tools, the PAT scopes (Code Read & Write, Work Items Read & Write, Build
     Read & Execute) and how to set it up. The marketplace and plugin descriptions say what it is now.
   - Installer: `BIN_PLUGINS` maps `mcp-azure` → binary `ado-mcp`. The plugin and binary names now differ, so
     `install.mjs:370` uses the binary's crate folder.
   - **The installer installs and configures mcp-azure itself** (grill Q10). It no longer hands it off.
     - When mcp-azure is ticked, it asks for the collection URL, the PAT (hidden input) and an optional default
       project. Enter keeps a value that is already saved.
     - Then it installs the plugin, downloads `ado-mcp`, and saves everything, `binPath` included, in one
       `claude plugin configure mcp-azure@<marketplace> --values-stdin` call (Claude Code ≥ 2.1.285).
     - The PAT travels over stdin only, never as an argument (no `--config key=value`).
     - An empty PAT, or a Claude Code too old for `configure`, falls back to today's handoff note, minus its
       API-version line.
     - The decisions (which prompts, the values object, the fallback) live in `core.mjs` with tests; the prompting
       lives in `install.mjs`.
     - `mcp-github` keeps the handoff.
   - THIRD_PARTY.md drops `@tiberriver256/mcp-server-azure-devops`. CLAUDE.md and README.md say what mcp-azure is
     now (CLAUDE.md:22 "the two Rust crates" becomes three).

10. **Tests.**
    - Unit tests for the output shaping: system-thread filter, log cleaning, truncation lines, WI HTML to text.
    - Unit tests for remote parsing: HTTPS, SSH, `/tfs/` paths, and spaces in project names (decoded once, then
      replaced by ids from `/vsts/info`).
    - Unit tests for error mapping.
    - Request-level tests against a local fake server that replays JSON fixtures shaped from the 7.1 Server docs.
      The fixtures must satisfy the crate's models, which makes the crate the contract check for them.
    - `cargo test` and `cargo clippy --all-targets -- -D warnings` in CI on Linux and Windows, like web-mcp.
    - No live or container integration tests (grill Q11). There is no official Azure DevOps Server container, and
      building one means Windows Server, SQL Server and an install of about an hour. The real-server check is the
      smoke checklist (goal 11).

11. **A smoke checklist for the user's server** (`docs/features/ado-mcp/smoke.md`). Short steps the user runs at
    work, each with what to paste back:
    - the TLS connection through ESET
    - `vsts/info` on their remote
    - each read tool
    - one of each write against a scratch PR and work item
    - a PAT with only the documented scopes, to find the real minimum

    Only tool outputs and error lines are pasted back, never raw API JSON, so no work data enters the repo.
    Fixtures stay built from the docs (grill Q7).

## Non-goals

- A command-line front end. The user picked the MCP server only.
- Classic Release pipelines, wikis, Artifacts feeds, test plans, TFVC, admin/permissions, and project settings.
- Windows integrated authentication (NTLM/Kerberos). The PAT is the only auth method.
- A diff tool: local git does it.
- Azure DevOps Services (cloud): not targeted or tested, though not deliberately blocked.
- macOS or ARM builds.
- A custom CA setting for Linux/WSL. The user never runs Claude Code under WSL or Linux at work (2026-10-18), and on
  Linux at home the system bundle covers public certificates.
- Several servers or PATs (grill Q9).
- Automated tests against a live server, either a self-built container or a dev.azure.com org (grill Q11).

## Anti-goals

- Output padded with links, GUIDs, system comments or log noise: that fails the point even if every call works.
- Any code fetched at run time (npm, scripts) or third-party code holding the PAT.
- The PAT showing up in a tool result, an error message, a log, the transcript, or a process's command line.
- A read tool with a side effect.

## Constraints

- Rust edition 2024 and `rust-version = "1.97"`.
- Its own `Cargo.lock`, clippy pedantic, and web-mcp's release profile.
- `--version` prints `ado-mcp <version>`; the installer parses it.
- Versions pinned as in web-mcp: `rmcp =3.5.1` and `reqwest =0.13.5`; plus `azure_devops_rust_api =0.39.1` and
  `azure_core =1.1.0`, whose reqwest must stay the one we pin.
- One version for everything (CLAUDE.md, Versions): the crate goes into `scripts/check-repo.mjs` `CRATES` and into
  `scripts/release.mjs`.
- No new npm dependencies in the installer.

## Left to the builder

- Module layout.
- Thread filtering and URL splitting: ported from azdocli (MIT, `src/pr/comments.rs`, `src/auth/url.rs`) or written
  fresh. A near-verbatim port keeps the notice and gets a THIRD_PARTY.md line.
- Exact tool argument names and descriptions, kept short.
- The fake-server approach for request tests; a dev-dependency is fine.
- Exact wording of each output line, within goal 4.
