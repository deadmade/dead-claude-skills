mod common;

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
/// No project: the whole collection.
const WIS: &str = "/tfs/Coll/_apis/search/workitemsearchresults";
const PROJECT: &str = "/tfs/Coll/_apis/projects/My%20Proj";
const PROJ_WIS: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/search/workitemsearchresults";
const NOT_INSTALLED: &str = "Search isn't installed or is turned off on this collection";

/// Inside a clone, so the tests also show that search stays collection-wide there.
fn env(fx: &Fixture) -> Mcp {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    let clone = clone_of(&own_remote(fx));
    ado(fx, &[("ADO_PROJECT_DIR", clone.to_str().unwrap())])
}

fn ok(mcp: &mut Mcp, tool: &str, args: Value) -> String {
    let (err, text) = mcp.call(tool, args);
    assert!(!err, "{text}");
    text
}

fn requests(fx: &Fixture, path: &str) -> Vec<common::Req> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(path))
        .collect()
}

fn bodies(fx: &Fixture, path: &str) -> Vec<Value> {
    requests(fx, path)
        .iter()
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect()
}

fn project() -> Resp {
    Resp::json(
        &json!({"id": PROJ, "name": "My Proj", "state": "wellFormed", "revision": 7,
        "visibility": "private", "lastUpdateTime": "2025-11-04T10:12:33.47Z"}),
    )
}

/// One result as the Server 7.1 sample shapes it: lower-case field names, string values.
fn hit(id: u32, title: &str) -> Value {
    json!({
        "project": {"name": "My Proj", "id": PROJ},
        "fields": {"system.id": id.to_string(), "system.workitemtype": "Task",
                   "system.title": title, "system.state": "New"},
        "hits": [{"fieldReferenceName": "system.title", "highlights": [title]}],
        "url": format!("https://ado.example/_apis/wit/workItems/{id}")
    })
}

fn answer(info_code: i32, results: &[Value]) -> Resp {
    Resp::json(&json!({"count": results.len(), "results": results, "infoCode": info_code}))
}

#[test]
fn wi_hits_one_line_each() {
    let fx = Fixture::start();
    fx.route(WIS, vec![fixture("search-wi.json")]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "wi", "text": "login"}),
    );
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "3 hits", "{text}");
    assert_eq!(lines[1], "#101 [Bug] Active  Login fails", "{text}");
    assert_eq!(lines[2], "  fix login <T>", "{text}");
    // #102's only hit is its title, which its line shows already: no snippet line.
    assert_eq!(lines[3], "#102 [Task] New  Add a login test", "{text}");
    assert_eq!(
        lines[4], "#103 [User Story] Closed  Single sign-on",
        "{text}"
    );
    assert_eq!(lines[5], "  login; sso", "{text}");
    assert_eq!(lines.len(), 6, "{text}");
    for leak in ["highlighthit", "http", "url", PROJ] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    // Collection-wide even inside a clone: the search is the only request.
    assert_eq!(fx.requests().len(), 1);
    let body = &bodies(&fx, WIS)[0];
    assert_eq!(body["searchText"], "login");
    assert_eq!(body["$top"], 21);
    assert_eq!(body["includeFacets"], false);
    assert!(body.get("filters").is_none(), "{body}");
}

#[test]
fn wi_project_filter() {
    let fx = Fixture::start();
    fx.route(PROJECT, vec![project()]);
    fx.route(PROJ_WIS, vec![fixture("search-wi.json")]);
    ok(
        &mut env(&fx),
        "search",
        json!({"kind": "wi", "text": "login", "project": "My Proj"}),
    );
    let bodies = bodies(&fx, PROJ_WIS);
    assert_eq!(bodies.len(), 1);
    let body = &bodies[0];
    assert_eq!(body["filters"]["System.TeamProject"], json!(["My Proj"]));
    assert_eq!(body["searchText"], "login");
    assert_eq!(body["$top"], 21);
}

#[test]
fn limit_and_more_quotes() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(0, &[hit(1, "a"), hit(2, "b")])]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "wi", "text": "path:\"a b\"", "limit": 1}),
    );
    assert!(text.contains("#1 [Task] New  a"), "{text}");
    assert!(!text.contains("#2 "), "{text}");
    assert!(
        text.ends_with("\n… more: search kind=wi text=\"path:\\\"a b\\\"\" limit=2"),
        "{text}"
    );
    assert_eq!(bodies(&fx, WIS)[0]["$top"], 2);
}

/// An answer without `count` counts its results.
#[test]
fn missing_count_counts_results() {
    let fx = Fixture::start();
    let results = [hit(1, "a"), hit(2, "b")];
    fx.route(
        WIS,
        vec![Resp::json(&json!({"results": results, "infoCode": 0}))],
    );
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "x"}));
    assert_eq!(text.lines().next(), Some("2 hits"), "{text}");
}

#[test]
fn info_code_line() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(2, &[])]);
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "x"}));
    // No results: the line alone, no `0 hits` under it.
    assert_eq!(text, "search indexing hasn't started on this collection");
}

#[test]
fn no_hits() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(0, &[])]);
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "x"}));
    assert_eq!(text, "0 hits");
}

/// Review Focus 7: a rejected query answers 200 with no results; the reply says it was rejected.
#[test]
fn query_rejected() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(4, &[])]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "wi", "text": "*Parser"}),
    );
    assert_eq!(
        text.lines().next(),
        Some("the server rejected the query: prefix wildcard not supported"),
        "{text}"
    );
    assert!(!text.contains("0 hits"), "{text}");
}

#[test]
fn trimmed() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(8, &[hit(1, "a")])]);
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "a"}));
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines[..3],
        [
            "the server trimmed the results to its maximum",
            "1 hit",
            "#1 [Task] New  a"
        ],
        "{text}"
    );
}

#[test]
fn not_installed() {
    let fx = Fixture::start();
    fx.route(WIS, vec![Resp::new(404, "text/plain", "not found")]);
    let (err, text) = env(&fx).call("search", json!({"kind": "wi", "text": "x"}));
    assert!(err, "{text}");
    assert_eq!(text, NOT_INSTALLED);
}

#[test]
fn project_404() {
    let fx = Fixture::start();
    fx.route(PROJECT, vec![project()]);
    fx.route(PROJ_WIS, vec![Resp::new(404, "text/plain", "not found")]);
    let (err, text) = env(&fx).call(
        "search",
        json!({"kind": "wi", "text": "x", "project": "My Proj"}),
    );
    assert!(err, "{text}");
    assert_eq!(
        text,
        "not found: project My Proj, or Search isn't installed on this collection"
    );
    assert!(!text.contains(PROJ), "{text}");
}

/// rmcp answers bad arguments with a tool error, not a JSON-RPC one; nothing is sent.
#[test]
fn kind_required() {
    let fx = Fixture::start();
    let (err, text) = env(&fx).call("search", json!({"text": "x"}));
    assert!(err, "{text}");
    assert!(text.contains("missing field `kind`"), "{text}");
    assert!(fx.requests().is_empty());
}
