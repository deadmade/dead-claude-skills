mod common;

use std::path::Path;
use std::time::Duration;

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ_ID: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const ME_ID: &str = "7c1e4d52-93ab-4f06-b1d8-5a2f6e0c9d13";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const PRS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/pullrequests";
const CONN: &str = "/tfs/Coll/_apis/connectionData";
const IDENTITIES: &str = "/tfs/Coll/_apis/identities";
const DEFS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/definitions";
const BUILDS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds";
/// `repo.json`'s project and repo, by name.
const BY_NAME: &str = "/tfs/Coll/P/_apis/git/repositories/R";

fn in_clone(fx: &Fixture, dir: &Path) -> Mcp {
    ado(fx, &[("ADO_PROJECT_DIR", dir.to_str().unwrap())])
}

fn scripted(fx: &Fixture) {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(PRS, vec![fixture("pr-list.json")]);
}

fn no_prs() -> Resp {
    Resp::json(&json!({"count": 0, "value": []}))
}

/// The one request whose path starts with `prefix`.
fn only(fx: &Fixture, prefix: &str) -> common::Req {
    let mut found: Vec<_> = fx
        .requests()
        .into_iter()
        .filter(|r| r.path.starts_with(prefix))
        .collect();
    assert_eq!(found.len(), 1, "{prefix}: {:?}", paths(fx));
    found.remove(0)
}

/// `pr_list` on `P`/`R` (routed to `repo.json` and no PRs) with `args` on top.
fn pr_list_as(mcp: &mut Mcp, fx: &Fixture, args: &Value) -> (bool, String) {
    fx.route(BY_NAME, vec![fixture("repo.json")]);
    fx.route(PRS, vec![no_prs()]);
    let mut a = json!({"project": "P", "repo": "R"});
    a.as_object_mut()
        .unwrap()
        .extend(args.as_object().unwrap().clone());
    mcp.call("pr_list", a)
}

/// A `GET _apis/projects/{name}` answer.
fn project(id: &str, name: &str) -> Resp {
    Resp::json(
        &json!({"id": id, "name": name, "state": "wellFormed", "revision": 3,
        "visibility": "private", "lastUpdateTime": "2025-11-04T10:12:33.47Z",
        "url": format!("http://dev.example/tfs/Coll/_apis/projects/{id}")}),
    )
}

/// A build definition reference in project `PROJ_ID`.
fn def(id: u32, name: &str, path: &str) -> Value {
    json!({"id": id, "name": name, "path": path, "type": "build", "queueStatus": "enabled",
        "revision": 1, "url": format!("http://dev.example/tfs/Coll/_apis/build/Definitions/{id}"),
        "project": {"id": PROJ_ID, "name": "My Proj", "state": "wellFormed", "visibility": "private"}})
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
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(PRS, vec![no_prs()]);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    // `pr_view` without an id looks for the branch's PR in the remote's repo.
    let (err, text) = mcp.call("pr_view", json!({}));
    assert!(err);
    assert_eq!(text, "no active PR for branch main");
    let q = only(&fx, PRS).path;
    assert!(q.contains("sourceRefName=refs%2Fheads%2Fmain"), "{q}");
}

#[test]
fn ctx_uses_ids_not_names() {
    let fx = Fixture::start();
    scripted(&fx);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("pr_list", json!({}));
    assert!(!err, "{text}");
    let all = paths(&fx);
    assert!(all[0].starts_with(INFO), "{all:?}");
    assert!(all[1].starts_with(PRS), "{all:?}");
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
    let (err, text) = mcp.call("pr_list", json!({}));
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
        vec![fixture("repo.json")],
    );
    fx.route(PRS, vec![no_prs()]);
    let mut mcp = in_clone(&fx, &clone);
    let (err, text) = mcp.call(
        "pr_view",
        json!({"project": "My Proj", "repo": "R", "branch": "feat/x"}),
    );
    assert!(err);
    assert_eq!(text, "no active PR for branch feat/x");
    // The PR lookup goes to the ids the server named.
    let q = only(&fx, PRS).path;
    assert!(q.contains("sourceRefName=refs%2Fheads%2Ffeat%2Fx"), "{q}");
    // No repo: the project alone, with the clone's branch.
    fx.route(
        "/tfs/Coll/_apis/projects/Other",
        vec![project("p-other", "Other")],
    );
    fx.route(
        "/tfs/Coll/p-other/_apis/pipelines/12/runs",
        vec![fixture("pipeline-run.json")],
    );
    let (err, text) = mcp.call(
        "pipeline_run",
        json!({"project": "Other", "pipeline": "12"}),
    );
    assert!(!err, "{text}");
    assert_eq!(text, "queued run #78 of CI on main");
    let run = only(&fx, "/tfs/Coll/p-other/_apis/pipelines/12/runs");
    let body = String::from_utf8(run.body).unwrap();
    assert!(body.contains("refs/heads/main"), "{body}");
    assert!(
        paths(&fx).iter().all(|p| !p.contains("vsts/info")),
        "{:?}",
        paths(&fx)
    );
    // The project alone leaves the repo empty, even inside a clone.
    let (err, text) = mcp.call("pr_list", json!({"project": "Other"}));
    assert!(err);
    assert!(text.starts_with("no repo: pass repo"), "{text}");
}

#[test]
fn default_project_outside_clone() {
    let fx = Fixture::start();
    fx.route(
        "/tfs/Coll/_apis/projects/Fallback",
        vec![project("p-fb", "Fallback")],
    );
    fx.route(
        "/tfs/Coll/p-fb/_apis/git/repositories",
        vec![fixture("repos.json")],
    );
    // The default temp dir is no git clone.
    let mut mcp = ado(&fx, &[("ADO_DEFAULT_PROJECT", "Fallback")]);
    let (err, text) = mcp.call("repo_list", json!({}));
    assert!(!err, "{text}");
    assert!(text.contains("R  default: main"), "{text}");
    // A project but no repo and no branch.
    assert_eq!(
        mcp.call("pr_list", json!({})),
        (
            true,
            "no repo: pass repo, or open Claude Code in a clone of an Azure DevOps repo".into()
        )
    );
    assert_eq!(
        mcp.call("pipeline_run", json!({"pipeline": "12"})),
        (true, "no branch: pass branch".into())
    );
    // And with neither a clone nor a default, the model is told what to do.
    let mut bare = ado(&fx, &[]);
    let (err, text) = bare.call("repo_list", json!({}));
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
    fx.route("/tfs/Coll/_apis/wit/workitems/1", vec![fixture("wi.json")]);
    let mut mcp = ado(&fx, &[]);
    for _ in 0..2 {
        let (err, text) = mcp.call("wi_update", json!({"id": 1, "assigned": "me"}));
        assert_eq!(text, "updated #1: System.AssignedTo");
        assert!(!err);
    }
    for r in fx
        .requests()
        .iter()
        .filter(|r| r.path.contains("workitems"))
    {
        let body = String::from_utf8(r.body.clone()).unwrap();
        assert!(body.contains("\"Alice Example\""), "{body}");
    }
    let n = count(&fx, "connectionData");
    assert_eq!(n, 1, "{:?}", paths(&fx));
    let r = only(&fx, CONN);
    assert!(r.path.contains("api-version=7.1-preview.1"), "{}", r.path);
    // And `me` is the PAT user's id where an id is needed.
    let (err, text) = pr_list_as(&mut mcp, &fx, &json!({"reviewer": "me"}));
    assert!(!err, "{text}");
    let q = only(&fx, PRS).path;
    assert!(q.contains(&format!("reviewerId={ME_ID}")), "{q}");
    assert_eq!(count(&fx, "connectionData"), 1);
}

#[test]
fn user_ambiguous() {
    let fx = Fixture::start();
    fx.route(IDENTITIES, vec![fixture("identities.json")]);
    let mut mcp = ado(&fx, &[]);
    let (err, text) = pr_list_as(&mut mcp, &fx, &json!({"reviewer": "bob"}));
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
    let (err, text) = pr_list_as(&mut mcp, &fx, &json!({"creator": "carol"}));
    assert!(!err, "{text}");
    let q = only(&fx, PRS).path;
    assert!(q.contains("creatorId=u1"), "{q}");
    fx.route(
        IDENTITIES,
        vec![Resp::json(&json!({"count": 0, "value": []}))],
    );
    assert_eq!(
        pr_list_as(&mut mcp, &fx, &json!({"creator": "nobody"})),
        (true, "no user matches \"nobody\"".into())
    );
    fx.route(CONN, vec![fixture("connection-data.json")]);
    let (err, text) = pr_list_as(&mut mcp, &fx, &json!({"creator": "me"}));
    assert!(!err, "{text}");
    let q = fx
        .requests()
        .into_iter()
        .rfind(|r| r.path.starts_with(PRS))
        .unwrap()
        .path;
    assert!(q.contains(&format!("creatorId={ME_ID}")), "{q}");
}

fn pipeline_env(fx: &Fixture) -> (Mcp, Value) {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(BUILDS, vec![fixture("builds-empty.json")]);
    (
        in_clone(fx, &clone_of(&own_remote(fx))),
        json!({"pipeline": "CI"}),
    )
}

/// The `definitions` filter of the last builds request.
fn last_definitions(fx: &Fixture) -> String {
    let q = fx
        .requests()
        .into_iter()
        .rfind(|r| r.path.starts_with(BUILDS))
        .unwrap()
        .path;
    q.split(['?', '&'])
        .find_map(|p| p.strip_prefix("definitions="))
        .unwrap_or_else(|| panic!("{q}"))
        .to_owned()
}

#[test]
fn pipeline_by_name() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    let (mut mcp, args) = pipeline_env(&fx);
    let (err, text) = mcp.call("pipeline_runs", args.clone());
    assert!(!err, "{text}");
    assert_eq!(last_definitions(&fx), "12");
    let first = fx
        .requests()
        .into_iter()
        .find(|r| r.path.starts_with(DEFS))
        .unwrap();
    assert!(first.path.contains("name=CI"), "{}", first.path);
    // Cached, and a number passes through without a request.
    mcp.call("pipeline_runs", args);
    assert_eq!(count(&fx, "build/definitions"), 1);
    assert_eq!(last_definitions(&fx), "12");
    let (err, text) = mcp.call("pipeline_runs", json!({"pipeline": "99"}));
    assert!(!err, "{text}");
    assert_eq!(last_definitions(&fx), "99");
    assert_eq!(count(&fx, "build/definitions"), 1);
}

#[test]
fn pipeline_ambiguous() {
    let fx = Fixture::start();
    fx.route(
        DEFS,
        vec![Resp::json(
            &json!({"count": 2, "value": [def(1, "Deploy", "\\Prod"), def(2, "Deploy", "\\")]}),
        )],
    );
    let (mut mcp, _) = pipeline_env(&fx);
    let (err, text) = mcp.call("pipeline_runs", json!({"pipeline": "Deploy"}));
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
    let (err, text) = mcp.call("pipeline_runs", json!({"pipeline": "Nope"}));
    assert!(err);
    assert_eq!(text, "not found: pipeline \"Nope\"");
    // A miss isn't cached: the next call asks again and now finds it.
    fx.route(DEFS, vec![fixture("definitions.json")]);
    let (err, text) = mcp.call("pipeline_runs", json!({"pipeline": "CI"}));
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
        &format!("{base}/old-repo/pullrequests"),
        vec![Resp::new(404, "text/plain", "gone")],
    );
    fx.route(
        &format!("{base}/new-repo/pullrequests"),
        vec![fixture("pr-list.json")],
    );
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("pr_list", json!({}));
    assert!(!err, "{text}");
    assert!(text.starts_with('!'), "{text}");
    assert_eq!(count(&fx, "vsts/info"), 2, "{:?}", paths(&fx));
    assert_eq!(count(&fx, "old-repo"), 1);
    assert_eq!(count(&fx, "new-repo"), 1);

    // Still 404 after the retry: the error comes out, with no third attempt.
    let fx = Fixture::start();
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    fx.route(PRS, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let (err, text) = mcp.call("pr_list", json!({}));
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
    fx.route(PRS, vec![fixture("pr-list.json")]);
    let mut mcp = in_clone(&fx, &clone_of(&own_remote(&fx)));
    let results = mcp.call_all("pr_list", vec![json!({}); 8]);
    for (err, text) in &results {
        assert!(!err, "{text}");
        assert!(text.starts_with('!'), "{text}");
    }
    assert_eq!(count(&fx, "/pullrequests"), 8, "{:?}", paths(&fx));
    let before = count(&fx, "vsts/info");
    assert!(before >= 1);
    let (err, text) = mcp.call("pr_list", json!({}));
    assert!(!err, "{text}");
    assert_eq!(count(&fx, "vsts/info"), before);
}

#[test]
fn github_clone_uses_default_project() {
    let fx = Fixture::start();
    fx.route(
        "/tfs/Coll/_apis/projects/Fallback",
        vec![project("p-fb", "Fallback")],
    );
    fx.route(
        "/tfs/Coll/p-fb/_apis/pipelines/12/runs",
        vec![fixture("pipeline-run.json")],
    );
    let clone = clone_of("https://github.com/a/b.git");
    let mut mcp = ado(
        &fx,
        &[
            ("ADO_PROJECT_DIR", clone.to_str().unwrap()),
            ("ADO_DEFAULT_PROJECT", "Fallback"),
        ],
    );
    // The default project, with the clone's branch.
    let (err, text) = mcp.call("pipeline_run", json!({"pipeline": "12"}));
    assert!(!err, "{text}");
    assert_eq!(text, "queued run #78 of CI on main");
    let body = String::from_utf8(only(&fx, "/tfs/Coll/p-fb/_apis/pipelines/12/runs").body).unwrap();
    assert!(body.contains("refs/heads/main"), "{body}");
    assert_eq!(fx.requests().len(), 2);
    // Without a default project it still says what to do, and sends nothing.
    let mut bare = in_clone(&fx, &clone);
    let (err, text) = bare.call("pipeline_run", json!({"pipeline": "12"}));
    assert!(err);
    assert!(text.starts_with("no project: pass project"), "{text}");
    assert_eq!(fx.requests().len(), 2);
}

#[test]
fn bad_names_and_empty_user() {
    let fx = Fixture::start();
    let mut mcp = ado(&fx, &[]);
    for args in [
        json!({"project": ".."}),
        json!({"project": "P", "repo": "."}),
    ] {
        assert_eq!(
            mcp.call("pr_list", args),
            (true, "bad project or repo name".into())
        );
    }
    // `pr_create` looks each reviewer up before anything else.
    assert_eq!(
        mcp.call(
            "pr_create",
            json!({"project": "P", "repo": "R", "branch": "b", "title": "t", "reviewers": ["  "]})
        ),
        (true, "no user given".into())
    );
    assert!(fx.requests().is_empty(), "{:?}", paths(&fx));
}

#[test]
fn negative_pipeline_is_a_name() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    let (mut mcp, _) = pipeline_env(&fx);
    let (err, text) = mcp.call("pipeline_runs", json!({"pipeline": "-1"}));
    assert!(err);
    assert_eq!(text, "not found: pipeline \"-1\"");
    let q = paths(&fx)
        .into_iter()
        .find(|p| p.starts_with(DEFS))
        .unwrap();
    assert!(q.contains("name=-1"), "{q}");
}
