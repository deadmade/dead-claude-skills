# Install dead-claude-skills (instructions for Claude Code)

You are setting up the `dead-claude-skills` plugin marketplace on this machine. Follow the steps in order.
Every step starts with a check, so re-running this guide on a machine that's already set up changes nothing.

Rules:

- Ask before installing system packages, uninstalling plugins or editing config outside `~/.claude`.
  Batch the questions: one question per step, not one per package.
- Never ask the user to paste a PAT or other secret into the chat. Secrets go through Claude Code's own
  prompt (step 4).
- If a command fails, note it, carry on with the remaining steps, and report it in the summary.
- Marketplace name: `dead-claude-skills`. Repo: `deadmade/dead-claude-skills`. Plugin ids are
  `<plugin>@dead-claude-skills`.

## 1. Detect the environment

- OS: Windows, macOS, NixOS (`/etc/NIXOS` exists) or other Linux (distro from `/etc/os-release`).
- Package managers on `PATH`: winget, brew, apt/dnf/pacman/zypper, nix, npm, rustup, dotnet, uv.
- Claude config dir: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. Settings file: `<config dir>/settings.json`.
- Installed state: `claude plugin list --json` and `claude plugin marketplace list --json`.

## 2. Choose opt-in plugins

`dead-skills` is always installed. These are opt-in:

| Plugin | What it is |
|---|---|
| `mcp-github` | GitHub's hosted MCP server (needs a fine-grained PAT) |
| `mcp-azure` | Azure DevOps Server MCP server (needs collection URL + PAT, Node 20+) |
| `mattpocock-picks` | curated Matt Pocock skills (grilling, spec to tickets, architecture) |
| `pstack-picks` | curated pstack skills (how/why, review, unslop, architect/arena/swarm) |
| `graphify` | codebase knowledge graph (needs the graphify CLI) |

Skip the ones already installed. Ask about the rest in a single multi-select question (AskUserQuestion when
available). If none are left, say so and move on.

## 3. Marketplace and plugins

1. If `dead-claude-skills` is in the marketplace list, run `claude plugin marketplace update dead-claude-skills`;
   otherwise `claude plugin marketplace add deadmade/dead-claude-skills`.
2. Unless installed: `claude plugin install dead-skills@dead-claude-skills`. It pulls in code-review,
   skill-creator, claude-code-setup, superpowers, ponytail, the five `*-lsp` plugins and mcp-basic as dependencies.
3. For each chosen of `mattpocock-picks`, `pstack-picks`, `graphify`: `claude plugin install <name>@dead-claude-skills`.

## 4. Plugins with secrets (mcp-github, mcp-azure)

Only if chosen and not installed. Don't install these yourself (you'd have to handle the PAT). Tell the user to
run the command below in the Claude Code prompt; it asks for each value and stores PATs in secure storage.
Give them the prep info first, then wait until they say they're done.

- **mcp-github**: `/plugin install mcp-github@dead-claude-skills`. Needs a fine-grained PAT from
  https://github.com/settings/personal-access-tokens/new with the repository permissions Claude should have.
- **mcp-azure**: `/plugin install mcp-azure@dead-claude-skills`. Needs:
  - the collection URL, e.g. `https://tfs.company/tfs/DefaultCollection`
  - a PAT from their Azure DevOps Server profile with Code (Read), Work Items (Read & Write), Build (Read), Wiki (Read)
  - the REST API version of their server: 2022 → `7.0`, 2020 → `6.0`, 2019 → `5.0` (higher is rejected)
  - optionally a default project

Afterwards re-run `claude plugin list --json` to confirm. Values can be changed later with
`/plugin configure <plugin>@dead-claude-skills`.

## 5. Duplicate plugins

In `claude plugin list --json`, find enabled plugins from another marketplace (e.g. `claude-plugins-official`,
`ponytail`) whose name matches one of ours: `dead-skills`, code-review, skill-creator, claude-code-setup,
superpowers, ponytail, rust-analyzer-lsp, csharp-lsp, typescript-lsp, pyright-lsp, nix-lsp, mcp-basic, or an
opt-in from step 2. They'd load twice. List them and, if the user agrees, `claude plugin uninstall <id>` each.

## 6. settings.json

The settings file must contain (merged into whatever is already there):

```json
{
  "permissions": { "allow": ["Read(~/.claude/plugins/**)"] },
  "extraKnownMarketplaces": {
    "dead-claude-skills": {
      "source": { "source": "github", "repo": "deadmade/dead-claude-skills" },
      "autoUpdate": true
    }
  }
}
```

The permission lets skills read their reference files from the plugin cache without a prompt; `autoUpdate` is
off by default for third-party marketplaces.

- Already present: nothing to do.
- File is a symlink (managed by home-manager or a dotfiles repo): don't edit it; show the snippet and say where it
  needs to go.
- Otherwise: copy the file to `settings.json.bak`, then add only the missing keys, keeping every other key and
  existing `allow` entry. Create the file if it doesn't exist. Make sure it's still valid JSON.

## 7. External tools

The `*-lsp` plugins and some opt-ins need binaries on `PATH`. Check each row that applies (`command -v` /
`Get-Command`), then show the user what's missing with the exact commands for this machine and ask once
before installing.

| Binary | Needed for | NixOS package(s) | Windows | macOS | Other Linux |
|---|---|---|---|---|---|
| `rust-analyzer` | always | `rust-analyzer` | `rustup component add rust-analyzer` | `brew install rust-analyzer` | `rustup component add rust-analyzer`, else the distro package |
| `csharp-ls` | always | `csharp-ls` `dotnet-sdk` | `dotnet tool install --global csharp-ls` (.NET SDK 6+: `winget install -e --id Microsoft.DotNet.SDK.8`) | same, SDK via `brew install --cask dotnet-sdk` | same, SDK from the distro or Microsoft's repo |
| `node`, `npm` | the npm rows below, `mcp-azure` (Node 20+) | `nodejs_20` | `winget install -e --id OpenJS.NodeJS.LTS` | `brew install node` | distro package (check the version is 20+) |
| `typescript-language-server` | always | `typescript-language-server` `typescript` | `npm i -g typescript typescript-language-server` | same | same |
| `pyright-langserver` | always | `pyright` | `npm i -g pyright` | same | same |
| `nixd` | always, except Windows | `nixd` | not available: `/plugin disable nix-lsp@dead-claude-skills` | `brew install nixd` | see https://github.com/nix-community/nixd |
| `uv` | `graphify` | `uv` | `winget install -e --id astral-sh.uv` | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `graphify` | `graphify` | via uv | `uv tool install graphifyy` (double y) | same | same |

Rules of thumb:

- winget calls get `--accept-source-agreements --accept-package-agreements --silent`. On Windows, call `npm.cmd`.
- Install prerequisites first (Node before npm packages, the .NET SDK before csharp-ls, uv before graphify).
- `sudo` needs a terminal: if a command needs it, give the user the command to run with `! <command>`.
- After installing, re-check `PATH`. For uv tools run `uv tool update-shell`; if a binary still isn't found,
  say a new terminal (and a Claude Code restart) is needed.
- If the user doesn't want a language server, suggest `/plugin disable <name>@dead-claude-skills` so it stops
  reporting "Executable not found in $PATH".
- If `graphify` is installed but the CLI isn't on `PATH`, warn loudly: its hooks fail on every tool call.

**NixOS:** don't install imperatively. Offer to add the tools to the user's home-manager config, either the
module from this repo's flake:

```nix
# flake inputs
dead-claude-skills = {
  url = "github:deadmade/dead-claude-skills";
  inputs.nixpkgs.follows = "nixpkgs";
};

# home-manager config
imports = [inputs.dead-claude-skills.homeManagerModules.default];
programs.dead-claude-skills = {
  enable = true;              # all five language servers
  # languageServers.csharp = false;
  mcpAzure.enable = true;     # nodejs_20, only if mcp-azure
  graphify.enable = true;     # uv, only if graphify
};
```

or a plain `home.packages = with pkgs; [ ... ];` line with the packages from the table. Find their config
(e.g. `~/.config/home-manager`, `/etc/nixos`, or ask), edit it only if they agree, and never run
`home-manager switch` / `nixos-rebuild` without asking. Don't set `programs.claude-code.settings` or
`.marketplaces`: that makes `settings.json` a read-only store link and `/plugin install` breaks. With graphify,
`uv tool install graphifyy` is still needed after the switch.

## 8. Summary

Finish with a short report:

- installed plugins, and opt-ins that were skipped
- settings.json: changed (with backup path), already set, or needs a manual merge
- tools installed, and tools still missing with their command
- warnings and failed commands

End with: restart Claude Code (or run `/reload-plugins`) to load the changes.
