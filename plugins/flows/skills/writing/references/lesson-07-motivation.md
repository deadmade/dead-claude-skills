# Lesson 7: Motivation

Use this lesson on the opening and closing of a whole document. Readers know less than the writer and owe the document nothing, so the introduction must tell them what to expect and why to read carefully. A topic does neither; a problem the reader cares about, followed by its solution, does both.

## Terms

- **Shared context**: what the reader already knows or accepts (a fact, an event, a common belief), stated so the problem can qualify it.
- **Problem**: a condition plus its cost; neither alone is a problem.
- **Condition**: the situation that can cause trouble, or, for a conceptual problem, what we don't know.
- **Cost**: the consequence the reader won't accept; the answer to "so what?" after the condition.
- **Practical problem**: a condition in the world with a palpable cost; solved by an action.
- **Conceptual problem**: a gap in understanding whose cost is a larger thing we then can't know; solved by information.
- **Solution, main point or claim**: what the document asks the reader to do or think. It ends the introduction.
- **Prelude**: an optional hook (quotation, striking fact, anecdote) before the context.
- **Coda**: an optional closing fact or anecdote that echoes the prelude.

## Principles

1. Frame the document around a problem the reader cares about, not a topic. A topic invites "so what?", and the introduction is your one chance to answer it.
2. Most introductions run: shared context, problem, solution.
3. The standard opening states something the reader takes as settled, then turns it with _but_ or _however_. That small surprise keeps them reading.
4. State the cost. Readers may miss it or see another; name the one that touches this reader.
5. A practical problem's solution is something someone must do; a conceptual problem's is something the reader should understand.
6. For a conceptual problem, answer a question small enough to answer that matters because it helps answer a larger one, from which it borrows its importance.
7. A forceful claim alone doesn't persuade; a claim persuades when it answers a problem the reader shares.

## Diagnose and revise the introduction

1. **Classify.** Should the reader do something (practical) or think something (conceptual)?
2. **Draw a line where the introduction ends.** If you can't find that spot quickly, readers will miss the problem and the point.
3. **Split it into context, problem and solution.** If the split isn't obvious, the introduction will read as unfocused.
4. **Check the turn.** The first sentence after the context should open with _but_, _however_ or similar; without the signal, readers may miss the contrast.
5. **Split the problem into condition and cost.**
   - Is the condition the right kind? Practical: something with a palpable cost. Conceptual: something unknown, written as a statement ("We don't know why the cache misses on cold starts"), not a direct question.
   - Does the cost answer "so what?" Practical: a consequence someone suffers. Conceptual: a larger question we then can't answer.
6. **Underline the solution.** It belongs at the end of the introduction, in its stress position, naming the themes the rest develops (Lesson 8).

Practical example:

- Before: "This plan covers the installer's download step and how it handles binaries."
- After: "The installer downloads two binaries on every machine. But when GitHub rate-limits the request, the download fails silently, and the user starts Claude Code without web search. This plan retries with backoff and reports the failure in the summary."

Conceptual example (an audit): "The test suite passes on Linux and Windows. But we don't know how much of the installer it exercises, so we can't tell whether a green run means a release is safe. This audit measures coverage per module and finds the download and backup paths untested."

## Variations

The full plan is prelude, context, problem (condition, then cost), solution. Adjust it only for a clear reason:

- Readers know the subject well: skip the context and open on the problem.
- Readers know the problem well: state the cost before the condition.
- Every reader will see the cost: skip it.
- Rarely, hold the solution for the conclusion and end the introduction with a promise of it. Readers seldom tolerate this.
- A prelude introduces themes vividly. Popular writing uses them; technical writing rarely does.

## Conclusions

A conclusion gathers the point, why it matters and what follows. When nothing better suggests itself, reverse the introduction:

1. Restate the point.
2. Answer "so what?" again, in new terms if you can, or as the benefit of acting: not "without this fix, releases keep breaking" but "with this fix, a release that passes CI installs cleanly".
3. Say what remains open ("now what?").
4. Optionally, a coda.

## Finding the problem

When you can't find it, write: the topic in one sentence; why you chose it, in one sentence (if you can't say, readers won't care); the point in one sentence; then a short note to one specific reader on why they should care. The note usually contains the problem statement. Recasting a practical problem as a conceptual one, or the reverse, shows which you have. When reading, find the question the problem implies and the claim that answers it; if the introduction lacks them, check the conclusion, or ask what question the main claim answers.

## For technical documents

The three-part introduction, the stated cost and the solution at its end matter most: they are what specs, plans, audit reports and PR descriptions most often lack. Specs, plans and fixes pose practical problems; audits and investigations pose conceptual ones, whose cost is a decision the reader can't yet make. The variations apply often, since technical readers usually share the context and sometimes the cost. The conclusion pattern matters less, since many technical documents end without one; use it for reports and long specs. Preludes and codas matter least, but are fair when one striking number or incident states the problem best.
