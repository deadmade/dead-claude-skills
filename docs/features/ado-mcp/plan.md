# ado-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rust stdio MCP server `ado-mcp` that gives Claude PR, work-item and pipeline tools for a self-hosted Azure
DevOps Server 2022.2. It replaces the npm server in the `mcp-azure` plugin, and the installer installs and configures
the plugin.

**Architecture:** One crate, `crates/ado-mcp`, a library plus a thin `main.rs` so integration tests can call the
library directly. An `Api` client wraps one `reqwest::Client` with PAT auth, the `api-version` and error mapping. `Ctx`
resolves project, repo and branch from the git remote (via `/vsts/info`) and caches ids in memory. Each tool area
(`pr`, `wi`, `pipeline`) holds async functions that return plain text, and `tools.rs` exposes them through `rmcp`.
Write tools are marked `anthropic/requiresUserInteraction`.

**Tech Stack:** Rust 2024; `rmcp =3.5.1` (server, transport-io, macros); `reqwest =0.13.5` (`rustls-no-provider`,
`json`) with `rustls 0.23` ring; tokio; serde/serde_json; `url`; base64. Installer: Node standard library only.

**Spec:** [docs/features/ado-mcp/spec.md](spec.md). Grounding (file:line touch points): [flow.md](flow.md),
Grounding. Terms: [GLOSSARY.md](../../../GLOSSARY.md).

## Global Constraints

- Edition 2024, `rust-version = "1.97"`, `license = "MIT"`, `publish = false`, its own `Cargo.lock`, no workspace.
- `[lints.clippy] pedantic = { level = "warn", priority = -1 }`. `[profile.release]` is `lto = "thin"`,
  `codegen-units = 1`, `strip = true`.
- `version` equals `package.json`'s (currently `0.4.0`); never bumped by hand.
- `--version` prints `ado-mcp <version>`.
- Pins: `rmcp = "=3.5.1"`, `reqwest = "=0.13.5"`. rustls with ring, installed at startup like
  `crates/web-mcp/src/main.rs:43`.
- API version `7.1`. Policy evaluations use `7.1-preview.1`, work-item comments `7.1-preview.4`.
- One server and one PAT: `ADO_ORG_URL` (the collection URL), `ADO_PAT`, `ADO_DEFAULT_PROJECT`, `ADO_PROJECT_DIR`.
- The PAT never appears in a tool result, an error, a log, or a process argument.
- Output: plain text, one line per item, id first. No URLs, `_links`, GUIDs (unless needed to act), colours or
  emoji. Dates `YYYY-MM-DD`. Lists default to 20. Every cut says how to get more.
- Reads have `readOnlyHint = true`. Writes have `_meta["anthropic/requiresUserInteraction"] = true`.
- Builds only for x86_64-pc-windows-msvc and x86_64-unknown-linux-musl.
- No new npm dependencies; installer logic goes in `core.mjs`/`ui.mjs` with tests, not in `install.mjs`.
- Commit messages are one sentence with no co-author lines (the user's rule).

## Review Focus

1. **Project names with spaces and non-ASCII characters** (`My Project`, `Übergabe`).
   - The remote has them percent-encoded. They must be decoded exactly once, and API paths must use ids from
     `/vsts/info`.
   - Test: `remote::tests::decodes_spaces_once` (Task 2) and `ctx_uses_ids_not_names` (Task 4).
2. **A PAT that expires mid-session.**
   - The next call must return the 401 line naming `/plugin configure mcp-azure`. It must not retry, crash, or echo
     the header.
   - Test: `api::maps_401_without_secret` (Task 3).
3. **A PR or work item description that is huge or HTML.**
   - Output stays bounded (cut at 4000 characters, with the call that shows the rest), and work-item HTML becomes
     readable text.
   - Test: `out::clip_names_the_rest` and `out::html_to_text_keeps_lists` (Task 5).
4. **Several tool calls at once against one process.**
   - They must not serialise behind a lock held across a request; the cache's lock is never held across `.await`.
   - Test: `ctx::concurrent_resolve_hits_vsts_info_once_or_twice` (Task 4).
5. **A log with Windows line endings and a step that has no log** (skipped or cancelled).
   - `\r\n` is cleaned. A step without a log says `no log (skipped)` rather than erroring.
   - Test: `pipeline::log_crlf_and_missing_log` (Task 8).

---

## File structure

```
crates/ado-mcp/
  Cargo.toml, Cargo.lock
  src/main.rs        --version, ring provider, Config::from_env, serve stdio
  src/lib.rs         pub mod declarations only
  src/config.rs      Config from env
  src/remote.rs      git remote URL → Remote; git helpers (remote_url, current_branch)
  src/api.rs         Api: auth, api-version, get/post/patch/put, errors, continuation, Retry-After
  src/ctx.rs         Ctx { api, cfg, cache }: Scope resolution, me(), pipeline id lookup
  src/out.rs         text helpers: List, date, clip, html_to_text, person
  src/pr.rs          pr_* functions (reads and writes)
  src/wi.rs          wi_* functions
  src/pipeline.rs    pipeline_* and repo_list, log cleaning
  src/tools.rs       rmcp Server: arg structs, #[tool] wrappers, _meta, instructions
  tests/common/mod.rs   std-only fake HTTP server (pattern: crates/web-mcp/tests/common/mod.rs)
  tests/fixtures/*.json responses shaped from the 7.1 Server docs
  tests/{api,ctx,pr,wi,pipeline,mcp}.rs
.github/workflows/ado-mcp.yml, build-ado-mcp.yml; release.yml (modified)
plugins/opt-in/mcp/mcp-azure/{.claude-plugin/plugin.json,.mcp.json,README.md}
installer/{core.mjs,ui.mjs,install.mjs,core.test.mjs,view.test.mjs}
scripts/{check-repo.mjs,release.mjs}; flake.nix; .claude-plugin/marketplace.json
THIRD_PARTY.md; README.md; CLAUDE.md; docs/features/ado-mcp/smoke.md
```

---

### Task 1: Crate skeleton, MCP server shell, version sync and CI

**Files:**

- Create: `crates/ado-mcp/Cargo.toml`, `src/{main,lib,config,tools}.rs`, `tests/mcp.rs`
- Create: `.github/workflows/ado-mcp.yml` (copy of `web-mcp.yml` with `web-mcp` → `ado-mcp`, paths
  `crates/ado-mcp/**`, `plugins/opt-in/mcp/mcp-azure/**`)
- Modify: `scripts/check-repo.mjs:73-76` (`CRATES` entry `ado-mcp`); `scripts/release.mjs:43-46`
  (`['crates/ado-mcp','ado-mcp']`) and its header comment

**Interfaces:**

- Produces: `pub struct Config { pub org_url: url::Url, pub pat: String, pub default_project: Option<String>,
  pub project_dir: PathBuf }`
- Produces: `Config::from_env() -> anyhow::Result<Config>`. It reads `ADO_ORG_URL` (required; a trailing `/` is
  stripped), `ADO_PAT` (required), `ADO_DEFAULT_PROJECT` (empty means `None`) and `ADO_PROJECT_DIR` (default: cwd).
  A missing value errors with `ADO_ORG_URL is not set: configure it with /plugin configure mcp-azure`. `Debug` is
  implemented by hand and prints `pat: "***"`.
- Produces: `tools::Server::new(ctx: Arc<Ctx>)`. `Ctx` arrives in Task 4; until then `Server` holds
  `Arc<Config>`, and Task 4 swaps it.
- Produces: `pub const WRITES: &[&str]` in `tools.rs`. It lists the 12 write tool names from spec goal 2, and
  `Server::new` sets `requiresUserInteraction` on each name it finds in the router (pattern:
  `crates/web-mcp/src/tools.rs:315-320`).
- Produces: `INSTRUCTIONS: &str`, which `ServerHandler::get_info` returns. It is under 4096 characters and covers the
  4 points of spec goal 3.

- [ ] **Step 1: Write the failing tests** in `tests/mcp.rs`. Spawn `CARGO_BIN_EXE_ado-mcp` with `ADO_ORG_URL` and
      `ADO_PAT` set (pattern: `crates/web-mcp/tests/mcp.rs:7-30`).
  - `version_flag`: `--version` stdout equals `format!("ado-mcp {}\n", env!("CARGO_PKG_VERSION"))`.
  - `initialize_has_instructions`: `result.instructions` contains `git diff` and `branch`, and its length is
    under 4096.
  - `missing_url_is_one_line`: without `ADO_ORG_URL`, the process exits non-zero, stderr contains
    `/plugin configure mcp-azure`, and stderr does not contain the `ADO_PAT` value.
- [ ] **Step 2:** `cargo test --test mcp` in `crates/ado-mcp`. Expected: compile failure (no crate).
- [ ] **Step 3: Implement** the Cargo.toml from the Global Constraints, `main.rs` (structure of
      `crates/web-mcp/src/main.rs:34-58`) and `config.rs`, plus `tools.rs` with an empty `#[tool_router]` and
      `get_info` returning `INSTRUCTIONS`.
- [ ] **Step 4:** `cargo test && cargo clippy --all-targets -- -D warnings`: PASS. Then `npm test` at the repo
      root: PASS (check-repo sees the crate at the shared version).
- [ ] **Step 5: Commit**: `git commit -m "Add the ado-mcp crate skeleton with version sync and CI."`

### Task 2: Remote parsing and git helpers

**Files:** Create `src/remote.rs` (unit tests inline, `#[cfg(test)] mod tests`).

**Interfaces:**

- Produces: `pub struct Remote { pub https_url: String, pub host: String }`. `https_url` is the remote as an HTTPS
  URL, the one `/vsts/info` is appended to.
- Produces: `pub fn parse_remote(url: &str) -> Option<Remote>`. It accepts:
  - `https://host[:port]/<path…>/_git/<repo>`, user info stripped
  - `ssh://[user@]host[:port]/<path…>/_git/<repo>`, mapped to `https://host/<path…>/_git/<repo>` with the ssh
    port dropped (Task 4 replaces the host with the configured `ADO_ORG_URL`'s scheme, host and port)
  - scp-style `user@host:<path…>/_git/<repo>`
  - it returns `None` when there is no `/_git/` segment
- Produces: `pub fn decode_path(s: &str) -> String`, which percent-decodes once.
- Produces: `pub fn remote_url(dir: &Path) -> Option<String>` (`git -C dir remote get-url origin`, then the first of
  `git remote`) and `pub fn current_branch(dir: &Path) -> Option<String>` (`git -C dir rev-parse --abbrev-ref HEAD`,
  `None` for `HEAD`). Both use `std::process::Command`.

- [ ] **Step 1: Failing tests:**
  - `https_with_tfs_path`: `https://srv/tfs/Coll/Proj/_git/Repo` → `https_url` the same, `host` `srv`.
  - `strips_userinfo`: `https://me@srv/tfs/Coll/Proj/_git/Repo` → no `me@`.
  - `ssh_url`: `ssh://srv:22/tfs/Coll/Proj/_git/Repo` → `https://srv/tfs/Coll/Proj/_git/Repo`.
  - `scp_style`: `git@srv:tfs/Coll/Proj/_git/Repo` → `https://srv/tfs/Coll/Proj/_git/Repo`.
  - `decodes_spaces_once`: `decode_path("My%20Project%2520x")` == `"My Project%20x"`.
  - `not_azure`: `https://github.com/a/b.git` → `None`.
  - `branch_of_temp_repo`: `git init -b feat/x` in a temp dir, then `current_branch` == `Some("feat/x")`.
- [ ] **Step 2:** `cargo test remote`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `cargo test remote`: PASS.
- [ ] **Step 5: Commit**: `"Parse Azure DevOps git remotes and read the current branch."`

### Task 3: API client, errors, paging, fake server

**Files:** Create `src/api.rs`, `tests/common/mod.rs`, `tests/api.rs`.

**Interfaces:**

- Produces: `pub struct Api { http: reqwest::Client, base: Url, auth: HeaderValue }`, built with
  `Api::new(cfg: &Config) -> anyhow::Result<Api>`.
  - `auth` is `Basic base64(":" + pat)` with `set_sensitive(true)`.
  - `user_agent` is `ado-mcp/<version>`.
- Produces: `pub enum Ver { V71, Preview(u8) }`, rendered as `7.1` or `7.1-preview.N`.
- Produces request methods. Each `path` is relative to the collection; an absolute URL (`/vsts/info`) is used as is.
  - `get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, String)], v: Ver) -> Result<T, ApiError>`
  - `get_text(&self, path, query, v) -> Result<String, ApiError>`, for logs
  - `send<T>(&self, method: Method, path, query, v, body: &serde_json::Value, json_patch: bool) -> Result<T, ApiError>`.
    With `json_patch`, the content type is `application/json-patch+json`.
  - `get_paged<T>(&self, path, query, v, limit: usize) -> Result<(Vec<T>, bool), ApiError>`. It follows
    `x-ms-continuationtoken` (header) as `continuationToken=` until `limit`; the bool means more exist. Response
    bodies are `{ "value": [...] }`.
- Produces: `pub struct ApiError(pub String)`, implementing `Display`. The `area` is the path segment after
  `_apis/`. The messages, exact:
  - 401: `Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure`
  - 403: `the PAT may not do this: it needs the {scope} scope`, where `git`/`policy` → `Code`, `wit` →
    `Work Items`, `build`/`pipelines` → `Build`, and anything else → `a broader`
  - 404: `not found: {what}`, where `what` is the caller's label (`with_what(label)`)
  - 409, 412, 400: `the server refused it: {message}`, where `message` comes from the response's JSON `message`
  - 429: one wait of `Retry-After` seconds, capped at 30, then the same request again; a second 429 gives
    `the server is throttling requests; try again in a minute`
  - TLS/connect: `can't reach {host}: {cause}`. Certificate errors add
    ` (the certificate isn't trusted; ado-mcp uses the Windows certificate store)`.
  - The PAT and the `Authorization` header never appear in any message.
- Produces in `tests/common/mod.rs`: a fake server with the same shape as web-mcp's (`Resp`, a `serve()` returning
  a base URL, scripted routes keyed by path and query, hit counts, a log of the request headers).

- [ ] **Step 1: Failing tests** (`tests/api.rs`, against the fake server):
  - `sends_basic_auth_and_version`: the header equals `Basic ` + base64(`:pat`), and the query has
    `api-version=7.1`.
  - `preview_version`: `Ver::Preview(4)` gives `api-version=7.1-preview.4`.
  - `maps_401_without_secret`: the message equals the 401 line and doesn't contain the PAT.
  - `maps_403_scope`: a 403 on `_apis/wit/...` → contains `Work Items scope`.
  - `retry_after_once`: 429 with `Retry-After: 1`, then 200 → `Ok`, with 2 hits.
  - `pages_until_limit`: two pages of 3 linked by `x-ms-continuationtoken`, limit 4 → 4 items, `true`.
  - `json_patch_content_type`: `send(.., json_patch: true)` → the server saw `application/json-patch+json`.
- [ ] **Step 2:** `cargo test --test api`: FAIL.
- [ ] **Step 3: Implement.** Classify certificate errors by walking `std::error::Error::source()` for a rustls
      error.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit**: `"Add the Azure DevOps REST client with PAT auth, paging and one-line errors."`

### Task 4: Context: scope resolution and cache

**Files:** Create `src/ctx.rs`, `tests/ctx.rs`, `tests/fixtures/vsts-info.json`, `connection-data.json`,
`pipelines.json`. Modify `src/tools.rs` and `src/main.rs` so `Server` holds `Arc<Ctx>`.

**Interfaces:**

- Consumes: `Config`, `Api` and `remote::*`.
- Produces: `pub struct Ctx { pub api: Api, pub cfg: Config, cache: Mutex<Cache> }`, via `Ctx::new(cfg) ->
  anyhow::Result<Ctx>`. The cache holds `vsts_info: HashMap<String, Scope>`, `me: Option<Me>` and
  `pipelines: HashMap<(String, String), u32>`. It uses `std::sync::Mutex`, never held across `.await`.
- Produces: `#[derive(Clone)] pub struct Scope { pub project_id: String, pub project: String, pub repo_id:
  Option<String>, pub repo: Option<String>, pub branch: Option<String> }`.
- Produces: `pub async fn scope(&self, project: Option<&str>, repo: Option<&str>, branch: Option<&str>) ->
  Result<Scope, ApiError>`.
  - An explicit `project` and `repo` win: get `_apis/projects/{project}` and
    `{project}/_apis/git/repositories/{repo}` for their ids, and cache them by name.
  - Otherwise, from `remote_url(project_dir)`, call `GET {https_url}/vsts/info` with the header
    `X-TFS-FedAuthRedirect: Suppress` and the configured host. The fields are `repository.id`, `repository.name`,
    `repository.project.{id,name}` and `serverUrl`. If `serverUrl`'s host isn't `ADO_ORG_URL`'s, the error is
    `this repo is on {remote host}, but mcp-azure is set up for {configured host}`.
  - Otherwise `default_project`, with no repo.
  - Otherwise `no project: pass project, or open Claude Code in a clone of an Azure DevOps repo`.
  - `branch`: the argument, else `current_branch(project_dir)`.
- Produces: `pub async fn me(&self) -> Result<Me, ApiError>`, with `Me { id: String, name: String }` from
  `_apis/connectionData` (`authenticatedUser.id`, `.providerDisplayName`), cached.
- Produces: `pub async fn pipeline_id(&self, scope: &Scope, name_or_id: &str) -> Result<u32, ApiError>`. A number
  passes through; otherwise it reads `{project}/_apis/pipelines` (cached) and matches the name case-insensitively.
  An unknown name is a 404 that lists the first 10 names.
- Produces: on a 404 for a cached id, the entry is dropped and the call retried once:
  `pub(crate) fn forget(&self, key)`.

- [ ] **Step 1: Failing tests:**
  - `resolves_from_remote`: a temp git repo whose remote points at the fake server's `/tfs/Coll/My%20Proj/_git/R`
    gives the ids from the fixture.
  - `ctx_uses_ids_not_names`: the request after `scope()` uses the id, not `My Proj`.
  - `other_server_errors`: the fixture's `serverUrl` host differs → the message names both hosts.
  - `explicit_args_win`.
  - `default_project_outside_clone`.
  - `me_cached`: two calls, 1 hit.
  - `pipeline_name_lookup`: `"CI"` → 7, `"ci"` → 7, `"nope"` → `not found` listing `CI`.
  - `concurrent_resolve_hits_vsts_info_once_or_twice`: 8 `scope()` calls in `join_all` → ≤ 2 hits, all `Ok`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit**: `"Resolve project, repo and branch from the git remote with an in-memory id cache."`

### Task 5: Output helpers

**Files:** Create `src/out.rs` (unit tests inline).

**Interfaces:**

- Produces: `pub fn date(iso: &str) -> String`, the first 10 characters (`2026-10-14`) or `?`.
- Produces: `pub fn clip(text: &str, max: usize, rest: &str) -> String`. When over `max` characters (char-safe), it
  returns the first `max` and then `\n… {n} more characters: {rest}`.
- Produces: `pub const DESC_MAX: usize = 4000`.
- Produces: `pub fn more(shown: usize, more: bool, call: &str) -> Option<String>`. With `more`, it returns
  `… more: {call}`; `call` is e.g. `pr_list limit=100`.
- Produces: `pub fn html_to_text(html: &str) -> String`.
  - `<br>`, `</p>` and `</div>` become newlines, and `<li>` becomes `- `.
  - Other tags are dropped, and `&amp; &lt; &gt; &quot; &#39; &nbsp;` are decoded.
  - Runs of blank lines collapse to one, and lines are trimmed.
  - A hand-written scanner, no new dependency.
- Produces: `pub fn ref_name(r: &str) -> &str`, which strips `refs/heads/`.

- [ ] **Step 1: Failing tests:**
  - `clip_names_the_rest`: 5000 × `a` with max 4000 → it ends with `… 1000 more characters: wi_view id=1 full=true`.
  - `clip_is_char_safe`: 4001 × `ü` doesn't panic.
  - `html_to_text_keeps_lists`: `<p>Do</p><ul><li>a &amp; b</li><li>c</li></ul>` → `"Do\n- a & b\n- c"`.
  - `ref_name_strips_heads`.
  - `date_short`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit**: `"Add the plain-text output helpers."`

### Task 6: Pull request reads

**Files:** Create `src/pr.rs`, `tests/pr.rs`, and fixtures `pr-list.json`, `pr.json`, `pr-threads.json`,
`policy-evaluations.json`, `pr-workitems.json`, `wi-batch.json`, `builds-one.json`, `iterations.json`,
`iteration-changes.json`. Modify `src/tools.rs` to add 4 tools.

**Interfaces:**

- Consumes: `Ctx::scope`, `Ctx::me`, `Api::get`/`get_paged`, and `out::*`.
- Produces (all `-> Result<String, ApiError>`):
  - `pr_list(ctx, &PrListArgs)`. `PrListArgs { project, repo, status: Option<String> /* active|completed|abandoned|all, default active */, creator: Option<String>, reviewer: Option<String>, source: Option<String>, target: Option<String>, limit: Option<usize> }`.
    - `"me"` in creator or reviewer resolves through `Ctx::me`.
    - Endpoint: `{project_id}/_apis/git/repositories/{repo_id}/pullrequests`, with `searchCriteria.*` and `$top`.
    - One line per PR:
      `!{id}  {status}{ draft}  {source} → {target}  "{title}"  {author}  {approvals} approvals{, rejected}`
  - `pr_view(ctx, &PrViewArgs)`. `PrViewArgs { project, repo, branch, id: Option<u32>, full: Option<bool> }`.
    - With no id, it takes the active PR whose `sourceRefName` is `refs/heads/{scope.branch}`. None found:
      `no active PR for branch {b}`.
    - It fetches concurrently (`tokio::join!`) the PR, the policy evaluations, the PR's work items, and the latest
      run (builds `branchName=refs/pull/{id}/merge`, `$top=1`).
    - The policy `artifactId` is `vstfs:///CodeReview/CodeReviewId/{project_id}/{id}`.
    - Output sections, in order:
      - header line
      - `reviewers:` with one line each: `{name}: approved|approved with suggestions|waiting|rejected|no vote`
        (10/5/-5/-10/0), plus `(required)`
      - `checks:` with one line each: `{policy display name}: {status}`
      - `work items:` with lines `#{id} {type} {state} "{title}"`
      - `latest run:` with `#{id} {pipeline} {result or status} {date}`
      - the description, through `clip(DESC_MAX, "pr_view id={id} full=true")` unless `full`
  - `pr_threads(ctx, &PrThreadsArgs)`. `PrThreadsArgs { project, repo, branch, id: Option<u32>, all: Option<bool> }`.
    - Shows active and pending threads unless `all`.
    - `pub fn is_system(t: &Thread) -> bool` is true when every comment's `commentType` is `system` or missing, or
      `properties` has `CodeReviewThreadType`.
    - Deleted comments and empty threads are dropped.
    - Thread line: `#{thread id} {status}  {path}:{line}`, or without a location when there is no `threadContext`.
      The line comes from `rightFileStart.line`, else `leftFileStart.line`.
    - Comment lines: `   {author}: {content}`, each comment clipped at 2000.
    - Footer when some are hidden: `{n} resolved threads hidden: pr_threads all=true`.
  - `pr_files(ctx, &PrFilesArgs)` (the same scope and id args). It reads the last iteration's changes; the lines are
    `{changeType}  {path}`. It ends with `diff: git diff {target}...{source}` using the ref names.
- Produces: `PrRef` resolution shared by the writes in Task 9:
  `pub(crate) async fn resolve_pr(ctx, scope, id: Option<u32>) -> Result<Pr, ApiError>`.

- [ ] **Step 1: Failing tests:**
  - `list_one_line_each`: the fixture with 2 PRs → 2 lines starting `!412 ` and `!409 `, no `http`.
  - `list_more_line`: the fixture has `x-ms-continuationtoken`, limit 1 → it ends with `… more: pr_list limit=`.
  - `view_by_branch`: the scope branch `feature/login-retry` matches the fixture PR 412.
  - `view_sections`: contains `reviewers:`, `J. Doe: approved (required)`, `checks:`, `#77 Bug Active`,
    `latest run: #991`.
  - `view_concurrent`: the four fixture routes each delay 300 ms, and the call finishes in under 900 ms.
  - `threads_hide_system_and_resolved`: the fixture has 1 system, 1 VoteUpdate, 1 fixed and 2 active threads → 2
    threads shown, plus `1 resolved threads hidden`.
  - `thread_location`: `#7 active  src/auth.rs:88`.
  - `files_with_diff_hint`: it ends with `diff: git diff main...feature/login-retry`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Register `pr_list`, `pr_view`, `pr_threads` and `pr_files` in
      `tools.rs` with `annotations(read_only_hint = true)` and short descriptions; argument structs derive
      `Deserialize, JsonSchema`, `#[schemars(crate = "schemars")]`.
- [ ] **Step 5: Commit**: `"Add the pull request read tools."`

### Task 7: Work item reads

**Files:** Create `src/wi.rs`, `tests/wi.rs`, and fixtures `wi.json`, `wi-comments.json`, `wiql.json`. Modify
`src/tools.rs`.

**Interfaces:**

- Produces `wi_view(ctx, &WiViewArgs { project, id: u32, full: Option<bool> })`.
  - `_apis/wit/workitems/{id}?$expand=relations`, plus comments
    `{project}/_apis/wit/workItems/{id}/comments?$top=5&order=desc` at `Ver::Preview(4)`, concurrently.
  - Lines, in order:
    - `#{id} {type} {state}  "{title}"`
    - `assigned: {name or nobody}  area: {area}  iteration: {iteration}`
    - `parent: #{id}` and `children: #a, #b`, from the `System.LinkTypes.Hierarchy-Reverse`/`-Forward` relations
    - `PRs: !{id}…`, from `ArtifactLink` relations whose url contains `PullRequestId`
    - the description, then `acceptance criteria:` (`Microsoft.VSTS.Common.AcceptanceCriteria`), both via
      `html_to_text` and clipped
    - `comments:` with `{date} {author}: {text}`
- Produces `wi_query(ctx, &WiQueryArgs { project, wiql: Option<String>, assigned: Option<String>, state:
  Option<String>, r#type: Option<String>, title: Option<String>, limit: Option<usize> })`.
  - Without `wiql`, it builds `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project` plus one
    `AND` per filter (`assigned=me` → `[System.AssignedTo] = @Me`; `title` → `CONTAINS`). Values are escaped by
    doubling `'`.
  - It runs `POST {project}/_apis/wit/wiql?$top={limit+1}`, then batch-gets ≤ 200 ids with
    `fields=System.Id,System.WorkItemType,System.State,System.Title,System.AssignedTo`.
  - The lines are `#{id} {type} {state}  "{title}"  {assignee}`.

- [ ] **Step 1: Failing tests:**
  - `view_lines`: contains `#123 Bug Active`, `parent: #100`, `PRs: !412`, and the HTML description as text.
  - `query_filters_build_wiql`: the request body contains `[System.AssignedTo] = @Me` and `'O''Brien'`.
  - `query_raw_wiql_passthrough`.
  - `query_more_line`: 21 ids at limit 20 → `… more: wi_query limit=`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register as read tools).
- [ ] **Step 5: Commit**: `"Add the work item read tools."`

### Task 8: Pipeline reads and repo_list

**Files:** Create `src/pipeline.rs`, `tests/pipeline.rs`, and fixtures `builds.json`, `timeline.json`, `log.txt`
(CRLF, ANSI, `##[group]`, `##[error]`), `repos.json`. Modify `src/tools.rs`.

**Interfaces:**

- Produces `pipeline_runs(ctx, &RunsArgs { project, pipeline: Option<String>, branch: Option<String>, pr:
  Option<u32>, result: Option<String>, limit: Option<usize> })`.
  - `{project}/_apis/build/builds` with `definitions` (via `Ctx::pipeline_id`), `branchName` (`refs/heads/…`, or
    `refs/pull/{pr}/merge`), `resultFilter`, `queryOrder=queueTimeDescending` and `$top`.
  - Lines: `#{id} {pipeline}  {branch}  {result or status}  {date}  {duration}`.
- Produces `pipeline_view(ctx, &RunArgs { project, run: u32 })`, from the timeline.
  - Records nest Stage → Job → Task by `parentId` and are ordered by `order`.
  - Stage and job lines: `{indent}{name}: {result} {duration}`.
  - Then `issues:` with `{type} {message}`, from records' `issues`.
- Produces `pipeline_log(ctx, &LogArgs { project, run: u32, step: Option<String>, full: Option<bool>, start:
  Option<u32>, end: Option<u32> })`.
  - Default: each Task record with `result == failed`. `step` matches a record name case-insensitively.
  - The log comes from `{project}/_apis/build/builds/{run}/logs/{log.id}` via `get_text`, with
    `startLine`/`endLine` when `full`.
  - `pub fn clean_log(raw: &str) -> Vec<(bool, String)>` returns `(is_error, line)` pairs. It strips the leading
    ISO timestamp (`^\d{4}-\d\d-\d\dT[\d:.]+Z `), ANSI CSI sequences and `\r`. It drops `##[group]`,
    `##[endgroup]`, `##[section]` and `##[command]` prefixes (keeping a command line's text), and turns
    `##[error]x` into `(true, "ERROR x")` and `##[warning]x` into `(false, "WARNING x")`.
  - `pub fn excerpt(lines: &[(bool, String)]) -> String` takes the error lines with ±5 context, merges overlaps,
    and puts `…` between gaps, then `--- last 50 lines ---` and the tail.
  - A step with no `log`: `{step}: no log ({result})`.
  - `full` returns at most 2000 lines from `start` (default 1). When more exist it ends with
    `… more: pipeline_log run={run} step="{step}" full=true start={next}`.
- Produces `repo_list(ctx, &ProjectArgs { project })`, with lines `{name}  default: {branch}`.

- [ ] **Step 1: Failing tests:**
  - `clean_strips_noise`: no timestamp, no `\x1b`, no `##[group]`; it contains `(true, "ERROR boom")`.
  - `excerpt_context_and_tail`: an error at line 100 of 300 → lines 95–105, then `--- last 50 lines ---`.
  - `log_crlf_and_missing_log`: the CRLF fixture is clean, and a skipped step gives `Publish: no log (skipped)`.
  - `log_full_paged`: 2500 lines with `full` → 2000 lines and `start=2001`.
  - `view_tree`: contains `Build: failed` and `  Test: failed`, and `issues:` contains the fixture's error.
  - `runs_by_pr_uses_merge_ref`: the query has `branchName=refs/pull/412/merge`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register 4 read tools).
- [ ] **Step 5: Commit**: `"Add the pipeline read tools and repo_list."`

### Task 9: Pull request writes

**Files:** Modify `src/pr.rs`, `tests/pr.rs` and `src/tools.rs`. Add fixtures `identities.json` and `repo.json`.

**Interfaces:**

- Consumes: `resolve_pr`, `Ctx::me` and `Api::send`.
- Produces (each returns one line naming what changed and the id):
  - `pr_create(ctx, &PrCreateArgs { project, repo, branch, title: String, description: Option<String>, target:
    Option<String>, draft: Option<bool>, reviewers: Option<Vec<String>>, work_items: Option<Vec<u32>> })`.
    - The source is `branch` or the scope branch. The target defaults to the repository's `defaultBranch`
      (`{project}/_apis/git/repositories/{repo_id}`).
    - Reviewers resolve through `_apis/identities?searchFilter=General&filterValue={text}`. No match →
      `no user matches "{text}"`; several → `"{text}" matches: a, b, c`.
    - A 409 whose message names an existing PR → `the server refused it: …` (the message carries the PR id).
    - Output: `created !{id} {source} → {target}{ (draft)}`.
  - `pr_update(ctx, &PrUpdateArgs { …scope, id: Option<u32>, title, description, draft: Option<bool>, status:
    Option<String> /* abandoned|active */ })`. PATCHes only the fields given. → `updated !{id}: {fields}`.
  - `pr_comment(ctx, &PrCommentArgs { …scope, id, text: String, file: Option<String>, line: Option<u32> })`.
    - `file` and `line` must come together; otherwise `file and line go together`. A `line` of 0 →
      `line starts at 1`.
    - It POSTs a thread with `status: active`, `comments[0].commentType: text`, and `threadContext` whose
      `rightFileStart` and `rightFileEnd` are `{line, offset: 1}`. The path gets a leading `/`.
    - → `commented on !{id} as thread #{t}`.
  - `pr_reply(ctx, &PrReplyArgs { …scope, id, thread: u32, text })`, with `parentCommentId: 1`. →
    `replied on !{id} thread #{t}`.
  - `pr_thread_status(ctx, &PrThreadStatusArgs { …scope, id, thread, status: String /* active|fixed|wontFix|closed|byDesign|pending */ })`.
    → `thread #{t} on !{id} is now {status}`.
  - `pr_vote(ctx, &PrVoteArgs { …scope, id, vote: String /* approve|approve-with-suggestions|wait|reject|reset */ })`.
    It PUTs `…/pullrequests/{id}/reviewers/{me.id}` with `{vote: 10|5|-5|-10|0}`. → `voted {vote} on !{id}`.
  - `pr_complete(ctx, &PrCompleteArgs { …scope, id, strategy: Option<String> /* squash|noFastForward|rebase|rebaseMerge, default squash */, delete_source: Option<bool> /* default true */, transition_work_items: Option<bool> /* default true */, auto: Option<bool> })`.
    - With `auto`, it PATCHes `autoCompleteSetBy: {id: me}` and `completionOptions`.
    - Otherwise it PATCHes `status: completed`, `lastMergeSourceCommit` (from the PR) and `completionOptions`.
    - The body never has `bypassPolicy`; the test asserts its absence.
    - → `completed !{id} ({strategy})`, or `auto-complete set on !{id}`.

- [ ] **Step 1: Failing tests:**
  - `create_defaults_and_reviewers`: the body has `refs/heads/feature/x` → `refs/heads/main` and the reviewer id
    from the fixture.
  - `create_ambiguous_reviewer`.
  - `comment_anchor`: the body has `"/src/auth.rs"` and `rightFileStart` `{"line":88,"offset":1}`.
  - `comment_line_needs_file`.
  - `vote_values`: `reject` → `-10` at `/reviewers/{me}`.
  - `complete_never_bypasses`: the body has no `bypassPolicy` and has `"deleteSourceBranch":true`.
  - `update_only_given_fields`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Register the 7 tools without `read_only_hint`. `WRITES` already lists
      them.
- [ ] **Step 5: Commit**: `"Add the pull request write tools."`

### Task 10: Work item and pipeline writes

**Files:** Modify `src/wi.rs`, `src/pipeline.rs`, `tests/wi.rs`, `tests/pipeline.rs` and `src/tools.rs`.

**Interfaces:**

- Produces `wi_create(ctx, &WiCreateArgs { project, r#type: String, title: String, description: Option<String>,
  assigned: Option<String>, parent: Option<u32> })`.
  - It POSTs JSON Patch to `{project}/_apis/wit/workitems/${type}`, with `add` ops on `/fields/System.Title`,
    `/fields/System.Description` and `/fields/System.AssignedTo`.
  - A parent becomes a `/relations/-` op with `rel: System.LinkTypes.Hierarchy-Reverse` and `url:
    {org_url}/_apis/wit/workItems/{parent}`.
  - → `created #{id} {type} "{title}"`.
- Produces `wi_update(ctx, &WiUpdateArgs { project, id: u32, state, assigned, title, fields:
  Option<BTreeMap<String, serde_json::Value>> })`.
  - It PATCHes `_apis/wit/workitems/{id}` with `add` ops; the `fields` keys go to `/fields/{key}` verbatim.
  - → `updated #{id}: {field names}`.
- Produces `wi_comment(ctx, &WiCommentArgs { project, id, text })`, a POST at `Ver::Preview(4)`. →
  `commented on #{id}`.
- Produces `pipeline_run(ctx, &PipelineRunArgs { project, pipeline: String, branch: Option<String>, parameters:
  Option<BTreeMap<String, String>> })`.
  - It POSTs to `{project}/_apis/pipelines/{id}/runs` with
    `resources.repositories.self.refName = refs/heads/{branch or scope branch}` and `templateParameters`.
  - → `queued run #{id} of {pipeline} on {branch}`.
- Produces `pipeline_cancel(ctx, &RunArgs)`, which PATCHes `{project}/_apis/build/builds/{run}` with
  `{status: "cancelling"}`. → `cancelling run #{run}`.

- [ ] **Step 1: Failing tests:**
  - `create_json_patch`: content type `application/json-patch+json`, with ops for title and parent.
  - `update_custom_field`: `Microsoft.VSTS.Common.Priority` → `/fields/Microsoft.VSTS.Common.Priority`.
  - `comment_preview_version`.
  - `run_ref_and_params`.
  - `cancel_body`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register 5 write tools).
- [ ] **Step 5: Commit**: `"Add the work item and pipeline write tools."`

### Task 11: The tool surface end to end

**Files:** Modify `tests/mcp.rs`.

- [ ] **Step 1: Test `tools_and_marks`.**
  - `tools/list` names, sorted, equal the 22 tools of spec goal 2.
  - Each read has `annotations.readOnlyHint == true` and no `requiresUserInteraction`.
  - Each name in `WRITES` has `_meta["anthropic/requiresUserInteraction"] == true` and no `readOnlyHint`.
  - Every description is under 400 characters.
- [ ] **Step 2: Test `call_errors_are_tool_errors`.**
  - Spawn with `ADO_ORG_URL` at the fake server returning 401, and call `pr_list` with `project=P`, `repo=R`.
  - The result has `isError: true`, the text equals the 401 line, and the PAT isn't in stdout.
- [ ] **Step 3:** Run; fix the gaps it finds; PASS.
- [ ] **Step 4: Commit**: `"Pin the ado-mcp tool list, permission marks and error results."`

### Task 12: Release build, Nix

**Files:**

- Create: `.github/workflows/build-ado-mcp.yml`, a copy of `build-web-mcp.yml` with every `web-mcp` → `ado-mcp`
  (lines 1, 7, 26, 39, 46, 50, 53, 55, 64).
- Modify: `.github/workflows/release.yml`. Add an `ado-mcp:` job like `:74-75`, add it to `publish.needs` at `:78`,
  and update the comments at `:4` and `:87` and the notes at `:101-102` (`ado-mcp-*: the binary behind the
  mcp-azure plugin, for Windows and Linux x64`).
- Modify: `flake.nix`. Add an `adoMcp` `importTOML` and an `ado-mcp` `buildRustPackage` block like `:98-109`, and
  `nativeCheckInputs = [pkgs.git]` (Task 2's test runs git).

- [ ] **Step 1:** `nix build .#ado-mcp`, if nix is available: builds and tests pass. Otherwise
      `cargo build --release --locked` in `crates/ado-mcp`, and `./target/release/ado-mcp --version`.
- [ ] **Step 2:** `npm test`: PASS.
- [ ] **Step 3: Commit**: `"Build and release ado-mcp with the other binaries."`

### Task 13: The mcp-azure plugin and docs

**Files:**

- Modify: `plugins/opt-in/mcp/mcp-azure/.claude-plugin/plugin.json`.
  - Drop `ado_api_version`. Add `binPath`, with the same shape as web-mcp's: `type string`, `title` "ado-mcp
    binary", `description` "Path to the ado-mcp binary. Default: ado-mcp on PATH.", `default` "ado-mcp".
  - New `description`: "Azure DevOps Server tools for Claude: pull requests, work items and YAML pipelines, through
    the ado-mcp binary (self-hosted, PAT auth). Writes always ask first."
  - `ado_pat`'s description lists the scopes: "PAT with Code (Read & Write), Work Items (Read & Write), Build (Read &
    Execute)."
- Modify: `plugins/opt-in/mcp/mcp-azure/.mcp.json`. It becomes `{"mcpServers":{"ado":{"command":
  "${user_config.binPath}","env":{"ADO_ORG_URL":"${user_config.ado_org_url}","ADO_PAT":"${user_config.ado_pat}",
  "ADO_DEFAULT_PROJECT":"${user_config.ado_default_project}","ADO_PROJECT_DIR":"${CLAUDE_PROJECT_DIR}"}}}}`. Match
  web-mcp's `.mcp.json` shape: wrapped in `mcpServers`, as in `plugins/shared/web-mcp/.mcp.json`.
- Create: `plugins/opt-in/mcp/mcp-azure/README.md`:
  - what it does
  - install (the installer, or by hand with `/plugin install` and the `binPath`)
  - the PAT scopes
  - the 10 read tool names `mcp__plugin_mcp-azure_ado__…`, to allow with "don't ask again"
  - that writes always prompt (Claude Code ≥ 2.1.214)
  - limits (one server, API 7.1, YAML pipelines only)
- Modify: `.claude-plugin/marketplace.json:56`, with the same description as plugin.json plus " Opt-in.".
- Modify: `THIRD_PARTY.md:22-26`. Drop the tiberriver256 line and mcp-azure from the heading.
- Modify: `README.md:13-16` (the tools sentence) and its mcp-azure mention.
- Modify: `CLAUDE.md`:
  - `:22` "the two Rust crates" → three, naming `ado-mcp` (mcp-azure's server)
  - `:39`: mcp-azure is no longer "configs only"
  - the release (`:100`), checks (`:108-109`, adding `cargo test` and `clippy` in `crates/ado-mcp`) and CI
    (`:121-122`, `ado-mcp.yml`/`build-ado-mcp.yml`) lists
  - a layout bullet for `crates/ado-mcp`
- Modify: `installer/install.mjs:449-458` (`HANDOFF['mcp-azure']`): drop the API-version line and update the scopes.

- [ ] **Step 1:** `npm test` (check-repo, plugin validate when `claude` is on PATH): PASS.
- [ ] **Step 2:** If `claude` is available, `claude plugin validate plugins/opt-in/mcp/mcp-azure`: passed.
- [ ] **Step 3: Commit**: `"Point mcp-azure at ado-mcp and update the docs."`

### Task 14: Installer: install, download and configure mcp-azure

**Files:** Modify `installer/core.mjs`, `installer/ui.mjs`, `installer/install.mjs`, `installer/core.test.mjs` and
`installer/view.test.mjs` if their texts change.

**Interfaces:**

- Produces in `core.mjs`:
  - `BIN_PLUGINS['mcp-azure'] = { name: 'ado-mcp', key: 'binPath' }`.
  - `export const SELF_CONFIGURED = ['mcp-azure']`: token plugins the installer configures itself.
  - `export function configPrompts(userConfig, binKey)`. It returns `[{ key, title, description, secret, required }]`
    in manifest order, minus `binKey`; `secret` comes from `sensitive`.
  - `export function configValues(prompts, answers, bin)`. It returns `{ values, missing }`: `values` holds the
    non-empty trimmed answers plus `{binPath: bin}`, and `missing` is the required keys left empty.
  - `planPlugins(selected, installedIds, tokenPlugins, configured = [])`. A token plugin in `configured` moves from
    `handoff` to `install`.
- Produces in `ui.mjs`: `export async function secret(message, io = STD)`. Raw-mode input echoes `*`, handles
  backspace, returns on enter and gives `null` on ctrl-c (the pattern of `confirm`). The typed text is never written
  to output.
- Changes `install.mjs`:
  - After the pages and before the install loop, for each `SELF_CONFIGURED` id in `plan.handoff`: prompt with
    `line()` or `secret()` per `configPrompts(manifest userConfig, 'binPath')`.
  - If `missing` is empty, add the id to `configured` and recompute the plan.
  - After installs: `applyBin('mcp-azure', id)` downloads the binary.
  - Then `claude(JSON.stringify(values), 'plugin', 'configure', id, '--values-stdin')`. The values travel on stdin,
    never in args.
  - On failure: push to `failures` the handoff instruction (`run /plugin configure {id} in Claude Code`) without the
    values.
  - `install.mjs:370` uses the binary name for the crate folder: `crates/${name}`.
  - `option()` (`:569-572`): for `SELF_CONFIGURED`, the note is `asks for the token` instead of
    `token entered in Claude Code`.

- [ ] **Step 1: Failing tests** in `core.test.mjs`:
  - `configPrompts(mcpAzureUserConfig, 'binPath')` keys equal `['ado_org_url','ado_pat','ado_default_project']`, and
    only `ado_pat` is secret.
  - `configValues` with an empty PAT → `missing` equals `['ado_pat']`. With all answers →
    `values.binPath === bin`, and `ado_default_project` is left out when empty.
  - `planPlugins([a], [], [a], [a])` → `install` has `a`, `handoff` is empty.
  - The existing `BIN_PLUGINS` test map (`core.test.mjs:388-392`) gains
    `'mcp-azure': 'plugins/opt-in/mcp/mcp-azure'`, and its `binAsset` loop covers `ado-mcp`.
  - `install.mjs` source never passes `ado_pat` or `values` as an argument:
    `assert.doesNotMatch(src, /'--config'/)`.
- [ ] **Step 2:** `node --test installer/`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`: PASS. View tests updated if the note text is asserted.
- [ ] **Step 5: Commit**: `"Let the installer install and configure mcp-azure with the ado-mcp binary."`

### Task 15: Smoke checklist

**Files:** Create `docs/features/ado-mcp/smoke.md`.

Steps, each with "paste back: …" (only outputs and error lines, never raw JSON):

1. **Install.** Run the installer, tick mcp-azure, enter the URL, PAT and project. Paste back the summary lines for
   mcp-azure.
2. **Connection.** In a clone, ask Claude for `repo_list`. Paste back the output or the error line. This covers TLS
   through ESET, the PAT, and API 7.1; an error here means 7.0 is needed.
3. **Remote resolution.** `pr_list` with no arguments in the clone, then in a worktree with `branch`.
4. **Each read tool** on a real PR, work item and failed run: `pr_view`, `pr_threads`, `pr_files`, `wi_view`,
   `wi_query assigned=me`, `pipeline_runs`, `pipeline_view`, `pipeline_log`. Paste back anything noisy or wrong.
5. **Writes on scratch items only.** On a scratch branch and PR, and a scratch work item, run each write tool once
   and confirm that the prompt appeared every time, including in auto mode. Clean up with
   `pr_update status=abandoned`.
6. **Minimal PAT.** Make a PAT with only the README's scopes and repeat steps 2 and 5. Paste back any 403 line.

- [ ] **Step 1:** Write the file. Link it from flow.md Artifacts.
- [ ] **Step 2: Commit**: `"Add the ado-mcp smoke checklist for the user's server."`

---

## Self-review notes

- **Spec coverage:**
  - Goals 1–2 → Tasks 1, 6–10; goal 3 → Task 1; goal 4 → Task 5 and each tool task; goal 5 → Tasks 2 and 4;
    goal 6 → Tasks 3, 4 and 6 (`view_concurrent`).
  - Goal 7 → Task 3; goal 8 → Task 3 (`Ver`); goal 9 → Tasks 13 and 14; goal 10 → every task, CI in Task 1;
    goal 11 → Task 15.
  - The non-goals add nothing.
- **Tool count:** reads 10 (`pr_list`, `pr_view`, `pr_threads`, `pr_files`, `wi_view`, `wi_query`,
  `pipeline_runs`, `pipeline_view`, `pipeline_log`, `repo_list`) and writes 12 (`pr_create`, `pr_update`,
  `pr_comment`, `pr_reply`, `pr_thread_status`, `pr_vote`, `pr_complete`, `wi_create`, `wi_update`, `wi_comment`,
  `pipeline_run`, `pipeline_cancel`), so 22. Task 1's `WRITES` has 12 names and Task 11 asserts 22.
- **Type consistency:**
  - `Scope`, `Me`, `ApiError`, `Ver` and `resolve_pr` are defined in Tasks 3, 4 and 6, and used under the same names
    in 6–10.
  - The argument structs share the optional `project`, `repo` and `branch` (spec goal 5), written as `…scope` in
    Task 9.
- **Spec deviations: none.** The plan adds two things the spec leaves to the builder:
  - the description cap of 400 characters per tool
  - `squash` as `pr_complete`'s default strategy _(my call: the most common choice; the tool argument overrides
    it)_
