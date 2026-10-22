---
flow: feature
phase: evaluate
---

# Per-plugin versions: flow

## Request

Hey, could we make a plan to switch the versioning? I would like to indvidualie versions for each thing. So for example
ponytail is on 5.3.2 while cswap is on 0.27.2. But new versions only come when I create an relase

## Artifacts

- Spec: [2026-10-21-per-plugin-versions-design.md](../../superpowers/specs/2026-10-21-per-plugin-versions-design.md)
  (builder check done 2026-10-21; Dependabot lockfile-only exempt and reinstall-with-warning are the user's answers,
  installed-version trigger and ponytail exemption are Claude's calls)
- Plan: [plan.md](plan.md)
- ADRs: [0003-per-plugin-versions.md](../../adr/0003-per-plugin-versions.md) (supersedes 0002's "Our version
  number" bullet; ponytail stays vendored)
- CONTEXT.md: the repo's is [GLOSSARY.md](../../../GLOSSARY.md): added **Release**, **Plugin version**

## Gates

- Gate 1, spec approved: 2026-10-21. Reopened 2026-10-21: plan review added sync PRs running check-repo and
  Dependabot cargo `lockfile-only` to the spec; re-approved 2026-10-21 (user: "go with the recommendations").
- Gate 2, plan approved: <date>, execution: subagent-driven | native

## Skipped

## Grounding

- One version (0.5.0) in 25 files: `package.json` (source of truth; installer `VERSION`, `install.mjs:94`),
  marketplace `metadata.version`, 19 local `plugin.json`, both crates' `Cargo.toml`/`Cargo.lock`. Marketplace entries
  carry no `version`; superpowers is pinned by `ref`/`sha`.
- `scripts/release.mjs`: one `next` for every file (regex edits), `npm test`, commit `Release vX.Y.Z`, tag `vX.Y.Z`. No
  change detection, no test file. Crate list hardcoded here and again in `check-repo.mjs` (`CRATES`).
- `scripts/check-repo.mjs:63-82`: every version must equal package.json's.
- `release.yml` on `v*`: tag must equal package.json; rebuilds tui-review and web-mcp every time; cswap.exe is reused
  when `installer/cswap.json` didn't change since the previous release (`git diff $prev HEAD`) — the only existing
  "changed since last release" logic.
- Installer couples binaries to `VERSION`: `binAsset` URL `releases/download/v${VERSION}/…` (`core.mjs:353-358`),
  `binAction` compares `<bin> --version` (crate version) to `VERSION`, `cswapDownload` same scheme. `pinMarketplace`
  pins the marketplace to `ref: v${VERSION}`. `shippedVersions`/`outdated` (`core.mjs:511-530`) already compare per
  plugin.
- `sync-ponytail.mjs:140-141` stamps ponytail's `plugin.json` with package.json's version (upstream is 5.3.2; only its
  sha is kept in `UPSTREAM`). cswap's upstream pin is `installer/cswap.json` (tag `cswap-v0.26.0`).
- `binAction` needs `<bin> --version` === `VERSION` exactly (`core.test.mjs:406-409` ties tui-review's Cargo version to
  package.json); independent crate versions would re-download forever unless the expected version comes from the
  crate's `Cargo.toml` in the checkout. cswap.exe already checks currency against its upstream pin, and agent-browser
  is fully independent (`agentBrowserPlan`): the existing pattern for independently versioned binaries.
- Plugin content reaches users only through the marketplace pin to a repo tag; `plugin.json` versions are what Claude
  Code and `outdated` use to detect an update. Risk: content changed but version not bumped → no update offered.
- tui-review mod ↔ binary compatibility is the cache format integer (`chunks.ts:4`, `format.rs:24`), not semver.

## Prior art

- Claude Code: `plugin.json` `version` wins over the marketplace entry's; an unchanged version means no update
  ([loading](https://code.claude.com/docs/en/plugins/loading#how-claude-code-computes-the-version),
  [host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#release-a-new-version)). Native per-plugin
  tag convention `<plugin>--v<version>`; `claude plugin tag` validates and tags but doesn't bump; dependency semver
  ranges resolve against those tags
  ([dependencies](https://code.claude.com/docs/en/plugins/dependencies#create-a-release-tag)).
- claude-plugins-official: most entries unversioned (SHA); Greptile pins `ref: greptile--v1.2.3`.
- Tools: release-please manifest (`<component>-v<ver>` tags, release PR), release-plz (Cargo, `{{package}}-v{{version}}`),
  changesets (intent files, npm dep), lerna independent (diff since last tag, prompt per package).
- Approaches: A path diff since last per-plugin tag + maintainer picks bump (lerna, Claude Code convention); B intent
  files; C release-PR bot from conventional commits; D no versions (SHA tracking, contradicts "only on release").
- Pitfalls: GitHub `/releases/latest` is one per repo, so binaries need `/releases/tags/{tag}` (or `make_latest`);
  change detection needs crate → plugin mapping and a first-release case; vendored plugins keep upstream's version;
  plugin + its crate binary should move together.

## Options

User's answers in brainstorming (2026-10-21):

- Installer marks only plugins that changed as outdated, with their own number.
- Own plugins restart at 0.1.0; vendored plugins carry upstream's number where upstream has one.
- The release no longer sets plugin numbers; the user (or Claude) bumps them by hand with the change. This picks
  prior-art approach A's detection only as a check, not a bump; B (intent files), C (release bot) and D (no versions)
  not taken.
- The repo keeps one overall release number (tag `vX.Y.Z`, installer title) bumped by `npm run release`.

Claude's calls (in the spec, open to veto): safety-net check in `npm test`; Rust crate number = plugin number;
installer compares binary to its plugin's number; release keeps rebuilding both binaries; cswap plugin gets our own
number; one-time downgrade at the switch; only ponytail uses upstream's number (other syncs vendor branches, not
releases); syncs bump the patch digit of own-numbered vendored plugins.

Builder check (2026-10-21): user picked Cargo.lock-only exempt (Dependabot) and reinstall-with-warning as the
fallback for moving down; Claude's calls: downgrade trigger on installed ≤ 0.5.0, ponytail exempt while `UPSTREAM`
unchanged. ADR 0002 shows `claude plugin update` already moves down (5.x → 0.5.0).

Grill round 1 (2026-10-21), all recommendations accepted: all nine own plugins at 0.1.0; branch-vendored plugins
own 0.1.0 with sync patch bumps; bump rule in CLAUDE.md; missing bump fails `npm test`; ADR 0003 (user: ponytail
stays vendored in the repo).

## Plan review

Round 1 (2026-10-21): three reviewers (correctness/fable, fit/opus, simpler/sonnet), 31 findings merged, none dropped.
User took every recommendation:

- Sync PRs (blocking): widen paper-lookup and hallmark `add-paths`, run check-repo in every sync workflow, fail on no
  tag in CI. Rejected: unconditional sync bumps (breaks once-per-release).
- Tasks 2–6 land as one PR; no release or sync merge in between. Rejected: smaller first slice.
- Dependabot cargo `versioning-strategy: lockfile-only` (cargo support checked in GitHub's options reference).
- Fixed in the plan: `/` paths everywhere and a backslash test; `setVersion` null fails the sync; throwaway-repo test
  for the git readers; pure `syncBump`; smoke test with a throwaway tag; release dry-run via `release.mjs patch`; one
  repo-wide `git diff`; `LAST_SHARED`/`newer`/`BIN_PLUGINS` imported from `installer/core.mjs`; `manifestPath` in the
  crate test; CLAUDE.md vendored list notes "their `plugin.json` is ours"; flake hook regex; default README reword;
  sync-ponytail fails when upstream's tag and plugin.json disagree; `cargo metadata --locked`.
- Known risks added to the spec: moved plugin folder, installer run from a `main` checkout.

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
