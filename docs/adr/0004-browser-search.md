# web-mcp searches by reading engines' result pages in a browser of its own

web-mcp's `search` used to query a SearXNG the installer ran in Docker. That SearXNG scraped Bing and Yahoo, which
serve one index. It had to run on every machine, and when it wasn't running, `search` failed. Now `search` opens the
result pages of Google, Bing, DuckDuckGo and Brave (and Google Scholar and Semantic Scholar for papers) in an
agent-browser Chrome with a persistent **search profile** of its own. It reads the results off the page the way a
person would. A blocked engine is skipped, never fatal. The user wanted no keys, no service to run, and a browser
that behaves like "a normal user", in "complete isolation" from their own.

## Considered options

- **Keep SearXNG, local or on one shared machine.** Rejected: "searxng goes away completly".
- **Keyed search APIs** (Brave, Tavily, Exa, Mojeek) and **hosted keyless endpoints** (Firecrawl, You.com,
  Marginalia). Rejected: they "cost money or dont allow scraping". Brave's terms also forbid storing its results,
  and storing them is what `.web/` does.
- **Scraping engines' HTML from the binary** (ddgs, websurfx). Rejected as "the same problem like searxng": bot
  detection and constant breakage.
- **eTools.ch.** Rejected: no public API, `robots.txt` disallows its search endpoint, and a test query got HTTP 403.
- **Claude Code's built-in WebSearch.** Rejected by the user ("I dont want to go back on claude web search").

## Consequences

- **The search browser is not the user's.** It isn't the user's Chrome, profile or accounts, and never attaches to
  them. The `browser` tool and the fetch fallback keep throwaway sessions, so pages Claude opens can't change the
  search profile.
- **No stealth.** Normal browser settings are allowed (a regular user agent, window size, `Accept-Language`).
  Fingerprint patching is not. An engine that keeps blocking is dropped or switched to headed, not disguised.
- **Consent banners** are answered by the Consent-O-Matic extension. Normal Google Chrome ignores extensions loaded
  from a folder since version 137, so the search browser is Chrome for Testing.
- **Results are only as stable as the engines' pages.** The parsers test against captured result pages and need
  updating when an engine changes its markup.
