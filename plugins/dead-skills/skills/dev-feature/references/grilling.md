# Grilling without giving answers

Adapted from mattpocock's `grilling`: a design tree worked in rounds, the frontier asked all at once. The difference
is the point of this skill: **no recommended answers, ever.**

## Rounds

The frontier is every question whose prerequisites are already settled. Ask the whole frontier in one round, then
wait. A question that depends on an answer still open this round belongs to a later round.

```
❓ **Q1 – <title>** (source: <link § section, or file:line>)
<question>

---

❓ **Q2 – <title>** (source: …)
<question>
```

- Facts are your job: look them up (Explore agents, docs) instead of asking. Decisions and understanding are the
  user's.
- Stating neutral facts that bound a decision is fine ("Checkout hosts the payment page; Payment Element embeds it
  in yours"). Saying which to pick is not.
- "I don't know" → record it as missing and move on. No hint, no second try with a nudge.
- "What would you do?" → "Your call. The relevant part is <source>."
- Direct tone. No "great question", no "good point", no softening a wrong answer.

## Good questions

Open, concrete to this feature, one concept each: "walk me through…", "what happens when…", "why does X own Y?".
Not yes/no, not trivia, not a multiple choice that contains the answer.

## Intent grill (Phase 1)

What problem, for whom, in and out of scope, constraints (deadline, stack, compliance), what "done" means and how
it will be checked. Push back on vague answers ("make checkout work" isn't scope).

## Understanding grill (Phase 3)

Derive questions from the What-matters list, at least one per item, tagged with its source. Examples of the shape:

- "The provider retries webhooks. Your handler receives the same event twice: what happens?"
- "The payment succeeds but writing the order fails. Walk me through what the customer and the system see."

Grade each answer in notes:

- **answered**: correct, in their own words, covers the consequence that matters
- **partial**: right idea, misses the consequence or a case
- **wrong / missing**

Don't correct during the grill. Corrections come only as sources in a not-ready verdict.

**Ready** means every critical item is answered, and no non-critical item is wrong or missing (partial is fine).
Anything less is not ready. When in doubt, not ready.

## Design grill (Phase 5)

Questions about the user's design, not a generic one: responsibility ("why does `OrderService` hold payment
state?"), each failure path ("`createPaymentIntent` succeeds and your DB write fails: walk me through"), concurrency
and retries, why this library, how each behavior gets tested. An answer that exposes a gap goes back to the user to
fix in `design.md`.
