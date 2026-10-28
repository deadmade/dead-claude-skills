---
flow: research
phase: validate
now: Waiting for you to read the results (Run verdict).
---

# Faster search: research flow

## Request

<!-- The user's words, verbatim. -->

Make search faster and show the evidence.

## Artifacts

- Spec: docs/features/faster-search/spec.md
- Plan: docs/features/faster-search/plan.md
- ADRs:
- Glossary:

## Gates

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. The date stays empty while the gate is open; a
reopening is appended as `Reopened <date>: <why>`. A plan gate adds `, execution: subagent-driven | native`. -->

- Gate 1, spec and hypothesis approved: 2026-10-20
- Gate 2, plan approved: 2026-10-22, execution: subagent-driven

## Skipped

<!-- Phases the user chose to skip, and why. -->

None.

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

Ranking lives in `rank.rs:30`.

## Prior art

<!-- Approaches found, who uses them, key sources. -->

Lucene and Tantivy rank with BM25.

## Evidence

<!-- The literature agent's table (E1, E2, …), agreements, conflicts, gaps. -->

E1: BM25 beats embeddings on short queries.

## Options

<!-- One `### <decision>` heading per decision, then `Picked: <the choice in plain words>`; below it, the options
offered, the evidence rows and the recommendation. -->

### Ranking

Picked: BM25 only

## Hypothesis

<!-- Link to the spec's Hypothesis section; note any change and the Gate 1 it reopened. -->

BM25 alone is within two points of hybrid.

## Plan review

<!-- Round N: findings, the user's decision on each, what changed. -->

Round 1: one finding, taken.

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

Task 1: base def5678, untracked at start: none, files clean

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

- 2026-10-23, Task 1: the benchmark runs in release mode.

## Deviations

<!-- Decisions that go to the user, one per `### <deviation>` heading, then `Status: open` or
`Status: decided <date>: <what>`; below it, why the plan doesn't hold and the options with a recommendation. -->

### Benchmark data is smaller than planned

Status: decided 2026-10-23: use the 200-query subset

### The second corpus is unreachable

Status: open

## Results

| run      | command | numbers | date       |
| -------- | ------- | ------- | ---------- |
| baseline | bench   | 0.71    | 2026-10-24 |
| feature  | bench   | 0.70    | 2026-10-24 |

Verdict: supported. No threats showed up. The user's decision: keep BM25.

## Walkthrough

| spec goal | plan task | file:line | test      |
| --------- | --------- | --------- | --------- |
| ranking   | Task 1    | rank.rs:1 | rank_test |

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->

Worked as a whole: yes; clean: yes.
