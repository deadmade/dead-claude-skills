mod common;

use common::{Fixture, Mcp, Resp, ado, fixture};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const PROJECT: &str = "/tfs/Coll/_apis/projects/My%20Proj";
/// The project wiki of `wikis-one.json` and `wikis.json`.
const WIKI_ID: &str = "7d1e5c3a-2b4f-4a69-8e0d-91c6f2a4b375";
/// By the project's id, as paths take it.
const WIKIS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wiki/wikis";
const PAGES: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wiki/wikis/7d1e5c3a-2b4f-4a69-8e0d-91c6f2a4b375/pages";
/// The code wiki `Docs` in `wikis.json`.
const DOCS_PAGES: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wiki/wikis/c84f0b2e-6a1d-4f73-b5e9-3d2a7c1f8e60/pages";

fn project() -> Resp {
    Resp::json(
        &json!({"id": PROJ, "name": "My Proj", "state": "wellFormed", "revision": 7,
        "visibility": "private", "lastUpdateTime": "2025-11-04T10:12:33.47Z"}),
    )
}

/// A server for `My Proj`, whose wikis are `wikis`.
fn env(fx: &Fixture, wikis: Resp) -> Mcp {
    fx.route(PROJECT, vec![project()]);
    fx.route(WIKIS, vec![wikis]);
    ado(fx, &[])
}

/// `wiki project="My Proj"` with `extra` on top.
fn call(mcp: &mut Mcp, extra: Value) -> (bool, String) {
    let mut args = json!({"project": "My Proj"});
    if let Value::Object(extra) = extra {
        args.as_object_mut().unwrap().extend(extra);
    }
    mcp.call("wiki", args)
}

/// The decoded query pairs of each request to `path`.
fn queries(fx: &Fixture, path: &str) -> Vec<Vec<(String, String)>> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(path))
        .map(|r| {
            let q = r.path.split_once('?').map_or("", |(_, q)| q);
            url::form_urlencoded::parse(q.as_bytes())
                .into_owned()
                .collect()
        })
        .collect()
}

fn values<'a>(q: &'a [(String, String)], k: &str) -> Vec<&'a str> {
    q.iter()
        .filter(|(n, _)| n == k)
        .map(|(_, v)| v.as_str())
        .collect()
}

/// A wiki root whose pages are `pages`, each without subpages.
fn root(pages: &[String]) -> Resp {
    let subs: Vec<Value> = pages
        .iter()
        .enumerate()
        .map(|(i, p)| json!({"path": p, "order": i, "gitItemPath": format!("{p}.md"), "subPages": []}))
        .collect();
    Resp::json(
        &json!({"path": "/", "order": 0, "isParentPage": true, "gitItemPath": "/", "subPages": subs}),
    )
}

/// Review Focus 3: `My Proj` is resolved to its id for the paths.
#[test]
fn page_text() {
    let fx = Fixture::start();
    fx.route(PAGES, vec![fixture("wiki-page.json")]);
    let mut mcp = env(&fx, fixture("wikis-one.json"));
    let (err, text) = call(&mut mcp, json!({"path": "/Getting Started"}));
    assert!(!err, "{text}");
    assert_eq!(
        text,
        "My Proj.wiki:/Getting Started\n# Getting Started\n\nClone the repo and run `make`.\nSee [Deploy](/Runbooks/Deploy)."
    );
    for leak in ["http", PROJ, WIKI_ID] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    let q = &queries(&fx, PAGES)[0];
    assert_eq!(values(q, "path"), ["/Getting Started"], "{q:?}");
    assert_eq!(values(q, "includeContent"), ["true"], "{q:?}");
    // A project wiki is read without a version.
    assert!(
        q.iter().all(|(k, _)| !k.starts_with("versionDescriptor")),
        "{q:?}"
    );
}

#[test]
fn page_clipped() {
    let fx = Fixture::start();
    let page = json!({"path": "/Long", "order": 0, "gitItemPath": "/Long.md", "content": "a".repeat(5000)});
    fx.route(PAGES, vec![Resp::json(&page)]);
    let mut mcp = env(&fx, fixture("wikis-one.json"));
    let (err, text) = call(&mut mcp, json!({"path": "/Long"}));
    assert!(!err, "{text}");
    assert!(
        text.starts_with(&format!("My Proj.wiki:/Long\n{}\n", "a".repeat(4000))),
        "{}",
        &text[..40]
    );
    assert!(
        text.ends_with(
            "\n… 1000 more characters: wiki project=\"My Proj\" wiki=\"My Proj.wiki\" path=/Long full=true"
        ),
        "{}",
        &text[text.len() - 200..]
    );
    let (err, text) = call(&mut mcp, json!({"path": "/Long", "full": true}));
    assert!(!err, "{text}");
    assert_eq!(text, format!("My Proj.wiki:/Long\n{}", "a".repeat(5000)));
}

#[test]
fn tree_default() {
    let fx = Fixture::start();
    fx.route(PAGES, vec![fixture("wiki-tree.json")]);
    let mut mcp = env(&fx, fixture("wikis-one.json"));
    let (err, text) = call(&mut mcp, json!({}));
    assert!(!err, "{text}");
    // In the wiki's order, two spaces deeper per level.
    assert_eq!(
        text,
        "/Getting Started\n/Runbooks\n  /Runbooks/Deploy\n  /Runbooks/Rollback"
    );
    let q = &queries(&fx, PAGES)[0];
    assert_eq!(values(q, "path"), ["/"], "{q:?}");
    assert_eq!(values(q, "recursionLevel"), ["full"], "{q:?}");
    assert!(values(q, "includeContent").is_empty(), "{q:?}");

    let fx = Fixture::start();
    let pages: Vec<String> = (1..=120).map(|i| format!("/P{i}")).collect();
    fx.route(PAGES, vec![root(&pages)]);
    let mut mcp = env(&fx, fixture("wikis-one.json"));
    let (err, text) = call(&mut mcp, json!({}));
    assert!(!err, "{text}");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 101, "{text}");
    assert_eq!(lines[99], "/P100");
    assert_eq!(
        lines[100],
        "… more: wiki project=\"My Proj\" wiki=\"My Proj.wiki\" limit=200"
    );
}

#[test]
fn empty_wiki() {
    let fx = Fixture::start();
    fx.route(PAGES, vec![root(&[])]);
    let (err, text) = call(&mut env(&fx, fixture("wikis-one.json")), json!({}));
    assert!(!err, "{text}");
    assert_eq!(text, "My Proj.wiki has no pages");
}

#[test]
fn several_wikis() {
    let fx = Fixture::start();
    let (err, text) = call(&mut env(&fx, fixture("wikis.json")), json!({"path": "/A"}));
    assert!(err, "{text}");
    assert_eq!(text, "several wikis: My Proj.wiki, Docs; pass wiki=");
    assert!(queries(&fx, PAGES).is_empty() && queries(&fx, DOCS_PAGES).is_empty());
}

#[test]
fn no_wiki() {
    let fx = Fixture::start();
    let none = Resp::json(&json!({"value": [], "count": 0}));
    let (err, text) = call(&mut env(&fx, none), json!({}));
    assert!(err, "{text}");
    assert_eq!(text, "My Proj has no wiki");
}

#[test]
fn unknown_wiki() {
    let fx = Fixture::start();
    let (err, text) = call(
        &mut env(&fx, fixture("wikis.json")),
        json!({"wiki": "Nope"}),
    );
    assert!(err, "{text}");
    assert_eq!(
        text,
        "not found: wiki Nope; My Proj has: My Proj.wiki, Docs"
    );
}

#[test]
fn empty_page() {
    let fx = Fixture::start();
    let page = json!({"path": "/Blank", "order": 0, "gitItemPath": "/Blank.md", "content": ""});
    fx.route(PAGES, vec![Resp::json(&page)]);
    let (err, text) = call(
        &mut env(&fx, fixture("wikis-one.json")),
        json!({"path": "/Blank"}),
    );
    assert!(!err, "{text}");
    assert_eq!(text, "My Proj.wiki:/Blank\n(empty page)");
}

/// The project went away after its id was cached: the list 404s on both tries.
#[test]
fn missing_project() {
    let fx = Fixture::start();
    let gone = Resp::new(
        404,
        "application/json",
        json!({"message": format!("TF200016: The following project does not exist: {PROJ}")})
            .to_string(),
    );
    let (err, text) = call(&mut env(&fx, gone), json!({}));
    assert!(err, "{text}");
    assert_eq!(text, "not found: project My Proj");
    assert_eq!(queries(&fx, WIKIS).len(), 2);
}

#[test]
fn missing_tree() {
    let fx = Fixture::start();
    fx.route(PAGES, vec![Resp::new(404, "text/plain", "gone")]);
    let (err, text) = call(&mut env(&fx, fixture("wikis-one.json")), json!({}));
    assert!(err, "{text}");
    assert_eq!(text, "not found: page /");
}

#[test]
fn missing_page() {
    let fx = Fixture::start();
    let gone = Resp::new(
        404,
        "application/json",
        json!({"message": format!("TF401174: The page '/Nope' specified is not found in the wiki '{WIKI_ID}'")})
            .to_string(),
    );
    fx.route(PAGES, vec![gone]);
    let (err, text) = call(
        &mut env(&fx, fixture("wikis-one.json")),
        json!({"path": "/Nope"}),
    );
    assert!(err, "{text}");
    assert_eq!(text, "not found: page /Nope");
    // Looked up again once, in case the project id went stale.
    assert_eq!(queries(&fx, PAGES).len(), 2);
}

/// A code wiki is read at its published branch; the name matches whatever its case.
#[test]
fn code_wiki_version() {
    let fx = Fixture::start();
    fx.route(DOCS_PAGES, vec![fixture("wiki-page.json")]);
    let (err, text) = call(
        &mut env(&fx, fixture("wikis.json")),
        json!({"wiki": "docs", "path": "/Getting Started"}),
    );
    assert!(!err, "{text}");
    assert!(text.starts_with("Docs:/Getting Started\n"), "{text}");
    let q = &queries(&fx, DOCS_PAGES)[0];
    assert_eq!(values(q, "versionDescriptor.version"), ["main"], "{q:?}");
}

/// The page path arrives as exactly one `path` value, escaped once.
#[test]
fn odd_path() {
    let fx = Fixture::start();
    fx.route(PAGES, vec![fixture("wiki-page.json")]);
    let path = "/C# Notes/a+b&c d";
    let (err, text) = call(
        &mut env(&fx, fixture("wikis-one.json")),
        json!({"path": path}),
    );
    assert!(!err, "{text}");
    let q = &queries(&fx, PAGES)[0];
    assert_eq!(values(q, "path"), [path], "{q:?}");
    assert_eq!(values(q, "includeContent"), ["true"], "{q:?}");
}
