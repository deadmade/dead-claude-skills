# web-mcp: chosen sources (search filters and `lookup`)

Status: approved at Gate 1, 2026-10-17. Flow: [flow.md](flow.md). Builds on the web-mcp spec ([../spec.md](../spec.md)) and
its agreed follow-ups ([../flow.md](../flow.md), "Follow-ups"). Choices nobody stated are marked _(my call)_; the
user handed the choice of sources to me ("either tune it or use something different if it offers a better idea").

## Intent

web-mcp today asks one place, SearXNG with Bing and Yahoo, for everything. The user doesn't want another general
search engine. They want the **agent to pick a direct source when it needs one**: search only GitHub when looking
for a repo, and when it needs DNS records, a certificate history or a CVE, fetch the record itself instead of asking
Bing who wrote about it. The point is getting the agent direct, important information that **the user can review**.
They review in `.web/`, and they want Claude to tell them its sources in its answer.

## Goals

1. **`search` takes optional filters**, chosen by the agent per call. Without them, `search` behaves exactly as it
   does today.
   - `engines` (comma-separated SearXNG engine names, such as `github`), `category` (a SearXNG category, such as
     `it` or `repos`), and `since` (`day`, `week`, `month` or `year`). These pass through as SearXNG's `engines`,
     `categories` and `time_range`. `week` is accepted by SearXNG's `parse_time_range` even though the API docs list
     only day, month and year (prior-art check, flow.md). SearXNG skips engines without `time_range_support`
     whenever `time_range` is set, and github has none. So when `since` is set and none of the chosen engines
     support it, the call is an error that says so, rather than an empty answer (plan review S3). With both
     `engines` and `category` set, a result must match both.
   - **The answer stays inside the filter** _(my call, from "if I search a github repo I'm only interested in
     github")_. With any filter set (`engines`, `category` or `since`), the passages come only from this call's
     result pages, never from other archive pages, which could be months old or from unrelated sites. Results from
     engines that weren't asked for are dropped. SearXNG silently drops
     unknown engine names, and when none are left it falls back to its default categories (`webadapter.py`), so
     the server can't trust that the reply honoured the filter.
   - **Checked against SearXNG's own list** _(my call)_. On the first filtered search of a run, the server reads
     SearXNG's `/config` (its engines and their categories) once and keeps it for the run. An unknown engine or
     category is an error before any search runs, and the error lists the valid names. Under `category`, a result
     counts if its engine belongs to that category. The builder confirms `/config`'s shape against a real SearXNG
     (not reachable from the spec session).
   - **No match says so.** When a known engine returns nothing, the answer says so and names the engine. It doesn't return Bing results in their place.
   - **The source line names the filter**, e.g. `Source: SearXNG (engines: github) + this search's pages`.
   - **The tool description names useful engines** so the agent knows they exist: `github`, `stackoverflow`,
     `pypi`, `docker hub`, `mdn`, `arch linux wiki` (on by default), and `crates.io`, `npm`, `pkg.go.dev`, `gitlab`,
     `codeberg` (disabled by default, but an explicit `engines=` still reaches them). The installer's `searxng.yml`
     doesn't change: with `use_default_settings: true` the default engines stay loaded (prior-art check). The
     builder confirms the disabled-but-explicit behaviour against a real SearXNG. If it doesn't hold, those five
     get `disabled: false` in `searxng.yml` instead _(my call)_. They sit in the `it` category, not `general`, so
     unfiltered search doesn't change. The installer never overwrites an existing `settings.yml`, so the README says how to add those entries by hand and restart SearXNG (plan review S10).
2. **A new tool, `lookup { kind, target, record?, at?, ecosystem? }`**, for facts that have one answer. It uses
   passive public sources only and needs no API keys. It is one tool with a `kind` argument, not one tool per kind, and it takes one target per call (grill Q2, Q6). It is annotated `readOnlyHint: true`, so several lookups in one message run in parallel.
   Kinds, with their sources (all checked in this session, flow.md "Prior art"):
   - `dns`: `target` is a name; `record` is a type (default: A, AAAA, CNAME, MX, NS, TXT, queried in parallel).
     Source: Cloudflare DNS-over-HTTPS JSON _(my call; Google's JSON API is the same shape)_. `Status` 3 is
     NXDOMAIN, and 2 is SERVFAIL with `Comment`, a DNSSEC failure among others. Both are reported as such, not as
     empty answers.
   - `whois`: `target` is a domain, IP or `AS<n>`. Source: RDAP, picked from IANA's bootstrap files (`dns.json`
     and the IP and ASN ones). Each file is fetched once per run, not through the rdap.org redirector, which allows
     10 requests per 10 s _(my call)_. 234 of 1437 TLDs, including de, ch, at, eu, io and jp, have no RDAP server.
     For those, `whois` says so plainly. Port-43 whois is a non-goal.
   - `certs`: `target` is a domain. Source: crt.sh JSON for `%.<domain>`, excluding expired certificates. crt.sh is
     slow and flaky: it returned 502 for example.com twice, and took 14 s and 500 KB for `%.google.com`. So it gets
     a 25 s deadline and one retry on 5xx _(my call)_. The answer is the distinct names with their issuer and
     first and last validity; the full rows stay in the archive.
   - `wayback`: `target` is a URL. Without `at`, it lists that URL's snapshots from the CDX API (newest first,
     collapsed on content digest, at most 50 rows). With `at` (a timestamp, or a prefix of one), it reads the
     nearest snapshot raw (`/web/<ts>id_/<url>`, following the 302 to the nearest capture) through `fetch::get`,
     without the browser fallback, so the page arrives as markdown like any fetch. A capture never changes, so it
     is cached and indexed like any fetched page _(my call)_; later searches can find it under its
     `web.archive.org` URL. The CDX listing is a lookup like the others. The availability API is not used: in the check it
     returned `{}` even for archive.org.
   - `ip`: `target` is a public IP. Source: Shodan InternetDB (`ports`, `hostnames`, `cpes`, `tags`, `vulns`).
     Private and reserved addresses are refused before any request; InternetDB answers 200 for `10.0.0.1`. A 404
     means "no information available", not an error. InternetDB is free for non-commercial use, and the README
     says so.
   - `vuln`: the user added this ("would also be awesome").
     - `target` is a CVE, GHSA or other OSV id, or a `package@version` together with `ecosystem` (the OSV names:
       `npm`, `PyPI`, `crates.io`, `Go`, …).
     - An id's record comes from OSV (`/v1/vulns/<id>`, no rate limit) and every CVE is always enriched with EPSS (FIRST)
       and the CISA KEV entry (grill Q5). The KEV feed is about 1.8 MB, CC0, and fetched once per run.
     - NVD 2.0 is the fallback when OSV doesn't know a CVE _(my call)_. Its rate limits couldn't be read in the
       check, so the builder verifies them before choosing an interval. Until then, 1 request every 6 s, no key.
     - A package is looked up through OSV's `/v1/query`, following `next_page_token`.
     - GitHub's advisory API isn't used: OSV already imports GHSA, and GitHub allows 60 requests an hour without a
       token.
3. **What comes back is the record, not a summary.** The user confirmed: "that's exactly the idea".
   - Each source's reply is pretty-printed JSON, or markdown for a wayback snapshot, as the source sent it.
   - It is cut only to fit: past 30,000 characters per call _(my call, under Claude Code's 10,000-token warning)_,
     the answer holds the start and points to the archive file for the rest. `certs` and the `wayback` listing
     are condensed as described above.
   - A source that fails (EPSS down, crt.sh 502 after the retry) is named in the answer, and the rest is still
     returned. Only when every source fails is the call an error.
4. **Every `lookup` result opens with its sources**, one line per source request: the API URL, the fetch time, the
   `.web/` path, and the untrusted-content marker. The tool description tells Claude to cite those URLs and paths
   when it answers the user ("having sources that claude tells me would be also important").
5. **Reviewable in `.web/`.** Every source reply is archived before Claude sees it, as
   `.web/<run>/lookups/<kind>/<slug>.json`. It holds the query (kind, target, options), the source URL, the time,
   the HTTP status and the reply, pretty-printed so a human can read it. Each one also gets an `index.jsonl` line
   with type `lookup`.
   - Lookups are not answered from the archive. DNS, certificates and advisories change, so every call asks again;
     only the bootstrap, KEV and SearXNG `/config` files are reused within a run.
   - Lookups are not added to the BM25 index _(my call: records aren't prose passages)_.
   - The one exception is a wayback snapshot (`at` set): it is a page, archived, cached and indexed through
     `fetch::get` (goal 2).
6. **Etiquette.** Requests go through `HostLimits`, with each source's spacing. Every lookup request (not page
   fetches, plan review S9) sends a descriptive User-Agent, which Wikimedia-style APIs require and which costs
   nothing elsewhere _(my call)_. A 429 or 5xx is retried once after its `Retry-After`, never in a loop. Redirects
   are followed up to 3 hops, each to a public host; RDAP servers redirect (plan review S1, S2). Each source has its
   own deadline per attempt, counted from when its rate-limit slot frees up: 8 s, except crt.sh at 25 s.
7. **Tested like `papers`.** Every source URL can be repointed by environment variable (`WEB_MCP_<SOURCE>_URL`),
   and each HTTP-200 failure mode found in the check is its own test against a stub:
   - DoH: `Status` 3 and 2
   - crt.sh: `[]` and 502 HTML
   - InternetDB: 404 JSON
   - OSV: `{}` for an unknown package, and pagination
   - NVD: `totalResults: 0`
   - EPSS: `total: 0`
   - SearXNG: dropped engines, and the fallback to default categories
8. **Docs stay true.** The web-mcp README describes the filters, `lookup`, its sources and their terms
   (InternetDB is non-commercial, and the queried names go to Cloudflare, crt.sh, Shodan and the others). There is no
   setting or prompt for that disclosure (grill Q4). Lookups never contact the target itself. CLAUDE.md's web-mcp
   line is updated too.

## Non-goals

- No active probing: no port scans, brute force, zone transfers or direct DNS to a target's own servers.
- No API keys and no paid sources. Optional keys (NVD, GitHub) may come later and aren't designed here.
- No new general web search engine, and no change to unfiltered `search`.
- No port-43 whois for TLDs without RDAP.
- No `searxngUrl` user config (the third follow-up, "wanted later, not now").
- No caching or archive-answering of lookups across calls (see goal 5).
- No benchmark or measured hypothesis: this adds coverage, not speed; stub tests only (grill Q7).
- No list of targets in one call (grill Q6).

## Changes to earlier decisions

- **web-mcp spec goal 2 says "Three tools, no more".** `lookup` makes four. The user asked for it (the agreed
  follow-up, now in scope). No ADR: it is easy to reverse and explained here (grill Q3).
- **The follow-up planned `lookup` for its own flow** (`/feature-flow web-mcp-lookup`). It is in this flow instead,
  together with the filters _(my call, said to the user)_.
- **Vulnerability records** weren't in the follow-up. The user added them in this flow.

## Left to the builder

- How `search` keeps passages inside the filter. The index's `url` field is stored but not indexed (`rank.rs:83`),
  so either filter the hits after ranking, or index the URL.
- How results are matched to engines: SearXNG's per-result `engine`/`engines` fields, confirmed against a real reply.
- Module layout (one `lookup.rs` with a module per source, or a module per source directly), slug format, and how
  `Item` grows a `Lookup` variant.
- Exact output format of each kind, within goals 3 and 4.
