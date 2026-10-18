mod common;

use std::time::{Duration, Instant};

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const REPO: &str = "3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const JANE: &str = "5e8f1a77-0c2b-4d39-8e6a-1b7c3d9f4a02";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const IDENTITIES: &str = "/tfs/Coll/_apis/identities";
const WI_BATCH: &str = "/tfs/Coll/_apis/wit/workitemsbatch";
const POLICY: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/policy/evaluations";
const BUILDS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds";
const PRS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/pullrequests";

/// A server inside a clone of the collection's own repo; the PR routes come from the test.
fn env(fx: &Fixture) -> Mcp {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    let clone = clone_of(&own_remote(fx));
    ado(fx, &[("ADO_PROJECT_DIR", clone.to_str().unwrap())])
}

/// The routes `pr_view` joins over, for PR 412.
fn view_routes(fx: &Fixture) {
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    fx.route(POLICY, vec![fixture("policy-evaluations.json")]);
    fx.route(
        &format!("{PRS}/412/workitems"),
        vec![fixture("pr-workitems.json")],
    );
    fx.route(WI_BATCH, vec![fixture("wi-batch.json")]);
    fx.route(BUILDS, vec![fixture("builds-one.json")]);
}

/// Requests whose path (without query) is `path`, with the query decoded for reading.
fn queries(fx: &Fixture, path: &str) -> Vec<String> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(path))
        .map(|r| {
            r.path
                .split_once('?')
                .map_or(String::new(), |(_, q)| q.to_owned())
                .replace("%24", "$")
                .replace("%2F", "/")
                .replace("%3A", ":")
        })
        .collect()
}

fn ok(mcp: &mut Mcp, tool: &str, args: Value) -> String {
    let (err, text) = mcp.call(tool, args);
    assert!(!err, "{text}");
    text
}

#[test]
fn list_one_line_each() {
    let fx = Fixture::start();
    fx.route(PRS, vec![fixture("pr-list.json")]);
    let text = ok(&mut env(&fx), "pr_list", json!({}));
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert_eq!(
        lines[0],
        "!412  active  feature/login-retry → main  \"Retry login on timeout\"  Alice Example  1 approvals"
    );
    assert_eq!(
        lines[1],
        "!409  active draft  feature/parser → main  \"Draft: new parser\"  Bob Builder  1 approvals, rejected"
    );
    assert!(!text.contains("http"), "{text}");
    let q = &queries(&fx, PRS)[0];
    assert!(q.contains("searchCriteria.status=active"), "{q}");
    assert!(q.contains("$top=21"), "{q}");
}

#[test]
fn list_more_line() {
    let fx = Fixture::start();
    fx.route(PRS, vec![fixture("pr-list.json")]);
    let text = ok(&mut env(&fx), "pr_list", json!({"limit": 2}));
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert!(lines[0].starts_with("!412 ") && lines[1].starts_with("!409 "));
    assert_eq!(lines[2], "… more: pr_list limit=4");
    assert!(queries(&fx, PRS)[0].contains("$top=3"));
}

#[test]
fn list_filters() {
    let fx = Fixture::start();
    fx.route(PRS, vec![Resp::json(&json!({"value": []}))]);
    let text = ok(
        &mut env(&fx),
        "pr_list",
        json!({"status": "all", "source": "feature/x", "target": "refs/heads/dev"}),
    );
    assert_eq!(text, "no pull requests");
    let q = &queries(&fx, PRS)[0];
    assert!(q.contains("searchCriteria.status=all"), "{q}");
    assert!(
        q.contains("searchCriteria.sourceRefName=refs/heads/feature/x"),
        "{q}"
    );
    assert!(
        q.contains("searchCriteria.targetRefName=refs/heads/dev"),
        "{q}"
    );
}

#[test]
fn list_reviewer_by_name() {
    let fx = Fixture::start();
    fx.route(PRS, vec![fixture("pr-list.json")]);
    fx.route(
        IDENTITIES,
        vec![Resp::json(
            &json!({"value": [{"id": JANE, "providerDisplayName": "Jane Roe"}]}),
        )],
    );
    ok(&mut env(&fx), "pr_list", json!({"reviewer": "jane"}));
    let q = &queries(&fx, PRS)[0];
    assert!(
        q.contains(&format!("searchCriteria.reviewerId={JANE}")),
        "{q}"
    );
}

#[test]
fn view_by_branch() {
    let fx = Fixture::start();
    let pr: Value = serde_json::from_slice(&fixture("pr.json").body).unwrap();
    fx.route(PRS, vec![Resp::json(&json!({"value": [pr]}))]);
    view_routes(&fx);
    let text = ok(
        &mut env(&fx),
        "pr_view",
        json!({"branch": "feature/login-retry"}),
    );
    assert!(text.starts_with("!412 "), "{text}");
    let q = &queries(&fx, PRS)[0];
    assert!(
        q.contains("searchCriteria.sourceRefName=refs/heads/feature/login-retry"),
        "{q}"
    );
    assert!(q.contains("searchCriteria.status=active"), "{q}");
}

#[test]
fn view_no_active_pr_and_unknown_id() {
    let fx = Fixture::start();
    fx.route(PRS, vec![Resp::json(&json!({"value": []}))]);
    fx.route(
        &format!("{PRS}/999"),
        vec![Resp::new(404, "text/plain", "gone")],
    );
    let mut mcp = env(&fx);
    let (err, text) = mcp.call("pr_view", json!({"branch": "nope"}));
    assert!(err);
    assert_eq!(text, "no active PR for branch nope");
    let (err, text) = mcp.call("pr_view", json!({"id": 999}));
    assert!(err);
    assert_eq!(text, "not found: PR !999");
}

#[test]
fn view_sections() {
    let fx = Fixture::start();
    view_routes(&fx);
    let text = ok(&mut env(&fx), "pr_view", json!({"id": 412}));
    assert!(
        text.starts_with("!412  active  feature/login-retry → main"),
        "{text}"
    );
    assert!(text.contains("J. Doe: approved (required)"), "{text}");
    assert!(text.contains("K. Roe: no vote"), "{text}");
    assert!(text.contains("checks:"), "{text}");
    assert!(
        text.contains("Minimum number of reviewers: approved"),
        "{text}"
    );
    assert!(
        text.contains("#77 Bug Active \"Login fails behind the proxy\""),
        "{text}"
    );
    assert!(
        text.contains("latest run: #991 CI succeeded 2026-03-04"),
        "{text}"
    );
    assert!(
        text.ends_with("Retries the login twice.\n\nSecond paragraph."),
        "{text}"
    );
    for leak in ["http", PROJ, REPO, "2d9e7b10", "_links"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    let q = &queries(&fx, POLICY)[0];
    assert!(
        q.contains(&format!(
            "artifactId=vstfs:///CodeReview/CodeReviewId/{PROJ}/412"
        )),
        "{q}"
    );
    assert!(q.contains("api-version=7.1-preview.1"), "{q}");
    let batch = fx
        .requests()
        .into_iter()
        .find(|r| r.path.starts_with(WI_BATCH))
        .unwrap();
    let body: Value = serde_json::from_slice(&batch.body).unwrap();
    assert_eq!(body["ids"], json!([77]));
    let q = &queries(&fx, BUILDS)[0];
    assert!(q.contains("branchName=refs/pull/412/merge"), "{q}");
    assert!(
        q.contains("queryOrder=queueTimeDescending") && q.contains("$top=1"),
        "{q}"
    );
}

#[test]
fn view_clips_description() {
    let fx = Fixture::start();
    view_routes(&fx);
    let mut pr: Value = serde_json::from_slice(&fixture("pr.json").body).unwrap();
    pr["description"] = json!("x".repeat(5000));
    fx.route(&format!("{PRS}/412"), vec![Resp::json(&pr)]);
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "pr_view", json!({"id": 412}));
    assert!(
        text.ends_with("… 1000 more characters: pr_view id=412 full=true"),
        "{text}"
    );
    let text = ok(&mut mcp, "pr_view", json!({"id": 412, "full": true}));
    assert!(text.ends_with(&"x".repeat(5000)), "{}", text.len());
}

#[test]
fn view_run_falls_back_to_source() {
    let fx = Fixture::start();
    view_routes(&fx);
    fx.route(
        BUILDS,
        vec![fixture("builds-empty.json"), fixture("builds-one.json")],
    );
    let text = ok(&mut env(&fx), "pr_view", json!({"id": 412}));
    assert!(text.contains("latest run: #991"), "{text}");
    let q = queries(&fx, BUILDS);
    assert_eq!(q.len(), 2, "{q:?}");
    assert!(q[0].contains("branchName=refs/pull/412/merge"), "{q:?}");
    assert!(
        q[1].contains("branchName=refs/heads/feature/login-retry"),
        "{q:?}"
    );
}

#[test]
fn view_no_run() {
    let fx = Fixture::start();
    view_routes(&fx);
    fx.route(BUILDS, vec![fixture("builds-empty.json")]);
    let text = ok(&mut env(&fx), "pr_view", json!({"id": 412}));
    assert!(text.contains("latest run: none"), "{text}");
}

#[test]
fn view_concurrent() {
    let fx = Fixture::start();
    view_routes(&fx);
    let slow = Duration::from_millis(300);
    fx.route(POLICY, vec![fixture("policy-evaluations.json").delay(slow)]);
    fx.route(
        &format!("{PRS}/412/workitems"),
        vec![fixture("pr-workitems.json").delay(slow)],
    );
    fx.route(BUILDS, vec![fixture("builds-one.json").delay(slow)]);
    let mut mcp = env(&fx);
    let t = Instant::now();
    ok(&mut mcp, "pr_view", json!({"id": 412}));
    let took = t.elapsed();
    assert!(took < Duration::from_millis(800), "{took:?}");
}

#[test]
fn threads_hide_system_and_resolved() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    fx.route(
        &format!("{PRS}/412/threads"),
        vec![fixture("pr-threads.json")],
    );
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "pr_threads", json!({"id": 412}));
    assert_eq!(
        text.lines().filter(|l| l.starts_with('#')).count(),
        2,
        "{text}"
    );
    assert!(text.contains("#7 active  src/auth.rs:88"), "{text}");
    assert!(text.contains("#9 active\n"), "{text}");
    assert!(text.contains("   J. Doe: Why retry twice?\n"), "{text}");
    assert!(
        text.contains("   Alice Example: Because of the flaky proxy.\n      See the ticket."),
        "{text}"
    );
    assert!(
        text.ends_with("1 resolved threads hidden: pr_threads id=412 all=true"),
        "{text}"
    );
    for hidden in ["Typo here", "Policy status", "Deleted", "Reviewer voted"] {
        assert!(!text.contains(hidden), "{hidden} in {text}");
    }
    for leak in ["http", PROJ, "2d9e7b10"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    let text = ok(&mut mcp, "pr_threads", json!({"id": 412, "all": true}));
    assert!(text.contains("#5 fixed  src/lib.rs:3"), "{text}");
    assert!(!text.contains("hidden"), "{text}");
}

#[test]
fn thread_location() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    let mut threads: Value = serde_json::from_slice(&fixture("pr-threads.json").body).unwrap();
    // Thread 7 with only a left-side line.
    let ctx = &mut threads["value"][3]["threadContext"];
    let left = ctx["rightFileStart"].take();
    ctx["leftFileStart"] = left;
    ctx.as_object_mut().unwrap().remove("rightFileStart");
    fx.route(&format!("{PRS}/412/threads"), vec![Resp::json(&threads)]);
    let text = ok(&mut env(&fx), "pr_threads", json!({"id": 412, "limit": 1}));
    assert!(text.starts_with("#7 active  src/auth.rs:88\n"), "{text}");
    assert!(text.contains("… more: pr_threads id=412 limit=2"), "{text}");
}

#[test]
fn files_follow_next_skip() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    fx.route(
        &format!("{PRS}/412/iterations"),
        vec![fixture("iterations.json")],
    );
    let changes = format!("{PRS}/412/iterations/2/changes");
    fx.route(
        &changes,
        vec![
            fixture("iteration-changes-p1.json"),
            fixture("iteration-changes-p2.json"),
        ],
    );
    let text = ok(&mut env(&fx), "pr_files", json!({"id": 412}));
    assert_eq!(
        text,
        "edit  src/auth.rs\nadd  src/retry.rs\ndelete  old.txt\ndiff: git diff main...feature/login-retry"
    );
    let q = queries(&fx, &changes);
    assert_eq!(q.len(), 2, "{q:?}");
    assert!(q[0].contains("$top=2000"), "{q:?}");
    assert!(q[1].contains("$skip=2"), "{q:?}");
}
