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
  hallmark, dev-feature, feature-flow, self-review, mattpocock-picks, pstack-picks, graphify, cswap, skill-creator,
  tui-review (see [its README](plugins/tui-review/README.md); the installer downloads its `brv` binary).
- **Installer toggles:** ccstatusline, sandbox (Linux/macOS/WSL2, needs bubblewrap and socat), and
  [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) (runs dcg's own installer). The installer
  always denies reading `.env` files and credential dirs (`~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gh`, `~/.gnupg`).
  With the sandbox on, Bash is blocked from those dirs and from the project root's `.env*` files only; `.env` files
  in subdirectories are protected from Claude's Read tool but not from Bash.

## Install

    npx --allow-git=root github:deadmade/dead-claude-skills#semver:*

(`#semver:*` runs the installer from the newest release; without it you get master; `--allow-git=root` is needed
since npm 12, which refuses git packages with `EALLOWGIT` otherwise, and older npm ignores it) or
`/plugin marketplace add deadmade/dead-claude-skills` (plus `anthropics/claude-plugins-official` if you removed it)
then `/plugin install dead-skills@dead-claude-skills`.

The installer pins the marketplace to its own release: installer vX.Y.Z adds `deadmade/dead-claude-skills@vX.Y.Z`
and sets that ref in the marketplace's `extraKnownMarketplaces` entry, so the plugins always match the installer that
ran. `/plugin update` and auto-update stay on that tag; to update, run the command above again. The marketplace added
by hand with `/plugin marketplace add` tracks master instead.

The installer has two optional rows (also `--strip-defaults` / `--clean`) that take over the whole machine:

- **strip-defaults** uninstalls every plugin and removes every marketplace not from here, keeping
  `claude-plugins-official` and only the plugins above from it. It also sets `disableClaudeAiConnectors`,
  `syncClaudeAiSkills: false` and `syncClaudeAiPlugins: false`, and turns off the `agents-md` and `telemetry`
  builtins. Unchecking it later changes nothing.
- **clean** does the same, then copies your config to `~/.claude.dead-backup-<time>/`, replaces `settings.json`
  with only this installer's keys (plus enabled plugins and dcg's hook if dcg stays on), and deletes `CLAUDE.md`, `skills`, `agents`,
  `commands`, `rules`, `output-styles`, `workflows` and `hooks`. Credentials, `~/.claude.json`, `projects/`,
  `plugins/` and history are left alone, and symlinked paths (home-manager) are skipped. Asks you to type `clean`.

## cswap

Multi-account switching with [claude-swap](https://github.com/realiti4/claude-swap), from inside Claude Code:

- `/swap` opens the accounts pane (5h/7d usage, a Switch button per account); `/swap next`, `/swap best` or
  `/swap <num|email|alias>` switches. The status line shows the active account's usage.
- Auto-switch is off by default: turn on `auto_switch` with `/plugin configure cswap`. It runs `cswap auto --once`
  every 2 minutes; the threshold and strategy are cswap's own (`cswap config set autoswitch.threshold 80`).
- Accounts are still added in a terminal: log in with Claude Code, then `cswap add`, once per account.

On Windows the installer downloads `cswap.exe` (claude-swap at the tag pinned in `installer/cswap.json`, compiled
with Nuitka by `build-cswap.yml` and attached to every release) to `%LOCALAPPDATA%\Programs\cswap` and puts it on
your user PATH. On Linux, install it with `uv tool install claude-swap` (or nix).

## Releases

Everything here ships as one version: `package.json`, the marketplace's `metadata.version`, every plugin under
`plugins/` and tui-review's `brv` crate carry the same number, and the pre-commit checks fail if they drift. Claude Code
only offers `/plugin update` when that number changes, so sync PRs and other commits on master reach machines with
the next release.

    npm run release -- patch    # or minor, major, X.Y.Z
    git push --follow-tags origin master

The script (master, clean tree only) bumps every version, runs the repo checks and installer tests, commits
`Release vX.Y.Z` and tags it. The tag runs `release.yml`: checks again, builds cswap.exe (`build-cswap.yml`) and brv
for every platform (`build-brv.yml`), and publishes the GitHub release `vX.Y.Z` with all of them attached. Pull
requests that touch those workflows or the cswap pin build and smoke-test; merges to master run nothing, and only a
`v*` tag publishes. Superpowers, ponytail and atlassian come from their own repos and keep their own versions.
