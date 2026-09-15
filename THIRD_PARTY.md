# Third-party content

## Hallmark

`plugins/dead-skills/skills/hallmark/` is vendored from [nutlope/hallmark](https://github.com/nutlope/hallmark)
(MIT License, Copyright (c) 2026 Hallmark contributors; full text in `skills/hallmark/LICENSE`).
It is synced by `scripts/sync-hallmark.sh` (weekly via GitHub Actions); the only local change is a
"WEB FRONTEND ONLY" prefix on the frontmatter `description`. The synced upstream commit is in
`skills/hallmark/UPSTREAM`.

## Re-listed plugins

The marketplace entries for code-review, skill-creator, claude-code-setup, rust-analyzer-lsp,
csharp-lsp, typescript-lsp, pyright-lsp, superpowers and ponytail only point at their upstream
repositories; no code is vendored here. Each is
covered by its own upstream license.
