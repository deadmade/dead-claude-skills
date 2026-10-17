# Research flow template

Copy everything below the line into `docs/features/<slug>/flow.md`, with the feature name filled in. Keep the
frontmatter first.

- `phase`: ground | brainstorm | grill | plan | evaluate | execute | validate | finish | done

---

```markdown
---
flow: research
phase: ground
---

# <Feature>: research flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

- Spec:
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec and hypothesis approved:
- Gate 2, plan approved: <date>, execution: subagent-driven | native

## Skipped

<!-- Phases the user chose to skip, and why. -->

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

## Prior art

<!-- Approaches found, who uses them, key sources. -->

## Evidence

<!-- The literature agent's table (E1, E2, …), agreements, conflicts, gaps. -->

## Options

<!-- Each decision: options offered, evidence rows, recommendation, what the user picked. -->

## Hypothesis

<!-- Link to the spec's Hypothesis section; note any change and the Gate 1 it reopened. -->

## Plan review

<!-- Round N: findings, the user's decision on each, what changed. -->

## Deviations

## Results

| run      | command | numbers | date |
| -------- | ------- | ------- | ---- |
| baseline |         |         |      |
| feature  |         |         |      |

Verdict: supported | not supported | inconclusive. Threats that showed up. The user's decision.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
```
