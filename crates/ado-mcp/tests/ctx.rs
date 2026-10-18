mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use common::{Fixture, Mcp, Resp, ado, tempdir};
use serde_json::{Value, json};

const PROJ_ID: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const REPO_ID: &str = "3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const ME_ID: &str = "7c1e4d52-93ab-4f06-b1d8-5a2f6e0c9d13";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const CHECK: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const CONN: &str = "/tfs/Coll/_apis/connectionData";
const IDENTITIES: &str = "/tfs/Coll/_apis/identities";
const DEFS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/definitions";

fn fixture(name: &str) -> Resp {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    Resp::new(200, "application/json", std::fs::read(p).unwrap())
}

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(ok.success(), "git {args:?}");
}

/// A git clone (no commits) of `remote`, on branch `main`.
fn clone_of(remote: &str) -> PathBuf {
    let dir = tempdir();
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["remote", "add", "origin", remote]);
    dir
}

/// The collection's own remote on the fixture host. The fixture speaks http and `https_remote` only takes https or
/// ssh, so the clone is an ssh one; the PAT still goes to `ADO_ORG_URL`'s scheme and port.
fn own_remote(fx: &Fixture) -> String {
    format!("ssh://git@{}/tfs/Coll/My%20Proj/_git/R", fx.addr.ip())
}

fn in_clone(fx: &Fixture, dir: &Path) -> Mcp {
    ado(fx, &[("ADO_PROJECT_DIR", dir.to_str().unwrap())])
}

fn scripted(fx: &Fixture) {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(CHECK, vec![fixture("vsts-info.json")]);
}

fn paths(fx: &Fixture) -> Vec<String> {
    fx.requests().into_iter().map(|r| r.path).collect()
}

fn count(fx: &Fixture, needle: &str) -> usize {
    paths(fx).iter().filter(|p| p.contains(needle)).count()
}

#[test]
fn resolves_from_remote() {
    let fx = Fixture::start();
    scripted(&fx);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("scope_echo", json!({}));
    assert!(!err, "{text}");
    assert_eq!(
        text,
        format!("project: {PROJ_ID} My Proj\nrepo: {REPO_ID} R\nbranch: main")
    );
}

#[test]
fn ctx_uses_ids_not_names() {
    let fx = Fixture::start();
    scripted(&fx);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("scope_echo", json!({"check": true}));
    assert!(!err, "{text}");
    let all = paths(&fx);
    assert!(all[0].starts_with(INFO), "{all:?}");
    assert!(all[1].starts_with(CHECK), "{all:?}");
    assert!(
        all.iter()
            .skip(1)
            .all(|p| !p.contains("My") && !p.contains("%20")),
        "{all:?}"
    );
}

#[test]
fn other_server_sends_nothing() {
    let fx = Fixture::start();
    scripted(&fx);
    let clone = clone_of("https://evil.invalid/tfs/Coll/P/_git/R");
    let mut mcp = in_clone(&fx, &clone);
    let (err, text) = mcp.call("scope_echo", json!({}));
    assert!(err);
    assert!(text.contains("evil.invalid"), "{text}");
    assert!(fx.requests().is_empty(), "{:?}", paths(&fx));
}

#[test]
fn explicit_args_win() {
    let fx = Fixture::start();
    // The clone points elsewhere; explicit arguments never look at it.
    let clone = clone_of("https://evil.invalid/tfs/Coll/P/_git/R");
    fx.route(
        "/tfs/Coll/My%20Proj/_apis/git/repositories/R",
        vec![Resp::json(&json!({"id": REPO_ID, "name": "R",
            "project": {"id": PROJ_ID, "name": "My Proj"}}))],
    );
    let mut mcp = in_clone(&fx, &clone);
    let (err, text) = mcp.call(
        "scope_echo",
        json!({"project": "My Proj", "repo": "R", "branch": "feat/x"}),
    );
    assert!(!err, "{text}");
    assert_eq!(
        text,
        format!("project: {PROJ_ID} My Proj\nrepo: {REPO_ID} R\nbranch: feat/x")
    );
    // No repo: the project alone, with the clone's branch.
    fx.route(
        "/tfs/Coll/_apis/projects/Other",
        vec![Resp::json(&json!({"id": "p-other", "name": "Other"}))],
    );
    let (err, text) = mcp.call("scope_echo", json!({"project": "Other"}));
    assert!(!err, "{text}");
    assert_eq!(text, "project: p-other Other\nrepo: -\nbranch: main");
    assert!(
        paths(&fx).iter().all(|p| !p.contains("vsts/info")),
        "{:?}",
        paths(&fx)
    );
}

#[test]
fn default_project_outside_clone() {
    let fx = Fixture::start();
    fx.route(
        "/tfs/Coll/_apis/projects/Fallback",
        vec![Resp::json(&json!({"id": "p-fb", "name": "Fallback"}))],
    );
    // The default temp dir is no git clone.
    let mut mcp = ado(&fx, &[("ADO_DEFAULT_PROJECT", "Fallback")]);
    let (err, text) = mcp.call("scope_echo", json!({}));
    assert!(!err, "{text}");
    assert_eq!(text, "project: p-fb Fallback\nrepo: -\nbranch: -");
    // And with neither a clone nor a default, the model is told what to do.
    let mut bare = ado(&fx, &[]);
    let (err, text) = bare.call("scope_echo", json!({}));
    assert!(err);
    assert_eq!(
        text,
        "no project: pass project, or open Claude Code in a clone of an Azure DevOps repo"
    );
}

#[test]
fn me_cached_and_preview() {
    let fx = Fixture::start();
    fx.route(CONN, vec![fixture("connection-data.json")]);
    let mut mcp = ado(&fx, &[]);
    for _ in 0..2 {
        let (err, text) = mcp.call("scope_echo", json!({"user": "me"}));
        assert_eq!(text, format!("user: {ME_ID} Alice Example"));
        assert!(!err);
    }
    let n = count(&fx, "connectionData");
    assert_eq!(n, 1, "{:?}", paths(&fx));
    let r = fx
        .requests()
        .into_iter()
        .find(|r| r.path.contains("connectionData"))
        .unwrap();
    assert!(r.path.contains("api-version=7.1-preview.1"), "{}", r.path);
}

#[test]
fn user_ambiguous() {
    let fx = Fixture::start();
    fx.route(IDENTITIES, vec![fixture("identities.json")]);
    let mut mcp = ado(&fx, &[]);
    let (err, text) = mcp.call("scope_echo", json!({"user": "bob"}));
    assert!(err);
    assert_eq!(text, "\"bob\" matches: Bob Builder, Bobby Tables");
    let r = &fx.requests()[0];
    assert!(r.path.contains("searchFilter=General"), "{}", r.path);
    assert!(r.path.contains("filterValue=bob"), "{}", r.path);
}

#[test]
fn user_unique_unknown_and_me() {
    let fx = Fixture::start();
    fx.route(
        IDENTITIES,
        vec![Resp::json(
            &json!({"count": 1, "value": [{"id": "u1", "providerDisplayName": "Carol C"}]}),
        )],
    );
    let mut mcp = ado(&fx, &[]);
    assert_eq!(
        mcp.call("scope_echo", json!({"user": "carol"})).1,
        "user: u1 Carol C"
    );
    fx.route(
        IDENTITIES,
        vec![Resp::json(&json!({"count": 0, "value": []}))],
    );
    assert_eq!(
        mcp.call("scope_echo", json!({"user": "nobody"})),
        (true, "no user matches \"nobody\"".into())
    );
    fx.route(CONN, vec![fixture("connection-data.json")]);
    let (err, text) = mcp.call("scope_echo", json!({"user": "me"}));
    assert!(!err, "{text}");
    assert_eq!(text, format!("user: {ME_ID} Alice Example"));
}

fn pipeline_env(fx: &Fixture) -> (Mcp, Value) {
    scripted(fx);
    (
        in_clone(fx, &clone_of(&own_remote(fx))),
        json!({"pipeline": "CI"}),
    )
}

#[test]
fn pipeline_by_name() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    let (mut mcp, args) = pipeline_env(&fx);
    let (err, text) = mcp.call("scope_echo", args.clone());
    assert!(!err, "{text}");
    assert!(text.ends_with("\npipeline: 12"), "{text}");
    let first = fx
        .requests()
        .into_iter()
        .find(|r| r.path.starts_with(DEFS))
        .unwrap();
    assert!(first.path.contains("name=CI"), "{}", first.path);
    // Cached, and a number passes through without a request.
    mcp.call("scope_echo", args);
    assert_eq!(count(&fx, "build/definitions"), 1);
    let (_, text) = mcp.call("scope_echo", json!({"pipeline": "99"}));
    assert!(text.ends_with("\npipeline: 99"), "{text}");
    assert_eq!(count(&fx, "build/definitions"), 1);
}

#[test]
fn pipeline_ambiguous() {
    let fx = Fixture::start();
    fx.route(
        DEFS,
        vec![Resp::json(&json!({"count": 2, "value": [
            {"id": 1, "name": "Deploy", "path": "\\Prod"},
            {"id": 2, "name": "Deploy", "path": "\\"}]}))],
    );
    let (mut mcp, _) = pipeline_env(&fx);
    let (err, text) = mcp.call("scope_echo", json!({"pipeline": "Deploy"}));
    assert!(err);
    assert_eq!(
        text,
        "pipeline \"Deploy\" is ambiguous: \\Prod\\Deploy, \\Deploy"
    );
}

#[test]
fn pipeline_unknown() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![Resp::json(&json!({"count": 0, "value": []}))]);
    let (mut mcp, _) = pipeline_env(&fx);
    let (err, text) = mcp.call("scope_echo", json!({"pipeline": "Nope"}));
    assert!(err);
    assert_eq!(text, "not found: pipeline \"Nope\"");
    // A miss isn't cached: the next call asks again and now finds it.
    fx.route(DEFS, vec![fixture("definitions.json")]);
    let (err, text) = mcp.call("scope_echo", json!({"pipeline": "CI"}));
    assert!(!err, "{text}");
    assert_eq!(count(&fx, "build/definitions"), 2);
}

#[test]
fn stale_id_retried_once() {
    let fx = Fixture::start();
    let renamed = |id: &str| {
        let mut v: Value = serde_json::from_slice(&fixture("vsts-info.json").body).unwrap();
        v["repository"]["id"] = json!(id);
        Resp::json(&v)
    };
    // The repo was deleted and recreated: the second /vsts/info answers with a new id.
    fx.route(INFO, vec![renamed("old-repo"), renamed("new-repo")]);
    let base = format!("/tfs/Coll/{PROJ_ID}/_apis/git/repositories");
    fx.route(
        &format!("{base}/old-repo"),
        vec![Resp::new(404, "text/plain", "gone")],
    );
    fx.route(&format!("{base}/new-repo"), vec![fixture("vsts-info.json")]);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("scope_echo", json!({"check": true}));
    assert!(!err, "{text}");
    assert!(text.contains("repo: new-repo R"), "{text}");
    assert_eq!(count(&fx, "vsts/info"), 2, "{:?}", paths(&fx));
    assert_eq!(count(&fx, "old-repo"), 1);
    assert_eq!(count(&fx, "new-repo"), 1);

    // Still 404 after the retry: the error comes out, with no third attempt.
    let fx = Fixture::start();
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(CHECK, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("scope_echo", json!({"check": true}));
    assert!(err);
    assert!(text.starts_with("not found"), "{text}");
    assert_eq!(count(&fx, "vsts/info"), 2);
    assert_eq!(count(&fx, "/_apis/git/repositories/"), 2);
}

#[test]
fn concurrent_scopes_all_ok() {
    let fx = Fixture::start();
    fx.route(
        INFO,
        vec![fixture("vsts-info.json").delay(Duration::from_millis(200))],
    );
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let results = mcp.call_all("scope_echo", vec![json!({}); 8]);
    for (err, text) in &results {
        assert!(!err, "{text}");
        assert!(
            text.starts_with(&format!("project: {PROJ_ID} My Proj")),
            "{text}"
        );
    }
    let before = count(&fx, "vsts/info");
    assert!(before >= 1);
    let (err, text) = mcp.call("scope_echo", json!({}));
    assert!(!err, "{text}");
    assert_eq!(count(&fx, "vsts/info"), before);
}
