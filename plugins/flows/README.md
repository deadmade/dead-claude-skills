# flows

Conductor skills: each one runs the skills the rest of this marketplace ships, in order, stops at approval gates, and
keeps a state file so the next session can resume. Claude proposes and recommends; you decide.

| Conductor                   | Job                                               | Runs                                                                                                                                               | Ends in              |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `/understand <topic>`       | learn a codebase, subsystem or concept            | graphify, pstack `how` and `why`, mattpocock `teach` in learning style (you write the key lines)                                                   | terms in GLOSSARY.md |
| `/feature-flow <what>`      | a new feature with a design                       | prior art, `brainstorming`, `grilling` + `domain-modeling`, `writing-plans`, plan review, execute                                                  | `/verify`, `/learn`  |
| `/research-flow <what>`     | a feature grounded in papers, hypothesis measured | feature-flow plus a literature agent (web-mcp papers, paper-lookup) and a measured result                                                          | `/verify`, `/learn`  |
| `/implement <plan>`         | build from an existing plan, spec or ticket       | `to-tickets` or `writing-plans` if needed, superpowers execution                                                                                   | `/verify`, `/learn`  |
| `/fix-flow <symptom>`       | fix a bug                                         | reproduce, `how` + `blast-radius`, upstream search, `systematic-debugging`, failing test first                                                     | `/verify`, `/learn`  |
| `/upgrade <pkg>[@v]`        | bump a dependency                                 | changelogs via web-mcp and context7, `blast-radius`, bump, fix test-first                                                                          | `/verify`, `/learn`  |
| `/test-audit [branch\|all]` | is the test suite appropriate?                    | run it, then mutation testing, property-based candidates, untested requirements, test smells                                                       | gaps you pick filled |
| `/doc-audit [branch\|all]`  | do the docs tell the truth?                       | `spec-to-code-compliance` with the docs as spec, `claude-md-improver`, links/commands, prose                                                       | fixes you pick       |
| `/harden [branch\|all]`     | security, footguns, bloat, architecture           | claude-security, tob `sharp-edges`, ponytail audit/review, `improve-codebase-architecture`                                                         | fixes you pick       |
| `/self-review [base]`       | review your branch before a PR                    | bug pass, spec and standards pass, `security-review`, `claude-md-improver`, specialist agents (silent failures, tests, types, comments)            | fixes you pick       |
| `/verify [base]`            | is this branch ready for a PR?                    | checks once, `/self-review`, `/doc-audit branch`, optional `/test-audit branch`, tui-review, a Decisions gate on the build's rulings and shortcuts | how to integrate     |
| `/integrate [base]`         | commit, open the PR, watch CI                     | commits shown first, `blast-radius` + `writing` for the PR body, `!` lines for push and `gh` (never run), `Monitor` on the checks                  | PR open, CI green    |
| `/learn [flow]`             | keep what the work taught                         | `revise-claude-md`, `domain-modeling`, a `docs/solutions/` note, `writing-skills` for a skill or conductor lesson                                  | done                 |

`branch` (the default) audits what changed against the base, plus the tests and docs that should have changed with
it; `all` audits the whole repo, vendored content skipped.

## What each conductor uses

Generated from each conductor's `uses.json` by `node scripts/flows-uses.mjs`; `npm test` fails when it is stale.
Installing flows installs every plugin below; the packs ship inside flows itself.

<!-- uses:start -->

```text
doc-audit
├ tob-picks: spec-to-code-compliance, spec-compliance, spec-compliance-checker
├ claude-md-management@claude-plugins-official: claude-md-improver
├ web-mcp: fetch
└ flows: writing

feature-flow
├ pstack-picks: how, why, architect, arena, interrogate, blast-radius, principle-redesign-from-first-principles, principle-boundary-discipline
├ claude-code: general-purpose
├ superpowers: brainstorming, writing-plans, using-git-worktrees, subagent-driven-development, executing-plans
├ mattpocock-picks: codebase-design, grilling, domain-modeling
└ ponytail: ponytail-review

fix-flow
├ pstack-picks: how, why, blast-radius
├ web-mcp: search, fetch
└ superpowers: systematic-debugging, test-driven-development

harden
├ claude-security@claude-plugins-official: claude-security
├ tob-picks: sharp-edges
├ ponytail: ponytail-audit, ponytail-review
├ mattpocock-picks: improve-codebase-architecture, grilling
├ pstack-picks: principle-boundary-discipline
└ superpowers: test-driven-development

implement
├ pstack-picks: how, principle-redesign-from-first-principles, principle-boundary-discipline
├ mattpocock-picks: codebase-design, to-tickets
└ superpowers: writing-plans, subagent-driven-development, executing-plans

integrate
├ claude-code: Monitor
├ flows: writing
├ pstack-picks: blast-radius
└ superpowers: verification-before-completion, systematic-debugging

learn
├ claude-md-management@claude-plugins-official: revise-claude-md
├ mattpocock-picks: domain-modeling
├ pstack-picks: recall
└ superpowers: writing-skills

research-flow
├ claude-code: general-purpose
├ web-mcp: search
└ paper-lookup: paper-lookup

self-review
├ claude-code: security-review
├ claude-md-management@claude-plugins-official: claude-md-improver
└ pstack-picks: blast-radius

test-audit
├ tob-picks: mutation-testing, property-based-testing, spec-to-code-compliance
└ superpowers: verification-before-completion, test-driven-development

understand
├ pstack-picks: how, why
├ graphify: graphify
└ mattpocock-picks: teach, domain-modeling

upgrade
├ dead-skills: context7
├ web-mcp: fetch
├ pstack-picks: blast-radius
└ superpowers: writing-plans, test-driven-development

verify
├ superpowers: verification-before-completion, systematic-debugging, finishing-a-development-branch
├ pstack-picks: interrogate
└ tui-review: tui-review
```

<!-- uses:end -->

State lives in the repo: build flows in `docs/features/<slug>/flow.md`, audits in `docs/audits/`. The shared rules
are in [references/flow-rules.md](references/flow-rules.md).

Calls between conductors (`/fix-flow` → `/verify`) aren't listed. Each conductor still has a fallback for a
plugin that isn't there, for installs that skipped one.

## Writing

flows holds one standard for prose a person will read, in one skill, plus a check that runs on every write.

- **The `writing` skill** (`skills/writing/`) is Williams and Bizup's _Style: Lessons in Clarity and Grace_ in our own
  words, as checks to run on a draft from the top down: the problem and the point at the end of a short opening, the
  order the reader needs rather than the order the work happened in, topic strings and old-before-new, characters as
  subjects and actions as verbs, the book's six concision cuts limited by a density test, and naming who acted. A
  short section adds rules for technical documents that the book doesn't cover, such as no conversation shorthand.
  `references/` holds the full method of every lesson and both appendices, which Claude reads when a pass needs it.
  Unlike the conductors, Claude may load it on its own (`flows:writing`) whenever it writes a spec, a plan, a report,
  a README, a PR description or a commit message. `/doc-audit` reads changed docs against it and `/integrate`
  revises PR text by it.
- **The prose check** (`hooks/prose-check.mjs`, a `PostToolUse` hook on every `Write` and `Edit` of a `*.md` file)
  reports conversation shorthand (`Q4`, `D2`, `round 2`, `my call`) in the new text only: an Edit's new string, or
  the lines a Write added to the file. It is Node code with no model call, so it costs nothing per write. Claude sees
  its findings and may leave a sentence that a finding gets wrong. In `flow.md` files it is off, since flow.md is the
  log where those labels belong. `FLOWS_PROSE_CHECK=off` in the environment turns the check off.
- **The copyedit** (`skills/writing/references/copyedit.md`, `/flows:writing copyedit <file.md>`) has a fresh Opus
  agent revise a document by the skill for a reader who wasn't in the conversation, then lets the edit through only when code shows that no heading, code block, code span, link, URL,
  HTML comment, number, checkbox step or table row was lost. Code can't see meaning, so a dropped sentence or a
  flipped negation still needs the diff it shows. It commits nothing. Before a gate shows a spec, a plan or an audit
  report, the conductors run it on that document; when it refuses an edit, the gate shows the unedited document and
  what the edit lost.

## Packs

flows carries the skill packs its conductors run, in `packs/`: superpowers, ponytail, mattpocock-picks, pstack-picks,
tob-picks and paper-lookup, each written there by its `scripts/sync-*.mjs`. Claude Code scans only a plugin's root
`skills/`, `agents/` and `hooks/hooks.json`, so nothing under `packs/` loads on its own; the conductors read a pack's
skills by path (`${CLAUDE_PLUGIN_ROOT}/packs`). tob's spec checker is flows' own agent (`agents/spec-compliance-checker.md`),
since a pack's agents don't load. `/self-review` vendors its passes too, from claude-plugins-official's code-review
and pr-review-toolkit and from mattpocock's code-review (`skills/self-review/references/upstream/` and the other five
`agents/`, written by `scripts/sync-self-review.mjs`). Where a conductor changes a pack's rule it quotes the sentence it overrides in an
`overrides` comment marker, and `npm test` fails when that sentence is gone from the pack. To add
a pack, follow [docs/vendor-a-pack.md](../../docs/vendor-a-pack.md).

## Install

Pick it in the installer (see the [main README](../../README.md)), which also installs its dependencies.
