---
name: harden
description: 'Find what makes the code fragile: security holes, footgun APIs and dangerous defaults, bloat and dead code, and shallow modules worth deepening, from four passes run in parallel, merged into one ranked report, then fixes for the findings you pick. Use for /harden [branch|all] [base].'
disable-model-invocation: true
argument-hint: '[branch|all] [base]'
---

# harden

| Phase    | Runs                                                    | Output                                      |
| -------- | ------------------------------------------------------- | ------------------------------------------- |
| 1 Scope  | flow-rules **Scope**                                    | files                                       |
| 2 Passes | in parallel: security, sharp edges, bloat, architecture | findings                                    |
| 3 Report | flow-rules **Reports**                                  | `docs/audits/…-harden-<scope>.md`. **Gate** |
| 4 Fix    | per pick, test-first where behaviour changes            | fixes, re-checked                           |

[flow-rules.md](../../references/flow-rules.md) applies: read it first.

## Phase 2: Passes

One message, in parallel, each given the scope:

- **Security:** `claude-security:claude-security` (branch: "scan changes"; all: a scoped codebase scan), else the
  built-in `security-review`.
- **Sharp edges:** tob `sharp-edges` on the scope's public APIs, config schemas and defaults: what is easy to misuse.
- **Bloat:** ponytail `ponytail-audit` for `all`, `ponytail-review` for `branch`: dead code, needless abstraction,
  what to delete.
- **Architecture,** for `all` only: mattpocock `improve-codebase-architecture`, report part only (its grilling runs
  later, on a pick).

## Phase 3: Report

Merge the four into one table per flow-rules **Reports**. The same issue found twice is one finding, citing both. A
security finding keeps its own severity; never downgrade one to make the table read better.

## Phase 4: Fix

Per pick: a fix that changes behaviour gets a failing test first (superpowers `test-driven-development`); a deletion
shows the suite still passes. An architecture pick runs `improve-codebase-architecture`'s grilling on it, which may
turn it into a `/feature-flow` or `/implement` instead: offer that. Re-run the pass that found each fixed finding.
