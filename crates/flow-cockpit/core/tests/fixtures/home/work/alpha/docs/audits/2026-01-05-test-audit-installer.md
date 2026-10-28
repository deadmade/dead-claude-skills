# Test audit: installer

Scope: branch: feat-x ← main, 12 files

| #   | severity | where     | finding                   | evidence   | fix (recommended) |
| --- | -------- | --------- | ------------------------- | ---------- | ----------------- |
| 1   | high     | `a.ts:10` | test asserts nothing      | `npm test` | add an assertion  |
| 2   | med      | `b.ts:4`  | mocks the unit under test | quote      | use the real one  |
| 3   | low      | `c.ts:99` | duplicate case            | diff       | delete it         |

Picks: 1, 2

Fixed 2026-10-28: 1
