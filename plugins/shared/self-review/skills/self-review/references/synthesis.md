# Synthesis

Many passes, one report. You are the lead reviewer, a pragmatic senior engineer, not an aggregator: the user reads
this right before opening a PR and wants to know what would embarrass them in review.

## Merge

1. Collect every finding. Bug-pass findings come in already scored; only those that scored 80 or more count.
2. Merge duplicates across passes (same place, same problem, different words) and keep the list of passes that raised
   it. Two passes agreeing is the strongest signal.
3. **Keep the Spec findings out of the merge.** Missing requirements, scope creep and wrong implementations of a
   requirement get their own section, as the upstream spec pass asks: a clean code review mustn't hide that the branch
   builds the wrong thing. When a finding is both (code that breaks the spec _and_ fails silently), it goes under
   Spec, and the code finding names it ("see 1") instead of repeating it. Without a spec, the section says
   "no spec: skipped".

## Check

Bug-pass findings are already verified by their score. For every other finding, trace a realistic path from a real
caller or input to the failure, reading the code. Drop what doesn't hold up, what is pre-existing on lines the
branch didn't touch (except the CLAUDE.md audit's, which looks at the whole file by design), and what lint, the
typechecker or CI would catch anyway. Count what you dropped.

## Buckets

- **Fix before PR:** a real bug, a security vulnerability, a breach of a documented standard, a silent failure, a
  missing test for a behavior the branch adds, a CLAUDE.md statement the branch made untrue, or anything a reviewer
  would block on. CLAUDE.md gaps the branch didn't cause go under Consider.
- **Consider:** a legitimate point whose fix might not be worth it now. Say the trade-off.
- **Noted:** valid, low impact. One line each.
- **Dismissed:** raised by a pass but wrong, nitpicky or missing context. One line each, with the reason.

## Format

```markdown
## Self-review: <branch> ← <base>

Passes: bugs, spec, standards, security, claude-md, silent-failure-hunter, pr-test-analyzer (skipped: type-design-analyzer, no new types)

**Verdict:** not ready, 2 to fix before PR

### Spec

1. **Wrong:** <requirement> at path/file.ts:12 (spec: "<quoted line>"). Fix: <the change>
2. **Missing:** <requirement> (spec: "<quoted line>")

- Not asked for: <behavior> at path/file.ts:40 (keep or drop: the user's call)

### Fix before PR

3. **<one-line problem>** path/file.ts:120 (bugs, silent-failure-hunter)
   <why it matters: the path from input to failure, in two lines>
   Fix: <the change>

### Consider

4. **…** path:line (standards) Trade-off: …

### Noted

- …

### Dismissed (N, plus M dropped in checking)

- … : <reason>
```

Number findings across Spec and all buckets, so the user can answer with numbers. The verdict is **ready** only
when Fix before PR is empty and Spec has nothing wrong or missing.
