# Evaluating the plan

`writing-plans` already checked the plan against the spec. This pass checks it against everything else: the codebase,
the prior art, and the cheapest version that would work. The deliverable is a list of findings for the user, not a
silently edited plan.

## Reviewers

Spawn 2–3 `general-purpose` subagents in one message, fresh (never a fork, no `name`). Each gets: the spec, the plan,
the grounding and prior-art sections of flow.md, the ADRs, its angle below, and the rubric. Nothing else: not this
conversation, not the options the user rejected or why. If pstack `interrogate` is installed, use its model
spread (one reviewer per model) instead of one model with three angles.

| Angle           | Looks for                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Correctness** | Spec goals with no task. Failure paths with no handling or no test. Wrong use of an API or library against its docs. Concurrency, retries, ordering, data loss.                                                                                                                |
| **Fit**         | Contradictions with existing code (`file:line`). Responsibility in the wrong module. Blast radius: callers, data, wire formats, configs the plan changes without saying so (pstack `blast-radius` if installed). Task order: dependencies, a slice that can't be tested alone. |
| **Simpler**     | Tasks the spec doesn't need. A library or built-in that replaces custom code. A smaller first slice that delivers the core. Divergence from every prior-art approach with no stated reason.                                                                                    |

Reviewer prompt tail:

```
Review only from your angle. Each finding: what is wrong, why (source: file:line, a doc section you fetched, or
the spec/prior-art section), the check you did (what you read, fetched or ran), severity, and 1–3 concrete options
to fix it. Severity is the consequence of building the plan as written: blocking (it ships something wrong or
harmful that is costly to undo), should-fix (a real problem with a bounded effect), consider (cheap to ignore).
A claim about what code or a library does at runtime needs a check you ran; if you can't run one, say so.
No praise, no summary of the plan, no style nits. "No findings" is a valid answer.
```

## Synthesis

1. Merge duplicates. Drop a finding you can't trace to a real source or a realistic path from a real input to the
   failure; say how many you dropped and why. Before you drop or downgrade a blocking finding, one fresh agent rules
   on it against the source; log the reviewer's words, its ruling and both severities.
2. Order: blocking → should-fix → consider.
3. Per finding, use the options format from prior-art.md and add your recommendation. Group the `consider` ones in
   one short list.
4. Log as "Plan review round N" in flow.md: findings, the user's decision on each, what changed.

## After the user decides

1. **Edit the plan**, smallest change first: cut or narrow a task before adding one.
2. **Fix check.** One fresh agent that didn't make the edits gets each blocking and should-fix finding, the edited
   plan and the sources it cites: does the edit resolve the finding where it was raised and wherever the same problem
   appears in the plan, and did it break a neighboring task? PASS or FAIL per finding, with the line it read. A
   FAIL goes back to step 1; the same finding failing twice goes to the user with both attempts.
3. **Fresh eyes**, only if a decision changed the plan's shape (new task order, new module, new library). Two new
   reviewers that took no part so far, one on a different model where available, get the revised spec and plan, the
   grounding, prior art and ADRs, and one angle: "could you build this from the plan alone, and what would go wrong?"
   No findings and no revision history. Their findings go through Synthesis. Repeat until a round has no blocking
   finding.

Log fix checks and fresh-eyes rounds under the round in flow.md.
