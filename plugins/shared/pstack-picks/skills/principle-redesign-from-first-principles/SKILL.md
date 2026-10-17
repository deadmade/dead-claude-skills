---
name: principle-redesign-from-first-principles
description: "Apply when integrating a new requirement into an existing design. Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on."
disable-model-invocation: true
---

> **Claude Code port:** skills this file names (for example **how**, **why**, **unslop**, **arena**, or a **...** principle skill) are sibling skills in this plugin. They are user-invoked, so the Skill tool can't load them. To use one, read `${CLAUDE_SKILL_DIR}/../<name>/SKILL.md` (principle skills: `${CLAUDE_SKILL_DIR}/../principle-<name>/SKILL.md`) and follow it. Subagents use the Agent tool; valid `model` values are `fable`, `opus`, `sonnet`, `haiku`.

# Redesign From First Principles

When integrating a change, don't bolt it onto the existing design. Redesign as if the requirement had been there from the start.

- Read all affected files and understand the current design
- Ask: "if we were writing this from scratch with this new requirement, what would we build?"
- Propagate the change through every reference: types, docs, examples, rationale sections
- Think about the whole redesign, then deliver it incrementally

This is the method for preserving option value when integrating changes into an existing design.
