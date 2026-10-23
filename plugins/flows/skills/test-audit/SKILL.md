---
name: test-audit
description: 'Is the test suite appropriate? Run it, then find what it would miss: mutation testing (surviving mutants are weak tests), property-based testing where the code is a parser, codec or invariant, requirements with no test, and test smells. One ranked report, then the gaps you pick get filled test-first and the mutants re-run. Use for /test-audit [branch|all] [base].'
disable-model-invocation: true
argument-hint: '[branch|all] [base]'
---

# test-audit

Passing tests prove little on their own. This flow asks what a bug would have to look like to get past them.

| Phase    | Runs                                                                | Output                                          |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| 1 Scope  | flow-rules **Scope**                                                | source files and their tests                    |
| 2 Run    | superpowers `verification-before-completion` on the repo's tests    | baseline: green, red, slow, flaky               |
| 3 Probe  | in parallel: mutation, properties, requirements, smells             | candidate gaps                                  |
| 4 Report | flow-rules **Reports**                                              | `docs/audits/…-test-audit-<scope>.md`. **Gate** |
| 5 Fill   | superpowers `test-driven-development`, tob `property-based-testing` | new tests, mutants killed                       |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (tob is
its `tob-picks` folder). flow-rules **Stack packs** applies to the probes and Fill (a `*.csproj`: the csharp-skills
`testing` router, whose find-untested-sources, run-tests and test-gap-analysis fit Phases 1, 2 and 3).

## Phase 1: Scope

Source files in scope (branch: the changed ones; all: every non-test, non-vendored source file), each mapped to the
tests that exercise it (by import, name or a coverage run if the repo already has one configured). A source file with
no test at all is already a finding. Called from `/verify`: its pr-test-analyzer output is an input to the map.

## Phase 2: Run

Follow superpowers `verification-before-completion` with the test commands the repo documents (CLAUDE.md,
CONTRIBUTING.md, scripts, CI) and read the output. Called from `/verify`, its latest run is the baseline (it re-runs
first if the tree changed since): don't run the suite again. Record failures, skipped tests and the slowest ones. A red suite: stop, report it first and offer
`/fix-flow` on it; auditing tests that fail is pointless, and this flow fixes no code. Don't add tooling (coverage,
mutation tools, new test frameworks) without the user's yes.

## Phase 3: Probe

One message, these agents in parallel, each given the scope, the test map, the baseline and the path of the pack file
it follows:

- **Mutation:** tob `mutation-testing` when its tools (mewt, muton) support the language and are installed; read its
  results with its `workflows/analyzing-results.md`, and drop equivalent mutants (same behaviour) by
  `references/equivalent-mutants.md`. Else the language's own tool if already installed (cargo-mutants, Stryker,
  mutmut, PIT); offer to install one only with the cost (time per run). Else by hand: per scoped function, the
  mutations in superpowers `test-driven-development`'s `writing-good-tests.md` (The Mutation Check) and the tests
  that cover it. Mutants run in a scratch `git worktree` of `git stash create` (HEAD when the tree is clean) with the
  scope's untracked files copied in, never in the user's tree; nothing there is committed. A surviving mutant is a
  weak test.
- **Properties:** tob `property-based-testing`, to find code with only example tests that should have properties:
  encode/decode and serialize/deserialize pairs, parsers, normalizers, validators, comparators and sorting, numeric
  code, state machines. Name the property, don't write it yet.
- **Requirements:** tob `spec-to-code-compliance` with the spec (a `docs/features/*/` spec, CLAUDE.md, README) and the
  tests as the implementation: which stated behaviours no test checks.
- **Smells:** agent `self-review:pr-test-analyzer` on the scope's tests: tests that assert nothing or only that no
  error was thrown, mock the thing under test, sleep instead of waiting, pin implementation details, or duplicate
  another test (a delete candidate is a finding too). Called from `/verify` with its output: use that and don't run
  the agent again; this probe then checks the tests against `writing-good-tests.md`'s Warning Signs instead.

## Phase 4: Report

The findings table per flow-rules **Reports**, `kind` in the finding: missing test, surviving mutant (with the
mutant as a diff), property candidate (with the property), untested requirement, smell, delete candidate. Rank by
what a real bug there would cost, not by count: tob `mutation-testing`'s `references/severity-classification.md` for
mutants, mapped onto high, med and low, with the source scale kept in the evidence.

## Phase 5: Fill

Per picked finding, superpowers `test-driven-development`:

1. Write the test. For a surviving mutant, show it fails with the mutant applied (in the scratch worktree) and passes
   on the real code. For a requirement, show it fails when the behaviour is removed. A test that can't fail isn't done.
   That is RED here: a test of existing code passes on it by design.
   <!-- overrides superpowers/skills/test-driven-development/SKILL.md: "Test passes? You're testing existing behavior. Fix test." -->
2. Property candidates: tob `property-based-testing` writes the property with the repo's existing PBT library, or
   proposes one (a new dependency: the user's yes).
3. Delete candidates: delete, and show the mutants the deleted test killed are still killed.

Fill changes tests only. A production edit goes to the user first. A test or property that fails on the real code
stops that pick: classify it by tob `property-based-testing`'s `references/interpreting-failures.md` (a bug, an
ambiguous spec or a wrong test) and ask the user; a bug goes to `/fix-flow`.

Then re-run the suite (called from `/verify`, its Phase 6 does that) and the mutation probe on the touched area, and
put the before and after survivor counts in the report.
