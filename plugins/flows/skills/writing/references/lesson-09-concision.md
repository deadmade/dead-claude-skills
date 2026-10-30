# Lesson 9: Concision

This lesson removes words that do no work once a sentence has the right characters, actions and order. A concise sentence uses just enough words to say what it means, so the reader sees its shape and claim at once. Run it after the structural passes, which often remove wordiness on their own.

## Terms

- **Doubled words**: two near-synonyms joined by _and_ or _or_.
- **Redundant modifier**: a modifier the word it modifies already implies.
- **Redundant category**: a general noun ("size", "nature", "manner") naming a class its neighbor already belongs to.
- **Implicit negative**: a word that means _not_ without saying it (_fail_, _without_, _unless_).
- **Metadiscourse**: words about the writing, the writer or the reader rather than the subject.
- **Hedge**: a word that lowers a claim's certainty. **Intensifier**: one that raises it.
- **Terse**: cut so far that reasons, links and conditions are gone.

## The six cuts, in order

Mark matches, delete or replace them, reread for sense.

1. **Words that mean little**: _kind of, actually, really, basically, generally, practically, virtually, particular, certain, various, individual, given_. Delete unless the claim changes.
2. **Doubled words**: _each and every, full and complete, any and all, true and accurate, first and foremost_. Keep one.
3. **Words the reader can infer**:
   - redundant modifiers: _future plans, final outcome, past history, completely eliminate_; drop the modifier;
   - redundant categories: _large in size, temporary in nature, in a timely manner, the area of security_; drop the category, turning an adjective into an adverb ("in a consistent manner" → "consistently") or a noun ("the authentication process" → "authentication") where needed;
   - spelled-out implications: "attempt to try to reproduce".
4. **A phrase where a word will do.** Common ones: _the reason for_ → _why_; _despite the fact that_ → _although_; _in the event that_ → _if_; _in a situation where_ → _when_; _concerning the matter of_ → _about_; _there is a need for_ → _must_; _is in a position to_ → _can_; _it is possible that_ → _may_; _prior to_ → _before_; _a decrease in the number of_ → _fewer_. Several also free a nominalization to become a verb.
5. **Negatives with an affirmative form**: _not many_ → _few_; _not the same_ → _different_; _not often_ → _rarely_; _not include_ → _omit_; _not stop_ → _continue_; _not allow_ → _prevent_. The affirmative is shorter and spares the reader reversing a negative.
6. **Adjectives and adverbs that add nothing.** Delete every adverb and every adjective before a noun, then restore only those the reader needs.

Before: "In the event that the user basically does not have a valid and current token, the installer performs a full and complete re-authentication in an automatic manner."
After: "If the token has expired, the installer re-authenticates automatically."

## Stacked negatives

Implicit negatives are verbs (_prevent, preclude, lack, fail, deny, refuse, reject, avoid, exclude, prohibit, doubt_), prepositions (_without, against, except, but for_) and conjunctions (_unless, except when_). Combined with _not_, passives and nominalizations, they defeat the reader. Revise in two passes:

1. Turn nominalizations into verbs with real subjects.
2. Turn each negative into its affirmative, stating the condition the reader must meet.

Before: "There should be no deployment without approval unless the change does not affect the schema."
After: "Get approval before you deploy a change that alters the schema."

**Keep the negative** when it is the point: a prohibition ("must not log tokens"), a denial of something the reader believes, a contrast you want stressed. Rewrite negatives built to obscure, such as a billing rule hiding what triggers a charge.

## Metadiscourse

Some is needed: signposts (_first, in short_), stance (_we chose_), pointers (_note that_). Too much buries the subject.

1. Mark every metadiscourse phrase in a passage; the rest is the content.
2. Cut the two kinds that rarely earn their place:
   - **attribution to an observer**: "It was observed that", "Testing determined that"; state the fact;
   - **topic announcement**: "This section discusses", "The first thing to say about X is"; make the topic the subject and go on.
3. Then make the remaining sentence more direct still (characters as subjects, actions as verbs).
4. Check the opposite fault: where a reader would get lost, add a signpost.

## Hedges and intensifiers

Hedges: _usually, often, almost, possibly, apparently, arguably, somewhat, most, many, some, may, might, could, seem, tend, appear, suggest, indicate_.
Intensifiers: _very, quite, clearly, obviously, certainly, undoubtedly, always, literally, key, central, crucial, major, essential, fundamental, show, prove, establish, it is clear that_.

1. Match the claim's strength to the evidence. Too many hedges sound evasive; none sounds arrogant.
2. _suggest_ and _indicate_ state a claim you are confident in but cannot prove.
3. The strongest intensifier is a missing hedge. Stripping every qualifier from a careful claim makes it aggressive, not concise.
4. Use intensifiers less often than hedges: a moderate claim gets considered, an absolute one resisted.
5. An opening _obviously, clearly, there is no question that_ makes readers doubt what follows. Cut it and give the evidence.

Before: "This clearly proves the cache always causes the timeouts."
After: "The traces indicate that most timeouts start with a cache miss."

## Concise, not terse

Cutting has a floor. Past it, prose loses its reasons, connectives and voice. Prune in layers (redundancy, then rewording, then deep compression), and after each layer ask what the reader lost. If a reason, condition or link went, restore it. No word count marks the floor; readers' reactions do. Without a reader, use SKILL.md's density test. You can't see your own habits, so a second reader marking metadiscourse and rough spots beats self-review.

## For technical documents

The six cuts, the metadiscourse cuts and hedge calibration matter most: specs and audit reports swell with "it should be noted that", observer attributions and claims stated harder or softer than the evidence. Affirmative conditions matter for every rule a reader must follow; keep _must not_ in requirements. The terseness warning matters as much as the cuts, because plans and PR descriptions lose their reasons first. Concision's cost to charm matters less, except in READMEs.
