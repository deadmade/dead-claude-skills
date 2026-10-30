//! A stand-in for agent-browser: appends its argv, stdin, `AGENT_BROWSER_*` env and cwd as a JSON line to
//! `$FAKE_AB_LOG` (unset: to `calls.jsonl` beside its `--config`, if any) and prints canned `--json` answers.
//! An `open` of a URL containing "fail" fails; a batch's `wait` fails for a URL containing "wait-fail", and for
//! one containing "wait-slow" only after its `--timeout` ms. A batch opening a search engine's host answers from
//! `$FAKE_AB_PAGES` when that is set (see `engine_page`). `get cdp-url` answers a url ending in the contents of
//! `<state>/chrome` (a changed one: Chrome relaunched); with `$FAKE_AB_OWNER_DELAY_MS`, an owner's (`*-window`)
//! `open` sleeps that long first. `<state>` is `$FAKE_AB_STATE`, else `--config`'s folder. On a `--cdp` call,
//! `<state>/dead-g<n>` makes a `-g<n>-` session answer agent-browser's dead-Chrome connect error, and
//! `<state>/<session>.gone` makes a call other than `tab …` (in a batch: its `open`) answer `tab_gone`, until a
//! `tab new` removes it.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

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
    let rest = command(&args);
    let session = flag("--session");
    let state = state_dir(config);
    let attached = args.iter().any(|a| a == "--cdp");
    if attached {
        attached_failure(&state, session, rest);
    }
    let gone = state.join(format!("{session}.gone"));
    let tab_gone = attached && gone.exists();
    if session.ends_with("-window") && rest.first().is_some_and(|c| c == "open") {
        owner_delay();
    }
    let out = match rest.first().map(String::as_str) {
        Some("get") if rest.get(1).is_some_and(|a| a == "cdp-url") => cdp_url(&state),
        Some("tab") if rest.get(1).is_some_and(|a| a == "new") => {
            let _ = std::fs::remove_file(&gone);
            json!({"success": true, "data": {"tabId": "t9", "url": "about:blank"}})
        }
        Some("batch") => batch(&stdin, session, tab_gone),
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

/// A batch's answer to the commands in `stdin`; with `tab_gone`, its `open` answers `tab_gone`.
fn batch(stdin: &str, session: &str, tab_gone: bool) -> Value {
    let cmds: Vec<Vec<String>> = serde_json::from_str(stdin).unwrap();
    if stdin.contains("/slow") {
        std::thread::sleep(std::time::Duration::from_secs(3)); // a page that hangs
    }
    let url = cmds
        .iter()
        .find(|c| c[0] == "open")
        .map_or("", |c| c[1].as_str());
    let page = engine_page(url);
    let html = match &page {
        Some(Ok(html)) => html.clone(),
        _ => rendered(url, session),
    };
    // A redirect to the user's own network, for the fallback's landing check.
    let landed = if url.contains("redirect-private") {
        "http://127.0.0.1/admin"
    } else {
        url
    };
    let entries: Vec<Value> = cmds
        .iter()
        .map(|c| {
            if tab_gone && c[0] == "open" {
                let mut e = gone_json(session);
                e["command"] = json!(c);
                return e;
            }
            if let (Some(Err(e)), "open") = (&page, c[0].as_str()) {
                return json!({"command": c, "success": false, "result": null, "error": e});
            }
            if c[0] == "wait" && wait_fails(url, c) {
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

/// The command after the global flags: --session <s>, --config <path>, --cdp <url>, --json, --max-output <n>,
/// --content-boundaries, --pin-tab.
fn command(args: &[String]) -> &[String] {
    let mut rest = args;
    while let Some(first) = rest.first() {
        let skip = match first.as_str() {
            "--session" | "--config" | "--cdp" | "--max-output" => 2,
            "--json" | "--content-boundaries" | "--pin-tab" => 1,
            _ => break,
        };
        rest = &rest[skip..];
    }
    rest
}

/// An owner's `open` waits `$FAKE_AB_OWNER_DELAY_MS`, if set.
fn owner_delay() {
    if let Some(ms) = std::env::var("FAKE_AB_OWNER_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        std::thread::sleep(Duration::from_millis(ms));
    }
}

/// `$FAKE_AB_STATE`, else the folder of `config`.
fn state_dir(config: &str) -> PathBuf {
    std::env::var_os("FAKE_AB_STATE").map_or_else(
        || {
            Path::new(config)
                .parent()
                .unwrap_or(Path::new(""))
                .to_owned()
        },
        PathBuf::from,
    )
}

/// web-mcp-one-window/findings.md's `tab_gone` answer to a single call (a batch entry adds its `command`).
fn gone_json(session: &str) -> Value {
    let error = format!(
        "tab_gone: bound tab is gone (target T-{session}, last url about:blank). Run `agent-browser tab new <url>` to bind a new tab, or `agent-browser tab list` to pick an existing one"
    );
    json!({"success": false, "data": {"lastUrl": "about:blank", "targetId": format!("T-{session}")}, "error": error, "code": "tab_gone"})
}

/// Exits with web-mcp-one-window/findings.md's dead-Chrome connect error, or a single call's `tab_gone`, when `state`
/// says so.
fn attached_failure(state: &Path, session: &str, rest: &[String]) {
    let generation = session
        .split('-')
        .find(|p| p.len() > 1 && p.starts_with('g') && p[1..].bytes().all(|b| b.is_ascii_digit()));
    if generation.is_some_and(|g| state.join(format!("dead-{g}")).exists()) {
        println!(
            "{}",
            json!({"error": "CDP WebSocket connect failed: IO error: No connection could be made because the target machine actively refused it. (os error 10061)", "success": false})
        );
        std::process::exit(1);
    }
    let single = !matches!(rest.first().map(String::as_str), Some("tab" | "batch"));
    if single && state.join(format!("{session}.gone")).exists() {
        println!("{}", gone_json(session));
        std::process::exit(1);
    }
}

/// The window's cdp url, for the Chrome named in `<state>/chrome`, else 1.
fn cdp_url(state: &Path) -> Value {
    let chrome = std::fs::read_to_string(state.join("chrome"))
        .map_or_else(|_| "1".to_owned(), |c| c.trim().to_owned());
    json!({"success": true, "data": {"cdpUrl": format!("ws://127.0.0.1:9222/devtools/browser/{chrome}")}})
}

/// Any page as a browser would render it.
fn rendered(url: &str, session: &str) -> String {
    format!(
        "<html><body><main><article><h1>Rendered</h1><p>Rendered page for {url} in {session}. {}</p></article></main></body></html>",
        "It has plenty of words once a browser has run its scripts. ".repeat(6)
    )
}

/// Whether a batch's `wait` command `c` on `url` fails; a page that never gets ready first runs out the wait's
/// `--timeout`, as the daemon does.
fn wait_fails(url: &str, c: &[String]) -> bool {
    if url.contains("wait-slow") {
        let ms = c
            .iter()
            .position(|a| a == "--timeout")
            .map_or(25_000, |i| c[i + 1].parse().unwrap());
        std::thread::sleep(std::time::Duration::from_millis(ms));
        return true;
    }
    url.contains("wait-fail")
}

/// The result page of the engine whose host `url` is on, from `$FAKE_AB_PAGES` (unset: `None`), after
/// `$FAKE_AB_DELAY_MS`. A marker file `<engine>.<marker>` there picks it: `none`, `blocked`, `consent-once` (the
/// consent page, once), `slow` (60 s first) or `offline` (`Err`: the failure `open` reports); else `<engine>.html`.
fn engine_page(url: &str) -> Option<Result<String, &'static str>> {
    let host = url::Url::parse(url).ok()?.host_str()?.to_owned();
    // scholar.google.com before google.com.
    let (_, engine) = [
        ("scholar.google.com", "scholar"),
        ("google.com", "google"),
        ("bing.com", "bing"),
        ("duckduckgo.com", "duckduckgo"),
        ("search.brave.com", "brave"),
        ("semanticscholar.org", "semanticscholar"),
    ]
    .into_iter()
    .find(|(d, _)| host == *d || host.ends_with(&format!(".{d}")))?;
    let dir = PathBuf::from(std::env::var_os("FAKE_AB_PAGES")?);
    if let Some(ms) = std::env::var("FAKE_AB_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        std::thread::sleep(Duration::from_millis(ms));
    }
    let marker = |m: &str| dir.join(format!("{engine}.{m}"));
    if marker("slow").exists() {
        std::thread::sleep(Duration::from_mins(1)); // past any deadline; the server kills the call
    }
    if marker("offline").exists() {
        return Some(Err("net::ERR_INTERNET_DISCONNECTED"));
    }
    let suffix = if marker("none").exists() {
        "-none"
    } else if marker("blocked").exists() {
        "-blocked"
    } else if std::fs::remove_file(marker("consent-once")).is_ok() {
        "-consent"
    } else {
        ""
    };
    Some(Ok(std::fs::read_to_string(
        dir.join(format!("{engine}{suffix}.html")),
    )
    .unwrap()))
}
