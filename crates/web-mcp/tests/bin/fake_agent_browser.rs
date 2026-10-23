//! A stand-in for agent-browser: appends its argv, stdin, `AGENT_BROWSER_*` env and cwd as a JSON line to
//! `$FAKE_AB_LOG` (unset: to `calls.jsonl` beside its `--config`, if any) and prints canned `--json` answers.
//! An `open` of a URL containing "fail" fails; a batch's `wait` fails for a URL containing "wait-fail".
use std::io::{Read, Write};
use std::path::Path;

use serde_json::{Value, json};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut stdin = String::new();
    if args.iter().any(|a| a == "batch") {
        let _ = std::io::stdin().read_to_string(&mut stdin);
    }
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .map_or("", |i| args[i + 1].as_str())
    };
    let config = flag("--config");
    let log = std::env::var("FAKE_AB_LOG").ok().or_else(|| {
        Path::new(config)
            .parent()
            .filter(|_| !config.is_empty())
            .map(|d| d.join("calls.jsonl").to_string_lossy().into_owned())
    });
    if let Some(log) = log {
        let env: serde_json::Map<String, Value> = std::env::vars()
            .filter(|(k, _)| k.starts_with("AGENT_BROWSER_"))
            .map(|(k, v)| (k, json!(v)))
            .collect();
        let cwd = std::env::current_dir().unwrap();
        let line = json!({"args": args, "stdin": stdin, "env": env, "cwd": cwd});
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .unwrap();
        f.write_all(format!("{line}\n").as_bytes()).unwrap(); // one write: parallel calls must not interleave
    }
    // Skip the global flags: --session <s>, --config <path>, --json, --max-output <n>, --content-boundaries.
    let mut rest = args.as_slice();
    while let Some(first) = rest.first() {
        let skip = match first.as_str() {
            "--session" | "--config" | "--max-output" => 2,
            "--json" | "--content-boundaries" => 1,
            _ => break,
        };
        rest = &rest[skip..];
    }
    let session = flag("--session");
    let out = match rest.first().map(String::as_str) {
        Some("batch") => {
            let cmds: Vec<Vec<String>> = serde_json::from_str(&stdin).unwrap();
            if stdin.contains("/slow") {
                std::thread::sleep(std::time::Duration::from_secs(3)); // a page that hangs
            }
            let url = cmds
                .iter()
                .find(|c| c[0] == "open")
                .map_or("", |c| c[1].as_str());
            let html = format!(
                "<html><body><main><article><h1>Rendered</h1><p>Rendered page for {url} in {session}. {}</p></article></main></body></html>",
                "It has plenty of words once a browser has run its scripts. ".repeat(6)
            );
            // A redirect to the user's own network, for the fallback's landing check.
            let landed = if url.contains("redirect-private") {
                "http://127.0.0.1/admin"
            } else {
                url
            };
            let entries: Vec<Value> = cmds
                .iter()
                .map(|c| {
                    if c[0] == "wait" && url.contains("wait-fail") {
                        return json!({"command": c, "success": false, "result": null, "error": "timed out"});
                    }
                    let result = match c.get(1).map(String::as_str) {
                        Some("html") => json!({"html": html}),
                        Some("url") => json!(landed),
                        _ => json!({"url": url}),
                    };
                    json!({"command": c, "success": true, "result": result})
                })
                .collect();
            Value::Array(entries)
        }
        Some("open") if rest.get(1).is_some_and(|u| u.contains("fail")) => {
            println!(
                "{}",
                json!({"success": false, "error": "boom: net::ERR_FAILED"})
            );
            std::process::exit(1);
        }
        Some("screenshot") => {
            let path = rest[1..].iter().find(|a| !a.starts_with("--")).unwrap();
            std::fs::write(path, include_bytes!("../fixtures/photo.jpg")).unwrap();
            if session.contains("fail") {
                println!("{}", json!({"success": false, "error": "no screen"}));
                std::process::exit(1);
            }
            json!({"success": true, "data": {"path": path}})
        }
        cmd => json!({"success": true, "data": {"command": cmd, "session": session}}),
    };
    println!("{out}");
}
