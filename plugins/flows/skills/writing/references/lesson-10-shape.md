# Lesson 10: Shape

This lesson keeps long sentences clear. Length alone doesn't make a sentence hard; shapelessness does. Use it to order a sentence that needs many words so the reader gets the point early.

## Terms

- **Point**: the claim the sentence exists to make.
- **Interruption**: words between subject and verb, or between verb and object.
- **Sprawl**: clause tacked onto clause after the main verb, usually with _which, that, who_.
- **Resumptive modifier**: after a comma, repeat a key noun, adjective or verb and continue.
- **Summative modifier**: after a comma, a noun summing up the clause so far, then a _that_ clause.
- **Free modifier**: a phrase, often opening with an _-ing_ or _-ed_ form or an adjective, about the nearest verb's subject; it can open or close the sentence.
- **Correlatives**: _both…and, not only…but also, either…or_.
- **Periodic sentence**: one that stacks openers to delay its main clause.
- **Dangling modifier**: an opening phrase whose implied subject isn't the main clause's subject.

## Diagnose

Check for the four causes of shapeless length, in order:

1. The point is not near the start.
2. The reader waits too long for the main verb.
3. After the verb, phrases and clauses trail on.
4. Interruptions keep breaking the flow.

Underline the first seven or eight words of each sentence: the main subject and verb belong there. Underline each whole subject. Read aloud: where a reader would stumble or run out of breath, the shape is wrong.

## Principle: short and direct before long and complex

A short frame makes the complexity after it manageable: open with the point in a short main clause, then explain. The rule scales to paragraphs, sections and whole documents, each opening with its point.

Before: "Retries with jitter and a per-host cap on concurrent connections stop the upstream from being overloaded."
After: "The upstream stays within its load when the client retries with jitter and caps connections per host."

## Revise the opening

**Get to the subject quickly.**

1. Move a long introductory clause to the end; if it doesn't fit, make it its own sentence.
2. A short _if, since, when, although_ clause carrying known information may stay in front.
3. A periodic sentence stacks parallel openers on purpose to build to a strong main clause; use it rarely.

**Get to the verb and object quickly.**

1. A subject over seven or eight words built on a nominalization: make it a verb with a character as subject.
2. A subject swollen by a relative clause ("A service that…"): make it a front _if_ or _when_ clause. If that opener is long, move it to the end (best when the main clause is short and carries the point), or split it off.
3. An interruption between subject and verb, or verb and object: move it to the start if it links to the previous sentence, to the end if it leads into the next. A one-word interruption is fine.
4. A phrase shorter than a long object may sit between verb and object, so the long object comes last.

## Revise sprawling endings

1. **Cut**: shrink relative clauses to phrases by deleting _which is, that are, who was_; sometimes the verb becomes an _-ing_ form ("tests that cover" → "tests covering").
2. **Split**: make a trailing clause its own sentence.
3. **Modify** instead of adding another _which_:
   - resumptive: "The installer writes a lockfile, a lockfile that later runs read to skip finished steps."
   - summative: "The job deletes branches older than 30 days, a cleanup that can remove unmerged work."
   - free: "The scheduler retries failed jobs twice, keeping transient errors out of the alert channel."
4. **Coordinate**: join parallel parts; harder, but the most graceful.

## Coordinate well

1. **Short to long.** Put the shorter, simpler member first; ending on the shortest sounds abrupt. The same principle unifies the style: short subject before long predicate, old (felt as shorter) before new, short point before long support.
2. **Correlatives** add emphasis. Put each half before the same part of speech: if _not only_ precedes a verb, so does _but also_.
3. **Grammatical parallelism.** Coordinate clause with clause, phrase with phrase. Some mismatches read fine: a noun phrase with a _how_ clause, an adverb with a prepositional phrase.
4. **Parallel in thought.** A bare _and_ between claims often hides their relation; write _because, so, but, although_. No test finds this; watch for it.

Before: "The cache is stale after deploys, and it serves old configs and won't be fixed by a longer TTL."
After: "The cache is stale after deploys because it serves old configs, but a longer TTL won't fix it."

## Troubleshoot

- **Lost connections**: the reader loses where a long coordination's second half attaches. Shorten the first half, repeat the word that began the coordination, or repeat a noun instead of an unclear pronoun.
- **Ambiguous modifier**: "The job that fails silently retries." Move the modifier next to what it modifies, or to the front.
- **Dangling modifier**: "To pass review, tests must cover the new path." Name the actor in the opener, or better, make it the main subject: "To pass review, the PR must include tests for the new path."

## What the exercises teach

Fix wordiness and nominalizations first; many shape problems vanish. Try each modifier type on one sentence to see which fits. Ask a second reader to mark rough passages, and trust that something is wrong even when they can't name it; then diagnose with the checklist.

## For technical documents

Most important: point first in a short main clause, short subjects, no interruptions, no sprawl. Requirements and findings are read in fragments, so each sentence must deliver its claim early. Fixing bare _and_ and ambiguous or dangling modifiers prevents misreadings that become bugs. Matter less: periodic sentences, correlatives and short-to-long rhythm; use them in READMEs, rarely in requirements. Appendix I covers punctuating long sentences.
