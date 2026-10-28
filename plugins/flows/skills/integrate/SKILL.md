---
name: integrate
description: 'Take a verified branch to a PR: show and make the commits, write the PR title and body for your approval, hand you the push and gh lines to run yourself, then watch the CI checks and stop with cause and options on a red one. Never pushes, never runs a gh command that writes, never fixes CI by pushing. Resumable. Use for /integrate [base]; no argument resumes.'
disable-model-invocation: true
argument-hint: '[base branch]'
---

# integrate

Commit, PR, CI. Push and the `gh` commands that write are the owner's: this conductor writes the lines, the user runs
them.

| Phase    | Runs                                                                | Output                      |
| -------- | ------------------------------------------------------------------- | --------------------------- |
| 1 Commit | /verify's result, else superpowers `verification-before-completion` | commits shown, then made    |
| 2 PR     | pstack `blast-radius`, `flows:writing`                              | title and body. **Gate**    |
| 3 CI     | `Monitor` on `gh pr checks`                                         | green, or cause and options |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. State: the caller's
`docs/features/<slug>/flow.md` when there is one (standalone: none), with `phase:` `commit | pr | ci | done`
recorded in it. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (pstack is its `pstack-picks` folder).

**Never** run `git push` or a `gh` command that writes (`gh pr create`, `gh pr merge`, …), and never push a CI fix:
the owner's sandbox and hooks block them, and pushing is the owner's call. Hand each to the user as a `!` line to type.
Reading checks (`gh pr checks`, `gh run view`) is allowed; where it's blocked, the user runs it with `!`. There is no
release phase.

## Phase 1: Commit

- The checks: reuse `/verify`'s latest run when the caller's flow.md holds one for this commit with the tree unchanged
  since; otherwise follow superpowers `verification-before-completion` and run them fresh. A red check stops here.
- Group the changes into commits by purpose and **show them** (message and files each) before making any. A message is
  one sentence with no co-author lines. Stage with `git add -u` plus new paths by name, never `git add -A`; `git add`
  and `git commit` as separate commands. **Gate:** make them only after the user says yes to what you showed.
- Nothing to commit but the branch is ahead of its base: go on to Phase 2.

## Phase 2: PR

Write the body inline, short: why, what changed, blast radius (pstack `blast-radius` over the diff against the base:
what else it touches) and verification (the commands and results from Phase 1). Revise title and body by `flows:writing`
(the Skill tool). Save the body to a file in the scratchpad.

**Gate:** show the title and body; the user approves or edits them. Then hand over, to run in order:

```text
! git push -u origin <branch>
! gh pr create --title "<title>" --body-file <body file>
```

Wait for the user to say the PR exists (number or link).

## Phase 3: CI

Start `Monitor` on `gh pr checks <pr> --watch`. If `gh` is blocked there, ask the user to run it with `!` and paste
the output. All green: say so and set `phase: done`.

A red check: read its log and follow superpowers `systematic-debugging` to the cause, then **stop** with the failing
check, the cause and the options (a fix to commit and push, a rerun, a flaky test) with a recommendation. A fix is a
new `/fix-flow` or a commit here on the user's yes; the push is always the user's `!` line.
