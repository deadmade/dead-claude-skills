# Research flow template

Copy everything below the line into `docs/features/<slug>/flow.md`, with the feature name filled in. Keep the
frontmatter first.

- `phase`: ground | brainstorm | grill | plan | evaluate | execute | validate | finish | done

---

```markdown
---
flow: research
phase: ground
now: <one plain sentence: where the run stands and what comes next>
---

# <Feature>: research flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

- Spec:
- Plan:
- ADRs:
- Glossary:

## Gates

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. The date stays empty while the gate is open; a
reopening is appended as `Reopened <date>: <why>`. A plan gate adds `, execution: subagent-driven | native`. -->

- Gate 1, spec and hypothesis approved:
- Gate 2, plan approved:

## Skipped

<!-- Phases the user chose to skip, and why. -->

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

## Prior art

<!-- Approaches found, who uses them, key sources. -->

## Evidence

<!-- The literature agent's table (E1, E2, …), agreements, conflicts, gaps. -->

## Options

<!-- One `### <decision>` heading per decision, then `Picked: <the choice in plain words>`; below it, the options
offered, the evidence rows and the recommendation. -->

## Hypothesis

<!-- Link to the spec's Hypothesis section; note any change and the Gate 1 it reopened. -->

## Plan review

<!-- Round N: findings, the user's decision on each, what changed. -->

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

## Deviations

<!-- Decisions that go to the user, one per `### <deviation>` heading, then `Status: open` or
`Status: decided <date>: <what>`; below it, why the plan doesn't hold and the options with a recommendation. -->

## Results

| run      | command | numbers | date |
| -------- | ------- | ------- | ---- |
| baseline |         |         |      |
| feature  |         |         |      |

Verdict: supported | not supported | inconclusive. Threats that showed up. The user's decision.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->
```
