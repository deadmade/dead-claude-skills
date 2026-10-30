# Lesson 4: Characters

This lesson puts characters into the subject slot, where readers look for them, and decides when a passive verb, an abstraction or a first-person subject is the right choice. Of the two sentence principles, this one matters more: readers forgive a weak verb sooner than a missing or buried character.

## Principles, in order

1. **Characters as subjects matter most.** Characters as subjects with a padded verb ("made a change to") still read fairly clearly; abstract subjects read much worse; no characters at all leave the reader guessing who acts.
2. **Look for characters where they hide**: in a possessive ("the scheduler's retry"), after _by_ or _of_ ("eviction by the kernel"), in an adjective ("upstream breakage" for "upstream breaks"; "architectural review" for "the architects review"), or only in the context.
3. **Choose the most specific character you can**, inventing one from context if needed.
4. **Abstractions can be characters** if they are the subject of a run of sentences with specific verbs. A familiar abstraction works; an unfamiliar one surrounded by other abstractions doesn't.
5. **The passive is a tool, not a fault.** Choose it by three questions (below).
6. **First person is fine for what the writer did.** Use _I_ or _we_ with verbs that name the writer's own acts.
7. **Write as plainly as the ideas allow.** A voice only insiders can read excludes the rest and costs trust.

## Procedure

1. Mark the first seven or eight words of each sentence. Is the simple subject a character? A character inside the whole subject ("the installer's check") doesn't count.
2. If not, find the characters: possessives, objects of _by_ and _of_, adjectives, context.
3. Ask who does what; list the actions, including those in nominalizations.
4. Rebuild each pair as subject and verb and join the clauses with _if_, _when_, _because_, _although_, _how_ or _why_.

- Before: "Package resolution failure in offline mode leads to termination of the installer run."
- After: "When the machine is offline and npm can't resolve a package, the installer stops."

## Absent and generic characters

- A sentence with no characters ("A decision was made to conduct a review") can mean several things. Find out who decided and who reviews.
- For a general statement, name the generic doer: a specific role first (_maintainers_, _the caller_), then _we_. _One_ is stiff and ambiguous; _you_ fits only when the document speaks to its reader.
- When a procedure is for the person who will follow it, write it to _you_, as if across a table. If _you_ doesn't fit, use a role noun.
- Don't escape a missing character into the passive; that hides it again. A non-human character often reads best: "the test suite should cover…".

## Abstractions as characters

1. Keep the abstraction as subject of several sentences in a row, with specific verbs ("The lock file pins… It records…"); a passive can help keep it there.
2. If readers don't know the abstraction, cut the abstractions around it, or retell the passage with people or programs as characters.

## Passive verbs

A grammatical passive puts the receiver in the subject and the actor in a _by_ phrase or nowhere. A sentence can also feel passive with an active verb ("Error handling requires state isolation"); fix that with the Lesson 3 procedure.

Choose the passive when one of these holds:

1. **The reader doesn't need the actor**: unknown, obvious or unimportant ("Tokens are rotated daily"). Never to hide who is responsible (Lesson 12).
2. **It puts short, familiar information first and long, new information last**: "This limit is set by the retry policy each client reads at startup."
3. **It keeps one character as subject across a passage.** Decide whose story the paragraph tells: actives tell it from the actor's side, passives from the receiver's.

Otherwise use the active.

## The impersonal passive and metadiscourse

- Using the passive to avoid _I_ and _we_ doesn't make work more objective; people still did it. Good technical writing uses _we_ freely.
- The split: passive for procedures anyone could repeat ("The logs were sampled hourly"); _I_ or _we_ with verbs about the writer's own thinking and writing (_we argue_, _I conclude_, _we define_). Those are **metadiscourse** verbs.
- Metadiscourse states intent or conclusions, marks the logic ("first", "consequently"), addresses the reader, maps or points to parts of the document, states a stance, and hedges or intensifies. Use a little; Lesson 9 cuts the excess.
- So: "It is concluded that…" becomes "We conclude…"; "I performed a comparison of the rates" becomes "The rates were compared", or better, a sentence with the rates as subject.

## Noun strings

1. A familiar compound is fine ("build cache", "access token").
2. Unpack strings you made up, especially with nominalizations: read from the last word back, turn nouns into verbs, add prepositions. Keep any established term inside the string whole.

- Before: "plugin manifest version drift detection"
- After: "detecting when a plugin's version differs from the manifest's"

## Terms

- **Character** (or **agent**): who or what acts; also a familiar abstraction made the subject of a run of verbs.
- **Passive voice**: _be_ plus past participle; the subject receives the action.
- **Metadiscourse**: language about the writer, the reader or the document.
- **Noun string**: several nouns in a row, each modifying the next.

## Audit your draft

For every nominalization and passive verb, state why it is there (refers back, familiar concept, actor unknown, old before new, consistent subject). If you can't, revise it.

## For technical documents

Missing characters are the main fault in specs and audit reports: "the config is validated" doesn't say which component validates it, so nobody can implement or check it. Name the component, command or role; in requirements the actor is often the point. Noun strings matter in headings and titles. Metadiscourse with _we_ matters in plans and reports ("we chose", "we found"). Professional voice matters less but still applies: a newcomer to the codebase should follow.
