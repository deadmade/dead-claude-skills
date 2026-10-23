---
name: doc-audit
description: 'Check that the docs tell the truth about the code: every claim in READMEs, docs/, CLAUDE.md and manifest descriptions held against the code (contradicted, unbacked, undocumented), commands, paths, links and versions checked, changed prose edited, then one ranked report and fixes for the findings you pick. Use for /doc-audit [branch|all] [base]; branch (default) checks the docs the diff touched or should have.'
disable-model-invocation: true
argument-hint: '[branch|all] [base]'
---

# doc-audit

Do the docs say what the code does? Docs are the spec here and the code is the truth, unless the user says the code
is the bug.

| Phase       | Runs                                        | Output                                         |
| ----------- | ------------------------------------------- | ---------------------------------------------- |
| 1 Scope     | flow-rules **Scope**                        | the docs to check                              |
| 2 Claims    | tob `spec-to-code-compliance`, docs as spec | contradicted, unbacked, undocumented           |
| 3 CLAUDE.md | `claude-md-improver`, report only           | stale or missing instructions                  |
| 4 Mechanics | commands, paths, links, versions            | broken references                              |
| 5 Prose     | pstack `technical-writing` + `unslop`       | wording findings, changed docs only            |
| 6 Report    | flow-rules **Reports**                      | `docs/audits/…-doc-audit-<scope>.md`. **Gate** |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (tob and
pstack are its `-picks` folders).

## Phase 1: Scope

The docs are READMEs, `docs/` (not `docs/audits/` or `docs/features/*/` working files), CLAUDE.md and CONTRIBUTING.md
files, the `description` fields of manifests (`package.json`, `plugin.json`, a marketplace, `Cargo.toml`), and CLI
help text and skill descriptions that document behaviour.

- **all:** every such doc, vendored ones skipped per flow-rules.
- **branch:** docs the diff changed, plus docs that name what the diff changed: grep them for each changed file path,
  exported symbol, command, flag, config key and env var. New public surface (a command, option, tool, setting) with
  no doc naming it is itself a finding for Phase 2.

List the docs with a one-line reason each and continue.

## Phase 2: Claims

Follow tob `spec-to-code-compliance` with the docs as the specification and the scope's code as the implementation.
Its own text dispatches the checks; here they run as: a handful of claims (a usual `branch`): one `flows:spec-compliance-checker`
per claim, in parallel. More (`all`, or a long doc): offer the tob `spec-compliance` workflow (flow-rules **Loading
skills**; `path` the scope's code, `spec` the doc, `outDir` under `$TMPDIR`), with its cost: one checker agent per
requirement plus two refuters per divergence. Only on the user's yes; on no, the checkers per claim. Per doc, its
verdicts become findings:

- **contradicted** (and `partial`): the doc says X, the code does Y. Quote both with `file:line`.
- **unbacked** (`absent`): the doc claims behaviour no code implements.
- **undocumented** (`stronger-than-spec`, and the workflow's reverse sweep): the code does something user-facing no
  doc mentions.
- `undecidable`: the doc is too vague to check; a finding against the doc.

## Phase 3: CLAUDE.md

Skip when `/verify` called this flow (self-review already ran it). Otherwise invoke
`claude-md-management:claude-md-improver`: discovery and assessment, proposed diffs as findings, apply nothing yet.
Lead with statements the code makes untrue.

## Phase 4: Mechanics

In the scoped docs, check what can be checked by running something:

- **Paths and links:** every repo path exists; every relative link and anchor resolves.
- **URLs:** fetch each with web-mcp `fetch` (fallback WebFetch); report errors, and redirects to a different page.
- **Commands:** the binary, script, subcommand and flag each exist (`--help`, the script's source, the manifest).
  Run a documented command only when it's read-only or the repo's own check; never one that installs, deletes,
  pushes or publishes.
- **Versions and names:** versions, plugin and package names, env vars and config keys match their source.
- **Claude Code plugin manifests:** `claude plugin validate <plugin folder>`, when `claude` is on PATH.

## Phase 5: Prose

Docs the diff changed (branch) or that Phase 2 flagged (all): pstack `technical-writing`, then `unslop`. Findings
only, severity low unless the wording misleads.

## Phase 6: Report

The findings table per flow-rules **Reports**, severity by consequence per tob `spec-to-code-compliance`'s
`resources/DIVERGENCE_RUBRIC.md`. A fix changes the doc to match the code. When the code looks like the
bug (the doc describes the intended behaviour), say so: that finding's options are fix the code or fix the doc, and
the user picks. A vendored doc's fix goes into its sync script's transform. After the fixes, re-run Phases 2 and 4 on
the changed docs.
