---
name: understand
description: 'Learn a codebase, a subsystem or a concept by doing: map it (pstack how, graphify when a graph exists), learn why it is that way (pstack why), then a guided lesson through mattpocock teach where you write the key lines and Claude explains, and keep the terms you settled in GLOSSARY.md. Use for /understand <topic, path or concept>.'
disable-model-invocation: true
argument-hint: 'What do you want to understand? (a path, a subsystem, a concept)'
---

# understand

Reading an explanation isn't understanding. This flow maps the ground, then makes the user do the parts that matter.

| Phase    | Runs                               | Output                           |
| -------- | ---------------------------------- | -------------------------------- |
| 1 Map    | pstack `how`, graphify             | a map: parts, flow, entry points |
| 2 Why    | pstack `why`                       | the decisions behind it          |
| 3 Lesson | mattpocock `teach`, learning style | the user did the key parts       |
| 4 Keep   | mattpocock `domain-modeling`       | terms in `GLOSSARY.md`           |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. Packs: `${CLAUDE_PLUGIN_ROOT}/packs` (pstack
and mattpocock are its `-picks` folders). No state file; one lesson per run. The real tree is never edited here: a
change the user wants for real stops the lesson and goes to a build flow, with the map and the why as its input.

## Phase 1: Map

Ask the user, once: what they already know, and what they want to be able to do afterwards (change it, review it,
explain it). Then:

- pstack `how` on the topic (fallback: Explore agents): the parts, how a request or call flows through them, the
  entry points, with `file:line`. Put the shape you want into its question: one short diagram or table, not a wall of
  text. Show what it returns as it is.
- If `graphify-out/graph.json` exists, query it for the topic first (graphify's `references/query.md` only), read-only:
  skip its `save-result` and `graphify reflect`. No graph: offer `/graphify` for a large repo (it costs a build), only
  on the user's yes.

## Phase 2: Why

One pstack `why` run whose question names the two or three choices in the map that look strangest. Add to its code
anchor the repo's decision records: `docs/adr/`, and the `docs/features/*/` flow.md, spec and plan that touch the
target. Cite the commit, PR, ADR or doc for each; "unknown" is an answer.

## Phase 3: Lesson

Follow mattpocock `teach` with the map, the why and the user's goal, for this one lesson. Its workspace is the chat
and one scratch file outside the repo: no `MISSION.md`, `lessons/`, `learning-records/` or other workspace files in
the repo. If the user wants a course over many sessions, offer `teach` in a folder of its own instead.
<!-- overrides mattpocock-picks/skills/teach/SKILL.md: "This is a stateful request - they intend to learn the topic over multiple sessions." -->
<!-- overrides mattpocock-picks/skills/teach/SKILL.md: "Treat the current directory as a teaching workspace." -->

Teach in learning style throughout:

- At each decision point the user writes the code or the answer (5–10 lines, or one sentence) in the scratch file or
  the chat.
- Claude takes the boilerplate, then reviews what the user wrote against the real code and says what differs and why.
- Short insight notes on the patterns the code uses, tied to `file:line`.

For a codebase lesson, the map's `file:line` and why's citations are the sources; outside resources only for a concept
lesson. Stop when the user can do what they said they wanted, or says stop.

## Phase 4: Keep

Collect the terms that came up during the lesson. Offer to run mattpocock `domain-modeling` on them, so the next
person (or session) has them in `GLOSSARY.md` (or the one `GLOSSARY-MAP.md` points at). Only on the user's yes, with
the exact entries shown first. Terms from a concept lesson aren't the project's: they never go into its glossary.
<!-- overrides mattpocock-picks/skills/domain-modeling/SKILL.md: "Don't batch these up: capture them as they happen." -->
