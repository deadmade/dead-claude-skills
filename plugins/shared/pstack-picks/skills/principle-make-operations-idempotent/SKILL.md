---
name: principle-make-operations-idempotent
description: "Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs."
disable-model-invocation: true
---

> **Claude Code port:** skills this file names (for example **how**, **why**, **unslop**, **arena**, or a **...** principle skill) are sibling skills in this plugin. They are user-invoked, so the Skill tool can't load them. To use one, read `${CLAUDE_SKILL_DIR}/../<name>/SKILL.md` (principle skills: `${CLAUDE_SKILL_DIR}/../principle-<name>/SKILL.md`) and follow it. Subagents use the Agent tool; valid `model` values are `fable`, `opus`, `sonnet`, `haiku`.

# Make Operations Idempotent

Design operations so they converge to the correct state regardless of how many times they run or where they start from. Every state-mutating operation should answer: "What happens if this runs twice? What happens if the previous run crashed halfway?"

**Why:** Commands, lifecycle operations, and processing loops run where crashes, restarts, and retries are normal. If partial state changes the next run's outcome, every restart becomes a debugging session.

**The pattern:**
- Convergent startup: scan for existing state, clean stale artifacts, adopt live sessions
- Content-based cleanup: compare by content equivalence, not creation order
- Self-healing locks: use PID-based stale lock detection
- Idempotent scheduling: failed work respawns cleanly, fresh input regenerated after each cycle

**The test:**
1. What happens if this runs twice in a row?
2. What happens if the previous run crashed at every possible point?
3. Does re-execution converge to the same end state?

If any answer is "it depends on what state was left behind," the operation needs a reconciliation step.
