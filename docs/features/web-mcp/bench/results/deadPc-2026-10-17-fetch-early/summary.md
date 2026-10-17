# Baseline (web-mcp) 2026-10-16 on deadPc (linux), 3 runs

## fetch

| url                                                                            | ok/n  | p50 ms | p95 ms | chars  | pageChars | recall |
| ------------------------------------------------------------------------------ | ----- | ------ | ------ | ------ | --------- | ------ |
| https://raw.githubusercontent.com/vercel-labs/agent-browser/main/README.md     | 3/3   | 419    | 538    | 105622 | 103313    | 1      |
| https://raw.githubusercontent.com/quickwit-oss/tantivy/main/README.md          | 3/3   | 404    | 560    | 8249   | 7950      | 1      |
| https://raw.githubusercontent.com/modelcontextprotocol/rust-sdk/main/README.md | 3/3   | 410    | 553    | 69312  | 68995     | 1      |
| https://pypi.org/project/requests/                                             | 3/3   | 435    | 438    | 16317  | 76317     | 0.30   |
| https://code.claude.com/docs/en/mcp                                            | 3/3   | 583    | 617    | 123417 | 121063    | 0.70   |
| https://docs.searxng.org/dev/search_api.html                                   | 3/3   | 414    | 533    | 3012   | 8100      | 1      |
| https://doc.rust-lang.org/book/ch16-01-threads.html                            | 3/3   | 446    | 475    | 14802  | 17322     | 0.95   |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching               | 3/3   | 446    | 527    | 37134  | 65660     | 0.95   |
| https://en.wikipedia.org/wiki/Okapi_BM25                                       | 3/3   | 466    | 577    | 14449  | 22920     | 0.90   |
| https://arxiv.org/abs/1706.03762                                               | 3/3   | 119    | 133    | 2626   | 10546     | 0.50   |
| **all**                                                                        | 30/30 | 442    | 583    | 16317  | 65660     | 0.95   |
