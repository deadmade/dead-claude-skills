---
name: harden
description: 'Find what makes the code fragile: security holes (with per-domain checklists for AI/MCP, supply chain, cloud, IPC and more), footgun APIs and dangerous defaults, bloat and dead code, and shallow modules worth deepening, from five passes run in parallel, merged into one ranked report, then fixes for the findings you pick. Use for /harden [branch|all] [base].'
disable-model-invocation: true
argument-hint: '[branch|all] [base]'
---

# harden

| Phase    | Runs                                                                      | Output                                      |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| 1 Scope  | flow-rules **Scope**                                                      | files                                       |
| 2 Passes | in parallel: security, security domains, sharp edges, bloat, architecture | findings                                    |
| 3 Report | flow-rules **Reports**                                                    | `docs/audits/…-harden-<scope>.md`. **Gate** |
| 4 Fix    | per pick, test-first where behaviour changes                              | fixes, re-checked                           |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (tob,
mattpocock and pstack are its `-picks` folders; cloudflare is `security-audit`).

## Phase 2: Passes

One message, in parallel, each given the scope:

- **Security:** `claude-security:claude-security` (branch: "scan changes"; all: a scoped codebase scan), else the
  built-in `security-review`.
- **Security domains:** cloudflare `security-audit`'s domain files, in its guidance mode (never its six-phase audit,
  output directory or ledger). From `<packs>/security-audit/skills/security-audit/`, read each domain file's
  **When to use this file** and pick those whose boundary the scope has: a source fact (an MCP server, a release
  workflow, a D-Bus call), not a dependency name. None picked: skip this pass and say so.
  - One `general-purpose` hunter per picked file, given the scope and that file's **Core discipline**, attack-class
    sections, **Universal moves** and **Validation rules**, verbatim. It hunts that file's classes only (the security
    pass covers injection, access control, memory safety and crypto), reads source and runs no target code, and
    returns each candidate with its source trace from entry point to sink, the boundary it crosses, and the result.
  - Each candidate then goes to a fresh `general-purpose` verifier that did not hunt it, given the
    **Candidate-verifier prompt** from `VALIDATION-AND-REPORTING.md` and the `confirmed`, `needs_validation` and
    `rejected` branches of `report-schema.json`. Rejected candidates are dropped.
    <!-- overrides security-audit/skills/security-audit/SKILL.md: "Guidance mode: For security questions, focused reviews, methodology, triage, or investigation of specific findings, use only the relevant parts of this skill." -->
    <!-- overrides security-audit/skills/security-audit/VALIDATION-AND-REPORTING.md: "You did not write this candidate. Try to refute it from repository source and bounded local evidence." -->
- **Sharp edges:** tob `sharp-edges` on the scope's public APIs, config schemas and defaults: what is easy to misuse.
- **Bloat:** ponytail `ponytail-audit` for `all`, `ponytail-review` for `branch`: dead code, needless abstraction,
  what to delete.
- **Architecture,** for `all` only: mattpocock `improve-codebase-architecture`, report part only (its grilling runs
  later, on a pick), with pstack `principle-boundary-discipline` as a lens: a concern carried through many modules
  instead of resolved at one boundary is a finding.

## Phase 3: Report

Merge the five into one table per flow-rules **Reports**. The same issue found twice is one finding, citing both. A
security finding keeps its own severity; never downgrade one to make the table read better. A security-domains
`confirmed` record takes its own severity (`critical` and `informational` stay as written). Its `needs_validation`
records have no severity and no fix to pick: list them under the table as **Needs validation**, each with its blocker
and validation plan.

## Phase 4: Fix

Per pick: a fix that changes behaviour gets a failing test first (superpowers `test-driven-development`); a deletion
shows the suite still passes. An architecture pick runs `improve-codebase-architecture`'s grilling on it (mattpocock
`grilling`, read by path), which may turn it into a `/feature-flow` or `/implement` instead: offer that. Re-run the
pass that found each fixed finding.
<!-- overrides mattpocock-picks/skills/improve-codebase-architecture/SKILL.md: "Once the user picks a candidate, call the Skill tool with "grilling" to walk the decision tree with them" -->

The pick is the contract: the files its finding names are its **Files** list. A fix that needs more stops: flow-rules
**Deviations** (the fifth stop, the brief clause, the files check, Rulings), with **Deviations**, **Tasks** and
**Rulings** kept in the audit report, since harden has no flow.md.
