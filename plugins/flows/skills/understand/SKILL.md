---
name: understand
description: 'Learn a codebase, a subsystem or a concept by doing: map it (graphify, pstack how), learn why it is that way (pstack why), then a guided lesson through mattpocock teach where you write the key lines and Claude explains, and keep what you learned in CONTEXT.md. Use for /understand <topic, path or concept>.'
disable-model-invocation: true
argument-hint: 'What do you want to understand? (a path, a subsystem, a concept)'
---

# understand

Reading an explanation isn't understanding. This flow maps the ground, then makes the user do the parts that matter.

| Phase    | Runs                               | Output                           |
| -------- | ---------------------------------- | -------------------------------- |
| 1 Map    | graphify, pstack `how`             | a map: parts, flow, entry points |
| 2 Why    | pstack `why`                       | the decisions behind it          |
| 3 Lesson | mattpocock `teach`, learning style | the user did the key parts       |
| 4 Keep   | mattpocock `domain-modeling`       | terms in `CONTEXT.md`            |

[flow-rules.md](../../references/flow-rules.md) applies: read it first. No state file; one lesson per run.

## Phase 1: Map

Ask the user, once: what they already know, and what they want to be able to do afterwards (change it, review it,
explain it). Then:

- If `graphify-out/` exists, query it for the topic first; else offer `/graphify` for a large repo (it costs a build).
- pstack `how` on the topic (fallback: Explore agents): the parts, how a request or call flows through them, the
  entry points, with `file:line`.

Show the map as one short diagram or table, not a wall of text.

## Phase 2: Why

pstack `why` on the two or three choices in the map that look strangest. Cite the commit, PR, ADR or doc for each;
"unknown" is an answer.

## Phase 3: Lesson

Invoke mattpocock `teach` with the map, the why and the user's goal. Teach in learning style throughout:

- At each decision point the user writes the code or the answer (5–10 lines, or one sentence), in a scratch file or
  the chat, not the real tree, unless they want to change it for real.
- Claude takes the boilerplate, then reviews what the user wrote against the real code and says what differs and why.
- Short insight notes on the patterns the code uses, tied to `file:line`.

Stop when the user can do what they said they wanted, or says stop.

## Phase 4: Keep

Offer to run mattpocock `domain-modeling` on the terms that came up, so the next person (or session) has them in
`CONTEXT.md`. Only on the user's yes.
