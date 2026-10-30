---
name: writing
description: "How to write and revise prose a person will read, by the method of Williams and Bizup's Style: Lessons in Clarity and Grace: a problem and a point up front, an order the reader needs, sentences about characters doing things, and nothing needless. Use when writing or revising specs, plans, reports, READMEs, PR descriptions, commit messages, or any answer longer than a few sentences, and for `copyedit <file.md>`: a fresh editor revises a document by this standard, and code checks that nothing it can see was lost."
argument-hint: '[copyedit <file.md>]'
---

# Writing

The rule: _write for a smart reader who wasn't there, and omit needless words._ The reader knows the field but not the
conversation, the code you just read or the options you turned down. You can't judge your own draft by how it reads to
you, because you fill every gap with what you already know. So judge it by checks you can run on the page.

The method is Joseph Williams and Joseph Bizup's _Style: Lessons in Clarity and Grace_ (12th edition, 2016), in our
own words. The book's principles describe what readers expect; they aren't laws. Change a sentence when the change
helps the reader.

**How to use it.** Draft first, without thinking about these checks; they get in the way of finishing. Then revise
from the top down: the document, then its sections and paragraphs, then sentences, then words. Spend the most time on
beginnings: the document's opening, each section's opening, each sentence's first words. A reader decides there
whether the rest makes sense, and a fix at the top changes more than a fix at the bottom.

**This file is the short form.** Each lesson of the book has a full reference in `references/`: every principle,
diagnostic, revision technique, exception and caution the lesson gives, with examples from software documents. Read
the reference for a pass when you revise a long document, when a check below doesn't settle a sentence, or when you
copyedit.

| Pass                       | References                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why and how to revise      | [Lesson 1, Understanding Style](references/lesson-01-understanding-style.md)                                                                                         |
| 1. The document            | [Lesson 7, Motivation](references/lesson-07-motivation.md), [Lesson 8, Global Coherence](references/lesson-08-global-coherence.md)                                   |
| 2. Sections and paragraphs | [Lesson 5, Cohesion and Coherence](references/lesson-05-cohesion-and-coherence.md), [Lesson 6, Emphasis](references/lesson-06-emphasis.md)                           |
| 3. Sentences               | [Lesson 3, Actions](references/lesson-03-actions.md), [Lesson 4, Characters](references/lesson-04-characters.md), [Lesson 10, Shape](references/lesson-10-shape.md) |
| 4. Words                   | [Lesson 9, Concision](references/lesson-09-concision.md)                                                                                                             |
| 5. Honesty                 | [Lesson 12, The Ethics of Style](references/lesson-12-ethics.md)                                                                                                     |
| Last, and small            | [Lesson 2, Correctness](references/lesson-02-correctness.md), [Appendix I, Punctuation](references/appendix-1-punctuation.md)                                        |
| Quoting and citing         | [Appendix II, Using Sources](references/appendix-2-using-sources.md)                                                                                                 |
| Rarely, in technical text  | [Lesson 11, Elegance](references/lesson-11-elegance.md)                                                                                                              |

## 1. The document: a problem, a point, and the order the reader needs

Most of what makes an agent's document hard to read is here, not in its sentences.

**Open with the problem (Lesson 7).** An introduction has three parts:

1. **Shared context**: what the reader already accepts ("Search runs through SearXNG in Docker.").
2. **The problem**, usually turned with _but_: a **condition** and its **cost**, the consequence the reader won't
   accept ("But when the container isn't running, every search fails, and the user has to start Docker by hand.").
   Ask "so what?" after the condition; the answer is the cost. Don't assume the cost is obvious: state it.
3. **The point**: what the document decides, shows or asks, as the last sentence of the introduction.

A spec, plan or fix has a practical problem (something costs us; the answer is an action). An audit or investigation
has a conceptual one (we don't know something, so we can't know or decide something bigger; the answer is
information). Skip the context when every reader has it; drop the cost when it really is obvious.

**State the point at the end of a short opening (Lesson 8).** The document and each section get a short opening whose
last sentence states its point and names the terms the rest develops. The body then uses those terms. In a technical
document the point is the verdict, not a promise of one: "The migration is safe to run; the one risk is lock time on
`orders`.", not "This section describes the checks we ran." (The book allows holding the point for the conclusion
behind a promise that names the themes; a reader who has to act rarely wants that.) For paragraphs this is guidance,
not a template: apply it to long ones.

**Run the outline test.** Read only the title, the headings and each section's point sentence. Together they should
make the argument. If they don't, the reader can't skim the document, and the structure needs work before any
sentence does. Headings should carry the section's key terms, not just a topic word.

**Turn the story of the work into the order the reader needs.** Writers fall back on the order they found things in:
what was tried, what failed, what was learned. The reader needs the result first, then its reasons and evidence. A
report that walks through each step before its verdict, or a spec that retells the conversation, is in discovery
order. Rebuild it around the point. Chronological order is still right when the reader follows steps, as in an
install procedure or a migration plan.

**Cut what doesn't serve the point.** Every paragraph should do one of these for the point: give background the reader
needs, state the point or a sub-point, give a reason, give evidence, explain a method, or answer another view. Text
that does none of these is the first thing to cut, however true it is.

## 2. Sections and paragraphs: a consistent topic, old before new

**Old before new (Lesson 5).** Begin each sentence with something the reader already knows, from the sentence before
or the paragraph's topic, and end it with what is new. When this conflicts with the sentence-level checks below, old
before new wins.

**Keep a topic string.** Underline the first seven or eight words of each sentence in a paragraph, up to the verb.
Read only the underlined words. They should name a small set of related characters or concepts, the paragraph's
topics, and they should be familiar by the time they appear. If each sentence opens on something new, rebuild the
paragraph around its few main characters.

- Before: "Retries are handled by the client. A 5xx triggers backoff. Configuration of the limit lives in
  `retry.ts`."
- After: "The client retries every 5xx. It backs off exponentially, and it reads its limit from `retry.ts`."

**Don't vary a name for variety.** Once something has a name, use that name every time; a synonym reads as a second
thing. The one exception: when the same words fill the same slot sentence after sentence, replace a few with _it_ or
_this_.

**Don't fake coherence.** _Therefore_, _however_, _moreover_ and _also_ promise a logical link. Use them only when the
link is real, and sparingly; deleting one that isn't shows whether the sentences connect on their own.

**Clear the throat less.** A sentence that piles a connector, an attitude ("importantly"), and a time or place before
its subject makes the reader wait. Cut what doesn't help, move a connector inside the sentence, and keep at most one
short, familiar time or place phrase in front.

**Put the new and the important at the end (Lesson 6).** The end of a sentence is where readers look for its weight.
Read the last few words of each sentence: if they don't deserve that weight, move context to the front and the new
information to the end. Unfamiliar terms and long, complex material belong there too, after a short subject and verb
that give the reader momentum. In a section's opening sentence, the words at the end name the themes the section
develops. "There is" and "there are" earn their place when they introduce a new topic at the end of the sentence
("There are three ways the cache can go stale."); rewrite them only when a verb-noun follows (section 3).

## 3. Sentences: characters as subjects, actions as verbs (Lessons 3, 4 and 10)

A clear sentence tells a story: its main characters are the subjects, and their important actions are the verbs.

**The seven-word check.** Skip a short opening phrase and read the first seven or eight words of each sentence.
Revise when the simple subject is an abstract noun, or when seven or eight words pass before the verb. Then:

1. Name the characters. A missing character often hides in a possessive ("the installer's check"), after _by_ or _of_
   ("validation by the server"), in an adjective ("upstream changes"), or only in context.
2. Find their actions. Actions hide in nouns made from verbs ("failure", "validation", "decision") and in adjectives
   ("is dependent on" → "depends on").
3. Rewrite: the character as subject, the action as verb, and the clauses joined by the word that states their logic:
   _because_, _if_, _when_, _although_, _unless_, or a _how_, _why_ or _whether_ clause.

- Before: "Failure of the hash verification results in termination of the download."
- After: "If the hash doesn't match, the installer stops the download."

Hidden actions take a few common shapes:

- a verb-noun as the subject of an empty verb: "The intention of this change is the elimination of retry storms" →
  "This change stops retry storms";
- a verb-noun after an empty verb (make, perform, conduct, provide, have): "performs a validation of" → "validates";
- two verb-nouns joined by "results in", "leads to", "is due to": rewrite as two clauses joined by _because_ or _if_;
- "there is" plus a verb-noun: "There is a need for validation of the config" → "The installer must validate the
  config";
- a chain of verb-nouns joined by _of_: make the first a verb.

**Keep the noun** when it refers back to the previous sentence ("This omission explains the stale results."), when
it replaces "the fact that", when it names the thing a verb produced ("the request"), or when it names a concept the
reader knows so well it acts as a character ("the migration", "a rollback").

**Passive voice.** Ask three questions. Does the reader need to know who acted? If the actor is unknown, obvious or
unimportant, the passive is fine. Does the passive put short, familiar information first and long, new information
last? Does it keep one character as the subject across the paragraph? A yes to either of the last two also justifies
it. Otherwise make it active. A spec full of "X is validated" without saying what validates it fails the first
question.

**Unpack noun strings.** "plugin dependency resolution failure handling" → "how the installer handles a plugin whose
dependencies don't resolve". Keep established technical terms whole.

**Shape (Lesson 10).** Get to the subject quickly and the verb right after it.

- A long opening: move it to the end or make it its own sentence. A short _if_, _when_ or _because_ clause that
  carries known information stays in front.
- A long subject: turn its verb-noun into a verb, or its _which_ clause into an _if_ or _when_ clause.
- Words between subject and verb, or verb and object: move them to the start or the end.
- A sentence that sprawls, clause hung on clause: put the point first in a short main clause, then choose a fix.
  Trim "which is" clauses to phrases, split the sentence, or coordinate its parts with the shorter ones first. A
  summarizing noun can pick up what came before ("…, a cleanup that can remove unmerged work").
- A bare _and_ between clauses often hides the real relation. Write _because_, _so_ or _but_ when that is what you
  mean: "The migration locks the table, so it can't run in business hours."
- A modifier that could attach to two things, or that dangles without its subject: move it, or make its subject the
  sentence's subject.

Long sentences aren't the problem; sprawl is. A long sentence with its subject and verb up front reads easily. Don't
chop everything into short sentences: that reads as choppy and drops the links between ideas.

**Justify or revise.** For every passive and every verb-noun left in a finished draft, you should be able to say why
it's there. If you can't, revise it.

## 4. Words: cut what does no work (Lesson 9)

The book's six cuts:

1. Words that mean little: "basically", "actually", "really", "various", "certain", "particular".
2. Doubled words: "each and every", "full and complete".
3. Words implied by others: redundant modifiers ("final outcome", "future plans"), redundant categories ("large in
   size", "temporary in nature", "in an accurate manner"), and spelled-out implications.
4. A phrase where a word will do: "in the event that" → "if", "due to the fact that" → "because", "prior to" →
   "before", "is in a position to" → "can".
5. Negatives that have an affirmative form: "not many" → "few", "not the same" → "different". Implicit negatives
   (_fail_, _prevent_, _lack_, _unless_, _except_) stacked with _not_ baffle readers; turn the verb-nouns into verbs
   first, then make the conditions affirmative. Keep a negative you mean to stress: "must not" in a requirement.
6. Adjectives and adverbs that add nothing: delete every adverb and every adjective before a noun, then put back
   only the ones the reader needs.

**Metadiscourse**, writing about the writing, is needed in small amounts ("first", "in short", "we decided").
Cut the two kinds that bury ideas: announcing a topic ("This section outlines…", "It is important to note that…")
and attributing a fact to an observer ("It has been observed that…"). Recaps that repeat a section are the same
habit at document size. Metadiscourse you keep goes in the active voice with _we_ or _I_: "we conclude", not "it is
concluded". A little of it can land a new term at the end of a sentence ("we call this the run folder").

**Hedges and intensifiers: neither too many nor too few.** Too many hedges sound evasive; none at all sounds
aggressive. Readers trust a claim stated as strongly as its evidence: "the heap dumps indicate the leak is in the
pool", not "this might possibly suggest". Use intensifiers even less than hedges: "key", "central", "crucial",
"essential", "fundamental" and "major" (the book's list), and "critical", "robust" and "comprehensive" (ours), mostly
weaken what they touch. A sentence that opens with "clearly" or "obviously" invites doubt.

**Concise, not terse.** Cutting can go too far. Prose stripped of its reasons, conditions and links reads like a
telegram, and the reader loses what made it worth reading. The book's only test is a reader's reaction. Without a
reader, apply the density test, after
[technical-writing-density](https://github.com/mlwelles/technical-writing-density): would a careful reader misread
the topic without these words, because they carry a reason, a limit or a distinction that matters to it? Then they
stay, and the sentence is longer for it. The aim is not short text; it is text with nothing needless in it.

## 5. Honesty: who did it (Lesson 12)

Write to the reader as you would want to be written to. The subjects you choose decide whether a sentence is honest.
"Errors occurred" and "some tests were not executed" hide who acted; "I skipped the four integration tests because
they need a database" doesn't. Name who acted, especially for errors, costs and skipped work, and make the person
affected a character. A passive is fine when the actor is unimportant, but not when the actor is you and the news is
bad. Softening bad news out of kindness is fine; hiding who caused it isn't. Prose should be as complex as its ideas,
and no harder.

## 6. Rules for technical documents (not from the book)

These keep a technical document from being read two ways, or from reading as notes.

- **No conversation shorthand.** A reader who wasn't there doesn't know what `Q11`, `round 2`, `D4`, `my call` or
  `the spike` means. Write what the label stands for. Record who decided what once, in a **Decisions** section, not
  as a tag on every line, and quote the user only where the exact words matter. A flow's `flow.md` is a log of the
  conversation; numbers belong there. After every Markdown write, flows' prose check flags `Q` and `D` numbers,
  `round` with a number and "my call" in the new text, unless the document defines the label (a quarter with a year,
  "Q1 2027", is a date).
- **Record a decision once.** Say what was decided and why, in its section; don't also log how the discussion went,
  unless the document is that log.
- **Use the code's own names**: files, functions, flags and commands as the code spells them, in code font.
- **"This" and "it" point at one obvious thing.** If two things could be meant, name the one you mean.
- **"Only" and "not" sit next to the word they change.**
- **Whole sentences in prose.** Keep articles and verbs; write out arrows and symbols. "Hash mismatch → abort"
  becomes "When the hash doesn't match, the installer stops." List items and table cells may be fragments.
- **Lists for lists.** Four or more parallel items go into a list, or a table when they share attributes.
- **Say what a thing does, with the mechanism or the number**: not "a snappy search" but "a search that answers in
  under 5 s". Use the plain word, not a metaphor noun ("base", not "substrate").
- **A README or guide picks one mode**: a tutorial, a how-to, a reference or an explanation.
- **No chatbot phrases or flattery**: no "I hope this helps", no "Great question".

## Copyedit a finished document

You can't see your own draft as a reader who wasn't there would. When asked to copyedit a file, or when a flow reaches a
gate with a spec, a plan or an audit report, follow [references/copyedit.md](references/copyedit.md): a fresh Opus agent
revises the document by this standard, and `scripts/compare.mjs` writes the edit over the document only when nothing
code can check was lost. It commits nothing.

## Length, correctness and punctuation

There are no length limits and no banned words: a long document for a long feature is fine when every paragraph serves
its point. Lesson 2 (correctness) and Appendix I (punctuation) are a short last pass, not a focus: Claude rarely breaks
the rules that matter, and Lesson 2 shows that most "rules" people cite are folklore. Em dashes, semicolons and colons
are fine where Appendix I says they are. Lesson 11 (elegance) seldom belongs in a spec or a report; its reference is
there for a README's opening or a release note.
