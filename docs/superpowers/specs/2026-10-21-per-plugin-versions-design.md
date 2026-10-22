# Per-plugin versions: design

## Intent

Today one number (0.5.0) is copied into 25 files, and every release bumps all of them. That means every plugin shows
up as "outdated" in the installer after each release, even when nothing in it changed.

What the user wants: after a release where only tui-review and cswap changed, the installer marks only tui-review and
cswap as outdated, each with its own real number (`tui-review outdated 0.1.0 → 0.1.1`). Every other plugin shows
"installed" with the number it already had.

## Goals

1. **Own numbers.** Every local plugin has its own semver in its `plugin.json`, and it moves independently of the
   others.
2. **Hand-set.** The user raises a plugin's number by hand, in the same change that touches its code. Claude in a
   session does the same. The release never sets a plugin's or a crate's number.
3. **Ship on release only.** Numbers on `main` reach machines only when the user cuts a release. That is already true,
   because the installer and marketplace pin to the release tag.
4. **Restart.** Plugins the user wrote restart at **0.1.0**: dead-skills, flows, cswap, md-pane, tui-review, web-mcp,
   nix-lsp, mcp-azure and mcp-github.
5. **Vendored plugins carry upstream's number** where we vendor an upstream release. Today that is only ponytail
   (5.3.2, synced at upstream's release tags). superpowers already works this way through its `ref`.
6. **Safety net.** `npm test` fails when a plugin's files changed since the last release but its number didn't. A
   forgotten bump would otherwise mean that plugin silently never updates anywhere.
7. **Rust tools.** The installer re-downloads a Rust tool only when that tool's own number changed.

## Non-goals

- Per-plugin tags or GitHub releases. One repo release stays the unit that ships.
- Changelogs, release-PR bots, conventional commits or changeset files.
- Switching other vendored syncs from upstream's default branch to upstream's release tags.
- Skipping the build of an unchanged Rust tool in `release.yml`. It keeps rebuilding both; an unchanged tool builds to
  the same number.

## Anti-goals (failure even if it works)

- A plugin whose code changed reaches no machine because its number didn't move.
- Machines on 0.5.0 never get the renumbered plugins.
- The installer re-downloads tui-review or web-mcp on every run.

## Decided

### Repo release number

- The repo keeps one overall number: `package.json` `version` and the marketplace's `metadata.version`. `npm run
release -- patch|minor|major|X.Y.Z` bumps only those two, runs `npm test`, commits and tags `vX.Y.Z` as today.
- The installer still shows this number in its title, installs from that tag (`marketplaceArg`/`pinMarketplace`) and
  downloads binaries from that tag's GitHub release (`binAsset`, `cswapDownload`).
- `release.yml` is unchanged apart from its comments and notes, if they mention one version.

### Plugin numbers

- Each `plugins/**/.claude-plugin/plugin.json` `version` is that plugin's number. Marketplace entries keep carrying no
  `version`: Claude Code lets `plugin.json` win anyway.
- A Rust tool counts as part of its plugin. `crates/tui-review` and `crates/web-mcp` carry the same number as the
  plugin of that name, in `Cargo.toml` and in their own `Cargo.lock` entry.

### Starting numbers (the switch release)

Confirmed by the user on 2026-10-21, including our own 0.1.0 for plugins vendored from a branch.

| plugins                                                                                                                                                                          | number            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| the user's own (dead-skills, flows, cswap, md-pane, tui-review + crate, web-mcp + crate, nix-lsp, mcp-azure, mcp-github)                                                         | 0.1.0             |
| ponytail                                                                                                                                                                         | upstream's: 5.3.2 |
| vendored from an upstream branch, not a release (graphify, hallmark, mattpocock-picks, paper-lookup, pstack-picks, tob-picks, self-review, rust-skills, csharp-skills, postgres) | our own: 0.1.0    |

The second-to-last row follows from goal 5. Those syncs copy upstream's default branch, so upstream's tag number
would claim a release we didn't vendor. graphify, mattpocock, paper-lookup and apollographql publish tags; dotnet has
one. self-review and postgres combine two upstreams; hallmark, cursor/plugins and trailofbits publish none.

### Safety net (check-repo)

- **Rule:** a plugin has a _release baseline_, its files as of the newest `v*` tag reachable from `HEAD`. If any of
  its paths differ from that tag, its number must differ from the number it had at that tag, and must not be lower.
- **What counts as a plugin's paths:** its folder. tui-review and web-mcp also count `crates/<name>/`.
  - _Builder may exclude:_ files that never reach a machine, such as `tests/` or `evals/`. A README change still
    counts: it ships inside the plugin.
- **Exempt:**
  - a plugin that didn't exist at the baseline tag;
  - a change under `crates/<name>/` that touches only `Cargo.lock` (user's decision: Dependabot's weekly cargo PRs
    stay green, and new dependency versions ship with the tool's next real change);
  - ponytail, when its `UPSTREAM` sha didn't change since the baseline (my call: its number is upstream's, so a change
    from our sync script alone waits for upstream's next tag; this matches "vendored unchanged").
- **Switch release:** the first release after this change resets numbers downwards on purpose. The "not lower" part
  applies only once the baseline tag is a release made under this scheme. _Builder:_ how to recognise that, for example
  a constant naming the last shared-version tag, `v0.5.0`.
- **Where it runs:** check-repo runs inside `npm test`, so it covers every PR, every push to `main` and
  `release.mjs`.
  - CI checkouts must fetch the tags. `test.yml` uses `actions/checkout` with its default depth of 1, so this needs
    `fetch-depth: 0` or an explicit tag fetch.
  - Where no `v*` tag is reachable (a shallow clone), the check is skipped with a printed warning, not failed.
- A missing bump is an error: `npm test` fails (user, 2026-10-21), so CI goes red and the pre-commit hook stops it.
- The existing check stays: each crate's `Cargo.toml` equals its `Cargo.lock` entry. New: it also equals its plugin's
  `plugin.json` number. Every `plugin.json` must have an `X.Y.Z` version.

### Syncs

- **sync-ponytail.mjs** writes upstream's version into `plugin.json` instead of package.json's (`version` is already
  in its `KEYS`). A sync that moves to a new upstream tag therefore also moves the number, which satisfies the safety
  net.
- **Other sync scripts with our own number:** when the sync changes the plugin's files and its number still equals
  the baseline's, the sync bumps the patch digit. This keeps the weekly sync PRs green under the safety net.
  - _Builder:_ put this in `sync-lib.mjs` as one helper that every sync calls.
  - Syncs that only touch part of a plugin (paper-lookup, graphify, postgres skills, self-review) bump the plugin
    that owns the folder.
- **sync-plugins.mjs** (superpowers' `ref`) is unchanged.
- **Every sync workflow runs `node scripts/check-repo.mjs` before it opens its PR** (plan review, user 2026-10-21).
  PRs opened with the workflow token start no `test.yml`, so this is the only check a sync PR gets. Each workflow
  commits the whole plugin folder, so the bumped `plugin.json` lands in the PR.
- **Dependabot's cargo updates are `versioning-strategy: lockfile-only`** (plan review, user 2026-10-21). Its PRs then
  touch only `Cargo.lock`, which the safety net exempts. Updates that need a `Cargo.toml` change come by hand with a
  bump.

### Installer

- `binAction`'s expected version for tui-review and web-mcp becomes that plugin's own number, read from its
  `plugin.json` in the checkout the same way `shippedVersions` reads it, instead of `VERSION`. The download URL still
  uses the repo tag.
- `core.test.mjs:406-409` changes from "crate equals package.json" to "crate equals its plugin".
- **One-time downgrade:** `outdated()` never offers a downgrade, and machines on 0.5.0 would see 0.1.0 as older.
  `outdated()` also lists a plugin whose shipped number is lower **when the installed number is a shared-era number,
  0.5.0 or lower** (my call). The trigger lives in the installed versions themselves, so a skipped or failed update, a
  missing settings entry or a symlinked `settings.json` doesn't lose it: the next run offers it again.
  - Once a plugin's own number passes 0.5.0, nothing can confuse the two eras.
  - Until then, running an older installer than the one that installed a plugin would offer that plugin's older
    number. This is accepted, because that installer pins the marketplace to its older tag anyway.
- **Moving down:** ADR 0002 records that Claude Code's update replaces a plugin whenever the version differs, with
  settings and data kept. ponytail went from upstream's 5.x down to 0.5.0 that way (checked on 2.1.304,
  `docs/features/ponytail-v5/flow.md`). So an ordinary `claude plugin update` is expected to move down. Re-check this
  on the current CLI before relying on it.
  - If it does, the updates are ordinary.
  - If it doesn't, the installer uninstalls and reinstalls those plugins. The Updates screen first says once which
    plugins get reinstalled and which settings the user will have to enter again (user's decision). Settings the
    installer owns (`binPath`, `agentBrowserPath`) it sets again itself.
  - The reinstall must keep the `auto` dependency markers `prune` relies on.
- cswap.exe stays tied to `installer/cswap.json`'s upstream pin, as today. Bumping that pin is not a cswap plugin
  change.

### Docs

These must describe the new scheme:

- CLAUDE.md's "Versions and releases" section and its `release.mjs` mentions. It also gets the bump rule (user,
  2026-10-21):
  - Raise a plugin's number in the same change that touches it.
  - Last digit for a fix, middle digit for a new feature or changed behaviour.
  - Once per plugin per release: if it already moved since the last release, only bump again to step from a fix to
    a feature.
- ADR 0003 (written), and ADR 0002's "Our version number" bullet marked superseded (done). ponytail stays vendored.
- README.md:32.
- The `release.mjs` header comment and the `check-repo.mjs` section comment.
- The `sync-ponytail.mjs` header ("ours: everything ships as one version").
- THIRD_PARTY.md, if it mentions versions.

## Left to the builder

- How check-repo finds the baseline tag and diffs per plugin: `git describe --tags --match 'v*' --abbrev=0`, then
  `git diff --quiet <tag> HEAD -- <paths>`, plus `git show <tag>:<plugin.json>`. Use the existing `git` helper.
- The exact error text, which must name the plugin and say "bump its version in plugin.json".
- The test layout. New logic goes into a testable module with a `*.test.mjs` file: the existing scripts' tests are
  the pattern, and `release.mjs` has none today.
- Whether the switch itself is one PR or several.

## Known risks

- **Machines still on v0.1.0** (the old shared release) have their plugins at 0.1.0, the same number the renumbered
  plugins restart at. Claude Code and `outdated()` would see no change for them. The only way out is uninstalling and
  reinstalling. Accepted: v0.1.0 is old.
- **A plugin moved to a new folder after a release** escapes the bump check until the next release: its old path
  misses at the baseline, so it looks new.
- **Running the installer from a `main` checkout** instead of a release tag downloads the binaries again on every run,
  because `main`'s plugin numbers can be ahead of the release's binaries.
- **Content outside a plugin's paths that changes its behaviour** gets no bump. One example is
  `installer/ccstatusline-night-city.json`. The safety net only watches the plugin's folder (plus the crate).
