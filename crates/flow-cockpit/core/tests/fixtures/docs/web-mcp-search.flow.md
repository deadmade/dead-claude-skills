---
flow: feature
phase: execute
---

# web-mcp search without SearXNG, better results: flow

## Request

> Hey, can we do this on a different workspace? I like our web mcp but im just not really sure about it. I dont like
> to utilize searxng on all my machines and I also feel like the results could be drasticly improved. Could you
> analyze this and present me an improvment plan?

Workspace: worktree `.claude/worktrees/web-search`, branch `worktree-web-search` (from `origin/main` 69d3e26).

## Artifacts

- Spec: [spec.md](spec.md) (approved 2026-10-23)
- Plan: [plan.md](plan.md) (10 tasks; written 2026-10-23, revised after plan review rounds 1–2)
- ADRs: [0004-browser-search](../../adr/0004-browser-search.md)
- CONTEXT.md: none; the repo keeps a `GLOSSARY.md`.
- Earlier flows: [../web-mcp/flow.md](../web-mcp/flow.md) (research flow, H1–H6),
  [../web-mcp/sources/flow.md](../web-mcp/sources/flow.md) (filters, `lookup`).

## Gates

- Gate 1, spec approved: 2026-10-23, by the user ("yes, I approve"), after grill rounds 1–2.
  Reopened 2026-10-23 for goal 3 (one profile → one per engine, plan review D1) and goal 5 (what counts as blocked,
  D3). Re-approved the same day with the decisions ("then lets go with A"; D2–D4 "yes").
  Reopened 2026-10-23 for goal 3 (Windows closes after each search) and goal 8 (`since` without Crossref), plan
  review round 2. Re-approved the same day ("A, A yes").
- Gate 2, plan approved: 2026-10-23, by the user ("go"), in answer to "Do you approve the plan, and which method
  should we use?". Execution: subagent-driven (my recommendation, taken with "go"). Commits: one per task on
  `worktree-web-search`, no push without asking.

## Skipped

## Grounding

- **SearXNG is the only web backend.** `trait WebSearch` (`crates/web-mcp/src/search.rs:136-142`) has one impl,
  `SearxNg` (`search.rs:146-385`); the URL is `WEB_MCP_SEARXNG_URL`, default `http://127.0.0.1:8888`
  (`config.rs:82-84`, `plugins/shared/web-mcp/.mcp.json`). Unreachable → the whole call fails with
  `SearchError::Unreachable` (`search.rs:46-49`). Checked live 2026-10-22: both test searches on this machine
  failed that way, with no fallback.
- **SearXNG engines are effectively one index.** `installer/assets/searxng.yml`: Bing and Yahoo on, DuckDuckGo,
  Brave and Google CSE off (they CAPTCHA or rate-limit a scraper). The earlier flow already noted "H3 rests on bing
  and yahoo, which serve one index" (`../web-mcp/flow.md:377`).
- **The installer ties things to SearXNG:** `installer/steps/searxng.ts` runs it in Docker (`searxngRun`,
  `installer/core/options.ts:32`), and the built-in WebSearch/WebFetch are denied only once SearXNG answers JSON
  (`webBuiltinsDecision`, `installer/core/settings.ts:101-111`).
- **How results are built** (`search::web`, `search.rs:405-504`): backend results → archive the listing → fetch
  the top `TOP = 5` (`PAGE_WAIT` 3 s each, `browser_fallback: false`) → BM25 over passages
  (`rank.rs:143-197`). Without a filter, BM25 runs over the **whole archive**, so old pages from earlier
  searches compete with this search's pages. Engine **snippets and rank are dropped** (`Raw` keeps url, title,
  engine). Passages are deduplicated only by hash.
- **What was measured before:** H3 was latency only (search p50 2,078 ms, 8 passages, ~16,000 chars). Result
  _quality_ of `search` was never measured. H4 (embeddings vs BM25 on BEIR) didn't hold, so BM25 only.
- **Keyless pieces already exist:** papers (OpenAlex, arXiv, Crossref; `papers.rs`) and `lookup`; `userConfig`
  (`binPath`, `agentBrowserPath`) gives keys a path into the server's env.

## Prior art

Background agent, 2026-10-22; every link was fetched in that run.

- **Merging:** SearXNG already does rank fusion (`Σ weight·n_engines/position`,
  [results.py](https://raw.githubusercontent.com/searxng/searxng/master/searx/results.py)), and web-mcp drops its output.
  [ddgs](https://raw.githubusercontent.com/deedy5/ddgs/main/ddgs/results.py) dedups by URL and sorts by engine count;
  [websurfx](https://raw.githubusercontent.com/neon-mmd/websurfx/rolling/src/models/aggregation.rs) (Rust) dedups and ranks by TF-IDF.
- **Keyless scrapers** (ddgs, websurfx) carry bot-evasion code that needs constant patching.
  [DDG terms](https://duckduckgo.com/terms) allow suspending access.
- **Keyed APIs:**
  - [Brave](https://brave.com/search/api/): $5 free credit a month (about 1k queries), then $5/1k. Its
    [ToS §3(b)(i)](https://api-dashboard.search.brave.com/terms-of-service) forbids a database of Search Results
    without a plan that includes storage rights.
  - [Tavily](https://docs.tavily.com/documentation/api-credits): 1,000 credits a month; its terms say nothing about
    storage.
  - [Mojeek](https://www.mojeek.com/services/search/web-search-api/): its own index, £2/1k; the Startup plan may
    cache results for only 1 h.
  - [Google PSE JSON](https://developers.google.com/custom-search/v1/overview): closed to new customers, ends
    2027-01-01.
- **Keyless hosted:** [Firecrawl search](https://docs.firecrawl.dev/features/search) (per-IP daily cap),
  [You.com](https://you.com/pricing) (keyless MCP, 100/day), [Marginalia](https://about.marginalia-search.com/article/api/)
  (`public` key, often busy, NC-SA).
- **Host delegation:** [Claude Code WebSearch](https://code.claude.com/docs/en/tools-reference) returns titles and
  URLs only, runs up to 8 backend searches per call, allows 200 calls per session, and isn't on Bedrock.
- **Quality evidence:**
  - [RRF](http://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf): about 4–5% MAP over the best single system.
  - [FreshPrompt](https://arxiv.org/html/2310.03214): engine snippets as evidence, with no page fetch, took FreshQA
    from 28.6 to 75.6. The number of snippets mattered most (1 → 61.4, 5 → 70.6, 15 → 77.6).
  - [BEIR](https://ar5iv.labs.arxiv.org/html/2104.08663): a MiniLM-L6 cross-encoder over BM25's top 100 raised
    SciFact from .665 to .688 and FiQA from .236 to .347, about +11% on average.
  - Backend comparisons are vendor-run and contradict each other: the
    [search_evals fork](https://github.com/liquid4all/search_evals) on SimpleQA, and
    [Tavily's own eval](https://github.com/tavily-ai/tavily-search-evals). Brave is the most consistent.
- **Approaches:**
  - A: keyless scraping in the binary.
  - B: keyed API with a keyless fallback.
  - C: hosted keyless APIs.
  - D: delegate discovery to the host's WebSearch.
  - Applies to all of them: keep rank and snippets, fuse with RRF, use snippets as passages, scope BM25 to this
    search, and optionally add a cross-encoder rerank.

## Options

**Where results come from** (brainstorm, 2026-10-22/23):

- Rejected by the user:
  - D: delegate to Claude's built-in WebSearch ("I dont want to go back on claude web search").
  - A: keyless scraping in the binary ("same problem like searxng").
  - B: keyed APIs such as Brave, and C: hosted keyless endpoints ("all of these metasearch engines apis etc are
    total shit. They either cost money or dont allow scraping").
- eTools.ch, checked at the user's request (2026-10-23):
  - no public API, and `robots.txt` disallows `/searchSubmit.do`; a test query got HTTP 403;
  - the paid version is Comcepta's EnterpriseMetasearch, B2B, price on request.
- E: fan out to free sources that allow it (Mwmbl, Stack Exchange, …), offered with F (one shared SearXNG); the user
  went another way before picking.
- **Picked: G, browser search.** The user: "I definetly want just a 'claude browser' where clause querries. Complete
  isolation - and also I dont care if it opens a window briefly as long as I get good results and dont have to deal
  with all of this shit. Just want to be a 'normal' user."
  - The search engines' result pages are opened in an agent-browser Chrome of web-mcp's own.
  - The browser is isolated from the user's Chrome and Google account.
  - A visible window is acceptable.
  - The links and snippets are read from the rendered page.
- **Scholarly engines:** Google Scholar and Semantic Scholar are queried through the same browser. The user: "we dont
  need an api. We have the browser".
  - Checked 2026-10-23: Scholar's `robots.txt` disallows `/scholar`; the Semantic Scholar API answered HTTP 429
    without a key.
  - _(my call, offered)_ OpenAlex, arXiv and Crossref stay as APIs (keyless, clean metadata).
- **Speed:** 3–5 s per search is acceptable. The user: "I rather be bit slower and lose all the headache with the
  limitations etc".
- **Builder check (2026-10-23), the user's answers:**
  - Consent banners: "could we install extensions that do it automaticly? letting claude do it sounds unreliable". So
    Consent-O-Matic (MIT, has Google and Bing rules) is loaded via `--extension`.
  - Locale: "english pls".
  - Baseline: "no, we dont need that. As long as SearXNG is gone its alright. After all just using bing should be
    the same". So there is no SearXNG run; the bing-only run of the new search is the baseline.
  - Settled as my calls, all in spec.md: search-only persistent profile, normal-browser settings allowed, engines per
    mode, removal regardless of the bench.
- **SearXNG is removed completely**, including the installer's Docker step. The user: "yes, searxng goes away
  completly!"

**Grill round 1 (2026-10-23)**, recommendations offered, the user's answers:
"1. these four should be alright. We dont need engines that just use another engine 2. lets first try headless during
implementation. The engines that fail get no headless the rest stays headless. yes, yes, no - I havent really
installed it on many, q6 yes, can't we just add the extension in the profile? yes, yes, yes".

- Q1: four engines.
- Q2: fixed headless/headed per engine.
- Q3: 30 min rest.
- Q4: no archive ranking.
- Q5: **no** SearXNG cleanup.
- Q6: gate on the browser.
- Q7: the user asked to put the extension in the profile; open in round 2.
- Q8–Q10: yes.
- [GLOSSARY.md](../../../GLOSSARY.md): Engine redefined; Snippet and Search profile added; "snippet" dropped from
  Passage's _Avoid_.

**Grill round 2 (2026-10-23).** The user: "has its own crawler stay, is there no way to just say profile has x
extensions? yes".

- Q11: DuckDuckGo **stays**: it has its own crawler.
- Q12: the search profile is declared in an agent-browser `--config` file (profile, extensions, Chrome for Testing,
  user agent, headed). web-mcp downloads the pinned Consent-O-Matic itself.
- Q13: ADR 0004 written.

## Plan review

**Round 1 (2026-10-23).**

- Reviewers: correctness, fit and simpler, in parallel; 42 findings merged into about 20, none dropped.
- I checked two claims myself:
  - `installer/core/binaries.ts:31` lists docker for web-mcp;
  - `resetSettings` rebuilds from `{}` (`installer/core/settings.ts:192`).
- Decisions:
  - **D1, profile shape:**
    - A: one profile per engine, kept warm with an idle timeout, offered against B: one profile with a tab per
      engine.
    - The user asked "Whats the problem with tab handling?" I explained:
      - one Chrome can't mix headless and headed;
      - concurrent sessions share the current tab, so the safe fix serialises every search on the machine;
      - one hang fails all engines.
    - The user: "then lets go with A". Spec goal 3 changed.
  - **D2:** stop writing `.web/index/`. **A**. Spec goal 6 changed.
  - **D3:** only a CAPTCHA or an unclearable consent page means blocked; no results is empty; network errors and
    unrecognised pages skip without a rest. **Yes**. Spec goal 5 changed.
  - **D4:** scrub `AGENT_BROWSER_*` and run in the engine's own folder; Task 1 proves a planted config is ignored.
    **Yes**. Spec goal 3 changed.
  - **Repairs:** all applied, the user: "yes".
    - task order compiles per task;
    - offline synthetic test pages; harness tempdirs;
    - per-engine rest files;
    - the extension downloaded under a lock with a deadline and re-fetched on a pin change;
    - wait for results or a block marker;
    - a slow engine never holds up the others;
    - papers degrade to the APIs;
    - reserved search session names;
    - the archive file name carries the engines;
    - installer: drop docker, check Chrome for Testing, configure after the settings rewrite;
    - use `zip` 9.0.5 from the lockfile;
    - drop the test-only consent URL and the tests of deleted code;
    - Brave English, UA from Chrome for Testing, Bing year, `engines` in papers mode picks only browser engines;
    - Scholar first slice is title, link, snippet and id.
- The plan was rewritten (a new Task 7 stops the index; the module layout changed), so it is re-reviewed in round 2.

**Round 2 (2026-10-23).**

- Reviewers: correctness and fit, on the rewritten plan; 33 findings, none dropped.
- Decisions:
  - Windows search browsers close after each search instead of staying warm, because agent-browser puts browsers
    with extensions on the visible desktop there. **A**.
  - `since` for papers reaches OpenAlex, arXiv and Scholar, not Crossref, which today serves DOI lookups only.
    **A**.
  - Repairs: all applied ("A, A yes").
    - the Consent-O-Matic download through a client of its own that follows redirects (`ctx.http` follows none,
      `fetch.rs:98-101`);
    - tests seed the extension and never download;
    - per-test fixture copies with the stub's port;
    - the wait covers results, no-results and block markers, and a failed wait is still parsed;
    - the daemon's wait is bounded;
    - a stuck session is closed before the lock is released;
    - `idleTimeout` is a string and `args` newline-separated;
    - versioned extension folders;
    - the rest is checked again under the lock;
    - paper engines' own result links are allowed;
    - title merge only without conflicting ids;
    - the full deletion and grep lists, plus the missing `mod` lines;
    - the third early return;
    - `chromeForTesting` split into core and system;
    - session names carry a hash of the data dir;
    - a reusable in-memory index for h4;
    - unrecognised and blocked pages archived;
    - `features = ["deflate"]`;
    - an absolute agent-browser path.
- The plan's shape is unchanged (same tasks and modules), so there is no round 3; I checked the edits myself.

## Deviations

**D-1 (Task 1, 2026-10-23): the spike can't run here, and Chrome for Testing doesn't start on NixOS.**

- **What happened:**
  - The Claude Code Bash sandbox's seccomp filter forbids AF_UNIX sockets. On Linux the agent-browser 0.39.1
    daemon only listens on a Unix socket (`Failed to bind socket: Operation not permitted`).
  - The downloaded Chrome for Testing 156 doesn't start on this NixOS machine
    (`libglib-2.0.so.0: cannot open shared object file`): nix-ld is active but lacks 26 of its libraries.
  - There is no other Chrome or Chromium on the machine. So the `browser` tool and the fetch fallback don't work
    here today either.
- **Why the plan doesn't hold:**
  - Task 1 can't measure anything inside the sandbox.
  - "Chrome for Testing from `agent-browser install`" can't be the only browser on NixOS, and a "file exists"
    check doesn't prove that it starts.
- **Done (Steps 1–3):**
  - agent-browser's sha256 matches the pin.
  - Chrome for Testing lands in `<home>/.agent-browser/browsers/chrome-<version>/`.
  - The Consent-O-Matic zip matches the pin; it opens its welcome tab once and loads its rules from
    raw.githubusercontent.com.
  - `wait --fn` exists.
- **Resolution (2026-10-23):** the user turned the sandbox off; the controller re-ran the spike in Helium 0.18.1.1
  (Chromium 154). User: "I know this error and is the usual for Google etc. let's continue with the implementation".
  - Found: every call needs `--config`; `args` splits on commas; `~/.agent-browser/config.json` merges in; `open`
    reports ✓ on a blank page; Consent-O-Matic kills Bing's result page.
  - On the user's Proton VPN exit only Brave and Scholar answered; Google, DuckDuckGo, Semantic Scholar and Bing
    blocked, headless and headed alike. The user accepts that as normal.
  - Spec amended (my rulings, R3–R7 in the ledger): browser order `WEB_MCP_CHROME` → Chrome for Testing if it
    starts → `helium` → `chromium`; `--config` on every call, scratch `HOME`; no commas in `args`; no
    Consent-O-Matic for Bing; outcome only from the parsed page.
  - Result pages that couldn't be captured on the VPN (Google, Bing, DuckDuckGo, Semantic Scholar) get parsers
    whose fixture tests are `#[ignore]`d until the user captures them off the VPN before the branch finishes (R8).

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
