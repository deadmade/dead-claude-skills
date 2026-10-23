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

## Rulings

<!-- Calls the build made on its own (not deviation-class), one line each, as they are made. -->

## Deviations

<!-- Per task: `Task <N>: base <sha>`, then `files clean` or the deviation. Each deviation: what, why the plan
doesn't hold, options with a recommendation, the user's decision. -->

## Verify

<!-- /verify's verdict and what it fixed. -->

## Learned

<!-- What /learn kept, and where. -->

## Verdict

<!-- The user's, at Finish: worked as a whole: yes | no; clean: yes | no. -->
```
