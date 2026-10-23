---
name: verify
description: 'Prove a branch is ready for a PR: run the tests and checks once and read their output, /self-review the diff, /doc-audit the docs it touched, optionally /test-audit it, read it in tui-review, have you confirm or reopen the decisions the build made on its own, then give a verdict and offer how to integrate. Never opens a PR or pushes on its own. Use for /verify [base].'
disable-model-invocation: true
argument-hint: '[base branch or commit]'
---

# verify

Is this branch ready for a PR? Evidence for each part of the answer, then the user decides what happens to the branch.

| Phase    | Runs                                                       | Output                                      |
| -------- | ---------------------------------------------------------- | ------------------------------------------- |
| 1 Scope  | flow-rules **Scope**, `branch`                             | base, diff, intent                          |
| 2 Checks | superpowers `verification-before-completion`               | every check green, or a fix; one run        |
| 3 Review | `/self-review`                                             | code findings fixed                         |
| 4 Docs   | `/doc-audit branch`                                        | docs match the diff                         |
| 5 Tests  | `/test-audit branch`, on the user's yes                    | test gaps filled                            |
| 6 Read   | tui-review                                                 | the user read the diff                      |
| 7 Decide | verdict, then superpowers `finishing-a-development-branch` | **Gate**: decisions, then what happens next |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (pstack
is its `pstack-picks` folder).

## Phase 1: Scope

The base is the argument, else as flow-rules **Scope** says. The intent is the spec the caller handed over, else what
self-review's Phase 2 finds. An empty diff: say so and stop.

## Phase 2: Checks

Follow superpowers `verification-before-completion`. The checks are what the repo documents (CLAUDE.md,
CONTRIBUTING.md, the `test`/`lint` scripts, the CI workflows the diff would trigger), not a guess: run every one that
applies to the changed files and read the output. A red check stops the flow: show the failing output, find the cause
with superpowers `systematic-debugging`, and fix it on the user's yes before going on.

**One run.** This run's output is the evidence for every later phase and for the verdict. Keep it, with the commit
(`git rev-parse HEAD`) and `git status --short` it ran on. Nothing re-runs the suite while the tree is unchanged: not
self-review's fix step, not test-audit's baseline, not finishing's Step 1. Only a change to the tree (a fix in Phases
3–5) calls for one re-run, in Phase 6, and that output replaces this one.
<!-- overrides superpowers/skills/verification-before-completion/SKILL.md: "If you haven't run the verification command in this message, you cannot claim it passes." -->

## Phase 3: Review

Run `/self-review` with the base from Phase 1 (read its SKILL.md, see flow-rules **Loading skills**). Its fix phase
applies; the user picks what gets fixed. Skip its step that runs the tests after the fixes: Phase 6 re-runs them once.
A finding it sends to `/fix-flow` runs that conductor inline (flow-rules **Calling another conductor**) up to its
Finish; this verify is its verify. A caller that says execution ran without per-task reviews also gets pstack
`interrogate` offered here.

Keep what the `self-review:pr-test-analyzer` agent returned (its reply and its findings in the report) for Phase 5.

## Phase 4: Docs

Run `/doc-audit branch` with the same base. self-review's CLAUDE.md pass already ran, so tell doc-audit to skip its
CLAUDE.md step.

## Phase 5: Tests

If non-test source changed and self-review's test analyzer reported gaps, offer `/test-audit branch` with your
recommendation (yes for parsers, money, security, concurrency or anything shared; no for a rename or a doc change).
Only on the user's yes. Hand it the Phase 2 run as its baseline and the pr-test-analyzer output from Phase 3, so
neither runs twice.

## Phase 6: Read

If anything was fixed since Phase 2, re-run the checks once now and read the output. Then ask the user to read the
branch in tui-review (`/tui-review <base>`; it shows committed changes only, so say if uncommitted work is left) and
answer their questions about it. Without tui-review: `git diff --stat <merge-base>` and offer to walk through it file
by file.

## Phase 7: Decide

The verdict, one row each, with the evidence:

| Part        | State                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| Checks      | green: the commands of the last run, its commit, and that the tree since is unchanged |
| Review      | findings fixed, findings the user left, and why                                       |
| Docs        | in step with the diff, or what was left                                               |
| Tests       | audited, or skipped and why                                                           |
| Read        | the user read it, or skipped                                                          |
| Decisions   | every item below, confirmed or reopened by the user                                   |
| Not checked | flow-rules **ponytail at chosen steps**, the footer line                              |

**Decisions** are what the build decided without the user, numbered in one list:

- each line under **Rulings** in the caller's flow.md;
- each entry under **Deviations** in it, with the decision it got;
- each new `shortcut:` line the branch adds: `git diff <merge-base> | rg '^\+.*shortcut:'`, plus `rg 'shortcut:'` on
  the untracked files.

Standalone, without a flow.md, only the shortcut lines. **Gate:** the user confirms or reopens each one (`all`, or
numbers to reopen). A reopened one is a fix on the user's yes: back to the caller's build flow, else fixed here, and
the checks re-run.

**Ready** means every row is green or the user accepted what is left. If the tree changed since the last run, re-run
the checks first. Then follow `finishing-a-development-branch` from its Step 2: the last run is its Step 1. Show its
options as it lists them, with your recommendation. It's the user's choice; called from a build flow, record it and
the confirmed decisions in its flow.md.
<!-- overrides superpowers/skills/finishing-a-development-branch/SKILL.md: "Run the project's full test suite" -->
