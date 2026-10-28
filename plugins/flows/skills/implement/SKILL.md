---
name: implement
description: 'Build from a plan, spec or ticket that already exists, without the design phases of /feature-flow: turn a spec into tickets or a plan if needed, approve the plan, execute it test-first through superpowers, then /verify and /learn. One approval gate, resumable. Use for /implement <path to plan, spec or ticket>; no argument resumes.'
disable-model-invocation: true
argument-hint: 'Path to a plan, spec or ticket'
---

# implement

The design is done; build it. If the input turns out not to be a design (open questions, no clear behaviour), say so
and offer `/feature-flow` instead.

| Phase     | Runs                                                              | Output                     |
| --------- | ----------------------------------------------------------------- | -------------------------- |
| 1 Read    | the input, pstack `how` on the code it touches, the seam question | what's settled, what's not |
| 2 Plan    | mattpocock `to-tickets` and/or superpowers `writing-plans`        | plan. **Gate**             |
| 3 Execute | superpowers `subagent-driven-development` or `executing-plans`    | code, tests                |
| 4 Finish  | `/verify`, then `/learn`                                          | branch handled             |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. State: `docs/features/<slug>/flow.md` from
[build-template.md](../../references/build-template.md), `flow: implement`, phases `read | plan | execute | finish |
done`. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (pstack and mattpocock are its `-picks` folders).

## Start or resume

- **With an argument:** read it, derive a slug, create flow.md, Phase 1.
- **Without one:** resume a `flow: implement` flow.md whose `phase:` isn't `done` (several: ask which; none: ask for
  the input).

## Phase 1: Read

Read the input and everything it links. Run pstack `how` (fallback: Explore agents) on the code it touches and read
the domain docs that `<packs>/mattpocock-picks/skills/setup-matt-pocock-skills/domain.md` lists (the glossary and the
ADRs). Under **Findings**: where it lands (`file:line`), and every point the input
leaves open. A cross-cutting concern the input adds without saying where it is resolved and which modules never see
it is an open point: ask feature-flow's seam question (mattpocock `codebase-design`, pstack
`principle-redesign-from-first-principles` and `principle-boundary-discipline`). Up to three open points: ask them,
one at a time, with a recommendation each. More: the design isn't done; offer `/feature-flow`.

## Phase 2: Plan

- **A plan** (tasks with steps): check it against the code from Phase 1; stale paths or names are fixed in place. A
  task without a **Files** list gets one written before the Gate. Every task also gets, right below its heading,
  `**Does:** <one plain sentence for a reader who doesn't know the code>` and `**Depends on:** Task <n>, … | none`.
- **A spec or ticket:** follow superpowers `writing-plans` on it. For a spec too big for one branch, first offer
  mattpocock `to-tickets` and plan only the first ticket.

Either way, each seam answer from Phase 1 goes verbatim into the plan's **Global Constraints**.

**Gate:** read back the Global Constraints and each task's **Files** list (the deviation contract), then the user
approves the plan and picks the execution method (subagent-driven, or native = `executing-plans`), with your
recommendation. Record both as flow.md gate lines (`- Gate 1, <what>: <date>`).

## Phase 3: Execute

Read the chosen skill by path and follow it. It sets up the worktree and runs TDD and reviews itself. Stop where it
would invoke `finishing-a-development-branch`. Deviations stop the build: flow-rules **Deviations** (the fifth stop,
the brief clause, the files check, Rulings). Before SDD deletes its workspace, copy its ledger's `Ruling:` lines into
flow.md (flow-rules **Rulings**).

## Phase 4: Finish

Run `/verify` with the input as its intent (and that execution ran natively, if it did), then `/learn` on this flow.
Set `phase: done`.
