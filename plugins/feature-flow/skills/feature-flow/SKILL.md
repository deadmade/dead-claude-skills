---
name: feature-flow
description: 'Build a feature through the whole skill chain: ground in the code and in how other projects solve it, brainstorm with options, grill the spec with domain docs and ADRs, write the plan, evaluate it adversarially, then execute, verify and finish. Two approval gates, no lock. Use for /feature-flow <what to build>; no argument resumes the active feature.'
disable-model-invocation: true
argument-hint: 'What do you want to build?'
---

# feature-flow

One entry point that runs the skills this marketplace already ships, in order, and stops at two gates for the user.
Claude proposes and recommends; the user decides.

| Phase        | Runs                                                               | Output                                       |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------- |
| 1 Ground     | pstack `how` or Explore agents, a prior-art agent                  | grounding notes, prior-art report            |
| 2 Brainstorm | superpowers `brainstorming`                                        | spec                                         |
| 3 Grill      | mattpocock `grilling` + `domain-modeling`                          | sharper spec, `CONTEXT.md`, ADRs. **Gate 1** |
| 4 Plan       | superpowers `writing-plans`                                        | plan                                         |
| 5 Evaluate   | reviewer subagents per plan-review.md                              | revised plan. **Gate 2**                     |
| 6 Execute    | superpowers `subagent-driven-development` or `executing-plans`     | code, tests                                  |
| 7 Finish     | `verification-before-completion`, `finishing-a-development-branch` | walkthrough, branch handled                  |

## Rules for the whole run

- Open a todo list with one entry per phase. After every phase update `docs/features/<slug>/flow.md` (`phase:` in
  its frontmatter, links to every artifact). It is how the next session resumes.
- **This skill overrides the handoffs of the skills it runs.** When a sub-skill says to invoke the next skill
  (`brainstorming` → `writing-plans`, `writing-plans` → execution, execution → `finishing-a-development-branch`),
  don't: come back here and run the next phase.
- **Gates:** nothing is planned before Gate 1 and nothing is built before Gate 2. A gate passes only on the user's
  explicit approval of the artifact it names, recorded with the date in flow.md. "Sounds good" to an idea isn't
  approval of a document.
- The user may skip a phase by saying so ("skip grilling"); record it in flow.md. Never skip one on your own, and
  never skip a gate.
- Options always come with a recommendation and its reason. Every claim about another project or a library cites a
  source fetched in this session (rules in [references/prior-art.md](references/prior-art.md)).
- A missing skill: say which plugin provides it (superpowers, mattpocock-picks, pstack-picks) and use the fallback
  named in that phase. pstack skills can't be loaded with the Skill tool; read
  `${CLAUDE_SKILL_DIR}/../../../../pstack-picks/*/skills/<name>/SKILL.md` and follow it.
- Commit or push only when the user asks, unless a sub-skill's own step does it with the user's agreement.

## Start or resume

- **With an argument:** derive a kebab-case slug (`checkout-webhooks`), create `docs/features/<slug>/flow.md` from
  [references/flow-template.md](references/flow-template.md), then Phase 1.
- **Without one:** find `docs/features/*/flow.md` files whose `phase:` isn't `done`. One: read it and the artifacts
  it links, then continue at its phase. Several: ask which. None: ask what to build.

## Phase 1: Ground

Ask nothing yet. In one message, start both:

- **Codebase:** pstack `how` on the subsystems the feature touches (fallback: 1–3 Explore agents). Also read
  `CONTEXT.md`, `CONTEXT-MAP.md` and `docs/adr/` if they exist.
- **Prior art:** one background `general-purpose` agent with the prompt in
  [references/prior-art.md](references/prior-art.md). Don't wait for it; Phase 2 starts with questions anyway.

Write a short summary of each into flow.md under **Grounding** and **Prior art** as they land.

## Phase 2: Brainstorm

Invoke superpowers `brainstorming` with the feature request. Hand it the grounding as context it already has: it
doesn't need to offer recon of the codebase, and the web recon is already running. Follow it, with these changes:

- **Options.** Brainstorming wants the user describing before seeing options; keep that. Once the "how it gets made"
  question comes up, present the approaches from the prior-art report: per option, the shape in two lines, who does
  it this way (links), trade-offs for _this_ codebase, rough effort. End with your recommendation and why. The user
  picks; record the choice and the rejected options in flow.md under **Options**.
- **Size.** Brainstorming sizes the work as a quick task, a small change, or a project with a written design. A quick
  task or small change writes no spec, so this flow is overkill: say so and offer to drop out of it. If the user
  agrees, set `phase: done` with a note and let brainstorming finish its own way. Only a project continues here.
- **Skip.** If the user takes brainstorming's offer to skip the questions, brainstorming ends without a spec. Write it
  yourself from the request and the grounding, mark every choice you made as your call, and go to Phase 3; the grill
  stands in for the builder check. Gate 1 still applies.
- **Spike.** A spike the user agrees to is allowed. Record it in flow.md as throwaway: it isn't building, it doesn't
  pass Gate 2, and keeping its code goes through the plan like any other code.
- **Exit.** Once the spec is written and the builder check is folded in, stop: Gate 1 is the user's review of it,
  after the grill. Don't invoke `writing-plans`, even though brainstorming's hard gate says to. Link the spec in
  flow.md and go to Phase 3.

## Phase 3: Grill

Invoke `grilling` and `domain-modeling` (both mattpocock-picks; this is what `grill-with-docs` does) on the spec.
The design tree is the spec's open and assumed decisions; facts come from the code and the prior-art report, not
from the user. Recommended answers are fine here.

- Resolved terms go into `CONTEXT.md` as they happen; ADRs only under domain-modeling's three conditions. Link them
  in flow.md.
- Fold every settled decision back into the spec. The spec is the single source the plan is written from.
- Fallback without mattpocock-picks: grill in rounds yourself, one numbered question per open decision, with your
  recommendation under each.

**Gate 1:** when the frontier is empty, give a five-line summary of what changed in the spec and ask the user to
approve the spec. Record it.

## Phase 4: Plan

Invoke superpowers `writing-plans` on the approved spec. Let it run its own self-review. When it reaches its
**Execution Handoff**, don't ask for an execution method yet and don't invoke an execution skill: link the plan in
flow.md and go to Phase 5.

## Phase 5: Evaluate the plan

Follow [references/plan-review.md](references/plan-review.md): 2–3 reviewer subagents with different angles, then
you synthesize and screen. Present the findings, each with options and a recommendation. The user decides each one;
you edit the plan, and the spec too if a decision changes it (say so: that edit reopens Gate 1 for that item).

Optional, for a large or ambiguous design, offer before the review: pstack `architect` (sketch types and signatures
first) or `arena` (several models draft the plan, best one wins). Only on the user's yes.

**Gate 2:** ask the user to approve the plan **and** pick the execution method from `writing-plans`' handoff
(subagent-driven, or native = `executing-plans`), with your recommendation. Record both.

## Phase 6: Execute

Invoke the chosen skill: superpowers `subagent-driven-development` or `executing-plans`. They set up the worktree
(`using-git-worktrees`), run TDD and reviews themselves. Stop when they would invoke `finishing-a-development-branch`.

A **deviation** is anything the plan doesn't say: a new or changed public interface, another library or external
call, a changed data flow or failure handling. On one: stop, write it under **Deviations** in flow.md (what, why the
plan doesn't hold, the options with a recommendation), and let the user decide. A decision that changes the plan
needs their approval of that change before work continues. Private helpers and local names aren't deviations.

## Phase 7: Verify and finish

1. Invoke superpowers `verification-before-completion`: run the tests and checks, read their output.
2. Walkthrough table in flow.md: every spec goal → plan task → `file:line` → test. A goal with no code, or code with
   no goal, is a deviation: report it.
3. If execution ran natively (no per-task reviews), offer `/code-review` or pstack `interrogate` on the branch.
4. Invoke superpowers `finishing-a-development-branch` and let the user choose how to integrate. Set `phase: done`.
