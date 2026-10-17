//! `search` with `papers: true` against stub `OpenAlex`, arXiv and Crossref servers. No `SearXNG` runs.
mod common;

use common::{Fixture, Mcp, PUBLIC, Resp, is_error, searx, tempdir, text};
use serde_json::json;
use url::Url;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/papers/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn ok(ct: &str, name: &str) -> Vec<Resp> {
    vec![Resp::new(200, ct, fixture(name))]
}

/// `path` with `pairs` as the query string, spelled the way the server builds it.
fn with_query(path: &str, pairs: &[(&str, &str)]) -> String {
    let mut u = Url::parse("http://x").unwrap();
    u.set_path(path);
    u.query_pairs_mut().extend_pairs(pairs);
    format!("{}?{}", u.path(), u.query().unwrap())
}

fn start(fx: &Fixture) -> Mcp {
    Mcp::start_with(
        tempdir(),
        &[
            ("WEB_MCP_ARXIV_URL", fx.url("/arxiv")),
            ("WEB_MCP_OPENALEX_URL", fx.url("/openalex")),
            ("WEB_MCP_CROSSREF_URL", fx.url("/crossref")),
        ],
    )
}

fn papers(mcp: &mut Mcp, q: &str) -> serde_json::Value {
    mcp.call("search", json!({ "query": q, "papers": true }))
}

#[cfg(debug_assertions)]
#[test]
fn doi_query_merges_crossref_and_openalex() {
    let fx = Fixture::start(PUBLIC);
    fx.route(
        "/crossref/10.7717%2Fpeerj.4375",
        ok("application/json", "crossref-doi.json"),
    );
    fx.route(
        "/openalex/doi:10.7717/peerj.4375",
        ok("application/json", "openalex-doi.json"),
    );
    let mut mcp = start(&fx); // SearXNG is not running: papers mode doesn't need it
    let r = papers(&mut mcp, "doi:10.7717/peerj.4375");
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.starts_with("Source: Crossref + OpenAlex (searched "),
        "{t}"
    );
    assert!(
        t.contains(
            "## [1] The state of OA: a large-scale analysis (2018)\nDOI 10.7717/peerj.4375 · https://peerj.com/articles/4375.pdf\n\nDespite growing interest in Open Access (OA)."
        ),
        "{t}"
    );
    assert!(!t.contains("## [2]"), "{t}");
    assert!(!t.contains("Failed:"), "{t}");
}

#[cfg(debug_assertions)]
#[test]
fn one_source_failing_keeps_others_and_abstracts_are_archived() {
    let fx = Fixture::start(PUBLIC);
    fx.route(
        &with_query("/openalex", &[("search", "attention"), ("per_page", "5")]),
        ok("application/json", "openalex-search.json"),
    );
    fx.route(
        &with_query(
            "/arxiv",
            &[("search_query", "all:\"attention\""), ("max_results", "5")],
        ),
        ok("application/atom+xml", "arxiv-error.xml"),
    );
    searx(&fx, "transformers", &[]);
    let mut mcp = Mcp::start_with(
        tempdir(),
        &[
            ("WEB_MCP_ARXIV_URL", fx.url("/arxiv")),
            ("WEB_MCP_OPENALEX_URL", fx.url("/openalex")),
            ("WEB_MCP_SEARXNG_URL", fx.url("")),
        ],
    );
    let r = papers(&mut mcp, "attention");
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.contains("## [1] Attention Is All You Need (2017)\nDOI 10.48550/arxiv.1706.03762 · arXiv 1706.03762 · https://arxiv.org/pdf/1706.03762\n\nTransformers use attention"),
        "{t}"
    );
    assert!(t.contains("## [2] A paper without abstract\n"), "{t}");
    assert!(
        t.contains("Failed: arXiv: incorrect id format for bogus"),
        "{t}"
    );
    // The abstract was indexed: a web search finds it with no page fetched.
    let r = mcp.call("search", json!({ "query": "transformers" }));
    assert!(text(&r).contains("Transformers use attention"), "{r}");
}

#[cfg(debug_assertions)]
#[test]
fn arxiv_id_asks_arxiv_and_openalex_and_lists_that_paper_first() {
    let fx = Fixture::start(PUBLIC);
    fx.route(
        &with_query("/arxiv", &[("id_list", "2005.14165")]),
        ok("application/atom+xml", "arxiv-ok.xml"),
    );
    fx.route(
        "/openalex/arxiv:2005.14165",
        vec![Resp::new(404, "application/json", "{}")],
    );
    let mut mcp = start(&fx);
    let r = papers(&mut mcp, "arXiv:2005.14165v4");
    let t = text(&r);
    let first = t.find("## [1] Language Models").expect(t);
    assert!(first < t.find("Attention Is All You Need").unwrap(), "{t}");
    assert!(
        t.contains("DOI 10.1000/GPT3 · arXiv 2005.14165 · http://arxiv.org/abs/2005.14165v4"),
        "{t}"
    );
    assert!(t.contains("Failed: OpenAlex: HTTP 404"), "{t}");
}

#[cfg(debug_assertions)]
#[test]
fn a_429_is_retried_once_after_retry_after() {
    let fx = Fixture::start(PUBLIC);
    fx.route(
        "/crossref/10.7717%2Fpeerj.4375",
        vec![
            Resp::new(429, "text/plain", "slow down").header("Retry-After", "0"),
            Resp::new(200, "application/json", fixture("crossref-doi.json")),
        ],
    );
    fx.route(
        "/openalex/doi:10.7717/peerj.4375",
        vec![Resp::new(500, "text/plain", "")],
    );
    let mut mcp = start(&fx);
    let t = papers(&mut mcp, "10.7717/peerj.4375");
    let t = text(&t);
    assert!(t.contains("## [1] The state of OA"), "{t}");
    assert!(t.contains("Failed: OpenAlex: HTTP 500"), "{t}");
    assert_eq!(fx.hits("/crossref/10.7717%2Fpeerj.4375"), 2);
}

#[cfg(debug_assertions)]
#[test]
fn nothing_found_is_an_error_listing_the_failures() {
    let fx = Fixture::start(PUBLIC);
    fx.route(
        "/arxiv?id_list=1706.03762",
        vec![Resp::new(200, "text/plain", fixture("arxiv-throttled.txt"))],
    );
    let mut mcp = start(&fx);
    let r = papers(&mut mcp, "1706.03762");
    assert!(is_error(&r), "{r}");
    assert!(text(&r).contains("Failed: arXiv: throttled"), "{r}");
}
