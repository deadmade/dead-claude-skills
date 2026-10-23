//! agent-browser, driven as a child process: one `--json` call per action, one named session per browser.

use std::collections::BTreeSet;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;
use url::Url;

/// Sessions the fetch fallback names for itself; the `browser` tool may not use them.
const FETCH_PREFIX: &str = "web-mcp-fetch-";

/// A session name for the `browser` tool: short (agent-browser's socket path is length-limited),
/// plain, not flag-like and not one of the fallback's.
///
/// # Errors
/// What is wrong with the name.
pub fn check_session(s: &str) -> Result<(), String> {
    let plain = (1..=32).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !s.starts_with('-');
    if !plain {
        return Err("session must be 1-32 characters of letters, digits, `_` and `-`, not starting with `-`".into());
    }
    if let Some(p) = [FETCH_PREFIX, "search-", "web-mcp-search-"]
        .into_iter()
        .find(|p| s.starts_with(p))
    {
        return Err(format!("session names starting with `{p}` are reserved"));
    }
    Ok(())
}

/// Per call; a browser that hangs is killed.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// Characters of page output per call: under Claude Code's 25,000-token cap on MCP results.
const MAX_OUTPUT: &str = "40000";

#[derive(Debug)]
pub enum BrowserError {
    Missing,
    Failed(String),
}

impl fmt::Display for BrowserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => f.write_str(
                "agent-browser is not installed. Install it with the web-mcp installer, or put agent-browser on PATH (https://github.com/vercel-labs/agent-browser/releases) and run `agent-browser install`.",
            ),
            Self::Failed(m) => f.write_str(m),
        }
    }
}

pub struct Browser {
    pub bin: PathBuf,
    /// How long the fetch fallback's batch may take.
    pub fallback_deadline: Duration,
    /// Agent-browser sessions the `browser` tool opened and has not closed; shutdown closes them.
    opened: Mutex<BTreeSet<String>>,
    /// Where agent-browser keeps its sessions' `.pid` and `.sock` files; `None` where that isn't known.
    pub socket_dir: Option<PathBuf>,
}

/// A search's page load: in an engine's session, under web-mcp's config for it.
#[cfg_attr(not(test), allow(dead_code))] // built by `search` from Task 5 on
pub struct SearchRun<'a> {
    /// The engine's `agent-browser.json`; its folder is the call's working directory.
    pub config: &'a Path,
    /// The `wait --fn` expression that is true once the page shows results, no results or a block.
    pub ready_js: &'a str,
    /// Close the session after this search (Windows, where an engine's window would otherwise stay up).
    pub close_after: bool,
}

/// How a call to a search session runs (Global Constraints, "Isolation").
#[derive(Clone, Copy)]
struct Isolated<'a> {
    config: &'a Path,
    /// `AGENT_BROWSER_DEFAULT_TIMEOUT`: bounds the daemon's own wait, which outlives a killed call.
    timeout: Duration,
}

/// Points `cmd` at the config with `--config`, runs it in the config's folder and drops every
/// `AGENT_BROWSER_*` variable of `env` (web-mcp's), so nothing of the user's agent-browser setup applies.
fn isolate(
    cmd: &mut Command,
    iso: Isolated<'_>,
    env: impl IntoIterator<Item = (OsString, OsString)>,
) {
    cmd.arg("--config").arg(iso.config);
    for (k, _) in env {
        // Windows names are case-insensitive.
        if k.to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("AGENT_BROWSER_")
        {
            cmd.env_remove(k);
        }
    }
    cmd.env(
        "AGENT_BROWSER_DEFAULT_TIMEOUT",
        iso.timeout.as_millis().to_string(),
    );
    if let Some(dir) = iso.config.parent() {
        cmd.current_dir(dir);
    }
}

/// How long a `close` may take.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
/// What a search batch keeps back from the daemon's wait for everything else: findings.md measured ~1 s of
/// process start, `open` and reads beyond the wait (3000/8000 ms waits: 4.0/8.9 s calls) and up to 2 s for a
/// whole warm batch, so 2 s lets a page that never gets ready still be read inside the deadline.
const READ_MARGIN: Duration = Duration::from_secs(2);

impl Browser {
    /// `name` as configured: found on PATH, or kept as given so that running it reports `Missing`.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self {
            // Absolute: search calls run in another working directory.
            bin: Self::resolve(name)
                .map_or_else(|| name.into(), |p| std::path::absolute(&p).unwrap_or(p)),
            fallback_deadline: Duration::from_secs(30),
            opened: Mutex::default(),
            // The default dir: search calls drop `AGENT_BROWSER_SOCKET_DIR` with the rest of `AGENT_BROWSER_*`.
            socket_dir: std::env::var_os("XDG_RUNTIME_DIR")
                .filter(|d| !cfg!(windows) && !d.is_empty())
                .map(|d| PathBuf::from(d).join("agent-browser")),
        }
    }

    /// The agent-browser session behind the user's `name`, and a note to close it at shutdown. Sessions are
    /// global per user, so the pid keeps two servers off the same tab. At most `web-mcp-` + 10 pid digits + `-`
    /// + 32 name characters = 51 bytes, which leaves room in agent-browser's ~103-byte socket path.
    pub fn session(&self, name: &str) -> String {
        let s = format!("web-mcp-{}-{name}", std::process::id());
        self.opened.lock().expect("session set").insert(s.clone());
        s
    }

    /// Closes `session` (a name from `session`) and forgets it.
    pub async fn close(&self, session: &str) -> Result<Value, BrowserError> {
        self.opened.lock().expect("session set").remove(session);
        self.run(session, &["close".to_owned()]).await
    }

    /// Closes every session still open, in parallel, best effort, each within 5 s.
    pub async fn close_all(&self) {
        let open = std::mem::take(&mut *self.opened.lock().expect("session set"));
        let close = ["close".to_owned()];
        futures::future::join_all(open.iter().map(|s| {
            tokio::time::timeout(
                Duration::from_secs(5),
                self.run_with(s, &close, None, false, None),
            )
        }))
        .await;
    }

    /// A path to an existing file, or `name` found on PATH. On Windows each `PATHEXT` extension is
    /// tried too, so npm's `agent-browser.cmd` resolves (Rust runs `.cmd` files through cmd.exe itself).
    #[must_use]
    pub fn resolve(name: &str) -> Option<PathBuf> {
        Self::resolve_on(name, &std::env::var_os("PATH").unwrap_or_default())
    }

    /// `resolve` with `path` in place of PATH.
    #[must_use]
    pub fn resolve_on(name: &str, path: &OsStr) -> Option<PathBuf> {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        resolve_in(name, path, cfg!(windows).then_some(exts.as_str()))
    }

    /// Runs `agent-browser --session <session> --json … <args>` and returns its `data`.
    ///
    /// # Errors
    /// `Missing` when the binary can't be started; `Failed` when the call times out, answers
    /// `{"success": false}`, or answers no JSON.
    pub async fn run(&self, session: &str, args: &[String]) -> Result<Value, BrowserError> {
        self.run_with(session, args, None, true, None).await
    }

    /// `limits`: cap and wrap the page output (for answers read as text; off where the output is data).
    /// `iso`: a call to a search session.
    async fn run_with(
        &self,
        session: &str,
        args: &[String],
        stdin: Option<&str>,
        limits: bool,
        iso: Option<Isolated<'_>>,
    ) -> Result<Value, BrowserError> {
        let mut cmd = Command::new(&self.bin);
        cmd.args(["--session", session, "--json"]);
        if let Some(iso) = iso {
            isolate(&mut cmd, iso, std::env::vars_os());
        }
        if limits {
            cmd.args(["--max-output", MAX_OUTPUT, "--content-boundaries"]);
        }
        let mut child = cmd
            .args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => BrowserError::Missing,
                _ => BrowserError::Failed(format!("could not start agent-browser: {e}")),
            })?;
        let mut pipe = child.stdin.take();
        let write = async move {
            if let (Some(input), Some(pipe)) = (stdin, pipe.as_mut()) {
                let _ = pipe.write_all(input.as_bytes()).await; // a dead child shows in its output
            }
            drop(pipe); // EOF
        };
        // The write runs beside the reads, so a big input can't deadlock on a full pipe, and both
        // sit under the timeout; dropping the future on timeout kills the child (kill_on_drop).
        let (out, ()) = tokio::time::timeout(CALL_TIMEOUT, async {
            let (out, ()) = tokio::join!(child.wait_with_output(), write);
            (out, ())
        })
        .await
        .map_err(|_| BrowserError::Failed("agent-browser did not answer within 60 s".into()))?;
        let out = out.map_err(|e| BrowserError::Failed(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) else {
            let err = String::from_utf8_lossy(&out.stderr);
            let msg = format!("{}{}", stdout.trim(), err.trim());
            return Err(BrowserError::Failed(if msg.is_empty() {
                format!("agent-browser exited with {} and no output", out.status)
            } else {
                msg
            }));
        };
        if v["success"] == false {
            return Err(BrowserError::Failed(failure(&v)));
        }
        Ok(v.get("data").cloned().unwrap_or(v))
    }

    /// Runs `commands` as one `batch --json` (read from stdin, so no value is parsed as a flag) and
    /// returns each command's result.
    ///
    /// # Errors
    /// As `run`, or when the answer is not one result per command or a command failed.
    pub async fn batch(
        &self,
        session: &str,
        commands: &[Vec<&str>],
    ) -> Result<Vec<Value>, BrowserError> {
        self.batch_with(session, commands, true, None, None).await
    }

    /// `may_fail`: the index of a command whose failure doesn't fail the batch.
    async fn batch_with(
        &self,
        session: &str,
        commands: &[Vec<&str>],
        limits: bool,
        iso: Option<Isolated<'_>>,
        may_fail: Option<usize>,
    ) -> Result<Vec<Value>, BrowserError> {
        let input = json!(commands).to_string();
        let args = ["batch".to_owned(), "--json".to_owned()];
        let answer = self
            .run_with(session, &args, Some(&input), limits, iso)
            .await?;
        // One entry per command: {"command", "success", "result"}.
        let entries = answer.as_array().ok_or_else(|| {
            BrowserError::Failed("agent-browser's batch answer is not a list".into())
        })?;
        if let Some((_, bad)) = entries
            .iter()
            .enumerate()
            .find(|(i, e)| e["success"] == false && may_fail != Some(*i))
        {
            return Err(BrowserError::Failed(failure(bad)));
        }
        if entries.len() != commands.len() {
            return Err(BrowserError::Failed(
                "agent-browser's batch answered fewer results than commands".into(),
            ));
        }
        Ok(entries
            .iter()
            .map(|e| e.get("result").unwrap_or(&e["data"]).clone())
            .collect())
    }

    /// The rendered `<body>` of `url` and the URL the browser ended on (redirects included), from one batch
    /// within `deadline`.
    ///
    /// Without `search`: in a throwaway `session`, closed again. With it: in the engine's session under its
    /// config, waiting on `ready_js` first. The daemon's wait gets `deadline` less `READ_MARGIN`, so a page that
    /// never gets ready (a consent wall, changed markup) times the wait out and is still read before the deadline:
    /// the parser decides what it is. That session stays open for the next search unless `close_after`, the batch
    /// failed or the deadline passed.
    ///
    /// # Errors
    /// As `batch`, when the deadline passes, or when it answers no HTML or no URL.
    pub async fn render(
        &self,
        url: &Url,
        session: &str,
        search: Option<SearchRun<'_>>,
        deadline: Duration,
    ) -> Result<(String, Url), BrowserError> {
        let mut cmds = vec![vec!["open", url.as_str()]];
        if let Some(s) = &search {
            cmds.push(vec!["wait", "--fn", s.ready_js]);
        }
        cmds.extend([vec!["get", "html", "body"], vec!["get", "url"]]);
        let iso = |timeout| {
            search.as_ref().map(|s| Isolated {
                config: s.config,
                timeout,
            })
        };
        // The HTML is data for the extractor: no output cap, no boundary markers.
        let batch = self.batch_with(
            session,
            &cmds,
            false,
            // Never 0: what agent-browser makes of a zero timeout is unknown.
            iso(deadline
                .saturating_sub(READ_MARGIN)
                .max(Duration::from_millis(100))),
            search.as_ref().map(|_| 1),
        );
        let answer = tokio::time::timeout(deadline, batch)
            .await
            .unwrap_or_else(|_| {
                Err(BrowserError::Failed(format!(
                    "the page did not finish within {} s",
                    deadline.as_secs_f32()
                )))
            });
        // A fetch's session (a daemon and its Chromium) never outlives the fetch; an engine's stays warm unless
        // told otherwise or it failed (its page may be stuck).
        if search
            .as_ref()
            .is_none_or(|s| s.close_after || answer.is_err())
        {
            let close = ["close".to_owned()];
            let _ = tokio::time::timeout(
                CLOSE_TIMEOUT,
                self.run_with(session, &close, None, false, iso(CLOSE_TIMEOUT)),
            )
            .await;
            if search.is_some() {
                self.session_gone(session).await;
            }
        }
        let answer = answer?;
        let field =
            |v: &Value, key: &str| v.as_str().or_else(|| v[key].as_str()).map(str::to_owned);
        let n = answer.len(); // one entry per command: at least 3
        let html = field(&answer[n - 2], "html");
        let landed = field(&answer[n - 1], "url").and_then(|u| Url::parse(&u).ok());
        html.zip(landed)
            .ok_or_else(|| BrowserError::Failed("agent-browser returned no HTML or URL".into()))
    }

    /// Waits, at most 1 s, until agent-browser has removed `session`'s `.pid` and `.sock`: an `open` right
    /// after a `close` fails otherwise (findings.md, "Daemon behaviour"). Where they live isn't known: 1 s.
    async fn session_gone(&self, session: &str) {
        let Some(dir) = &self.socket_dir else {
            return tokio::time::sleep(Duration::from_secs(1)).await;
        };
        let files = ["pid", "sock"].map(|ext| dir.join(format!("{session}.{ext}")));
        let until = std::time::Instant::now() + Duration::from_secs(1);
        while files.iter().any(|f| f.exists()) && std::time::Instant::now() < until {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// The rendered `<body>` of `url` and the URL the browser ended on (redirects included), from one
    /// batch in a session of its own that is closed again.
    ///
    /// # Errors
    /// As `batch`, or when it answers no HTML or no URL.
    pub async fn rendered_html(&self, url: &Url) -> Result<(String, Url), BrowserError> {
        static N: AtomicU64 = AtomicU64::new(0);
        let session = format!(
            "{FETCH_PREFIX}{}-{}",
            std::process::id(), // sessions are global per user: another web-mcp may be running
            N.fetch_add(1, Ordering::Relaxed)
        );
        self.render(url, &session, None, self.fallback_deadline)
            .await
    }
}

fn failure(v: &Value) -> String {
    match v.get("error").or_else(|| v.get("message")) {
        Some(Value::String(s)) => s.clone(),
        Some(e) => e.to_string(),
        None => "agent-browser reported a failure".into(),
    }
}

fn resolve_in(name: &str, path: &OsStr, pathext: Option<&str>) -> Option<PathBuf> {
    let exts = pathext
        .into_iter()
        .flat_map(|e| e.split(';'))
        .filter(|e| !e.is_empty());
    let exts: Vec<&str> = std::iter::once("").chain(exts).collect();
    let find = |dir: &Path| {
        exts.iter().find_map(|ext| {
            let p = dir.join(format!("{name}{ext}"));
            p.is_file().then_some(p)
        })
    };
    if name.contains(['/', '\\']) {
        return find(Path::new(""));
    }
    std::env::split_paths(path).find_map(|d| find(&d))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_finds_cmd_via_pathext() {
        let dir = std::env::temp_dir().join(format!("web-mcp-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent-browser.CMD"), "").unwrap();
        let path = std::env::join_paths([&dir]).unwrap();
        let got = resolve_in("agent-browser", &path, Some(".COM;.EXE;.CMD"));
        assert_eq!(got, Some(dir.join("agent-browser.CMD")));
        assert_eq!(resolve_in("agent-browser", &path, None), None);
        assert_eq!(resolve_in("nope", &path, Some(".CMD")), None);
    }

    fn fake() -> Browser {
        // The fake sits next to the test binary's deps/ folder; cargo builds it for the integration tests.
        let exe = std::env::current_exe().unwrap();
        let fake = exe.parent().and_then(Path::parent).unwrap().join(format!(
            "fake-agent-browser{}",
            std::env::consts::EXE_SUFFIX
        ));
        assert!(fake.is_file(), "build the fake first: cargo build --bins");
        Browser::new(&fake.to_string_lossy())
    }

    /// An engine folder with its config and a socket dir; the fake logs its calls beside the config.
    fn engine_dir(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("web-mcp-render-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sock")).unwrap();
        let config = dir.join("agent-browser.json");
        std::fs::write(&config, "{}").unwrap();
        (dir, config)
    }

    fn calls(dir: &Path) -> Vec<Value> {
        std::fs::read_to_string(dir.join("calls.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn args(call: &Value) -> Vec<&str> {
        call["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a.as_str().unwrap())
            .collect()
    }

    const READY_JS: &str = "!!(document.querySelector('#r'));";

    #[test]
    fn check_session_reserves_search() {
        for s in [
            "search-1",
            "web-mcp-search-ab12cd34-brave",
            "web-mcp-fetch-1",
        ] {
            assert!(check_session(s).is_err(), "{s}");
        }
        for s in ["research", "searches", "s1"] {
            assert!(check_session(s).is_ok(), "{s}");
        }
    }

    #[test]
    fn search_calls_drop_agent_browser_env() {
        let mut cmd = Command::new("x");
        let config = Path::new("/srv/search/brave/agent-browser.json");
        let iso = Isolated {
            config,
            timeout: Duration::from_millis(4200),
        };
        let env = [
            ("AGENT_BROWSER_PROXY", "http://127.0.0.1:9"),
            ("agent_browser_headed", "1"),
            ("PATH", "/bin"),
        ]
        .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        isolate(&mut cmd, iso, env);
        let set: Vec<_> = cmd.as_std().get_envs().collect();
        assert!(
            set.contains(&(OsStr::new("AGENT_BROWSER_PROXY"), None)),
            "{set:?}"
        );
        assert!(
            set.contains(&(OsStr::new("agent_browser_headed"), None)),
            "{set:?}"
        );
        assert!(
            set.contains(&(
                OsStr::new("AGENT_BROWSER_DEFAULT_TIMEOUT"),
                Some(OsStr::new("4200"))
            )),
            "{set:?}"
        );
        assert!(!set.iter().any(|(k, _)| *k == "PATH"), "{set:?}");
        assert_eq!(cmd.as_std().get_current_dir(), config.parent());
        let argv: Vec<_> = cmd.as_std().get_args().collect();
        assert_eq!(argv, [OsStr::new("--config"), config.as_os_str()]);
    }

    #[tokio::test]
    async fn render_search_tolerates_failed_wait() {
        let (dir, config) = engine_dir("wait");
        let mut b = fake();
        b.socket_dir = Some(dir.join("sock"));
        let url = Url::parse("http://example.com/wait-fail?q=x").unwrap();
        let run = SearchRun {
            config: &config,
            ready_js: READY_JS,
            close_after: false,
        };
        let session = "web-mcp-search-0-brave";
        let (html, landed) = b
            .render(&url, session, Some(run), Duration::from_secs(5))
            .await
            .unwrap();
        assert!(html.contains("Rendered page for"), "{html}");
        assert_eq!(landed, url);
        let c = calls(&dir);
        assert_eq!(c.len(), 1, "a session that answered stays open: {c:?}");
        let a = args(&c[0]);
        let at = a.iter().position(|x| *x == "--config").unwrap();
        assert_eq!(a[at + 1], config.to_str().unwrap());
        let at = a.iter().position(|x| *x == "--session").unwrap();
        assert_eq!(a[at + 1], session);
        let batch: Value = serde_json::from_str(c[0]["stdin"].as_str().unwrap()).unwrap();
        assert_eq!(
            batch,
            json!([
                ["open", url.as_str()],
                ["wait", "--fn", READY_JS],
                ["get", "html", "body"],
                ["get", "url"]
            ])
        );
        assert_eq!(
            c[0]["env"],
            json!({"AGENT_BROWSER_DEFAULT_TIMEOUT": "3000"})
        );
        let cwd = PathBuf::from(c[0]["cwd"].as_str().unwrap());
        assert_eq!(cwd.canonicalize().unwrap(), dir.canonicalize().unwrap());
    }

    #[tokio::test]
    async fn render_closes_on_deadline() {
        let (dir, config) = engine_dir("deadline");
        let mut b = fake();
        b.socket_dir = Some(dir.join("sock"));
        let url = Url::parse("http://example.com/slow").unwrap();
        let run = SearchRun {
            config: &config,
            ready_js: READY_JS,
            close_after: false,
        };
        let err = b
            .render(
                &url,
                "web-mcp-search-0-bing",
                Some(run),
                Duration::from_millis(500),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("did not finish"), "{err}");
        let c = calls(&dir);
        assert_eq!(c.len(), 2, "{c:?}");
        let close = args(&c[1]);
        assert_eq!(close.last(), Some(&"close"));
        assert!(close.contains(&"--config"), "{close:?}");
        assert_eq!(
            c[1]["env"],
            json!({"AGENT_BROWSER_DEFAULT_TIMEOUT": "5000"})
        );
    }

    #[tokio::test]
    async fn close_waits_for_session_files() {
        let (dir, config) = engine_dir("gone");
        let mut b = fake();
        let sock = dir.join("sock");
        b.socket_dir = Some(sock.clone());
        let session = "web-mcp-search-0-duckduckgo";
        let files = [
            sock.join(format!("{session}.pid")),
            sock.join(format!("{session}.sock")),
        ];
        let url = Url::parse("http://example.com/q").unwrap();
        let run = || SearchRun {
            config: &config,
            ready_js: READY_JS,
            close_after: true,
        };
        for f in &files {
            std::fs::write(f, "").unwrap();
        }
        // Files that never go: the wait gives up after 1 s (plus the two spawns).
        let t = std::time::Instant::now();
        b.render(&url, session, Some(run()), Duration::from_secs(5))
            .await
            .unwrap();
        let capped = t.elapsed();
        assert!(capped >= Duration::from_secs(1), "{capped:?}");
        assert!(capped < Duration::from_millis(2500), "{capped:?}");
        assert_eq!(args(calls(&dir).last().unwrap()).last(), Some(&"close"));
        // Files that go after 300 ms end the wait then, well before the cap (spawns cost both runs alike).
        let gone = files.clone();
        let remover = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            for f in &gone {
                std::fs::remove_file(f).unwrap();
            }
        });
        let t = std::time::Instant::now();
        b.render(&url, session, Some(run()), Duration::from_secs(5))
            .await
            .unwrap();
        let waited = t.elapsed();
        remover.join().unwrap();
        assert!(waited >= Duration::from_millis(300), "{waited:?}");
        assert!(
            waited + Duration::from_millis(400) < capped,
            "{waited:?} vs {capped:?}"
        );
    }

    #[tokio::test]
    async fn render_reads_a_page_that_never_gets_ready() {
        let (dir, config) = engine_dir("never");
        let mut b = fake();
        b.socket_dir = Some(dir.join("sock"));
        let url = Url::parse("http://example.com/wait-slow").unwrap();
        let run = SearchRun {
            config: &config,
            ready_js: READY_JS,
            close_after: false,
        };
        let deadline = READ_MARGIN + Duration::from_millis(700);
        let t = std::time::Instant::now();
        let (html, landed) = b
            .render(&url, "web-mcp-search-0-google", Some(run), deadline)
            .await
            .unwrap();
        assert!(t.elapsed() < deadline, "{:?}", t.elapsed());
        assert!(html.contains("Rendered page for"), "{html}");
        assert_eq!(landed, url);
        let c = calls(&dir);
        assert_eq!(c[0]["env"], json!({"AGENT_BROWSER_DEFAULT_TIMEOUT": "700"}));
        assert_eq!(c.len(), 1, "a read page keeps its session: {c:?}");
    }
}
