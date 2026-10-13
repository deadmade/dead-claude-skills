# Before/after consistency results (2026-10-13)

One-off run of the cases in `plugins/languages/*/evals/` (3 runs per arm per question, Claude Code 2.1.296).
Agreement is `docs/features/language-skills/agreement.mjs`: one `claude -p` judge call per pair of the 3 replies, so
0-3 agreeing pairs per arm.

Commands (from the repo root):

```bash
claude plugin eval plugins/languages/rust-skills --trust-plugin -j 4 --json rust.json
claude plugin eval plugins/languages/csharp-skills --trust-plugin -j 4 \
  --allow-tools "Read(//<absolute repo path>/plugins/languages/csharp-skills/**)" --json csharp.json
node docs/features/language-skills/agreement.mjs rust.json csharp.json
```

Cost: rust $3.16, csharp $3.91 (eval JSON `costUsd`, incl. judges), plus the agreement `claude -p` calls (not metered).
No run errors, no partial results.

| Q   | Area   | Agree with | Agree without | Eval WITH | W/OUT | Δ   | Skill fired (of 3) | Library read (of 3) |
| --- | ------ | ---------- | ------------- | --------- | ----- | --- | ------------------ | ------------------- |
| 1   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | -                   |
| 2   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 0                  | -                   |
| 3   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 2                  | -                   |
| 4   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | -                   |
| 5   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 0                  | -                   |
| 6   | rust   | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | -                   |
| 7   | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | 3                   |
| 8   | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | 3                   |
| 9   | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | 3                   |
| 10  | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 0                  | 0                   |
| 11  | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 2                  | 2                   |
| 12  | csharp | 3          | 3             | 1.00      | 1.00  | 0   | 3                  | 3                   |

## Keep bar

- Qualifying questions (without-arm under 3 agreeing pairs): **0 of 12**. Every without-arm already had 3/3.
- So "with higher on at least 8, or on all qualifying" holds vacuously (0 of 0). Nothing in this test shows the plugins
  improving consistency; the model is already consistent on these questions without them.
- The eval's own scores are 1.00 in both arms everywhere (the `answers` grader only checks that a reply picks one approach).

## Caveats

- The agreement judge was lenient: all 36 pairs were AGREE. "Same approach" judged at the headline recommendation level
  cannot see differences in detail (specific commands, lint flags, test names).
- The skills did not fire in every with-run: q2 and q5 (rust) 0/3, q3 2/3, q10 (web router) 0/3, q11 2/3. Those with-arms
  are effectively baseline runs.

## Open item

- "None judged worse" is the user's call. Not made here; to be put to the user and recorded in flow.md.
