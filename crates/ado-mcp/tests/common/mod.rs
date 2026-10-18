//! Test helpers: a std-only HTTP fixture server with a request log, and a stdio MCP client for the ado-mcp binary.
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
    pub fn json(body: &Value) -> Self {
        Self::new(200, "application/json", body.to_string())
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

/// One request the fixture server received.
#[derive(Clone)]
pub struct Req {
    pub method: String,
    /// With the query.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Req {
    /// The value of header `name`, matched case-insensitively.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

#[derive(Default)]
struct State {
    /// Scripted responses per path (with query); the front is served and popped until one is left.
    routes: HashMap<String, Vec<Resp>>,
    hits: HashMap<String, usize>,
    log: Vec<Req>,
}

/// Serves `tests/fixtures/` plus scripted routes, one thread per connection, `Connection: close`.
pub struct Fixture {
    pub addr: SocketAddr,
    state: Arc<Mutex<State>>,
}

impl Fixture {
    pub fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
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

    /// Every request received so far, oldest first.
    pub fn requests(&self) -> Vec<Req> {
        self.state.lock().unwrap().log.clone()
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
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_owned();
    let path = parts.next().unwrap_or("/").to_owned();
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
            break;
        }
        if let Some((k, v)) = h.trim_end().split_once(':') {
            headers.push((k.trim().to_owned(), v.trim().to_owned()));
        }
    }
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; len];
    let _ = reader.read_exact(&mut body);
    let resp = {
        let mut st = state.lock().unwrap();
        *st.hits.entry(path.clone()).or_default() += 1;
        st.log.push(Req {
            method,
            path: path.clone(),
            headers,
            body,
        });
        // A route given without a query also answers that path with any query.
        let key = if st.routes.contains_key(&path) {
            path.clone()
        } else {
            path.split('?').next().unwrap_or_default().to_owned()
        };
        match st.routes.get_mut(&key) {
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
        Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    Resp::new(200, ct, std::fs::read(p).unwrap())
}

pub fn tempdir() -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!(
        "ado-mcp-it-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub fn fixture(name: &str) -> Resp {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    Resp::new(200, "application/json", std::fs::read(p).unwrap())
}

pub fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(ok.success(), "git {args:?}");
}

/// A git clone (no commits) of `remote`, on branch `main`.
pub fn clone_of(remote: &str) -> PathBuf {
    let dir = tempdir();
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["remote", "add", "origin", remote]);
    dir
}

/// The collection's own remote on the fixture host. The fixture speaks http and `https_remote` only takes https or
/// ssh, so the clone is an ssh one; the PAT still goes to `ADO_ORG_URL`'s scheme and port.
pub fn own_remote(fx: &Fixture) -> String {
    format!("ssh://git@{}/tfs/Coll/My%20Proj/_git/R", fx.addr.ip())
}

/// The ado-mcp binary over stdio, initialized.
pub struct Mcp {
    pub project: PathBuf,
    /// The `initialize` result.
    pub init: Value,
    child: Child,
    stdin: Option<ChildStdin>,
    out: BufReader<ChildStdout>,
    next_id: u64,
}

/// A server for the fixture `fx` as the collection `/tfs/Coll/`, with `extra_env` on top, in a fresh temp project dir.
pub fn ado(fx: &Fixture, extra_env: &[(&str, &str)]) -> Mcp {
    let org = fx.url("/tfs/Coll/");
    let project = tempdir();
    let mut envs = vec![
        ("ADO_ORG_URL", org.as_str()),
        ("ADO_PAT", "test-pat"),
        ("ADO_PROJECT_DIR", project.to_str().unwrap()),
    ];
    envs.extend_from_slice(extra_env);
    Mcp::start_with(project.clone(), &envs)
}

#[allow(clippy::needless_pass_by_value)] // callers build the JSON inline with `json!`
impl Mcp {
    /// With exactly `envs` as the ADO variables (the parent's are removed), in `project`.
    pub fn start_with(project: PathBuf, envs: &[(&str, &str)]) -> Self {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_ado-mcp"));
        for k in [
            "ADO_ORG_URL",
            "ADO_PAT",
            "ADO_DEFAULT_PROJECT",
            "ADO_PROJECT_DIR",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
        ] {
            cmd.env_remove(k);
        }
        cmd.envs(envs.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        let mut m = Self {
            project,
            init: Value::Null,
            child,
            stdin: Some(stdin),
            out,
            next_id: 1,
        };
        m.init = m.request(
            "initialize",
            json!({"protocolVersion":"2025-06-18","capabilities":{},
                   "clientInfo":{"name":"t","version":"0"}}),
        );
        m.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        m
    }

    fn send(&mut self, m: &Value) {
        let stdin = self.stdin.as_mut().unwrap();
        writeln!(stdin, "{m}").unwrap();
        stdin.flush().unwrap();
    }

    /// The whole JSON-RPC response's `result`.
    pub fn request(&mut self, method: &str, params: Value) -> Value {
        let mut v = self.request_raw(method, params);
        v["result"].take()
    }

    /// The whole JSON-RPC response, so a protocol error (`error.code`) can be checked.
    pub fn request_raw(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        loop {
            let mut line = String::new();
            assert!(self.out.read_line(&mut line).unwrap() > 0, "server exited");
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"].as_u64() == Some(id) {
                return v;
            }
        }
    }

    /// `(isError, text of the first text block)`.
    pub fn call(&mut self, tool: &str, args: Value) -> (bool, String) {
        let r = self.request("tools/call", json!({"name": tool, "arguments": args}));
        (r["isError"] == true, text(&r).to_owned())
    }

    /// Sends every call before reading any answer, so the server handles them at the same time; the results keep the order of `args`.
    pub fn call_all(&mut self, tool: &str, args: Vec<Value>) -> Vec<(bool, String)> {
        let first = self.next_id;
        for (i, a) in args.iter().enumerate() {
            let id = first + i as u64;
            self.send(&json!({"jsonrpc":"2.0","id":id,"method":"tools/call",
                              "params":{"name":tool,"arguments":a}}));
        }
        self.next_id += args.len() as u64;
        let mut got: HashMap<u64, (bool, String)> = HashMap::new();
        while got.len() < args.len() {
            let mut line = String::new();
            assert!(self.out.read_line(&mut line).unwrap() > 0, "server exited");
            let v: Value = serde_json::from_str(&line).unwrap();
            if let Some(id) = v["id"].as_u64().filter(|id| *id >= first) {
                let r = &v["result"];
                got.insert(id, (r["isError"] == true, text(r).to_owned()));
            }
        }
        (first..self.next_id)
            .map(|id| got.remove(&id).unwrap())
            .collect()
    }

    /// Closes the server's stdin, as Claude Code does when it exits, and waits for the server to finish.
    pub fn finish(&mut self) {
        self.stdin = None;
        self.child.wait().unwrap();
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
