---
phase: finish
---

# web-mcp optional search sources: flow

Lives under `docs/features/web-mcp/` at the user's request; linked from [../flow.md](../flow.md) so a resume finds
it.

## Request

> Hey, I would like to extend my websearch abilitly with more sources optionaly. These should be in the docus for the
> implementation of web-mcp

Clarified in brainstorming (2026-10-17): no new general search engine. Wanted are specialised sources that the
**agent chooses per call** when it needs one: "if I search a github repo I'm only interested in github", "I want dns
records … retrieve that, not just ask bing". The user then pasted the two follow-ups agreed on 2026-10-17 in
[../flow.md](../flow.md) ("Follow-ups") as the scope:

- SearXNG category, engine and time filters on `search` (`category`, `engines`, `since` → `categories`, `engines`,
  `time_range`).
- `lookup` tool, passive sources only, no keys: `dns` (DoH), `whois` (RDAP), `certs` (crt.sh), `wayback`
  (archive.org), `ip` (Shodan InternetDB). Archived in `.web/`, no active probing.

Added by the user: vulnerability records in `lookup` (CVE details, a package's known advisories): "would also be
awesome". Both follow-ups go into this one flow, not a separate `web-mcp-lookup` flow _(my call, offered to the
user)_.

Not in scope: the third follow-up, the `searxngUrl` user config ("wanted later, not now").

## Artifacts

- Spec: [spec.md](spec.md) (approved 2026-10-17)
- Plan: [plan.md](plan.md) (10 tasks)
- ADRs:
- CONTEXT.md: none; the repo keeps a [GLOSSARY.md](../../../../GLOSSARY.md). Added in the grill: Lookup, Source, Engine

## Gates

- Gate 1, spec approved: 2026-10-17, by the user ("yep"), after grill rounds 1–2.
- Gate 2, plan approved: 2026-10-17, by the user ("approve, subagent-driven"), after review rounds 1–2. Execution: subagent-driven. Filters (Tasks 1–2) ship as their own PR first.

## Skipped

## Grounding

- **One web backend today.** `plugins/web-mcp/server/src/search.rs:48-50` defines `trait WebSearch { search(q) ->
Result<Vec<WebResult{url,title}>, SearchError> }`; the only impl is `SearxNg` (`search.rs:54-121`), and `Ctx` holds
  it as a concrete type (`main.rs:28`), not `dyn`. `search::web` (`search.rs:126-200`) takes SearXNG's results,
  fetches the top 5 (`TOP`, 3 s each), and then ranks passages of the whole archive with BM25; result order from
  the backend only decides which 5 pages get fetched. Snippets from the backend are dropped.
- **SearXNG unreachable fails the call** (`SearchError::Unreachable`, spec goal 2). The source line names "SearXNG +
  archive" (`search.rs:170`).
- **SearXNG engines** come from `installer/searxng.yml`: Bing and Yahoo on, DuckDuckGo, Brave and Google CSE off
  because they CAPTCHA or rate-limit a scraper. So "more engines" can already be done in that file, without code.
- **Papers** (`papers.rs`): OpenAlex, arXiv, Crossref, merged by DOI/arXiv id, each source with its own 8 s deadline
  (`config.rs:14-16`, `WEB_MCP_PAPERS_MS`), rate-limited per host.
- **Config** is env vars (`config.rs:23-47`) set in `plugins/web-mcp/.mcp.json`; `binPath` already comes from
  `userConfig` (`${user_config.binPath}`), so user-provided values (API keys) have a path in.
- **Non-goal in the web-mcp spec** (`../spec.md:86`): "No paid or key-only search APIs, no Google scraping. SearXNG
  is the only web backend; it sits behind a trait so another can be added later." This feature revisits it.

## Prior art

Background agent, 2026-10-17; every link was fetched in that run.

- **SearXNG** fans out to engines in parallel. Each engine has its own `weight`, `timeout` and `api_key`, and keyed
  engines are `inactive` by default
  ([settings_engines](https://docs.searxng.org/admin/settings/settings_engines.html)). Duplicates are merged by hash,
  and results are scored by weight and position, much like rank fusion
  ([results.py](https://raw.githubusercontent.com/searxng/searxng/master/searx/results.py)). An engine that fails is
  suspended: 3600 s after a 429, 86400 s after a 403 or CAPTCHA
  ([settings_search](https://docs.searxng.org/admin/settings/settings_search.html)).
- **mcp-omnisearch** has a `provider` argument on each call and one env var per API key. Providers without a key are
  skipped, and results are never merged
  ([README](https://raw.githubusercontent.com/spences10/mcp-omnisearch/main/README.md)).
- **GPT Researcher** takes `RETRIEVER=tavily,arxiv` and runs the retrievers in sequence
  ([search-engines](https://docs.gptr.dev/docs/gpt-researcher/search-engines)).
- **Open WebUI (DDGS)** picks a random provider for each search. Scraped providers refuse requests from datacenter
  IPs or return empty pages ([ddgs](https://docs.openwebui.com/features/chat-conversations/web-search/providers/ddgs)).
- **Perplexica/Vane** searches SearXNG only, with Tavily and Exa marked "coming soon"
  ([README](https://raw.githubusercontent.com/ItzCrazyKns/Perplexica/master/README.md)).
- **Keyed APIs and archiving.** Kagi's terms forbid storing or archiving results ([API ToS](https://kagi.com/privacy/api)),
  which `.web/` does. Brave allows storage only "with a plan that includes storage rights"; it costs $5 per 1k
  requests, with $5 of free credit a month ([api](https://brave.com/search/api/)). Tavily gives 1,000 free credits a
  month and can return `raw_content` ([credits](https://docs.tavily.com/documentation/api-credits),
  [search](https://docs.tavily.com/documentation/api-reference/endpoint/search)), and its terms say nothing about
  caching ([terms](https://www.tavily.com/terms)). Exa returns full `text` ([search](https://exa.ai/docs/reference/search)),
  but its terms could not be read.
- **Keyless topical APIs.** GitHub search allows 10 requests a minute without a token and 30 with one
  ([REST search](https://docs.github.com/en/rest/search/search)). Wikipedia requires a User-Agent with contact info
  and requests sent one at a time ([API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)). Stack Exchange's
  docs could not be reached.
- **Source check** (second agent, 2026-10-17, live calls plus docs; the full table was in its report, and the facts
  the spec relies on are quoted in [spec.md](spec.md) goals 1–2).
  - [Cloudflare dns-json](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)
    and [Google DoH](https://developers.google.com/speed/public-dns/docs/doh/json): `Status` 3 means NXDOMAIN, 2
    means SERVFAIL.
  - [about.rdap.org](https://about.rdap.org/) allows 10 requests per 10 s; the
    [IANA dns.json](https://data.iana.org/rdap/dns.json) bootstrap leaves 234 TLDs without RDAP.
  - [crt.sh](https://crt.sh/?a=1) gave 502 and 14 s responses.
  - The [CDX README](https://raw.githubusercontent.com/internetarchive/wayback/master/wayback-cdx-server/README.md)
    documents resume keys; the [Wayback availability API](https://archive.org/help/wayback_api.php) returned `{}`
    even for archive.org.
  - [InternetDB](https://internetdb.shodan.io/openapi.json) answers a 404 when it has no data, and the
    [Shodan blog](https://blog.shodan.io/introducing-the-internetdb-api/) says it is for non-commercial use.
  - [OSV](https://google.github.io/osv.dev/api/) has no rate limits and paginates;
    [KEV](https://www.cisa.gov/sites/default/files/licenses/kev/license.txt) is CC0;
    [GitHub advisories](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) allow 60
    requests an hour without a token; [EPSS](https://api.first.org/#Rate-Limit) allows 1000 a minute.
  - SearXNG ([search_api](https://docs.searxng.org/dev/search_api.html), master `webadapter.py` and `settings.yml`):
    unknown `engines=` are silently dropped, with a fallback to the default categories; `github` is enabled; disabled
    engines can still be picked explicitly; `use_default_settings` keeps the defaults.
  - NVD docs did not render, so its limits are unverified.
- **Approaches:**
  - A: extra engines in SearXNG's `settings.yml`, with no code.
  - B: fan out to keyed `WebSearch` backends inside web-mcp and fuse their ranks.
  - C: one provider per call or per config.
  - D: keyless topical sources as categories, like `papers`.

## Options

- **Approach** (prior-art A–D): the user's scope is D (the agent picks a direct source per call) plus SearXNG's own
  engine filters (a narrow form of A). B (keyed fan-out) and C (one keyed provider) were dropped: the user doesn't
  want a new general search engine, and keyed APIs clash with the archive (Kagi forbids storage, Brave allows it only
  on a plan with storage rights).
- **Sources**: the user handed the choices to me. They are in spec goal 2, each marked _(my call)_ where it is mine.
- **Builder check** (2026-10-17): 4 questions, all settled as my calls in the spec:
  1. any filter scopes passages to this call's pages;
  2. SearXNG `/config` is read once per run to validate names and map categories;
  3. a wayback snapshot is cached and indexed like a fetched page;
  4. if naming a disabled engine doesn't reach it, five engines are enabled in `searxng.yml`.

## Grill

Round 1 (2026-10-17), recommended answers taken unless noted:

- Q1: added the glossary terms Lookup, Source and Engine.
- Q2: one `lookup` tool with `kind`.
- Q3: no ADR.
- Q4: the user asked whether looking at these sites is forbidden. It isn't: the lookups are passive, and only
  InternetDB's terms name a limit (non-commercial use). The README documents which services see the targets, with no
  setting and no confirmation (round 2, "yes").
- Q5: every CVE is enriched with EPSS and KEV.
- Q6: one target per call.
- Q7: tests only, no benchmark.

## Plan review

### Round 1 (2026-10-17)

Three reviewers looked at the plan (correctness, fit, simpler). They found 2 blocking, 15 should-fix and 8 consider
items. Duplicates were merged, and none were dropped: each traces to code `file:line` or a fetched doc. The user's
decision was "all recommended", for every item.

- **B1:** lookup archive names get a `seq` and a URL hash, so files never overwrite each other.
- **B2:** the old Task 3 skeleton is merged into the dns task (no dead code under `-D warnings`).
- **S1, S2:** one shared request helper `api.rs` (the new Task 3), used by papers too:
  - the deadline is per attempt and starts after the rate-limit slot;
  - one retry on 429 or 5xx;
  - up to 3 public redirect hops, needed for RDAP;
  - crt.sh gets 25 s per attempt, and the override is `Option<Duration>`.
- **S3:** `since` on engines without `time_range_support` is an error. **Spec edited**, which reopened Gate 1 for
  this item; covered by the "all recommended" decision.
- **S4:** `/config` is optional; without it, the checks are skipped.
- **S5:** honest no-result lines under a filter.
- **S6:** `Mcp::call_raw` added to the test harness.
- **S7:** `SearxNg::new`, and the test `Ctx` is in the task file lists.
- **S8:** a `reserved()` check in `ip.rs`.
- **S9:** the lookup-only User-Agent. **Spec edited.**
- **S10:** manual steps for an existing `settings.yml`. **Spec edited.**
- **S11:** bare ASN numbers; bootstrap fixtures served through `fx.route`; https preferred, http as fallback.
- **S12:** the wayback `at` branch lives in `lookup::run` and is cut at 30k.
- **S13:** the OSV id prefix is uppercased.
- **S14:** bootstrap and KEV files are `context` parts.
- **S15:** all the files that list the tools are named in Task 10.
- **Consider items, all taken:**
  - sequenced fixture routes for OSV paging;
  - `Index::search(.., only)`;
  - the tool size test covers `lookup`;
  - `engines` and `category` are ANDed;
  - the filter is part of the search archive's name;
  - CDX uses `limit=-50`, reversed;
  - a leading `@` in a package name is kept;
  - **the filters ship as their own PR first.**

Shape changed (new helper task, merged tasks), so a focused re-check followed.

### Round 2, the re-check (2026-10-17)

One reviewer checked the revision. Every round 1 decision is in the plan. It found 5 blocking and 11 smaller items,
all about sequencing and file lists, not behaviour. I fixed them in the plan without a user decision, because they
implement round 1 as decided:

- Items that would be dead code under `-D warnings` now arrive in the task that first uses them:
  - `Answer.url` in Task 5;
  - `json`/`accept` as `send` parameters from Task 3;
  - `LookupArgs.at` in Task 7 and `LookupArgs.ecosystem` in Task 9;
  - `Filter::describe` in Task 2, and `needs_config` merged into `is_set`.
- The redirect tests moved to Task 5, through the binary: loopback hops are private in-process.
- `since_only_needs_config_once` moved to Task 2.
- File lists completed:
  - papers' `MAX_RETRY_WAIT` and its import;
  - `test_ctx` becomes `pub(crate)`;
  - Task 5's `Ctx.lookup` files.
- Named: `Config.lookup_urls`, `WEB_MCP_RDAP_URL`, and `Kind::as_str`.
- New error: a body over 20 MB.
- The slot test holds all 4 permits.
- `search::web` writes the filter into its JSON.
- The 1200-byte schema checks run in Tasks 2 and 9.
- The docs grep was widened.
- `since` with only `category` checks that category's engines.

## Deviations

Rulings the controller made during execution (2026-10-17). The full ledger was in the git-ignored SDD workspace.

- **R1:** the search filter enters the archived JSON and the file-name hash only when it is set, so unfiltered
  archive files stay byte-identical.
- **R2:** the user's SearXNG wasn't reachable from the sandbox.
  - `/config` is parsed per SearXNG master's `webapp.py`.
  - `installer/searxng.yml` is unchanged.
  - The README says how to enable a disabled engine by hand.
  - **Still to confirm against the real instance.**
- **R3:** `bad_since_is_rejected` asserts rmcp 3.5.1's real behaviour. A bad `since` comes back as an `isError` tool
  result, not the plan's JSON-RPC -32602 error.
- **R4/R5:** lookup has its own 30k cut. It cuts at the last line break within the 1,000 characters before the limit,
  or else at the limit, so a large JSON record still shows its start. `Failed:` lines come before the records.
  `fetch::truncate` is unchanged.
- **R6:** the KEV feed uses the spec's 8 s per-attempt deadline. The implementer had used 20 s.
- **R7:** the final fix wave covered:
  - the test-dir collision behind the `Archive::open` flake;
  - the timing of the rank merge test (both flakes predate the branch);
  - the wayback `..`/`%2e%2e` path escape;
  - a KEV feed without a `vulnerabilities` array, now a load error;
  - pretty-printed `ip` output;
  - record types in the DoH sections;
  - a bing-fallback test;
  - a README note on worst-case lookup time.
- **Open, for the user (spec goal 5 gap):** non-2xx source replies are named in the answer, but their bodies are not
  archived in any kind.
- **Not verified here:**
  - the `examples/h4.rs` one-line edit, because the h4 crates aren't cached (needs a local
    `cargo build --features h4 --examples`);
  - NVD's real rate limit (6 s spacing, unverified);
  - every source against the live service; all tests use stubs.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
| 1 filters on `search` | 1, 2 | `server/src/search.rs:196` (check), `:250` (keep), `:397` (web), `:479` | `tests/search.rs:304` `filtered_search_with_no_results_says_so`, `search::tests::keeps_only_asked_engines` |
| 2 `lookup` tool | 4 | `server/src/tools.rs:384`, `server/src/lookup/mod.rs:162` | `tests/mcp.rs:7` `lists_four_tools` |
| 2 dns | 4 | `server/src/lookup/dns.rs:29` | `tests/lookup.rs:28` |
| 2 whois | 5 | `server/src/lookup/rdap.rs:183` | `tests/lookup.rs:187` `whois_follows_registry_redirect` |
| 2 certs | 6 | `server/src/lookup/certs.rs:15` | `tests/lookup.rs:400` `certs_502_twice_is_a_named_failure` |
| 2 wayback | 7 | `server/src/lookup/wayback.rs:20`, `:66` | `tests/lookup.rs:442`, `:490` |
| 2 ip | 8 | `server/src/lookup/ip.rs:37` | `tests/lookup.rs:622` `ip_refuses_private_and_reserved` |
| 2 vuln | 9 | `server/src/lookup/vuln.rs:67` | `tests/lookup.rs:701` `cve_has_osv_epss_and_kev`, `:758` |
| 3 records, cut at 30k | 4 | `server/src/lookup/mod.rs:99` (render), `:150` (cut) | `lookup::tests::long_output_is_cut_with_pointer` (`mod.rs:221`) |
| 4 source lines, cite | 4 | `server/src/lookup/mod.rs:99`, `server/src/tools.rs:384` | `tests/mcp.rs:7` (description contains `cite`) |
| 5 archive in `.web/lookups/` | 4 | `server/src/archive.rs:328` | `archive::tests::put_lookup_writes_pretty_json_and_index_line` (`archive.rs:762`) |
| 6 etiquette (deadline, retry, redirects, UA, NVD 6 s) | 3, 9 | `server/src/api.rs:101`, `server/src/limits.rs` | `api::tests::*`, `tests/lookup.rs:187` |
| 7 stub tests per failure mode | 1–9 | `server/tests/lookup.rs`, `server/tests/search.rs` | all of the above |
| 8 docs | 2, 10 | `plugins/web-mcp/README.md`, `CLAUDE.md`, `plugin.json`, `marketplace.json` | `npm test` (check-repo) |

Paths are relative to `plugins/web-mcp/`. Final checks on 6ac55a5: `cargo test` (all suites, 0 failed), `cargo clippy
--all-targets -- -D warnings` (clean), `npm test` (123/123).
