---
flow: feature
phase: plan
now: Waiting for you to approve the plan (Gate 2).
---

# Dark mode: flow

## Request

<!-- The user's words, verbatim. -->

Add a dark mode to the settings page.

## Artifacts

- Spec: docs/features/dark-mode/spec.md
- Plan: docs/features/dark-mode/plan.md
- ADRs:
- Glossary:

## Gates

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. The date stays empty while the gate is open; a
reopening is appended as `Reopened <date>: <why>`. A plan gate adds `, execution: subagent-driven | native`. -->

- Gate 1, spec approved: 2026-10-27
- Gate 2, plan approved:

## Skipped

<!-- Phases the user chose to skip, and why. -->

Brainstorm: the user named the approach.

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

The settings page is `settings.ts:12`; colours come from `palette()`.

## Prior art

<!-- Approaches found, who uses them, key sources. -->

Most apps follow the system setting and allow an override.

## Options

<!-- One `### <decision>` heading per decision, then `Picked: <the choice in plain words>`; below it, the options
offered and the recommendation. -->

### Where the theme is stored

Picked: in the user's settings file, not the browser

Local storage was rejected: it does not follow the user between machines.

### Switching

Picked: follow the system, with a manual override

## Plan review

<!-- Round N: findings, the user's decision on each, what changed. -->

Round 1: two findings, both taken.

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

Task 1: base abc1234, untracked at start: none, files clean

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

- 2026-10-27, Task 1: used the existing palette helper.

## Deviations

<!-- Decisions that go to the user, one per `### <deviation>` heading, then `Status: open` or
`Status: decided <date>: <what>`; below it, why the plan doesn't hold and the options with a recommendation. -->

### The palette helper is private

Status: open

The plan assumes `palette()` is exported; it is not.

### The CSS file moved

Status: decided 2026-10-27: edit the new path

The old path no longer exists.

## Walkthrough

| spec goal | plan task | file:line | test      |
| --------- | --------- | --------- | --------- |
| dark mode | Task 1    | a.ts:1    | a.test.ts |

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->

Worked as a whole: yes; clean: yes.
