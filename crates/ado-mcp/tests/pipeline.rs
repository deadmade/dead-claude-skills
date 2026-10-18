mod common;

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const BUILDS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds";
/// No timeline id: the build's own timeline.
const TIMELINE: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds/77/timeline/";
const LOGS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds/77/logs";
const REPOS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories";
const TIMEOUT: &str =
    "error The job running on agent Hosted 2 ran longer than the maximum time of 60 minutes.";

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

/// The decoded queries of the requests to `path`.
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
        })
        .collect()
}

/// A run whose `Run tests` step failed (log 4) and whose `Deploy` job timed out with no failed step.
fn run_routes(fx: &Fixture) {
    fx.route(TIMELINE, vec![fixture("timeline.json")]);
    let log = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/log.txt"
    ))
    .unwrap();
    fx.route(
        &format!("{LOGS}/4"),
        vec![Resp::new(200, "text/plain", log)],
    );
    fx.route(LOGS, vec![fixture("logs.json")]);
}

#[test]
fn log_crlf_and_missing_log() {
    let fx = Fixture::start();
    run_routes(&fx);
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "pipeline_log", json!({"run": 77}));
    assert!(text.starts_with("Run tests: failed\n"), "{text}");
    for noise in ["\r", "\x1b", "##[", "2026-03-05T", "[32m"] {
        assert!(!text.contains(noise), "{noise:?} in {text}");
    }
    for kept in [
        "ERROR boom",
        "WARNING slow test",
        "cargo test",
        "running 3 tests",
    ] {
        assert!(text.contains(kept), "{kept} missing in {text}");
    }
    let text = ok(
        &mut mcp,
        "pipeline_log",
        json!({"run": 77, "step": "publish"}),
    );
    assert_eq!(text, "Publish: no log (skipped)");
    let (err, text) = mcp.call("pipeline_log", json!({"run": 77, "step": "nope"}));
    assert!(err);
    assert_eq!(
        text,
        "no step \"nope\" in run #77; its steps: Publish, Checkout, Run tests, Deploy app"
    );
}

#[test]
fn job_failed_without_step() {
    let fx = Fixture::start();
    run_routes(&fx);
    let text = ok(&mut env(&fx), "pipeline_log", json!({"run": 77}));
    assert!(
        text.ends_with(&format!(
            "\n\nDeploy: failed with no failed step\n  {TIMEOUT}"
        )),
        "{text}"
    );
    // The job's canceled step isn't fetched, nor is any job log.
    for id in [2, 5, 6] {
        assert_eq!(queries(&fx, &format!("{LOGS}/{id}")).len(), 0, "log {id}");
    }
}

#[test]
fn log_full_paged() {
    let fx = Fixture::start();
    run_routes(&fx);
    // A whole page of 2000 lines, the last an error; `logs.json` says the log has 2500.
    let page = (1..2000)
        .map(|i| format!("line {i}"))
        .collect::<Vec<_>>()
        .join("\r\n")
        + "\r\n";
    fx.route(
        &format!("{LOGS}/4"),
        vec![Resp::new(200, "text/plain", page + "##[error]boom\r\n")],
    );
    let text = ok(
        &mut env(&fx),
        "pipeline_log",
        json!({"run": 77, "step": "Run tests", "full": true}),
    );
    assert!(text.contains("ERROR boom"), "{text}");
    assert!(!text.contains("--- last 50 lines ---"), "{text}");
    assert!(
        text.ends_with("\n… more: pipeline_log run=77 step=\"Run tests\" full=true start=2001"),
        "{text}"
    );
    let q = &queries(&fx, &format!("{LOGS}/4"))[0];
    assert!(
        q.contains("startLine=1") && q.contains("endLine=2000"),
        "{q}"
    );
}

#[test]
fn view_tree_skips_phase() {
    let fx = Fixture::start();
    run_routes(&fx);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    assert_eq!(
        text,
        format!(
            "Build: failed 5m 0s\n  Test: failed 2m 54s\nDeploy stage: failed 1h 0m\n  Deploy: failed 1h 0m\n\
             issues:\n  error boom\n  {TIMEOUT}"
        )
    );
}

#[test]
fn runs_by_pr_uses_merge_ref() {
    let fx = Fixture::start();
    fx.route(BUILDS, vec![fixture("builds.json")]);
    let mut mcp = env(&fx);
    let text = ok(
        &mut mcp,
        "pipeline_runs",
        json!({"pr": 412, "pipeline": "12", "result": "failed"}),
    );
    assert_eq!(
        text,
        "#1001 CI  refs/pull/412/merge  failed  2026-03-05  4m 55s\n#1000 CI  main  inProgress  2026-03-05"
    );
    let q = &queries(&fx, BUILDS)[0];
    for part in [
        "branchName=refs/pull/412/merge",
        "definitions=12",
        "resultFilter=failed",
        "queryOrder=queueTimeDescending",
        "$top=21",
    ] {
        assert!(q.contains(part), "{part} missing in {q}");
    }
    let text = ok(
        &mut mcp,
        "pipeline_runs",
        json!({"branch": "main", "limit": 1}),
    );
    assert!(
        text.ends_with("\n… more: pipeline_runs branch=main limit=2"),
        "{text}"
    );
    assert!(queries(&fx, BUILDS)[1].contains("branchName=refs/heads/main"));
}

#[test]
fn repo_list_lines() {
    let fx = Fixture::start();
    fx.route(REPOS, vec![fixture("repos.json")]);
    let text = ok(&mut env(&fx), "repo_list", json!({}));
    assert_eq!(
        text,
        "Empty  default: none\nR  default: main\nTools  default: develop"
    );
}

#[test]
fn log_full_one_step_and_unknown_count() {
    let fx = Fixture::start();
    run_routes(&fx);
    fx.route(TIMELINE, vec![Resp::json(&two_failed_steps())]);
    fx.route(
        &format!("{LOGS}/3"),
        vec![Resp::new(200, "text/plain", "cloning\r\n")],
    );
    fx.route(LOGS, vec![Resp::new(500, "text/plain", "down")]);
    let text = ok(
        &mut env(&fx),
        "pipeline_log",
        json!({"run": 77, "full": true}),
    );
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines[0],
        "showing Checkout only; also failed: Run tests; pass step to page through one"
    );
    assert_eq!(lines[2], "Checkout: failed");
    assert_eq!(lines[3], "cloning");
    assert!(
        lines[4].starts_with("… line count unavailable (")
            && lines[4].ends_with(
                "); if the log goes on: pipeline_log run=77 step=\"Checkout\" full=true start=2"
            ),
        "{text}"
    );
    assert_eq!(queries(&fx, &format!("{LOGS}/4")).len(), 0, "{text}");
}

/// The fixture timeline with `Checkout` failed too.
fn two_failed_steps() -> Value {
    let mut timeline: Value = serde_json::from_slice(&fixture("timeline.json").body).unwrap();
    for r in timeline["records"].as_array_mut().unwrap() {
        if r["name"] == "Checkout" {
            r["result"] = json!("failed");
        }
    }
    timeline
}

#[test]
fn log_budget_names_the_rest() {
    let fx = Fixture::start();
    run_routes(&fx);
    fx.route(TIMELINE, vec![Resp::json(&two_failed_steps())]);
    // 60 lines of 1000 characters: the tail alone is past the 40,000-character budget.
    let big = format!("{}\r\n", "x".repeat(1000)).repeat(60);
    fx.route(
        &format!("{LOGS}/3"),
        vec![Resp::new(200, "text/plain", big)],
    );
    let text = ok(&mut env(&fx), "pipeline_log", json!({"run": 77}));
    assert!(text.chars().count() <= 40_000, "{}", text.len());
    assert!(text.starts_with("Checkout: failed\n"), "{text}");
    assert!(
        text.contains(
            "\n… cut at the output limit: pipeline_log run=77 step=\"Checkout\" full=true start=1\n"
        ),
        "{text}"
    );
    assert!(
        text.ends_with(
            "\n\n… output limit reached; not shown: pipeline_log run=77 step=\"Run tests\", Deploy (pipeline_view run=77)"
        ),
        "{text}"
    );
    assert_eq!(queries(&fx, &format!("{LOGS}/4")).len(), 0);
}

#[test]
fn log_matrix_steps_failed_first() {
    let fx = Fixture::start();
    run_routes(&fx);
    let log = |id: i32| json!({"id": id, "type": "Container", "url": format!("http://dev.example{LOGS}/{id}")});
    let mut records = Vec::new();
    for (i, (job, result)) in [
        ("Linux", "succeeded"),
        ("Windows", "failed"),
        ("Mac", "failed"),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("j{i}");
        records.push(json!({"id": id, "type": "Job", "name": job, "result": result, "order": i}));
        records.push(
            json!({"id": format!("t{i}"), "parentId": id, "type": "Task", "name": "Build",
            "result": result, "order": 1, "log": log(11 + i32::try_from(i).unwrap())}),
        );
    }
    fx.route(TIMELINE, vec![Resp::json(&json!({"records": records}))]);
    fx.route(
        &format!("{LOGS}/12"),
        vec![Resp::new(200, "text/plain", "on windows\r\n")],
    );
    let text = ok(
        &mut env(&fx),
        "pipeline_log",
        json!({"run": 77, "step": "build", "full": true}),
    );
    assert!(
        text.starts_with(
            "3 steps named \"Build\"; showing job Windows's\n\nBuild: failed\non windows"
        ),
        "{text}"
    );
    for id in [11, 13] {
        assert_eq!(queries(&fx, &format!("{LOGS}/{id}")).len(), 0, "log {id}");
    }
}
