---
phase: ground
---

# ado MCP server: flow

## Request

"Lets design this idea properly" (/feature-flow), after a chat that settled the idea: a Rust CLI `ado`, like `gh`,
for a self-hosted Azure DevOps Server, so Claude Code can do everyday dev work there without curl or a third-party
MCP server.

## Artifacts

- Spec:
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved:

## Skipped

## Grounding

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
- **Approaches.**
  - **Hand-rolled REST over reqwest** (gh, glab, tea): fits.
  - **Generated SDK:** async, Services-first, more lookups.
  - **Wrapping `az`:** blocked on Server.
  - **Forking azdocli:** wrong output style.

## Options

Settled in the chat before this flow started (the user's words in quotes):

- Language: Rust ("can we build it in rust?"), shipped like tui-review and web-mcp.
- No Microsoft `azure_devops_rust_api` crate: "a lot of hell to use a crate that focuses on cloud primarily". Hand-written
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
- TLS: the work browser shows the server's certificate as issued by ESET, i.e. ESET's HTTPS scanning re-signs traffic
  with a root it installed in the Windows store. So `ado` must trust the OS certificate store, not a bundled root list.
