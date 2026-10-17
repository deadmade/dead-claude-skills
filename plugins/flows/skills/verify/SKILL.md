---
name: verify
description: 'Prove a branch is ready for a PR: run the tests and checks and read their output, /self-review the diff, /doc-audit the docs it touched, optionally /test-audit it, read it in tui-review, then give a verdict and offer how to integrate. Never opens a PR or pushes on its own. Use for /verify [base].'
disable-model-invocation: true
argument-hint: '[base branch or commit]'
---

# verify

Is this branch ready for a PR? Evidence for each part of the answer, then the user decides what happens to the branch.

| Phase    | Runs                                                       | Output                      |
| -------- | ---------------------------------------------------------- | --------------------------- |
| 1 Scope  | flow-rules **Scope**, `branch`                             | base, diff, intent          |
| 2 Checks | superpowers `verification-before-completion`               | every check green, or a fix |
| 3 Review | `/self-review`                                             | code findings fixed         |
| 4 Docs   | `/doc-audit branch`                                        | docs match the diff         |
| 5 Tests  | `/test-audit branch`, on the user's yes                    | test gaps filled            |
| 6 Read   | tui-review                                                 | the user read the diff      |
| 7 Decide | verdict, then superpowers `finishing-a-development-branch` | **Gate**: what happens next |

[flow-rules.md](../../references/flow-rules.md) applies: read it first.

## Phase 1: Scope

The base is the argument, else as flow-rules **Scope** says. The intent is the spec the caller handed over, else what
self-review's Phase 2 finds. An empty diff: say so and stop.

## Phase 2: Checks

Invoke `verification-before-completion`. The checks are what the repo documents (CLAUDE.md, CONTRIBUTING.md, the
`test`/`lint` scripts, the CI workflows the diff would trigger), not a guess: run every one that applies to the
changed files and read the output. A red check stops the flow: show the failing output, find the cause with
superpowers `systematic-debugging`, and fix it on the user's yes before going on.

## Phase 3: Review

Run `/self-review` with the base from Phase 1 (read its SKILL.md, see flow-rules **Loading skills**). Its fix phase
applies; the user picks what gets fixed. A caller that says execution ran without per-task reviews also gets pstack
`interrogate` offered here.

## Phase 4: Docs

Run `/doc-audit branch` with the same base. self-review's CLAUDE.md pass already ran, so tell doc-audit to skip its
CLAUDE.md step.

## Phase 5: Tests

If non-test source changed and self-review's test analyzer reported gaps, offer `/test-audit branch` with your
recommendation (yes for parsers, money, security, concurrency or anything shared; no for a rename or a doc change).
Only on the user's yes.

## Phase 6: Read

If anything was fixed since Phase 2, re-run the checks first. Then ask the user to read the branch in tui-review
(`/tui-review <base>`; it shows committed changes only, so say if uncommitted work is left) and answer their questions
about it. Without tui-review: `git diff --stat <merge-base>` and offer to walk through it file by file.

## Phase 7: Decide

The verdict, one row each, with the evidence:

| Part   | State                                           |
| ------ | ----------------------------------------------- |
| Checks | green: the commands run                         |
| Review | findings fixed, findings the user left, and why |
| Docs   | in step with the diff, or what was left         |
| Tests  | audited, or skipped and why                     |
| Read   | the user read it, or skipped                    |

**Ready** means every row is green or the user accepted what is left. Then invoke `finishing-a-development-branch`
for the choice (open a PR, merge, keep, discard) with your recommendation. It's the user's choice; called from a build
flow, record it in its flow.md.
