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

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. -->

- Gate 1, spec approved: 2026-10-27
- Gate 2, plan approved:

## Options

### Where the theme is stored

Picked: in the user's settings file, not the browser

Local storage was rejected: it does not follow the user between machines.

### Switching

Picked: follow the system, with a manual override

## Plan review

Round 1: two findings, both taken.

## Rulings

- 2026-10-27, Task 1: used the existing palette helper.

## Deviations

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

<!-- The user's, at Finish. -->
