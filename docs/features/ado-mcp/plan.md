# ado-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Revision 2: plan review round 1 applied (2026-10-18). The findings and decisions are in [flow.md](flow.md).
Revision 3: deviation D1 (flow.md), Microsoft's `azure_devops_rust_api` at runtime. Tasks 1–6 are done; Task 6a moves
them onto the crate, and Tasks 7–10 call the crate (Task 6a, "From here on").

**Goal:** A Rust stdio MCP server `ado-mcp` that gives Claude PR, work-item and pipeline tools for a self-hosted Azure
DevOps Server 2022.2. It replaces the npm server in the `mcp-azure` plugin, and the installer installs and configures
the plugin.

**Architecture:** One binary crate, `crates/ado-mcp`, shaped like web-mcp: no library, so items are `pub(crate)`.
- `Api` wraps one `reqwest::Client` with timeouts, no redirects and error mapping, and holds the
  `azure_devops_rust_api` clients built on it (Task 6a). It sends the PAT only to URLs under `ADO_ORG_URL`.
- `Ctx` resolves project, repo and branch from the git remote (checked against `ADO_ORG_URL` before any request,
  then `/vsts/info`), and caches ids in memory.
- Tool areas (`pr`, `wi`, `pipeline`) return plain text, and `tools.rs` exposes them through `rmcp`. Write tools are
  marked `anthropic/requiresUserInteraction`.
- Pure logic is unit-tested inline. Tool behaviour is tested over stdio against a fake HTTP server, copied from
  web-mcp's `tests/common/mod.rs`.

**Tech Stack:** Rust 2024; `rmcp =3.5.1` (server, transport-io, macros); `azure_devops_rust_api =0.39.1` and
`azure_core =1.1.0`; `reqwest =0.13.5` (`rustls-no-provider`, `json`) with aws-lc-rs, the provider the crate compiles
in; tokio; serde/serde_json; `url`; base64. Installer: Node standard library only.

**Spec:** [docs/features/ado-mcp/spec.md](spec.md). Grounding (file:line touch points): [flow.md](flow.md),
Grounding. Terms: [GLOSSARY.md](../../../GLOSSARY.md).

## Global Constraints

- Edition 2024, `rust-version = "1.97"`, `license = "MIT"`, `publish = false`, its own `Cargo.lock`, no workspace,
  no `[lib]`.
- `[lints.clippy] pedantic = { level = "warn", priority = -1 }`. `[profile.release]` is `lto = "thin"`,
  `codegen-units = 1`, `strip = true`.
- `version` equals `package.json`'s (currently `0.4.0`); never bumped by hand.
- `--version` prints `ado-mcp <version>`.
- Pins: `rmcp = "=3.5.1"`, `reqwest = "=0.13.5"`, `azure_devops_rust_api = "=0.39.1"`, `azure_core = "=1.1.0"`.
  `cargo tree -d -i reqwest` shows one reqwest; a crate bump that brings a second one is not taken.
- rustls uses aws-lc-rs (since Task 6a; ring until then). Nothing installs a provider: reqwest falls back to
  aws-lc-rs itself.
- API versions: calls through the crate send its `7.1-preview`. The hand-written calls keep constants in `api.rs`:
  `V71_P1 = "7.1-preview.1"` for `connectionData`, none for `/vsts/info`. `V71` and `V71_P4` go in Task 6a.

- One server, one collection, one PAT: `ADO_ORG_URL` (the collection URL, stored with a trailing `/` so
  `Url::join` keeps the collection), `ADO_PAT`, `ADO_DEFAULT_PROJECT`, `ADO_PROJECT_DIR`.
- The PAT never appears in a tool result, an error, a log, the installer's summary, or a process argument.
- The PAT is only sent to URLs under `ADO_ORG_URL`.
- Every request carries `X-TFS-FedAuthRedirect: Suppress`, with a 10 s connect timeout and a 60 s total timeout.
- Output: plain text, one line per item, id first. No URLs, `_links`, GUIDs (unless needed to act), colours or
  emoji. Dates `YYYY-MM-DD`. Lists default to 20, fetched as `limit + 1` to know whether more exist. Every cut says
  how to get more.
- Reads have `readOnlyHint = true`. Writes have `_meta["anthropic/requiresUserInteraction"] = true`.
- Builds only for x86_64-pc-windows-msvc and x86_64-unknown-linux-musl.
- No new npm dependencies; installer decisions go in `core.mjs` (and `ui.mjs`) with tests, and `install.mjs` only
  does the I/O.
- Commit messages are one sentence with no co-author lines (the user's rule).

## Review Focus

1. **Project names with spaces and non-ASCII characters** (`My Project`, `Übergabe`).
   - The remote has them percent-encoded. They must be decoded exactly once, and API paths must use ids from
     `/vsts/info`.
   - Tests: `remote::tests::decodes_spaces_once` (Task 2) and `ctx_uses_ids_not_names` (Task 4).
2. **A PAT that expires mid-session.**
   - The next call must return the 401 line naming `/plugin configure mcp-azure`. It must not retry, crash, echo the
     header, or show a sign-in HTML page.
   - Tests: `maps_401_without_secret` and `html_203_is_one_line` (Task 3).
3. **A PR or work item description that is huge or HTML.**
   - Output stays bounded (cut at 4000 characters, with the call that shows the rest), and work-item HTML, comments
     included, becomes readable text.
   - Tests: `out::clip_names_the_rest` and `out::html_to_text_keeps_lists` (Task 5), and `view_lines` (Task 7).
4. **A remote that points somewhere else** (a fork on another server, or another collection on the same host).
   - No request may carry the PAT there.
   - Tests: `remote::tests::other_host_refused` (Task 2) and `other_server_sends_nothing` (Task 4).
5. **A log with Windows line endings, a step with no log, and a job that failed without a failed step**
   (timeout, lost agent).
   - `\r\n` is cleaned, a missing log is named, and a failed job without a failed step shows the job's issues.
   - Tests: `log_crlf_and_missing_log` and `job_failed_without_step` (Task 8).

6. **The crate meeting a self-hosted server** (Task 6a).
   - A collection at the server root (`https://server/Coll/`, no `/tfs/`) must not give `//Coll/` paths.
   - A response missing a field the crate's model requires must give the `unexpected answer` line naming the field,
     not a crash or a blank result.
   - Nothing may resend a write: azure_core's retry policy is off.
   - Tests: `root_hosted_collection`, `missing_field_names_it` and `no_resend_on_503` (Task 6a).

---

## File structure

```
crates/ado-mcp/
  Cargo.toml, Cargo.lock
  src/main.rs        mod decls, --version, ring provider, Config::from_env, serve stdio
  src/config.rs      Config from env (no Debug derive)
  src/remote.rs      git remote → https URL under ADO_ORG_URL; git helpers
  src/api.rs         Api: auth, versions, get/send, timeouts, errors, Retry-After
  src/ctx.rs         Ctx { api, cfg, cache }: Scope, me(), user(), pipeline_id()
  src/out.rs         text helpers
  src/pr.rs  src/wi.rs  src/pipeline.rs   tool functions
  src/tools.rs       rmcp Server: arg structs, #[tool] wrappers, _meta, get_info
  tests/common/mod.rs   copy of crates/web-mcp/tests/common/mod.rs, plus a request log with bodies; Mcp client
  tests/fixtures/*.json responses shaped from the 7.1 Server docs
  tests/{mcp,api,ctx,pr,wi,pipeline}.rs   stdio tests against the fake server
.github/workflows/ado-mcp.yml, build-ado-mcp.yml; release.yml
plugins/opt-in/mcp/mcp-azure/{.claude-plugin/plugin.json,.mcp.json,README.md}
installer/{core.mjs,ui.mjs,view.mjs,install.mjs,core.test.mjs,ui.test.mjs,view.test.mjs}
scripts/{check-repo.mjs,release.mjs}; flake.nix; .claude-plugin/marketplace.json
THIRD_PARTY.md; README.md; CLAUDE.md; docs/features/ado-mcp/smoke.md
```

**Test harness (all stdio tests):**

- `tests/common/mod.rs` is web-mcp's file copied as is, minus the parts web-mcp alone needs (`PUBLIC`, agent-browser
  helpers).
- It gains `pub struct Req { pub method: String, pub path: String /* with query */, pub headers: Vec<(String,
  String)>, pub body: Vec<u8> }` and `Fixture::requests() -> Vec<Req>`. The body is read by `Content-Length`.
- Routes match on path, with the query when given (as in web-mcp).
- `pub fn ado(fx: &Fixture, extra_env: &[(&str, &str)]) -> Mcp` spawns `CARGO_BIN_EXE_ado-mcp` with
  `ADO_ORG_URL={fx base}/tfs/Coll/` and `ADO_PAT=test-pat`, sets `ADO_PROJECT_DIR` to a temp dir, then initializes.
- `Mcp::call(tool, args) -> (bool /* isError */, String /* text */)`.

---

### Task 1: Crate skeleton, MCP shell, version sync and CI

**Files:**

- Create: `crates/ado-mcp/Cargo.toml`, `src/{main,config,tools}.rs`, `tests/common/mod.rs`, `tests/mcp.rs`.
- Create: `.github/workflows/ado-mcp.yml`, a copy of `web-mcp.yml` with `web-mcp` → `ado-mcp` and paths
  `crates/ado-mcp/**`, `plugins/opt-in/mcp/mcp-azure/**`.
- Modify: `scripts/check-repo.mjs:73-76` (`CRATES` entry `ado-mcp`) and `scripts/release.mjs:43-46`
  (`['crates/ado-mcp','ado-mcp']`, plus its header comment).

**Interfaces:**

- Produces: `pub(crate) struct Config { pub org_url: Url /* ends with / */, pub pat: String, pub default_project:
  Option<String>, pub project_dir: PathBuf }`. It doesn't derive `Debug`.
- Produces: `Config::from_env() -> anyhow::Result<Config>`.
  - It reads `ADO_ORG_URL` (required; a trailing `/` is added), `ADO_PAT` (required), `ADO_DEFAULT_PROJECT` (empty
    means `None`) and `ADO_PROJECT_DIR` (default: cwd).
  - A missing value errors with `{VAR} is not set: configure it with /plugin configure mcp-azure`.
- Produces: `tools::Server::new(ctx: Arc<Ctx>)`. Until Task 4 the server holds `Arc<Config>`.
- Produces: `pub(crate) const WRITES: [&str; 12]`, the write tool names of spec goal 2. `Server::new` sets
  `requiresUserInteraction` on each one present in the router (pattern: `crates/web-mcp/src/tools.rs:315-320`).
- Produces: `get_info` written by hand (`tool_handler`'s `instructions` takes only a literal). It returns
  `ServerInfo` with tools enabled in the capabilities and `instructions: INSTRUCTIONS`, a const under 4096 characters
  covering the 4 points of spec goal 3.

- [ ] **Step 1: Failing tests** in `tests/mcp.rs`:
  - `version_flag`: stdout equals `format!("ado-mcp {}\n", env!("CARGO_PKG_VERSION"))`.
  - `initialize_has_instructions`: `result.instructions` contains `git diff` and `branch`, its length is under
    4096, and `result.capabilities.tools` is present.
  - `missing_url_is_one_line`: without `ADO_ORG_URL`, the exit is non-zero, stderr contains
    `/plugin configure mcp-azure`, and stderr doesn't contain `test-pat`.
- [ ] **Step 2:** `cargo test --test mcp` in `crates/ado-mcp`: fails (no crate).
- [ ] **Step 3: Implement.** `main.rs` follows `crates/web-mcp/src/main.rs:34-58`.
- [ ] **Step 4:** `cargo test && cargo clippy --all-targets -- -D warnings`: PASS. Then `npm test` at the root: PASS.
- [ ] **Step 5: Commit**: `"Add the ado-mcp crate skeleton with version sync and CI."`

### Task 2: Remote mapping and git helpers

**Files:** Create `src/remote.rs` (unit tests inline).

**Interfaces:**

- Produces: `pub(crate) fn https_remote(remote: &str, org_url: &Url) -> Result<String, String>`. It returns the
  remote as an HTTPS URL under `org_url`, the one `/vsts/info` is appended to, or a one-line error.
  - It accepts `https://[user@]host[:port]/<path>`, `ssh://[user@]host[:port]/<path>` and scp-style
    `user@host:<path>`. The path must contain `/_git/`; otherwise
    `not an Azure DevOps remote: pass project and repo`.
  - The host (case-insensitive) must equal `org_url`'s host; otherwise
    `this repo is on {host}, but mcp-azure is set up for {org host}`. The ssh port is ignored.
  - `org_url`'s last path segment is the collection. It must match one segment of the remote path
    (case-insensitive, after `decode_path`); otherwise
    `this repo is not in collection {collection} that mcp-azure is set up for`.
  - Result: `org_url` joined with the remote path segments after the collection. This handles SSH paths with and
    without `tfs/`, and an HTTPS virtual directory.
- Produces: `pub(crate) fn decode_path(s: &str) -> String`, which percent-decodes once.
- Produces: `pub(crate) fn origin_url(dir: &Path) -> Option<String>` (`git -C dir remote get-url origin`) and
  `pub(crate) fn current_branch(dir: &Path) -> Option<String>` (`git -C dir rev-parse --abbrev-ref HEAD`, `None` for
  `HEAD`).

- [ ] **Step 1: Failing tests** (`org_url` is `https://srv/tfs/Coll/`):
  - `https_same`: `https://srv/tfs/Coll/Proj/_git/Repo` → the same URL.
  - `strips_userinfo`: `https://me@srv/tfs/Coll/Proj/_git/Repo` → no `me@`.
  - `ssh_with_tfs`: `ssh://srv:22/tfs/Coll/Proj/_git/Repo` → `https://srv/tfs/Coll/Proj/_git/Repo`.
  - `ssh_without_tfs`: `ssh://srv:22/Coll/Proj/_git/Repo` → `https://srv/tfs/Coll/Proj/_git/Repo`.
  - `scp_style`: `git@srv:Coll/Proj/_git/Repo` → `https://srv/tfs/Coll/Proj/_git/Repo`.
  - `other_host_refused`: `https://evil/tfs/Coll/P/_git/R` → `Err` naming `evil` and `srv`.
  - `other_collection_refused`: `https://srv/tfs/CollB/P/_git/R` → `Err` naming `Coll`.
  - `decodes_spaces_once`: `decode_path("My%20Project%2520x")` == `"My Project%20x"`.
  - `not_azure`: `https://srv/a/b.git` → `Err` containing `pass project and repo`.
  - `branch_of_temp_repo`: `git init -b feat/x` in a temp dir, then `current_branch` == `Some("feat/x")`.
- [ ] **Step 2:** `cargo test remote`: FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit**: `"Map Azure DevOps git remotes onto the configured collection."`

### Task 3: API client and errors

**Files:** Create `src/api.rs`, `tests/api.rs`, and a temporary diagnostic tool `ping` in `tools.rs`
(`GET _apis/projects?$top=1`, printing the count). Task 11 removes `ping`.

**Interfaces:**

- Produces: `pub(crate) struct Api`, via `Api::new(cfg: &Config) -> anyhow::Result<Api>`.
  - `auth` is `Basic base64(":" + pat)` with `set_sensitive(true)`.
  - `user_agent` is `ado-mcp/<version>`, `connect_timeout` 10 s, `timeout` 60 s.
  - Default header `X-TFS-FedAuthRedirect: Suppress`.
- Produces request methods. `path` is joined onto `org_url`; an absolute URL is allowed only when it starts with
  `org_url`, and otherwise the call returns `Err` before anything is sent.
  - `get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, String)], ver: &str) -> Result<T, ApiError>`
  - `get_text(&self, path, query, ver) -> Result<String, ApiError>`
  - `send<T>(&self, method: Method, path, query, ver, body: &serde_json::Value, json_patch: bool) -> Result<T, ApiError>`
- Produces: `pub(crate) struct ApiError { pub status: Option<u16>, pub tf: Option<String>, pub msg: String }`.
  `Display` shows `msg`, and `tf` holds a `TFnnnnnn` code parsed from the JSON message. `with_what(label)` sets the
  404 text. The messages, exact:
  - 401, or 203 with an HTML body: `Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure`
  - 403: `the PAT may not do this: it needs the {scope} scope`. The area is the segment after `_apis/`: `git` or
    `policy` → `Code`; `wit` → `Work Items`; `build` or `pipelines` → `Build`; `projects`, `identities` or
    `connectionData` → `Project and Team (Read)`; anything else → `a broader`.
  - 404: `not found: {what}`.
  - 400, 409, 412: `the server refused it: {message}`.
  - 429: one wait of `Retry-After` seconds (capped at 30) and one resend; a second 429 gives
    `the server is throttling requests; try again in a minute`.
  - 5xx: `the server failed ({status}); try again`.
  - A body that isn't JSON where JSON was expected: `unexpected answer from the server ({status}, {content-type})`.
  - Timeout: `the server didn't answer in 60 s`.
  - Connect/TLS: `can't reach {host}: {cause}`. A rustls certificate error found in the `source()` chain adds
    ` (the certificate isn't trusted; ado-mcp uses the Windows certificate store)`.
  - No message contains the PAT or the `Authorization` value.

- [ ] **Step 1: Failing tests** (`tests/api.rs`, through `ping`):
  - `sends_auth_version_and_suppress`: the logged request has `Authorization: Basic ` + base64(`:test-pat`), the
    query has `api-version=7.1`, and the header `X-TFS-FedAuthRedirect: Suppress` is present.
  - `maps_401_without_secret`: the text equals the 401 line, with `isError` true and no `test-pat`.
  - `html_203_is_one_line`: 203 with `text/html` → the 401 line.
  - `maps_403_scope`: a 403 → contains `scope`.
  - `retry_after_once`: 429 with `Retry-After: 1`, then 200 → OK, with 2 requests logged.
  - `server_error_line`: 503 → `the server failed (503); try again`.
  - `timeout_line`: a route delayed past the deadline (set the timeout from `ADO_TIMEOUT_MS`, read only in debug
    builds, like web-mcp's test hooks) → `didn't answer`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit**: `"Add the Azure DevOps REST client with PAT auth, timeouts and one-line errors."`

### Task 4: Context: scope, me, users, pipelines

**Files:** Create `src/ctx.rs`, `tests/ctx.rs`, and fixtures `vsts-info.json`, `connection-data.json`,
`definitions.json`, `identities.json`. Modify `tools.rs` and `main.rs` so `Server` holds `Arc<Ctx>`. Replace `ping`'s
body with a `scope()` echo for the tests.

**Interfaces:**

- Produces: `pub(crate) struct Ctx { pub api: Api, pub cfg: Config, cache: std::sync::Mutex<Cache> }`.
  - The lock is never held across `.await`. Concurrent misses may each fetch; the last write wins.
- Produces: `#[derive(Clone)] pub(crate) struct Scope { pub project_id: String, pub project: String, pub repo_id:
  Option<String>, pub repo: Option<String>, pub branch: Option<String> }`.
- Produces: `async fn scope(&self, project: Option<&str>, repo: Option<&str>, branch: Option<&str>) ->
  Result<Scope, ApiError>`.
  - An explicit `project` (and `repo`) wins: get `{project}/_apis/git/repositories/{repo}`, which carries
    `project.id`, and cache it. With no repo, get `_apis/projects/{project}`.
  - Otherwise `origin_url(project_dir)` → `https_remote` (an `Err` becomes the tool error, and nothing is sent) →
    `GET {https}/vsts/info`. It reads `repository.{id,name}` and `repository.project.{id,name}`, cached by remote.
  - Otherwise `default_project`.
  - Otherwise `no project: pass project, or open Claude Code in a clone of an Azure DevOps repo`.
  - `branch`: the argument, else `current_branch(project_dir)`.
  - A 404 on a request built from a cached id drops that entry, re-resolves and retries once:
    `pub(crate) async fn retry_stale<F, T>(&self, key: &str, f: F)`.
- Produces: `async fn me(&self) -> Result<Me, ApiError>`, with `Me { id: String, name: String }` from
  `_apis/connectionData` at `V71_P1` (`authenticatedUser.id`, `.providerDisplayName`), cached.
- Produces: `async fn user(&self, text: &str) -> Result<Me, ApiError>`. `me` → `me()`; otherwise
  `_apis/identities?searchFilter=General&filterValue={text}`.
  - No match: `no user matches "{text}"`.
  - Several: `"{text}" matches: {name1}, {name2}, …`, the first 5.
- Produces: `async fn pipeline_id(&self, scope: &Scope, name_or_id: &str) -> Result<u32, ApiError>`.
  - A number passes through.
  - Otherwise `{project}/_apis/build/definitions?name={name}`, cached per name; a miss isn't cached.
  - Several results (same name in different folders): `pipeline "{name}" is ambiguous: {path}\{name}, …`.
  - None: `not found: pipeline "{name}"`.

- [ ] **Step 1: Failing tests:**
  - `resolves_from_remote`: a temp git repo with origin `{base}/tfs/Coll/My%20Proj/_git/R` gives the fixture ids.
  - `ctx_uses_ids_not_names`: the request after resolving uses the project id, not `My Proj`.
  - `other_server_sends_nothing`: origin `https://evil.invalid/tfs/Coll/P/_git/R` → the error names `evil.invalid`,
    and the request log is empty.
  - `explicit_args_win`.
  - `default_project_outside_clone`.
  - `me_cached_and_preview`: two `me` uses → 1 request, with `api-version=7.1-preview.1`.
  - `user_ambiguous`.
  - `pipeline_by_name`, `pipeline_ambiguous` and `pipeline_unknown`.
  - `stale_id_retried_once`: a cached repo id that 404s → re-resolved, with exactly one retry.
  - `concurrent_scopes_all_ok`: 8 parallel tool calls → all succeed; a 9th call afterwards adds no `/vsts/info`
    request.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit**: `"Resolve project, repo, users and pipelines with an in-memory cache."`

### Task 5: Output helpers

**Files:** Create `src/out.rs` (unit tests inline).

**Interfaces:**

- Produces: `date(iso: &str) -> String`, the first 10 characters or `?`.
- Produces: `clip(text: &str, max: usize, rest: &str) -> String`. Char-safe; beyond `max` it appends
  `\n… {n} more characters: {rest}`. `DESC_MAX = 4000`.
- Produces: `cut<T>(items: Vec<T>, limit: usize) -> (Vec<T>, bool)`, keeping `limit`, with the bool true when more
  were fetched.
- Produces: `more(call: &str) -> String`, i.e. `… more: {call}`.
- Produces: `html_to_text(html: &str) -> String`.
  - `<br>`, `</p>`, `</div>` and `</li>` become newlines, and `<li>` becomes `- `.
  - Other tags are dropped, and `&amp; &lt; &gt; &quot; &#39; &nbsp;` are decoded.
  - Blank runs collapse to one, and lines are trimmed. A hand-written scanner.
- Produces: `ref_name(r: &str) -> &str`, which strips `refs/heads/`.

- [ ] **Step 1: Failing tests:**
  - `clip_names_the_rest`: 5000 × `a` with max 4000 → it ends with `… 1000 more characters: wi_view id=1 full=true`.
  - `clip_is_char_safe`: 4001 × `ü`.
  - `html_to_text_keeps_lists`: `<p>Do</p><ul><li>a &amp; b</li><li>c</li></ul>` → `"Do\n- a & b\n- c"`.
  - `cut_reports_more`: 21 items with limit 20 → 20, `true`.
  - `ref_name_strips_heads`.
  - `date_short`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit**: `"Add the plain-text output helpers."`

### Task 6: Pull request reads

**Files:** Create `src/pr.rs`, `tests/pr.rs`, and fixtures `pr-list.json`, `pr.json`, `pr-threads.json`,
`policy-evaluations.json`, `pr-workitems.json`, `wi-batch.json`, `builds-one.json`, `builds-empty.json`,
`iterations.json`, `iteration-changes-p1.json`, `iteration-changes-p2.json`. Modify `tools.rs` to add 4 read tools.

**Interfaces** (every function is `-> Result<String, ApiError>`, and every args struct has optional `project`,
`repo` and `branch`):

- `pr_list(ctx, &PrListArgs { status, creator, reviewer, source, target, limit })`.
  - `status` is active, completed, abandoned or all; default active.
  - `creator` and `reviewer` resolve through `Ctx::user`.
  - `…/git/repositories/{repo_id}/pullrequests` with `searchCriteria.*` and `$top=limit+1`.
  - Line: `!{id}  {status}{ draft}  {source} → {target}  "{title}"  {author}  {n} approvals{, rejected}`.
  - When more exist, `more("pr_list limit={2×limit}")`.
- `pr_view(ctx, &PrViewArgs { id: Option<u32>, full })`.
  - With no id, the active PR with `sourceRefName = refs/heads/{branch}`. None found:
    `no active PR for branch {b}`.
  - Then `tokio::join!` over:
    - policy evaluations at `V71_P1`, with `artifactId=vstfs:///CodeReview/CodeReviewId/{project_id}/{id}`
    - the PR's work items, then a batch get of their titles
    - the latest run: builds with `branchName=refs/pull/{id}/merge`, `queryOrder=queueTimeDescending`, `$top=1`;
      if empty, the same with `refs/heads/{source}`
  - Sections, in order:
    - header line
    - `reviewers:` with `{name}: approved|approved with suggestions|waiting|rejected|no vote` (10/5/-5/-10/0), plus
      ` (required)`
    - `checks:` with `{policy display name}: {status}`
    - `work items:` with `#{id} {type} {state} "{title}"`
    - `latest run:` with `#{id} {pipeline} {result or status} {date}`, or `none`
    - the description, clipped at `DESC_MAX` with `pr_view id={id} full=true`
- `pr_threads(ctx, &PrThreadsArgs { id, all, limit })`.
  - `fn is_system(t: &Thread) -> bool` is true when every comment's `commentType` is `system` or missing, or the
    thread's `properties` has `CodeReviewThreadType`.
  - Deleted comments and empty threads are dropped. Without `all`, only active and pending threads are shown.
  - Thread line: `#{tid} {status}  {path}:{line}`. The line comes from `rightFileStart.line`, else
    `leftFileStart.line`, and the location is omitted without a `threadContext`.
  - Comment line: `   {author}: {content}`, each clipped at 2000.
  - At most `limit` threads (default 20), with `more("pr_threads id={id} limit={2×limit}")`.
  - Footer: `{n} resolved threads hidden: pr_threads id={id} all=true`.
  - `pub(crate) async fn resolve_pr(ctx, scope, id: Option<u32>) -> Result<Pr, ApiError>` is shared with Task 9.
- `pr_files(ctx, &PrFilesArgs { id })`.
  - The last iteration's changes with `$top=2000`, following the body's `nextSkip` until done or 2000 files.
  - Lines: `{changeType}  {path}`; past 2000, `more("git diff {target}...{source} --stat")`.
  - Last line: `diff: git diff {target}...{source}`.

- [ ] **Step 1: Failing tests:**
  - `list_one_line_each`: lines start `!412 ` and `!409 `, and nothing contains `http`.
  - `list_more_line`: the fixture has 3 PRs, limit 2 → 2 lines plus `… more: pr_list limit=4`; the request had
    `$top=3`.
  - `list_reviewer_by_name`: `reviewer=jane` → `searchCriteria.reviewerId={fixture id}`.
  - `view_by_branch`: branch `feature/login-retry` → PR 412.
  - `view_sections`: contains `J. Doe: approved (required)`, `checks:`, `#77 Bug Active` and `latest run: #991`.
  - `view_run_falls_back_to_source`: the merge-ref query is empty → the second query is
    `refs/heads/feature/login-retry`.
  - `view_concurrent`: the 3 joined routes each delay 300 ms → the call takes under 800 ms.
  - `threads_hide_system_and_resolved`: system 1, VoteUpdate 1, fixed 1, active 2 → 2 shown and
    `1 resolved threads hidden`.
  - `thread_location`: `#7 active  src/auth.rs:88`.
  - `files_follow_next_skip`: two pages → all files, and it ends with `diff: git diff main...feature/login-retry`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Register the 4 tools with `annotations(read_only_hint = true)`; the
      argument structs derive `Deserialize, JsonSchema` with `#[schemars(crate = "schemars")]`.
- [ ] **Step 5: Commit**: `"Add the pull request read tools."`

### Task 6a: Move onto azure_devops_rust_api

Deviation D1 (flow.md). Tasks 3, 4 and 6 keep their behaviour and tests; what changes is who builds the requests and
whose structs read the answers.

**Files:** Modify `Cargo.toml`, `Cargo.lock`, `src/main.rs`, `src/api.rs`, `src/ctx.rs`, `src/pr.rs`,
`tests/api.rs`, `tests/ctx.rs`, `tests/pr.rs` and `tests/fixtures/*.json`. Create `tests/fixtures.rs`.

**Interfaces:**

- `Cargo.toml`: `azure_devops_rust_api = { version = "=0.39.1", default-features = false, features = ["git",
  "build", "pipelines", "policy", "wit", "core", "ims"] }` and `azure_core = "=1.1.0"`. `rustls` stays only for the
  certificate-error check in the `source()` chain (`default-features = false, features = ["std"]`); the ring install
  in `main.rs` goes.
- `Api` gains one client per area, built once in `Api::new` and cloned freely: `pub git: git::Client`, `build`,
  `pipelines`, `policy`, `wit`, `core`, `ims`, and `pub org: String` (the collection name). Each is built with:
  - `.endpoint(base)`, where `base` is `ADO_ORG_URL` without its collection segment and trailing `/`
    (`https://server/tfs`). Every call passes `org` as the crate's `organization`.
  - `Credential::from_pat(pat)`.
  - `.transport(Transport::new(Arc::new(client.clone())))`: our client, so timeouts, no redirects and
    `X-TFS-FedAuthRedirect: Suppress` hold for crate calls too.
  - `.retry(RetryOptions::none())`.
  - `.per_try_policies(vec![guard])`. The guard is an azure_core `Policy` that:
    - fails a request whose URL doesn't start with `ADO_ORG_URL` before it reaches the transport, so the PAT goes
      nowhere else;
    - turns a 203 with an HTML body into the 401 line.
- `ApiError::from_az(e: azure_core::Error) -> ApiError`, mapping to the same lines as Task 3:
  - `ErrorKind::HttpResponse` → the status lines, with `tf` and the message parsed from the raw body as now.
  - `ErrorKind::DataConversion` → `unexpected answer from the server: {serde message}` (it names the field).
  - Anything else → walk `source()` to the `reqwest::Error` and use the existing timeout, connect and TLS lines.
- `Api::az(&self, f)` runs a crate call (`f: impl Fn() -> Fut`, so it can be called twice) and adds Task 3's
  single `Retry-After` wait on 429. Builders' `.send()` and `.into_raw_response()` give the raw answer where a model
  doesn't fit.
- `get`, `get_text` and `send` stay for `/vsts/info` and `connectionData` only. Anything else hand-written needs a
  one-line comment saying which crate model or call failed, and is reported as a deviation.
- `Ctx`: an explicit repo → `git.repositories_client().get_repository`; a project alone →
  `core.projects_client().get`; `user` → `ims` identities; `pipeline_id` → `build.definitions_client().list` with
  `name`. `me` and `/vsts/info` stay hand-written.
- `pr.rs`: every call through the crate (pull requests, threads, iterations and changes, work-item refs, policy
  evaluations, builds, work items batch). Our response structs go; `resolve_pr` returns `git::models::GitPullRequest`.
  The output lines stay byte for byte.

- [ ] **Step 1: Fixtures fit the models.** `tests/fixtures.rs::fixtures_fit_models` deserializes every fixture into
  the crate model its route returns (a table of file → type) and fails naming the file and field. Fill the fixtures
  until it passes, with values shaped like a 2022.2 answer (Learn's 7.1 samples), not just the minimum.
- [ ] **Step 2: Failing tests:**
  - `sends_auth_version_and_suppress` (Task 3): asserts `api-version=7.1-preview` on a crate call; Basic auth and
    the Suppress header unchanged.
  - `root_hosted_collection`: `ADO_ORG_URL={base}/Coll/` → the logged path starts `/Coll/` and contains no `//`.
  - `missing_field_names_it`: a fixture without a field the model requires → `isError`, and the text starts
    `unexpected answer from the server` and names the field.
  - `no_resend_on_503`: a 503 → exactly one request logged.
  - `guard_refuses_outside_org` (unit, in `api.rs`): a request to another host through the guard → `Err`, nothing
    sent.
- [ ] **Step 3: Implement.** All tests from Tasks 2–6 pass unchanged, apart from the version assertions above.
- [ ] **Step 4:** `cargo test`, `cargo clippy --all-targets -- -D warnings`, and `cargo tree -d -i reqwest` shows one
  version.
- [ ] **Step 5: Commit**: `"Move the Azure DevOps calls onto Microsoft's azure_devops_rust_api crate."`

**From here on (Tasks 7–10):** where a task names an endpoint, that names the call: make it through the crate's
client in `ctx.api` with `Api::az`, and read the crate's model. Query parameters named in a task are the builder's
methods of the same name. `V71_P4` is gone: work-item comments go through `wit.comments_client()`. A fixture a task
adds joins the `fixtures_fit_models` table.

### Task 7: Work item reads

**Files:** Create `src/wi.rs`, `tests/wi.rs`, and fixtures `wi.json`, `wi-comments.json`, `wiql.json`. Modify
`tools.rs`.

**Interfaces:**

- `wi_view(ctx, &WiViewArgs { project, id: u32, full })`.
  - `_apis/wit/workitems/{id}?$expand=relations` and comments
    `{project}/_apis/wit/workItems/{id}/comments?$top=5&order=desc`, concurrently.
  - Lines:
    - `#{id} {type} {state}  "{title}"`
    - `assigned: {name or nobody}  area: {area}  iteration: {iteration}`
    - `parent: #{id}` and `children: #a, #b`, from the Hierarchy-Reverse/-Forward relations
    - `PRs: !{id}…`, from `ArtifactLink` relations whose url contains `PullRequestId`
    - the description and `acceptance criteria:`, both through `html_to_text`, then `clip`
    - `comments:` with `{date} {author}: {html_to_text(text)}`, plus `… {totalCount-5} older comments` when there
      are more
- `wi_query(ctx, &WiQueryArgs { project, wiql, assigned, state, r#type, title, limit })`.
  - Without `wiql`, it builds `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project` plus `AND`
    filters: `assigned` is `me` → `[System.AssignedTo] = @Me`, otherwise the name; `title` → `CONTAINS`. `'` is
    doubled.
  - `POST {project}/_apis/wit/wiql?$top={limit+1}`.
  - The batch get comes in chunks of 200 ids with `errorPolicy=omit` and
    `fields=System.Id,System.WorkItemType,System.State,System.Title,System.AssignedTo`.
  - Line: `#{id} {type} {state}  "{title}"  {assignee}`, plus `more("wi_query … limit={2×limit}")`.

- [ ] **Step 1: Failing tests:**
  - `view_lines`: contains `#123 Bug Active`, `parent: #100` and `PRs: !412`, the description as text, and a comment
    without tags.
  - `query_filters_build_wiql`: the request body contains `[System.AssignedTo] = @Me` and `'O''Brien'`.
  - `query_raw_wiql_passthrough`.
  - `query_more_line`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register as read tools).
- [ ] **Step 5: Commit**: `"Add the work item read tools."`

### Task 8: Pipeline reads and repo_list

**Files:** Create `src/pipeline.rs`, `tests/pipeline.rs`, and fixtures `builds.json`, `timeline.json` (Stage →
Phase → Job → Task, with one Task `skipped` and no log, and one Job `failed` with no failed Task but `issues`),
`logs.json` (with `lineCount`), `log.txt` (CRLF, ANSI, `##[group]`, `##[error]`) and `repos.json`. Modify `tools.rs`.

**Interfaces:**

- `pipeline_runs(ctx, &RunsArgs { project, pipeline, branch, pr: Option<u32>, result, limit })`.
  - `{project}/_apis/build/builds` with `definitions` (from `pipeline_id`), `branchName` (`refs/heads/…` or
    `refs/pull/{pr}/merge`), `resultFilter`, `queryOrder=queueTimeDescending` and `$top=limit+1`.
  - Line: `#{id} {pipeline}  {branch}  {result or status}  {date}  {duration}`.
- `pipeline_view(ctx, &RunArgs { project, run: u32 })`.
  - From the timeline: children by `parentId`, ordered by `order`. Phase records aren't printed: their Jobs show at
    the Stage's child level.
  - Lines: `{name}: {result} {duration}` for each Stage, and indented for each Job.
  - Then `issues:` with `{type} {message}`.
- `pipeline_log(ctx, &LogArgs { project, run: u32, step, full, start })`.
  - Targets: `step` matches a Task name (case-insensitive). Otherwise the Tasks with `result == failed`. Otherwise
    the failed Jobs, which print `{job}: failed with no failed step` and their issues.
  - The log comes from `{project}/_apis/build/builds/{run}/logs/{log.id}` via `get_text`.
  - `fn clean_log(raw: &str) -> Vec<(bool, String)>`:
    - strips a leading ISO timestamp, ANSI CSI and `\r`
    - drops the `##[group]`, `##[endgroup]`, `##[section]` and `##[command]` prefixes
    - `##[error]x` → `(true, "ERROR x")` and `##[warning]x` → `(false, "WARNING x")`
  - `fn excerpt(lines) -> String`: the error lines with ±5 context, merged, with `…` between gaps, then
    `--- last 50 lines ---` and the tail.
  - A Task with no `log`: `{step}: no log ({result})`.
  - `full`: `startLine=start` (default 1) and `endLine=start+1999`. When `logs.json`'s `lineCount` for that log is
    past `endLine`, it appends `more("pipeline_log run={run} step=\"{step}\" full=true start={endLine+1}")`.
- `repo_list(ctx, &ProjectArgs { project })`, with lines `{name}  default: {ref_name(defaultBranch)}`.

- [ ] **Step 1: Failing tests:**
  - `clean_strips_noise`: no timestamp, no `\x1b`, no `##[group]`; it contains `ERROR boom`.
  - `excerpt_context_and_tail`.
  - `log_crlf_and_missing_log`: a clean CRLF log, and `Publish: no log (skipped)`.
  - `job_failed_without_step`: `Deploy: failed with no failed step`, plus the job's issue text.
  - `log_full_paged`: `lineCount` 2500 → `start=2001`.
  - `view_tree_skips_phase`: `Build: failed` and `  Test: failed`, with no Phase name printed.
  - `runs_by_pr_uses_merge_ref`.
  - `repo_list_lines`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register 4 read tools).
- [ ] **Step 5: Commit**: `"Add the pipeline read tools and repo_list."`

### Task 9: Pull request writes

**Files:** Modify `src/pr.rs`, `tests/pr.rs` and `tools.rs`. Add fixtures `repo.json`, `pr-409.json` (TF401179) and
`pr-complete.json` (`status: active`, `mergeStatus: queued`).

**Interfaces** (each returns one line naming what changed and the id):

- `pr_create(ctx, &PrCreateArgs { title, description, target, draft, reviewers: Option<Vec<String>>, work_items:
  Option<Vec<u32>> })`.
  - The source is `branch` or the scope branch. The target defaults to the repo's `defaultBranch`.
  - Reviewers go through `Ctx::user`.
  - A TF401179 error looks up the active PR for that source and target, and returns
    `!{id} already exists for {source} → {target}` as a tool error.
  - → `created !{id} {source} → {target}{ (draft)}`.
- `pr_update(ctx, &PrUpdateArgs { id, title, description, draft, status })`. `status` is abandoned or active, and
  only the given fields are PATCHed. → `updated !{id}: {fields}`.
- `pr_comment(ctx, &PrCommentArgs { id, text, file, line })`.
  - `file` and `line` must come together; otherwise `file and line go together`. `line` 0 → `line starts at 1`.
  - The thread has `status: active`, comment type `text`, and `threadContext` with `filePath: "/{file}"` and
    `rightFileStart`/`rightFileEnd` `{line, offset: 1}`.
  - → `commented on !{id} as thread #{t}`.
- `pr_reply(ctx, &PrReplyArgs { id, thread: u32, text })`, with `parentCommentId: 1`. →
  `replied on !{id} thread #{t}`.
- `pr_thread_status(ctx, &PrThreadStatusArgs { id, thread, status })`. `status` is active, fixed, wontFix, closed,
  byDesign or pending. → `thread #{t} on !{id} is now {status}`.
- `pr_vote(ctx, &PrVoteArgs { id, vote })`. `vote` is approve, approve-with-suggestions, wait, reject or reset. It
  PUTs `…/reviewers/{me.id}` with 10, 5, -5, -10 or 0. → `voted {vote} on !{id}`.
- `pr_complete(ctx, &PrCompleteArgs { id, strategy, delete_source, transition_work_items, auto })`.
  - `strategy` is squash, noFastForward, rebase or rebaseMerge; default squash _(my call)_. `delete_source` and
    `transition_work_items` default to true.
  - With `auto`, it PATCHes `autoCompleteSetBy: {id: me}` and `completionOptions` → `auto-complete set on !{id}`.
  - Otherwise it PATCHes `status: completed`, `lastMergeSourceCommit` and `completionOptions`. The output comes from
    the response: `completed !{id} ({strategy})` when `status == completed`, otherwise
    `completion queued for !{id} ({strategy}, merge {mergeStatus})`.
  - No body ever has `bypassPolicy`.

- [ ] **Step 1: Failing tests:**
  - `create_defaults_and_reviewers`.
  - `create_conflict_names_pr`: TF401179 → `!412 already exists for feature/x → main`.
  - `comment_anchor`: the body has `"/src/auth.rs"` and `{"line":88,"offset":1}`.
  - `comment_line_needs_file`.
  - `vote_values`: `reject` → `-10` at `/reviewers/{me}`.
  - `complete_queued`: `completion queued for !412 (squash, merge queued)`.
  - `complete_never_bypasses`: no request body anywhere contains `bypassPolicy`, and the body has
    `"deleteSourceBranch":true`.
  - `update_only_given_fields`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register the 7 tools without `read_only_hint`).
- [ ] **Step 5: Commit**: `"Add the pull request write tools."`

### Task 10: Work item and pipeline writes

**Files:** Modify `src/wi.rs`, `src/pipeline.rs`, `tests/wi.rs`, `tests/pipeline.rs` and `tools.rs`.

**Interfaces:**

- `wi_create(ctx, &WiCreateArgs { project, r#type, title, description, assigned, parent })`.
  - JSON Patch POST to `{project}/_apis/wit/workitems/${type}`, with `add` ops on `/fields/System.Title`,
    `/fields/System.Description` and `/fields/System.AssignedTo`.
  - The parent is a `/relations/-` op with `rel: System.LinkTypes.Hierarchy-Reverse` and url
    `{org_url}_apis/wit/workItems/{parent}`.
  - → `created #{id} {type} "{title}"`.
- `wi_update(ctx, &WiUpdateArgs { project, id, state, assigned, title, fields: Option<BTreeMap<String,
  serde_json::Value>> })`. `fields` keys go to `/fields/{key}` verbatim. → `updated #{id}: {field names}`.
- `wi_comment(ctx, &WiCommentArgs { project, id, text })`. → `commented on #{id}`.
- `pipeline_run(ctx, &PipelineRunArgs { project, pipeline, branch, parameters: Option<BTreeMap<String, String>> })`.
  - POST `{project}/_apis/pipelines/{id}/runs` with `resources.repositories.self.refName` and
    `templateParameters`.
  - → `queued run #{id} of {pipeline} on {branch}`.
- `pipeline_cancel(ctx, &RunArgs)`, a PATCH of `{project}/_apis/build/builds/{run}` with
  `{"status":"cancelling"}`. → `cancelling run #{run}`.

- [ ] **Step 1: Failing tests:**
  - `create_json_patch`: content type `application/json-patch+json`, with ops for title and parent.
  - `update_custom_field`.
  - `comment_preview_version`.
  - `run_ref_and_params`.
  - `cancel_body`.
- [ ] **Step 2–4:** FAIL → implement → PASS (register 5 write tools).
- [ ] **Step 5: Commit**: `"Add the work item and pipeline write tools."`

### Task 11: The tool surface end to end

**Files:** Modify `tests/mcp.rs` and `tools.rs` (remove `ping`).

- [ ] **Step 1: Test `tools_and_marks`.**
  - The sorted `tools/list` names equal the 22 tools of spec goal 2.
  - The reads have `readOnlyHint == true` and no `requiresUserInteraction`.
  - Each `WRITES` name has `_meta["anthropic/requiresUserInteraction"] == true` and no `readOnlyHint`.
  - Every description is under 400 characters.
- [ ] **Step 2: Test `errors_are_tool_errors_without_pat`.** Every tool called against a fake server that answers
      401 gives `isError` and the 401 line, and the full stdout never contains `test-pat`.
- [ ] **Step 3:** Run; fix the gaps it finds; PASS.
- [ ] **Step 4: Commit**: `"Pin the ado-mcp tool list, permission marks and error results."`

### Task 12: Release build and Nix

**Files:**

- Create: `.github/workflows/build-ado-mcp.yml`, a copy of `build-web-mcp.yml` with every `web-mcp` → `ado-mcp`.
- Modify: `.github/workflows/release.yml`:
  - an `ado-mcp:` job like `:74-75`, and in `publish.needs` at `:78`
  - the comments at `:4` and `:87`
  - the notes at `:101-102`: `ado-mcp-*: the binary behind the mcp-azure plugin, for Windows and Linux x64; the
    installer downloads yours`
- Modify: `flake.nix`: an `adoMcp` `importTOML` and an `ado-mcp` `buildRustPackage` like `:98-109`, with
  `nativeCheckInputs = [pkgs.git]` and `checkType = "debug"` (for the `ADO_TIMEOUT_MS` hook).

- [ ] **Step 1:** `nix build .#ado-mcp` where nix is available. Otherwise
      `cargo build --release --locked && ./target/release/ado-mcp --version`.
- [ ] **Step 2:** `npm test`: PASS.
- [ ] **Step 3: Commit**: `"Build and release ado-mcp with the other binaries."`

### Task 13: mcp-azure plugin and installer

**Files:** Modify `plugins/opt-in/mcp/mcp-azure/.claude-plugin/plugin.json`, `.mcp.json`, `installer/core.mjs`,
`ui.mjs`, `view.mjs`, `install.mjs`, `core.test.mjs`, `ui.test.mjs` and `view.test.mjs`.

**Plugin:**

- `plugin.json`:
  - Drop `ado_api_version`.
  - Add `binPath` (`type string`, title `ado-mcp binary`, description
    `Path to the ado-mcp binary. Default: ado-mcp on PATH.`, default `ado-mcp`).
  - `description`: `Azure DevOps Server tools for Claude: pull requests, work items and YAML pipelines, through the
    ado-mcp binary (self-hosted, PAT auth). Writes always ask first.`
  - `ado_pat` description: `PAT with Code (Read & Write), Work Items (Read & Write), Build (Read & Execute), Project
    and Team (Read).`
- `.mcp.json`: `{"mcpServers":{"ado":{"command":"${user_config.binPath}","env":{"ADO_ORG_URL":
  "${user_config.ado_org_url}","ADO_PAT":"${user_config.ado_pat}","ADO_DEFAULT_PROJECT":
  "${user_config.ado_default_project}","ADO_PROJECT_DIR":"${CLAUDE_PROJECT_DIR}"}}}}`.

**Installer interfaces (`core.mjs`):**

- `BIN_PLUGINS['mcp-azure'] = { name: 'ado-mcp', key: 'binPath' }`.
- `export const SELF_CONFIGURED = ['mcp-azure']`. These are left out of `tokenPlugins` when building the plan and
  `data.tokens`, so `planPlugins` and `view.mjs:306` stay unchanged.
- `export function configPrompts(userConfig, binKey, configuredKeys)`. It returns
  `[{ key, title, description, secret, required, saved }]` in manifest order, minus `binKey`. `saved` is
  `configuredKeys.includes(key)`.
- `export function configValues(prompts, answers)`. It returns `{ values, missing }`: the non-empty trimmed
  answers, with an empty answer to a `saved` prompt left out (it keeps its value); `missing` is the required,
  unsaved keys with empty answers.
- `export function selfConfigure({ installed, configuredKeys, requiredKeys })`. It returns `'prompt'` when the
  plugin isn't installed or a required key isn't configured, otherwise `'skip'`.
- `export const configureArgs = (id) => ['plugin', 'configure', id, '--values-stdin']`.

**`ui.mjs`:** `export async function secret(message, io = STD)`. It calls `line()` with an output wrapper that writes
the prompt and drops everything else, so the typed text is never echoed.

**`install.mjs`, I/O only:**

- For each selected `SELF_CONFIGURED` id: when installed, read `claude plugin configure {id} --json` (`configured`).
  - If `selfConfigure(...)` gives `'prompt'`, ask each `configPrompts` entry with `line()` or `secret()`. A saved
    entry shows `(saved, Enter keeps)`.
  - If `missing` isn't empty and the plugin isn't installed: skip it and print `HANDOFF[name]` after the summary.
- Install when needed (the existing install loop).
- Then `applyBin(name, id, values)`, whenever the plugin is selected (installed or not), like
  `install.mjs:696-697`. `applyBin` gains `extra = {}`:
  - it sends `{...extra, [key]: bin}` in one `claude(JSON.stringify(...), ...configureArgs(id))`
  - on `skip` (on PATH) with a non-empty `extra`, it sends `extra` alone
  - its failure line for this call never includes `r.err`:
    `{plugin}: could not save its settings; run /plugin configure {id} in Claude Code`
- `install.mjs:370`: the crate folder becomes `crates/${name}`.
- `option()` (`:569-572`): for `SELF_CONFIGURED`, the note is `asks for the token`.
- `HANDOFF['mcp-azure']` (`:454-458`): the API-version line is dropped and the scopes updated.

- [ ] **Step 1: Failing tests:**
  - `core.test.mjs`:
    - `configPrompts` keys equal `['ado_org_url','ado_pat','ado_default_project']`; only `ado_pat` is secret; `saved`
      follows `configuredKeys`.
    - `configValues`: an empty unsaved PAT → `missing` is `['ado_pat']`; an empty saved PAT → left out of `values`
      and not missing.
    - `selfConfigure`: not installed → `prompt`; installed with all required keys configured → `skip`; installed
      with `ado_pat` unconfigured → `prompt`.
    - `configureArgs('mcp-azure@x')` contains no value from the answers.
    - The `BIN_PLUGINS` test map (`:388-392`) gains `'mcp-azure': 'plugins/opt-in/mcp/mcp-azure'`, and the
      `binAsset` loop covers `ado-mcp`.
  - `ui.test.mjs`: `secret()` with a fake io fed `hunter2\r` resolves to `hunter2`, and the captured output contains
    the prompt but not `hunter2`.
  - `view.test.mjs`: with mcp-azure selected and not in `tokens`, the review line has no `finish in Claude Code`.
- [ ] **Step 2:** `node --test installer/`: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`: PASS. If `claude` is on PATH, `claude plugin validate plugins/opt-in/mcp/mcp-azure`
      passes.
- [ ] **Step 5: Commit**: `"Let the installer install and configure mcp-azure with the ado-mcp binary."`

### Task 14: Docs

**Files:**

- Create: `plugins/opt-in/mcp/mcp-azure/README.md`:
  - what it does
  - install (the installer, or by hand: `/plugin install` plus the `binPath`)
  - the PAT scopes
  - the 10 read tool names `mcp__plugin_mcp-azure_ado__…`, to allow with "don't ask again"
  - writes always prompt (Claude Code ≥ 2.1.214)
  - limits: one server and collection, API 7.1, YAML pipelines only, Windows and Linux x64 only
  - **Upgrading from the npm server:**
    - re-run the installer, or set `binPath`
    - old `mcp__plugin_mcp-azure_azure-devops-server__*` allow rules no longer match
    - the `ado_api_version` setting is gone
- Modify:
  - `.claude-plugin/marketplace.json:56`: the plugin.json description plus ` Opt-in.`
  - `THIRD_PARTY.md:22-26`: drop the tiberriver256 line and mcp-azure from the heading
  - `README.md:13-16` and its mcp-azure mention
  - `CLAUDE.md`:
    - `:22` → three Rust crates, naming `ado-mcp` (mcp-azure's server)
    - `:39`: mcp-azure is no longer "configs only"
    - a layout bullet for `crates/ado-mcp`, including the `ADO_TIMEOUT_MS` test hook
    - the release (`:100`), checks (`:108-109`) and CI (`:121-122`) lists
- Modify: `release.yml`'s notes line, which mentions re-running the installer after updating mcp-azure.

- [ ] **Step 1:** `npm test`: PASS.
- [ ] **Step 2: Commit**: `"Document mcp-azure's new server and the upgrade from the npm one."`

### Task 15: Smoke checklist

**Files:** Create `docs/features/ado-mcp/smoke.md`. Each step ends with "paste back: …", which is only outputs and
error lines, never raw JSON.

1. **Install.** Run the installer, tick mcp-azure, and enter the URL, PAT and project.
   - Paste back the mcp-azure summary lines.
   - If the old npm version was installed, also paste back whether Claude Code warned about the removed
     `ado_api_version` setting.
2. **Connection.** In a clone, `repo_list`. This covers TLS through ESET, the PAT and `7.1-preview`; a version error
   means 7.0 is needed.
3. **Remote resolution.** `pr_list` with no arguments in the clone, then in a worktree with `branch`.
4. **Reads** on a real PR, work item and failed run: `pr_view`, `pr_threads`, `pr_files`, `wi_view`,
   `wi_query assigned=me`, `pipeline_runs`, `pipeline_view` and `pipeline_log`. Paste back anything noisy or wrong.
   - An `unexpected answer from the server: missing field …` line means a crate model the server doesn't satisfy
     (D1). Paste back the line and the tool; the fix is a small struct of ours for that call.
5. **Writes**, on scratch items only. Run each write tool once on a scratch branch, PR and work item.
   - Confirm that the prompt appeared every time, including in auto mode.
   - Clean up with `pr_update status=abandoned`.
6. **Minimal PAT.** Use only the README's scopes and repeat steps 2 and 5. Paste back any 403 line.

- [ ] **Step 1:** Write the file and link it from flow.md Artifacts.
- [ ] **Step 2: Commit**: `"Add the ado-mcp smoke checklist for the user's server."`

---

## Self-review notes

- **Spec coverage:**
  - Goals 1–2 → Tasks 1, 6–10; goal 3 → Task 1; goal 4 → Task 5 and each tool task.
  - Goal 5 → Tasks 2 and 4; goal 6 → Tasks 4 and 6 (`view_concurrent`); goal 7 → Task 3; goal 8 → Task 3.
  - Goal 9 → Tasks 13 and 14; goal 10 → every task, CI in Task 1; goal 11 → Task 15.
- **Tool count:**
  - Reads (10): `pr_list`, `pr_view`, `pr_threads`, `pr_files`, `wi_view`, `wi_query`, `pipeline_runs`,
    `pipeline_view`, `pipeline_log`, `repo_list`.
  - Writes (12): `pr_create`, `pr_update`, `pr_comment`, `pr_reply`, `pr_thread_status`, `pr_vote`, `pr_complete`,
    `wi_create`, `wi_update`, `wi_comment`, `pipeline_run`, `pipeline_cancel`.
  - 22 in all.
- **Type consistency:** `Scope`, `Me`, `ApiError`, `resolve_pr`, `Ctx::user` and `configureArgs` are defined once
  and used under those names.
- **Spec amendment:** `pr_view`'s latest run (the merge ref, then the source branch) and the SSH and host rules,
  accepted 2026-10-18 at plan review round 1. My calls: the 400-character description cap and `squash` as the
  default merge strategy.
- **Verified against Claude Code 2.1.302** (flow.md, Plan review round 1):
  - a headless `plugin install` leaves the settings unset
  - `configure --values-stdin` merges with the saved settings
  - `configure --json` lists the configured keys
