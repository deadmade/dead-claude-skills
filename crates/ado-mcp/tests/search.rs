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
const CODE: &str = "/tfs/Coll/_apis/search/codesearchresults";
const WIKI: &str = "/tfs/Coll/_apis/search/wikisearchresults";
const REPO: &str = "/tfs/Coll/My%20Proj/_apis/git/repositories/R";
const PROJ_CODE: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/search/codesearchresults";
const PROJ_WIKI: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/search/wikisearchresults";
/// The repo's index status, by the ids of `repo.json`.
const STATUS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/search/status/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";

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

/// An infoCode the server doesn't document for us, with no results, is named above `0 hits`: the empty answer may be
/// its doing.
#[test]
fn unknown_info_code_no_hits() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(10, &[])]);
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "x"}));
    assert_eq!(text, "the server answered with info code 10\n0 hits");
}

/// With results, an unknown infoCode says nothing.
#[test]
fn unknown_info_code_with_hits() {
    let fx = Fixture::start();
    fx.route(WIS, vec![answer(10, &[hit(1, "a")])]);
    let text = ok(&mut env(&fx), "search", json!({"kind": "wi", "text": "a"}));
    assert_eq!(text, "1 hit\n#1 [Task] New  a");
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
    for (kind, path) in [("wi", WIS), ("code", CODE), ("wiki", WIKI)] {
        let fx = Fixture::start();
        fx.route(path, vec![Resp::new(404, "text/plain", "not found")]);
        let (err, text) = env(&fx).call("search", json!({"kind": kind, "text": "x"}));
        assert!(err, "{kind}: {text}");
        assert_eq!(text, NOT_INSTALLED, "{kind}");
    }
}

#[test]
fn project_404() {
    for (kind, path) in [("wi", PROJ_WIS), ("code", PROJ_CODE), ("wiki", PROJ_WIKI)] {
        let fx = Fixture::start();
        fx.route(PROJECT, vec![project()]);
        fx.route(path, vec![Resp::new(404, "text/plain", "not found")]);
        let (err, text) = env(&fx).call(
            "search",
            json!({"kind": kind, "text": "x", "project": "My Proj"}),
        );
        assert!(err, "{kind}: {text}");
        assert_eq!(
            text, "not found: project My Proj, or Search isn't installed on this collection",
            "{kind}"
        );
        assert!(!text.contains(PROJ), "{text}");
    }
}

/// In a clone with `repo` and no `project`, the repo is looked up in the clone's project: a 404 may be a stale cached
/// id as much as a missing Search.
#[test]
fn clone_repo_404() {
    let fx = Fixture::start();
    fx.route(
        &format!("/tfs/Coll/{PROJ}/_apis/git/repositories/R"),
        vec![fixture("repo.json")],
    );
    fx.route(PROJ_CODE, vec![Resp::new(404, "text/plain", "not found")]);
    let (err, text) = env(&fx).call("search", json!({"kind": "code", "text": "x", "repo": "R"}));
    assert!(err, "{text}");
    assert_eq!(
        text,
        "not found: repo R, or Search isn't installed on this collection"
    );
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

#[test]
fn code_hits() {
    let fx = Fixture::start();
    fx.route(CODE, vec![fixture("search-code.json")]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "code", "text": "Order"}),
    );
    assert_eq!(
        text,
        "2 hits\nShop/Orders:/src/OrderParser.cs  (3 matches)\nShop/Orders:/tests/OrderTests.cs  (1 match)"
    );
    // Collection-wide even inside a clone: the search is the only request.
    assert_eq!(fx.requests().len(), 1);
    let body = &bodies(&fx, CODE)[0];
    assert_eq!(body["searchText"], "Order");
    assert_eq!(body["$top"], 21);
    assert!(body.get("filters").is_none(), "{body}");
}

/// Review Focus 3: the path takes the project id, the filters the names as given.
#[test]
fn code_repo_filter() {
    let fx = Fixture::start();
    fx.route(REPO, vec![fixture("repo.json")]);
    fx.route(PROJ_CODE, vec![fixture("search-code.json")]);
    ok(
        &mut env(&fx),
        "search",
        json!({"kind": "code", "text": "Order", "project": "My Proj", "repo": "R"}),
    );
    let bodies = bodies(&fx, PROJ_CODE);
    assert_eq!(bodies.len(), 1);
    assert_eq!(
        bodies[0]["filters"],
        json!({"Project": ["My Proj"], "Repository": ["R"]})
    );
    // Hits: no status request.
    assert!(requests(&fx, STATUS).is_empty());
}

/// Review Focus 1: a quoted phrase and the scope repeat exactly in the more line.
#[test]
fn code_more_repeats_scope() {
    let fx = Fixture::start();
    fx.route(REPO, vec![fixture("repo.json")]);
    fx.route(PROJ_CODE, vec![fixture("search-code.json")]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "code", "text": "path:\"a b\"", "project": "My Proj", "repo": "R", "limit": 1}),
    );
    assert!(!text.contains("OrderTests"), "{text}");
    assert!(
        text.ends_with(
            "\n… more: search kind=code text=\"path:\\\"a b\\\"\" project=\"My Proj\" repo=R limit=2"
        ),
        "{text}"
    );
}

fn code_in_repo(fx: &Fixture, status: Resp) -> String {
    fx.route(REPO, vec![fixture("repo.json")]);
    fx.route(PROJ_CODE, vec![answer(0, &[])]);
    fx.route(STATUS, vec![status]);
    ok(
        &mut env(fx),
        "search",
        json!({"kind": "code", "text": "x", "project": "My Proj", "repo": "R"}),
    )
}

#[test]
fn code_repo_not_indexed() {
    let fx = Fixture::start();
    let text = code_in_repo(&fx, fixture("search-repo-status.json"));
    assert_eq!(text, "0 hits\nR isn't indexed by Search yet");
    assert_eq!(requests(&fx, STATUS).len(), 1);
}

#[test]
fn code_repo_status_404() {
    let fx = Fixture::start();
    let text = code_in_repo(&fx, Resp::new(404, "text/plain", "not found"));
    assert_eq!(text, "0 hits\nR isn't indexed by Search yet");
}

/// An indexed branch, or a status call that fails otherwise, adds nothing.
#[test]
fn code_repo_indexed_or_unknown() {
    let indexed =
        Resp::json(&json!({"id": "x", "name": "R", "indexedBranches": [{"name": "main"}]}));
    for status in [indexed, Resp::new(500, "text/plain", "boom")] {
        let fx = Fixture::start();
        assert_eq!(code_in_repo(&fx, status), "0 hits");
    }
}

#[test]
fn repo_needs_code() {
    for kind in ["wi", "wiki"] {
        let fx = Fixture::start();
        let (err, text) = env(&fx).call("search", json!({"kind": kind, "text": "x", "repo": "R"}));
        assert!(err, "{kind}: {text}");
        assert_eq!(text, "repo narrows code search only", "{kind}");
        assert!(fx.requests().is_empty(), "{kind}");
    }
}

#[test]
fn wiki_hits() {
    let fx = Fixture::start();
    fx.route(PROJECT, vec![project()]);
    fx.route(PROJ_WIKI, vec![fixture("search-wiki.json")]);
    let text = ok(
        &mut env(&fx),
        "search",
        json!({"kind": "wiki", "text": "deploy", "project": "My Proj"}),
    );
    // The content hit, not the file-name hit; a page without a content hit (file name, title) gets no snippet. A code
    // wiki's page path leaves out the folder it is published from.
    assert_eq!(
        text,
        "3 hits\nShop/Shop.wiki:/Runbooks/Deploy\n  Run the deploy job & watch the gates\nShop/Shop.wiki:/Runbooks/Deploy Checklist\nShop/Docs:/Runbooks/Rollback\n  Roll back the deploy first"
    );
    let body = &bodies(&fx, PROJ_WIKI)[0];
    assert_eq!(body["filters"], json!({"Project": ["My Proj"]}));
    assert_eq!(body["$top"], 21);
}

/// The `Repository` filter takes the value as given: an id finds nothing, so the schema asks for a name.
#[test]
fn repo_arg_is_a_name() {
    let fx = Fixture::start();
    let tools = ado(&fx, &[]).request("tools/list", json!({}))["tools"].take();
    let search = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "search")
        .unwrap();
    assert_eq!(
        search["inputSchema"]["properties"]["repo"]["description"],
        "Repo name, for code; needs project or a clone of it."
    );
}
