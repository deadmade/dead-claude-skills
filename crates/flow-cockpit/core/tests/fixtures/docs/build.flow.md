---
flow: fix
phase: verify
now: Verify is running the tests.
---

# Crash on empty config: flow

## Request

The app crashes when the config file is empty.

## Gates

- Gate 1, cause and fix plan approved: 2026-10-25
- Gate 2, plan approved: 2026-10-25, execution: native

## Findings

`config.rs:41` unwraps the first line.

## Options

### Fix

Picked: return the default config

## Tasks

Task 1: base abc1234, untracked at start: none, files clean

## Verify

Verdict: clean.
