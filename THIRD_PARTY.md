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

## pstack-picks

`plugins/pstack-picks/` vendors 21 skills and the `comment-sicko` agent from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT License, Copyright (c) 2026 Lauren Tan;
full text in `plugins/pstack-picks/LICENSE`). Modified mechanically for Claude Code by
`scripts/pstack-rewrites.pl` (tool names, subagent types, model names, paths, and an added port note
under each file's frontmatter). The synced upstream commit is in `plugins/pstack-picks/UPSTREAM`.

## graphify

`plugins/graphify/skills/graphify/` vendors the Claude Code skill (`graphify/skill.md`) and its `references/`
from [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (Apache License 2.0, Copyright 2026
Safi Shamsi and the Graphify contributors; `LICENSE`, `LICENSE-MIT` and `NOTICE` in `plugins/graphify/`),
unmodified. `plugins/graphify/hooks/hooks.json` reproduces the hooks upstream's installer writes and calls the
separately installed `graphifyy` CLI. Synced by `scripts/sync-graphify.sh` (weekly via GitHub Actions); the
synced upstream commit is in `plugins/graphify/UPSTREAM`.

## Re-listed plugins

The marketplace entries for code-review, skill-creator, claude-code-setup, rust-analyzer-lsp,
csharp-lsp, typescript-lsp, pyright-lsp, superpowers and ponytail only point at their upstream
repositories; no code is vendored here. Each is
covered by its own upstream license.
