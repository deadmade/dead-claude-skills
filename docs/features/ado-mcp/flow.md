---
phase: execute
---

# ado MCP server: flow

## Request

"Lets design this idea properly" (/feature-flow), after a chat that settled the idea: a Rust CLI `ado`, like `gh`,
for a self-hosted Azure DevOps Server, so Claude Code can do everyday dev work there without curl or a third-party
MCP server.

## Artifacts

- Spec: [spec.md](spec.md) (draft, builder check done 2026-10-18)
- Plan: [plan.md](plan.md) (2026-10-18)
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md), section "Azure DevOps (mcp-azure)"

## Gates

- Gate 1, spec approved: 2026-10-18 ("approved"). ADR 0002 offered, not taken up.
- Gate 2, plan approved: 2026-10-18 ("approved, subagent-driven"), plan revision 2, execution: subagent-driven
- Gates 1 and 2 again for D1: 2026-10-18 ("I approve"), spec revised, plan revision 3

## Deviations

- **D1, 2026-10-18: use Microsoft's `azure_devops_rust_api` crate at runtime** (reverses the Options line "No Microsoft
  `azure_devops_rust_api` crate"). Raised by the user after Task 6: hand-written calls mean writing the API contract
  ourselves, and Microsoft no longer publishes the OpenAPI specs (MicrosoftDocs/vsts-rest-api-specs is gone). The
  user's words: "lets just use the crate for now. Dont want to reverse engineer the api".
  - Options: 1, the crate's clients and models at runtime; 2, the crate's models in tests only, calls stay ours.
    Recommended 1; the user picked **1** ("1").
  - Spike (0.39.1, against a local server, 2026-10-18):
    - `.endpoint("https://server/tfs")` with organization `Coll` gives `/tfs/Coll/My%20Proj/_apis/...`.
    - `Credential::from_pat` sends `Authorization: Basic base64(":" + pat)`.
    - `.transport()` takes our own `reqwest::Client`, so our timeouts, no-redirect policy and default headers stay.
    - azure_core 1.1 uses the same `reqwest =0.13.5` and the platform verifier, so ESET is unchanged.
    - A failed call keeps the status and the raw body, so the `TF…` message and our one-line errors still work.
    - Every call sends `api-version=7.1-preview`.
  - Costs:
    - The models are strict: one field the crate marks required and the server leaves out fails the whole call
      ("missing field `project`", seen with our trimmed fixtures). Only the smoke test on 2022.2 shows how often.
    - The crate forces azure_core's default features, so aws-lc-rs (C code) is compiled in. Release build 3 min
      instead of 1.5; a one-call spike binary is 6.8 MB against our 5.4 MB.
    - Tasks 3, 4 and 6 (done) are partly reworked.
  - Kept: the remote and collection check before any request, the PAT only to `ADO_ORG_URL`, one-line errors,
    output shaping, the write prompts, the cache, the installer and plugin work.
  - Decision: 2026-10-18, spec and plan revision 3 approved ("I approve").
- **D2, 2026-10-18: three places where the crate falls short** (found in Task 6a, confirmed against the crate's
  source in review).
  - `pr_list status=all`: `PullRequestStatus` has no `All` and the builder takes no extra query, so that one request
    is built by hand (still read into the crate's `GitPullRequestList`).
  - `pr_threads`: the crate's `PropertiesCollection` drops property names, and `CodeReviewThreadType` is how system
    threads are hidden, so the raw body is parsed for that field too.
  - Work-item titles in `pr_view`: the batch call exists only per project, so it is sent with an empty project
    (linked items can live in other projects) and the guard drops the empty segment.
  - Options: A, keep these three; B, replace `status=all` with three crate calls merged (worse ordering and paging).
    Recommended A.
  - Decision: 2026-10-18, A ("yes, keep them").
- **D3, 2026-10-18: build logs read raw** (Task 8). The crate's `get_build_log` reads the answer as a JSON string,
  but the server sends plain text, so `pipeline_log` reads the raw body of the same crate call (guard and error lines
  unchanged). Options: A, the raw read; B, none that works without patching the crate. Recommended A.
  - Decision: 2026-10-18, A ("yes, keep the raw log read").

## Skipped

## Grounding

Written for the CLI design. With the MCP-only choice, read `crates/ado` as `crates/ado-mcp` and
`plugins/opt-in/ado` as the existing `plugins/opt-in/mcp/mcp-azure`.

Shipping a third binary follows web-mcp's path:

- **Crate.** `crates/ado` with its own `Cargo.lock` (there is no workspace).
  - `[package]` matches web-mcp: `version` equal to package.json, edition 2024, `rust-version = "1.97"`, MIT,
    `publish = false`.
  - Lints and release profile as web-mcp: clippy pedantic (`crates/web-mcp/Cargo.toml:48-49`) and the release
    profile (`:51-54`).
  - `--version` must print `<name> <version>`: `installer/install.mjs:316-321` parses it, and CI smoke-tests it.
- **TLS can be reused.** web-mcp builds reqwest `=0.13.5` with `rustls-no-provider` and installs ring by hand
  (`crates/web-mcp/src/main.rs:43`, client in `src/fetch.rs:98-108`). Its lock file pulls in
  `rustls-platform-verifier` (`Cargo.lock:3057`), which uses the OS trust store, so ESET's root should verify on
  Windows. Inferred from the lock file, not tested.
- **CI and release.**
  - Copy `build-web-mcp.yml` and `web-mcp.yml`.
  - `release.yml`: add an `ado:` job (`:74-75`), add it to `publish.needs` (`:78`), and add a notes line
    (`:101-102`).
- **Installer.**
  - `installer/core.mjs`: an `ado` entry in `BIN_PLUGINS` (`:347-350`) and on the `tools` category page (`:418`).
  - `installer/install.mjs`: an `ado@` constant with its `applyBin` call (`:312`, `:703`), and the hardcoded crate
    folder fixed at `:370`.
  - `installer/core.test.mjs`: the opt-ins list (`:63-91`) and the `BIN_PLUGINS` folders (`:381-392`).
- **Version sync.** A `CRATES` entry in `scripts/check-repo.mjs` (`:73-76`), a `scripts/release.mjs` entry
  (`:43-46`), and a `marketplace.json` entry. `scripts/plugin-dirs.mjs` picks up `plugins/opt-in/ado` by itself.
- **Nix.** One `buildRustPackage` block in `flake.nix`, like `:98-109`.
- **Docs.** README "tools" sentence (`:13-16`) and the plugin's own README. CLAUDE.md: "the two Rust crates" (`:22`),
  the layout list, the release and CI lists, and the per-crate check commands.
- **Open: how Claude finds the binary.**
  - `applyBin` (`install.mjs:359-386`) puts a downloaded binary in `~/.claude/bin`, which is not on PATH, and sets
    the plugin's `binPath`.
  - The existing plugins read that setting from code: web-mcp from `.mcp.json` (`${user_config.binPath}`),
    tui-review from mod options. A CLI that Claude calls through Bash has neither.
  - No plugin ships a `bin/` folder. The only Bash pre-approval precedent is skill `allowed-tools`
    (`Bash(cargo:*)` in rust-skills).
- **Claude Code facts** (from the code.claude.com docs, read 2026-10-18):
  - A plugin's `bin/` folder is on the Bash tool's PATH (plugins/components, "Executables"). A binary in
    `~/.claude/bin` is outside the plugin, so that doesn't help.
  - `${user_config.KEY}` is substituted in MCP server config and in skill bodies (manifest-reference, "Reference a
    saved value").
  - Plugins can't ship permission allow rules: plugin `settings.json` keeps only `agent` and `subagentStatusLine`
    (plugins/components, "Default settings").
  - Skill `allowed-tools` lasts one turn (skills, "Pre-approve tools for a skill").
  - Bash rules match the literal command text, so `Bash(ado …)` doesn't match `C:\…\ado.exe …`
    (permissions, "What a Bash rule doesn't match").
  - Native Windows has no Bash sandbox (sandboxing, intro). MCP servers run outside the sandbox anyway.
- **Open: Bash sandbox.** `core.mjs:38` turns on `autoAllowBashIfSandboxed` when the sandbox toggle is on. Sandboxed
  Bash may block the work server's host unless it is added to `sandbox.network`.

## Prior art

Report from the prior-art agent, 2026-10-18; every source was fetched in that run.

- **`az devops` refuses Azure DevOps Server outright.** Since extension 1.0.6, `resolve_instance_project_and_repo`
  raises "doesn't support Azure DevOps Server"
  ([services.py](https://raw.githubusercontent.com/Azure/azure-devops-cli-extension/master/azure-devops/azext_devops/dev/common/services.py),
  [#1172](https://github.com/Azure/azure-devops-cli-extension/issues/1172)).
  - Worth copying: it resolves a git remote with `GET {remoteUrl}/vsts/info` (header
    `X-TFS-FedAuthRedirect: Suppress`). The answer gives the server URL, project id and repo id, which settles where
    the collection ends in URLs like `/tfs/Coll/…`.
  - It caches that answer per remote.
- **gh, glab, tea.**
  - Remote parsing: scp-style `host:path` becomes `ssh://`; with several remotes, `upstream` beats `origin`.
  - Tokens go to the OS keyring, with environment variables overriding.
  - Output when stdout isn't a terminal: tables without headers
    ([go-gh table.go](https://raw.githubusercontent.com/cli/go-gh/trunk/pkg/tableprinter/table.go)).
- **azdocli (Rust, community).** Works on-prem, PAT encrypted with DPAPI on Windows. No remote inference, and its
  output uses emoji. Not a base to fork.
- **REST facts at 7.1, from the Server docs.**
  - **Threads.**
    - `commentType` is `text|codeChange|system`.
    - System threads carry a `CodeReviewThreadType` property (`VoteUpdate`, `ReviewersUpdate`, `RefUpdate`,
      `MergeAttempt`).
    - Thread status is `active|fixed|wontFix|closed|byDesign|pending`.
  - **PR update.**
    - `mergeStrategy` is `noFastForward|squash|rebase|rebaseMerge`.
    - A description holds at most 4000 characters.
    - Votes are 10, 5, 0, -5 or -10, set by PUT on the reviewer.
  - **Policy evaluations.** They need `7.1-preview.1`, and their `artifactId` is
    `vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}`, not the PR's own artifactId.
  - **Work items.**
    - Updates are JSON Patch (`application/json-patch+json`), with `test /rev` for optimistic locking.
    - A batch get takes at most 200 ids, and WIQL is a POST.
    - Comments need `7.1-preview.4` and page with a `continuationToken`.
  - **Builds.**
    - Failures are found in the timeline: records with `result=failed`, their `issues[]` and `log.id`.
    - Logs take `startLine`/`endLine`.
    - The continuation token comes back in the `X-MS-ContinuationToken` header (per the official Python SDK).
  - **Runs.** POST `_apis/pipelines/{id}/runs`.
- **Pitfalls.**
  - PAT authentication fails on Server if IIS Basic Authentication is turned on.
  - Project names with spaces break tools that percent-encode only part of the path. Decode the remote once, then
    use the ids from `/vsts/info`.
  - The documented PAT write scopes look incomplete; test them against a real minimal PAT.
  - On Windows, rustls-platform-verifier checks revocation.
- **azdocli, read in full on 2026-10-18** (clone of `christianhelle/azdocli` main, MIT, © 2025 Christian Helle).
  It has about 17k lines of Rust, and 32 of its source files are built on `azure_devops_rust_api` (with
  `.endpoint(...)` set to the on-prem URL, `src/auth/factory.rs:95`) plus tokio. Its logic is typed against that
  crate's models, so it doesn't compile without the crate. Two parts are worth reading as references:
  - `src/pr/comments.rs:141-183`: system-thread detection (every comment of type system or unknown), the
    deleted-thread filter, and `file:line` from `threadContext.rightFileStart`/`leftFileStart`.
  - `src/auth/url.rs`: splitting a collection URL into base and collection.
  Its `migrate/` folder, half the code base, is irrelevant here.
- **Approaches.**
  - **Hand-rolled REST over reqwest** (gh, glab, tea): fits.
  - **Generated SDK:** async, Services-first, more lookups.
  - **Wrapping `az`:** blocked on Server.
  - **Forking azdocli:** wrong output style.

## Options

Settled in the chat before this flow started (the user's words in quotes):

- Language: Rust ("can we build it in rust?"), shipped like tui-review and web-mcp.
- ~~No Microsoft `azure_devops_rust_api` crate~~ (reversed by D1): "a lot of hell to use a crate that focuses on cloud primarily". Hand-written
  calls to "just the important endpoints for dev work, similar to what the gh cli provides".
- Server: Azure DevOps Server 2022.2 (AzureDevopsServer_20240806.7), self-hosted. Auth: PAT ("I can create a key").
- Pipelines: YAML only; classic Releases out.
- Output tuned for AI agents, "not unnecessary crap": proposal (one line per item, system threads dropped, logs
  trimmed to the failed step, truncation with the command for more, `--json` escape hatch) answered "lgtm".
- Fast, and safe when Claude runs several in parallel: proposal (concurrent requests per command, one connection,
  small ID cache with atomic writes, no daemon) given; the user's next answer moved on.
- Read and write, "like gh".
- Windows first ("windows primarly"): PAT in Windows Credential Manager, file on Linux, `ADO_PAT` override (proposal).
- The user tests against the real server at work once a build exists.
- **Interface: B, an MCP server only** ("B pls, goal is for claude I can use the ui"), picked 2026-10-18.
  - Rejected: A, a CLI only, which would need a binary path, Bash permission rules and Windows shell quoting.
  - Rejected: C, a CLI and MCP from one binary.
  - With B, the PAT is a `sensitive` userConfig value, which Claude Code keeps in the platform's secure credential
    store (manifest-reference, "Where values are stored"). So the server needs no credential code of its own, and
    the earlier `ado auth login` and Credential Manager proposal is dropped.
- **Our server replaces the npm one inside `mcp-azure`** ("yes, replace mcp-azure with ours", 2026-10-18;
  recommended so the existing settings carry over).
  - The plugin keeps its name and its userConfig keys (`ado_org_url`, `ado_pat`, `ado_default_project`,
    `ado_api_version`), and gains `binPath`.
  - `@tiberriver256/mcp-server-azure-devops` leaves the repo and THIRD_PARTY.md.
  - Rejected: a new plugin alongside mcp-azure.
- **Permissions** (builder check, 2026-10-18):
  - Options offered: A, allow the reads on first use; B, the installer writes allow rules. Recommended A.
  - The user asked whether Claude can always ask. Answer: yes, through the server-side
    `anthropic/requiresUserInteraction` mark.
  - Picked: "writes only". Write tools carry the mark; reads are allowed on first use (A).
- **Linux CA**: "no wsl at work", so there is no CA setting.
- **Grill round 1** (2026-10-18), all recommendations accepted:
  - Q1: API 7.1 fixed, option removed
  - Q2: optional `branch` arg for worktrees
  - Q4: no bypass-policy
  - Q5: `wi_update` takes any field
  - Q6: server instructions
  - Q7: only outputs are pasted back, not raw JSON
  - Q8: log limits
  - Q9: one server
- **Grill Q3 → Q10:** the user asked whether the installer can install mcp-azure too. Yes, with
  `claude plugin configure --values-stdin`, the PAT over stdin. Accepted.
- **Grill Q11, integration tests.**
  - Options offered: A, the fake server only; B, A plus a live suite the user runs; C, B plus CI against dev.azure.com.
  - Recommended B. The user picked **A**.
  - There is no official Azure DevOps Server container (sources in the chat: Microsoft Learn, Docker agents and the
    unattended install).
- **Reusing azdocli** (the user asked, 2026-10-18): it is only a reference. Its code sits on the SDK the user ruled
  out, so nothing copies over as is. A function ported close to verbatim keeps its MIT notice and gets a
  THIRD_PARTY.md line _(my call)_.
- TLS: the work browser shows the server's certificate as issued by ESET, i.e. ESET's HTTPS scanning re-signs traffic
  with a root it installed in the Windows store. So `ado` must trust the OS certificate store, not a bundled root list.

### Plan review round 1 (2026-10-18)

Three reviewers ran: correctness, fit and simpler. All findings traced to a source; none were dropped. Two unknowns
were checked against the real CLI (Claude Code 2.1.302, in a throwaway `CLAUDE_CONFIG_DIR`):

- `claude plugin install` with closed stdin installs a plugin whose required and sensitive options are unset. It
  exits 0 with "3 userConfig options not yet set".
- `configure --values-stdin` merges: sending `{binPath}` after `{url, pat}` leaves all three configured.
- `configure --json` lists the `configured` option names, so "Enter keeps" can be shown per option.

Blocking:

- B1: pipeline_view must walk Stage → Phase → Job → Task.
- B2: the concurrency test asserts dedup the spec doesn't ask for.
- B3: existing mcp-azure installs never get the binary or a configure step.

Should-fix:

- S1: the PAT could go to the remote's host before the host check.
- S2: a different collection on the same host is not caught.
- S3: paging (`$top=limit+1`; pr_files `nextSkip`).
- S4: the fake server must log request bodies.
- S5: one merged configure through `applyBin`.
- S6: `connectionData` is preview-only.
- S7: `pr_complete` is asynchronous.
- S8: TF401179 has no PR id.
- S9: no timeouts.
- S10: installer UI, decisions, `secret()` and PAT hygiene.
- S11: SSH mapping by the collection segment.
- S12: binary-only like web-mcp.
- S13: task order.

Consider: 14 small items (listed in the chat).

Decisions (2026-10-18, "yes, accept all"): every recommendation accepted, including the pr_view merge-ref spec amendment (Gate 1 reopened for that line and approved with it). Plan revised to revision 2; its shape changed only by merging the plugin into the installer task and dropping the library, both from the review itself, so no second round.
