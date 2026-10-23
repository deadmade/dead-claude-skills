# Evaluating the plan

`writing-plans` already checked the plan against the spec. This pass checks it against everything else: the codebase,
the prior art, and the cheapest version that would work. The deliverable is a list of findings for the user, not a
silently edited plan.

## Reviewers

Spawn 2–3 `general-purpose` subagents in one message. Each gets: the spec, the plan, the grounding and prior-art
sections of flow.md, the ADRs, its angle below, and the rubric. Spread the angles over models from pstack
`interrogate`'s table, one angle per model; every angle below still runs, Simpler included.

| Angle           | Looks for                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Correctness** | Spec goals with no task. Failure paths with no handling or no test. Wrong use of an API or library against its docs. Concurrency, retries, ordering, data loss.                                                                                                                            |
| **Fit**         | Contradictions with existing code (`file:line`). Responsibility in the wrong module. Blast radius: callers, data, wire formats, configs the plan changes without saying so (pstack `blast-radius`). Task order: dependencies, a slice that can't be tested alone.                          |
| **Simpler**     | `<packs>/ponytail/skills/ponytail-review/SKILL.md`, with the plan in place of a diff: tasks the spec doesn't need, a library or built-in that replaces custom code. Also a smaller first slice that delivers the core, and divergence from every prior-art approach with no stated reason. |

Reviewer prompt tail (the Simpler reviewer reports in it, not in ponytail-review's Output format):
<!-- overrides ponytail/skills/ponytail-review/SKILL.md: "Then the findings in three groups, skip empty groups:" -->

```
Review only from your angle. Each finding: what is wrong, why (source: file:line, a doc section you fetched, or
the spec/prior-art section), severity (blocking | should-fix | consider), and 1–3 concrete options to fix it.
No praise, no summary of the plan, no style nits. "No findings" is a valid answer.
```

## Synthesis

1. Merge duplicates. Drop a finding you can't trace to a real source or a realistic path from a real input to the
   failure; say how many you dropped and why.
2. Order: blocking → should-fix → consider.
3. Per finding, use the options format from prior-art.md and add your recommendation. Group the `consider` ones in
   one short list.
4. Log as "Plan review round N" in flow.md: findings, the user's decision on each, what changed.

After the user decides, edit the plan. Re-run the review only if a decision changed the plan's shape (new task
order, new module, new library). For anything smaller, check the edit yourself.
