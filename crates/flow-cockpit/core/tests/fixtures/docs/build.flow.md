---
flow: fix
phase: verify
now: Verify is running the tests.
---

# Crash on empty config: flow

## Request

<!-- The user's words, verbatim. -->

The app crashes when the config file is empty.

## Artifacts

<!-- Plan, spec, tickets, reproduction, changelog: links. -->

- Reproduction: `printf '' > config.toml && app`

## Gates

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. The date stays empty while the gate is open; a
reopening is appended as `Reopened <date>: <why>`. A plan gate adds `, execution: subagent-driven | native`. -->

- Gate 1, cause and fix plan approved: 2026-10-25
- Gate 2, plan approved: 2026-10-25, execution: native

## Skipped

None.

## Findings

<!-- What grounding found: file:line, root cause, breaking changes. -->

`config.rs:41` unwraps the first line.

## Options

<!-- One `### <decision>` heading per decision, then `Picked: <the choice in plain words>`; below it, the options
offered and the recommendation. -->

### Fix

Picked: return the default config

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

Task 1: base abc1234, untracked at start: none, files clean

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

- 2026-10-25, Task 1: an empty file and a missing file both give the default.

## Deviations

<!-- Decisions that go to the user, one per `### <deviation>` heading, then `Status: open` or
`Status: decided <date>: <what>`; below it, why the plan doesn't hold and the options with a recommendation. -->

### The default has no log level

Status: open

### The test helper is gone

Status: decided 2026-10-25: write the file by hand in the test

## Verify

<!-- /verify's verdict and what it fixed. -->

Verdict: clean.

## Learned

<!-- What /learn kept, and where. -->

An empty file is a valid config.

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->

Worked as a whole: yes; clean: yes.
