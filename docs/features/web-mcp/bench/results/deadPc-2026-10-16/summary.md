# Baseline (builtin) 2026-10-16 on deadPc (linux), 3 runs

## search

| q                                                       | ok/n  | p50 ms | p95 ms | results | chars |
| ------------------------------------------------------- | ----- | ------ | ------ | ------- | ----- |
| rmcp rust mcp sdk stdio server example                  | 3/3   | 6891   | 7302   | 9       | 2192  |
| tokio spawn vs spawn_blocking when to use               | 3/3   | 7703   | 9062   | 9       | 3086  |
| searxng json api format settings.yml                    | 3/3   | 6888   | 6948   | 10      | 2938  |
| readability algorithm main content extraction benchmark | 3/3   | 6116   | 7774   | 10      | 2776  |
| reciprocal rank fusion bm25 dense retrieval             | 3/3   | 7017   | 7742   | 9       | 2794  |
| agent-browser vercel snapshot refs                      | 3/3   | 6105   | 7914   | 10      | 2818  |
| rust html to markdown crate                             | 3/3   | 6198   | 6848   | 9       | 2382  |
| claude code mcp tool output token limit                 | 3/3   | 7923   | 8323   | 9       | 2886  |
| tantivy query parser fuzzy search example               | 3/3   | 7389   | 8174   | 9       | 2513  |
| arxiv api rate limit                                    | 3/3   | 5811   | 6411   | 9       | 2613  |
| **all**                                                 | 30/30 | 6888   | 8323   | 9       | 2776  |

## fetch

| url                                                                            | ok/n  | p50 ms | p95 ms | chars | pageChars | recall |
| ------------------------------------------------------------------------------ | ----- | ------ | ------ | ----- | --------- | ------ |
| https://raw.githubusercontent.com/vercel-labs/agent-browser/main/README.md     | 3/3   | 8536   | 10367  | 2218  | 103313    | 0      |
| https://raw.githubusercontent.com/quickwit-oss/tantivy/main/README.md          | 3/3   | 4977   | 5718   | 1344  | 7950      | 0      |
| https://raw.githubusercontent.com/modelcontextprotocol/rust-sdk/main/README.md | 3/3   | 7393   | 7492   | 1931  | 68995     | 0      |
| https://pypi.org/project/requests/                                             | 3/3   | 6202   | 6661   | 1222  | 76317     | 0      |
| https://code.claude.com/docs/en/mcp                                            | 3/3   | 11129  | 11144  | 4579  | 121063    | 0      |
| https://docs.searxng.org/dev/search_api.html                                   | 3/3   | 5382   | 5816   | 1455  | 8100      | 0      |
| https://doc.rust-lang.org/book/ch16-01-threads.html                            | 3/3   | 7508   | 8256   | 2523  | 17322     | 0      |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching               | 3/3   | 11327  | 12050  | 4335  | 65660     | 0      |
| https://en.wikipedia.org/wiki/Okapi_BM25                                       | 3/3   | 6886   | 7133   | 1429  | 22920     | 0      |
| https://arxiv.org/abs/1706.03762                                               | 3/3   | 5129   | 5726   | 1092  | 10546     | 0      |
| **all**                                                                        | 30/30 | 7123   | 11327  | 1765  | 65660     | 0      |

## parallel

| kind     | ok/n | p50 ms | p95 ms | calls | sumMs |
| -------- | ---- | ------ | ------ | ----- | ----- |
| parallel | 3/3  | 8384   | 10462  | 4     | 26771 |
| **all**  | 3/3  | 8384   | 10462  | 4     | 26771 |

## papers

| name                      | ok/n  | p50 ms | p95 ms | outChars |
| ------------------------- | ----- | ------ | ------ | -------- |
| arxiv id                  | 3/3   | 85     | 184    | 2081     |
| arxiv search              | 3/3   | 76     | 322    | 21973    |
| openalex doi + abstract   | 3/3   | 547    | 641    | 1996     |
| openalex search           | 3/3   | 1048   | 1139   | 8432     |
| crossref doi              | 3/3   | 452    | 452    | 13648    |
| semantic scholar arxiv id | 3/3   | 504    | 514    | 175      |
| **all**                   | 18/18 | 452    | 1139   | 8432     |

## papers: asked in ids

| lookup                    | asked               | asked ∈ ids |
| ------------------------- | ------------------- | ----------- |
| arxiv id                  | 1706.03762          | 3/3         |
| openalex doi + abstract   | 10.7717/peerj.4375  | 3/3         |
| crossref doi              | 10.1038/nature12373 | 3/3         |
| semantic scholar arxiv id | 1706.03762          | 0/3         |
