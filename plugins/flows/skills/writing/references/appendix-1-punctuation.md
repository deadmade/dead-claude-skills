# Appendix I: Punctuation

Punctuation has a few firm rules and many choices, and each choice changes how a sentence groups and stresses its parts. This appendix covers sentence ends, beginnings and middles, series and apostrophes. Use it when a sentence is hard to parse, a mark is in doubt, or you want to shift emphasis without rewriting.

## Terms

- **Punctuated sentence**: everything from a capital letter to a period, question mark or exclamation mark.
- **Grammatical sentence**: one main clause with everything that depends on it. One punctuated sentence can hold several.
- **Coordinating conjunction**: _and, but, yet, for, so, or, nor_. _However_ and _therefore_ are not.
- **Comma splice**: two grammatical sentences joined by a comma alone.
- **Fragment**: a punctuated sentence with no main clause.
- **Interruption**: words between subject and verb or verb and object that could move elsewhere.
- **Loose commentary**: a modifier set off from what it stands next to; it usually can't move.
- **Restrictive modifier**: says which one ("the tests that need a database"), no commas. **Nonrestrictive**: comments on something already identified, with commas. An **appositive** is a nonrestrictive clause cut to a noun phrase.
- **Summative subject**: one word ("all", "each") gathering a long list before the verb.

## The principle

Grammar labels don't predict difficulty: a "simple" sentence of stacked nominalizations reads harder than a "complex" one of short clauses. Choose marks for the grouping and stress you want.

## Ends of grammatical sentences

Always mark where one grammatical sentence ends. Ten ways, in three tiers.

**Common**
1. **Period.** Too many short sentences read as choppy; merge some into clauses, short of sprawl.
2. **Semicolon.** When the first sentence is under about fifteen words and the second is closely tied to it. Occasionally.
3. **Comma + coordinating conjunction.** For long clauses with internal commas, use a period or semicolon. Three or more short clauses can take commas; with internal commas, semicolons. Don't chain clauses with _and_. When one opening modifier covers two short clauses, omit the comma between them.

A clause starting with _however_ needs a period or semicolon before it, never a bare comma.

- Before: "The cache is valid, however, the installer rebuilds it."
- After: "The cache is valid; however, the installer rebuilds it."

**Accepted, though some readers object**
4. **Period + _And_/_But_.** Correct; once or twice a page.
5. **Semicolon + conjunction.** For long clauses with their own commas; a period is often better.
6. **Conjunction, no comma.** Short, closely linked clauses.
7. **Comma alone.** Only short, tightly linked clauses (cause and effect, if and then) without internal commas. Many readers call it a splice; know your reader.

Use period + _But_ when what follows matters and the next sentences develop it; comma + _but_ when it only qualifies.

**Marked**
8. **Colon.** Reads as "that is", "for example" or "therefore", or balances two clauses. Capitalize after it by emphasis. Put it only after a complete clause: "The release needs three things:", not "The release needs:".
9. **Dash.** An informal afterthought.
10. **Parentheses.** A short aside sentence inside another; the period goes outside.

**Fragments** work only when short and deliberate, and rarely in formal prose.

## Beginnings

If a sentence opens with a pile of phrases and clauses, revise it instead of punctuating it.

Rules:
1. Comma after an opening element whenever the reader could misread where it ends.
2. Never a semicolon after an opening element.
3. No comma right after _although_, _because_ and the like when the subject follows.
4. No comma right after a coordinating conjunction when the subject follows; if an opening phrase follows, a comma is allowed but slows the reader.
5. Comma after an opening word that comments on the whole sentence or links it to the last (_fortunately, however_), but not on many sentences in a row. _Now, thus, hence_ usually take none.

Principles: after a short opening phrase the comma is optional and omitting it reads faster; after one of four or five words or more, use it.

## Middles

1. No comma between subject and verb, or verb and object. Shorten the subject instead.
2. A long list as subject: end it with a colon or dash and a summative subject. "The hooks, the mods and both binaries: all read `CLAUDE_PLUGIN_ROOT`."
3. Avoid interruptions except for emphasis. One longer than a few words takes paired commas, never semicolons.
4. A subordinate clause added at the end takes no comma when the meaning depends on it, a comma when it doesn't.
5. An adverbial phrase can open, interrupt or close a clause; each spot stresses something different. Mid-clause, use paired commas.
6. Loose commentary: restrictive, no commas; nonrestrictive and appositives, paired commas. Use dashes when it has its own commas, parentheses for an aside or gloss ("the lockfile (`package-lock.json`)"). At the end, a comma only if the meaning doesn't depend on it.

## Coordinated elements

- Two items: no comma, except before a short second item for emphasis or contrast ("fast, but not safe"), in place of _and_ for cumulative force, or between two long items to show where the first ends. If only punctuation makes it parse, rewrite.
- Three or more: use or omit the comma before the last item consistently. If items contain commas, separate them with semicolons.

## Apostrophes

Rules, not choices.
- Contractions take one.
- Plurals take none, except lower-case letters and capital _A_, _I_, _U_. Acronyms and numbers add _s_: `URLs`, `PRs`, `the 2020s`.
- Possessives: _'s_ for singulars ("the installer's check"); for singulars ending in _s_, pick _'s_ or a bare apostrophe consistently; _s'_ for plurals ("the plugins' manifests"); compounds on the last word.

## For technical documents

Rules that change meaning matter most: marked sentence ends (especially before _however_), restrictive versus nonrestrictive ("delete the branches that are merged" versus "delete the branches, which are merged"), semicolons in series with internal commas, a consistent serial comma, colons after full clauses, acronym plurals. Emphasis choices matter less but still help. Contractions suit a README; list items may be fragments.
