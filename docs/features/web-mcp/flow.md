---
flow: research
phase: grill
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
- Plan:
- Baseline harness: [bench/baseline.mjs](bench/baseline.mjs), inputs [bench/inputs.json](bench/inputs.json)
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec and hypothesis approved:
- Gate 2, plan approved:

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
- **This cloud environment's network** allows package registries, GitHub raw, Docker Hub and code.claude.com, and
  refuses arXiv, OpenAlex, Semantic Scholar, Crossref, Wikipedia, MDN, docs.rs and most other sites. The
  paper-lookup skill isn't installed in this session either.

## Prior art

Covered by the approved plan's checks (agent-browser README and npm metadata, SearXNG search API docs, crates.io
records for tantivy 0.26.2, model2vec-rs 0.3.0, dom_smoothie 0.18.2, htmd 0.5.6, pdf_oxide 0.3.78, reqwest 0.13.5,
criterion 0.8.2). Not re-fetched in this flow.

## Evidence

All rows have **weak provenance**: paper-lookup wasn't available and the scholarly APIs were blocked, so the rows
come from WebSearch plus the arXiv, author or venue pages. By research-flow's rule every strength is therefore Low;
the bracket gives the strength with a resolved record.

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

## Hypothesis

See [spec.md#hypothesis](spec.md#hypothesis). Proposed thresholds H1–H6, fixed at Gate 1.

## Plan review

## Deviations

## Results

| run                       | command                                                  | numbers   | date       |
| ------------------------- | -------------------------------------------------------- | --------- | ---------- |
| baseline (cloud, partial) | `node docs/features/web-mcp/bench/baseline.mjs --runs 3` | see below | 2026-10-16 |
| baseline (your machine)   | same                                                     |           |            |
| feature                   |                                                          |           |            |

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
