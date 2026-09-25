# dead-claude-skills

My personal Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills.
It's built for me; use it if it fits, but expect it to change without notice.

## Included

- **dead-skills** (default bundle): code-review, skill-creator, claude-code-setup, claude-md-management,
  security-guidance, claude-security, superpowers, ponytail, mcp-basic (context7), plus my global rules.
- **Opt-in:** language servers (rust, csharp, typescript, pyright, nix), mcp-github, mcp-azure, atlassian,
  hallmark, dev-feature, mattpocock-picks, pstack-picks, graphify.
- **Installer toggles:** ccstatusline, sandbox (Linux/macOS/WSL2, needs bubblewrap and socat), and
  [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) (runs dcg's own installer). The installer
  always denies reading `.env` files and credential dirs (`~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gh`, `~/.gnupg`).
  With the sandbox on, Bash is blocked from those dirs and from the project root's `.env*` files only; `.env` files
  in subdirectories are protected from Claude's Read tool but not from Bash.

## Install

    npx github:deadmade/dead-claude-skills

or `/plugin marketplace add deadmade/dead-claude-skills` then `/plugin install dead-skills@dead-claude-skills`.
