//! Test helpers: a std-only HTTP fixture server and a stdio MCP client for the web-mcp binary.
#![allow(dead_code)] // each test file uses a different subset

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

/// The address the tests treat as a public host (see `WEB_MCP_TEST_PUBLIC_IP`).
pub const PUBLIC: &str = "127.0.0.2";

#[derive(Clone)]
pub struct Resp {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub delay: Duration,
}

impl Resp {
    pub fn new(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), content_type.into())],
            body: body.into(),
            delay: Duration::ZERO,
        }
    }
    pub fn html(body: impl Into<Vec<u8>>) -> Self {
        Self::new(200, "text/html; charset=utf-8", body)
    }
    pub fn redirect(to: &str) -> Self {
        Self::new(302, "text/plain", "").header("Location", to)
    }
    #[must_use]
    pub fn header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }
    #[must_use]
    pub fn delay(mut self, d: Duration) -> Self {
        self.delay = d;
        self
    }
}

#[derive(Default)]
struct State {
    /// Scripted responses per path (with query); the front is served and popped until one is left.
    routes: HashMap<String, Vec<Resp>>,
    hits: HashMap<String, usize>,
}

/// Serves `tests/fixtures/` plus scripted routes, one thread per connection, `Connection: close`.
pub struct Fixture {
    pub addr: SocketAddr,
    state: Arc<Mutex<State>>,
}

impl Fixture {
    pub fn start(ip: &str) -> Self {
        let listener = TcpListener::bind((ip, 0)).unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        let s = Arc::clone(&state);
        std::thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let s = Arc::clone(&s);
                std::thread::spawn(move || serve(conn, &s));
            }
        });
        Self { addr, state }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    pub fn route(&self, path: &str, resps: Vec<Resp>) {
        self.state.lock().unwrap().routes.insert(path.into(), resps);
    }

    pub fn hits(&self, path: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .hits
            .get(path)
            .copied()
            .unwrap_or(0)
    }
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn serve(conn: TcpStream, state: &Mutex<State>) {
    let mut reader = BufReader::new(conn.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let path = line.split_whitespace().nth(1).unwrap_or("/").to_owned();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
            break;
        }
    }
    let resp = {
        let mut st = state.lock().unwrap();
        *st.hits.entry(path.clone()).or_default() += 1;
        match st.routes.get_mut(&path) {
            Some(v) if v.len() > 1 => Some(v.remove(0)),
            Some(v) => v.first().cloned(),
            None => None,
        }
    };
    let resp = resp.unwrap_or_else(|| file(&path));
    std::thread::sleep(resp.delay);
    let mut out = conn;
    let mut head = format!(
        "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n",
        resp.status,
        resp.body.len()
    );
    for (k, v) in &resp.headers {
        let _ = write!(head, "{k}: {v}\r\n");
    }
    head.push_str("\r\n");
    let _ = out.write_all(head.as_bytes());
    let _ = out.write_all(&resp.body);
    let _ = out.flush();
    // Drain so the client never sees a reset before it read the body.
    let _ = out.shutdown(std::net::Shutdown::Write);
    let _ = reader.read_to_end(&mut Vec::new());
}

fn file(path: &str) -> Resp {
    let name = path.trim_start_matches('/');
    let p = fixtures().join(name);
    if name.contains("..") || !p.is_file() {
        return Resp::new(404, "text/plain", "not found");
    }
    let ct = match p.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("jpg") => "image/jpeg",
        Some("png") => "image/png",
        Some("md") => "text/markdown",
        _ => "application/octet-stream",
    };
    Resp::new(200, ct, std::fs::read(p).unwrap())
}

pub fn tempdir() -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "web-mcp-it-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The web-mcp binary over stdio, initialized, with its project in a fresh temp dir.
pub struct Mcp {
    pub project: PathBuf,
    child: Child,
    stdin: ChildStdin,
    out: BufReader<ChildStdout>,
    next_id: u64,
}

impl Mcp {
    pub fn start() -> Self {
        let project = tempdir();
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_web-mcp"));
        cmd.env("CLAUDE_PROJECT_DIR", &project)
            .env("WEB_MCP_TEST_PUBLIC_IP", PUBLIC)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        for k in [
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
        ] {
            cmd.env_remove(k);
        }
        let mut child = cmd.spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        let mut m = Self {
            project,
            child,
            stdin,
            out,
            next_id: 1,
        };
        m.request(
            "initialize",
            json!({"protocolVersion":"2025-06-18","capabilities":{},
                   "clientInfo":{"name":"t","version":"0"}}),
        );
        m.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        m
    }

    fn send(&mut self, m: &Value) {
        writeln!(self.stdin, "{m}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.requests(vec![(method.to_owned(), params)]).remove(0)
    }

    /// Sends all requests before reading any response, so they run concurrently.
    fn requests(&mut self, reqs: Vec<(String, Value)>) -> Vec<Value> {
        let ids: Vec<u64> = reqs
            .into_iter()
            .map(|(method, params)| {
                let id = self.next_id;
                self.next_id += 1;
                self.send(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
                id
            })
            .collect();
        let mut got: HashMap<u64, Value> = HashMap::new();
        while got.len() < ids.len() {
            let mut line = String::new();
            assert!(self.out.read_line(&mut line).unwrap() > 0, "server exited");
            let v: Value = serde_json::from_str(&line).unwrap();
            if let Some(id) = v["id"].as_u64() {
                got.insert(id, v["result"].clone());
            }
        }
        ids.iter().map(|id| got.remove(id).unwrap()).collect()
    }

    pub fn call(&mut self, tool: &str, args: Value) -> Value {
        self.calls(vec![(tool, args)]).remove(0)
    }

    pub fn calls(&mut self, calls: Vec<(&str, Value)>) -> Vec<Value> {
        self.requests(
            calls
                .into_iter()
                .map(|(t, a)| ("tools/call".to_owned(), json!({"name": t, "arguments": a})))
                .collect(),
        )
    }

    /// `<project>/.web/<run>`.
    pub fn run_dir(&self) -> PathBuf {
        let web = self.project.join(".web");
        std::fs::read_dir(&web)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.is_dir())
            .unwrap()
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The text of the first text block.
pub fn text(result: &Value) -> &str {
    result["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["type"] == "text")
        .and_then(|b| b["text"].as_str())
        .unwrap()
}

pub fn images(result: &Value) -> usize {
    result["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["type"] == "image")
        .count()
}

pub fn is_error(result: &Value) -> bool {
    result["isError"] == true
}
