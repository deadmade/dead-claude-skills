# Repo structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugins/` follows the install layers (`default/`, `flows`, `shared/`, `opt-in/`), the two Rust crates
live in `crates/`, and every path that encodes the layout follows.

**Architecture:** Pure moves with `git mv`, then the path strings follow from the mapping table below. The only code
change is in the installer, which stops hardcoding plugin paths. The guards against a missed spot are the final
greps (Task 4) plus the existing checks (`npm test`, cargo, mod tests, `nix build`, pre-commit).

**Tech Stack:** Node ≥ 20.12 stdlib (ESM), `node --test`, Cargo, Nix flake + git-hooks.nix + treefmt, GitHub
Actions.

**Spec:** [spec.md](spec.md)

## Global Constraints

- Plugin `name`s never change. Neither do marketplace name, versions, release asset names or `userConfig` keys.
- No version bump: everything stays at the current version (`npm run release` is not part of this).
- Vendored folders move as a whole; their content is not edited (CLAUDE.md "Vendored content: don't edit").
- In-plugin layout (`skills/<name>/SKILL.md`, `library/`, `.claude-plugin/`) and `docs/features/<slug>/flow.md`
  stay as they are.
- Historical docs under `docs/features/*` (other than `repo-structure`) and `docs/superpowers/*` are not edited.
- Node stdlib only; no new dependency.
- Work happens in a fresh git worktree (superpowers:using-git-worktrees). The untracked `plugins/feature-flow/`
  leftover exists only in the main checkout, so it never enters the worktree; nobody deletes it as part of this
  plan (dcg blocks `rm -r`; the user removes it with `!` when they like).
- Every commit runs with hooks generated from the current `flake.nix`: after any `flake.nix` edit, `git add flake.nix`
  and commit via `nix develop -c git commit …` (the shellHook regenerates `.pre-commit-config.yaml`). Never
  `--no-verify`.
- Commit messages are one sentence; no co-author lines (the user's rule). Stage explicit paths, never `-a`.

## Path mapping (the single source for every edit below)

| Old                                                                                         | New                           |
| ------------------------------------------------------------------------------------------- | ----------------------------- |
| `plugins/mods/tui-review/brv`                                                               | `crates/brv`                  |
| `plugins/mcp/web-mcp/server`                                                                | `crates/web-mcp`              |
| `plugins/dead-skills`                                                                       | `plugins/default/dead-skills` |
| `plugins/mods/night-city`                                                                   | `plugins/default/night-city`  |
| `plugins/mcp/mcp-basic`                                                                     | `plugins/default/mcp-basic`   |
| `plugins/flows`                                                                             | unchanged                     |
| `plugins/{mattpocock-picks,pstack-picks,tob-picks,self-review,paper-lookup,graphify}`       | `plugins/shared/<same>`       |
| `plugins/mods/tui-review`, `plugins/mcp/web-mcp`                                            | `plugins/shared/<name>`       |
| `plugins/{notify,nix-lsp,hallmark}`                                                         | `plugins/opt-in/<same>`       |
| `plugins/mods/cswap`, `plugins/languages/{rust,csharp}-skills`, `plugins/database/postgres` | `plugins/opt-in/<name>`       |
| `plugins/mcp/{mcp-github,mcp-azure}`                                                        | `plugins/opt-in/<name>`       |

Globs: `plugins/languages/*/X` becomes `plugins/opt-in/*-skills/X` (only rust-skills and csharp-skills match),
`plugins/database/*/skills` becomes `plugins/opt-in/postgres/skills`. The same applies to `join(…, 'plugins', …)`
segment forms in scripts.

## Review Focus

1. **A fresh `npx` install** reads the bundle and plugin manifests from the npm package: every moved `plugin.json`
   must still be in `package.json` `files`. Task 3 compares `npm pack --dry-run` with the marketplace.
2. **The installer at startup** must not read a path that's gone (the bug on `main` today). Task 1 adds a test that
   fails when `install.mjs` joins a literal `plugins` path.
3. **A commit after the move** runs pre-commit: stale excludes would rewrite vendored files (9 rust-skills
   references lack a final newline). Tasks 3 and 4 regenerate the hooks and run `pre-commit run --all-files`.
4. **A weekly sync** must write to the new folder. Task 3 checks that every path in the workflows exists, and
   Task 4's grep catches every old `join(ROOT, 'plugins', …)` destination.
5. **A brv format change** must still trigger tui-review CI: `tui-review.yml` `paths` lists both `crates/brv/**`
   and the tui-review plugin (Task 2, renamed in Task 3).

---

### Task 0: Bring the design docs into the worktree

**Files:** `docs/features/repo-structure/{flow,spec,plan}.md`, `GLOSSARY.md` (uncommitted in the main checkout).

- [ ] **Step 1:** Copy them from the main checkout into the worktree (same paths).
- [ ] **Step 2:** `git add docs/features/repo-structure GLOSSARY.md && git commit -m "Add the repo-structure design and the layer terms to the glossary."`
- [ ] **Step 3:** Note in flow.md that the main checkout's uncommitted copies must be removed before the branch is
      merged there (git refuses to overwrite untracked files).

### Task 1: Installer resolves plugin folders without fixed paths

**Files:**

- Modify: `installer/install.mjs:316` (delete `BIN_VERSION`), `:363,560,565` (use `VERSION`), `:519` (`bundle`)
- Modify: `installer/core.test.mjs:57` (`bundle` fixture), `:400-403` (brv version test)
- Test: `installer/core.test.mjs`

**Interfaces:**

- Consumes: `manifestPath(manifest, id)` from `installer/core.mjs:43` (returns `<source>/.claude-plugin/plugin.json`
  or null), `BUNDLE` (`'dead-skills'`, exported by core.mjs), `VERSION` (`install.mjs:92`, package.json's version).
- Produces: nothing new; later tasks rely on the installer having no `'plugins'` path literal.

- [ ] **Step 1: Write the failing test** in `installer/core.test.mjs`

```js
test('install.mjs finds plugin folders through the marketplace, never by a literal plugins/ path', () => {
  const src = readFileSync(new URL('./install.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /join\(PKG, 'plugins'/);
});
```

- [ ] **Step 2: Run** `node --test installer/core.test.mjs` — expected: this test FAILS.

- [ ] **Step 3: Implement**
  - Delete `BIN_VERSION` (`:316`) and its comment; use `VERSION` at its three uses. check-repo forces every
    plugin.json and both crates to package.json's version, and release.yml requires the tag to equal it, so this is
    the same value. (Spec change, approved in plan review round 1.)
  - `:519`: `const bundle = readJson(join(PKG, manifestPath(manifest, BUNDLE)));`
  - `core.test.mjs:57`: `const bundle = json(manifestPath(marketplace, BUNDLE));` (add `BUNDLE` to the import list).
  - `core.test.mjs:400-403`: compare brv's `Cargo.toml` version with `json('package.json').version`, which is what
    the installer fetches now (path to Cargo.toml stays as is until Task 2).

- [ ] **Step 4: Run** `npm test` — expected: PASS, ending `✓ repo checks passed`, all suites ok.
      (No smoke run of install.mjs: without a TTY it exits at line 96, before the reads this task changes.)

- [ ] **Step 5: Commit:** `git add installer/install.mjs installer/core.test.mjs && git commit -m "Make the installer find the bundle through the marketplace and take the binary version from package.json."`

### Task 2: Move the Rust crates to `crates/`

**Files:**

- Move: `plugins/mods/tui-review/brv` → `crates/brv`, `plugins/mcp/web-mcp/server` → `crates/web-mcp`
- Modify:
  - `scripts/check-repo.mjs:74-75` (`CRATES`), `scripts/release.mjs:44-45`
  - `flake.nix:82-83,88-89,101-102` (crate paths); `:64` and `:71` hook `files`: add `crates/` to both alternations
  - `.gitignore:8-9` → one line `target/`
  - `installer/core.test.mjs:401` (Cargo.toml path)
  - `installer/install.mjs:372` build hint →
    ``build it with `cargo build --release` in crates/${pluginName === 'web-mcp' ? 'web-mcp' : 'brv'} and set its path with /plugin configure ${pluginName}``
  - `.github/workflows/tui-review.yml`: `paths` `['crates/brv/**', 'plugins/mods/tui-review/**']`,
    `working-directory`/`workspaces` `crates/brv`, line 49 `node ../../plugins/mods/tui-review/tests/make-fixture.mjs`
  - `.github/workflows/web-mcp.yml`: `paths` `['crates/web-mcp/**', 'plugins/mcp/web-mcp/**']`, working dir and
    `workspaces` `crates/web-mcp`; `build-brv.yml:29,42`, `build-web-mcp.yml:26,39`
  - `plugins/mods/tui-review/tests/make-fixture.mjs:2` usage line, `plugins/mods/tui-review/README.md:16,87-89`
    (build and `cd …/brv` commands), `plugins/mcp/web-mcp/README.md:53`

**Interfaces:** Produces the crate paths `crates/brv` and `crates/web-mcp` used by Tasks 3 and 4.

- [ ] **Step 1:** `mkdir crates && git mv plugins/mods/tui-review/brv crates/brv && git mv plugins/mcp/web-mcp/server crates/web-mcp`
      (`git mv` moves the ignored `target/` along).
- [ ] **Step 2:** Apply the two crate rows of the mapping to every file listed above.
- [ ] **Step 3: Run**
  - `npm test` — PASS (check-repo reads the new Cargo paths).
  - `cargo test && cargo clippy --all-targets -- -D warnings` in `crates/brv` and in `crates/web-mcp` — PASS.
  - `git add -A && nix build .#brv .#web-mcp --no-link` — builds (flakes see only tracked/staged files).
  - tui-review mod tests: from `crates/brv`,
    `cargo run --release -- gen --out $TMPDIR/fx && node ../../plugins/mods/tui-review/tests/make-fixture.mjs $TMPDIR/fx`,
    then `claude plugin test .` in `plugins/mods/tui-review` — PASS.
  - `nix develop -c pre-commit run --all-files` — all hooks pass, no files changed.
- [ ] **Step 4: Commit:** `nix develop -c git commit -m "Move the brv and web-mcp crates out of their plugins into crates/."`

### Task 3: Move the plugins into the layers

**Files:**

- Move: every plugin row of the mapping (`git mv`), then `rmdir plugins/{mods,mcp,languages,database}`.
- Modify:
  - `.claude-plugin/marketplace.json` — every local `source`
  - `scripts/plugin-dirs.mjs:4` — `GROUPS = ['default', 'shared', 'opt-in']`; `scripts/plugin-dirs.test.mjs`
    fixture dirs and asserts to the new groups (e.g. `plugins/opt-in/cswap` listed, `plugins/opt-in` itself not)
  - `scripts/check-repo.mjs:13` — `BUNDLE = 'plugins/default/dead-skills/.claude-plugin/plugin.json'`
  - `scripts/draw-mascot.mjs:2,10,24` and `scripts/draw-mascot.test.mjs:45-47` — `default/night-city/assets`,
    `opt-in/notify/icon.png`
  - `scripts/sync-*.mjs` destinations: csharp:1,157, graphify:1,20, hallmark:14, mattpocock:1,42, paper-lookup:12,
    postgres:12, pstack:1,166, rust:10, self-review:1,22, tob:1,75 (only the `ROOT`-based ones; upstream
    `plugins/...` paths inside clones stay)
  - `installer/core.test.mjs:99-101,392,402` (`:519-543` fixture strings stay: they test functions, not the tree)
  - `package.json:9` test glob → `plugins/opt-in/notify/hooks/*.test.mjs`; `files` globs unchanged
    (`plugins/*/` covers flows, `plugins/*/*/` the layers)
  - `.gitignore`: `plugins/shared/tui-review/tests/fixture.gen.ts`; types → `plugins/**/.claude-plugin/types/`
  - `flake.nix:20`, the `vendored` list, exactly:
    `"^plugins/shared/(paper-lookup|mattpocock-picks|pstack-picks|tob-picks|graphify)/" "^plugins/opt-in/hallmark/" "^plugins/opt-in/(rust|csharp)-skills/(library/|skills/|LICENSE$|UPSTREAM$)" "^plugins/opt-in/postgres/skills/" "^plugins/shared/self-review/(LICENSE|agents/|skills/self-review/references/upstream/)"`;
    `:44` and `:71` notify paths → `plugins/opt-in/notify/hooks/`
  - `treefmt.toml:5-17` excludes, the same set in glob form (`plugins/opt-in/*-skills/library/**` etc.)
  - `.github/workflows/test.yml:37,41,45`; `tui-review.yml` and `web-mcp.yml` plugin `paths`, the mod working dir
    and the make-fixture path (`../../plugins/shared/tui-review/tests/make-fixture.mjs`); every `sync-*.yml` sanity
    step and `add-paths`

**Interfaces:** Consumes the crate paths of Task 2. Produces the final plugin paths Task 4's docs describe.

- [ ] **Step 1:** `mkdir plugins/default plugins/shared plugins/opt-in`, then the `git mv`s, then the `rmdir`.
- [ ] **Step 2:** Apply the plugin rows of the mapping to every file listed above.
- [ ] **Step 3: Run**
  - `git add -A && nix develop -c true` (regenerates the hooks from the new `flake.nix`).
  - `npm test` — PASS.
  - `node --test --test-reporter=tap plugins/opt-in/notify/hooks/*.test.mjs | grep -E '^# tests [1-9]'` — prints a
    line (notify's tests ran; a glob matching nothing exits 0 with `# tests 0`).
  - Package check — prints `ok`:
    `test "$(npm pack --dry-run 2>&1 | grep -c '\.claude-plugin/plugin\.json')" = "$(node -e "console.log(require('./.claude-plugin/marketplace.json').plugins.filter(p=>typeof p.source==='string').length)")" && echo ok`
  - Workflow paths exist — no output:
    `grep -ohE "(^|[[:space:]'\"=])(plugins|crates)/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*" .github/workflows/*.yml | sed -E "s/^[[:space:]'\"=]//" | sort -u | while read -r p; do test -e "$p" || echo "missing $p"; done`
    (the leading-character class skips upstream URLs like `github.com/cursor/plugins/commit/…`; on today's tree it
    finds 61 paths and reports none missing)
  - `claude plugin test .` in `plugins/opt-in/cswap`, `plugins/default/night-city`, `plugins/flows`, and
    tui-review (fixture as in Task 2, path `plugins/shared/tui-review`) — PASS.
  - `nix fmt && git diff --exit-code` — exit 0 (everything is staged, so only formatter edits would show).
  - `nix develop -c pre-commit run --all-files` — all hooks pass, no files changed.
  - `nix build .#brv .#web-mcp --no-link` — builds.
- [ ] **Step 4: Commit:** `nix develop -c git commit -m "Group plugins by install layer: default, shared and opt-in, with flows on top."`

### Task 4: Docs follow the layout

**Files:**

- Modify: `CLAUDE.md` (Layout section rewritten around the layers and `crates/`, including `:17-18` `brv/`,
  `brv/src/format.rs` and `:24` `server/`; vendored list; Versions; Checks commands, with the fixture command
  `node ../../plugins/shared/tui-review/tests/make-fixture.mjs` from `crates/brv`), `README.md` (plugin README
  links, mascot image `plugins/default/night-city/assets/mascot-512.png`), `THIRD_PARTY.md`,
  `docs/adr/0001-vendor-language-skills.md:4`
- Modify: `plugins/flows/references/flow-rules.md:44-45` — checkout hint becomes "in a checkout of this marketplace:
  the folder its marketplace `source` names, then `skills/<name>/SKILL.md`"
- Modify: comments in `installer/view.mjs:7`, `plugins/shared/tui-review/hooks/theme.ts:1,24`, `chunks.ts:1`
  (`crates/brv/src/...`), `plugins/shared/tui-review/README.md:81-99`
- GLOSSARY.md is committed in Task 0.

- [ ] **Step 1:** Edit the files above per the mapping. CLAUDE.md's layout bullets name the four layers, say flows
      sits on top, `crates/` holds brv and web-mcp, and that the brv ↔ tui-review contracts span `crates/brv` and
      `plugins/shared/tui-review`.
- [ ] **Step 2: Run the stale-path guards** — expected: no output from any of the three.

```bash
EX=(-- ':!docs/features' ':!docs/superpowers' ':!plugins/opt-in/*-skills/library' ':!plugins/opt-in/*-skills/skills')
# slash paths
git grep -nE 'plugins/(mods|mcp|languages|database)/|plugins/(dead-skills|nix-lsp|mattpocock-picks|pstack-picks|tob-picks|graphify|self-review|hallmark|paper-lookup|notify)\b|tui-review/brv|web-mcp/server|cd plugins/' "${EX[@]}"
# join() segment forms
git grep -nE "(PLUGINS|'plugins'), '(mods|mcp|languages|database|dead-skills|nix-lsp|mattpocock-picks|pstack-picks|tob-picks|graphify|self-review|hallmark|paper-lookup|notify)'" -- scripts installer
# relative crate mentions
git grep -nE '(^|[^/a-z-])brv/(src|Cargo)|manifest-path brv/|`server/`' "${EX[@]}"
```

- [ ] **Step 3: Run** `npm test`, `nix fmt && git diff --exit-code` and `nix develop -c pre-commit run --all-files`
      — all pass.
- [ ] **Step 4: Before merging:** `gh pr list --state open --search 'sync in:title'`. Every open sync PR writes to
      the old paths: list them for the user to close (the next weekly run reopens them on the new paths).
- [ ] **Step 5: Commit:** `git add CLAUDE.md README.md THIRD_PARTY.md docs/adr plugins installer && nix develop -c git commit -m "Describe the layered plugin layout and crates/ in the docs."`
