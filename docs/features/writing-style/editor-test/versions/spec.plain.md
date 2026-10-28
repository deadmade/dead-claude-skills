# web-mcp browser search: spec

Status: grilled with the user in question rounds 1–2 on 2026-10-23, and approved on 2026-10-23 (Gate 1). ADR:
[0004](../../adr/0004-browser-search.md).

How decisions are marked:

- Choices the user made are quoted or marked _(user)_. "Grill Qn" refers to question n of the grilling rounds; "plan
  review round n" and "Dn" refer to the plan reviews and their decisions.
- Everything marked _(my call)_ was decided by Claude and is open to change.

## Intent

The user likes web-mcp but not its search, for two reasons.

- **It depends on SearXNG.** Running SearXNG in Docker on every machine is annoying, and when SearXNG isn't running,
  `search` fails outright. That was the state of this machine on 2026-10-22: both test searches answered "SearXNG is
  not reachable".
- **Its results are weak.** They could be "drastically improved". Today SearXNG scrapes Bing and Yahoo, which serve
  one index. web-mcp then throws away the engines' rank and snippets, and ranks passages against the whole archive.

The user rejected every keyed or hosted option, and Claude's own WebSearch too: paid APIs "cost money", free ones
"dont allow scraping", and a scraper "is the same problem like searxng". What they want instead:

> I definetly want just a "claude browser" where clause querries. Complete isolation - and also I dont care if it
> opens a window briefly as long as I get good results and dont have to deal with all of this shit. Just want to be
> a "normal" user.

So `search` opens the search engines' own result pages in a browser that belongs to web-mcp, reads them the way a
person would, and builds its answer from them. Being slower is fine: "I rather be bit slower and lose all the headache
with the limitations etc" _(user, 3–5 s per search accepted)_.

## Goals

1. **No SearXNG, no keys, no Docker.**
   - `search` works on any machine where the installer has set up agent-browser and its Chrome. The installer already
     does that today, for the `browser` tool and the fetch fallback.
   - SearXNG goes away completely, along with the installer's Docker step _(user: "searxng goes away completly!")_.
   - _(my call, from "completely")_ The removal doesn't depend on the bench. If a threshold is missed, we tune the
     browser search; SearXNG is not kept as a fallback.
2. **Browser search.**
   - Each web search opens the result pages of several engines in parallel in **web-mcp's own browser**.
   - It reads each result's URL, title and snippet off the rendered page.
   - The web engines are Google, Bing, DuckDuckGo and Brave, all queried in parallel on every search _(grill Q1, user:
     "these four should be alright")_.
   - No engine that only resells another engine's results is used _(user: "We dont need engines that just use another
     engine")_, so Startpage and Yahoo are out. DuckDuckGo stays: its links are "largely source[d] from Bing", but it
     has its own crawler _(grill Q11, user: "has its own crawler stay")_.
3. **Isolation** _(user)_.
   - The browser has a persistent profile of its own, kept by web-mcp. It is never the user's Chrome, profile, cookies
     or Google account, and it is never attached to them (`--auto-connect`/`--cdp` are not used).
   - _(my call)_ The profile is persistent so that it keeps cookies and consent choices, like a normal user's browser.
   - **There is one profile per engine**, per user and machine, not per project _(plan review round 1, D1, the user:
     "then lets go with A")_.
     - The reasons: Chrome can't open one profile twice, the engines run in parallel, and one Chrome can't be headless
       for some engines and headed for others.
     - Each engine's Chrome stays open for about 2 minutes after its last search, then closes itself. Searches that
       arrive in the meantime wait their turn per engine instead of failing.
     - **On Windows**, each engine's Chrome closes right after its search instead. There, agent-browser shows browsers
       with extensions on the visible desktop, so a Chrome kept open would linger as a window _(plan review round 2,
       the user: "A")_.
   - _(plan review round 1, D4: yes)_ The search browser starts in its own folder, with every `AGENT_BROWSER_*`
     environment variable removed. So neither the user's agent-browser settings nor a project's `agent-browser.json`
     can attach it to the user's Chrome or change its profile.
   - _(my call, after the builder check)_ Only `search` uses this profile. The `browser` tool and the fetch fallback
     keep their throwaway sessions. Otherwise any page Claude opens, prompt-injected ones included, could set cookies
     or change consent choices in the profile that every later search uses.
   - agent-browser 0.39.1 has `--profile <path>` ("persistent custom profile directory"), `--headed`, `--user-agent`
     and `tab new` (checked in its
     [README at v0.39.1](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.39.1/README.md)).
4. **A normal user, no chores.**
   - No CAPTCHA solving, no prompts, nothing the user has to click.
   - A window may open briefly _(user)_.
   - **Consent banners are handled by an extension**, not by web-mcp's own code _(user: "could we install extensions
     that do it automaticly?")_.
     - The extension is [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) (Aarhus University, MIT). Its
       README says it answers "more than 200 CMPs". Its `rules/` folder has `bing.json` and five Google rules
       (`google_consentdomain_1/2`, `google_cwiz`, `google_eomdialog`, `google_popup`), checked 2026-10-23.
     - It is loaded with agent-browser's `--extension <path>`, which works both headless and headed (0.39.1 README).
     - **The search profile is declared in one config file** _(grill Q12, user: "is there no way to just say profile
       has x extensions?")_.
       - Chrome has no per-profile extension list, short of admin policies (which need root or the registry).
       - agent-browser's config file
         ([README "Configuration"](https://raw.githubusercontent.com/vercel-labs/agent-browser/v0.39.1/README.md))
         takes every flag as a camelCase key. So it can name the profile directory, the extensions, the
         `executablePath`, the user agent and `headed`.
       - web-mcp keeps one such file beside the search profile and passes it with `--config` on **every** call to a
         search session. A call without it relaunches agent-browser's default browser, and the page is lost (spike,
         D-1).
       - `--config` replaces `~/.agent-browser/config.json` and a project's `agent-browser.json` (findings.md).
         Search calls still run with the search folder as their working directory.
       - `args` holds no commas, because agent-browser splits it on commas and newlines.
       - On Linux, the `executablePath` for Helium is a small `#!/bin/sh` wrapper that web-mcp writes beside the
         profile. It runs Helium without `exec`; otherwise nixpkgs' Helium dies 10 s after agent-browser starts it
         (findings.md, upstream #1157).
     - web-mcp itself downloads Consent-O-Matic's pinned Chromium release zip (v1.1.5 today) on the first search,
       checks its sha256 and unpacks it into the search profile's folder. The installer has no step for it _(grill
       Q12: yes)_.
     - Which browser is set as `executablePath`:
       - Never the user's installed branded Chrome: since Chrome 137 it ignores extensions loaded from a folder
         ([Chromium PSA](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ?hl=de))
         _(grill Q12: yes)_.
       - The order of preference _(D-1, user: "there is helium", "let's continue")_: `WEB_MCP_CHROME`; else the
         newest Chrome for Testing from `agent-browser install`, if it starts (`--version`, checked once per process;
         on NixOS it doesn't start); else `helium`, then `chromium` on PATH.
       - If none is found, the search fails with a message naming `WEB_MCP_CHROME`.
     - Consent-O-Matic is not loaded for Bing: with it, Bing's result page dies (spike, D-1).
     - `open` reporting success proves nothing (it reports success for a blank page too). An engine's outcome comes
       only from parsing its page.
     - _(my call)_ Consent-O-Matic's choices are "reject" for everything.
     - _(left to the builder, check first)_ How its preferences are preset without the onboarding page it shows on
       install.
   - _(my call, after the builder check)_ "Normal browser" settings are allowed: a regular Chrome user agent (headless
     Chrome otherwise announces itself as `HeadlessChrome`), a real window size and `Accept-Language`. Anything beyond
     that falls under the anti-goal below.
   - Headless or headed is a **fixed setting per engine**, not a retry at runtime _(grill Q2, user: "lets first try
     headless during implementation. The engines that fail get no headless the rest stays headless")_. Every engine
     starts headless. An engine that is blocked headless during implementation is switched to headed for good, and the
     plan records which ones were.
5. **One engine failing never fails the search.**
   - A blocked engine is skipped and rests (is not queried) for 30 minutes. The rest is shared by every web-mcp
     process on the machine _(grill Q3: yes)_.
   - Only a block earns that rest _(plan review round 1, D3: yes)_. Blocked means a CAPTCHA or "unusual traffic" page,
     or a consent wall that doesn't clear. Other outcomes are handled differently:
     - An engine's own "no results" page is an empty answer.
     - A network error, a timeout or an unrecognised page skips that engine for this search only, with no rest.
   - The answer's source line names the engines used and the ones skipped, each with its reason.
   - `search` fails only when every engine fails, and its error then names each engine's reason.
6. **Better ranking** (prior art: [flow.md#prior-art](flow.md#prior-art)).
   - **Fusion:** the engines' result lists are fused with reciprocal rank fusion. URLs are normalised before merging.
   - **Snippets as evidence:** each result's snippet counts as a passage of this search, just like a fetched page's
     passages. FreshPrompt found that more snippets meant better answers.
   - **Fetching:** the top pages by fused rank are fetched, as today. _(my call)_ The default count stays 5; the bench
     may raise it.
   - **Scope:** passages are ranked only among this search's snippets and pages. Archived passages from earlier
     searches are no longer ranked at all, though the archive is still written _(grill Q4: yes)_.
   - The persistent passage index (`.web/index/`) is no longer written, since nothing reads it. An existing one stays
     on disk untouched _(plan review round 1, D2: A)_.
   - The final order combines BM25 with the fused engine rank. _(my call; the exact formula is left to the builder and
     tuned on the bench.)_
7. **Scholarly engines through the browser** _(user: "we dont need an api. We have the browser")_.
   - `papers: true` also opens Google Scholar and Semantic Scholar result pages.
   - _(my call, offered to the user)_ It keeps OpenAlex, arXiv and Crossref as APIs, for clean DOI, abstract and PDF
     data.
   - Everything is merged by DOI or arXiv id, as `papers::merge` does today, and then by normalised title.
   - Scholar and Semantic Scholar follow the same block-and-rest rule as the web engines.
8. **Filters without SearXNG** _(my call)_.
   - `since` (day, week, month, year) maps to each engine's own date filter. An engine without one is skipped for that
     search and named as skipped.
   - `since` applies on both sides: to the engines' date filters, and to OpenAlex's and arXiv's publication-date
     filters. Crossref is asked only for DOI lookups, as today, so `since` doesn't reach it _(plan review round 2, the
     user: "A")_.
   - `engines` picks which engines to open (`google`, `bing`, `duckduckgo`, `brave`, `scholar`, `semanticscholar`). An
     unknown name is refused with the list of known ones.
   - _(my call, after the builder check)_ Each engine belongs to a mode. `scholar` and `semanticscholar` are valid only
     with `papers: true`, and the web engines only without it. A mismatch is refused with that mode's list.
   - `category` is removed. Site-scoped searches use `site:` in the query, which every engine understands; the tool
     description says so.
9. **Measured, not claimed** _(my call; the user's first web-mcp round was benchmark-driven)_.
   - A search-quality bench runs a fixed query set through the new search, and, as the baseline, through the new search
     limited to `engines: bing`.
   - There is no SearXNG run. The user: "we dont need that. As long as SearXNG is gone its alright. After all just
     using bing should be the same". _(my call: the bing-only run stands in for today's Bing+Yahoo.)_
   - The query set has about 30 queries, covering coding and docs, general web and fresh facts, and papers. Each has a
     labelled answer or expected source.
   - The bench reports:
     - answer recall: the share of queries whose returned passages contain the labelled answer;
     - the block rate per engine;
     - p50 and p95 latency.
   - The thresholds are set at Gate 1 (proposed below).
10. **The installer and the docs follow.**
    - The built-in WebSearch and WebFetch are denied once **web-mcp's browser works**, no longer once SearXNG answers.
      "Works" means agent-browser is present and `agent-browser install` succeeded.
    - Every SearXNG mention is removed from the shipped code and docs: README, plugin and marketplace `description`s,
      `.mcp.json`, tool descriptions, GLOSSARY, CLAUDE.md. Earlier flows' docs stay as history.

## Hypothesis (thresholds fixed in the grill)

- **Q1 (quality):** the answer recall of the new `search` is at least 0.10 above its own bing-only run, and at least
  0.70 in absolute terms.
- **Q2 (speed):** p50 ≤ 5 s, p95 ≤ 10 s.
- **Q3 (reliability):** at least one web engine answers on ≥ 95% of queries, and no engine's block rate is above 20%
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
- One blocked engine makes `search` fail, or hang past its deadline.
- Stealth plugins, injected scripts that patch browser fingerprints (`navigator.webdriver` and the like), or rotating
  identities to hide the automation. The point is to be a normal browser, not a disguised bot. _(my call, from "just
  want to be a normal user")_

## Installer

- The installer stops setting up SearXNG and **leaves an existing `searxng` container and its `settings.yml`
  alone**. There is no cleanup step _(grill Q5, user: "no - I havent really installed it on many")_.
- The built-in WebSearch and WebFetch are denied once agent-browser is present and `agent-browser install` has
  succeeded. If that fails, they stay allowed _(grill Q6: yes)_.

## Bench

- Claude writes the ~30 queries with their labelled answers. The user skims them once before the first run; after
  that they are fixed _(grill Q8: yes)_.
- Thresholds Q1–Q3 are fixed as proposed _(grill Q9: yes)_.

## Tool interface

The `search` tool keeps its name and its `query`, `papers` and `max_passages` parameters. `engines` and `since` work as
described in goal 8, and `category` is removed. There are no new tools _(grill Q10: yes)_.

## Locale

Every engine is queried in English, fixed (Google `hl=en`, and each other engine's own equivalent) _(user: "english
pls")_. This doesn't depend on the machine's locale or IP region. A query written in German still finds German pages.

## Constraints

- The code lives in the Rust crate `crates/web-mcp` and runs on Windows and Linux x64. agent-browser is pinned at
  0.39.1 (`installer/assets/agent-browser.json`) and driven as a child process (`browser.rs`, one `--json` call or
  batch per action).
- The engine parsers are parsers of what other tools write. Per CLAUDE.md's rule, they test against **captured result
  pages** in fixtures, not assumed shapes.
- Everything pulled lands in `$CLAUDE_PROJECT_DIR/.web/` before Claude sees it. That includes each engine's result
  listing, just as today's search listing is archived. Page content stays marked untrusted.
- Installer: Node standard library only; new logic goes in `core/`/`system/` with a test next to it.
- Several web-mcp processes may run at once, one per Claude session, and agent-browser sessions are global per user
  (`browser.rs:236`).

## Left to the builder

- The per-engine result URLs and parsers, block detection, deadlines, the rest period and the headed retry.
- The fusion and the final scoring formula, tuned on the bench.
- How Consent-O-Matic's preferences are preset, and where `agent-browser install` puts Chrome for Testing on each OS.
