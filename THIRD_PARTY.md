# Third-party content

## Hallmark

`plugins/opt-in/hallmark/skills/hallmark/` is vendored from [nutlope/hallmark](https://github.com/nutlope/hallmark)
(MIT License, Copyright (c) 2026 Hallmark contributors; full text in `skills/hallmark/LICENSE`).
It is synced by `scripts/sync-hallmark.mjs` (weekly via GitHub Actions); the only local change is a
"WEB FRONTEND ONLY" prefix on the frontmatter `description`. The synced upstream commit is in
`skills/hallmark/UPSTREAM`.

## paper-lookup

`plugins/shared/paper-lookup/skills/paper-lookup/` is vendored from the paper-lookup skill of
[K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) (MIT License, Copyright (c)
2025 K-Dense Inc.; full text in `skills/paper-lookup/LICENSE.md`). It is synced by `scripts/sync-paper-lookup.mjs`
(weekly via GitHub Actions), which trims it for computer science: the reference files for PubMed, PMC, Europe PMC,
bioRxiv, medRxiv, PubTator3, BioStudies, ROR and Figshare are deleted along with SKILL.md table rows naming them, a
note under the title covers leftover mentions, the frontmatter `description` is replaced, and the "Citing Scientific
Agent Skills" section is removed.
The synced upstream commit is in `skills/paper-lookup/UPSTREAM`.

## MCP servers (dead-skills, mcp-github, mcp-azure)

- **Context7**: hosted service by Upstash (https://context7.com), used over HTTP; nothing vendored.
- **GitHub MCP server**: hosted by GitHub (https://github.com/github/github-mcp-server), used over HTTP; nothing vendored.
- **@tiberriver256/mcp-server-azure-devops**: MIT, https://github.com/Tiberriver256/mcp-server-azure-devops.
  Fetched at runtime with `npx` at a pinned version; not vendored.

## mattpocock-picks

`plugins/shared/mattpocock-picks/skills/` vendors a picked set of skills from [mattpocock/skills](https://github.com/mattpocock/skills)
(MIT License, Copyright (c) 2026 Matt Pocock; full text in `plugins/shared/mattpocock-picks/LICENSE`), unmodified
apart from flattening `engineering/` and `productivity/` into one folder. Synced by `scripts/sync-mattpocock.mjs`
(weekly via GitHub Actions); the synced upstream commit is in `plugins/shared/mattpocock-picks/UPSTREAM`.

## pstack-picks

`plugins/shared/pstack-picks/` vendors a picked set of skills and the `comment-sicko` agent from
[pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT License, Copyright (c) 2026 Lauren Tan;
full text in `plugins/shared/pstack-picks/LICENSE`). Modified mechanically for Claude Code by
`scripts/sync-pstack.mjs` (tool names, subagent types, model names, paths, and an added port note
under each file's frontmatter). The synced upstream commit is in `plugins/shared/pstack-picks/UPSTREAM`.

## tob-picks

`plugins/shared/tob-picks/` vendors four skills (property-based-testing, spec-to-code-compliance, sharp-edges,
mutation-testing), the `spec-compliance-checker` and `sharp-edges-analyzer` agents and the `spec-compliance` workflow
from [trailofbits/skills](https://github.com/trailofbits/skills) (Creative Commons Attribution-ShareAlike 4.0,
Copyright Trail of Bits; full text in `plugins/shared/tob-picks/LICENSE`). The vendored files stay under CC BY-SA 4.0.
Modified by `scripts/sync-tob.mjs`: each upstream plugin's skill, agents and workflow are merged into one plugin,
the Codex-only `agents/openai.yaml` and its icon are dropped, the `spec-to-code-compliance:` namespace is renamed to
`tob-picks:`, and `FsCheck|CsCheck` is added to property-based-testing's library detection command. Synced weekly via
GitHub Actions; the synced upstream commit is in `plugins/shared/tob-picks/UPSTREAM`.

## rust-skills

`plugins/opt-in/rust-skills/` vendors the rust-best-practices skill from
[apollographql/skills](https://github.com/apollographql/skills) (MIT License; `plugins/opt-in/rust-skills/LICENSE`).
Modified by `scripts/sync-rust.mjs`: a `paths:` block (`**/*.rs`, `**/Cargo.toml`, `**/Cargo.lock`) is added to
SKILL.md's frontmatter. Synced weekly via GitHub Actions (`sync-rust.yml`); the synced upstream commit is in
`plugins/opt-in/rust-skills/UPSTREAM`.

## csharp-skills

`plugins/opt-in/csharp-skills/` vendors the skills of [dotnet/skills](https://github.com/dotnet/skills) (MIT License,
Copyright (c) .NET Foundation and Contributors; `plugins/opt-in/csharp-skills/LICENSE`). Modified by
`scripts/sync-csharp.mjs`: the 102 skills are copied to `library/`, and six generated router skills in `skills/` (core,
testing, build, web, data, desktop) index them; the four skills upstream marks `disable-model-invocation: true` are
left out of the indexes. csharp-expert gets a note that its specialists are already installed in csharp-skills, its
install, restart and update blocks are rewritten, and it gets a fixed index summary. Upstream's agents, binlog MCP
server, bundled LSP and dotnet-experimental plugin are not vendored. Synced weekly via GitHub Actions
(`sync-csharp.yml`), which lists added, removed, skipped and unmapped skills and agent mentions in the PR body; the
synced upstream commit is in `plugins/opt-in/csharp-skills/UPSTREAM`.

## postgres

`plugins/opt-in/postgres/skills/` vendors two skills. Each folder carries its upstream's license and an `UPSTREAM`
file with the synced commit:

- `postgres-best-practices/` from [neondatabase/postgres-skills](https://github.com/neondatabase/postgres-skills)
  (Apache License 2.0; `LICENSE` in the folder).
- `postgres-database-migration/` from [timescale/pg-aiguide](https://github.com/timescale/pg-aiguide) (Apache License
  2.0; `LICENSE` and `NOTICE` in the folder).

Modified by `scripts/sync-postgres.mjs`: a `paths:` block (`**/*.sql`, `**/migrations/**`, `**/migrate/**`,
`**/*.prisma`, `**/alembic/**`) is added to each SKILL.md's frontmatter. Synced weekly via GitHub Actions
(`sync-postgres.yml`).

## graphify

`plugins/shared/graphify/skills/graphify/` vendors the Claude Code skill (`graphify/skill.md`) and its `references/`
from [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (Apache License 2.0, Copyright 2026
Safi Shamsi and the Graphify contributors; `LICENSE`, `LICENSE-MIT` and `NOTICE` in `plugins/shared/graphify/`),
unmodified. `plugins/shared/graphify/hooks/hooks.json` reproduces the hooks upstream's installer writes and calls the
separately installed `graphifyy` CLI. Synced by `scripts/sync-graphify.mjs` (weekly via GitHub Actions); the
synced upstream commit is in `plugins/shared/graphify/UPSTREAM`.

## claude-swap (cswap)

`plugins/opt-in/cswap/` is a front end for [realiti4/claude-swap](https://github.com/realiti4/claude-swap) (MIT License,
Copyright (c) Onur Cetinkol); it runs the `cswap` binary and vendors none of its code.
`.github/workflows/build-cswap.yml` compiles the upstream tag pinned in `installer/cswap.json` with Nuitka;
`release.yml` attaches the result as `cswap.exe` to each `vX.Y.Z` release, and `sync-cswap.yml` bumps the pin weekly.

## self-review

`plugins/shared/self-review/` vendors review passes from two upstreams, synced by `scripts/sync-self-review.mjs` (weekly via
GitHub Actions; the synced commits are in `plugins/shared/self-review/UPSTREAM`):
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)'s code-review command and
pr-review-toolkit agents (Apache License 2.0, Copyright Anthropic, PBC; `LICENSE` and `NOTICE`), with the agents'
`description:` rewritten, and [mattpocock/skills](https://github.com/mattpocock/skills)'s engineering code-review
skill (MIT License, Copyright Matt Pocock; `LICENSE-MIT`), unmodified apart from a source comment.

## Night City (dead-skills)

The palette of `plugins/default/themes/night-city.json` is derived from the Cyberpunk Neon theme
(`plugins/theme-gallery/themes/cyberpunk.json`) of [livlign/ccthemes](https://github.com/livlign/ccthemes) (MIT
License, Copyright its authors), with changed and added colors. Nothing is vendored or synced.

## Re-listed plugins

The marketplace entries for superpowers and ponytail only point at their upstream repositories, pinned to a release
commit; no code is vendored here. Anthropic's plugins (code-review, claude-code-setup, claude-md-management, security-guidance,
claude-security, skill-creator, hookify and the LSPs) aren't listed here at all: they install from Anthropic's
`claude-plugins-official` marketplace. Each is covered by its own upstream license.
