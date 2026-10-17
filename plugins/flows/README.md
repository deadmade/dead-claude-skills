# flows

Conductor skills: each one runs the skills the rest of this marketplace ships, in order, stops at approval gates, and
keeps a state file so the next session can resume. Claude proposes and recommends; you decide.

| Conductor                   | Job                                               | Runs                                                                                              | Ends in              |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------- |
| `/understand <topic>`       | learn a codebase, subsystem or concept            | graphify, pstack `how` and `why`, mattpocock `teach` in learning style (you write the key lines)  | terms in CONTEXT.md  |
| `/feature-flow <what>`      | a new feature with a design                       | prior art, `brainstorming`, `grilling` + `domain-modeling`, `writing-plans`, plan review, execute | `/verify`, `/learn`  |
| `/research-flow <what>`     | a feature grounded in papers, hypothesis measured | feature-flow plus a literature agent (web-mcp papers, paper-lookup) and a measured result         | `/verify`, `/learn`  |
| `/implement <plan>`         | build from an existing plan, spec or ticket       | `to-tickets` or `writing-plans` if needed, superpowers execution                                  | `/verify`, `/learn`  |
| `/fix-flow <symptom>`       | fix a bug                                         | reproduce, `how` + `blast-radius`, upstream search, `systematic-debugging`, failing test first    | `/verify`, `/learn`  |
| `/upgrade <pkg>[@v]`        | bump a dependency                                 | changelogs via web-mcp and context7, `blast-radius`, bump, fix test-first                         | `/verify`, `/learn`  |
| `/test-audit [branch\|all]` | is the test suite appropriate?                    | run it, then mutation testing, property-based candidates, untested requirements, test smells      | gaps you pick filled |
| `/doc-audit [branch\|all]`  | do the docs tell the truth?                       | `spec-to-code-compliance` with the docs as spec, `claude-md-improver`, links/commands, prose      | fixes you pick       |
| `/harden [branch\|all]`     | security, footguns, bloat, architecture           | claude-security, tob `sharp-edges`, ponytail audit/review, `improve-codebase-architecture`        | fixes you pick       |
| `/verify [base]`            | is this branch ready for a PR?                    | checks, `/self-review`, `/doc-audit branch`, optional `/test-audit branch`, tui-review            | how to integrate     |
| `/learn [flow]`             | keep what the work taught                         | `revise-claude-md`, `domain-modeling`, a `docs/solutions/` note                                   | done                 |

`branch` (the default) audits what changed against the base, plus the tests and docs that should have changed with
it; `all` audits the whole repo, vendored content skipped.

## What each conductor uses

Generated from each conductor's `uses.json` by `node scripts/flows-uses.mjs`; `npm test` fails when it is stale.
Installing flows installs every plugin below.

<!-- uses:start -->

```text
doc-audit
├ tob-picks: spec-to-code-compliance, spec-compliance
├ claude-md-management@claude-plugins-official: claude-md-improver
├ web-mcp: fetch
└ pstack-picks: technical-writing, unslop

feature-flow
├ pstack-picks: how, architect, arena
├ claude-code: general-purpose
├ superpowers: brainstorming, writing-plans, subagent-driven-development, executing-plans
└ mattpocock-picks: grilling, domain-modeling

fix-flow
├ pstack-picks: how, blast-radius
├ web-mcp: search, fetch
└ superpowers: systematic-debugging, test-driven-development

harden
├ claude-security@claude-plugins-official: claude-security
├ tob-picks: sharp-edges
├ ponytail: ponytail-audit, ponytail-review
├ mattpocock-picks: improve-codebase-architecture
└ superpowers: test-driven-development

implement
├ pstack-picks: how
├ mattpocock-picks: to-tickets
└ superpowers: writing-plans, subagent-driven-development, executing-plans

learn
├ claude-md-management@claude-plugins-official: revise-claude-md
├ mattpocock-picks: domain-modeling
└ pstack-picks: recall

research-flow
├ claude-code: general-purpose
├ web-mcp: search
└ paper-lookup: paper-lookup

test-audit
├ tob-picks: mutation-testing, property-based-testing, spec-to-code-compliance
├ self-review: pr-test-analyzer
└ superpowers: test-driven-development

understand
├ graphify: graphify
├ pstack-picks: how, why
└ mattpocock-picks: teach, domain-modeling

upgrade
├ dead-skills: context7
├ web-mcp: fetch
└ pstack-picks: blast-radius

verify
├ superpowers: verification-before-completion, systematic-debugging, finishing-a-development-branch
├ self-review: self-review
├ pstack-picks: interrogate
└ tui-review: tui-review
```

<!-- uses:end -->

State lives in the repo: build flows in `docs/features/<slug>/flow.md`, audits in `docs/audits/`. The shared rules
are in [references/flow-rules.md](references/flow-rules.md).

Calls between conductors (`/fix-flow` → `/verify`) aren't listed. Each conductor still has a fallback for a
plugin that isn't there, for installs that skipped one.

## Install

    /plugin install flows@dead-claude-skills

or pick it in the installer (`npx --allow-git=root github:deadmade/dead-claude-skills#semver:*`), which also installs
its dependencies.
