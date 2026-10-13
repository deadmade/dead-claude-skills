# Postgres skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in plugin `postgres` in a new `plugins/database/` group. It vendors Neon's `postgres-best-practices`
and Timescale's `postgres-database-migration` skills, syncs them weekly, and appears on a new "Databases" page in the
installer.

**Architecture:**

- `scripts/plugin-dirs.mjs` gains a second grouping folder, `database`.
- One sync script, `scripts/sync-postgres.mjs`, copies both upstream skill folders. Each folder gets its own LICENSE,
  (NOTICE) and UPSTREAM, so `finish()` from `sync-lib.mjs` works per folder unchanged.
- The installer gets one new `CATEGORIES` entry.

**Tech Stack:** Node ≥20.12, standard library only, `node:test`; GitHub Actions.

**Spec:** `docs/features/postgres-skills/spec.md`. Read it first. Also read `GLOSSARY.md` ("Database plugin") and,
for the pattern, `scripts/sync-rust.mjs` and `.github/workflows/sync-rust.yml`.

## Global Constraints

- **Prerequisite:** `feat/language-skills` is merged into `main`. It introduces `GROUPS`, `plugins/languages/` and the
  installer's "Languages" page. Work on a fresh branch off `main`, such as `feat/postgres-skills`. If it isn't merged
  yet, stop and ask the user.
- Node standard library only, no npm dependencies.
- Plugin name `postgres`, folder `plugins/database/postgres/`. `plugins/database/` has no `plugin.json`.
- The new `plugin.json` has `"version"` equal to `package.json`'s. Never bump it by hand.
- Upstreams, both following `main`:
  - `https://github.com/neondatabase/postgres-skills.git`, folder `skills/postgres-best-practices`, Apache-2.0.
  - `https://github.com/timescale/pg-aiguide.git`, folder `skills/postgres-database-migration`, Apache-2.0 with a
    root `NOTICE`.
- Vendored content is copied unchanged: no frontmatter edits, no `paths:`.
- Generated, written only by the sync: `plugins/database/postgres/skills/**`. Hand-written: `.claude-plugin/plugin.json`.
- Repo-relative paths in new test code use `/`, because CI also runs on Windows.
- Commit messages are one sentence, with no co-author lines.

## Review Focus

1. **An upstream symlink.** pg-aiguide's umbrella `postgres/references/` entries are symlinks. A copied link would
   point outside the plugin and break on install, so the sync fails if it finds one in a vendored folder (Task 2).
2. **An upstream folder or SKILL.md renamed or removed.** The sync fails and does not commit an empty skill (Task 2).
3. **A plugin missing from the npm package.** The installer reads versions from manifests shipped through
   `package.json` `files`. One `plugins/*/*/...` glob covers every group (Task 1).
4. **Re-running the sync with no upstream change** leaves the tree clean and UPSTREAM untouched. Task 2 checks this
   after committing.
5. **Formatter churn on vendored files.** Without the `flake.nix` and `treefmt.toml` excludes, `nix fmt` rewrites
   upstream markdown and every sync PR fights it. Task 2 checks this after committing.

---

### Task 1: `plugins/database/` as a plugin group

**Files:**

- Modify: `scripts/plugin-dirs.mjs:4`
- Modify: `scripts/plugin-dirs.test.mjs:10-14`
- Modify: `package.json:17-18` (`files`)
- Modify: `flake.nix:20` (`vendored`), `treefmt.toml:10-13` (excludes)

**Interfaces:**

- Produces: `GROUPS = ['languages', 'database']`. `pluginDirs()` returns `plugins/database/<name>` for each subfolder.

- [ ] **Step 1: Write the failing test.** Extend the fixture test in `scripts/plugin-dirs.test.mjs` to also create
      `database/z`. Expect `['plugins/a', 'plugins/database/z', 'plugins/languages/x', 'plugins/languages/y']`.
- [ ] **Step 2: Run** `node --test scripts/plugin-dirs.test.mjs`. Expected: FAIL, because `plugins/database` is
      listed as a single dir.
- [ ] **Step 3: Implement.**
  - Set `GROUPS = ['languages', 'database']`.
  - In `package.json` `files`, replace `"plugins/languages/*/.claude-plugin/plugin.json"` with
    `"plugins/*/*/.claude-plugin/plugin.json"`. Grouping folders have no `.claude-plugin`, so the glob matches nothing
    extra.
  - Add `"^plugins/database/[^/]+/skills/"` to `vendored` in `flake.nix`.
  - Add `"plugins/database/*/skills/**"` to the `treefmt.toml` excludes.
- [ ] **Step 4: Run** `node --test scripts/plugin-dirs.test.mjs`, `npm test` and
      `npm pack --dry-run 2>&1 | grep plugin.json`. Expected: tests PASS, and the pack list still includes
      `plugins/languages/rust-skills/.claude-plugin/plugin.json` and `csharp-skills`'.
- [ ] **Step 5: Commit** `git commit -m "Add plugins/database as a plugin group."`

### Task 2: The `postgres` plugin, its sync and its installer page

**Files:**

- Create: `scripts/sync-postgres.mjs`
- Create: `.github/workflows/sync-postgres.yml`
- Create: `plugins/database/postgres/.claude-plugin/plugin.json`
- Generated by the sync: `plugins/database/postgres/skills/{postgres-best-practices,postgres-database-migration}/`
- Modify: `.claude-plugin/marketplace.json` (new entry after `csharp-skills`)
- Modify: `installer/core.mjs:303-345` (`CATEGORIES`)
- Modify: `installer/core.test.mjs`:
  - the opt-ins list at `:49-75` gets `'postgres'`
  - a new test next to the Languages page test at `:390`
- Modify: `THIRD_PARTY.md` (a new `## postgres` section after csharp-skills), `CLAUDE.md` (the vendored list and
  Layout), `README.md:13-19` (the opt-in list) and `README.md:35` (the start-screen category list)

**Interfaces:**

- Consumes: `ROOT`, `fail`, `finish`, `git`, `sparseClone` from `scripts/sync-lib.mjs`; the group from Task 1.
- Produces:
  - The plugin `postgres@dead-claude-skills`, with source `./plugins/database/postgres`.
  - Each skill folder holds `SKILL.md`, its upstream content, `LICENSE` and `UPSTREAM` (one SHA). pg-aiguide's folder
    also holds `NOTICE`.
  - The `CATEGORIES` entry
    `{ id: 'database', title: 'Databases', blurb: 'Best-practice skills for the databases you work with.', keys: ['postgres'] }`,
    placed directly after the `lsp` entry.

- [ ] **Step 1: Write the failing test** `the Databases page follows Languages and lists postgres` in
      `installer/core.test.mjs`:
  - Find the index `i` of the entry with `id === 'database'`.
  - Assert `CATEGORIES[i].title === 'Databases'`, that `CATEGORIES[i].keys` includes `'postgres'`, and that
    `CATEGORIES[i - 1].id === 'lsp'`.
  - Also add `'postgres'` to the opt-ins list.
- [ ] **Step 2: Run** `node --test installer/core.test.mjs`. Expected: FAIL. The new test finds no `database` entry,
      and the opt-ins list doesn't match yet.
- [ ] **Step 3: Write `scripts/sync-postgres.mjs`.**
  - Give it a header comment in the style of `sync-rust.mjs`.
  - Drive it from a table of the two upstreams: `{ url, path, name, extra: ['NOTICE'] | [] }`.
  - For each upstream:
    - `sparseClone(url, [path])`. Cone mode also checks out the clone's root files.
    - `fail` if `${path}/SKILL.md` is missing.
    - `fail` if any entry under the folder is a symlink, naming the path. Check with
      `lstatSync(...).isSymbolicLink()` over a recursive `readdirSync`.
    - `rmSync` the destination skill folder, then `cpSync` the upstream folder into it.
    - Copy the upstream clone's root `LICENSE` (`join(up, 'LICENSE')`, as `sync-rust.mjs:35` does) and each `extra`
      file from the clone root into the skill folder. `fail` if any of them is missing.
    - Call `finish(name, git('-C', up, 'rev-parse', 'HEAD'), <dest>/UPSTREAM, <dest>)`.
- [ ] **Step 4: Run** `node scripts/sync-postgres.mjs`. It needs network access to github.com.
  - Expected: two "synced to <sha> (changed)" lines.
  - `find plugins/database/postgres -type l` prints nothing.
  - Each of `ls plugins/database/postgres/skills/*/` shows `SKILL.md`, `LICENSE` and `UPSTREAM`, and pg-aiguide's
    also shows `NOTICE`.
- [ ] **Step 5: Write `plugin.json`, the marketplace entry and the `CATEGORIES` entry.**
  - `plugin.json` copies the fields of `plugins/languages/rust-skills/.claude-plugin/plugin.json`, with
    `"name": "postgres"`, `"license": "Apache-2.0"` and the repo version.
  - Description for both `plugin.json` and the marketplace entry: `"Postgres best practices (Neon's
postgres-best-practices) and safe, non-blocking migrations (Timescale pg-aiguide's
postgres-database-migration). Vendored, synced weekly. Opt-in."`
  - The marketplace entry uses `"category": "development"`.
  - Add the `CATEGORIES` entry exactly as in Interfaces.
- [ ] **Step 6: Run** `npm test`. Expected: PASS. `claude plugin validate` runs if `claude` is on PATH.
- [ ] **Step 7: Write `.github/workflows/sync-postgres.yml`**, modelled on `sync-rust.yml`:
  - `name: Sync postgres`, cron `'0 8 * * 1' # Mondays 08:00 UTC` (a free slot), and `workflow_dispatch`.
  - Run `node scripts/sync-postgres.mjs`.
  - Sanity step with `id: check`:
    - `jq empty` on the marketplace and the new `plugin.json`.
    - `test -s` on both `SKILL.md` files.
    - Write the outputs in shell:
      `echo "neon=$(cat plugins/database/postgres/skills/postgres-best-practices/UPSTREAM)" >> "$GITHUB_OUTPUT"`,
      `echo "pgai=$(cat …/postgres-database-migration/UPSTREAM)" >> "$GITHUB_OUTPUT"`, and `neon7` and `pgai7` cut
      with `cut -c1-7` the same way. Expressions have no substring function.
  - Open the PR with `branch: sync/postgres`, `delete-branch: true`, and
    `add-paths: plugins/database/postgres`.
    - Commit message and title: `Sync postgres to neon ${{ steps.check.outputs.neon7 }}, pg-aiguide ${{ steps.check.outputs.pgai7 }}`.
    - Body: links to both upstream commits, using the full SHAs, then `cc @deadmade`.
- [ ] **Step 8: Update the docs.**
  - **THIRD_PARTY.md, `## postgres`:**
    - What is vendored from each upstream. Both are Apache-2.0, unmodified.
    - Where LICENSE and NOTICE are.
    - `scripts/sync-postgres.mjs`, `sync-postgres.yml`, and the UPSTREAM files in each skill folder.
  - **CLAUDE.md:**
    - Add `plugins/database/*/skills/` to the vendored list.
    - Mention `database` in the `GROUPS` note.
    - Add a Layout bullet for `plugins/database/`, a grouping folder like `languages/` where each folder is a database
      plugin. `postgres` vendors two skills from two upstreams (`sync-postgres.mjs`). Because there are two
      upstreams, each skill folder carries its own LICENSE, NOTICE and UPSTREAM, unlike the language plugins, which
      keep them at the root.
  - **README.md:**
    - In the opt-in list, add "the database plugin postgres (Neon's postgres-best-practices and Timescale's
      postgres-database-migration skills)".
    - In the start-screen category list at `:35`, add "databases" after "language servers".
- [ ] **Step 9: Run** `npm test`. Expected: PASS.
- [ ] **Step 10: Commit** `git commit -m "Add the postgres plugin vendoring Neon's and Timescale's Postgres skills, with a weekly sync and a Databases installer page."`
- [ ] **Step 11: Check that re-running the sync and the formatter changes nothing.**
  - Run `node scripts/sync-postgres.mjs`. Expected: two "unchanged at <sha> (no vendored changes)" lines.
  - Run `nix fmt` if available.
  - Then `git status --porcelain plugins/database/postgres` prints nothing.
  - If anything shows up, fix the cause (the exclude, or the sync's copy step) and amend the commit.

### Task 3: `paths:` frontmatter (added after execution, 2026-10-13)

**Files:**

- Modify: `scripts/sync-lib.mjs`. It gains `addPaths(text, globs)`, moved unchanged from `scripts/sync-rust.mjs:13-26`.
- Modify: `scripts/sync-lib.test.mjs`, `scripts/sync-rust.mjs` (import it), `scripts/sync-postgres.mjs`.
- Regenerated: both `plugins/database/postgres/skills/*/SKILL.md`.
- Modify: `THIRD_PARTY.md` (`## postgres`: the paths block is the one modification), `CLAUDE.md` if it says
  "unmodified".

**Interfaces:**

- Produces: `addPaths(text: string, globs: string[]) => string | null`. It inserts `paths:` plus `  - "<glob>"` lines
  before the first frontmatter's closing `---`. It returns null when there is no frontmatter or `paths:` already
  exists.

- [ ] **Step 1: Write the failing test** `addPaths` in `sync-lib.test.mjs`. Check that:
  - It inserts before the closing `---`.
  - It works after a `description: |` block scalar.
  - It returns null with no frontmatter.
  - It returns null when `paths:` is present.
- [ ] **Step 2: Run it.** Expected: FAIL, because sync-lib has no `addPaths` export.
- [ ] **Step 3: Implement.**
  - Move `addPaths` into `sync-lib.mjs` and import it in `sync-rust.mjs`.
  - In `sync-postgres.mjs`, after the copy, apply
    `GLOBS = ['**/*.sql', '**/migrations/**', '**/migrate/**', '**/*.prisma', '**/alembic/**']` to each `SKILL.md`.
    `fail` on null.
- [ ] **Step 4: Run** `npm test` and `node scripts/sync-postgres.mjs`. Expected: tests PASS, two "changed" lines, and
      both SKILL.md files have the `paths:` block.
- [ ] **Step 5: Commit.** Then re-run the sync. Expected: two "unchanged" lines, and a clean
      `git status --porcelain plugins/database`.
