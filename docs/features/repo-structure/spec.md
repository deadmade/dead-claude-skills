# Repo structure: design

## Intent

The `plugins/` tree should read the way the install works. Today it groups by kind of thing (`mods/`, `mcp/`,
`languages/`, `database/`) next to a flat top level, so nothing shows what the default is, that flows sits above the
skills it runs, or which plugins exist only as building blocks. The user: "Everything is just all over the place: we
have a default `dead-skills` but the night-city theme is a mod, it's a default but not in the default."

A folder tree can't hold the real shape exactly: dependencies form a graph, and some plugins are pulled in from
several places. The user accepted that and chose four layers, without an enforced placement rule.

## Goals

1. `plugins/` has four layers:
   - **default**: what everyone gets.
   - **flows**: the conductors.
   - **shared**: the building blocks flows pulls in.
   - **opt-in**: extras each machine chooses.
2. Every path that encodes the layout follows the move in the same change, so `npm test`, the cargo checks, the mod
   tests, CI, `nix flake check`/pre-commit and the installer all work afterwards.
3. Users who already installed something see no change. Plugin `name`s stay the same, so installed ids and
   `userConfig` survive.

## Non-goals

- No placement rule in `check-repo` that derives a plugin's folder from the `dependencies` (offered, declined).
- No plugin renames, no `renames` map in the marketplace.
- No change to what the default or flows installs. Dependencies stay as they are.
- No change to the in-plugin layout (`skills/<name>/SKILL.md`, `library/`, `.claude-plugin/`): flows' cache hop and
  the csharp routers depend on it.
- No change to `docs/features/<slug>/flow.md`: the flows mod reads it in users' repos.

## Anti-goals

- Breaking an existing install, or the npx installer, in any way.
- A layout that needs a second hand-kept list of paths. Where the layout is written down twice today, the move
  should not add a third copy.

## Target layout (my call, from the dependencies in each `plugin.json`)

```
plugins/
  default/    dead-skills  night-city  mcp-basic
  flows/      (the flows plugin itself, at the top level)
  shared/     mattpocock-picks  pstack-picks  tob-picks  self-review  paper-lookup  graphify  tui-review  web-mcp
  opt-in/     notify  cswap  nix-lsp  hallmark  rust-skills  csharp-skills  postgres  mcp-github  mcp-azure
crates/
  brv/        was plugins/mods/tui-review/brv
  web-mcp/    was plugins/mcp/web-mcp/server
```

The Rust crates leave the plugin folders (user's choice, grill Q8): nothing in tui-review or web-mcp reaches into them
at runtime (both run a downloaded or PATH binary via `userConfig`), and inside a plugin their source is copied into
every user's plugin cache for nothing. Each crate keeps its own `Cargo.lock`; no Cargo workspace. The brv ↔ tui-review
contracts (`format.rs` ↔ `chunks.ts`, `styles.rs` ↔ `theme.ts`, the stdout protocol) now span `crates/brv` and
`plugins/shared/tui-review`; tui-review's CI `paths` filter watches both.

How each plugin was placed (all my call):

- **default**: `dead-skills` is the bundle. `night-city` and `mcp-basic` are its local dependencies. `mcp-basic` is
  also a flows dependency, but everyone already has it, so it goes in default.
- **flows**: one plugin, so it stays a plain plugin folder at `plugins/flows/`, not a group folder holding one
  plugin.
- **shared**: everything flows depends on that isn't in default. `tui-review` and `web-mcp` are also offered as their
  own opt-ins (installer `CATEGORIES`), but flows pulls them in, so they go in shared. `graphify` is not in the
  installer's `INCLUDED` list but is a flows dependency.
- **opt-in**: everything nothing else depends on. Flat. The old kind groups (`mods`, `mcp`, `languages`, `database`)
  go away; the installer's pages (`CATEGORIES`, by name) and the marketplace `category` already carry the kind.
- superpowers, ponytail and atlassian are url-sourced and have no folder.

## Constraints (from grounding)

- One nesting level: `pluginDirs()` (`scripts/plugin-dirs.mjs`) expands only `GROUPS`, and `package.json` `files`
  covers `plugins/*/` and `plugins/*/*/`. New `GROUPS = ['default', 'shared', 'opt-in']`.
- A plugin moves with all of its own content. Moving folders keeps the `name`, so the install cache
  (`cache/<marketplace>/<name>/<version>/`) is unchanged.
- Places that encode the layout and must change with it:
  - `.claude-plugin/marketplace.json` `source`s
  - `scripts/` `GROUPS` (plugin-dirs), check-repo `BUNDLE` and `CRATES`, release crate dirs, flows-uses `FLOWS`,
    draw-mascot `ASSETS` (plus its test), and every `sync-*.mjs` destination
  - `installer/install.mjs:316` and `:372`, which are already broken by the last regroup (`plugins/tui-review`
    doesn't exist), and `:519`
  - `installer/core.test.mjs` path fixtures
  - the crate paths: `tests/make-fixture.mjs` usage line, the tui-review and web-mcp READMEs' build commands, the
    `brv/src/...` comments in tui-review hooks, `.gitignore` `target/` entries
  - `.github/workflows/`: the working directories and `paths` filters in test, tui-review, web-mcp, build-brv and
    build-web-mcp, and the sanity steps and `add-paths` in every `sync-*.yml`
  - `flake.nix`: the vendored regex, hook `files` filters and crate `src`/`cargoLock`
  - `treefmt.toml` excludes and `.gitignore` (whose types pattern doesn't cover grouped plugins today)
  - `package.json` `test` glob (notify's tests)
  - CLAUDE.md, README.md (including the mascot image link), THIRD_PARTY.md, GLOSSARY.md, plugin READMEs, the
    tui-review/`view.mjs` palette comments, and `docs/adr/0001`
  - `plugins/flows/references/flow-rules.md:44-45`, whose checkout hint `plugins/<plugin>/skills/...` is wrong for
    grouped plugins (my call: fix it here)
  - `GLOSSARY.md`: "Opt-in" there means anything the installer offers unpicked, which includes flows, tui-review and
    web-mcp. My call: keep the term, and say that the `opt-in/` folder holds only the opt-ins nothing else depends on.
    Drop the "under `plugins/database/`" wording.
- The untracked leftover `plugins/feature-flow/` (empty dirs only) would be counted by `pluginDirs()`. My call:
  delete it.
- The regroup that broke `install.mjs:316` (a00a627) isn't in any release yet (latest tag v0.3.0), so no hotfix
  release is needed first. Any open `sync-*` PR writes to old paths and needs closing or a rebase after the move.
- Everything ships as one version and changes only through `npm run release`, not in this change.

## Decided by the user

- Four layers: default, flows, shared, opt-in.
- No enforced placement rule.
- Grill round 1 (2026-10-17), recommendations accepted: tui-review and web-mcp in `shared/`; flows stays a plain
  plugin at `plugins/flows/`; `opt-in/` is flat; folder names `default/`, `shared/`, `opt-in/` with GLOSSARY.md
  terms to match (Default plugin, Shared plugin, Opt-in); scope is `plugins/` and what must move with it; the
  installer resolves `install.mjs:519` through `manifestPath` (marketplace `source`), with a test, instead
  of hardcoded paths. Changed in plan review round 1 (user: "apply all of them"): `:316`'s binary version is
  package.json's `VERSION`, not a manifest read; check-repo already forces every plugin onto that version.
- Grill round 2 (2026-10-17): Rust crates move to `crates/brv` and `crates/web-mcp` (option A); `mcp-basic` in
  `default/`.

## Follow-ups (out of scope here)

- One scheduled sync workflow with a matrix instead of 10 near-identical `sync-*.yml`.
- One vendored-path list instead of the copies in `flake.nix` and `treefmt.toml`.
- `docs/superpowers/` next to `docs/features/`, and the empty `docs/features/{band-test,band-test-research,code-rules}`.

## Left to the builder

- Order of the moves (one `git mv` commit is fine; history follows with `git log --follow`).
- Whether to fix the install.mjs breakage as its own first commit.
- Updating historical docs under `docs/features/*` and `docs/superpowers/*`: my call is to leave them as they are,
  since they record what was true then.
