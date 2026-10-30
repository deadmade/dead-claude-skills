# Lesson 3: Actions

This lesson finds the actions a sentence hides in nouns and puts them back into verbs. It is the core sentence check: a sentence reads as clear when its important actions are verbs and the characters doing them are the subjects.

## Principles

1. **"Dense" names a feeling with a visible cause**: actions in nouns, characters out of the subject slot.
2. **Most sentences tell a story**: characters doing things. A spec, a plan and an audit are stories too ("the installer downloads", "the hook rejects", "we skipped").
3. **Make main characters the subjects.** (Lesson 4 develops this.)
4. **Make important actions the verbs.** Vague verbs (_occur_, _take place_, _be_, _have_, _result in_) mean the real action sits somewhere else.
5. **You can't see this in your own prose by rereading it.** Clarity is an impression the reader forms, and you know too much to form it fresh. Use the mechanical check below.

## Terms

- **Nominalization**: a noun made from a verb or adjective: _validate_ to _validation_, _fail_ to _failure_, _available_ to _availability_. Some keep the verb's form (_request_, _change_, _update_, _fix_); an _-ing_ noun ("the parsing of") counts too.
- **Simple subject**: the main noun of the subject. **Whole subject**: that noun with all its modifiers.
- **Character**: who or what does the action; a person, a program, a component, a team.
- **Empty verb**: a verb that carries little meaning and props up a nominalization: _be_, _have_, _make_, _perform_, _conduct_, _provide_, _give_, _occur_.
- Actions also hide in adjectives: _is dependent on_ (depends on), _is applicable_ (applies), _is indicative of_ (indicates).

## The procedure: analyze, assess, rewrite

1. **Analyze.** Skip any short opening phrase (four or five words) and mark the first seven or eight words of each sentence. Ask: is the simple subject an abstract noun? Do seven or eight words pass before the verb? A yes to either flags the sentence.
2. **Assess.** Name the main characters. Then find their actions, especially those sitting in nominalizations or adjectives.
3. **Rewrite.**
   - Turn each nominalized action into a verb.
   - Make its character the subject.
   - Join the resulting clauses with a word that states the logic: _because_, _if_, _when_, _although_, _unless_, _whether_, _how_, _why_, _that_.

- Before: "Rejection of the upload by the server occurs in the event of a mismatch between the checksum and the manifest."
- After: "The server rejects the upload if the checksum doesn't match the manifest."

## Five patterns to spot fast

1. **A nominalization as subject of an empty verb.** Make it the verb and find its character: "The expectation of the team is…" to "The team expects…".
2. **A nominalization after an empty verb.** Replace both with the verb: "ran an analysis of the logs" to "analyzed the logs".
3. **Two nominalizations linked by a causal phrase** (_was the result of_, _led to_, _is due to_, _caused_). Make both verbs, give each its character, and link the clauses by the logic:
   - plain cause: _because_, _since_, _when_;
   - conditional cause: _if_, _provided that_, _as long as_;
   - cause against expectation: _although_, _though_, _unless_.
4. **_There is_ or _there are_ plus a nominalization.** Find who acts and make them the subject: "There is a need for a review of the schema" to "We must review the schema."
5. **A chain of nominalizations joined by _of_ or other prepositions.** Turn the first into a verb; leave the rest, or turn the next into a _how_ or _why_ clause: "an analysis of the growth of the cache" to "analyzed how the cache grew".

When one sentence yields several character-action clauses, try these frames: X because Y; since X, Y; if X, then Y; although X, Y; X and, but or so Y.

## What the revision buys

- **Concreteness** (who did what) and **concision** (verbs need fewer articles and prepositions).
- **Logic**: _because_ and _although_ say what _of_ and _by_ only gesture at.
- **Order**: number the actions by when they happen; the revised clauses should roughly follow that order, which a stack of nouns scrambles.

## When to keep a nominalization

1. It is a short subject that refers back to the previous sentence: "This change breaks the cache key."
2. It replaces an awkward "the fact that": "The fact that the lockfile drifted" to "The lockfile's drift". Consider a clause too: "when the lockfile drifted".
3. It names what a verb produced or received: "the user's request", "the reviewer's comments". Even so, prefer the verb when the action matters: "she requested access after the freeze".
4. It names a concept so familiar that it acts as a character: "the migration", "authentication", "the release". Learn to tell these from nominalizations you can unpack: "there is a demand for a rollback" still becomes "the on-call engineer wants to roll back".

## Cautions

- Clear doesn't mean short. Don't cap sentence length; some ideas need a long sentence. Lessons 10 and 11 show how to keep a long one readable.
- Practice the reverse. Turning a clear sentence into a nominalized one shows you why the clear one worked; do this when you can't tell why a sentence feels heavy.
- Reader and writer rate clarity differently. When a reviewer calls a passage unclear, run the procedure on it before defending it; the reader is usually right.
- Mark whole subjects and verbs, then characters and actions wherever they sit. Where the two layers don't line up, revise.

## For technical documents

This is among the highest-value checks for specs, plans and audit reports, which drift into chains like "validation failure handling". Pattern 3 matters most in audit findings, where cause and effect are the finding itself; a vague _led to_ can hide which component caused what. Keep familiar domain nouns as characters (_the migration_, _the build_). The sequencing benefit matters most in plans and incident reports. The warning against short-sentence rules matters less in practice but still applies: don't chop a spec into fragments to look clear.
