---
phase: done
---

# Postgres skills: flow

## Request

"Hey, lets create a plan to add this since I often use this db" (this = a Postgres best-practices skill such as
Supabase's `postgres-best-practices`, for best practices and concurrency advice).

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs: none (see Options)
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md) ("Database plugin" added)

## Gates

- Gate 1, spec approved: 2026-10-13 ("approved, write the plan")
- Gate 2, plan approved: 2026-10-13 ("approved, merge language-skills first"), execution: native

## Skipped

## Grounding

- **Closest template: `plugins/languages/rust-skills/`.** It vendors one upstream skill folder whole:
  `scripts/sync-rust.mjs` (41 lines, sparseClone → copy → LICENSE → transform → `finish()` writes UPSTREAM), with
  `.github/workflows/sync-rust.yml`, hand-written `plugin.json` and `evals/`. A single Postgres skill fits this shape
  better than the csharp router setup (ADR 0001, only needed for 100+ skills).
- **Every plugin skill is listed in every project.** `paths:` doesn't gate plugin skills (ADR 0001, checked on
  2.1.272 and 2.1.296). An opt-in Postgres plugin costs one description per turn for whoever installs it.
- **What a new vendored plugin touches** (from the language-skills flow): the `marketplace.json` entry; `plugin.json`
  (same version as package.json); an `installer/core.mjs` `CATEGORIES` key (`:303-345`; `lsp` "Languages" or
  `workflow` are candidates, otherwise it lands in "Other"); the opt-ins list in `installer/core.test.mjs`; the
  README opt-in list; `scripts/sync-<x>.mjs` plus `sync-<x>.yml`; UPSTREAM/LICENSE; THIRD_PARTY.md; the CLAUDE.md
  vendored list; the `flake.nix`/`treefmt.toml` excludes. `check-repo.mjs` needs no change.
- **Defaults** are the `dead-skills` dependencies. Everything else, including the language plugins, is opt-in.
- **Vocabulary:** `GLOSSARY.md` (Picks plugin, Language plugin, Router skill, Library skill, Bundle, Opt-in).
- **Branch:** the work tree is on `feat/language-skills` (15 commits ahead of main, not merged). This feature needs
  either its own branch from main once that merges, or a branch from `feat/language-skills` if it reuses the
  `plugins/languages/` grouping.

## Prior art

Report from 2026-10-13. The research agent fetched these through sparse clones; they haven't been re-checked in this
flow.

- [neondatabase/postgres-skills](https://github.com/neondatabase/postgres-skills) `postgres-best-practices`:
  Apache-2.0, generic (zero vendor mentions, PG14–18). SKILL.md is 3.4 KB, with 13 references of 7–17 KB each.
  - It has the deepest isolation coverage (`transaction-isolation.md`) plus lock analysis, advisory locks, vacuum,
    deadlocks, SKIP LOCKED, CONCURRENTLY and NOT VALID.
  - It has no `lock_timeout` and no tags, so it would be pinned by SHA.
- [timescale/pg-aiguide](https://github.com/timescale/pg-aiguide) `postgres-database-migration`: Apache-2.0, tagged
  `v0.6.x`, and the only candidate with a DDL lock reference.
  - It covers `lock_timeout` on every DDL and retry-with-timeout.
  - Correction from the builder check: it does mention providers. "Fork-Based Migration Testing" recommends Neon
    forking (SKILL.md:431) and PgDog mirroring (:448), and `references/complete-example.md:18` names Neon.
  - SKILL.md is 24.8 KB, and the repo's `postgres/references/` entries are symlinks.
- [supabase/agent-skills](https://github.com/supabase/agent-skills) `supabase-postgres-best-practices`: MIT, tagged.
  It has 31 short rules, including a `lock-*` category (advisory, deadlocks, short transactions, SKIP LOCKED).
  - It mentions "supabase" 85 times and has two RLS rules, and its description overclaims.
  - It has no isolation file and no `lock_timeout`.
- [planetscale/database-skills](https://github.com/planetscale/database-skills) `postgres`: MIT. Its MVCC and vacuum
  files are thin, it carries a vendor banner, and its SKILL.md links to upstream main by absolute URL. Rejected.
- ECC `postgres-patterns` (a Supabase digest) and awesome-copilot `postgresql-optimization` (Copilot syntax, no
  locking content). Rejected.
- Postgres docs (PG 18):
  - [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
  - [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
  - [Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- Approaches:
  1. Neon as is.
  2. Neon plus Timescale's migration skill.
  3. Supabase, stripped by transforms.
  4. A thin skill of our own that links to the docs.

## Options

- **Which upstream source(s) to vendor** (2026-10-13)
  - Offered:
    - A: Neon only.
    - B: Neon plus Timescale's `postgres-database-migration`.
    - C: Supabase, stripped of its Supabase-specific content.
  - Recommended B: migrations that block tables are the most common Postgres pitfall, and only Timescale covers them.
  - **User picked B** ("B sounds awesome").
  - Rejected:
    - A: no `lock_timeout` or migration lock guidance.
    - C: heavy transform maintenance, no isolation coverage.
    - PlanetScale: vendor banner, links to upstream main.
    - awesome-copilot and ECC.
- **Builder-check answers** (2026-10-13):
  - Provider content in the Timescale skill is accepted as is (option a).
  - Merge `feat/language-skills` first, then branch from main (option a).
  - No test questions.
  - Place it under `plugins/database/`.
  - Add version-aware semantic search over the PostgreSQL manual, which is pg-aiguide's hosted MCP server.
  - Spec rewritten to match. The plugin was renamed `postgres` (my call).
- **Grilling round 1** (2026-10-13):
  - Plugin named `postgres`.
  - One plugin for everything.
  - New "Databases" installer page.
  - "Database plugin" glossary term added.
  - Q4: the user asked whether the MCP server runs locally. It doesn't: it's hosted by TigerData, and self-hosting
    needs pgvector, embeddings and a scrape. Offered hosted, self-hosted, or dropping it, with hosted recommended.
    **The user dropped semantic search** ("then no semantic search sadly").
- ADRs: none. No decision met all three of domain-modeling's conditions; the vendoring decision is already ADR 0001's
  pattern.
- Why the user wants this: no specific incident. Claude should work better with Postgres in general, the same reason
  as the C# and Rust skills.

## Plan review

**After execution** (2026-10-13): the user asked "could we also add path limitations?". This reopened Gate 1 for the
spec's "No `paths:`" call.

- Offered:
  - A: add `paths:` the way rust-skills does.
  - B: leave it out.
  - Enable the plugin per project instead.
- Recommended B: `paths:` is ignored for plugin skills on 2.1.296, and once honored it would hide the skills from ORM
  code.
- **The user picked A** with the proposed globs.
- The spec was updated, and Task 3 added to the plan.

**Round 1** (2026-10-13). Two reviewers: correctness, and fit plus simpler. 7 findings after merging duplicates, none
dropped. The user accepted all recommendations ("yes, accept all, go native"). Changes:

1. **Blocking.** Task 2 broke `npm test`: an opt-in with no category fails `core.test.mjs:370-377`. The Databases page
   and the README edits moved into Task 2, so Task 3 is gone.
2. **Blocking.** The idempotency check couldn't pass on untracked files (`finish()` uses `git status`). It now runs
   after the commit (Task 2 Step 11).
3. The formatter check was empty, because `git diff` ignores untracked files. It moved after the commit, as
   `git status --porcelain`.
4. "Repo-root LICENSE" was ambiguous. It now says the upstream clone's root `LICENSE`/`NOTICE`, as `sync-rust.mjs:35`
   does.
5. `package.json` `files` now uses one `plugins/*/*/.claude-plugin/plugin.json` glob, and the custom glob test was
   dropped.
6. Per-skill-folder LICENSE/NOTICE/UPSTREAM is kept. The reason goes in CLAUDE.md.
7. Workflow details spelled out: `id: check`, short SHAs cut in shell.

## Integration

- 2026-10-13: user chose "Merge back to main locally" (option 1).

## Deviations

- None to the plan's interfaces or data flow.
- One test-only ruling: `assert.ok(i > 0)` was added to the Databases page test.
- Environment: pre-commit and treefmt can't write `~/.cache` in the sandbox. They ran with `PRE_COMMIT_HOME` and
  `XDG_CACHE_HOME` pointing at a temp dir.
- treefmt also reformatted 3 language-skills docs that predate this branch. Those edits were stashed as out of scope
  (`stash@{0}`).
- Final review (Opus): 0 Critical, 0 Important, ready to merge. 4 Minors deferred to the user:
  - Root LICENSE/NOTICE and the skill-root symlink aren't lstat-checked.
  - The LICENSE existence check runs after `rmSync`.
  - CLAUDE.md implies every skill folder has a NOTICE.
  - The GLOSSARY mentions an MCP server no plugin has.
- Security hook flagged `create-pull-request@v8` as unpinned. Kept, because every other sync workflow uses the same
  tag. Pinning them all would be a separate repo-wide change.

## Walkthrough

| spec goal                                                        | plan task | file:line                                                                         | test                                                                                                            |
| ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `plugins/database/` is a plugin group                            | 1         | `scripts/plugin-dirs.mjs:4`, `package.json:18`, `flake.nix:20`, `treefmt.toml:14` | `plugin-dirs.test.mjs` "a GROUPS folder is replaced by its subfolders"; `npm pack --dry-run` lists the manifest |
| Opt-in plugin `postgres` with Neon + Timescale skills, unchanged | 2         | `plugins/database/postgres/`, `.claude-plugin/marketplace.json`                   | `check-repo.mjs` (marketplace ↔ dirs, version); `core.test.mjs` opt-ins list                                    |
| Weekly sync, fail on missing/partial upstream                    | 2         | `scripts/sync-postgres.mjs:29-43`, `.github/workflows/sync-postgres.yml`          | manual: two runs (changed, then unchanged), `find -type l` empty; reviewer re-ran in a clean clone              |
| LICENSE + NOTICE shipped                                         | 2         | `sync-postgres.mjs:38-41`                                                         | manual: `ls skills/*/`                                                                                          |
| Installer "Databases" page after "Languages"                     | 2         | `installer/core.mjs:333-338`                                                      | `core.test.mjs:397`                                                                                             |
| THIRD_PARTY, CLAUDE.md, README, GLOSSARY true to the code        | 2         | `THIRD_PARTY.md`, `CLAUDE.md`, `README.md`, `GLOSSARY.md`                         | reviewer read                                                                                                   |
| `paths:` frontmatter on both skills (reopened, user picked A)    | 3         | `scripts/sync-lib.mjs` `addPaths`, `scripts/sync-postgres.mjs:10,43-45`           | `sync-lib.test.mjs` "addPaths"; manual: sync changed → commit → unchanged                                       |
