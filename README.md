# dead-claude-skills

My Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills.

## Install

### Quick setup

Clone the repo and run the setup script. It adds the marketplace, installs `dead-skills`, asks about each
opt-in plugin (and its PATs), sets the [recommended permission](#recommended-permission) and
[auto-update](#auto-update), and checks the [language servers](#language-servers) and other CLIs:

```
./setup.sh                                               # Linux/macOS: missing tools are only reported (NixOS: a home.packages line)
powershell -ExecutionPolicy Bypass -File .\setup.ps1     # Windows: missing tools are installed via winget/npm/rustup/dotnet/uv
```

Flags: `--all`, `--work` (mcp-azure + mcp-github), `--with graphify,pstack-picks`, `--yes` (no prompts),
`--no-tools`, `--dry-run`; PowerShell: `-All`, `-Work`, `-With`, `-Yes`, `-NoTools`, `-DryRun`. For `--yes`
runs the PATs come from `GITHUB_PAT`, `ADO_ORG_URL`, `ADO_PAT`, `ADO_API_VERSION`, `ADO_DEFAULT_PROJECT`.
Re-running is safe; `settings.json` is backed up to `settings.json.bak` before it's changed.

### Manual

```
/plugin marketplace add deadmade/dead-claude-skills
/plugin install dead-skills@dead-claude-skills
```

`dead-skills` is the default bundle: it contains my own skills and declares every other plugin in
this marketplace as a dependency, so that single install pulls in:

code-review · skill-creator · claude-code-setup · superpowers · ponytail · mcp-basic ·
rust-analyzer-lsp · csharp-lsp · typescript-lsp · pyright-lsp · nix-lsp (see [Language servers](#language-servers))

Bundled skills:

- **hallmark**: anti-AI-slop design skill from [nutlope/hallmark](https://github.com/nutlope/hallmark).
  Its description is prefixed with a "WEB FRONTEND ONLY" scope so Claude doesn't pull it into CLIs,
  backends or Rust/Python work. (`paths:` frontmatter would be the file-based equivalent of an LSP's
  extension list, but Claude Code currently ignores it for plugin skills.)

> If a machine already has any of these installed from `claude-plugins-official` or `ponytail`,
> uninstall those copies so they don't load twice.

## Recommended permission

Several skills (pstack-picks, mattpocock-picks, graphify, hallmark) read their own reference files from the
plugin cache, which lies outside your project, so Claude Code asks every time (and a non-interactive
`claude -p` run just fails the read). Plugins can't ship permissions, so allow it once in your user
`settings.json`:

```json
{
  "permissions": {
    "allow": ["Read(~/.claude/plugins/**)"]
  }
}
```

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

On NixOS the flake's home-manager module installs all of them (see [Nix](#nix)); `setup.ps1` installs them
on Windows.

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

MCP servers are split into three plugins:

| Plugin | Servers | Installed |
|---|---|---|
| `mcp-basic` | context7 | automatically, with `dead-skills` |
| `mcp-github` | github | opt-in: `/plugin install mcp-github@dead-claude-skills` |
| `mcp-azure` | azure-devops-server | opt-in: `/plugin install mcp-azure@dead-claude-skills` |

- **context7**: up-to-date library/framework docs (hosted at `mcp.context7.com`), used without an API
  key (free tier rate limits). An empty `Authorization: Bearer` header is rejected by Context7, so the
  key isn't a per-machine option; to use one, add the header in a local `.mcp.json` override.
- **github**: GitHub's hosted MCP server (`api.githubcopilot.com/mcp`) for repos, issues, PRs, Actions
  and code search. Needs a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new),
  asked for on install and stored securely: `/plugin configure mcp-github@dead-claude-skills`.
- **azure-devops-server**: self-hosted Azure DevOps Server (Git repos, work items, pipelines, wiki)
  via the community package [`@tiberriver256/mcp-server-azure-devops`](https://github.com/Tiberriver256/mcp-server-azure-devops),
  pinned to a version. Microsoft's own Azure DevOps MCP server only supports the cloud service.
  Needs Node 20+ (`npx`).

Values are set per machine and never committed; PATs go to Claude Code's secure plugin storage:

```
/plugin configure mcp-azure@dead-claude-skills
```

or non-interactively:
`claude plugin install mcp-azure@dead-claude-skills --config ado_org_url=https://tfs.company/tfs/DefaultCollection --config ado_pat=<PAT> --config ado_api_version=7.0`

**Work machine:** create a PAT in your Azure DevOps Server profile with Code (Read), Work Items
(Read & Write), Build (Read) and Wiki (Read). Set `ado_api_version` to your server's release:
2022 → `7.0`, 2020 → `6.0`, 2019 → `5.0` (a higher version is rejected by the server).

**Other machines:** just don't install `mcp-azure`.

## Matt Pocock picks

`mattpocock-picks` (opt-in: `/plugin install mattpocock-picks@dead-claude-skills`) vendors 14 skills
from [mattpocock/skills](https://github.com/mattpocock/skills). superpowers
drives the process automatically; these add alignment and design tools you mostly call yourself.

- **Productivity (all 7):** `/grill-me`, `/handoff`, `/teach`, `/to-questionnaire`, `/wait-what`,
  plus `grilling` and `writing-for-agents`, which Claude can pick automatically.
- **Engineering (7):** `/grill-with-docs`, `/to-spec`, `/to-tickets`, `/improve-codebase-architecture`,
  `/setup-matt-pocock-skills`, plus the automatic `domain-modeling` and `codebase-design` they call.
- **Left out** because superpowers or the official plugins already cover them: `tdd`, `diagnosing-bugs`,
  `code-review`, `implement`, `wayfinder`. Not included yet: `triage`, `prototype`, `research`, `wizard`,
  `ask-matt`, `resolving-merge-conflicts` (move the line from `SKIPPED` to `SKILLS` in
  `scripts/sync-mattpocock.sh`, bump the count check in `.github/workflows/sync-mattpocock.yml`, re-run the script).
- **Known overlap:** `writing-for-agents` and superpowers' `writing-skills` both trigger when writing skills.

**Per repo:** run `/setup-matt-pocock-skills` once. It writes `docs/agents/*.md` and an `## Agent skills`
section in `CLAUDE.md`; `CONTEXT.md` and `docs/adr/` follow as you use `/grill-with-docs`.

**Suggested flow:** `/grill-with-docs` → `/to-spec` → `/to-tickets` → execute with superpowers
(writing-plans / subagent-driven-development). Run `/improve-codebase-architecture` every few days.

**Work (Azure DevOps Server):** there's no built-in tracker for it. In setup pick **Other** and describe
the workflow (e.g. "create and link work items with the azure-devops-server MCP tools from mcp-azure"),
or pick **Local markdown** (`.scratch/`).

Don't also install the full `mattpocock-skills` from the official marketplace: you'd get every skill
twice plus the clashing ones.

**Why vendored:** a `strict: false` marketplace entry can't pick a subset of his plugin (Claude Code
refuses to load it because his `plugin.json` already lists skills). `scripts/sync-mattpocock.sh`
copies the 14 folders plus his LICENSE and records the upstream commit in `plugins/mattpocock-picks/UPSTREAM`;
`.github/workflows/sync-mattpocock.yml` runs it every Monday and opens a PR. If upstream renames a
skill folder, the script fails loudly instead of syncing a partial set.

**New upstream skills:** the script compares upstream's published skill list against `SKILLS`
(vendored) and `SKIPPED` (deliberately left out). Anything in neither gets a GitHub issue
("New upstream skill in mattpocock/skills: <name>") with its description, once per skill. Close it by
moving the skill into `SKILLS` or `SKIPPED`.

## pstack picks

`pstack-picks` (opt-in: `/plugin install pstack-picks@dead-claude-skills`) vendors 21 skills and one
agent from [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack), a Cursor plugin,
rewritten for Claude Code. Every skill is user-invoked (`/pstack-picks:<name>`).

- **Understanding:** `how`, `why`, `recall`, `bro`
- **Review & safety:** `interrogate`, `blast-radius`, `no-comments` (with the `comment-sicko` agent)
- **Writing:** `unslop`, `technical-writing`
- **Design & parallel:** `architect`, `arena`, `swarm`
- **Long runs:** `show-me-your-work`
- **Principles:** `type-system-discipline`, `boundary-discipline`, `model-the-domain`,
  `make-operations-idempotent`, plus `separate-before-serializing-shared-state`,
  `redesign-from-first-principles`, `prove-it-works` and `fix-root-causes` (used by `arena` and `no-comments`)

**What the rewrite changes** (`scripts/pstack-rewrites.pl`):

- Cursor's models become Claude's: explorers, investigators and swarm workers run on `sonnet`;
  explainers and synthesizers on `fable`; review/runner panels on `fable`, `opus`, `sonnet`, `haiku`.
  Upstream's panels mix vendors on purpose, so here they differ by capability, not by vendor.
- `Task` → Agent tool, read-only subagents → `Explore`, Cursor cloud workers → local background agents
  in worktrees, `~/.cursor` transcripts → `~/.claude/projects/<slug>/`, MCP discovery → `mcp__*` tools.
- Skills call each other by reading the sibling `SKILL.md` via `${CLAUDE_SKILL_DIR}`: they're
  user-invoked, so the Skill tool can't load them (a note is added under each skill's frontmatter).
- `show-me-your-work` ships a bash helper; on Windows it needs Git Bash.

**Left out:** `poteto-mode` (tied to Cursor cloud orchestration and sticky modes, overlaps superpowers),
`tdd`, `figure-it-out`, `teach` (name clash with Matt's), `reflect`/`automate-me` (Cursor transcripts),
`setup-pstack` (models are rewritten directly), and the remaining principles.

**Sync:** `scripts/sync-pstack.sh` copies the subset, applies the rewrites, and fails if any Cursor-ism
survives (a new upstream phrasing then needs a rule instead of shipping broken instructions).
`.github/workflows/sync-pstack.yml` runs it every Monday, opens a PR, and opens an issue for each new
upstream skill that's neither in `SKILLS` nor `SKIPPED`.

## graphify

`graphify` (opt-in: `/plugin install graphify@dead-claude-skills`) vendors the Claude Code skill from
[Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify): `/graphify .` turns a repo (code, docs,
SQL, PDFs) into a knowledge graph in `graphify-out/`, then `/graphify query "…"`, `path` and `explain` answer
from the graph instead of grepping.

**The plugin does not install the CLI.** Once per machine (Python 3.10+):

```
uv tool install graphifyy     # double y; `uv tool update-shell` if `graphify` isn't found
```

- **Hooks:** before Read/Glob/Grep/Bash, `graphify hook-guard` adds a note pointing Claude at the graph when a
  fresh `graphify-out/` exists (soft nudge, never blocks). Without the CLI on `PATH` these hooks error on every
  call, so only install the plugin where graphify is installed.
- **Don't also run `graphify install`**: it copies the same skill to `~/.claude/skills` and the same hooks to
  `settings.json`, so both would load twice. `graphify hook install` (git post-commit rebuild) is fine.
- **Windows:** the vendored skill is upstream's bash variant, so it needs Git Bash.
- **Upgrades:** the skill syncs weekly; keep the CLI in step with `uv tool upgrade graphifyy`.

**Sync:** `scripts/sync-graphify.sh` copies `skill.md` and `skills/claude/references/` and fails if a
reference file disappears. `.github/workflows/sync-graphify.yml` runs it every Monday and opens a PR.
`hooks/hooks.json` is maintained by hand (mirrors `_claude_pretooluse_hooks` in upstream's `install.py`).

## Nix

The flake provides a dev shell, pre-commit hooks and a home-manager module.

- **Dev shell:** `nix develop` (or direnv: `.envrc` is `use flake`) gives git, gh, jq, perl and shellcheck
  for the sync scripts, and installs the pre-commit hooks on entry.
- **Hooks:** alejandra, shellcheck, JSON syntax, merge markers, end-of-file (vendored trees excluded), a
  PowerShell parse of `setup.ps1`, and `scripts/check-repo.sh`: `claude plugin validate` on the marketplace
  and every plugin (skipped when `claude` isn't on `PATH`), bundle dependencies and local sources exist, and
  every marketplace plugin is either a `dead-skills` dependency or an opt-in in both setup scripts. Run them
  all with `pre-commit run --all-files`; `nix flake check` runs them in the sandbox (without claude).
- **home-manager module:** installs the plugins' external tools, not the plugins:

  ```nix
  # flake inputs
  dead-claude-skills = {
    url = "github:deadmade/dead-claude-skills";
    inputs.nixpkgs.follows = "nixpkgs";
  };

  # home-manager config
  imports = [inputs.dead-claude-skills.homeManagerModules.default];
  programs.dead-claude-skills = {
    enable = true;             # all five language servers
    # languageServers.csharp = false;
    mcpAzure.enable = true;    # nodejs_20
    graphify.enable = true;    # uv, then: uv tool install graphifyy
  };
  ```

  It doesn't set `programs.claude-code.settings` or `marketplaces`: either makes `~/.claude/settings.json` a
  read-only store link, so `/plugin install` could no longer save enabled plugins. Settings stay with the
  setup script.

## Layout

```
setup.sh, setup.ps1                 # one-shot machine setup (Linux/macOS, Windows)
flake.nix                           # dev shell, pre-commit hooks, home-manager module output
nix/home-manager.nix                # programs.dead-claude-skills: language servers and other CLIs
scripts/check-repo.sh               # pre-commit: plugin validate + marketplace/setup consistency
.claude-plugin/marketplace.json     # marketplace + re-listed upstream plugins
plugins/dead-skills/
  .claude-plugin/plugin.json        # bundle manifest (dependencies)
  skills/<name>/SKILL.md            # own + vendored skills
  agents/<name>.md                  # own subagents
scripts/sync-hallmark.sh            # vendors hallmark and re-applies the web-only scope
.github/workflows/sync-hallmark.yml # weekly sync → pull request
scripts/sync-mattpocock.sh          # vendors the curated mattpocock/skills subset
.github/workflows/sync-mattpocock.yml # weekly sync → pull request
scripts/sync-pstack.sh              # vendors + rewrites the pstack subset, guards against Cursor-isms
scripts/pstack-rewrites.pl          # Cursor → Claude Code rewrite rules
.github/workflows/sync-pstack.yml   # weekly sync → pull request
scripts/sync-graphify.sh            # vendors graphify's Claude skill + references
.github/workflows/sync-graphify.yml # weekly sync → pull request
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
