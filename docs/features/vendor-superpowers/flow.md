---
flow: feature
phase: done
---

# Vendor superpowers: flow

## Request

Hey, could we vendor in superpowers similar to ponytail?

## Artifacts

- Spec:
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved:

## Skipped

Phases 3–7 (2026-10-22): brainstorming sized this a small change (it copies ponytail's pattern); the user chose
"short": a design in chat, built through the normal workflow, outside this flow.

## Grounding

- Today: superpowers is the only url entry pinned by `ref` + `sha` (`.claude-plugin/marketplace.json`, v7.0.0 =
  `bb92a77`), kept current by `scripts/sync-plugins.mjs` + `.github/workflows/sync-plugins.yml` (matrix holds only
  superpowers; atlassian is url but unpinned on purpose). `sync-ponytail.mjs` imports `stableTags` from
  `sync-plugins.mjs`; `sync-plugins.test.mjs:48` reads the real marketplace's superpowers entry.
- Pattern to copy: `scripts/sync-ponytail.mjs` (newest stable tag via `ls-remote`, full-depth sparse clone at the tag,
  sha assert, every check before the folder is deleted, `unknownParts` fails on unhandled plugin.json keys/default
  folders, other hosts' adapters dropped, `version` = package.json's, `UPSTREAM` sha, `finish()`, PR body from
  `releaseNotes`/`inert`), `sync-ponytail.test.mjs`, `sync-ponytail.yml` (Monday cron, `gh` for release notes,
  `claude plugin validate` + check-repo in the job, PR on `sync/ponytail`). ADR 0002 records why, and says to
  re-check it "if superpowers needs the same treatment".
- Touch points when it becomes local: marketplace `source` → `./plugins/shared/superpowers` (it's a dependency of
  dead-skills and flows, by name, so `shared/`); check-repo and `release.mjs` then version its plugin.json like every
  local plugin; vendored-path lists in `flake.nix:20`, `.pre-commit-config.yaml:58`, `treefmt.toml:11`; CLAUDE.md
  (vendored list, the url-pin paragraph), THIRD_PARTY.md ("Re-listed plugins"), README.md:9,
  `plugins/default/README.md:10`. Installer: `shippedVersions` reads url refs; with superpowers local, no pinned url
  entry is left (`installer/core/plugins.test.ts` uses superpowers only as fixture data).
- Versions: one version for everything (check-repo:63-88), so the vendored copy would be 0.5.x while installs carry
  7.0.0. The installer's `outdated()` never offers a downgrade (`plugins.ts:115`), but `claude plugin update` replaces
  on any version difference, settings and data kept (verified for ponytail 5.3.2 → 0.4.0 on 2.1.304,
  `docs/features/ponytail-v5/flow.md`). ADR 0003 (per-plugin versions; flow at `phase: evaluate`, not built) would let
  vendored ponytail keep upstream's number again; superpowers would follow.
- History: ponytail-v5's Options rejected "vendoring superpowers (not now)".

## Prior art

Background agent, 2026-10-22 (sources fetched in that run):

- Upstream newest stable tag: v7.0.1 = `2ce8aa1` (annotated; we pin v7.0.0 `bb92a77`).
  [plugin.json](https://github.com/obra/superpowers/blob/v7.0.1/.claude-plugin/plugin.json) declares no component
  paths, so defaults: `skills/` (15) and `hooks/` (`hooks.json`, `run-hook.cmd`, `session-start`; plus Cursor's
  `hooks-cursor.json`). LICENSE MIT © 2025 Jesse Vincent. About 10 other hosts' adapters at the root (`.codex-plugin/`,
  `.opencode/`, `.pi/`, `gemini-extension.json`, `AGENTS.md`, `index.js`, `package.json`, …); dev-only `tests/`,
  `docs/`, `scripts/`, `.github/`.
- GitHub Releases with notes exist: the agent's "no releases" was wrong (user, 2026-10-22; checked:
  `api.github.com/repos/obra/superpowers/releases/tags/v7.0.1` returns the v7.0.1 notes). ponytail's `notesOf`
  (`gh api …/releases/tags/<tag>`) works unchanged. Upstream also keeps
  [`RELEASE-NOTES.md`](https://github.com/obra/superpowers/blob/v7.0.1/RELEASE-NOTES.md).
- Vendoring risks: `hooks/session-start` needs `hooks/` and `skills/` as siblings; brainstorming's `server.cjs` reads
  the version from `../../../package.json` or `.codex-plugin/plugin.json`, so a filtered copy shows `unknown`
  (display only); 11 files are mode 755; upstream's `.gitattributes` forces LF on `*.cmd` and `hooks/session-start`
  (we have no `.gitattributes`).
- Docs: [plugin sources](https://code.claude.com/docs/en/plugins/marketplace-reference#plugin-sources),
  [versions and updates](https://code.claude.com/docs/en/plugins/loading#versions-and-updates) (update replaces the
  cache only when the version differs). No doc covers a url → relative-path switch for an existing install; ponytail's
  Task 4 test shows it works.
- Approaches: A url pin ref+sha (today; claude-plugins-official
  [bump-plugin-shas.yml](https://github.com/anthropics/claude-plugins-official/blob/main/.github/workflows/bump-plugin-shas.yml));
  B full copy of the tree; C filtered copy of the Claude Code parts (ponytail here; upstream's own
  [sync-to-codex-plugin.sh](https://github.com/obra/superpowers/blob/v7.0.1/scripts/sync-to-codex-plugin.sh) is a
  denylist rsync); D git subtree/copybara (nobody found).

## Options

- Version of the vendored copy (2026-10-22): user picked **ours for now** (like ponytail) over upstream's 7.x.
- Size (2026-10-22): user picked a short in-chat design over the full flow.

## Plan review

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
