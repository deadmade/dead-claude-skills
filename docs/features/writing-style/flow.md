---
flow: feature
phase: ground
---

# Writing style: flow

## Request

> Hey, the goal would be to execute the feature-flow to implement this spec [the spec, kept as given in
> [spec.md](spec.md)] … Important here is that we first utilize free public sources for you to read the content
> before we implement anything!!

Started 2026-10-27 on branch `claude/relaxed-newton-cr62u9` (from `main` 753ba2c).

## Artifacts

- Spec: [spec.md](spec.md) (the user's draft of 2026-10-24, not yet approved)
- Plan:
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md)

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved:

## Skipped

## Grounding

### Shipping a third binary (Explore agent, 2026-10-27)

- **Installer.** `BIN_PLUGINS` (`installer/core/binaries.ts:42-45`) maps a plugin to its `userConfig` key; `BIN_TARGETS`
  (`:47-50`) is Windows and Linux x64 only; `binAsset` (`:53-59`) is generic. `applyBin` (`installer/steps/binaries.ts:24-53`)
  is generic too, but `binVersionAt` (`:18-22`) needs `prose --version` to print `prose <version>`, and the fallback
  hint at `:35` hardcodes "web-mcp else tui-review". `install.ts:254-255` calls `applyBin` once per binary plugin. The
  key is written through `claude plugin configure --values-stdin` (`binaries.ts:47`), not settings.json. A binary on
  PATH means no `binPath` is written (`binaries.ts:71-85`).
- **Tests that list binaries:** `installer/core/binaries.test.ts:54-84`, `plugins.test.ts:28-48` (the opt-in list),
  `options.test.ts:64-72`. The "tools" category is `options.ts:70`.
- **Hardcoded crate lists:** `scripts/check-repo.mjs:94-97`, `scripts/release.mjs:48-54`, `.github/dependabot.yml:12`,
  `flake.nix:84-114`, `release.yml` (`needs` at `:36`, notes at `:69-70`). `build-<x>.yml` and `<x>.yml` are copies
  differing only in the crate name. `test.yml` builds no crate.
- **Plugin discovery is automatic:** `scripts/plugin-dirs.mjs:6-18` picks up `plugins/shared/prose/`; marketplace entries
  look like `.claude-plugin/marketplace.json:83-94`.
- **How plugins reach their binary today:** web-mcp's `.mcp.json:4` uses `"${user_config.binPath}"`; tui-review reads
  `options.binPath` in mod code (`register.tsx:500-504`); graphify's hooks call a bare `graphify` on PATH
  (`plugins/shared/graphify/hooks/hooks.json:7,11`). **No hooks.json uses `${user_config.*}`, and the repo has no
  PostToolUse hook.**
- **flows dependencies** come from the union of `uses.json` keys (`scripts/flows-uses.mjs:141-183`); each listed name
  must exist as a skill in the plugin and appear in the conductor's SKILL.md (`:40-87`).
- **Crate conventions:** edition 2024, `rust-version = "1.97"`, MIT, `publish = false`, clippy pedantic warn, thin LTO,
  strip (`crates/tui-review/Cargo.toml`); `--version` prints `<name> <version>` (`crates/web-mcp/src/main.rs:40-41`).
  Fixtures live in `tests/fixtures/`; no crate embeds production data with `include_str!` yet.
- **Node:** `engines` says >=26, but the suite passes on this sandbox's Node 22.22 (117 installer tests, 72 script
  tests; coverage 82.1% against a floor of 79).
- **Already in flows:** pstack-picks ships `technical-writing` (Diátaxis, Google style, STE, Global English) and
  `unslop` (an AI-tell catalog); `/doc-audit` Phase 5 and `/integrate` Phase 2 use them
  (`plugins/flows/skills/doc-audit/uses.json:5`, `integrate/uses.json:3`). Both are vendored and overlap the new skill.

## Prior art

## Options

## Plan review

## Tasks

## Rulings

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
