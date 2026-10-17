---
name: learn
description: 'Keep what a piece of work taught, so the next session starts smarter: collect the surprises, decisions and root causes from a flow or the current session, sort each to its home (CLAUDE.md, CONTEXT.md, an ADR, docs/solutions/, or memory), and write the ones you pick. The last step of every build flow. Use for /learn [flow.md or topic].'
disable-model-invocation: true
argument-hint: '[path to a flow.md, or what to look back on]'
---

# learn

Most of what a session learns dies with it. This flow keeps the few things the next session would otherwise pay for
again, and drops the rest.

| Phase    | Runs                                                    | Output                     |
| -------- | ------------------------------------------------------- | -------------------------- |
| 1 Gather | the caller's flow.md, else pstack `recall`              | candidate lessons          |
| 2 Sort   | each to one home                                        | proposed entries. **Gate** |
| 3 Write  | `revise-claude-md`, `domain-modeling`, a solutions note | entries written            |

[flow-rules.md](../../references/flow-rules.md) applies: read it first.

## Phase 1: Gather

From a build flow: its flow.md (deviations, rejected options, plan-review findings, the verify verdict) and the
branch's commits. Standalone: the flow.md named in the argument, else pstack `recall` on the topic or the current
session.

A lesson is something that cost time or a wrong turn and isn't obvious from the code: a root cause, a constraint
found the hard way, a convention the code follows that nobody wrote down, a decision and what it gave up, a tool or
check that didn't behave as documented. Not a lesson: what the diff or `git log` already says, or a step-by-step of
what was done.

## Phase 2: Sort

Each lesson gets one home:

| Home                       | When                                                                                 | Through                                 |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| CLAUDE.md                  | an instruction a future session must follow in this repo (a command, a trap, a rule) | `claude-md-management:revise-claude-md` |
| `CONTEXT.md`               | a domain term or relationship got settled                                            | mattpocock `domain-modeling`            |
| `docs/adr/`                | a decision that is hard to reverse, surprising without context, and a real trade-off | mattpocock `domain-modeling`            |
| `docs/solutions/<slug>.md` | a solved problem someone may hit again                                               | the format below                        |
| Claude's memory            | about the user or how they like to work, not about the repo                          | the memory directory                    |

Present them as one numbered list: the lesson in one line, its home, and the exact text to write. Recommend dropping
weak ones; three good entries beat ten. **Gate:** the user picks.

## Phase 3: Write

Write the picked entries through the skill named for their home. A solutions note:

```markdown
# <Symptom, in the words someone would search for>

- **Seen:** <date>, <where: command, file, error text>
- **Cause:** <the root cause, with file:line>
- **Fix:** <what fixed it; commit or PR>
- **Spot it next time:** <the check or signal that would have caught it sooner>
```

Called from a build flow, list what was written under **Learned** in its flow.md.
