---
name: writing
description: "How to write prose a person will read: write for a smart reader who wasn't there, and omit needless words. Williams and Bizup's Style: Lessons in Clarity and Grace in our own words, plus the rules that keep a technical document exact. Use when writing or revising specs, plans, reports, READMEs, PR descriptions, commit messages, or any answer longer than a few sentences."
---

# Writing

The rule: _write for a smart reader who wasn't there, and omit needless words._ The reader knows the field but not
the conversation, the code you just read or the options you turned down. Everything below serves that rule.

The method comes from Joseph Williams and Joseph Bizup's _Style: Lessons in Clarity and Grace_ (12th edition, 2016),
stated here in our own words and checked against free sources: George Gopen and Judith Swan's "The Science of
Scientific Writing" (1990), William Strunk's _The Elements of Style_ (1920) and Steven Pinker's "The Source of Bad
Writing" (2014). These are a reader's expectations, not laws. Change a sentence when the change helps the reader, and
leave it when it doesn't.

Write first, then revise: read each sentence and paragraph against the diagnoses below, and fix what they find.

## Understanding style (Lesson 1)

Readers judge prose by how it feels to read. When a sentence is hard to follow, they blame the writer, so the work of
being understood is the writer's.

## Clarity (Lessons 3 to 6)

**Characters as subjects (Lesson 4).** Each sentence tells a story about someone or something: a person, a program, a
component, the user. Make those characters the grammatical subjects. Read the first seven or eight words: if the
subject is an abstraction ("the implementation of", "there is", "it is … that"), find the character and start with
it.

**Actions as verbs (Lesson 3).** Put the actions in verbs, not in nouns made from verbs: "decide", not "make a
decision"; "remove", not "the removal of". Look for those nouns after weak verbs such as make, perform, have, provide
and occur.

- Before: "The removal doesn't depend on the bench." (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: "We remove SearXNG whatever the bench shows."

Keep a noun when it names a thing the text keeps returning to ("the installation folder"), or when it sums up the
previous sentence ("These failures…").

**Passive voice (Lesson 4).** Use the active voice when the reader needs to know who acts. Keep the passive when the
actor is unknown, obvious or unimportant, or when it keeps the paragraph's topic first.

- Before: "The browser is set as `executablePath`." The reader learns which browser and who sets it two sentences
  later. (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: "web-mcp sets the first browser it finds as `executablePath`."

**Old before new (Lesson 5).** Begin a sentence with something the reader already knows, from the sentence before or
the paragraph's topic, and end it with what is new. Keep a paragraph's subjects on its few main characters, so the
reader follows one thread instead of a new topic each sentence.

**Emphasis at the end (Lesson 6).** The end of a sentence is where readers look for the point. Don't let a sentence
trail off into a qualification, an afterthought or a weak phrase; move context to the front.

- Before: "nixpkgs' Helium dies 10 s after agent-browser starts it otherwise." (`docs/features/web-mcp-search/spec.md`,
  commit `8281c59`)
- After: "Without it, nixpkgs' Helium dies 10 s after agent-browser starts it."

## The whole document (Lessons 7 and 8)

**Motivation (Lesson 7).** Open with the problem: a condition and what it costs the reader. Then state what the
document decides or shows. A reader should know from the opening why to read on.

**Global coherence (Lesson 8).** State each document's, section's and paragraph's point early, in a short plain
sentence, and let the rest support it. Use the key terms of that point in what follows, so a reader can skim the
openings and get the argument. A paragraph without a point needs one or can go.

## Concision (Lesson 9)

Cut:

- words that mean little or nothing: "basically", "actually", "really", "kind of";
- redundant pairs: "each and every", "full and complete";
- words implied by others: "final outcome", "future plans";
- a phrase where a word will do: "in the event that" → "if", "due to the fact that" → "because";
- negatives that have an affirmative form: "not many" → "few", "not the same" → "different";
- comments about the writing itself: "in this section we will…", "it is important to note that".

Keep a hedge where a claim isn't always true; cut it where it only protects the writer.

Before cutting, apply the density test (from [technical-writing-density](https://github.com/mlwelles/technical-writing-density)):
does removing this lose a reason, a constraint or a disambiguation that matters to the topic and prevents a likely
misreading? If so, keep it, even if the sentence gets longer. Keep the details that matter, not every one you can
think of. Short is not the goal; nothing needless is.

## Shape (Lesson 10)

Reach the subject quickly and the verb right after it: no long opening clause, no long subject, no long interruption
between subject and verb. Break a sentence that sprawls clause after clause into two.

**Lists for lists.** Four or more parallel items go into a list, or into a table when they share attributes.

- Before: "Order: `WEB_MCP_CHROME`; else the newest Chrome for Testing from `agent-browser install` if it starts
  (…); else `helium`; else `chromium`." (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: a numbered list with one browser per item.

## The reader who wasn't there

You know things the reader doesn't, and it is hard to imagine not knowing them (Pinker calls this the curse of
knowledge). The worst case in this repo is conversation shorthand.

**No conversation shorthand.** A reader who wasn't there doesn't know what `Q11`, `round 2`, `D4`, "my call" or "the
spike" means. Write what the label stands for. Record who decided what in one place, such as a **Decisions** section,
not as a tag on every line, and quote the user only where the exact words matter. Logs of the conversation itself,
such as a flow's `flow.md`, are where those numbers belong.

- Before: "Order _(D-1, user: "there is helium", "let's continue")_" (`docs/features/web-mcp-search/spec.md`, commit
  `8281c59`)
- After: "The browser order:", with the user's choice of Helium recorded once under **Decisions**.

Spell out an abbreviation at first use unless every reader of this document knows it.

## Exact words

These keep a technical document from being read two ways.

- **The codebase is the word list.** Write the real file, function, flag and command names, not a synonym or a
  description of them.
- **One name per thing.** Once something has a name, use that name every time.
- **"This" and "it" point at one obvious thing.** When in doubt, repeat the noun.
- **"Only" and "not" sit next to the word they change.** "Fails only on growth" and "only fails on growth" say
  different things.
- **Code goes in code font.**
- **Headings state the point**, not just the topic.
- **A README or guide picks one mode:** a tutorial, a how-to, a reference or an explanation. Split and link instead
  of mixing them.

## Plain speech

- **Whole sentences.** Don't compress: keep the articles and verbs, and spell out arrows and symbols. "Parser rejects
  bad date → exit 2" becomes "The parser rejects a bad date and exits with code 2."
- **Say what a thing does, not how it feels.** Name the mechanism or the number: not "SQL you can read" but
  "`.toSQL()` returns the exact string sent to the database".
- **The plain word, not a metaphor noun.** "Base", not "substrate"; "way", not "vector"; "add", not "wedge in".
- **No chatbot phrases or flattery.** No "I hope this helps", no "Great question".

## The ethics of style (Lesson 12)

Write as you would want to be written to. Don't make a claim stronger or weaker than the evidence, and don't hide
what is uncertain or who decided.

## Left out

Lessons 2 (correctness) and 11 (elegance) aren't part of this standard. There are no limits on length, no banned
words and no rules against em dashes, semicolons or colons: a long document for a long feature is fine when every
sentence earns its place.
