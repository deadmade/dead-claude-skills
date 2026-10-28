# SDD ledger — plan: docs/features/web-mcp/plan.md

Spec: docs/features/web-mcp/spec.md (binding). Branch feat/web-mcp, start 071e74b. Execution approved at Gate 2
(2026-10-16), commits per task, no push.

## Progress
Task 3: minor (deferred): Item::Pdf never cached — Task 5 must cache PDFs too
  (spec Goal 3 "a URL already fetched isn't fetched again")
Task 4: implemented 6f62159 (bench: article 182 µs, 1 MB 65.6 ms; readability failure → empty Page; downscale no input cap — Task 5 caps)
Ruling: Task 5 caps image decoding (image::Limits, skip images over 10 MB before downscale) — Task 4 review flagged downscale allocates from declared dimensions — costs a few lines if wrong.
Ruling: Task 5 extends Archive::cached to PDFs — spec Goal 3 "a URL already fetched in this run isn't fetched again"; Task 3 only cached pages — costs a small archive change if wrong.
Task 5: dispatched (base 6f62159, implementer opus)
Task 5: security finding (background review, MEDIUM SSRF): image sub-requests (and search-result fetches) follow page-supplied URLs to private addresses (LAN, 169.254.169.254).
Ruling: `GetOpts` gains `allow_private: bool` — true for the direct `fetch` tool call (user's localhost sites, Q10) and for images of a page that is itself private; false for search-result fetches (Task 8) and images of public pages; enforced on the request URL, every redirect hop and the connected peer address — keeps the user's localhost use case while closing page-driven SSRF — costs a skipped image or result if a public page legitimately links a private host. Queued for Task 5's fix round.
Task 5: implemented 53570a5 (DONE_WITH_CONCERNS: get takes &Arc<Ctx>; GetOpts.images; Archived.url; Item cache flags; debug-only WEB_MCP_TEST_PUBLIC_IP hook; behind a private-address proxy everything counts as private)
Ruling: Task 5's internal signature changes (get(&Arc<Ctx>), GetOpts.images, Archived.url, Item fields) are private crate details, not deviations — later briefs use the new names — costs nothing.
Ruling: when a proxy is configured (HTTP(S)_PROXY/ALL_PROXY), the private check uses the URL host's resolved addresses instead of the peer address — otherwise the SSRF ruling would skip every search result behind a local proxy — costs a DNS lookup per fetch. Queued for Task 5's fix round.
Ruling: keep the cfg(debug_assertions) WEB_MCP_TEST_PUBLIC_IP hook and set the flake's web-mcp derivation to checkType = "debug" — release binaries never read it, and a test-only Ctx override would need a second code path for the binary-driven tests — costs debug-mode checks in nix (slower, not shipped).
Task 5: minor (deferred): images:true cache check misses PDFs and image-less pages (re-downloads); image downloads get per-image deadlines (up to ~2x30 s) instead of one shared deadline
Task 5: minor (deferred): Path::is_dir under the std inflight mutex and from_utf8_lossy on 20 MB on async threads (Goal 5 spirit)
Task 5: minor (deferred): Crossref single-record match misses `?mailto=` (falls back to 1 s, conservative); Crossref documents 1 concurrent public / 3 with mailto vs PER_HOST 4 — revisit in Task 9
Task 5: minor (deferred): concurrent single-flight test passes even if serialized (use a localhost URL); streaming 20 MB cap untested (fixture always sends Content-Length); test tempdirs not removed
Task 1: Step 5 done — user ran the baseline (deadPc-2026-10-16); recorded in flow.md Results. Task 1: minor (deferred): papers rows with non-2xx HTTP (S2 429) count as ok because curl exits 0
Ruling: keep Task 9's two-source identifier lookups although H6's latency part will likely fail on arXiv ids (~550 ms vs 85 ms baseline) — complete records with abstracts matter more to research-flow, H6 isn't in the verdict set; recorded in flow.md before measuring — costs an H6 'not supported' on latency.
Task 5: fix round 1 implemented e7d2211 (ctx.http no longer follows redirects — Task 8 SearXNG gets raw 3xx)
Controller commit 6f92d7e: baseline results + flow.md (docs only; next task base = 6f92d7e)
Task 5: fix round 1/5 (6 addressed, 1 new Important — DNS rebinding: separate check/connect lookups allow one blind GET to a private address; also flagged by the background commit review; commits 53570a5..e7d2211)
Ruling: close rebinding with a filtering resolver — a second client whose `dns::Resolve` drops private addresses, used whenever allow_private is false; behind a proxy the proxy resolves, so that case stays a documented shortcut — costs a second reqwest client.
Task 5: minor (deferred): render's no-image branch doesn't subtract the "Other images:" line (narrow overflow); sanitize_file may leave a trailing dot before the extension; Unflight guard created under the map lock; NO_PROXY ignored (shortcut comment); Windows reserved names
Task 5: security findings (background review of e7d2211, verified): single-flight keyed by URL only lets an allow_private=false caller join a private flight (authorization bypass); 200_000 - source - 2 underflows on a >200k source line. Added to fix round 2 (key by (Url, allow_private); saturating_sub).
Task 5: fix round 2/5 (4 addressed + 2 security added, 0 open; commits 6f92d7e..9f082de)
Task 5: minor (deferred): rebinding not closed behind a proxy (shortcut comment); IP-literal hosts skip the resolver (covered by URL + peer checks)
Task 5: complete (commits 6f62159..9f082de, review clean)
