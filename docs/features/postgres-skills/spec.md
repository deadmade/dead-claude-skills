# Postgres skills: spec

## Intent

The user works with PostgreSQL often and wants Claude to handle it better by default. That covers schema design,
indexes, queries, transactions, locking and concurrency, vacuum, and migrations that don't block tables.

The motivation matches the C# and Rust skills (`docs/features/language-skills/`): no single incident, just general
improvement. The guidance comes from good upstream skills that are vendored and kept in sync. The user does not want
to write or maintain it.

More database plugins may follow, so this one starts a new `plugins/database/` group.

## Goals

- A new opt-in plugin, `postgres`, in `plugins/database/postgres/`, carrying two vendored upstream skills, unchanged apart from added `paths:` frontmatter:
  - **Neon `postgres-best-practices`**, from
    [neondatabase/postgres-skills](https://github.com/neondatabase/postgres-skills) `skills/postgres-best-practices`
    (Apache-2.0). It covers generic schema, indexing, query, isolation, locking, vacuum and diagnostics guidance.
  - **Timescale `postgres-database-migration`**, from [timescale/pg-aiguide](https://github.com/timescale/pg-aiguide)
    `skills/postgres-database-migration` (Apache-2.0, ships a NOTICE). It covers DDL lock behaviour, `lock_timeout`,
    retry-with-timeout and safe patterns for each operation.
  - They show up as `postgres:postgres-best-practices` and `postgres:postgres-database-migration`.
- A sync that keeps both skills current, following the repo's vendoring pattern, with a weekly workflow that opens a PR.
- `plugins/database/` becomes a plugin group: `GROUPS` in `scripts/plugin-dirs.mjs` gets `'database'`.
- The installer offers `postgres` as an opt-in on a new "Databases" page (`CATEGORIES` id `database`), placed after
  "Languages".

## Non-goals

- Writing our own Postgres guidance. The content is upstream's.
- **pg-aiguide's semantic search over the PostgreSQL manual** (its MCP server). The user wanted version-aware search,
  but the server is hosted by TigerData and sees every search text. Self-hosting needs a pgvector database,
  embeddings and a manual scrape. The user dropped it on 2026-10-13.
- The rest of `pg-aiguide`: its other 9 skills (TimescaleDB, PostGIS, pgvector, hybrid search, table design, schema
  exploration) and its umbrella `postgres` skill, whose `references/` are symlinks.
- A Postgres MCP server with live database access.
- Supabase, PlanetScale, ECC and awesome-copilot skills. These were rejected in brainstorming; flow.md → Options has
  the reasons.
- Adding the plugin to the default `dead-skills` bundle.
- Router skills. With only two skills, ADR 0001's reason for routers doesn't apply.
- A before/after test (`evals/`).
- Moving existing plugins into `plugins/database/`.

## Anti-goals

- A sync that silently drops an upstream skill or copies only part of one. A missing upstream folder or `SKILL.md`
  fails the sync.
- Vendored files edited by hand.

## Constraints

- **Vendoring pattern:**
  - `scripts/sync-<x>.mjs` built on `scripts/sync-lib.mjs` (`sparseClone`, `fail`, `finish`).
  - `UPSTREAM` file(s) with the synced commit.
  - Upstream's `LICENSE`, plus `NOTICE` for pg-aiguide (Apache-2.0 §4d).
  - `.github/workflows/sync-<x>.yml` on a weekly schedule.
  - Entries in THIRD_PARTY.md and the CLAUDE.md vendored list.
  - The `flake.nix` and `treefmt.toml` excludes.
- **One version for everything:** the new `plugin.json` carries the repo version. `check-repo.mjs` enforces this.
- **Installer:** changes go in `installer/core.mjs` with tests. No npm dependencies.
- **Context cost:** plugin skills are listed in every project (ADR 0001). This plugin adds two descriptions, and only
  for users who opt in.
- **Branch:** `feat/language-skills` is merged into `main` first. This work then goes on a fresh branch off `main`.

## Decided with the user (2026-10-13)

- **Why:** improve how Claude works with Postgres in general, for the same reason as the C# and Rust skills.
- **Sources:** Neon `postgres-best-practices` plus Timescale `postgres-database-migration` (option B). Rejected:
  Neon alone (no migration-lock guidance) and stripped Supabase (heavy transforms, no isolation coverage).
- **Provider content:** accepted as is. Timescale's skill recommends Neon forking (`SKILL.md:431`) and PgDog mirroring
  (`:448`) in its optional "Fork-Based Migration Testing" section, and names Neon in
  `references/complete-example.md:18`. Nothing is stripped or flagged.
- **Place:** `plugins/database/` as a new group, because more database skills may follow.
- **Name:** `postgres`, not `postgres-skills`.
- **One plugin** for both skills.
- **Installer:** a new "Databases" page.
- **Semantic search:** dropped (see Non-goals).
- **Branch:** merge `feat/language-skills` first, then branch from `main`.
- **Before/after test:** none.
- **`paths:` frontmatter** (reopened after execution, 2026-10-13; the user picked A): the sync adds
  `paths: ["**/*.sql", "**/migrations/**", "**/migrate/**", "**/*.prisma", "**/alembic/**"]` to both skills, the same
  way `sync-rust.mjs` does. Claude Code currently ignores `paths:` for plugin skills (ADR 0001), so it changes nothing
  today and is there for when it does. That is the one modification to the vendored content.

## Calls I made (the user can override)

- **Upstream branch:** both syncs follow `main`, like the language plugins. Neon has no tags.

## Left to the builder

- One sync script or two, and how `UPSTREAM` records two commits. `finish()` writes one SHA per `UPSTREAM` file, so
  one file per skill folder works without changing `sync-lib.mjs`.
- Where the LICENSE and NOTICE files go: in each skill folder, or at the plugin root with distinct names.
- The workflow's schedule slot.
- The plugin and marketplace description, true to the content. For example: "Postgres best practices (Neon) and
  safe-migration guidance (Timescale pg-aiguide) as skills. Vendored, synced weekly. Opt-in."
- A short plugin README if the language plugins have one; otherwise none.
