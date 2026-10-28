# Build template

For `/implement`, `/fix-flow` and `/upgrade`. Copy everything below the line into `docs/features/<slug>/flow.md`,
with the title and `flow:` filled in. Keep the frontmatter first. The conductor names its phases.

---

```markdown
---
flow: implement | fix | upgrade
phase: <first phase>
now: <one plain sentence: where the run stands and what comes next>
---

# <Title>: flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

<!-- Plan, spec, tickets, reproduction, changelog: links. -->

## Gates

<!-- One line per gate: `- Gate <n>, <what>: <date>[, <extra>]`. The date stays empty while the gate is open; a
reopening is appended as `Reopened <date>: <why>`. A plan gate adds `, execution: subagent-driven | native`. -->

## Skipped

## Findings

<!-- What grounding found: file:line, root cause, breaking changes. -->

## Options

<!-- One `### <decision>` heading per decision, then `Picked: <the choice in plain words>`; below it, the options
offered and the recommendation. -->

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

## Deviations

<!-- Decisions that go to the user, one per `### <deviation>` heading, then `Status: open` or
`Status: decided <date>: <what>`; below it, why the plan doesn't hold and the options with a recommendation. -->

## Verify

<!-- /verify's verdict and what it fixed. -->

## Learned

<!-- What /learn kept, and where. -->

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->
```
