# Flow template

Copy everything below the line into `docs/features/<slug>/flow.md`, with the feature name filled in. Keep the
frontmatter first.

- `phase`: ground | brainstorm | grill | plan | evaluate | execute | finish | done

---

```markdown
---
flow: feature
phase: ground
---

# <Feature>: flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

- Spec:
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved: <date>, execution: subagent-driven | native

## Skipped

<!-- Phases the user chose to skip, and why. -->

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

## Prior art

<!-- Approaches found, who uses them, key sources. -->

## Options

<!-- Each decision: options offered, recommendation, what the user picked. -->

## Plan review

<!-- Round N: findings, the user's decision on each, what changed. -->

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
```
