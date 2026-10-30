# Lesson 5: Cohesion and Coherence

Use this lesson when each sentence is clear but the passage reads as choppy, or when a reader can't say what a paragraph is about. It gives two checks: does each sentence pick up where the last one ended (cohesion), and do the sentences' openings add up to a small set of related topics (coherence)?

## Terms

- **Cohesion**: the sense that one sentence leads into the next, judged where one sentence ends and the next begins.
- **Coherence**: the sense that a passage adds up to one thing, judged from how all its sentences begin.
- **Old and new information**: what the reader already has (from earlier sentences or general knowledge of the subject), and what they can't predict.
- **Topic**: what the reader takes a sentence to be about. Usually the subject, not always: in "It is unlikely that the cache survives a restart", the topic is the cache.
- **Topic string**: the sequence of topics across a passage.
- **Throat-clearing**: a connector, an attitude and a time or place piled before the subject.
- **Information level**: where old and new sit in a sentence, a layer beside story (characters, actions) and grammar (subjects, verbs).

## Principles

1. Two sentences cohere when the last words of the first set up the first words of the second.
2. Put old information first and new last; equally, simple before complex.
3. When old-before-new conflicts with characters as subjects and actions as verbs, old-before-new wins: a passage's flow outranks one sentence's clarity. Conflicts are rare, since a character, once named, is old.
4. The passive voice exists mainly to serve this rule. Choose it when the active form would open on something new.
5. Put words that point back (this, such, another, second) near the start of their sentence.
6. A passage is coherent when readers can see each sentence's topic and see that the topics form a small, related set.
7. Most subjects should name topics: short, familiar words, usually the main characters.
8. Don't change subjects for variety.

## Diagnose

1. **Seams.** Mark each sentence that opens on something nothing before it prepared.
2. **Old and new.** Mark each piece of new information; if the marks cluster at sentence openings, revise. Your own draft all feels familiar, so mark mechanically: a term is old only if the document used it earlier or every intended reader knows it.
3. **Topic string.** Underline the first seven or eight words of each sentence, stopping at the verb, and in long sentences the first five or six words of each clause. Read only those words. Do they form a small set of ideas a reader who wasn't there would see as related? Do they name the main characters, real or abstract (the words of an imagined title for the passage)?
4. **Throat-clearing.** Mark subjects that arrive late behind piled openers.
5. **Connectors.** Circle every therefore, thus, hence, however, indeed, also, moreover and another. Ask whether the link each one asserts is really there.

## Revise

- **A seam opens on something new**: move the old item to the front, with a passive, a reordering or a word that points back.
  - Before: "The installer checks each download against a pinned hash. A mismatch between the file's digest and the value in `agent-browser.json` stops the install."
  - After: "The installer checks each download against a pinned hash. That hash lives in `agent-browser.json`, and when the file's digest differs from it, the install stops."
- **A scattered topic string**: make the passage's few main characters the subjects of most sentences, near the start, each familiar when it appears.
  - Before: "Stale lockfiles cause most failed installs. Detection of them happens at startup. A warning is shown, and a manual step is required for removal."
  - After: "Most failed installs come from a stale lockfile. The installer looks for one at startup; when it finds one, it warns the user and asks them to delete it."
- **Throat-clearing**: keep at most one short element, such as a familiar time phrase, before the subject. Move a connector after the subject; cut idle stance words.
- **A faked connector**: delete it. Keep _but_ or _however_ to contradict or qualify, _therefore_ or _so_ to close a line of reasoning. More than a few per page is a warning sign; additive ones (also, moreover, another) are the most overused. An unjustifiable connector often marks unfinished reasoning: fix the thinking, not only the word.
- **Point of view**: the subject decides whose story the passage tells. "The scheduler drops the job" and "The job is dropped by the scheduler" frame one event from two sides; choose deliberately.

## When not to apply

- Repetition is not monotony: readers welcome one topic across several subjects. Don't swap in synonyms.
- Exception: when identical words for a topic fill the same slot sentence after sentence, vary a few ("it", "this"). Most drafts err the other way.
- Most subjects should be topics, not every one.
- A short introductory phrase before the subject is fine when it carries old information.
- A topic string alone isn't enough: a passage also needs themes (Lesson 6) and a point sentence (Lesson 8).

## Before drafting a section

List its characters and concepts and keep them in subject position; if one vanishes for several sentences, you may have drifted. Before reading a hard document, skim it for its main characters.

## For technical documents

Topic strings matter most in specs and audit reports, where one component or finding should stay the subject through a paragraph. Old-before-new matters most where new terms enter: introduce a file, option or error at the end of a sentence about something known. Connector discipline matters in reports, where an unjustified _therefore_ claims a causal link the evidence may not support. The passive for flow matters less and never outranks naming who acted; reference-word placement and the synonym exception matter least, but still apply.
