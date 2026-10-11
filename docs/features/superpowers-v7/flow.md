---
phase: done
---

# Superpowers v7: flow

## Request

> Hey, I would like to switch superpowers from claude repo to the superpowers main repo and would like to migrate to
> 7.0.0. Please review the changes in v7 and also look at what we have to change

Follow-up (2026-10-11): "would it be possible to also pin the plugins we import and create a pr when they update?"

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved: 2026-10-11
- Gate 2, plan approved: 2026-10-11 (incl. round-2 fixes), execution: native

## Skipped

None. Claude offered to drop out of the flow as a small change; the user chose the full flow (2026-10-11).

## Grounding

- `.claude-plugin/marketplace.json:21-28` already sources superpowers from `https://github.com/obra/superpowers.git`,
  unpinned (tracks main). `claude-plugins-official` pins it to sha `5bf4e78` (v6.4.1); we don't use that entry. The
  local 6.4.2 install is a stale cache.
- Other url-sourced plugins, also unpinned: ponytail (`DietrichGebert/ponytail`, tags, latest v5.1.0) at
  `marketplace.json:29-37`, atlassian (`atlassian/atlassian-mcp-server`, no tags) at `marketplace.json:62-70`.
- Pattern to copy: `.github/workflows/sync-cswap.yml` (newest stable `vX.Y.Z` via `git ls-remote`, jq rewrite,
  `peter-evans/create-pull-request@v8`, Monday cron).
- superpowers v7.0.0 (RELEASE-NOTES, diff v6.4.2..v7.0.0): brainstorming rebuilt (skip-the-questions opener, one open
  question, play-back, sizing quick/small/design, builder check replaces spec reviewer, spikes, recon offer, how-it-
  gets-made choices). Rest is bug fixes (hooks PATH, Windows run-hook.cmd, sdd-workspace .gitignore, task-done,
  requesting-code-review `$1`, systematic-debugging secret echo). writing-plans, executing-plans,
  subagent-driven-development, finishing skills: no behavior change.
- `plugins/feature-flow/skills/feature-flow/SKILL.md:61-73` already assumes v7 (builder check, sizing, recon). Gaps:
  skip-the-questions ends brainstorming without a spec; spikes bypass Gate 2.
- No other repo file depends on v6 brainstorming. `plugins/self-review/skills/self-review/SKILL.md:46` uses
  `docs/superpowers/specs/*` (unchanged in v7); `installer/core.test.mjs:388` uses `6.4.2` only as fixture data.

## Prior art

- [Marketplace reference, Plugin sources](https://code.claude.com/docs/en/plugins/marketplace-reference#plugin-sources):
  `url` source accepts `ref` (branch/tag) and `sha` (full 40-char). With both set, `sha` is checked out; the docs'
  github example sets both.
- [Loading, version](https://code.claude.com/docs/en/plugins/loading#how-claude-code-computes-the-version): without a
  `version`, the version is the 12-char sha; a `version` in plugin.json/entry wins, so a sha bump with an unchanged
  upstream `version` doesn't reach installed users.
- claude-plugins-official
  [bump-plugin-shas.yml](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.github/workflows/bump-plugin-shas.yml):
  own workflow, follows HEAD by default, `releases-only` list follows release tags; one PR per plugin on
  `bump/<slug>`; runs `claude plugin validate`; skips plugins with an open bump PR; dispatches checks itself because
  `GITHUB_TOKEN` PRs don't trigger CI.
- Renovate custom managers (JSONata/regex + git-refs) can do it but add an app and config; updating tag + sha
  together unconfirmed. Dependabot can't read a custom JSON manifest. update-flake-lock = one combined PR.
- Pitfalls: moved tags (pin sha too, resolve `^{}` for annotated tags), pre-releases (existing `^v\d+\.\d+\.\d+$`
  filter), `GITHUB_TOKEN` PRs don't run CI, untagged repos are noisy if they follow HEAD.

## Options

- feature-flow gaps (2026-10-11): user picked "patch both": on skip, Claude writes the spec from grounding + its own
  defaults marked as its calls, then Phase 3; spikes allowed, logged here as throwaway, never pass Gate 2. Rejected:
  forbid both, leave as is.
- Pinning (2026-10-11): user asked to pin every imported plugin and get a PR on upstream updates (over "pin
  superpowers only" / "keep tracking main").

- Atlassian (2026-10-11): user chose not to pin it; follows upstream main.
- Design (2026-10-11): user approved the in-chat design (ref+sha pins, one matrix workflow `sync-plugins.yml`, feature-flow Skip/Spike bullets, docs); spec written (not committed, per commit rule).

- Grill round 1 (2026-10-11): Q1 jq + pinned `npx prettier` (over node rewrite / nix in CI / sed); Q2 no builder check for a Skip spec; Q3 no special handling for major bumps. Frontier empty. No new domain terms for CONTEXT.md and no ADR (no decision is hard to reverse).

## Plan review

Round 1 (2026-10-11), with two reviewers (correctness+fit, simpler). 11 findings, 0 dropped. User: "do your
recommendations".

- F1: the pin write switches from jq + prettier to a regex-in-place `scripts/sync-plugins.mjs`, the release.mjs
  pattern. This also fixes the unset `$name`, the pipefail grep, the silent missing entry and the prettier drift.
  Spec changed, reopening Gate 1 for grill Q1.
- F2: main/master mismatch, kept as is; the PR body says it ships once main reaches master. Follow-up: align them.
- F3: added Task 3, where the installer counts pinned url plugins as shipped (`shippedVersions`). Spec changed.
- F4: declining a bump means leaving the PR open, documented in the README and the PR body.
- Consider items (downgrade guard, `git fetch` sha check, actionlint, `jq empty` and other redundant guards): all
  dropped.
- The plan's shape changed (new script and new task), so round 2 re-reviews the changed parts.

Round 2 (2026-10-11), with one reviewer on Tasks 2 and 3. 5 findings, 0 dropped. Claude applied them as plan-only
fixes, to be confirmed at Gate 2:

- The new test is wired into the pre-commit hook and release.yml. Nothing ran it before.
- The `pin` test reads the expected `old` from the live file and uses tag v999.0.0, so it survives future sync PRs.
- Review Focus #5 no longer claims a name check.
- The Global Constraints tag-picking line is updated.
- `shippedVersions` omits a plugin with no version, and the test covers it.

## Deviations

1 (2026-10-11, at execution setup): the grounding was taken from the local `treefmt` branch, which is behind
origin/main. origin/main has since merged #29 and earlier PRs.

- **D1 – base.** treefmt (the prettier/nix fmt work) is not in main. Options: branch from origin/main, or from
  treefmt. Recommendation: origin/main. treefmt is unrelated and unmerged.
- **D2 – test wiring.** main runs `npm test` (check-repo + `installer/*.test.mjs`) in test.yml on every PR, in
  release.yml and in release.mjs. The pre-commit `installer-test` hook covers `installer/` only. dev-feature and its
  guard test are gone. Recommendation: add `scripts/*.test.mjs` to `npm test` and to the flake's installer-test
  hook (text + `files`), in place of the plan's flake/release.yml edits.
- **D3 – feature-flow Phase 2.** main's Phase 2 was rewritten for 6.4.2 brainstorming's Spike/Bounded/Architectural
  paths (262a412). v7 has none of those: it sizes quick/small/project, uses a builder check, and offers skip and
  spikes. So Task 4 grows. Recommendation: rewrite **Size** (quick/small → offer to drop out; project → continue)
  and **Exit** (stop once the spec is written and the builder check is folded in) for v7, plus the planned Skip
  and Spike bullets.
- **D4 – branch mismatch is gone.** Releases are now cut from main (CLAUDE.md). F2 is obsolete, and the PR body says
  "ships with the next release".
- **D5 – no `nix fmt` on main.** Drop those verification steps; `npm test` is the check. CLAUDE.md gets a line for
  sync-plugins under "Vendored content" / CI at Phase 7.

Decision (2026-10-11): the user approved all five recommendations ("yes, go with all five"). Work branches from
origin/main in the worktree on branch `worktree-superpowers-v7`.

## Walkthrough

| spec goal                                                       | plan task | file:line                                                                 | test                                                                                              |
| --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. superpowers pinned to v7.0.0, ponytail to v5.1.0 (ref + sha) | T1        | `.claude-plugin/marketplace.json:28-29,39-40`                             | `claude plugin validate .` passed; `npm test` (check-repo)                                        |
| 2. Weekly PR per plugin on a newer stable tag                   | T2        | `scripts/sync-plugins.mjs:10,27,35`; `.github/workflows/sync-plugins.yml` | `scripts/sync-plugins.test.mjs:9-51` (6 tests); live dry run v5.0.0→v5.1.0, superpowers unchanged |
| 2a. New tests run in CI and pre-commit (D2)                     | T2        | `package.json:9`, `flake.nix:34`                                          | `npm test` 72/72                                                                                  |
| 2b. Re-running the installer updates pinned plugins (F3)        | T3        | `installer/core.mjs` `shippedVersions`, `installer/install.mjs`           | `installer/core.test.mjs:320`                                                                     |
| 3. feature-flow Phase 2 for v7 (Size, Skip, Spike, Exit)        | T4        | `plugins/feature-flow/skills/feature-flow/SKILL.md:69-79`                 | grep: no Bounded/Architectural left (prose, no unit test)                                         |
| 4. Docs say how imported plugins are pinned                     | T2        | `README.md:87-89`, `THIRD_PARTY.md:60`, `CLAUDE.md:20-25`                 | review                                                                                            |

No goal without code, and no code without a goal. The final review (Opus) found 1 Important issue, fixed: the CRLF regex
(`e784948`, test "pin works on a CRLF checkout", red then green). It also found 2 Minor issues, deferred: no downgrade
guard, and the installer assumes the tag matches upstream's plugin.json version. Both are in the ledger.

Not yet verified, because it needs a release and live runs:

- After the next release, re-running the installer should offer superpowers 6.4.2 → 7.0.0.
- After merge, a `workflow_dispatch` run of sync-plugins should finish with no PR.

Finish (2026-10-11): user chose "push and create a PR" (option 2). Branch `superpowers-v7`.
