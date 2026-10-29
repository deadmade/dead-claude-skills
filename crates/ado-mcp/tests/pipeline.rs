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
    fx.route(
        TEST_RUNS,
        vec![Resp::json(&json!({"count": 0, "value": []}))],
    );
}

const TEST_RUNS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/test/runs";

/// A test run's results.
fn results(id: u32) -> String {
    format!("/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/test/Runs/{id}/results")
}

/// `pipeline_view run=77`'s reply without test results.
fn view_base() -> String {
    format!(
        "Build: failed 5m 0s\n  Test: failed 2m 54s\nDeploy stage: failed 1h 0m\n  Deploy: failed 1h 0m\n\
         issues:\n  error boom\n  {TIMEOUT}"
    )
}

/// The run's test runs (`Unit` twice: a retried job) and the latest attempt's failed test.
fn test_routes(fx: &Fixture) {
    fx.route(TEST_RUNS, vec![fixture("test-runs.json")]);
    fx.route(&results(42), vec![fixture("test-results.json")]);
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
fn tests_summary_and_failures() {
    let fx = Fixture::start();
    run_routes(&fx);
    test_routes(&fx);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    // Skipped: 5 − 3 − 0 of Integration; the latest attempt's 10 − 9 − 1 none. Five stack lines of seven.
    assert_eq!(
        text,
        format!(
            "{}\ntests: 12 passed, 1 failed, 2 skipped\n\
             \x20 ParsesEmptyInput: Assert.AreEqual failed. Expected:<1>. Actual:<0>.\n\
             \x20   at Parser.Tests.ParsesEmptyInput() in C:\\a\\1\\s\\Parser.Tests\\ParserTests.cs:line 20\n\
             \x20   at Frame2()\n    at Frame3()\n    at Frame4()\n    at Frame5()",
            view_base()
        )
    );
}

/// A run that isn't there: the timeline's 404 is the whole answer, though the test runs answered.
#[test]
fn view_missing_run() {
    let fx = Fixture::start();
    let timeline = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/builds/99/timeline/";
    fx.route(timeline, vec![Resp::new(404, "text/plain", "gone")]);
    test_routes(&fx);
    let (err, text) = env(&fx).call("pipeline_view", json!({"run": 99}));
    assert!(err, "{text}");
    assert_eq!(text, "not found: run #99");
}

/// A project that isn't there is named as given, and nothing of the run is asked for.
#[test]
fn view_unknown_project() {
    let fx = Fixture::start();
    let gone = json!({"message": "TF200016: The following project does not exist: 0f3c2b1a-9d8e-4f7a-b6c5-d4e3f2a1b0c9"});
    fx.route(
        "/tfs/Coll/_apis/projects/Nope",
        vec![Resp::new(404, "application/json", gone.to_string())],
    );
    let (err, text) = env(&fx).call("pipeline_view", json!({"run": 77, "project": "Nope"}));
    assert!(err, "{text}");
    assert_eq!(text, "not found: project Nope");
    assert!(sent(&fx, TIMELINE).is_empty() && sent(&fx, TEST_RUNS).is_empty());
}

#[test]
fn no_test_runs_adds_nothing() {
    let fx = Fixture::start();
    run_routes(&fx);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    assert_eq!(text, view_base());
    assert_eq!(sent(&fx, TEST_RUNS).len(), 1);
}

/// A server without the test area answers 404: nothing is added.
#[test]
fn test_area_404_adds_nothing() {
    let fx = Fixture::start();
    run_routes(&fx);
    fx.route(TEST_RUNS, vec![Resp::new(404, "text/plain", "gone")]);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    assert_eq!(text, view_base());
}

/// A retried job counts at its latest attempt only: no results of the first attempt are read. A same-named run of
/// another job counts.
#[test]
fn retried_job_counts_latest_attempt() {
    let fx = Fixture::start();
    run_routes(&fx);
    test_routes(&fx);
    let mut mcp = env(&fx);
    ok(&mut mcp, "pipeline_view", json!({"run": 77}));
    assert_eq!(sent(&fx, &results(41)).len(), 0);
    assert_eq!(sent(&fx, &results(43)).len(), 0, "no failures in it");
    // The retry passed: the first attempt's 3 failures don't show.
    let mut runs: Value = serde_json::from_slice(&fixture("test-runs.json").body).unwrap();
    runs["value"][1]["passedTests"] = json!(10);
    runs["value"][1]["unanalyzedTests"] = json!(0);
    fx.route(TEST_RUNS, vec![Resp::json(&runs)]);
    let text = ok(&mut mcp, "pipeline_view", json!({"run": 77}));
    assert!(
        text.ends_with("\ntests: 13 passed, 0 failed, 2 skipped"),
        "{text}"
    );
    assert_eq!(sent(&fx, &results(41)).len(), 0);
    // Run 41 renamed to another job: it counts too.
    runs["value"][0]["pipelineReference"]["phaseReference"]["phaseName"] = json!("Test Linux");
    fx.route(TEST_RUNS, vec![Resp::json(&runs)]);
    fx.route(&results(41), vec![fixture("test-results.json")]);
    let text = ok(&mut mcp, "pipeline_view", json!({"run": 77}));
    assert!(
        text.contains("\ntests: 20 passed, 3 failed, 2 skipped\n  ParsesEmptyInput: "),
        "{text}"
    );
    assert_eq!(sent(&fx, &results(41)).len(), 1);
}

#[test]
fn runs_query() {
    let fx = Fixture::start();
    run_routes(&fx);
    test_routes(&fx);
    ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    // `buildUri` is one query value, escaped once.
    let raw = &sent(&fx, TEST_RUNS)[0].path;
    assert!(
        raw.contains("buildUri=vstfs%3A%2F%2F%2FBuild%2FBuild%2F77"),
        "{raw}"
    );
    assert!(raw.contains("includeRunDetails=true"), "{raw}");
    let q = &queries(&fx, &results(42))[0];
    assert!(
        q.contains("outcomes=Failed") && q.contains("$top=20"),
        "{q}"
    );
}

/// A results call that fails keeps the stages, the issues and the summary, plus one line instead of the more line; a
/// 404 names no path.
#[test]
fn results_failure_keeps_summary() {
    for (resp, why) in [
        (
            Resp::new(404, "text/plain", "gone"),
            "not found: test results",
        ),
        (
            Resp::new(500, "text/plain", "down"),
            "the server failed (500); try again",
        ),
    ] {
        let fx = Fixture::start();
        run_routes(&fx);
        test_routes(&fx);
        fx.route(&results(42), vec![resp]);
        let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
        assert_eq!(
            text,
            format!(
                "{}\ntests: 12 passed, 1 failed, 2 skipped\n\
                 \x20 failed tests couldn't be read ({why})",
                view_base()
            )
        );
    }
}

/// Failed results of `n` tests named `<prefix><i>`.
fn failed_results(prefix: &str, n: usize) -> Resp {
    let value: Vec<Value> = (0..n)
        .map(|i| json!({"testCaseTitle": format!("{prefix}{i}"), "outcome": "Failed"}))
        .collect();
    Resp::json(&json!({"count": n, "value": value}))
}

/// The 20 failed tests span the runs: the second run is asked for what is left.
#[test]
fn failed_cap_across_runs() {
    let fx = Fixture::start();
    run_routes(&fx);
    let run = |id: u32, name: &str, failed: u32| json!({"id": id, "name": name, "totalTests": failed, "passedTests": 0, "unanalyzedTests": failed});
    fx.route(
        TEST_RUNS,
        vec![Resp::json(
            &json!({"count": 2, "value": [run(51, "B", 10), run(50, "A", 15)]}),
        )],
    );
    fx.route(&results(50), vec![failed_results("a", 15)]);
    fx.route(&results(51), vec![failed_results("b", 10)]);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    let q = &queries(&fx, &results(51))[0];
    assert!(q.contains("$top=5"), "{q}");
    let tests: Vec<&str> = text
        .lines()
        .skip_while(|l| !l.starts_with("tests:"))
        .collect();
    assert_eq!(tests[0], "tests: 0 passed, 25 failed, 0 skipped");
    assert_eq!(tests.len(), 1 + 20 + 1, "{text}");
    assert_eq!((tests[15], tests[16], tests[20]), ("  a14", "  b0", "  b4"));
    assert_eq!(tests[21], "  … 5 more failed tests: pipeline_log run=77");
}

/// A results call that fails after another run's were read keeps the failures read so far, and no more line.
#[test]
fn results_failure_keeps_failures_read() {
    let fx = Fixture::start();
    run_routes(&fx);
    let run = |id: u32, name: &str, failed: u32| json!({"id": id, "name": name, "totalTests": failed, "passedTests": 0, "unanalyzedTests": failed});
    fx.route(
        TEST_RUNS,
        vec![Resp::json(
            &json!({"count": 2, "value": [run(50, "A", 2), run(51, "B", 3)]}),
        )],
    );
    fx.route(&results(50), vec![failed_results("a", 2)]);
    fx.route(&results(51), vec![Resp::new(500, "text/plain", "down")]);
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    let tests: Vec<&str> = text
        .lines()
        .skip_while(|l| !l.starts_with("tests:"))
        .collect();
    assert_eq!(
        tests,
        [
            "tests: 0 passed, 5 failed, 0 skipped",
            "  a0",
            "  a1",
            "  failed tests couldn't be read (the server failed (500); try again)"
        ]
    );
}

/// A test-runs call that fails keeps the stages and issues, plus one line.
#[test]
fn test_403_keeps_stages() {
    let fx = Fixture::start();
    run_routes(&fx);
    fx.route(
        TEST_RUNS,
        vec![Resp::new(403, "application/json", r#"{"message":"no"}"#)],
    );
    let text = ok(&mut env(&fx), "pipeline_view", json!({"run": 77}));
    assert_eq!(
        text,
        format!(
            "{}\ntests: couldn't be read (the PAT may not do this: it needs the Test Management (Read) scope)",
            view_base()
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

const DEFS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/build/definitions";
const RUNS12: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/pipelines/12/runs";

fn sent(fx: &Fixture, path: &str) -> Vec<common::Req> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(path))
        .collect()
}

fn body(r: &common::Req) -> Value {
    serde_json::from_slice(&r.body).unwrap()
}

#[test]
fn run_ref_and_params() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    fx.route(RUNS12, vec![fixture("pipeline-run.json")]);
    let mut mcp = env(&fx);
    let text = ok(
        &mut mcp,
        "pipeline_run",
        json!({"pipeline": "CI", "branch": "feature/x", "parameters": {"env": "staging", "dry": "true"}}),
    );
    assert_eq!(text, "queued run #78 of CI on feature/x");
    // No branch: the clone's.
    let text = ok(&mut mcp, "pipeline_run", json!({"pipeline": "12"}));
    assert_eq!(text, "queued run #78 of CI on main");
    let reqs = sent(&fx, RUNS12);
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0].method, "POST");
    assert!(!reqs[0].path.contains("staging"), "{}", reqs[0].path);
    assert_eq!(
        body(&reqs[0]),
        json!({
            "resources": {"repositories": {"self": {"refName": "refs/heads/feature/x"}}},
            "templateParameters": {"dry": "true", "env": "staging"},
        })
    );
    assert_eq!(
        body(&reqs[1]),
        json!({"resources": {"repositories": {"self": {"refName": "refs/heads/main"}}}})
    );
}

#[test]
fn cancel_body() {
    let fx = Fixture::start();
    let build = format!("{BUILDS}/77");
    fx.route(
        &build,
        vec![Resp::json(&json!({"id": 77, "status": "cancelling"}))],
    );
    let text = ok(&mut env(&fx), "pipeline_cancel", json!({"run": 77}));
    assert_eq!(text, "cancelling run #77");
    let reqs = sent(&fx, &build);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].method, "PATCH");
    assert_eq!(reqs[0].header("content-type"), Some("application/json"));
    assert_eq!(queries(&fx, &build), ["api-version=7.1-preview"]);
    assert_eq!(body(&reqs[0]), json!({"status": "cancelling"}));
}

#[test]
fn pipeline_write_sent_once_on_404() {
    let fx = Fixture::start();
    let build = format!("{BUILDS}/77");
    fx.route(&build, vec![Resp::new(404, "text/plain", "gone")]);
    fx.route(RUNS12, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = env(&fx);
    for (tool, args, want) in [
        ("pipeline_cancel", json!({"run": 77}), "not found: run #77"),
        (
            "pipeline_run",
            json!({"pipeline": "12", "branch": "main"}),
            "not found: pipeline 12",
        ),
    ] {
        let (err, text) = mcp.call(tool, args);
        assert!(err, "{tool}: {text}");
        assert_eq!(text, want);
    }
    assert_eq!(sent(&fx, &build).len(), 1);
    assert_eq!(sent(&fx, RUNS12).len(), 1);
}

#[test]
fn log_default_reads_the_last_lines() {
    let fx = Fixture::start();
    run_routes(&fx);
    let mut logs: Value = serde_json::from_slice(&fixture("logs.json").body).unwrap();
    logs["value"][2]["lineCount"] = json!(25_000);
    fx.route(LOGS, vec![Resp::json(&logs)]);
    // The window's 20,000 lines: 400 errors first, so the excerpt points past them.
    let body = "##[error]x\r\n".repeat(400) + &"ok\r\n".repeat(19_600);
    fx.route(
        &format!("{LOGS}/4"),
        vec![Resp::new(200, "text/plain", body)],
    );
    let text = ok(&mut env(&fx), "pipeline_log", json!({"run": 77}));
    assert!(
        text.starts_with(
            "Run tests: failed (first 5000 lines not read; pipeline_log run=77 step=\"Run tests\" full=true start=1 shows them)\n"
        ),
        "{}",
        &text[..300]
    );
    assert!(
        text.contains(
            "more error lines: pipeline_log run=77 step=\"Run tests\" full=true start=5301\n"
        ),
        "{text}"
    );
    let q = &queries(&fx, &format!("{LOGS}/4"))[0];
    assert!(
        q.contains("startLine=5001") && q.contains("endLine=25000"),
        "{q}"
    );
}

#[test]
fn run_404_resolves_the_name_again() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    fx.route(RUNS12, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = env(&fx);
    for _ in 0..2 {
        let (err, text) = mcp.call("pipeline_run", json!({"pipeline": "CI", "branch": "main"}));
        assert!(err, "{text}");
        assert_eq!(text, "not found: pipeline CI");
    }
    assert_eq!(sent(&fx, DEFS).len(), 2);
    assert_eq!(sent(&fx, RUNS12).len(), 2);
}

#[test]
fn runs_404_resolves_the_name_again() {
    let fx = Fixture::start();
    fx.route(DEFS, vec![fixture("definitions.json")]);
    fx.route(
        BUILDS,
        vec![Resp::new(404, "text/plain", "gone"), fixture("builds.json")],
    );
    let text = ok(&mut env(&fx), "pipeline_runs", json!({"pipeline": "CI"}));
    assert!(text.starts_with("#1001 CI"), "{text}");
    assert_eq!(sent(&fx, DEFS).len(), 2);
}

#[test]
fn log_window_offset_when_range_ignored() {
    let fx = Fixture::start();
    run_routes(&fx);
    let mut logs: Value = serde_json::from_slice(&fixture("logs.json").body).unwrap();
    logs["value"][2]["lineCount"] = json!(25_000);
    fx.route(LOGS, vec![Resp::json(&logs)]);
    // The server ignored the range and sent 26,000 lines (the log grew): the last 20,000 start at line 6001.
    let body = "ok\r\n".repeat(6000) + &"##[error]x\r\n".repeat(400) + &"ok\r\n".repeat(19_600);
    fx.route(
        &format!("{LOGS}/4"),
        vec![Resp::new(200, "text/plain", body)],
    );
    let text = ok(&mut env(&fx), "pipeline_log", json!({"run": 77}));
    assert!(
        text.contains(
            "more error lines: pipeline_log run=77 step=\"Run tests\" full=true start=6301\n"
        ),
        "{}",
        &text[..400]
    );
}

#[test]
fn log_default_small_or_unknown_count_reads_whole() {
    for count in [json!(20_000), Value::Null] {
        let fx = Fixture::start();
        run_routes(&fx);
        let mut logs: Value = serde_json::from_slice(&fixture("logs.json").body).unwrap();
        logs["value"][2]["lineCount"] = count.clone();
        fx.route(LOGS, vec![Resp::json(&logs)]);
        let text = ok(&mut env(&fx), "pipeline_log", json!({"run": 77}));
        assert!(text.starts_with("Run tests: failed\n"), "{count}: {text}");
        let q = &queries(&fx, &format!("{LOGS}/4"))[0];
        assert!(
            !q.contains("startLine") && !q.contains("endLine"),
            "{count}: {q}"
        );
    }
}
