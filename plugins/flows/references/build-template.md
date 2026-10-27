# Build template

For `/implement`, `/fix-flow` and `/upgrade`. Copy everything below the line into `docs/features/<slug>/flow.md`,
with the title and `flow:` filled in. Keep the frontmatter first. The conductor names its phases.

---

```markdown
---
flow: implement | fix | upgrade
phase: <first phase>
---

# <Title>: flow

## Request

<!-- The user's words, verbatim. -->

## Artifacts

<!-- Plan, spec, tickets, reproduction, changelog: links. -->

## Gates

## Skipped

## Findings

<!-- What grounding found: file:line, root cause, breaking changes. -->

## Tasks

<!-- One line per task: `Task <N>: base <sha>`, untracked at start: <files or none>, then `files clean` or
`deviation` (see Deviations). -->

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

## Deviations

<!-- Decisions that go to the user: what, why the plan doesn't hold, options with a recommendation, the
user's decision. -->

## Verify

<!-- /verify's verdict and what it fixed. -->

## Learned

<!-- What /learn kept, and where. -->

## Agents

<!-- One line per phase: `<phase>: <n> (<model> <n>, …)`. Past 60 (research) or 50 (other build flows), ask first
(flow-rules Agents). Deferred items, if any, go here too. -->

## Run verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->
```
