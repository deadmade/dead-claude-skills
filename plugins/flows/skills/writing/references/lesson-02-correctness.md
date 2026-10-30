# Lesson 2: Correctness

This lesson sorts grammar and usage rules into the few that matter and the many that don't, so that a correctness pass stays short and doesn't crowd out the work on clarity. Run it last, after the structural and sentence passes, and keep it small.

## Principles, in order

1. **Correct is not the same as clear.** A sentence can break no rule and still bury its characters and actions. Fixing _which_ versus _that_ never rescues a dense sentence; the later lessons do.
2. **Know which kind of rule you face.** Rules come in three kinds, and only one kind needs judgment:
   - **Real rules** make English English (articles before nouns). Fluent writers break them only by slip; fix every slip.
   - **Social rules** separate standard from nonstandard English ("doesn't have any", not "don't have no"). Follow them in any document others read.
   - **Invented rules** were made up by grammarians and are ignored by many good writers. Sort them further (below) before you enforce one.
3. **Don't judge people by usage.** A nonstandard form says nothing about a writer's intelligence. Follow standard usage because readers of serious documents expect it.
4. **Learn the real distinctions one at a time.** Usage doesn't follow from logic.

## Sorting invented rules

Apply this test to any rule someone cites: if competent writers break it routinely and careful readers don't notice, it has no force.

**Folklore: ignore it.**

- Starting a sentence with _and_, _but_ or _because_ is fine. Too many sentences starting with _and_ is a style problem, not a grammar one. Only a _because_ clause standing alone as a sentence is an error. A _because_ clause usually carries new information, so opening with one can read awkwardly; when the cause is already known, open with _since_ instead, which signals that.
- _Which_ may open a restrictive clause. Many writers still prefer _that_ there; either is correct. A nonrestrictive clause takes a comma and _which_.
- _Less_ with countable nouns is common in good writing, though _fewer_ is the safer choice.
- _Since_ may mean "because" and _while_ may mean "although".

**Elegant options: observe them only when you want a formal tone.** Readers rarely notice when you break these, but some notice when you keep them, and the prose sounds stiffer.

- Splitting an infinitive is fine ("to fully replace the cache").
- _Who_ for _whom_ in speech-like questions is fine. The actual rule: _who_ when the pronoun is a subject in its own clause, _whom_ when it is an object.
- A preposition may end a sentence. Moving it forward with _whom_ or _which_ raises the formality. But a preposition can make a weak ending (Lesson 6); when it does, rewrite.
- _None_ and _any_ may take a plural verb; the singular sounds more formal.

**Hobgoblins: harmless, but some readers attack them.** _Like_ as a conjunction, _hopefully_ as a sentence adverb, _finalize_ (it means settling the last details), and _impact_ as a verb are all acceptable. Two to keep anyway: avoid _very_ or _more_ before absolutes such as _unique_ and _complete_, and never write _irregardless_.

## Words careful readers check

Get these pairs right; some readers judge you by them.

- _Comprise_: the whole comprises its parts ("the release comprises three crates"). The parts _constitute_ or _compose_ the whole.
- _Continuous_ means unbroken; _continual_ means repeated with gaps. A job that polls every minute runs continually.
- _Anticipate_ means to prepare for; _expect_ means only to foresee.
- _Fortuitous_ means by chance, not lucky. _Disinterested_ means impartial, not bored. _Simplistic_ means too simple, never just simple.
- Also: _aggravate_ (make worse), _anxious_ (uneasy), _enormity_ (a great wrong), _fulsome_ (excessive), _notorious_ (known for bad things), _flaunt_ (show off) versus _flout_ (defy), _blackmail_ (extort by threat of exposure), _cohort_ (a group).
- Always distinguish _imply_/_infer_, _affect_/_effect_, _principal_/_principle_, _accept_/_except_, _precede_/_proceed_, _discrete_/_discreet_.
- Latin and Greek plurals: _criteria_, _phenomena_, _strata_ and _media_ are plural; the singulars are _criterion_, _phenomenon_, _stratum_, _medium_ and _datum_.

## Pronouns

1. **Agreement.** A pronoun matches its antecedent in number. Check every _it_, _they_ and _its_ against the noun it points to.
2. **Collective nouns.** Use the singular when the group acts as one ("the team has merged its branch") and the plural when members act separately.
3. **Generic persons.** For "the user", "a maintainer" or "each contributor", avoid a gendered pronoun. Options, in rough order of ease:
   - Make the noun plural: "Maintainers review their own changes".
   - Address the reader as _you_ when the document speaks to one.
   - Replace a possessive with an article, or drop it: "a user can reset a token".
   - Repeat the noun, or use a relative clause, or an infinitive whose subject is the main clause's subject.
   - _He or she_ is clumsy and leaves some people out; _we_ can be ambiguous; _one_ sounds stiff.
   - Avoid fixes that delete the character: passives, verb-nouns and dangling infinitives (Lessons 3 and 4).
   - Before: "If a user loses his token, he must ask an admin." After: "A user who loses a token asks an admin for a new one."

## Terms

- **Real rule**: a rule fluent speakers follow without thinking.
- **Social rule**: a rule that separates standard from nonstandard English.
- **Invented rule**: a rule grammarians made up; folklore, elegant option or hobgoblin.
- **Restrictive clause**: a clause that picks out which thing is meant; no comma.
- **Nonrestrictive clause**: a clause that adds facts about a thing already identified; set off by a comma, opens with _which_.
- **Antecedent**: the noun a pronoun refers to.

## For technical documents

Pronoun agreement and clear antecedents matter most: a wrong _it_ in a spec can point at the wrong component. The confused words matter next. Gender-neutral wording matters in any doc addressed to users or contributors. Folklore and elegant options matter least: never "fix" a correct sentence to obey one. In software writing, _data_ as a singular mass noun is now standard; treat the plural as the formal option.
