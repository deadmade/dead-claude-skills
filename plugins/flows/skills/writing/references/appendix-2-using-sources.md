# Appendix II: Using Sources

A technical document leans on other text: upstream docs, an issue, a log, the user's own words. This appendix covers crediting that text honestly and choosing how much to bring in, in what form and under whose name. Use it whenever you cite, quote, summarize or paraphrase.

## Terms

- **Quote**: a source's exact words, marked as such.
- **Paraphrase**: one passage recast in your own words and sentence structure.
- **Summary**: a source's main points, condensed, in your words.
- **Attribution**: naming who said it, in the sentence or only in a citation.
- **Tag**: the short phrase that introduces a quote ("the RFC says").

## The rule

Never let an informed reader think borrowed words or ideas are yours, whatever the source: a web page, a chat, a user's message.

1. **Quoting**: mark the words (quotation marks, a block quote or code font for literal strings) and say where they came from.
2. **Paraphrasing**: change the sentence structure as well as the words, and cite. Swapping synonyms into the source's structure is copying.
3. **Using an idea or method**: cite it even when no words are borrowed.

## Keep your notes clean

- Record where something came from when you first read it: URL, file and line, commit or version, date.
- Copy quotes exactly, every character. Error messages and log lines go in code font, unaltered.
- Mark in your notes what is quoted, what is paraphrased and what you inferred, so you can't later mistake one for another.

## Three choices for every source

**How much.** As much as the point needs: too little and the claim floats free; too much reads as padding or nervousness. Give a source room in proportion to the attention you pay it, and more when you disagree, so the reader sees you represent it fairly.

**In what form.** Quote only when the exact words matter: a requirement's wording, an error message, a user's decision. Otherwise summarize or paraphrase.

- A summary gives the gist, not evidence. Every summary interprets; shade it carefully, most of all when arguing against the source.
- A paraphrase also shifts meaning slightly; make those shifts on purpose.
- Quoting options:
  - **Block quote** (about five lines or more): introduce it, and then discuss it.
  - **Drop-in** with a tag: the tag's verb shows your stance ("states" is neutral, "claims" signals doubt). Tie every quote to your point; a bare quote leaves the reader guessing why it's there.
  - **Woven in**: quote only the phrase you need. Mark added or changed words with square brackets, cuts with an ellipsis, and say when the emphasis is yours. Never change the meaning.
  - **A few words**: ordinary words need no marks. A coined term needs marks and a source the first time, then can be used plainly.

Quote fewer words and each one weighs more, but the reader has less context to check you against.

**Under whose name.** Naming the source in the sentence holds the claim at arm's length; citing it only in a link or parenthesis makes it sound like your own position. Name the source when you go on to disagree, or the reader sees you contradicting yourself.

- Before: "Retries are unnecessary here (see issue #41). But the timeouts show we need them."
- After: "Issue #41 argues that retries are unnecessary here. The timeouts in `search.log` show we need them."

## Punctuation around quotes

Commas and periods go inside the closing mark in American usage; colons and semicolons go outside; a question mark goes inside only when it belongs to the quote. Code font is not a quote: put punctuation outside it, so a literal string stays exact.

## For technical documents

What matters most: quote the user only where their exact words decide something, and keep their words distinct from your reading of them; reproduce error output and requirement text verbatim; link the exact version, commit or line you relied on; and name a source in the sentence when you depart from it. Academic citation styles matter less: a link, a path with a line number or an issue number is the convention. Close-paraphrase rules still apply to upstream prose.
