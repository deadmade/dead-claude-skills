---
phase: execute
---

# Repo structure refactor: flow

## Request

> Hey, could we make a plan to refactor the repository. I dont really like the overall structure

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs:
- GLOSSARY.md: [Default plugin, Shared plugin, Opt-in](../../../GLOSSARY.md) (this repo calls CONTEXT.md GLOSSARY.md)

## Gates

- Gate 1, spec approved: 2026-10-17 ("lgtm"); ADR offered, not taken up
- Gate 2, plan approved: 2026-10-17 ("lets go and native"), execution: native

## Skipped

## Grounding

- 23 plugins: 12 top level (`plugins/<name>`), 8 in GROUPS folders (`languages`, `database`, `mcp`, `mods`;
  `scripts/plugin-dirs.mjs:4`), 3 url-sourced. Own code, vendored content and bundles are mixed at the top level.
  Naming varies (`*-picks`, `*-skills`, `mcp-*` vs `web-mcp`). Only 5 of 23 have a README.
- The layout is written down in about 8 places with no shared source: `GROUPS`; the vendored list in
  `treefmt.toml:5-17`, `flake.nix:20`, CLAUDE.md and THIRD_PARTY.md; the crate paths in `check-repo.mjs:74-75`,
  `release.mjs:44-45`, `flake.nix:82-102` and 4 workflows; the test globs in `package.json:10` and `flake.nix:71`;
  sync destinations in each `sync-*.mjs`; `add-paths` in each `sync-*.yml`; `package.json` `files` (depth 2 max);
  `.gitignore` (`plugins/*/.claude-plugin/types/` misses grouped plugins).
- Path-agnostic already: installer `manifestPath` (core.mjs:45), `flows-uses.mjs` (via marketplace `source`),
  `BIN_ONLY`/`INCLUDED` (by name).
- **Live bug from the last regroup:** `installer/install.mjs:316` reads `plugins/tui-review/.claude-plugin/plugin.json`,
  which no longer exists (now `plugins/mods/tui-review`), so the installer throws at load. `install.mjs:372` hint also
  omits the group. `install.mjs:519` assumes `plugins/dead-skills`. No test covers install.mjs.
- `flows/references/flow-rules.md:44` hops `../../../../<plugin>/*/skills/...` in the install cache, which is
  `cache/<marketplace>/<name>/<version>/` (seen on disk: `cache/dead-claude-skills/pstack-picks/0.3.0/skills/`), so
  it keys on plugin names, not repo folders.
- **Free to move:** plugin folders and group folders, if `source` and the lockstep list change in the same commit
  (installed identity is `name@dead-claude-skills`). **Contracts:** plugin `name`s (a rename = installer's
  `retiredPlugins`, core.mjs:212, uninstalls it and loses its userConfig), marketplace name, repo slug and `v*` tags,
  release asset names, `userConfig` keys, in-plugin `skills/<name>/SKILL.md` depth, `.claude-plugin/` locations,
  `docs/features/<slug>/flow.md` in users' repos.
- CI: 20 workflows, 1,105 lines; 10 weekly `sync-*.yml` are near copies (e.g. sync-rust vs sync-hallmark differ only
  in names, cron, sanity grep, PR body). 10 sync scripts share `sync-lib.mjs` but each repeats the copy block.
  UPSTREAM/LICENSE placement differs per vendored plugin (root, `skills/<name>/`, per skill).
- `installer/` mixes code with shipped data (`ccstatusline*.json`, `searxng.yml`) and pins (`cswap.json`,
  `agent-browser.json`).
- docs: `docs/features/<slug>/` is current (parsed by the flows mod); `docs/superpowers/{specs,plans}` holds 2 older
  pairs; `docs/adr/` 1 ADR. Empty untracked dirs: `docs/features/{band-test,band-test-research,code-rules}`,
  `plugins/feature-flow/` (leftover; `pluginDirs()` would count it).

## Prior art

- **A Flat `plugins/<name>`**, grouping via marketplace `category`/tags: anthropics/claude-code
  [plugins/](https://github.com/anthropics/claude-code/tree/main/plugins), wshobson/agents (94 plugins, `tools/` beside).
- **B Split by ownership**, `plugins/` (own) vs `external_plugins/`:
  [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official). Vendoring "don't edit"
  becomes one folder rule (one treefmt/pre-commit exclude). Mixed plugins (hand-written plugin.json + vendored skills)
  blur it.
- **C Split by kind** (today's `mcp/`, `mods/`…; Turborepo `packages/group/*`,
  [no nesting beyond that](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)).
- **D Catalog only, pin upstreams** (`git-subdir`/`url` + `sha`, `strict: false` + `skills: [...]`): superpowers-
  marketplace, most of the official marketplace. Can't apply this repo's sync transforms (csharp routers).
- Docs: relative `source` may nest, must start `./`
  ([ref](https://code.claude.com/docs/en/plugins/marketplace-reference#relative-path-plugin-source)); entry name is
  the identity and cache dir, folder is not ([loading](https://code.claude.com/docs/en/plugins/loading#entry-name-and-manifest-name));
  renaming `name` breaks installs, `renames` map migrates
  ([host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#rename-or-remove-a-plugin)).
- CI dedupe: one scheduled workflow with a matrix over upstreams, `fail-fast: false`; the official marketplace bumps
  all pins from one [bump-plugin-shas.yml](https://github.com/anthropics/claude-plugins-official/blob/main/.github/workflows/bump-plugin-shas.yml).
  Reusable workflows must sit directly in `.github/workflows`
  ([GitHub](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#creating-a-reusable-workflow)).

## Options

- What bothers the user: the folders don't show the install. "We have a default dead-skills but night-city theme is
  a mod, it's a default but not in the default"; flows should sit above the skills, but several flows share the
  same picks.
- Layout: offered by-layer (default / flows / shared / opt-in), flat, by-ownership, catalog-only (prior art A–D).
  Recommended and picked: **by layer** (the user's words: "lets build the" four groups). Rejected: keeping kind
  groups (today), flat, ownership split, url pins for vendored content (can't run the sync transforms).
- Enforced placement rule in check-repo (folder derived from `dependencies`): offered, **declined** ("dont really
  need that rule").

## Plan review

Round 1 (2026-10-17): three reviewers via pstack `interrogate`'s model spread (fable, opus, sonnet), all three angles
each. 1 dropped (sonnet: `rmdir` of old groups fails on ignored leftovers; opus verified `git mv` moves ignored files
too). Findings, recommendation in brackets. **User: "apply all of them"** (2026-10-17); plan rewritten, spec's
`:316` decision changed (reopened and re-approved with that answer):

1. blocking, all 3: stale pre-commit hooks after the flake.nix edit edit vendored files (9 rust-skills files lack a
   final newline) and skip notify tests. [regenerate the hooks with `nix develop -c` before the Task 3 commit and run
   `pre-commit run --all-files`]
2. blocking, fable+opus: leftover `plugins/feature-flow/` fails `npm test` now; `rm -r` is blocked by dcg. [execute
   in a fresh worktree, where it doesn't exist; the user removes the local leftover with `!`]
3. blocking, all 3: `npm pack` count is 21, not 20. [compute it from the marketplace]
4. should-fix: no `mkdir plugins/{default,shared,opt-in}` before `git mv`. [add]
5. should-fix: `flake.nix:64,71` hook `files` miss `crates/`. [add `crates/`]
6. should-fix: checks that pass while broken: notify glob matching nothing exits 0; `nix fmt` diff hidden by staged
   moves. [assert notify test count > 0; `git add -A` then `nix fmt && git diff --exit-code`]
7. should-fix, all 3: guard grep misses `join(ROOT, 'plugins', '<name>')` forms and relative `brv/src`, `cd plugins/`;
   tui-review README:81-89 and CLAUDE.md:17-18,24 unlisted. [extend the guard, list the files]
8. should-fix/consider: `sync-rust.mjs` run needs network and diffs on upstream changes. [replace with a static check
   that every path in the workflows exists]
9. consider: delete `BIN_VERSION`, use `VERSION`; retarget core.test.mjs:400-403 to package.json; drop Task 1's
   second test; commit GLOSSARY + feature docs separately (`-am` sweeps them); move the `:372` hint edit to Task 2;
   one `target/` line in .gitignore; check open sync PRs before merging; leave the null-manifestPath message.

## Deviations

- Execution in worktree `.claude/worktrees/repo-structure` (branch `repo-structure`, from local `main` cc92d49).
  Before merging into the main checkout, remove its uncommitted copies of `docs/features/repo-structure/` and
  `GLOSSARY.md` (git refuses to overwrite untracked files).

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
