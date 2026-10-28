# SDD ledger — plan: docs/features/web-mcp/plan.md

Spec: docs/features/web-mcp/spec.md (binding). Branch feat/web-mcp.

## Progress

Task 4: dispatched (base 1a2b3c4, implementer sonnet)
Task 4: complete (commits 1a2b3c4..2b3c4d5, review clean)
Task 5: dispatched implementer 01a00154-c4da-7773-b242-95fab888a3a5 (opus), BASE 2b3c4d5
Task 5: DONE 3c4d5e6; review dispatched
Task 5: fix round 1/5 (2 addressed, 1 open — private address counts as public; commits 3c4d5e6..4d5e6f7)
Task 5: minor (deferred): the redirect limit is a literal
Task 5: security: SSRF check resolves the host once, then connects to the
resolved address, so a rebind cannot swap it
Task 5: fix round 2/5 (1 addressed, 0 open — loopback in IPv6 form; commits 4d5e6f7..5e6f708)
Task 5: Ruling: the cache key ignores the fragment — it never reaches the server
Task 5: complete (commits 3c4d5e6..5e6f708, 1 parked)
Task 6: dispatched (base 5e6f708, implementer haiku)
Task 6: review dispatched
Task 7: NEEDS_CONTEXT — which crate may be added

- Ruling: Task 8 waits for the user's answer on the browser pin.
