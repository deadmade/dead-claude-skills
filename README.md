# dead-claude-skills

My Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills.

## Install

```
/plugin marketplace add deadmade/dead-claude-skills
/plugin install dead-skills@dead-claude-skills
```

`dead-skills` is the default bundle: it contains my own skills and declares every other plugin in
this marketplace as a dependency, so that single install pulls in:

code-review · skill-creator · claude-code-setup · superpowers · ponytail ·
rust-analyzer-lsp · csharp-lsp · typescript-lsp · pyright-lsp · nix-lsp (see [Language servers](#language-servers))

Bundled skills:

- **hallmark**: anti-AI-slop design skill from [nutlope/hallmark](https://github.com/nutlope/hallmark).
  Its description is prefixed with a "WEB FRONTEND ONLY" scope so Claude doesn't pull it into CLIs,
  backends or Rust/Python work. (`paths:` frontmatter would be the file-based equivalent of an LSP's
  extension list, but Claude Code currently ignores it for plugin skills.)

> If a machine already has any of these installed from `claude-plugins-official` or `ponytail`,
> uninstall those copies so they don't load twice.

## Auto-update

Third-party marketplaces have auto-update **off** by default. Enable it once per machine:

- `/plugin` → **Marketplaces** → **dead-claude-skills** → **Enable auto-update**, or
- in `settings.json`:

  ```json
  {
    "extraKnownMarketplaces": {
      "dead-claude-skills": {
        "source": { "source": "github", "repo": "deadmade/dead-claude-skills" },
        "autoUpdate": true
      }
    }
  }
  ```

`dead-skills` has no `version`, so every pushed commit is an update. Manual update:
`claude plugin marketplace update dead-claude-skills`, then `claude plugin update dead-skills@dead-claude-skills`
and restart (or `/reload-plugins`).

## Language servers

The `*-lsp` plugins connect Claude to language servers: after every edit Claude gets the server's
errors/warnings in context, and it can jump to definitions, find references, get type info, search
symbols and trace call hierarchies instead of grepping.

**The plugins do not install the servers.** Each binary must be on `PATH` (a project dev shell via
direnv also works). A missing one shows up as "Executable not found in $PATH" under `/plugin` →
Errors; silence a server a machine doesn't need with `/plugin disable <name>@dead-claude-skills`.

| Server | NixOS (home-manager `home.packages`) | Windows |
|---|---|---|
| rust-analyzer | `rust-analyzer` | `rustup component add rust-analyzer` |
| csharp-ls | `csharp-ls` + `dotnet-sdk` | `dotnet tool install --global csharp-ls` (.NET SDK 6+) |
| typescript-language-server | `typescript-language-server` + `typescript` | `npm i -g typescript typescript-language-server` |
| pyright-langserver | `pyright` | `npm i -g pyright` |
| nixd | `nixd` | not available natively (WSL only): `/plugin disable nix-lsp@dead-claude-skills` |

Notes: diagnostics are asynchronous — they show up a step after the edit, and not at all while a
server is still starting (the first edits of a session may get none); C# projects may need `dotnet restore` before csharp-ls resolves references; rust-analyzer and
pyright can use a lot of memory on large repos; language servers don't run in cloud sessions.

## MCP servers

`dead-mcp` (installed with the bundle) ships two MCP servers:

- **context7**: up-to-date library/framework docs (hosted at `mcp.context7.com`), used without an API
  key (free tier rate limits). An empty `Authorization: Bearer` header is rejected by Context7, so the
  key isn't a per-machine option; to use one, add the header in a local `.mcp.json` override.
- **azure-devops-server**: self-hosted Azure DevOps Server (Git repos, work items, pipelines, wiki)
  via the community package [`@tiberriver256/mcp-server-azure-devops`](https://github.com/Tiberriver256/mcp-server-azure-devops),
  pinned to a version. Microsoft's own Azure DevOps MCP server only supports the cloud service.
  Needs Node 20+ (`npx`).

Values are set per machine and never committed; keys and PATs go to Claude Code's secure plugin storage:

```
/plugin configure dead-mcp@dead-claude-skills
```

or non-interactively:
`claude plugin install dead-mcp@dead-claude-skills --config ado_org_url=https://tfs.company/tfs/DefaultCollection --config ado_pat=<PAT> --config ado_api_version=7.0`

**Work machine:** create a PAT in your Azure DevOps Server profile with Code (Read), Work Items
(Read & Write), Build (Read) and Wiki (Read). Set `ado_api_version` to your server's release:
2022 → `7.0`, 2020 → `6.0`, 2019 → `5.0` (a higher version is rejected by the server).

**Other machines:** leave the Azure DevOps values empty and switch `azure-devops-server` off in `/mcp`.

## Layout

```
.claude-plugin/marketplace.json     # marketplace + re-listed upstream plugins
plugins/dead-skills/
  .claude-plugin/plugin.json        # bundle manifest (dependencies)
  skills/<name>/SKILL.md            # own + vendored skills
  agents/<name>.md                  # own subagents
scripts/sync-hallmark.sh            # vendors hallmark and re-applies the web-only scope
.github/workflows/sync-hallmark.yml # weekly sync → pull request
```

## Adding a skill

1. Create `plugins/dead-skills/skills/<name>/SKILL.md` (e.g. with `/skill-creator`).
2. Keep it project-agnostic and cross-platform (no bash-only scripts; Windows may lack WSL).
3. Validate: `claude plugin validate .` and `claude plugin validate plugins/dead-skills`, then push.

## Adding another upstream plugin

Add an entry to `.claude-plugin/marketplace.json` and its name to `dependencies` in the bundle's
`plugin.json`.

## Hallmark sync

`.github/workflows/sync-hallmark.yml` runs every Monday (or manually via
`gh workflow run sync-hallmark.yml`). It runs `scripts/sync-hallmark.sh` and, if upstream changed,
opens a PR on `sync/hallmark`. Merge it to roll the update out.

One-time repo setting required: **Settings → Actions → General → Workflow permissions → Allow GitHub
Actions to create and approve pull requests**.

Run locally instead: `bash scripts/sync-hallmark.sh`.
