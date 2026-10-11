---
name: self-review
description: 'Review your own branch before opening a PR: a confidence-scored bug pass, a spec pass and a standards pass, and specialist agents for error handling, tests, types and comments, all in parallel, then one ranked report and fixes for the findings you pick. Never posts anything. Use for /self-review [base].'
disable-model-invocation: true
argument-hint: '[base branch or commit]'
---

# self-review

The user is about to open a PR and wants it reviewed first. Run every pass in parallel on the local diff, give one
report, fix what they pick. Nothing is posted to GitHub or anywhere else.

The passes are vendored in this plugin (synced weekly, don't edit them):

| Pass        | Instructions                                                                                                  | Catches                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Bugs        | [references/upstream/code-review.md](references/upstream/code-review.md)                                      | real bugs, CLAUDE.md breaches, regressions against history, each scored for confidence |
| Spec        | [references/upstream/spec-standards-review.md](references/upstream/spec-standards-review.md)                  | missing or wrong requirements, scope creep                                             |
| Standards   | same file                                                                                                     | breaches of the repo's documented standards, code smells                               |
| Specialists | agents `self-review:silent-failure-hunter`, `:pr-test-analyzer`, `:type-design-analyzer`, `:comment-analyzer` | swallowed errors, test gaps, weak types, stale comments                                |

## Rules for the whole run

- **Never post.** The upstream bug pass ends by commenting on a PR with `gh`, and checks whether a PR is eligible
  first. Skip both (its steps 1, 7 and 8). Everything stays in this chat.
- **The diff is the working tree** against the merge-base, so uncommitted work counts: `git diff <merge-base>` plus
  untracked files (`git ls-files --others --exclude-standard`). Wherever an upstream file says `git diff X...HEAD` or
  `gh pr diff`, use this instead.
- Don't change code before the user picks findings in Phase 5.
- Commit only when the user asks.

## Phase 1: Scope

1. The base is the argument if given. Otherwise `git config branch.<current>.brvBase` (tui-review's remembered base).
   Otherwise the default branch: `origin/HEAD`, else `origin/main` or `origin/master`.
2. Run `git merge-base <base> HEAD`. If that fails, say why and stop.
3. List the changed and untracked files, with their `+/−` counts and the commits (`git log <merge-base>..HEAD
--oneline`). If the diff is empty, say so and stop.
4. Tell the user the scope in one line (`feature-x ← main, 12 files, +340 −95, 4 commits + uncommitted changes`), then
   continue without waiting.

## Phase 2: Intent

- **Spec**, first match wins:
  - a `docs/features/*/flow.md` (from /feature-flow) whose `phase:` isn't `done`, with the spec and plan it links
  - `docs/superpowers/specs/*` or `docs/superpowers/plans/*` whose name matches the branch or the commits
  - issue refs in the commit messages (`#123`, `Closes …`), fetched with `gh` or GitHub MCP if available
  - a path the user named
- No spec found: ask once, in one line. "None" skips the Spec pass, and the report says so. Don't block the other
  passes on the answer; start them, and start the Spec pass when it arrives.
- **Standards:** every CLAUDE.md in the repo root and in the changed directories, plus CONTRIBUTING.md,
  CODING_STANDARDS.md and anything similar under `docs/`.

## Phase 3: Fan out

One message, every agent in parallel:

- **Bug pass:** follow the upstream code-review.md, steps 2 to 6: the CLAUDE.md list, the summary, the five review
  angles, the confidence scoring, the cut below 80. Angle d (comments on previous PRs) runs only when `gh` or GitHub
  MCP is available. Keep its false-positive list: it applies here too.
- **Spec and Standards:** follow the upstream spec-standards-review.md, steps 3 and 4, with the diff, spec and
  standards from Phases 1 and 2. Its tracker setup (`/setup-matt-pocock-skills`) isn't needed: Phase 2 found the
  spec.
- **Specialists**, by what the diff touches. Give each the diff command, the file list and the intent:
  - `self-review:silent-failure-hunter`: try/catch, error returns, fallbacks, retries, default values on failure
  - `self-review:pr-test-analyzer`: whenever non-test source changed
  - `self-review:type-design-analyzer`: new or changed types, interfaces, schemas
  - `self-review:comment-analyzer`: added or changed comments or docs
- **Optional**, only when installed and the diff calls for it:
  - pstack `blast-radius`, for changes to shared code, public interfaces, data, wire formats or config. pstack skills
    can't be loaded with the Skill tool: read
    `${CLAUDE_SKILL_DIR}/../../../../pstack-picks/*/skills/blast-radius/SKILL.md` and follow it.
  - `claude-security`, or the built-in `security-review`, for auth, input parsing, secrets, file paths, shelling out
    or SQL.

Tell the user which passes are running and which were skipped, and why, in one line.

**Small diff** (at most 3 files and about 50 changed lines of code): agents cost more than they find here. Run the
passes yourself, one after another, each with its own checklist (the bug pass's angles and false-positive list, both
upstream axes, each applicable specialist's agent file under `${CLAUDE_SKILL_DIR}/../../agents/`), and say you did.
Everything else stays the same, the report format included.

## Phase 4: Report

Follow [references/synthesis.md](references/synthesis.md): merge, check, bucket, and one verdict line.

## Phase 5: Fix

Ask which findings to fix: "all fix-before-PR", numbers, or none. Then:

1. Fix them. A fix that would change the design or the spec goes back to the user first.
2. Run the repo's tests, lint and typecheck, and read the output. Report what passed and what didn't.
3. Offer the `self-review:code-simplifier` agent on the changed files, as a last polish. Only on the user's yes.
4. Re-run only the passes whose findings were fixed, if the user wants a check.
5. Say when the branch is ready for a PR. Commit only when asked.
