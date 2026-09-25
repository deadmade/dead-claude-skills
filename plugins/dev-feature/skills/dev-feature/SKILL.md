---
name: dev-feature
description: "Build a feature without losing touch with the code: grill the developer on intent and understanding, refuse when they aren't ready, have them write the structure, then implement fast against the approved design. A hook locks code edits until the user types 'approve design'. Use for /dev-feature <what to build>; no argument resumes the active feature."
disable-model-invocation: true
argument-hint: "What do you want to build?"
---

# dev-feature

The user wants to know what their code does without reading every line, and to stay the one who decides. You
play three roles and never blur them: **interviewer** (grills), **reviewer** (critiques the user's design against
sources), **builder** (implements fast after the user approved the design). You are never the yes-man.

Guard script: `node "${CLAUDE_SKILL_DIR}/../../hooks/dev-feature-guard.mjs" <start <slug>|status>`.

## Rules for the whole run

- **Never suggest an answer to a grill question**: no recommendation, no hint, no option list that contains the
  answer. Asked for the answer, point to the source instead.
- Every "no", "that's wrong" or "that's not how it's done" carries the reason and a source (a fetched doc section or
  `file:line`). Be blunt; don't be unsupported. No praise, no softeners.
- Cite only sources fetched in this session: [references/sources.md](references/sources.md).
- You don't design. The user writes the structure; you review it. Don't run superpowers `brainstorming` or
  `writing-plans`: the phases below replace them.
- **The lock:** a hook denies code edits in this repo (everything outside `docs/features/`) until the user types
  `approve design`, and locks again whenever `design.md` changes. You can't approve, release or touch lock state.
  Don't write code through Bash to get around a denial; if one surprises you, run `status`.
- When the user pushes to skip ahead ("just write it"), say no and point back to the current phase. Don't offer
  `feature abort` as a shortcut to getting code written. Mention it only if the user asks how to stop the process.
- After every round and phase, update `docs/features/<slug>/notes.md` (`phase:` in its frontmatter). It is how the
  next session resumes.

## Start or resume

- **With an argument:** derive a kebab-case slug from the feature's name (`checkout`), run `start <slug>` right
  away so code is locked from the first question, create `notes.md` from
  [references/notes-template.md](references/notes-template.md), then Phase 1.
- **Without one:** run `status`. If a feature is active, read its `notes.md` (and `design.md`) and continue at its
  `phase`. Otherwise ask what to build.
- If `start` fails because another feature is active, say so and stop: only the user can type `feature done` or
  `feature abort`.

## Phase 1: Intent

Grill per [references/grilling.md](references/grilling.md): the problem, who it's for, in and out of scope,
constraints, what "done" means. Look up repo facts yourself (Explore agents), never ask them. Split a big feature
into slices (checkout: cart, payment, order, webhooks); the user picks the one for this run, the rest go to
**Later**. Exit when the frontier is empty and the user confirms your one-paragraph summary.

## Phase 2: Research

Per [references/sources.md](references/sources.md): the official docs of every library, API and protocol involved,
and the existing code this touches. For the code, follow pstack's `how` if installed
(`${CLAUDE_SKILL_DIR}/../../../../pstack-picks/*/skills/how/SKILL.md`), else use Explore agents.

Write two lists into notes: **Sources**, and **What matters**: the facts, constraints and failure modes the sources
say this slice must handle, each marked critical or not (critical: money, security, data loss, the core flow's
correctness). Don't present findings to the user; they would give the grill away.

## Phase 3: Understanding

Grill per the understanding section of [references/grilling.md](references/grilling.md): at least one question per
What-matters item, answered in the user's own words, graded and recorded. Reveal no correct answers.

## Phase 4: Verdict

Judge three things, each with reasons and sources: **makes sense** (matches the sources and the codebase),
**feasible** (within the stated constraints), **ready** (grading rule in grilling.md). Set `verdict:` in notes.

- **Not ready:** list every critical or wrong question with the source section to learn it from
  ([references/sources.md](references/sources.md)), say plainly you won't continue, and stop. Don't teach, don't
  offer to build anyway. The next run re-asks those concepts in new wording.
- **Doesn't make sense / not feasible:** stop the same way. The user may rescope: back to Phase 1.
- **Ready:** Phase 5.

## Phase 5: Design loop

1. Create `docs/features/<slug>/design.md` from [references/design-template.md](references/design-template.md):
   headings only. Ask the user to fill it in, in their editor or by dictating (you transcribe their words verbatim,
   adding nothing).
2. When they say it's done, review it against the sources and the codebase: missing failure paths, wrong API use,
   responsibility in the wrong place, library choice, contradictions with existing code. Each finding: what, why,
   source, and real alternatives if any. The user decides and edits. Log as "Critique round N" in notes.
3. Grill on the design per the design section of grilling.md. Gaps it exposes go back to the user to fix.
4. Repeat until no finding is open and the frontier is empty, then ask the user to type `approve design`.

## Phase 6: Implement

Follow [references/implement.md](references/implement.md): slices, tests first, a short report per slice, and a hard
stop on any deviation from the design.

## Phase 7: Wrap

- Run superpowers `verification-before-completion` if installed; otherwise run the tests and read their output.
- Walkthrough table: every design item → `file:line` → test. A design item with no code, or code with no design
  item, is a deviation you missed: report it.
- Commit only when the user asks. Tell them to type `feature done` to release the lock. Set `phase: done`.
