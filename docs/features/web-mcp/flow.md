---
flow: research
phase: execute
---

# web-mcp: research flow

## Request

> Hey, I currently really dont enjoy the way claude is able to access the web. First of all I dont think beeing able
> to just get a summirazion of the web content is enough for me, second it should also be able to see pictures etc if
> the website has them and are needed (optional) I also would like to replace the python script from research flow
> and route it all through one thing. Design it in Rust (performence is vital - the faster the better with benchmark
> pls) It should be able to utilize proper search engines etc. Utilize the skills from dead-claude-skills pls to
> create this!

## Artifacts

- Plan (pre-flow, approved 2026-10-16 "plan lgtm"):
  [Web MCP server: validated plan](https://claude.ai/code/artifact/5fc18b2f-8c6f-4cc4-ac46-dca899c2b7c9)
- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md) (18 tasks; Task 1 baseline, Task 6 early H1/H2, Task 18 measurement, Task 12 only if H4 holds)
- Baseline harness: [bench/baseline.mjs](bench/baseline.mjs), inputs [bench/inputs.json](bench/inputs.json)
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md) (archive, run, session, passage)

## Gates

- Gate 1, spec and hypothesis approved: 2026-10-16, by the user ("Approve spec"), after grill rounds 1 and 2.
  Reopened for D1, D2, D5, D6 (plan review round 1) and approved the same day ("all recommended").
- Gate 2, plan approved: 2026-10-16, by the user ("Approve plan"). Execution: subagent-driven. Commits: one per
  task on `feat/web-mcp`, no push without asking.

## Skipped

- Brainstorm questions: the approved plan already settled the design (search via SearXNG, agent-browser, archive,
  three tools, parallel). The spec was written from it; every choice beyond it is marked _(my call)_.

## Grounding

- **research-flow** (`plugins/feature-flow/skills/research-flow/SKILL.md:34`, `references/literature.md:14`) runs no
  Python itself; it requires every evidence row to come from `paper-lookup`. feature-flow depends on paper-lookup
  (`plugins/feature-flow/.claude-plugin/plugin.json:10`).
- **paper-lookup** is vendored (`sync-paper-lookup.yml`). Its Python is four stdlib parsers plus a paginator
  (`plugins/paper-lookup/skills/paper-lookup/scripts/`, 1,446 lines): `arxiv_atom.py` (Atom → JSON, exit 3 on
  arXiv's HTTP-200 error feed, 5 on throttling), `openalex_abstract.py` (inverted index → text), `jats_to_text.py`,
  `paginate.py` (bioRxiv, medRxiv, Europe PMC, OpenAlex, Crossref with count reconciliation). The network calls are
  plain `curl` in the skill text. Its SKILL.md lists the HTTP-200 failure modes the Rust port must keep as tests, and
  the rate limits (arXiv 1 request / 3 s, Crossref 1–3/s, OpenCitations 180/min).
- **Packaging precedent:** brv targets and `brvAsset()` at `installer/core.mjs:304-321`, release asset per platform
  from `.github/workflows/build-brv.yml` via `release.yml:71-98`. A pinned external tool: `installer/cswap.json`
  (`{"upstream": "v0.26.0"}`), bumped by `sync-cswap.yml`. The only `.mcp.json` today is `plugins/mcp-basic` (an
  http server).
- **rmcp 3.5.1 handles requests concurrently** (source read and spike, 2026-10-16):
  - `service.rs:1603-1617` spawns every incoming request with `spawn_service_task` (`tokio::spawn`;
    `spawn_local` under the `local` feature, `service.rs:1321-1336`) and goes back to reading. No semaphore or cap;
    responses return in completion order through one channel and one framed writer
    (`transport/async_rw.rs:54,113`).
  - Cancellation sets a per-request `CancellationToken` (`service.rs:1587,1649-1652`); a handler stops only if it
    watches the token, and a cancelled response is dropped.
  - Spike, 4 back-to-back `tools/call` of a 1 s async sleep: 1.00 s total (3 runs, multi-thread and current-thread).
    A blocking handler (`std::thread::sleep`) serialises: 4.00 s on current-thread, 2.00 s on 2 workers. So CPU work
    goes on `spawn_blocking`, and the server adds its own cap if it needs one.
- **When Claude Code runs MCP calls in parallel** (claude 2.1.301, binary strings and 7 `claude -p` runs against a
  stub server):
  - Several calls in one assistant message overlap only if the tool has `annotations.readOnlyHint: true`
    (`isConcurrencySafe(){return Oe.mayOverlap||(L.annotations?.readOnlyHint??!1)}`). 3 × 3 s read-only calls took
    about 3.2 s; without the hint 9 s, one after another (both cases twice).
  - A non-read-only call is a barrier: in "ro, ro, rw, ro" the last read-only call waited for the rw call.
  - `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (documented default 10,
    [env-vars](https://code.claude.com/docs/en/env-vars)) did not cap the streaming path in `-p` mode.
  - Built-in WebFetch and WebSearch are always concurrency-safe; the baseline smoke run saw both start 70 ms apart.
  - Consequence: `search` and `fetch` get `readOnlyHint: true`. `browser` mutates the page, so it stays without the
    hint: Claude Code runs browser calls from one message in order, which is what steering one tab needs, and a
    browser call delays later calls in the same message.
- **Claude Code output limits** ([MCP docs](https://code.claude.com/docs/en/mcp), fetched 2026-10-16): warning above
  10,000 tokens, cut at 25,000 (`MAX_MCP_OUTPUT_TOKENS`), text over 50,000 characters is moved to a file unless the
  tool's `tools/list` entry sets `_meta["anthropic/maxResultSizeChars"]` (ceiling 500,000). Image results always
  count against `MAX_MCP_OUTPUT_TOKENS`.
- **Where a plugin MCP server runs** (claude 2.1.300, [MCP docs](https://code.claude.com/docs/en/mcp.md),
  [plugin components](https://code.claude.com/docs/en/plugins/components.md), 2026-10-16): Claude Code puts
  `CLAUDE_PROJECT_DIR` (the project root, stable) into the server's environment, and a plugin `.mcp.json` can expand
  `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}` in `command`, `args` and `env`. So the
  archive goes to `$CLAUDE_PROJECT_DIR/.web/`. Not confirmed: the process's working directory, whether the server gets
  the session id, and whether one process is shared between sessions. The spec doesn't depend on any of these: a run
  is one server process.
- **This cloud environment's network** allows package registries, GitHub raw, Docker Hub and code.claude.com, and
  refuses arXiv, OpenAlex, Semantic Scholar, Crossref, Wikipedia, MDN, docs.rs and most other sites. The
  paper-lookup skill isn't installed in this session either.

## Prior art

Covered by the approved plan's checks (agent-browser README and npm metadata, SearXNG search API docs, crates.io
records for tantivy 0.26.2, model2vec-rs 0.3.0, dom_smoothie 0.18.2, htmd 0.5.6, pdf_oxide 0.3.78, reqwest 0.13.5,
criterion 0.8.2). Not re-fetched in this flow.

- agent-browser 0.39.1 ships its own MCP server (`agent-browser mcp`, README "MCP Server", fetched 2026-10-16). Not used:
  the spec allows three tools, and screenshots must be archived before Claude sees them, so `browser` wraps the
  CLI instead.

## Evidence

The rows were first written from WebSearch plus arXiv, author or venue pages (paper-lookup wasn't available in the
cloud session). **Resolved through paper-lookup on 2026-10-16** (arXiv `id_list`, OpenAlex, Crossref; abstracts
only): E1 DOI 10.1145/3539618.3591920, E2 arXiv:2104.08663 (NeurIPS 2021 D&B), E3 arXiv:2005.00181 /
DOI 10.1162/tacl_a_00369 (TACL 2021), E4 DOI 10.1145/3596512 (TOIS 2023), E5 DOI 10.1145/1571941.1572114, E6
arXiv:2506.04624 (EMNLP 2025), E7 arXiv:2410.13210, E8 arXiv:2310.04408, E9 arXiv:2307.03172 (TACL 2023), E10
arXiv:2505.21700. Every record now resolves, so each row takes the strength in brackets. The abstracts confirm E4, E8
and E9 and partly confirm E10 (64–128 tokens for short factual sets, 512–1024 for broader ones). Corrections from the
abstracts: E1 adds that "no single extractor performs best on all types of web pages" (it depends on genre); E5's
abstract claims RRF beat every individual system, which is stronger than "3 of 4". The specific numbers in E1, E2, E3,
E5, E6, E7 and E10 come from the papers' bodies and haven't been re-checked against full text.

| #   | claim                                                                          | source                                                                                                    | type       | setting                                | result                                                                            | transfers here?                         | strength  |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- | --------- |
| E1  | Readability-style heuristics are among the most robust main-content extractors | Bevendorff et al., An Empirical Comparison of Web Content Extraction Algorithms, SIGIR 2023 (slides only) | benchmark  | 8 datasets, 3,985 pages, 14 extractors | Readability, Trafilatura, DOM Distiller most robust; neural extractors poor       | partly: older pages, little JS          | Low (Med) |
| E2  | BM25 is a strong zero-shot baseline; dense models often lose to it             | BEIR, arXiv:2104.08663, 2021                                                                              | benchmark  | 18 zero-shot datasets                  | best dense model beats BM25 on 7 of 18                                            | yes: web pages are out of domain        | Low (Med) |
| E3  | Hybrid sparse + dense beats either alone; gain grows with passage length       | Luan et al., Sparse, Dense, and Attentional Representations, arXiv:2005.00181 (TACL 2021)                 | experiment | MS MARCO, TREC DL19, NQ                | over dense +0.004 to +0.025 MRR@10; over BM25 about +13 to +16                    | partly: BERT dense side                 | Low (Med) |
| E4  | Convex score combination beats RRF; RRF is parameter-sensitive                 | Bruch, Gai, Ingber, arXiv:2210.11934, DOI 10.1145/3596512                                                 | experiment | in- and out-of-domain retrieval        | convex > RRF; needs a few labelled queries                                        | partly: no labels for one user          | Low (Med) |
| E5  | RRF (k = 60) beats the best single system; k matters little                    | Cormack, Clarke, Büttcher, SIGIR 2009                                                                     | experiment | TREC 3, 5, 9, Robust04; LETOR 3        | beat best run on 3 of 4 collections (MAP .3394 vs .3165)                          | yes: no training                        | Low (Med) |
| E6  | Static embeddings lose most on retrieval, but are far faster                   | Wada et al., Static Word Embeddings for Sentence Semantic Representation, arXiv:2506.04624, 2025          | preprint   | MTEB; CPU timing                       | retrieval 31–32 vs GTE-base 54.1; Model2Vec 32.1; about 130× faster than GTE-base | yes: same family, CPU                   | Low       |
| E7  | LLM summaries are often unfaithful on hard inputs                              | FaithBench, arXiv:2410.13210                                                                              | benchmark  | 10 LLMs, 660 hard summaries            | hallucinations in 39% (GPT-4o) to 74% of summaries                                | partly: hard samples, not query-focused | Low       |
| E8  | A task-trained compressor shrinks retrieved docs to 6% with little loss        | RECOMP, arXiv:2310.04408 (ICLR 2024)                                                                      | experiment | LM and open-domain QA                  | 6% size, largely faithful; off-the-shelf summarisers much worse                   | partly: trained for the task            | Low (Med) |
| E9  | LLMs use the start and end of their context better than the middle             | Liu et al., Lost in the Middle, arXiv:2307.03172                                                          | experiment | multi-document QA                      | accuracy drops when the relevant passage is mid-context                           | yes: few passages, best first           | Low (Med) |
| E10 | Best chunk size depends on the dataset                                         | Rethinking Chunk Size for Long-Document Retrieval, arXiv:2505.21700, 2025                                 | preprint   | 6 QA datasets, 2 embedders             | 64 tokens best on SQuAD; 512–1024 on NQ, NewsQA, TechQA                           | partly: no BM25                         | Low       |

- **Agrees:** heuristic extraction is the safe choice (E1); hybrid beats BM25 alone widely and dense alone slightly
  (E3); BM25 is hard to beat out of domain (E2); RRF is a good label-free default (E5).
- **Conflicts:** fusion method (E4 vs E5); whether a generic small-model summary loses much (E7 vs E8). No study
  compares a verbatim tool with a summarising fetch tool for an agent, so H1 measures it directly.
- **Gaps:** every hybrid result uses a transformer dense side; whether model2vec adds anything over BM25 is
  untested (hence H4's drop rule). Nothing on JS-rendered pages, PDF extraction, metasearch merging or laptop
  latency.

Sources: [Bevendorff slides](https://downloads.webis.de/publications/slides/bevendorff_2023b.pdf),
[BEIR](https://arxiv.org/pdf/2104.08663), [Luan](https://arxiv.org/pdf/2005.00181),
[Bruch](https://arxiv.org/abs/2210.11934v2), [Cormack](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf),
[Wada](https://arxiv.org/html/2506.04624v2), [FaithBench](https://arxiv.org/pdf/2410.13210),
[RECOMP](https://arxiv.org/abs/2310.04408v1), [Lost in the Middle](https://arxiv.org/abs/2307.03172v3),
[chunk size](https://arxiv.org/html/2505.21700v2).

## Options

The plan settled search (SearXNG, local Docker), browser (agent-browser CLI `--json`) and archive location
(`.web/` in the project). Decisions this flow added, each with my recommendation (taken into the spec, open at
Gate 1):

1. **Fusion:** RRF k = 60 (E5, no labels needed) vs convex combination (E4, needs labelled queries). → RRF.
2. **Passage size:** 256–512 tokens (E3, E10), best first (E9), 8 per call by default. → as stated.
3. **Embeddings kept only if they earn it:** H4's rule drops model2vec when hybrid adds < 2 points recall@5 (E2, E6).
4. **Tool annotations:** `search`/`fetch` read-only so Claude Code runs them in parallel; `browser` not (Grounding).
5. **Large pages:** `fetch` raises `maxResultSizeChars` to 200,000 and returns the start plus the archive path above
   that, instead of letting Claude Code move it to a file.
6. **Retrieval set for H4:** BEIR SciFact and FiQA subsets (public, labelled) vs hand-labelling about 50 archive
   queries. → BEIR, because it needs no labelling work from you; the domain shift is listed as a threat.

## Grill

Rounds 1 and 2, 2026-10-16 (answers by the user; folded into spec.md, which cites them as Q1–Q12):

- **Q1** paper scope (a): `papers: true` searches OpenAlex, arXiv and Crossref and returns one record per paper; citations
  stay with paper-lookup. The first answer "everything yes" was ambiguous; confirmed as (a) in round 2.
- **Q2** `search` ranks over every run in the project; the fetch cache applies only within a run. Yes.
- **Q3** H4 runs first as a bench experiment; model2vec and its download come only if it holds. Yes.
- **Q4** the installer starts SearXNG with Docker (127.0.0.1 only, JSON format on); prints instructions without Docker. Yes.
- **Q5** agent-browser pinned like cswap (`installer/agent-browser.json`, weekly sync). Yes.
- **Q6** `search` fetches the top 5 results, 3 s each, and answers with what has finished. Yes ("3s sound alright").
- **Q7** H5 runs against a stub SearXNG and local pages; the live run is reported but not judged. Yes.
- **Q8** "run" is one server process's archive folder; "session" is used only for agent-browser. Yes.
- **Q9** WebSearch/WebFetch are turned off only if SearXNG passes its health check at install time. Yes.
- **Q10** `fetch` skips the within-run cache for localhost and private-network addresses. Yes.
- **Q11** `images: true`: only images inside the main content, at most 6, 1024 px longest side. Yes.
- **Q12** v1 never deletes from `.web/`; the README says so. Yes.
- Frontier empty after round 2.
- Taken as my call, not objected to: `.web/.gitignore` containing `*`; brv's platforms; a source line marking
  results as untrusted.

## Hypothesis

See [spec.md#hypothesis](spec.md#hypothesis). Proposed thresholds H1–H6, fixed at Gate 1.

## Plan review

**Round 1, 2026-10-16.** Four reviewers (Correctness, Fit, Simpler, Evidence), 38 findings merged into D1–D10 plus
small fixes; none dropped. The user took every recommendation ("all recommended"). ⚠ = reopened Gate 1 for that item.

- **D1 ⚠ H6 method:** identifier lookups pass when the first record carries the asked id; searches count for latency
  only; web-mcp timed over stdio by wall clock like the curl pipelines; arXiv regex fixed for versioned ids.
- **D2 ⚠ H1 metric:** harness reads MCP `content[].text`; `norm` strips markdown link targets; nav loss is a
  threat; early check after fetch (Task 6).
- **D3 H5 driver:** stub pages on 20 loopback addresses so the 4-per-host cap can't bind.
- **D4 Archive integrity:** one fetch in flight per URL; temp file and rename; the deadline covers the download only;
  the browser fallback's page is archived as `rendered.html` and cached.
- **D5 ⚠ Browser sessions:** a fresh session per fallback (`batch` open + get html, then close); `session` required.
- **D6 ⚠ H4 reading:** 0.02 absolute recall@5, plain mean of two datasets, whole documents, FiQA first 300 test
  queries.
- **D7 Index:** writer opened per batch with retry (no RAM index, no RRF merge); `add` returns after commit and
  reload; passages added only in `fetch::get`; duplicates collapsed by hash.
- **D8 Images:** text cut so text plus images stay under 24,000 tokens.
- **D9 Order:** early H1/H2 checkpoint after fetch (Task 6); H4 moved after the browser task.
- **D10 Installer:** `applyBin` takes the config key (`brvPath` vs `binPath`); a real `web-builtins-off` toggle; the
  SearXNG check before settings are written; Windows PATHEXT and `shell: true`; reqwest with `ring`; retry once on
  429/503 with `Retry-After`; release notes and lock check name both crates; reuse `newer` and `BINARIES`.
- **Small fixes:**
  - `Ctx` grows per task; the model folder via `modelDir`; H3 records passage counts.
  - Passage size marked my call, with a BM25 sweep in Task 11.
  - `Accept: text/markdown`; JPEG screenshots.
  - Rate limits as cited (Crossref single records 200 ms; OpenAlex 1 s my call).
  - An all-five-slow test; a README note on rate limits with two sessions.
  - An agent-browser MCP note in Prior art; `index.jsonl` under a mutex.
  - `--max-output 40000` and `--content-boundaries`.
- Shape changed (task order, D7 index design), so the revised plan was re-reviewed.

**Re-review, 2026-10-16.** All decisions present except D7 half-applied (papers abstracts also call `Index::add`;
now stated). Twelve implementation gaps fixed in the plan without a new decision, all within D1–D10: group commit in
the writer task (per-batch commits would have queued H5's 80 adds); `search` waits at most 3 s per page in total and
skips the browser fallback, with the fetch finishing in the background; SearXNG calls skip `HostLimits`; Task 12 after
Task 13; H6 gets a flat 3.1 s untimed gap between rows, exact `query` strings, prefix-aware id classification, ids
from the header line only, and bodies kept for Crossref and S2; `parallel` defined for web-mcp; `type` field name per
spec; screenshots through `Archive::put`; SearXNG steps printed without Docker.

## Deviations

## Results

| run                       | command                                                                                                                                                                                                            | numbers   | date       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------- |
| baseline (cloud, partial) | `node docs/features/web-mcp/bench/baseline.mjs --runs 3`                                                                                                                                                           | see below | 2026-10-16 |
| baseline (your machine)   | `node docs/features/web-mcp/bench/baseline.mjs --runs 3 --out docs/features/web-mcp/bench/results/deadPc-2026-10-16`                                                                                               | see below | 2026-10-16 |
| early fetch (Task 6)      | `node docs/features/web-mcp/bench/baseline.mjs --target web-mcp --bin plugins/web-mcp/server/target/release/web-mcp --only fetch --runs 3 --out docs/features/web-mcp/bench/results/deadPc-2026-10-17-fetch-early` | see below | 2026-10-17 |
| feature                   |                                                                                                                                                                                                                    |           |            |

**Early fetch measurement (Task 6), 2026-10-17** (deadPc, same machine and harness as the baseline, binary at
9f082de; [summary](bench/results/deadPc-2026-10-17-fetch-early/summary.md)). Early, not the verdict.

- **H2:** `fetch` p50 **442 ms**, p95 583 ms, 30/30 ok, against the 1,425 ms target (WebFetch 7,123 ms). Holds by a
  wide margin.
- **H1:** per-URL recall 1, 1, 1, 0.30 (pypi), 0.70 (code.claude.com), 1, 0.95, 0.95, 0.90, 0.50 (arXiv). The
  harness summary's aggregate (p50 over all calls, as for every column) is **0.95**; the plain mean is **0.83**. The
  spec says "≥ 0.9 on the URL set" without naming the aggregate.
- **What the misses are** (sampled sentences not found, checked one by one): pypi 14/20 and arXiv 7/14 are all page
  chrome (file hashes, provenance boilerplate, "unsupported browser", arXivLabs, "View a PDF"), the threat already
  listed. code.claude.com 6/20 includes real body text, likely tabbed or collapsed sections the readability pass
  drops, plus fragments cut at inline code by the metric's tag stripping.
- **The user's decisions, 2026-10-17:** H1 is judged by the harness's own aggregate (median over all calls, as for
  every column), with the mean reported beside it. Tabbed or collapsed doc sections become a tracked follow-up for the
  final review, not a blocker for Task 7.

**Baseline on the user's machine, 2026-10-16** (deadPc, Linux, harness at 8c82945, 3 runs per item; raw numbers in
[bench/results/deadPc-2026-10-16/](bench/results/deadPc-2026-10-16/summary.md)). This is the Gate 1 baseline.

- **WebSearch:** 30/30 ok, p50 **6,888 ms**, p95 8,323 ms; about 9 results, about 2,800 characters of titles and URLs.
  H3 target: web-mcp `search` p50 ≤ 6,888 ms.
- **WebFetch:** 30/30 ok, p50 **7,123 ms**, p95 11,327 ms; about 1,765 characters back for pages of 8,000–121,000.
  Verbatim recall **0** on all 10 URLs; several replies refused outright ("I can't reproduce the full page
  verbatim"). H2 target: web-mcp `fetch` p50 ≤ 1,425 ms (20%). H1 target: recall ≥ 0.9.
- **4 WebFetch calls in one message:** span p50 8,384 ms against 26,771 ms summed.
- **paper-lookup pipelines** (wall clock, curl + script): arxiv id p50 85 ms, arxiv search 76 ms, openalex doi 547 ms,
  openalex search 1,048 ms, crossref doi 452 ms. Identifier found in the first record: arxiv id 3/3, openalex doi
  3/3, crossref doi 3/3.
- **Semantic Scholar row invalid:** HTTP 429 on all 3 runs (no API key), so its 504 ms is a refusal and it found no
  identifier. The harness counted it "ok" because curl exited 0 (deferred harness fix: treat non-2xx as failed).
  H6 for that row compares against nothing; threat recorded.
- **Expected H6 latency miss, noted before any web-mcp number:** papers mode queries two sources per identifier and
  waits for both (plan Task 9), so arXiv-id lookups inherit OpenAlex's ~550 ms against arXiv's 85 ms. Kept for complete
  records (abstracts); H6 isn't among H1, H2, H5.

**Cloud baseline, 2026-10-16** (claude 2.1.301, Linux container behind the egress proxy, 3 runs per item; raw
numbers in [bench/results/cloud-2026-10-16/raw.jsonl](bench/results/cloud-2026-10-16/raw.jsonl)). Not the Gate 1
baseline: half the URLs and every scholarly API are blocked here.

- **WebSearch**, 10 queries × 3: 30/30 ok, p50 **6.8 s**, p95 8.5 s (5.6–12.4 s). Each returns about 9 results of
  title and URL only, about 2,750 characters; no page content.
- **WebFetch**, 5 reachable URLs × 3: 15/15 ok, p50 **5.8 s**, p95 9.4 s. It returned about 1,650 characters for
  pages of 8,000 to 121,000 characters (1–20% of the page), even when asked for the page verbatim. Verbatim-sentence
  recall **0.00** on 14 of 15 calls, 0.05 on one. Sanity check of the metric: page against itself 1.00, against its
  first half 0.55. The 5 other URLs (SearXNG docs, Rust book, MDN, Wikipedia, arXiv) failed: host blocked.
- **4 WebFetch calls in one message:** overlapped. Wall span p50 7.2 s against 22.5 s summed, so parallelism isn't
  what makes WebFetch slow; each call is.
- **paper-lookup pipelines:** 0/6 here, every host refused. Needs your machine.

| query                                       | ok  | p50 ms | max ms |
| ------------------------------------------- | --- | ------ | ------ |
| rmcp rust mcp sdk stdio server example      | 3/3 | 5776   | 7643   |
| tokio spawn vs spawn_blocking when to use   | 3/3 | 7410   | 7855   |
| searxng json api format settings.yml        | 3/3 | 7082   | 12375  |
| readability algorithm main content extr…    | 3/3 | 6835   | 7832   |
| reciprocal rank fusion bm25 dense retrieval | 3/3 | 6370   | 6487   |
| agent-browser vercel snapshot refs          | 3/3 | 7102   | 7145   |
| rust html to markdown crate                 | 3/3 | 6375   | 6487   |
| claude code mcp tool output token limit     | 3/3 | 7040   | 8515   |
| tantivy query parser fuzzy search example   | 3/3 | 7232   | 7512   |
| arxiv api rate limit                        | 3/3 | 6009   | 6084   |

| url (WebFetch)                    | ok  | p50 ms | p95 ms | chars back | page chars | recall |
| --------------------------------- | --- | ------ | ------ | ---------- | ---------- | ------ |
| agent-browser README (raw GitHub) | 3/3 | 5718   | 7590   | 1902       | 103313     | 0      |
| tantivy README (raw GitHub)       | 3/3 | 5326   | 5464   | 1497       | 7950       | 0      |
| rust-sdk README (raw GitHub)      | 3/3 | 5234   | 5789   | 1569       | 68995      | 0      |
| pypi.org/project/requests         | 3/3 | 6288   | 8049   | 1545       | 76317      | 0      |
| code.claude.com/docs/en/mcp       | 3/3 | 9137   | 9387   | 4129       | 121063     | 0      |

Verdict: supported | not supported | inconclusive. Threats that showed up. The user's decision.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
