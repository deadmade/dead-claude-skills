use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

#[test]
fn lists_three_tools() {
    let project = std::env::temp_dir().join(format!("web-mcp-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&project).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_web-mcp"))
        .env("CLAUDE_PROJECT_DIR", &project)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut send = |m: Value| writeln!(stdin, "{m}").unwrap();
    send(
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"t","version":"0"}}}),
    );
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
    send(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    line.clear();
    out.read_line(&mut line).unwrap();
    let v: Value = serde_json::from_str(&line).unwrap();
    let mut tools = v["result"]["tools"].as_array().unwrap().clone();
    tools.sort_by_key(|t| t["name"].as_str().unwrap().to_string());
    let names: Vec<_> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["browser", "fetch", "search"]);
    let [browser, fetch, search] = [&tools[0], &tools[1], &tools[2]];
    assert_eq!(search["annotations"]["readOnlyHint"], true);
    assert_eq!(fetch["annotations"]["readOnlyHint"], true);
    assert_ne!(browser["annotations"]["readOnlyHint"], true);
    assert_eq!(fetch["_meta"]["anthropic/maxResultSizeChars"], 200_000);
    let required = browser["inputSchema"]["required"].as_array().unwrap();
    assert!(required.iter().any(|r| r == "session"));
    drop(stdin);
    child.wait().unwrap();
}
