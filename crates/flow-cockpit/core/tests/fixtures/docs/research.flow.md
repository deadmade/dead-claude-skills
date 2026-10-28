---
flow: research
phase: evaluate
now: Waiting for you to pick the approach (decision 1).
---

# Faster search: research flow

## Request

Make search faster and show the evidence.

## Gates

- Gate 1, spec and hypothesis approved: 2026-10-20
- Gate 2, plan approved: 2026-10-22, execution: subagent-driven

## Evidence

E1: BM25 beats embeddings on short queries.

## Options

### Ranking

Picked: BM25 only

## Hypothesis

BM25 alone is within two points of hybrid.

## Deviations

### Benchmark data is smaller than planned

Status: decided 2026-10-23: use the 200-query subset

## Results

| run      | command | numbers | date |
| -------- | ------- | ------- | ---- |
| baseline |         |         |      |

Verdict: supported.
