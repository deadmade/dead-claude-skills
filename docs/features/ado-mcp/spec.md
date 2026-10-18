# ado-mcp: spec

Status: draft, before the grill and Gate 1. Written from the chat and the decisions in [flow.md](flow.md) (Options).
Choices marked _(my call)_ were not made by the user.

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
   `mcp-azure` plugin. The plugin keeps its name and its userConfig keys, so existing configuration carries over.
   - It is built, released, downloaded and version-synced like web-mcp: Windows x64 and Linux x64 (musl) only. The
     touch points are listed in flow.md, Grounding.
   - It calls the REST API with hand-written requests and small serde structs, for only the endpoints the tools
     below use. No `azure_devops_rust_api`, no generated SDK.
2. **The tools** (the names are the MCP tool names):
   - **Reads.** These are safe to pre-approve: none of them changes anything on the server.
     - `pr_list`: filter by status (default active), creator, reviewer (`me` allowed), source/target branch; `limit`.
     - `pr_view`:
       - with no id, the PR for the current branch
       - title, status, draft, source → target, author, description
       - reviewers with their votes, policy evaluations (what blocks completion), linked work items, and the latest
         build of the source branch
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
       - shows the error lines with a few lines of context, plus the step's last 50 lines
       - `step` picks another step; `full: true` with `start`/`end` lines returns the raw range, capped _(my call:
         2000 lines per call)_
     - `repo_list`: repos in the project.
   - **Writes.** Not pre-approved; the user sees a permission prompt for each.
     - `pr_create`: title, description, source (default: current branch), target (default: the repo's default
       branch), draft, reviewers, linked work items.
     - `pr_update`: title, description, draft ↔ published, abandon or reactivate.
     - `pr_comment`: a new thread, optionally anchored to a `file:line`.
     - `pr_reply`: a reply on a thread.
     - `pr_thread_status`: set a thread's status, e.g. fixed, closed or won't fix.
     - `pr_vote`: approve, approve with suggestions, wait for author, reject, reset.
     - `pr_complete`: merge strategy, delete the source branch, transition work items; or set auto-complete.
     - `wi_create`: type, title, description, assignee, parent.
     - `wi_update`: state, assignee, title, fields.
     - `wi_comment`.
     - `pipeline_run`: by name or id, branch, parameters.
     - `pipeline_cancel`.
     - Every write answers with one line naming what changed and the item's id.
3. **Output for an agent, not a person:**
   - Plain text: one line per item, id first. No URLs or `_links`, no GUIDs unless needed to act, no colours or emoji.
   - Dates as `2026-10-14`, people as display names.
   - Lists default to 20 items, and every cut says so and how to get more (`… 37 more: limit 100`).
   - Long text is cut, with the exact tool call that shows the rest.
   - Errors are one actionable line (see goal 6).
4. **Context comes from the git remote.**
   - The server finds the project folder (_my call_: `env` gets `ADO_PROJECT_DIR=${CLAUDE_PROJECT_DIR}` in
     `.mcp.json`; the builder confirms that variable resolves there, otherwise uses the process's cwd).
   - It reads the folder's remote by running `git` (`remote get-url`, `rev-parse --abbrev-ref HEAD`) _(my call:
     shelling out to git handles worktrees and config for free)_.
   - It resolves the remote once with `GET {remote}/vsts/info`, which returns the collection URL, project id and
     repo id, as `az` does.
   - Both HTTPS and SSH remotes work (`ssh://host:22/coll/proj/_git/repo` maps to the configured HTTPS server).
   - Every tool takes optional `project` and `repo` arguments that override the remote. Outside a clone,
     `ado_default_project` applies.
   - A remote on a different server from `ado_org_url` is an error that says so.
5. **Fast, and fine when Claude calls several tools at once.**
   - One process holds one `reqwest` client, so connections and TLS sessions are reused.
   - A tool that needs several requests (`pr_view` needs about five) sends them concurrently.
   - Parallel tool calls from Claude run concurrently.
   - An in-memory cache holds what rarely changes: `/vsts/info` per remote, project and repo ids, the PAT's own
     identity (`me`), and pipeline name → id. It lasts for the life of the process, and an id that 404s is
     re-resolved once.
   - Live data (PR state, threads, runs, logs) is never cached.
   - No cache file and no daemon.
6. **Authentication and TLS.**
   - `Authorization: Basic base64(":" + PAT)`. The PAT comes from the existing `ado_pat` userConfig (`sensitive`, so
     Claude Code keeps it in the platform's secure credential store) through `env` in `.mcp.json`.
   - The server never prints or logs the PAT.
   - TLS uses web-mcp's stack: reqwest `rustls-no-provider` with ring, and `rustls-platform-verifier`. That trusts
     the Windows certificate store, which matters because ESET's HTTPS scanning re-signs traffic on the user's work
     machine.
   - Errors map to one line each:
     - 401: the PAT was rejected (expired or wrong); fix it with `/plugin configure mcp-azure`.
     - 403: names the PAT scope the area needs.
     - 404: names what wasn't found.
     - 409/412: a conflict (e.g. a PR already exists for the branch: name it).
     - 429: honour `Retry-After` once, then report.
     - TLS failure: says the certificate isn't trusted and that the server uses the Windows store.
7. **API version 7.1.** Azure DevOps Server 2022.1 and later accept it, and preview endpoints use their documented
   `7.1-preview.N`: policy evaluations `-preview.1`, work-item comments `-preview.4`. The `ado_api_version` option
   is removed _(my call: the server is written against one version; an older server gets a clear error instead of
   half-working calls)_. A stale value in someone's settings is ignored.
8. **Plugin and installer.**
   - `plugins/opt-in/mcp/mcp-azure/` gets a `binPath` userConfig (default `ado-mcp`, on PATH) and a `.mcp.json`
     that runs `${user_config.binPath}`.
   - The server's key in `.mcp.json` becomes `ado` (was `azure-devops-server`) _(my call: it is part of every tool's
     permission name, `mcp__plugin_mcp-azure_ado__pr_list`, so it is fixed now and never renamed)_.
   - It also gets a README listing the tools, the PAT scopes (Code Read & Write, Work Items Read & Write, Build Read
     & Execute) and how to set it up.
   - The marketplace and plugin descriptions say what it is now.
   - Installer: `BIN_PLUGINS` maps `mcp-azure` → binary `ado-mcp` (the plugin and binary names now differ, so
     `install.mjs:370` uses the binary's crate folder).
   - mcp-azure is a token plugin, handed off rather than installed (`HANDOFF`, `planPlugins`). So the installer
     downloads the binary and prints the `binPath` to set in the handoff text, unless it can set it itself.
   - The HANDOFF text drops the API-version line.
   - THIRD_PARTY.md drops `@tiberriver256/mcp-server-azure-devops`. CLAUDE.md and README.md say what mcp-azure is
     now (CLAUDE.md:22 "the two Rust crates" becomes three).
9. **Tests.**
   - Unit tests for the output shaping: system-thread filter, log cleaning, truncation lines, WI HTML to text.
   - Unit tests for remote parsing (HTTPS, SSH, `/tfs/` paths, spaces in project names, which are decoded once and
     then replaced by ids from `/vsts/info`).
   - Unit tests for error mapping.
   - Request-level tests against a local fake server that replays JSON fixtures shaped from the 7.1 Server docs.
   - `cargo test` and `cargo clippy --all-targets -- -D warnings` in CI on Linux and Windows, like web-mcp.
10. **A smoke checklist for the user's server** (`docs/features/ado-mcp/smoke.md`). Short steps the user runs at
    work, each with what to paste back:
    - the TLS connection through ESET
    - `vsts/info` on their remote
    - each read tool
    - one of each write against a scratch PR and work item
    - a PAT with only the documented scopes, to find the real minimum

## Non-goals

- A command-line front end. The user picked the MCP server only.
- Classic Release pipelines, wikis, Artifacts feeds, test plans, TFVC, admin/permissions, and project settings.
- Windows integrated authentication (NTLM/Kerberos). The PAT is the only auth method.
- A diff tool (local git does it).
- Azure DevOps Services (cloud): not targeted or tested, though not deliberately blocked.
- macOS or ARM builds.

## Anti-goals

- Output padded with links, GUIDs, system comments or log noise: that fails the point even if every call works.
- Any code fetched at run time (npm, scripts) or third-party code holding the PAT.
- The PAT showing up in a tool result, an error message, a log or the transcript.
- A read tool with a side effect.

## Constraints

- Rust edition 2024, `rust-version = "1.97"`, its own `Cargo.lock`, clippy pedantic, and web-mcp's release
  profile. `--version` prints `ado-mcp <version>` (the installer parses it).
- Pin versions as web-mcp does: `rmcp =3.5.1` and `reqwest =0.13.5`.
- One version for everything (CLAUDE.md, Versions): `scripts/check-repo.mjs` `CRATES` and `scripts/release.mjs`
  get the crate.
- No new npm dependencies in the installer.

## Left to the builder

- Module layout. Whether thread filtering and URL splitting are ported from azdocli (MIT, `src/pr/comments.rs`,
  `src/auth/url.rs`; a near-verbatim port keeps the notice and gets a THIRD_PARTY.md line) or written fresh.
- Exact tool argument names and descriptions, kept short.
- The fake-server approach for request tests (a dev-dependency is fine).
- Exact wording of each output line, within goal 3.
