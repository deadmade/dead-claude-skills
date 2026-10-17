# Baseline (web-mcp) 2026-10-17 on deadPc (linux), 3 runs

## search

| q                                                       | ok/n  | p50 ms | p95 ms | passages | chars |
| ------------------------------------------------------- | ----- | ------ | ------ | -------- | ----- |
| rmcp rust mcp sdk stdio server example                  | 3/3   | 2068   | 2171   | 8        | 17797 |
| tokio spawn vs spawn_blocking when to use               | 3/3   | 1579   | 2528   | 8        | 15881 |
| searxng json api format settings.yml                    | 3/3   | 3807   | 4183   | 8        | 14689 |
| readability algorithm main content extraction benchmark | 3/3   | 1522   | 1739   | 8        | 16472 |
| reciprocal rank fusion bm25 dense retrieval             | 3/3   | 2696   | 4319   | 8        | 16565 |
| agent-browser vercel snapshot refs                      | 3/3   | 3904   | 4231   | 8        | 18376 |
| rust html to markdown crate                             | 3/3   | 2247   | 3541   | 8        | 15482 |
| claude code mcp tool output token limit                 | 3/3   | 2009   | 2379   | 8        | 15045 |
| tantivy query parser fuzzy search example               | 3/3   | 2078   | 3308   | 8        | 15558 |
| arxiv api rate limit                                    | 3/3   | 1808   | 1969   | 8        | 16657 |
| **all**                                                 | 30/30 | 2078   | 4231   | 8        | 15881 |

## fetch

| url                                                                            | ok/n  | p50 ms | p95 ms | chars  | pageChars | recall |
| ------------------------------------------------------------------------------ | ----- | ------ | ------ | ------ | --------- | ------ |
| https://raw.githubusercontent.com/vercel-labs/agent-browser/main/README.md     | 3/3   | 413    | 605    | 105622 | 103313    | 1      |
| https://raw.githubusercontent.com/quickwit-oss/tantivy/main/README.md          | 3/3   | 430    | 545    | 8249   | 7950      | 1      |
| https://raw.githubusercontent.com/modelcontextprotocol/rust-sdk/main/README.md | 3/3   | 411    | 535    | 69312  | 68995     | 1      |
| https://pypi.org/project/requests/                                             | 3/3   | 431    | 452    | 16317  | 76317     | 0.30   |
| https://code.claude.com/docs/en/mcp                                            | 3/3   | 617    | 622    | 123417 | 121064    | 0.70   |
| https://docs.searxng.org/dev/search_api.html                                   | 3/3   | 416    | 588    | 3012   | 8100      | 1      |
| https://doc.rust-lang.org/book/ch16-01-threads.html                            | 3/3   | 450    | 479    | 14802  | 17322     | 0.95   |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching               | 3/3   | 463    | 475    | 37134  | 65660     | 0.95   |
| https://en.wikipedia.org/wiki/Okapi_BM25                                       | 3/3   | 487    | 488    | 14449  | 22920     | 0.90   |
| https://arxiv.org/abs/1706.03762                                               | 3/3   | 135    | 152    | 2625   | 10546     | 0.50   |
| **all**                                                                        | 30/30 | 452    | 617    | 16317  | 65660     | 0.95   |

## parallel

| kind     | ok/n | p50 ms | p95 ms | calls | sumMs |
| -------- | ---- | ------ | ------ | ----- | ----- |
| parallel | 3/3  | 1683   | 1757   | 4     | 1330  |
| **all**  | 3/3  | 1683   | 1757   | 4     | 1330  |

## papers

| name                      | ok/n  | p50 ms | p95 ms | outChars |
| ------------------------- | ----- | ------ | ------ | -------- |
| arxiv id                  | 3/3   | 374    | 935    | 1386     |
| arxiv search              | 3/3   | 20003  | 20054  | 5560     |
| openalex doi + abstract   | 3/3   | 408    | 482    | 1928     |
| openalex search           | 3/3   | 20004  | 20052  | 3231     |
| crossref doi              | 3/3   | 311    | 481    | 277      |
| semantic scholar arxiv id | 3/3   | 159    | 359    | 1386     |
| **all**                   | 18/18 | 481    | 20054  | 1928     |

## papers: asked in ids

| lookup                    | asked               | asked ∈ ids |
| ------------------------- | ------------------- | ----------- |
| arxiv id                  | 1706.03762          | 3/3         |
| openalex doi + abstract   | 10.7717/peerj.4375  | 3/3         |
| crossref doi              | 10.1038/nature12373 | 3/3         |
| semantic scholar arxiv id | 1706.03762          | 3/3         |
