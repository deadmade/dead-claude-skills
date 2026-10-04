# dead-claude-skills

My personal Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills.
It's built for me; use it if it fits, but expect it to change without notice.

## Included

- **dead-skills** (default bundle): code-review, claude-code-setup, claude-md-management,
  security-guidance, claude-security, superpowers, ponytail, mcp-basic (context7), plus my global rules. Anthropic's
  own plugins (code-review, claude-code-setup, claude-md-management, security-guidance, claude-security, skill-creator
  and the rust/csharp/typescript/pyright LSPs) install from `claude-plugins-official`; the installer adds that
  marketplace if it's missing.
- **Opt-in:** language servers (rust, csharp, typescript, pyright, nix), mcp-github, mcp-azure, atlassian,
  hallmark, dev-feature, mattpocock-picks, pstack-picks, graphify, skill-creator.
- **Installer toggles:** ccstatusline, sandbox (Linux/macOS/WSL2, needs bubblewrap and socat), and
  [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) (runs dcg's own installer). The installer
  always denies reading `.env` files and credential dirs (`~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gh`, `~/.gnupg`).
  With the sandbox on, Bash is blocked from those dirs and from the project root's `.env*` files only; `.env` files
  in subdirectories are protected from Claude's Read tool but not from Bash.

## Install

    npx github:deadmade/dead-claude-skills

or `/plugin marketplace add deadmade/dead-claude-skills` (plus `anthropics/claude-plugins-official` if you removed it)
then `/plugin install dead-skills@dead-claude-skills`.

The installer has two optional rows (also `--strip-defaults` / `--clean`) that take over the whole machine:

- **strip-defaults** uninstalls every plugin and removes every marketplace not from here, keeping
  `claude-plugins-official` and only the plugins above from it. It also sets `disableClaudeAiConnectors`,
  `syncClaudeAiSkills: false` and `syncClaudeAiPlugins: false`, and turns off the `agents-md` and `telemetry`
  builtins. Unchecking it later changes nothing.
- **clean** does the same, then copies your config to `~/.claude.dead-backup-<time>/`, replaces `settings.json`
  with only this installer's keys (plus enabled plugins and dcg's hook if dcg stays on), and deletes `CLAUDE.md`, `skills`, `agents`,
  `commands`, `rules`, `output-styles`, `workflows` and `hooks`. Credentials, `~/.claude.json`, `projects/`,
  `plugins/` and history are left alone, and symlinked paths (home-manager) are skipped. Asks you to type `clean`.
