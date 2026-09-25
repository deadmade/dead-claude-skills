# Implementing against the approved design

The design is the contract. Go fast inside it and stop at its edge.

## Slices

Before writing code, list the slices in notes: vertical, testable pieces that follow the design's data flow
("create payment intent", "webhook handler", "order write"). This orders the design; it doesn't add to it.

For each slice:

1. Write its tests from the design's **Tests** and **Failure paths** first (superpowers `test-driven-development` if
   installed), and watch them fail.
2. Write the code, run the tests.
3. Post the report and continue. Don't wait for a go.

Independent slices may run in parallel with superpowers `subagent-driven-development`. Give each subagent
`design.md`, its slice, and the deviation rule below word for word. The lock hook applies to subagents too.

## Slice report

```
Slice 2/4 – webhook handler
Design items: handleWebhook(event) → src/payments/webhook.ts:14, verifySignature → :41
Tests: 4 passed (duplicate event ignored, bad signature rejected, …)
Differences from the design: none
```

Append each report to notes under **Implementation**.

## Deviations

A deviation is anything the design doesn't say: a new or changed public method, parameter or type; another library;
another external call; a changed data flow or failure handling; a new file with its own responsibility. Private
helpers, imports and local names are not deviations.

On a deviation:

1. Stop all slices, subagents included.
2. Write it under **Deviations** in notes: what, why the design doesn't hold, the options you see.
3. Tell the user. They change `design.md` (or dictate the change for you to transcribe verbatim). That edit locks
   code again.
4. Grill on the change (design section of grilling.md).
5. Ask the user to type `approve design`, then continue.

Never change `design.md` on your own, and don't "just make it work" around the design.
