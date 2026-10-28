mod common;

use std::process::{Command, Stdio};

use common::{Fixture, Resp, ado};
use serde_json::json;

#[test]
fn version_flag() {
    let out = Command::new(env!("CARGO_BIN_EXE_ado-mcp"))
        .arg("--version")
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!("ado-mcp {}\n", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn initialize_has_instructions() {
    let fx = Fixture::start();
    let mcp = ado(&fx, &[]);
    let result = &mcp.init;
    let instructions = result["instructions"].as_str().unwrap();
    assert!(instructions.contains("git diff"), "{instructions}");
    assert!(instructions.contains("branch"), "{instructions}");
    assert!(instructions.chars().count() < 4096);
    assert!(result["capabilities"]["tools"].is_object(), "{result}");
}

#[test]
fn missing_url_is_one_line() {
    let out = Command::new(env!("CARGO_BIN_EXE_ado-mcp"))
        .env_remove("ADO_ORG_URL")
        .env("ADO_PAT", "test-pat")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("/plugin configure mcp-azure"), "{err}");
    assert!(!err.contains("test-pat"), "{err}");
}

#[test]
fn plain_http_url_is_refused() {
    let out = Command::new(env!("CARGO_BIN_EXE_ado-mcp"))
        .env("ADO_ORG_URL", "http://ado.example/tfs/Coll/")
        .env("ADO_PAT", "test-pat")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(
        err.contains("ADO_ORG_URL must be https (the PAT would travel in clear text)"),
        "{err}"
    );
}

const READS: [&str; 13] = [
    "pipeline_log",
    "pipeline_runs",
    "pipeline_view",
    "pr_files",
    "pr_list",
    "pr_threads",
    "pr_view",
    "project_list",
    "repo_file",
    "repo_list",
    "search",
    "wi_query",
    "wi_view",
];
const WRITES: [&str; 12] = [
    "pipeline_cancel",
    "pipeline_run",
    "pr_comment",
    "pr_complete",
    "pr_create",
    "pr_reply",
    "pr_thread_status",
    "pr_update",
    "pr_vote",
    "wi_comment",
    "wi_create",
    "wi_update",
];
const PAT_LINE: &str = "Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure";

#[test]
fn tools_and_marks() {
    let fx = Fixture::start();
    let tools = ado(&fx, &[]).request("tools/list", json!({}))["tools"].take();
    let tools = tools.as_array().unwrap();
    let mut names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    names.sort_unstable();
    let mut all = [READS.as_slice(), WRITES.as_slice()].concat();
    all.sort_unstable();
    assert_eq!(names, all);
    for t in tools {
        let name = t["name"].as_str().unwrap();
        let ask = &t["_meta"]["anthropic/requiresUserInteraction"];
        let read_only = &t["annotations"]["readOnlyHint"];
        if WRITES.contains(&name) {
            assert!(*ask == true && read_only.is_null(), "{t}");
        } else {
            assert!(*read_only == true && ask.is_null(), "{t}");
        }
        let desc = t["description"].as_str().unwrap();
        assert!(desc.chars().count() < 400, "{name}: {}", desc.len());
    }
}

#[test]
fn errors_are_tool_errors_without_pat() {
    let fx = Fixture::start();
    let denied = || vec![Resp::new(401, "text/plain", "Basic OnRlc3QtcGF0 test-pat")];
    // The first request of each tool: project and repo are given, so no `/vsts/info`.
    for path in [
        "/tfs/Coll/_apis/projects/P",
        "/tfs/Coll/P/_apis/git/repositories/R",
        "/tfs/Coll/_apis/wit/workitems/1",
        "/tfs/Coll/_apis/projects",
    ] {
        fx.route(path, denied());
    }
    let at = json!({"project": "P", "repo": "R", "id": 1});
    let calls = [
        ("pr_list", json!({})),
        ("pr_view", json!({})),
        ("pr_threads", json!({})),
        ("pr_files", json!({})),
        ("pr_create", json!({"title": "t", "branch": "b"})),
        ("pr_update", json!({"title": "t"})),
        ("pr_comment", json!({"text": "t"})),
        ("pr_reply", json!({"thread": 1, "text": "t"})),
        ("pr_thread_status", json!({"thread": 1, "status": "fixed"})),
        ("pr_vote", json!({"vote": "approve"})),
        ("pr_complete", json!({})),
        ("wi_view", json!({})),
        ("wi_query", json!({})),
        ("wi_create", json!({"type": "Bug", "title": "t"})),
        ("wi_update", json!({"title": "t"})),
        ("wi_comment", json!({"text": "t"})),
        ("pipeline_run", json!({"pipeline": "7", "branch": "b"})),
        ("pipeline_cancel", json!({"run": 1})),
        ("pipeline_runs", json!({})),
        ("pipeline_view", json!({"run": 1})),
        ("pipeline_log", json!({"run": 1})),
        ("repo_file", json!({"path": "/a"})),
        ("repo_list", json!({})),
        ("project_list", json!({})),
        ("search", json!({"kind": "code", "text": "x"})),
    ];
    let mut called: Vec<&str> = calls.iter().map(|c| c.0).collect();
    called.sort_unstable();
    let mut all = [READS.as_slice(), WRITES.as_slice()].concat();
    all.sort_unstable();
    assert_eq!(called, all);
    let mut mcp = ado(&fx, &[]);
    for (tool, extra) in calls {
        let mut args = at.clone();
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let raw = mcp.request_raw("tools/call", json!({"name": tool, "arguments": args}));
        let r = &raw["result"];
        assert!(r["isError"] == true, "{tool}: {raw}");
        assert_eq!(common::text(r), PAT_LINE, "{tool}");
        assert!(!raw.to_string().contains("test-pat"), "{tool}: {raw}");
    }
}
