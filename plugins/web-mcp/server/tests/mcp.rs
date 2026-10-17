use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

#[test]
fn lists_four_tools() {
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
    assert_eq!(names, ["browser", "fetch", "lookup", "search"]);
    let [browser, fetch, lookup, search] = [&tools[0], &tools[1], &tools[2], &tools[3]];
    assert_eq!(lookup["annotations"]["readOnlyHint"], true);
    assert!(lookup["description"].as_str().unwrap().contains("cite"));
    assert_eq!(search["annotations"]["readOnlyHint"], true);
    assert_eq!(fetch["annotations"]["readOnlyHint"], true);
    assert_ne!(browser["annotations"]["readOnlyHint"], true);
    assert_eq!(fetch["_meta"]["anthropic/maxResultSizeChars"], 200_000);
    let required = browser["inputSchema"]["required"].as_array().unwrap();
    assert!(required.iter().any(|r| r == "session"));
    let props = &browser["inputSchema"]["properties"];
    assert!(
        props["text"]["description"]
            .as_str()
            .unwrap()
            .contains("scroll"),
        "{props}"
    );
    assert!(
        props["ref"]["description"]
            .as_str()
            .unwrap()
            .contains("@eN"),
        "{props}"
    );
    assert!(search["description"].as_str().unwrap().contains("DOI"));
    assert!(
        fetch["description"]
            .as_str()
            .unwrap()
            .contains("archive path")
    );
    assert!(browser["description"].as_str().unwrap().contains("close"));
    for t in [browser, fetch, lookup, search] {
        let size =
            t["description"].to_string().len() + t["inputSchema"]["properties"].to_string().len();
        assert!(size < 1200, "{size} bytes of schema for {}", t["name"]);
    }
    drop(stdin);
    child.wait().unwrap();
}
