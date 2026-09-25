# Notes template

Copy everything below the line into `docs/features/<slug>/notes.md`. Keep the frontmatter first in the file: the
lock hook reads `verdict:` from it.

- `phase`: intent | research | understanding | verdict | design | implementing | wrap | done
- `verdict`: pending | ready | not-ready. Only `ready` lets the user's `approve design` through.

---

```markdown
---
phase: intent
verdict: pending
---

# <Feature>: notes

## Intent
<!-- Decisions from the intent grill; the confirmed summary. -->

## Later
<!-- Other slices, out-of-scope items, tangents. -->

## Sources
| id | source (title § section) | url or file:line | used for |
|---|---|---|---|

## What matters
| id | item | critical | source |
|---|---|---|---|

## Understanding grill
| Q | question | source | answer (summary) | grade |
|---|---|---|---|---|

## Verdict
<!-- Makes sense / feasible / ready, each with reasons and sources. Not ready: gaps + learning sources. -->

## Critique rounds

## Design grill

## Implementation
<!-- Slice list, then one report per slice. -->

## Deviations
```
