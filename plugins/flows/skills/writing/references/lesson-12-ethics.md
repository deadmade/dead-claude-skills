# Lesson 12: The Ethics of Style

Style choices also decide how fairly a document treats its reader. This lesson gives one rule for judging that, checks for prose that hides who acted or who pays, and answers to excuses for needless difficulty. Use it on passages that report an error, a cost, a risk or skipped work.

## Terms

- **First rule of ethical writing**: write to readers as you would want them to write to you.
- **Trade-places test**: would you accept what this reader faces after reading your text, if you were in their place?
- **Ethos**: the character readers infer from your prose, candid or evasive, careful or careless. Over many documents it becomes your reputation.
- **Agent**: whoever seems to cause an action. Usually the subject; it can also hide after _by_, in a possessive, or vanish.
- **Unintended obscurity**: prose that is hard by accident.
- **Intended misdirection**: prose shaped to serve the writer by hiding agency, cost or risk.

## Principles, in order

1. **Responsibility runs both ways.** Readers must work at ideas that are genuinely hard; a protocol state machine can't be made easy. Writers owe prose no simpler than the ideas and no harder.
2. **Readers judge character from style.** Once they decide you were careless or evasive, they stop extending good faith, in this document and the next.
3. **Judge by what the reader gets out of it**, not by what you meant to put in.
4. **Most obscurity is innocent.** Reviewing someone else's draft, read it charitably, then say plainly how it affected you and why.
5. **Your choice of subjects decides honesty as well as clarity.**
6. **"Good" means honest, not merely effective.** You write ethically when you would willingly be your own reader: imagine their situation and feelings, not only their knowledge.

## Diagnostic: find hidden agency

Run these on every passage that delivers bad news.

1. **List the subject of every clause**, main and subordinate.
2. **Find the responsible party.** Does whoever caused the error or made the decision ever appear as a subject? Look for verbs that make events happen by themselves (_occurred_, _arose_) and for passives with no _by_.
3. **Check for asymmetry.** Does the writer appear as _we_ or _I_ for good intentions and disappear for faults? That pattern is the clearest sign of misdirection.
4. **Find the affected reader.** Does the person who pays, loses data or must act ever appear as a subject, or only as a third-person category ("affected users")?
5. **Mark the alarming actions** as nominalizations (_failure_, _data loss_) or passives (_may be overwritten_). Hiding exactly the dangerous actions this way discloses without warning.
6. **Apply the trade-places test.** Would this text tell you what happened, who did it and what you must do?

## Revision technique

1. Rewrite with the reader as subject and each consequence as a verb under a condition: "If you upgrade on Windows, you lose the cached index."
2. Rewrite with the responsible party as subject: "I ordered the migrations wrong."
3. Keep the version that tells the reader what happened and what to do. If the team would resist sending it, find out why before you soften it.
4. Choose subjects deliberately: "your build fails" and "the build fails" make different claims about whose problem it is.

- Before: "Due to an ordering issue, some migrations may not have been applied."
- After: "I ordered the migrations wrong in `migrate.ts`, so the installer skipped three of them. Run `npm run migrate` again to apply them."

## Exceptions and cautions

- **Kindness is not deception.** Softening bad news for the reader's sake is fine, as long as the facts and the action they must take stay visible. Hiding facts to protect the writer is not.
- **Candor has costs**, and employers sometimes push the other way. The reader is harmed all the same.
- **Not every passive evades.** It is fine when the agent is unknown or doesn't matter; it evades when the agent matters and is the writer.

## Excuses for difficulty, and the answers

- **"The idea is new, so the prose must be hard."** Judge case by case, but the claim is usually wrong: a new idea can almost always be stated plainly, and another revision usually makes it plainer. Readers don't owe you unlimited decoding time.
- **"Hard reading makes readers think harder."** Nothing supports it.
- **"Clarity oversimplifies and serves the powerful."** Language carries power, but dishonest use misleads, not clarity itself.

## Style that argues for you

A consistent pattern of subjects can carry a claim the logic never states. Make the other party the agent of every bad action and they look culpable; make yourself the agent of every attempt and you look reasonable; make abstractions the agents ("the constraints require", "the situation demands") and you seem to have had no choice. Readers rarely notice these patterns. Ask whether your grammar supports an argument you state or makes one you never defend. "The architecture requires a second queue" hides that you chose the architecture; write "we chose X, so we need a second queue", and defend X.

## What the exercises teach

Rewriting one notice with _you_, then with _we_, as subjects shows how much agency the original hid. Comparing sentences that differ only in subject shows that picking a subject is a claim. Studying everyday texts (outage emails, terms of service) trains you to spot the pattern, then to spot it in your own drafts.

## For technical documents

This lesson matters most where a document reports harm: audit findings, incident notes, PR descriptions with breaking changes, test reports with skipped work, plans that impose costs. Run the hidden-agency diagnostic there, name yourself when you made the mistake or skipped the step, and make the user who must act the subject of the instruction. The excuses for difficulty and argument-by-grammar matter less day to day, but check recommendations for abstractions posing as agents.
