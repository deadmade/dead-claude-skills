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

## The reader decides what is clear (Lesson 1)

Readers judge prose by how it feels to read, and writers are poor judges of their own: they already know what they
meant. So the work of being understood falls on the writer, and the test of a sentence is the reader's experience of
it, not the writer's.

## Clarity: tell a story of characters doing things (Lessons 3 to 6)

**Actions as verbs (Lesson 3).** Put the actions in verbs, not in nouns made from verbs: "decide", not "make a
decision"; "remove", not "the removal of". Look for those nouns after weak verbs such as be, make, perform, have,
provide and occur.

- Before: "The removal doesn't depend on the bench." (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: "We remove SearXNG whatever the search-quality benchmark shows."

Keep a noun when it names a thing the text keeps returning to ("the installation folder"), or when it sums up the
previous sentence ("These failures…").

**Characters as subjects (Lesson 4).** Each sentence tells a story about someone or something: a person, a program, a
component, the user. Make those characters the grammatical subjects. Read the first seven or eight words. If the
subject is an abstraction ("the implementation of the check"), find the character and start with it. If it is empty
("there is", "it is … that"), start with the character and its verb instead.

**Passive voice (Lesson 4).** Use the active voice when the reader needs to know who acts. Keep the passive when the
actor is unknown, obvious or unimportant, or when it keeps the paragraph's topic first.

- Before: "The browser is set as `executablePath`, never the user's installed branded Chrome" (`docs/features/web-mcp-search/spec.md`,
  commit `8281c59`). The bullet never says who sets it.
- After: "web-mcp passes the browser it picked as `executablePath`, never the user's installed branded Chrome."

**Old before new (Lesson 5).** Begin a sentence with something the reader already knows, from the sentence before or
the paragraph's topic, and end it with what is new. Keep a paragraph's subjects on its few main characters, so the
reader follows one thread instead of a new topic each sentence.

**Emphasis at the end (Lesson 6).** The end of a sentence is where readers look for the point. Don't let a sentence
trail off into a qualification, an afterthought or a weak phrase; move context to the front.

- Before: "running Helium without `exec`: nixpkgs' Helium dies 10 s after agent-browser starts it otherwise"
  (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: "running Helium without `exec`. Started with `exec`, nixpkgs' Helium dies 10 s after agent-browser starts
  it."

## The whole document: the problem, then the point (Lessons 7 and 8)

**Motivation (Lesson 7).** Open with the problem: a condition and what it costs the reader. Then state what the
document decides or shows. A reader should know from the opening why to read on.

**Global coherence (Lesson 8).** State each section's and paragraph's point early, in a short plain sentence, and
let the rest support it; a document's point comes at the end of its introduction, right after the problem. Use the key terms of that point in what follows, so a reader can skim the
openings and get the argument. A paragraph without a point needs one or can go.

## Concision: cut what does no work (Lesson 9)

Cut:

- words that mean little or nothing: "basically", "actually", "really", "kind of";
- modifiers that don't change the meaning: "extremely important" is "important";
- redundant pairs: "each and every", "full and complete";
- words implied by others: "final outcome", "future plans";
- a phrase where a word will do: "in the event that" → "if", "due to the fact that" → "because";
- negatives that have an affirmative form: "not many" → "few", "not the same" → "different" (only when the
  meaning holds: "must not include" isn't "must omit");
- comments about the writing itself: "in this section we will…", "it is important to note that".

Keep a hedge where a claim isn't always true; cut it where it only protects the writer.

Before cutting, apply the density test, after [technical-writing-density](https://github.com/mlwelles/technical-writing-density):
would a careful reader misread the topic without these words, because they carry a reason, a limit or a distinction
that matters to it? Then they stay, and the sentence is longer for it. Keep the few that matter, not every caveat
you can list. The aim is not short text; it is text with nothing needless in it.

## Shape: reach the subject and verb fast (Lesson 10)

Reach the subject quickly and the verb right after it: no long opening clause, no long subject, no long interruption
between subject and verb, or between the verb and its object. Break a sentence that sprawls clause after clause into two.

**Lists for lists.** Four or more parallel items go into a list, or into a table when they share attributes.

- Before: "Order _(…)_: `WEB_MCP_CHROME`; else the newest Chrome for Testing from `agent-browser install` if it starts
  (…); else `helium`, then `chromium` on PATH." (`docs/features/web-mcp-search/spec.md`, commit `8281c59`)
- After: a numbered list with one browser per item.

## Write for the reader who wasn't there

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

## Exact words: one reading per sentence

These keep a technical document from being read two ways.

- **Use the code's own names.** Call files, functions, flags and commands what the code calls them; a synonym
  sends the reader looking for something that doesn't exist.
- **One name per thing.** Once something has a name, use that name every time.
- **"This" and "it" point at one obvious thing.** If two things could be meant, name the one you mean.
- **"Only" and "not" sit next to the word they change.** "The check runs only on Markdown" and "only the check
  runs on Markdown" say different things.
- **Code goes in code font.**
- **Headings state the point**, not just the topic.
- **A README or guide picks one mode:** a tutorial, a how-to, a reference or an explanation. Split and link instead
  of mixing them.

## Plain speech: say what happens

- **Whole sentences.** Don't compress prose into notes: keep the articles and verbs, and write out arrows and
  symbols. "Hash mismatch → abort" becomes "When the hash doesn't match, the installer stops." List items and table
  cells may be fragments.
- **Say what a thing does, not how it feels.** Name the mechanism or the number: not "a snappy search" but "a search
  that answers in under 5 s".
- **The plain word, not a metaphor noun.** "Base", not "substrate"; "add", not "wedge in"; "way", not "vector".
- **No chatbot phrases or flattery.** No "I hope this helps", no "Great question".

## The Ethics of Style (Lesson 12)

Write as you would want to be written to. Don't make a claim stronger or weaker than the evidence, and don't hide
what is uncertain or who decided.

## What this standard leaves out

Lessons 2 (correctness) and 11 (elegance) aren't part of this standard. There are no limits on length, no banned
words and no rules against em dashes, semicolons or colons: a long document for a long feature is fine when every
sentence earns its place.
