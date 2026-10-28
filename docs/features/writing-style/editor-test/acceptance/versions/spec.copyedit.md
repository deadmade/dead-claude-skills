# web-mcp browser search: spec

Status: grilled (rounds 1–2, 2026-10-23), approved 2026-10-23 (Gate 1). ADR: [0004](../../adr/0004-browser-search.md). The user's choices are quoted or marked _(user)_; Claude decided everything marked _(my call)_,
and those decisions are open to change.

## Intent

The user likes web-mcp but not its search. Search depends on SearXNG, and running SearXNG in Docker on every machine is
annoying; when it isn't running, `search` fails outright. This machine was in that state on 2026-10-22: both test
searches answered "SearXNG is not reachable". The search's results could also be "drastically improved". Today SearXNG
scrapes Bing and Yahoo, which serve one index, and web-mcp then throws away the engines' rank and snippets and ranks
passages against the whole archive.

The user rejected every keyed or hosted option and Claude's own WebSearch: paid APIs "cost money", free ones "dont
allow scraping", and a scraper "is the same problem like searxng". What they want instead:

> I definetly want just a "claude browser" where clause querries. Complete isolation - and also I dont care if it
> opens a window briefly as long as I get good results and dont have to deal with all of this shit. Just want to be
> a "normal" user.

So `search` opens the search engines' own result pages in a browser that belongs to web-mcp, reads them like a person
would, and builds its answer from that. Slower is fine: "I rather be bit slower and lose all the headache with the
limitations etc" _(user, 3–5 s per search accepted)_.

## Goals

1. **No SearXNG, no keys, no Docker.**
   - `search` works on any machine where the installer set up agent-browser and its Chrome. The installer already
     does that today, for `browser` and the fetch fallback.
   - SearXNG goes away completely, with the installer's Docker step _(user: "searxng goes away completly!")_.
   - _(my call, from "completely")_ SearXNG's removal doesn't depend on the bench. If a threshold misses, we tune the
     browser search; SearXNG is not kept as a fallback.
2. **Browser search.**
   - Each web search opens the result pages of several engines in parallel in **web-mcp's own browser**.
   - It reads each result's URL, title and snippet off the rendered page.
   - Web engines: Google, Bing, DuckDuckGo, Brave, all in parallel on every search _(grill Q1, user: "these four
     should be alright")_.
   - No engine that only resells another engine's results _(user: "We dont need engines that just use another
     engine")_, so Startpage and Yahoo are out. DuckDuckGo stays: its links are "largely source[d] from Bing", but
     it has its own crawler _(grill Q11, user: "has its own crawler stay")_.
3. **Isolation** _(user)_.
   - The browser has a persistent profile of its own, kept by web-mcp. It is never the user's Chrome, profile,
     cookies or Google account, and is never attached to the user's Chrome (`--auto-connect`/`--cdp` are not used).
   - _(my call)_ The profile is persistent, so it keeps cookies and consent choices like a normal user's browser.
   - **One profile per engine**, per user and machine, not per project. _(plan review round 1, D1, the user: "then
     lets go with A")_
     - Chrome can't open one profile twice, the engines run in parallel, and one Chrome can't be headless for some
       engines and headed for others.
     - Each engine's Chrome stays open for about 2 minutes after its last search, then closes itself. Searches
       that arrive meanwhile wait their turn per engine instead of failing.
     - **On Windows**, each engine's Chrome closes right after its search instead, because there agent-browser
       shows browsers with extensions on the visible desktop, and a warm one would linger as a window. _(plan
       review round 2, the user: "A")_
   - _(plan review round 1, D4: yes)_ The search browser starts in its own folder, with every `AGENT_BROWSER_*`
     environment variable removed. Neither the user's agent-browser settings nor a project's `agent-browser.json`
     can attach it to the user's Chrome or change its profile.
   - _(my call, after the builder check)_ Only `search` uses this profile; the `browser` tool and the fetch fallback
     keep their throwaway sessions. If they shared it, any page Claude opens, prompt-injected ones included, could
     set cookies or change consent in the profile that every later search uses.
   - As its [README at v0.39.1](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.39.1/README.md)
     shows, agent-browser 0.39.1 has `--profile <path>` ("persistent custom profile directory"), `--headed`,
     `--user-agent` and `tab new`.
4. **A normal user, no chores.**
   - No CAPTCHA solving, no prompts, nothing the user has to click.
   - A window may open briefly _(user)_.
   - **Consent banners are handled by an extension**, not by web-mcp's own code _(user: "could we install extensions
     that do it automaticly?")_.
     - The extension is [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) (Aarhus University, MIT). Its
       README says it answers "more than 200 CMPs"; its `rules/` folder has `bing.json` and five Google rules
       (`google_consentdomain_1/2`, `google_cwiz`, `google_eomdialog`, `google_popup`), checked 2026-10-23.
     - It is loaded with agent-browser's `--extension <path>`, which works headless and headed (0.39.1 README).
     - **The search profile is declared in one config file** _(grill Q12, user: "is there no way to just say profile
       has x extensions?")_.
       - Chrome has no per-profile extension list short of admin policies (root or the registry).
       - agent-browser's config file takes every flag as a camelCase key
         ([README "Configuration"](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.39.1/README.md)),
         so it can name the profile directory, the extensions, the `executablePath`, the user agent and `headed`.
       - web-mcp keeps one such file beside the search profile and passes it with `--config` on **every** call to a
         search session. A call without it relaunches agent-browser's default browser, and the page is lost (spike,
         D-1). `--config` replaces `~/.agent-browser/config.json` and a project `agent-browser.json` (findings.md);
         search calls still run with the search folder as working directory. `args` holds no commas, because
         agent-browser splits it on commas and newlines.
       - On Linux, `executablePath` for Helium is a small `#!/bin/sh` wrapper that web-mcp writes beside the
         profile. The wrapper runs Helium without `exec`, because otherwise nixpkgs' Helium dies 10 s after
         agent-browser starts it (findings.md, upstream #1157).
     - web-mcp itself downloads the pinned Chromium release zip (v1.1.5 today) on the first search, checks its
       sha256 and unpacks it into the search profile's folder. The installer has no step for it _(grill Q12: yes)_.
     - The browser is set as `executablePath` and is never the user's installed branded Chrome, because since
       Chrome 137 branded Chrome ignores extensions loaded from a folder
       ([Chromium PSA](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ?hl=de))
       _(grill Q12: yes)_. The browser is chosen in this order _(D-1, user: "there is helium", "let's continue")_:
       `WEB_MCP_CHROME`; else the newest Chrome for Testing from `agent-browser install` if it starts (`--version`,
       checked once per process; it doesn't on NixOS); else `helium`, then `chromium` on PATH. If none is found,
       the search fails with a message naming `WEB_MCP_CHROME`.
     - Consent-O-Matic is not loaded for Bing, because with it, Bing's result page dies (spike, D-1).
     - A successful `open` proves nothing, since `open` reports success for a blank page too; an engine's outcome
       comes only from parsing its page.
     - _(my call)_ Consent-O-Matic's choices are "reject" for everything.
     - _(left to the builder, check first)_ How Consent-O-Matic's preferences are preset without the onboarding page
       it shows on install.
   - _(my call, after the builder check)_ "Normal browser" settings are allowed: a regular Chrome user agent
     (headless Chrome otherwise announces itself as `HeadlessChrome`), a real window size and `Accept-Language`.
     Anything beyond that is the anti-goal below.
   - Headless or headed is a **fixed setting per engine**, not a runtime retry _(grill Q2, user: "lets first try
     headless during implementation. The engines that fail get no headless the rest stays headless")_. Every engine
     starts headless. Any engine blocked headless during implementation switches to headed for good, and the plan
     records which.
5. **One engine failing never fails the search.**
   - Blocked means a CAPTCHA or "unusual traffic" page, or a consent wall that doesn't clear. Only a blocked engine
     earns the rest. _(plan review round 1, D3: yes)_
     - An engine's own "no results" page is an empty answer.
     - A network error, a timeout or an unrecognised page skips that engine for this search only, with no rest.
   - A blocked engine is skipped and rests for 30 minutes. The rest is shared by every web-mcp process on the
     machine _(grill Q3: yes)_. The answer's source line names the engines used and the ones skipped, each with its
     reason.
   - Only when every engine fails does `search` fail, and its error names each engine's reason.
6. **Better ranking** (prior art: [flow.md#prior-art](flow.md#prior-art)).
   - **Fusion:** URLs are normalised, then the engines' lists are fused with reciprocal rank fusion.
   - **Snippets as evidence:** each result's snippet is a passage of this search, like a fetched page's passages.
     FreshPrompt: more snippets meant better answers.
   - **Fetching:** the top pages by fused rank are fetched, as today. _(my call)_ The default count stays 5; the
     bench may raise it.
   - **Scope:** passages are ranked only among this search's snippets and pages. Archived passages from earlier
     searches are no longer ranked at all, though the archive is still written _(grill Q4: yes)_.
   - The persistent passage index (`.web/index/`) is no longer written, since nothing reads it. An existing index
     stays on disk untouched _(plan review round 1, D2: A)_. The final order combines BM25 with the fused engine
     rank. _(my call; the exact formula is left to the builder and tuned on the bench.)_
7. **Scholarly engines through the browser** _(user: "we dont need an api. We have the browser")_.
   - `papers: true` also opens Google Scholar and Semantic Scholar result pages.
   - _(my call, offered to the user)_ It keeps OpenAlex, arXiv and Crossref as APIs, for clean DOI, abstract and PDF
     data.
   - Everything is merged by DOI or arXiv id, as `papers::merge` does today, then by normalised title.
   - Scholar and Semantic Scholar follow the same block-and-rest rule as the web engines.
8. **Filters without SearXNG** _(my call)_.
   - `since` (day, week, month, year) maps to each engine's own date filter. An engine without one is skipped for
     that search and named.
   - `engines` picks which engines to open (`google`, `bing`, `duckduckgo`, `brave`, `scholar`, `semanticscholar`).
     An unknown name is refused with the known list.
   - _(my call, after the builder check)_ Engines belong to a mode: `scholar` and `semanticscholar` are valid only
     with `papers: true`, and web engines only without it. A mismatch is refused with the mode's list.
   - `since` applies to both sides: the engines' date filters, and OpenAlex's and arXiv's publication-date
     filters. As today, Crossref is asked only for DOI lookups, so `since` doesn't reach it _(plan review round 2,
     the user: "A")_.
   - `category` is removed. Site-scoped searches use `site:` in the query, which every engine understands; the tool
     description says so.
9. **Measured, not claimed** _(my call; the user's first web-mcp round was benchmark-driven)_.
   - A search-quality bench runs a fixed query set through the new search and, as the baseline, through the new
     search limited to `engines: bing`. The bench has no SearXNG run. The user: "we dont need that. As long as
     SearXNG is gone its alright. After all just using bing should be the same". _(my call: the bing-only run
     stands in for today's Bing+Yahoo.)_
   - The query set has about 30 queries, covering coding and docs, general web and fresh facts, and papers; each
     has a labelled answer or expected source.
   - It reports:
     - answer recall: the share of queries whose returned passages contain the labelled answer;
     - per-engine block rate;
     - p50 and p95 latency.
   - Thresholds are set at Gate 1 (proposed below).
10. **The installer and the docs follow.**
    - The installer denies the built-in WebSearch and WebFetch once **web-mcp's browser works**, not once SearXNG
      answers. The browser works when agent-browser is present and `agent-browser install` succeeded.
    - Every SearXNG mention is removed from the shipped code and docs: README, plugin and marketplace
      `description`s, `.mcp.json`, tool descriptions, GLOSSARY, CLAUDE.md. Earlier flows' docs stay as history.

## Hypothesis (thresholds fixed in the grill)

- **Q1 (quality):** answer recall of the new `search` ≥ 0.10 above its own bing-only run, and ≥ 0.70 absolute.
- **Q2 (speed):** p50 ≤ 5 s, p95 ≤ 10 s.
- **Q3 (reliability):** at least one web engine answers on ≥ 95% of queries. No engine's block rate is above 20%
  over a run of the whole set, with the profile already warm.

## Non-goals

- Any API key, paid API or hosted search API, for any source. The three existing paper APIs stay.
- Claude Code's built-in WebSearch as a backend.
- SearXNG in any form, local or remote.
- macOS or ARM.
- Automatic CAPTCHA solving or captcha services.

## Anti-goals (failure even if it technically works)

- The user has to click, solve or confirm anything during a search.
- web-mcp touches the user's own Chrome, profile or accounts.
- One blocked engine makes `search` fail or hang past its deadline.
- Stealth plugins, injected scripts that patch browser fingerprints (`navigator.webdriver` and the like), or rotating
  identities to hide the automation. The point is to be a normal browser, not a disguised
  bot. _(my call, from "just want to be a normal user")_

## Installer

- The installer stops setting up SearXNG and **leaves an existing `searxng` container and its `settings.yml`
  alone**. No step cleans them up _(grill Q5, user: "no - I havent really installed it on many")_.
- The installer denies the built-in WebSearch and WebFetch once agent-browser is present and `agent-browser install`
  succeeded. If the install fails, they stay allowed _(grill Q6: yes)_.

## Bench

- Claude writes the ~30 queries with their labelled answers. The user skims them once before the first run, and from
  then on they are fixed _(grill Q8: yes)_.
- Thresholds Q1–Q3 are fixed as proposed _(grill Q9: yes)_.

## Tool interface

The `search` tool keeps its name, `query`, `papers` and `max_passages`. `engines` and `since` work as in goal 8, and
`category` is removed. No new tools _(grill Q10: yes)_.

## Locale

Every engine searches in English, fixed (Google `hl=en`, and each engine's own equivalent) _(user: "english pls")_,
whatever the machine's locale or IP region. A query written in German still finds German pages.

## Constraints

- Rust crate `crates/web-mcp`; agent-browser pinned at 0.39.1 (`installer/assets/agent-browser.json`), driven as a
  child process (`browser.rs`, one `--json` call or batch per action); Windows and Linux x64.
- The engine parsers read what other tools write, so they test against **captured result pages** in fixtures
  (CLAUDE.md's rule), not assumed shapes.
- Everything pulled lands in `$CLAUDE_PROJECT_DIR/.web/` before Claude sees it. That includes each engine's result
  listing, just as today's search listing is archived. Page content stays marked untrusted.
- Installer: Node standard library only; new logic in `core/`/`system/` with a test next to it.
- Several web-mcp processes may run at once, one per Claude session, and agent-browser sessions are global per user
  (`browser.rs:236`).

## Left to the builder

- The per-engine result URLs and parsers, block detection, deadlines, the rest period and the headed retry.
- The fusion and the final scoring formula, tuned on the bench.
- How Consent-O-Matic's preferences are preset, and where `agent-browser install` puts Chrome for Testing on each OS.
