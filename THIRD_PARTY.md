# Third-party content

## Hallmark

`plugins/dead-skills/skills/hallmark/` is vendored from [nutlope/hallmark](https://github.com/nutlope/hallmark)
(MIT License, Copyright (c) 2026 Hallmark contributors; full text in `skills/hallmark/LICENSE`).
It is synced by `scripts/sync-hallmark.sh` (weekly via GitHub Actions); the only local change is a
"WEB FRONTEND ONLY" prefix on the frontmatter `description`. The synced upstream commit is in
`skills/hallmark/UPSTREAM`.

## MCP servers (mcp-basic, mcp-github, mcp-azure)

- **Context7**: hosted service by Upstash (https://context7.com), used over HTTP; nothing vendored.
- **GitHub MCP server**: hosted by GitHub (https://github.com/github/github-mcp-server), used over HTTP; nothing vendored.
- **@tiberriver256/mcp-server-azure-devops**: MIT, https://github.com/Tiberriver256/mcp-server-azure-devops.
  Fetched at runtime with `npx` at a pinned version; not vendored.

## mattpocock-picks

`plugins/mattpocock-picks/skills/` vendors 14 skills from [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT License, Copyright (c) 2026 Matt Pocock; full text in `plugins/mattpocock-picks/LICENSE`), unmodified
apart from flattening `engineering/` and `productivity/` into one folder. Synced by `scripts/sync-mattpocock.sh`
(weekly via GitHub Actions); the synced upstream commit is in `plugins/mattpocock-picks/UPSTREAM`.

## Re-listed plugins

The marketplace entries for code-review, skill-creator, claude-code-setup, rust-analyzer-lsp,
csharp-lsp, typescript-lsp, pyright-lsp, superpowers and ponytail only point at their upstream
repositories; no code is vendored here. Each is
covered by its own upstream license.
