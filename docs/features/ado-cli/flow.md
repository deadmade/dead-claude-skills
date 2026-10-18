---
phase: ground
---

# ado CLI: flow

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
- TLS: the work browser shows the server's certificate as issued by ESET, i.e. ESET's HTTPS scanning re-signs traffic
  with a root it installed in the Windows store. So `ado` must trust the OS certificate store, not a bundled root list.
