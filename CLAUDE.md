# dead-claude-skills

A personal Claude Code plugin marketplace (`.claude-plugin/marketplace.json`, one plugin per folder under `plugins/`)
plus the npx installer in `installer/` that sets up a machine from it. README.md is the user-facing description;
keep it, plugin READMEs and plugin/marketplace `description`s true to what the code does.

The default branch is `main`. Feature branches and PRs target `main`; releases are cut from `main`.

## Layout

- `installer/`: `install.mjs` is the entry point and does all prompting and I/O; `core.mjs` holds the pure decisions
  (settings merges, plugin plans, platform rules); `files.mjs` the file writes and clean-slate backup/delete;
  `view.mjs`/`ui.mjs` the screens. No npm dependencies: Node's standard library only. New logic goes into
  `core.mjs` or `files.mjs` with a test, not into `install.mjs`.
- `plugins/tui-review/`: a Claude Code mod (TypeScript, `hooks/`) driving the Rust binary `brv` (`brv/`). The two
  share a binary cache format (`brv/src/format.rs` ↔ `hooks/chunks.ts`) and a stdout line protocol; change both sides
  together.
- `plugins/cswap/`: a mod wrapping the external `claude-swap` CLI, whose release tag is pinned in `installer/cswap.json`
  (bumped by `sync-cswap.yml`).
- `plugins/languages/`: a grouping folder (`GROUPS` in `scripts/plugin-dirs.mjs`); each folder under it is a plugin.
  `rust-skills` and `csharp-skills` are vendored (`sync-rust.mjs`, `sync-csharp.mjs`). `paths:` frontmatter doesn't
  gate plugin skills in Claude Code (checked on 2.1.272 and 2.1.296), so csharp-skills exposes six router skills over an
  unscanned `library/`; the router reads library files via the installer's `Read(~/.claude/plugins/**)` rule (without
  the installer users get a permission prompt).
- `plugins/dead-skills/`: the default bundle; its `dependencies` are the core plugins.
- `scripts/`: `check-repo.mjs` (marketplace/bundle/version consistency), `release.mjs`, `sync-*.mjs` (vendoring),
  `sync-plugins.mjs` (re-pins url-sourced plugins).

The url-sourced marketplace entries superpowers and ponytail are pinned by `ref` (release tag) and `sha` (its commit);
`sync-plugins.yml` opens a PR per plugin when upstream tags a newer `vX.Y.Z`. The installer reads the version from
the `ref`, so it must match upstream's `plugin.json`. Atlassian is deliberately unpinned.

## Vendored content: don't edit

These are copied from upstream by `scripts/sync-*.mjs` (weekly workflows open the PRs) and overwritten on every
sync: `plugins/hallmark/`, `plugins/graphify/skills/`, `plugins/mattpocock-picks/`, `plugins/pstack-picks/`,
`plugins/tob-picks/` (CC BY-SA 4.0), `plugins/languages/*/{library,skills}/`, `plugins/languages/*/LICENSE` and `UPSTREAM` (their `plugin.json` and `evals/` are hand-written), `plugins/self-review/agents/`,
`plugins/self-review/skills/self-review/references/upstream/`. To change them, change the sync script's transform.
When what's vendored or its license changes, update THIRD_PARTY.md.

## Versions and releases

Everything ships as one version: `package.json`, the marketplace's `metadata.version`, every `plugins/*/.claude-plugin/plugin.json`
and brv's `Cargo.toml`/`Cargo.lock`. `check-repo.mjs` fails on drift. Never bump by hand:

    npm run release -- patch      # on main, clean tree; bumps, runs npm test, commits and tags
    git push --follow-tags origin main

The `v*` tag runs `release.yml`, which builds brv and cswap.exe and publishes the GitHub release the installer
downloads from. Removing a plugin from the marketplace is enough to retire it: the installer uninstalls installed
plugins of ours that the manifest no longer lists.

## Checks

- `npm test`: repo checks plus all `installer/*.test.mjs` and `scripts/*.test.mjs` (`claude plugin validate` is skipped when `claude` isn't
  on PATH).
- brv: `cargo test` and `cargo clippy --all-targets -- -D warnings` in `plugins/tui-review/brv`.
- tui-review mod tests need a generated fixture first, from `plugins/tui-review/brv`:
  `cargo run --release -- gen --out <dir> && node ../tests/make-fixture.mjs <dir>`, then `claude plugin test .` in
  `plugins/tui-review`.
- cswap mod tests: `claude plugin test .` in `plugins/cswap`.
- `nix develop` (or direnv) gives the toolchain and installs the pre-commit hooks (treefmt, merge conflicts, JSON,
  check-repo, installer and scripts tests, end-of-file; vendored paths excluded).
- `nix fmt` formats everything per `treefmt.toml` (alejandra, prettier for js/ts/json/md/yaml, rustfmt).

CI: `test.yml` (npm test and cswap mod tests, Linux and Windows) on every PR and push to main; `tui-review.yml` on
PRs touching tui-review; `build-brv.yml`/`build-cswap.yml` on PRs touching the workflow (or the cswap pin) and from `release.yml`; `sync-*.yml`
weekly.
