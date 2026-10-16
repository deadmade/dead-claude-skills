# web-mcp: spec

Status: draft for Gate 1. Written from the approved plan
([Web MCP server: validated plan](https://claude.ai/code/artifact/5fc18b2f-8c6f-4cc4-ac46-dca899c2b7c9), approved
2026-10-16 "plan lgtm"), the grounding and the measurements in [flow.md](flow.md). Choices marked _(my call)_ were
not in the plan; the grill in flow.md lists each with its reason.

## Intent

Claude's built-in web access hands Claude a small model's summary of a page and a list of titles and URLs for a
search. The user wants Claude to get the actual content, see images when they matter, drive a browser for sites the
user is building, and keep a copy of everything it pulled. It should be one fast Rust MCP server that also replaces
the paper-lookup Python scripts research-flow depends on. Claude only sends requests; the server searches, fetches,
ranks and archives.

## Goals

1. **One stdio MCP server in Rust** (`rmcp`, tokio, reqwest with rustls), shipped as the plugin `plugins/web-mcp`
   with its binary built and downloaded like brv (`installer/core.mjs:304-321`, `build-brv.yml`, `release.yml`).
2. **Three tools**, no more:
   - `search { query, papers?: bool = false, max_passages?: int = 8 }`. Every call searches the archive and the web
     together and returns ranked passages word for word, each with its URL, title and archive path. Web results come
     from a self-hosted SearXNG (JSON API). The server fetches the top results, extracts them, splits them into
     passages, ranks them and archives everything before answering. `papers: true` queries the scholarly APIs
     paper-lookup covers instead of SearXNG and returns DOI or arXiv ids with every passage.
   - `fetch { url, images?: bool = false }`. The whole page as markdown (main content, readability-style), archived
     first. With `images`, the page's content images come back as MCP image blocks, downscaled. PDFs are converted
     to text. A page whose extracted text comes back near empty is re-fetched through the browser.
   - `browser { action, session?, url?, ref?, text?, key?, js? }`. Drives agent-browser through its documented
     `--json` CLI: `open`, `snapshot` (accessibility tree with `@eN` refs), `click`, `fill`, `type`, `press`,
     `scroll`, `screenshot`, `console`, `network`, `eval`, `close`. Screenshots return as images and are archived.
     Each `session` is its own agent-browser session, so two callers never steer the same tab.
3. **Archive before answer.** Everything pulled is written to `.web/<date>_<session>/` in the project (ignored by git)
   before Claude sees it: `index.jsonl` (url, query, time, type, sha256, path), `searches/`, `pages/<slug>/`
   (`raw.html`, `page.md`, `images/`), `pdfs/`, `screenshots/`. The archive doubles as a cache for the session.
4. **Ranking on the server.** tantivy (BM25) over the archive, fused with model2vec static embeddings by reciprocal
   rank fusion (k = 60) _(my call, E5)_. Passages are about 256 to 512 tokens _(my call, E3, E10)_, best first
   (E9). The embeddings stay only if the measurement shows they add recall (Hypothesis H4).
5. **Parallel by construction.** Two calls never wait for each other: rmcp already runs each request in its own task
   (checked, flow.md Grounding); handlers stay async and put CPU work (extraction, embedding, PDF) on
   `spawn_blocking`; one archive index writer fed by a channel; per-host rate limits; per-caller browser sessions.
   `search` and `fetch` are annotated `readOnlyHint: true` so Claude Code runs them concurrently (see flow.md).
6. **Output sizes fit Claude Code.** Claude Code warns above 10,000 tokens of MCP output, cuts at 25,000
   (`MAX_MCP_OUTPUT_TOKENS`) and moves text results over 50,000 characters to a file unless the tool sets
   `_meta["anthropic/maxResultSizeChars"]` (up to 500,000) ([MCP docs](https://code.claude.com/docs/en/mcp), "MCP
   output limits and warnings"). `search` stays under 10,000 tokens by default. `fetch` sets
   `maxResultSizeChars` to 200,000 _(my call)_ and, for longer pages, returns the start plus the archive path to
   read the rest.
7. **research-flow switches over.** Its literature step uses `search` with `papers: true` instead of paper-lookup.
   paper-lookup itself stays vendored and untouched.
8. **Built-in tools off on request.** An installer option, on by default with web-mcp, denies `WebFetch` and
   `WebSearch` (a bare deny removes them from context, per the plan's verified facts).
9. **Benchmarks.** criterion micro-benchmarks for extraction, chunking and ranking, plus `bench/baseline.mjs` rerun
   against the server for the Hypothesis.

## Non-goals

- No paid or key-only search APIs, no Google scraping. SearXNG is the only web backend; it sits behind a trait so
  another can be added later.
- No LLM inside the server, no summaries.
- No custom CDP layer; agent-browser does the browser.
- No shared or remote SearXNG yet (local Docker per machine; its URL is config).

## Hypothesis

- **Claim:** with web-mcp, Claude gets page content word for word instead of a summary, faster than the built-in
  tools, and parallel calls don't queue:
  - **H1 fidelity:** `fetch` verbatim-sentence recall ≥ 0.9 on the URL set, against the WebFetch baseline.
  - **H2 fetch latency:** `fetch` p50 tool latency ≤ 20% of WebFetch's p50 on the same URLs.
  - **H3 search latency:** `search` p50 ≤ WebSearch p50 on the query set, while returning passages instead of
    titles and URLs.
  - **H4 ranking:** hybrid recall@5 beats BM25 alone by ≥ 2 points on the retrieval set; otherwise the embeddings are
    dropped (E2, E3, E6).
  - **H5 parallel:** p95 of 16 simultaneous `search` calls ≤ 1.5× the p95 of one call (same queries, warm SearXNG).
  - **H6 papers:** each paper lookup in `inputs.json` returns the same identifiers as the paper-lookup pipeline, with
    p50 latency no higher.
- **Evidence:** E1 (heuristic extraction is robust), E2, E3, E5, E6 (hybrid and fusion; static embeddings are weak,
  hence H4's drop rule), E7 against E8 (summaries can lose content), E9 (best first). Measured baseline in flow.md
  Results.
- **Metric and method:** `node docs/features/web-mcp/bench/baseline.mjs --runs 3` on the fixed `inputs.json`.
  Latency is PreToolUse→PostToolUse hook time, so model time is excluded. Recall is the share of up to 20 evenly
  spread 60–300-character sentences of the raw page found verbatim in the tool result. H4 uses a labelled retrieval
  set (BEIR SciFact and FiQA subsets _(my call)_), H5 a concurrency driver like the rmcp spike.
- **Baseline:** before any server code, on the user's machine, with the same script. A first run in the cloud
  container is in flow.md (see threats).
- **Threshold:** each of H1 to H6 is judged on its own; the feature counts as supported when H1, H2 and H5 hold.
  Noise band: WebFetch latency varies by its summarising model, so three runs per item and p50.
- **Threats to validity:** the cloud container blocks most hosts, so only the user's machine gives a fair baseline;
  SearXNG's speed depends on its upstream engines and their rate limits; the recall metric strips HTML crudely, so
  navigation text counts against both sides equally; the BEIR sets are not web pages (E1, E2 note domain shift);
  WebFetch's own cache (if any) between runs.
