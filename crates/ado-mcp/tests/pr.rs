mod common;

use std::time::{Duration, Instant};

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const REPO: &str = "3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const JANE: &str = "5e8f1a77-0c2b-4d39-8e6a-1b7c3d9f4a02";
/// The PAT's user in `connection-data.json`.
const ALICE: &str = "7c1e4d52-93ab-4f06-b1d8-5a2f6e0c9d13";
const CONN: &str = "/tfs/Coll/_apis/connectionData";
const REPO_URL: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const IDENTITIES: &str = "/tfs/Coll/_apis/identities";
const WI_BATCH: &str = "/tfs/Coll/_apis/wit/workitemsbatch";
const POLICY: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/policy/evaluations";
const BUILDS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds";
const PRS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/pullrequests";
/// The crate spells the PR's own sub-resources `pullRequests`.
const PR412: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/pullRequests/412";

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
        &format!("{PR412}/workitems"),
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

/// The JSON bodies of the `method` requests to `path` (without query).
fn bodies(fx: &Fixture, method: &str, path: &str) -> Vec<Value> {
    fx.requests()
        .into_iter()
        .filter(|r| r.method == method && r.path.split('?').next() == Some(path))
        .map(|r| serde_json::from_slice(&r.body).unwrap())
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
    assert!(q.split('&').any(|p| p == "api-version=7.1-preview"), "{q}");
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
        &format!("{PR412}/workitems"),
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
        &format!("{PR412}/threads"),
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
    fx.route(&format!("{PR412}/threads"), vec![Resp::json(&threads)]);
    let text = ok(&mut env(&fx), "pr_threads", json!({"id": 412, "limit": 1}));
    assert!(text.starts_with("#7 active  src/auth.rs:88\n"), "{text}");
    assert!(text.contains("… more: pr_threads id=412 limit=2"), "{text}");
}

#[test]
fn files_follow_next_skip() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    fx.route(
        &format!("{PR412}/iterations"),
        vec![fixture("iterations.json")],
    );
    let changes = format!("{PR412}/iterations/2/changes");
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

#[test]
fn view_tolerates_entries_without_configuration_or_id() {
    let fx = Fixture::start();
    view_routes(&fx);
    let mut evals: Value =
        serde_json::from_slice(&fixture("policy-evaluations.json").body).unwrap();
    evals["value"]
        .as_array_mut()
        .unwrap()
        .push(json!({"status": "queued"}));
    evals["value"]
        .as_array_mut()
        .unwrap()
        .push(json!({"status": "broken", "configuration": {"id": 9}}));
    fx.route(POLICY, vec![Resp::json(&evals)]);
    fx.route(
        &format!("{PR412}/workitems"),
        vec![Resp::json(&json!({"value": [{"url": "x"}, {"id": "77"}]}))],
    );
    let text = ok(&mut env(&fx), "pr_view", json!({"id": 412}));
    assert!(
        text.contains("Minimum number of reviewers: approved"),
        "{text}"
    );
    assert!(
        text.contains("policy: queued") && text.contains("policy: broken"),
        "{text}"
    );
    assert!(text.contains("#77 Bug Active"), "{text}");
}

#[test]
fn view_degrades_per_section() {
    let fx = Fixture::start();
    view_routes(&fx);
    fx.route(BUILDS, vec![Resp::new(403, "text/plain", "no")]);
    fx.route(POLICY, vec![Resp::new(500, "text/plain", "boom")]);
    let text = ok(&mut env(&fx), "pr_view", json!({"id": 412}));
    assert!(text.contains("J. Doe: approved (required)"), "{text}");
    assert!(text.contains("checks: unavailable ("), "{text}");
    assert!(
        text.contains(
            "latest run: unavailable (the PAT may not do this: it needs the Build scope)"
        ),
        "{text}"
    );
    assert!(text.contains("#77 Bug Active"), "{text}");
    assert!(text.ends_with("Second paragraph."), "{text}");
}

#[test]
fn files_keep_odd_ref_names_out_of_commands() {
    let fx = Fixture::start();
    let mut pr: Value = serde_json::from_slice(&fixture("pr.json").body).unwrap();
    pr["sourceRefName"] = json!("refs/heads/x;rm -rf ~");
    fx.route(&format!("{PRS}/412"), vec![Resp::json(&pr)]);
    fx.route(
        &format!("{PR412}/iterations"),
        vec![Resp::json(&json!({"value": [{}, {"id": 1}]}))],
    );
    fx.route(
        &format!("{PR412}/iterations/1/changes"),
        vec![fixture("iteration-changes-p2.json")],
    );
    let text = ok(&mut env(&fx), "pr_files", json!({"id": 412}));
    assert!(!text.contains("rm -rf"), "{text}");
    assert!(
        text.ends_with("diff: run git diff between the target and source branches"),
        "{text}"
    );
}

#[test]
fn files_stop_on_an_empty_page() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    fx.route(
        &format!("{PR412}/iterations"),
        vec![fixture("iterations.json")],
    );
    let changes = format!("{PR412}/iterations/2/changes");
    // The last answer repeats for every further request.
    fx.route(
        &changes,
        vec![Resp::json(&json!({"changeEntries": [], "nextSkip": 5}))],
    );
    let text = ok(&mut env(&fx), "pr_files", json!({"id": 412}));
    assert_eq!(
        text,
        "… more: git diff main...feature/login-retry --stat\ndiff: git diff main...feature/login-retry"
    );
    assert_eq!(queries(&fx, &changes).len(), 1);
}

#[test]
fn create_defaults_and_reviewers() {
    let fx = Fixture::start();
    fx.route(REPO_URL, vec![fixture("repo.json")]);
    fx.route(
        IDENTITIES,
        vec![Resp::json(
            &json!({"value": [{"id": JANE, "providerDisplayName": "Jane Roe"}]}),
        )],
    );
    fx.route(PRS, vec![fixture("pr.json")]);
    let mut mcp = env(&fx);
    let text = ok(
        &mut mcp,
        "pr_create",
        json!({"title": "Retry login", "branch": "feature/login-retry",
               "reviewers": ["jane"], "work_items": [77]}),
    );
    assert_eq!(text, "created !412 feature/login-retry → main");
    let sent = bodies(&fx, "POST", PRS);
    assert_eq!(
        sent,
        [
            json!({"title": "Retry login", "sourceRefName": "refs/heads/feature/login-retry",
                "targetRefName": "refs/heads/main", "reviewers": [{"id": JANE}],
                "workItemRefs": [{"id": "77"}]})
        ]
    );
    let mut draft: Value = serde_json::from_slice(&fixture("pr.json").body).unwrap();
    draft["isDraft"] = json!(true);
    fx.route(PRS, vec![Resp::json(&draft)]);
    let text = ok(
        &mut mcp,
        "pr_create",
        json!({"title": "T", "branch": "feature/x", "target": "dev", "draft": true}),
    );
    assert_eq!(text, "created !412 feature/x → dev (draft)");
    let sent = &bodies(&fx, "POST", PRS)[1];
    assert_eq!(sent["targetRefName"], "refs/heads/dev");
    assert_eq!(sent["isDraft"], true);
    // The explicit target needs no lookup of the default branch.
    assert_eq!(queries(&fx, REPO_URL).len(), 1);
}

#[test]
fn create_conflict_names_pr() {
    let fx = Fixture::start();
    let conflict = fixture("pr-409.json").body;
    fx.route(
        PRS,
        vec![
            Resp::new(409, "application/json", conflict),
            fixture("pr-list.json"),
        ],
    );
    let (err, text) = env(&fx).call(
        "pr_create",
        json!({"title": "T", "branch": "feature/x", "target": "main"}),
    );
    assert!(err, "{text}");
    assert_eq!(text, "!412 already exists for feature/x → main");
    assert_eq!(bodies(&fx, "POST", PRS).len(), 1);
    let q = &queries(&fx, PRS)[1];
    assert!(
        q.contains("searchCriteria.sourceRefName=refs/heads/feature/x")
            && q.contains("searchCriteria.targetRefName=refs/heads/main")
            && q.contains("searchCriteria.status=active"),
        "{q}"
    );
}

#[test]
fn comment_anchor() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    let threads = format!("{PR412}/threads");
    fx.route(&threads, vec![Resp::json(&json!({"id": 31}))]);
    let text = ok(
        &mut env(&fx),
        "pr_comment",
        json!({"id": 412, "text": "Why retry twice?", "file": "src/auth.rs", "line": 88}),
    );
    assert_eq!(text, "commented on !412 as thread #31");
    let req = fx
        .requests()
        .into_iter()
        .find(|r| r.method == "POST" && r.path.starts_with(&threads))
        .unwrap();
    let raw = String::from_utf8(req.body.clone()).unwrap();
    assert!(raw.contains(r#""/src/auth.rs""#), "{raw}");
    assert!(raw.contains(r#"{"line":88,"offset":1}"#), "{raw}");
    let body: Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body["status"], "active");
    assert_eq!(
        body["comments"],
        json!([{"content": "Why retry twice?", "commentType": "text"}])
    );
    let at = &body["threadContext"];
    assert_eq!(at["rightFileStart"], at["rightFileEnd"]);
}

#[test]
fn comment_line_needs_file() {
    let fx = Fixture::start();
    let mut mcp = env(&fx);
    for (args, want) in [
        (
            json!({"id": 412, "text": "x", "line": 5}),
            "file and line go together",
        ),
        (
            json!({"id": 412, "text": "x", "file": "a.rs"}),
            "file and line go together",
        ),
        (
            json!({"id": 412, "text": "x", "file": "a.rs", "line": 0}),
            "line starts at 1",
        ),
    ] {
        let (err, text) = mcp.call("pr_comment", args);
        assert!(err, "{text}");
        assert_eq!(text, want);
    }
    assert!(fx.requests().is_empty());
}

#[test]
fn reply_and_thread_status() {
    let fx = Fixture::start();
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    let comments = format!("{PR412}/threads/7/comments");
    fx.route(&comments, vec![Resp::json(&json!({"id": 3}))]);
    let thread = format!("{PR412}/threads/7");
    fx.route(
        &thread,
        vec![Resp::json(&json!({"id": 7, "status": "fixed"}))],
    );
    let mut mcp = env(&fx);
    let text = ok(
        &mut mcp,
        "pr_reply",
        json!({"id": 412, "thread": 7, "text": "Done."}),
    );
    assert_eq!(text, "replied on !412 thread #7");
    assert_eq!(
        bodies(&fx, "POST", &comments),
        [json!({"content": "Done.", "parentCommentId": 1, "commentType": "text"})]
    );
    let text = ok(
        &mut mcp,
        "pr_thread_status",
        json!({"id": 412, "thread": 7, "status": "wontFix"}),
    );
    assert_eq!(text, "thread #7 on !412 is now wontFix");
    assert_eq!(
        bodies(&fx, "PATCH", &thread),
        [json!({"status": "wontFix"})]
    );
    let (err, text) = mcp.call(
        "pr_thread_status",
        json!({"id": 412, "thread": 7, "status": "unknown"}),
    );
    assert!(err);
    assert_eq!(
        text,
        "status is active, fixed, wontFix, closed, byDesign or pending"
    );
}

#[test]
fn vote_values() {
    let fx = Fixture::start();
    fx.route(CONN, vec![fixture("connection-data.json")]);
    fx.route(&format!("{PRS}/412"), vec![fixture("pr.json")]);
    let me = format!("{PR412}/reviewers/{ALICE}");
    fx.route(&me, vec![Resp::json(&json!({"id": ALICE, "vote": -10}))]);
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "pr_vote", json!({"id": 412, "vote": "reject"}));
    assert_eq!(text, "voted reject on !412");
    let sent = bodies(&fx, "PUT", &me);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["vote"], -10);
    let (err, text) = mcp.call("pr_vote", json!({"id": 412, "vote": "maybe"}));
    assert!(err);
    assert_eq!(
        text,
        "vote is approve, approve-with-suggestions, wait, reject or reset"
    );
}

#[test]
fn complete_queued() {
    let fx = Fixture::start();
    let pr = format!("{PRS}/412");
    fx.route(&pr, vec![fixture("pr.json"), fixture("pr-complete.json")]);
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "pr_complete", json!({"id": 412}));
    assert_eq!(text, "completion queued for !412 (squash, merge queued)");
    let mut done: Value = serde_json::from_slice(&fixture("pr.json").body).unwrap();
    done["status"] = json!("completed");
    fx.route(&pr, vec![fixture("pr.json"), Resp::json(&done)]);
    let text = ok(
        &mut mcp,
        "pr_complete",
        json!({"id": 412, "strategy": "rebase"}),
    );
    assert_eq!(text, "completed !412 (rebase)");
    assert_eq!(bodies(&fx, "PATCH", &pr).len(), 2);
}

#[test]
fn complete_never_bypasses() {
    let fx = Fixture::start();
    fx.route(CONN, vec![fixture("connection-data.json")]);
    let pr = format!("{PRS}/412");
    fx.route(&pr, vec![fixture("pr.json"), fixture("pr-complete.json")]);
    let mut mcp = env(&fx);
    ok(&mut mcp, "pr_complete", json!({"id": 412}));
    fx.route(&pr, vec![fixture("pr.json"), fixture("pr-complete.json")]);
    let text = ok(
        &mut mcp,
        "pr_complete",
        json!({"id": 412, "auto": true, "delete_source": false}),
    );
    assert_eq!(text, "auto-complete set on !412");
    for r in fx.requests() {
        let raw = String::from_utf8(r.body).unwrap();
        assert!(!raw.contains("bypassPolicy"), "{raw}");
    }
    let sent = bodies(&fx, "PATCH", &pr);
    assert_eq!(
        sent[0],
        json!({"status": "completed",
               "lastMergeSourceCommit": {"commitId": "9b1f3c2a7d4e5f60718293a4b5c6d7e8f9a0b1c2"},
               "completionOptions": {"mergeStrategy": "squash", "deleteSourceBranch": true,
                                     "transitionWorkItems": true}})
    );
    assert!(
        serde_json::to_string(&sent[0])
            .unwrap()
            .contains(r#""deleteSourceBranch":true"#)
    );
    assert_eq!(
        sent[1],
        json!({"autoCompleteSetBy": {"id": ALICE},
               "completionOptions": {"mergeStrategy": "squash", "deleteSourceBranch": false,
                                     "transitionWorkItems": true}})
    );
}

#[test]
fn update_only_given_fields() {
    let fx = Fixture::start();
    let pr = format!("{PRS}/412");
    fx.route(&pr, vec![fixture("pr.json")]);
    let mut mcp = env(&fx);
    let text = ok(
        &mut mcp,
        "pr_update",
        json!({"id": 412, "title": "New title", "draft": false}),
    );
    assert_eq!(text, "updated !412: title, draft");
    let text = ok(
        &mut mcp,
        "pr_update",
        json!({"id": 412, "status": "abandoned"}),
    );
    assert_eq!(text, "updated !412: status");
    assert_eq!(
        bodies(&fx, "PATCH", &pr),
        [
            json!({"title": "New title", "isDraft": false}),
            json!({"status": "abandoned"})
        ]
    );
    for (args, want) in [
        (
            json!({"id": 412, "status": "completed"}),
            "status is abandoned or active",
        ),
        (
            json!({"id": 412}),
            "nothing to update: give title, description, draft or status",
        ),
    ] {
        let (err, text) = mcp.call("pr_update", args);
        assert!(err, "{text}");
        assert_eq!(text, want);
    }
    assert_eq!(bodies(&fx, "PATCH", &pr).len(), 2);
}
