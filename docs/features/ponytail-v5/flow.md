---
phase: execute
flow: feature
slug: ponytail-v5
---

# Ponytail v5 integration and upstream drift: flow

## Request

"Hey, I feel like we havent properly integrated ponytail especially with their new v5 rewrite. Could we pls analyze the
current project and how we can properly integrate it?" — then: "thats too much in my opinion. Lets disable our bands
for now and use the ponytail band for now" — then (/feature-flow): "Lets first analyze this a bit more deeply. Did we
catch everything, are there other features ponytail provides that we do not properly integrate. How can we prevent
such things in the future?"

## Artifacts

- Spec: [2026-10-20-ponytail-v5-design.md](../../superpowers/specs/2026-10-20-ponytail-v5-design.md)
- Plan: [2026-10-20-ponytail-v5.md](../../superpowers/plans/2026-10-20-ponytail-v5.md)
- ADRs: [0002-vendor-ponytail.md](../../adr/0002-vendor-ponytail.md)
- CONTEXT.md: none (no new terms)

## Gates

- Gate 1, spec approved: 2026-10-20 (Q8 read as: no tests for upstream's code; one test each for our sync and
  installer logic).
- Gate 1 reopened for goal 5 (plan review B3): revised text approved 2026-10-20.
- Gate 2, plan approved: 2026-10-20, execution: native

## Decisions so far

- 2026-10-20, user: switch off the flows band and Onibi's visits; ponytail's band is the only `AbovePrompt` band.

## Grounding

Pin: v5.3.2 = `16352ac`, matches marketplace.json and upstream plugin.json 5.3.2.

Ponytail v5.3.2 surface vs us (beyond the band, statusline nudge, /harden):

| #   | Upstream                                                                                                                                         | Us                                                                          | Impact                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | SubagentStart injects full ruleset into every subagent (`hooks/ponytail-subagent.js:17-49`; `PONYTAIL_SUBAGENT_MATCHER` narrows)                 | none                                                                        | biggest: superpowers implementers/reviewers, self-review, claude-security panels, Explore all get "lazy" rules + footer |
| 2   | v5 `ponytail-review`/`-audit` are full quality reviews (bugs, security, load, tests, speed, lean); review defaults to uncommitted/last commit    | `/harden` calls them "Bloat" (`harden/SKILL.md:3,26`, `flows/README.md:16`) | untrue docs, overlaps claude-security/sharp-edges, scope must be passed                                                 |
| 3   | fallback `/simplify`                                                                                                                             | `flow-rules.md:68` "report only"                                            | `/simplify` applies fixes                                                                                               |
| 4   | Task ledger on by default: `~/.config/ponytail/band/*.csv` + board.html each turn; `band import` reads all transcripts (we keep them 36500 days) | undocumented                                                                | writes on every machine                                                                                                 |
| 5   | SessionStart codebase map (`ponytail-map.js`, `PONYTAIL_MAP=0`)                                                                                  | none                                                                        | extra context each session; overlaps pstack `how`/graphify                                                              |
| 6   | `shortcut:` marker + `/ponytail-debt`                                                                                                            | ~10 markers in our code, no rule, no conductor uses debt                    | unused                                                                                                                  |
| 7   | userConfig incl. sensitive `webhookToken`                                                                                                        | `needsToken` can't see url manifests, ignores `required`                    | fine today, latent gap                                                                                                  |
| 8   | Band needs CC 2.1.290+; not in cloud/`claude -p`/VS Code                                                                                         | installer notes 2.1.289                                                     | undocumented                                                                                                            |
| 9   | Post-v5.3.2 upstream fixes (band "off" after /clear; Windows hook timeouts; map buffer)                                                          | pinned v5.3.2                                                               | re-pin on next tag                                                                                                      |
| 10  | Clean slate leaves `~/.claude/.ponytail-*`, `~/.config/ponytail`                                                                                 | `CLEAN_TARGETS`                                                             | fine                                                                                                                    |
| 11  | READMEs list ponytail as prompt-only                                                                                                             | `README.md:9`, `plugins/default/README.md:9-10`                             | untrue                                                                                                                  |

Upstream drift (how we learn about changes):

- `sync-plugins.yml`/`sync-plugins.mjs:35-45`: PR = 2-line ref/sha bump, body has release + compare links only.
- `checkUses` (`scripts/flows-uses.mjs:53-55`) can't check url plugins' skills; nothing checks upstream hooks,
  userConfig, mods, or that `ref` == upstream plugin.json version.
- Only csharp sync reports added/removed skills and unvendored plugin.json keys; mattpocock/pstack/tob open an issue
  per new skill (`sync-lib.mjs:73-78` `reportNew`). Others report nothing; licenses unchecked.
- superpowers has the same exposure and is used far more (feature-flow, implement, fix-flow, verify, …).
- No ledger of integration decisions per third-party plugin.

## Prior art

- **A Renovate-style rich PR body**: release notes + compare `files[]` + plugin.json key diff
  ([changelogs](https://docs.renovatebot.com/key-concepts/changelogs/),
  [compare API](https://docs.github.com/en/rest/commits/commits#compare-two-commits)). Cheap; informs only.
- **B cargo-vet-style reviewed-surface snapshot checked in CI**: a committed record per pinned plugin (hook events,
  mod modules, userConfig keys, skills/commands/agents, MCP servers); a bump that changes it fails until regenerated
  with a note ([audit entries](https://mozilla.github.io/cargo-vet/audit-entries.html),
  [CI](https://mozilla.github.io/cargo-vet/configuring-ci.html)). Forces a decision; needs an extractor.
- **C checklist / approval gate** in the PR body (Renovate `dependencyDashboardApproval`). No code; box-ticking.
- Plugin surface fields per [plugins reference](https://code.claude.com/docs/en/plugins-reference); mods via
  `hooks.json` `modules` ([mods reference](https://code.claude.com/docs/en/plugins/mods/reference#files)).

## Options

- Noticing upstream changes: **A** vendor ponytail / **B** changelog + surface summary in the PR / **C** checklist.
  User picked **A + B for ponytail only** (2026-10-20): "its harder for agents and myself to know what the plugin
  actually does without having it in the codebase", "add the release notes to the pr". Rejected: C; vendoring
  superpowers (not now); shaping ponytail's parts (user: "no not really").
- Version of the vendored copy: user picked **ours + installer reinstall** over keeping upstream's 5.x.

## Skipped

## Plan review

Round 1 (2026-10-20), three reviewers (correctness, fit, simpler); 3 blocking, 6 should-fix, 4 consider; 1 dropped
(possible root `tsconfig.json` written into the vendored folder: no traced path). User decisions:

- B1 bot owns `sync/ponytail` → work on `feat/ponytail-v5`: yes.
- B2 `sparseClone` vendors main at depth 1 → `ref`/`depth` options + sha assert: yes.
- B3 installer exception unnecessary, uninstall fallback loses settings → no installer code, Task 4 verifies;
  spec goal 5 revised (reopens Gate 1 for goal 5): yes.
- Should-fix (copy `hooks/` whole + fail on unknown parts; validate in the workflow; old tag from `ls-remote` via
  `stableTags`, `UPSTREAM` sha-only, read before delete, check before replace; rewrite `#`/`@`; CLAUDE.md mod-test
  lines; second run after commit) and consider (csharp's workflow inputs; "(no changes)"; body cap; upstream likely
  has no GitHub releases, so subjects are the usual path): all yes.

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
