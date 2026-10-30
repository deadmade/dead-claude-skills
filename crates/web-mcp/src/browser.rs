//! agent-browser, driven as a child process: one `--json` call per action. Every session but the window's owner is
//! a tab of web-mcp's one browser window (`window.rs`), attached with `--cdp <url> --pin-tab`.

use std::collections::BTreeMap;
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

use crate::engines::Engine;
use crate::profile::ENGINE_DEADLINE;
use crate::window::{Live, Window};

/// Sessions the fetch fallback names for itself; the `browser` tool may not use them.
const FETCH_PREFIX: &str = "web-mcp-fetch-";

/// A session name for the `browser` tool: short (agent-browser's socket path is length-limited),
/// plain, not flag-like and not one of web-mcp's own.
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
    if s == "window" {
        return Err("the session name `window` is reserved".into());
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
    /// `render`'s deadline passed.
    Timeout(Duration),
    /// The session's tab is gone (closed by hand, or with its window): `tab new` binds a new one.
    TabGone(String),
}

impl fmt::Display for BrowserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => f.write_str(
                "agent-browser is not installed. Install it with the web-mcp installer, or put agent-browser on PATH (https://github.com/vercel-labs/agent-browser/releases) and run `agent-browser install`.",
            ),
            Self::Failed(m) | Self::TabGone(m) => f.write_str(m),
            Self::Timeout(d) => write!(f, "the page did not finish within {} s", d.as_secs_f32()),
        }
    }
}

pub struct Browser {
    pub bin: PathBuf,
    /// How long the fetch fallback's batch may take.
    pub fallback_deadline: Duration,
    window: Window,
    /// The window as last seen; `None` until a call needed it.
    live: Mutex<Option<Live>>,
    /// The attached sessions this process has run and not closed, with their generation. Only these are ever
    /// closed: a `close` on a session without a daemon starts one and leaks a tab (findings.md).
    ran: Mutex<BTreeMap<String, u32>>,
    /// The owner's config, from its first call; shutdown closes the owner under it.
    owner_config: Mutex<Option<PathBuf>>,
    /// Where agent-browser keeps its sessions' `.pid` and `.sock` files; `None` where that isn't known.
    pub socket_dir: Option<PathBuf>,
}

/// A search's page load, in an engine's tab.
pub struct SearchRun<'a> {
    /// The `wait --fn` expression that is true once the page shows results, no results or a block.
    pub ready_js: &'a str,
}

/// How a call reaches the browser. Every call passes `--config`, drops the user's `AGENT_BROWSER_*` variables and
/// runs in the search dir.
#[derive(Clone, Copy)]
enum Via<'a> {
    /// The window's owner, under its slot's `profiles/<n>/agent-browser.json`.
    Owner(&'a Path),
    /// A tab of the window at `cdp`, under the attach config.
    Tab { config: &'a Path, cdp: &'a str },
    /// The attach config without `--cdp`: an attached session's `close`, which works after its Chrome died.
    Detached(&'a Path),
}

/// Attached calls' `AGENT_BROWSER_DEFAULT_TIMEOUT`: a constant, because it is part of agent-browser's daemon
/// fingerprint. A search's `wait` carries its own `--timeout`.
const ATTACHED_TIMEOUT: Duration = ENGINE_DEADLINE.saturating_sub(READ_MARGIN);

/// Points `cmd` at the config with `--config` (and, for a tab, the window), runs it in the search dir and drops every
/// `AGENT_BROWSER_*` variable of `env` (web-mcp's), so nothing of the user's agent-browser setup applies.
fn isolate(cmd: &mut Command, via: Via<'_>, env: impl IntoIterator<Item = (OsString, OsString)>) {
    let (config, dir) = match via {
        // `<search dir>/profiles/<n>/agent-browser.json`
        Via::Owner(c) => (c, c.ancestors().nth(3)),
        Via::Tab { config, cdp } => {
            cmd.args(["--cdp", cdp, "--pin-tab"]);
            (config, config.parent())
        }
        Via::Detached(c) => (c, c.parent()),
    };
    cmd.arg("--config").arg(config);
    for (k, _) in env {
        // Windows names are case-insensitive.
        if k.to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("AGENT_BROWSER_")
        {
            cmd.env_remove(k);
        }
    }
    if !matches!(via, Via::Owner(_)) {
        cmd.env(
            "AGENT_BROWSER_DEFAULT_TIMEOUT",
            ATTACHED_TIMEOUT.as_millis().to_string(),
        );
    }
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
}

/// How long a `close` may take.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
/// What a search batch keeps back from the daemon's wait for everything else: findings.md measured ~1 s of
/// process start, `open` and reads beyond the wait (3000/8000 ms waits: 4.0/8.9 s calls) and up to 2 s for a
/// whole warm batch, so 2 s lets a page that never gets ready still be read inside the deadline.
pub const READ_MARGIN: Duration = Duration::from_secs(2);

/// The agent-browser session of `key` in generation `g`.
fn name(key: &str, g: u32) -> String {
    let pid = std::process::id(); // sessions are global per user: another web-mcp may be running
    match key.strip_prefix(FETCH_PREFIX) {
        Some(k) => format!("{FETCH_PREFIX}{pid}-g{g}-{k}"),
        None => format!("web-mcp-{pid}-g{g}-{key}"),
    }
}

/// Runs `bin --session <session> --json <via's flags> … <args>` and returns its `data`.
async fn call(
    bin: &Path,
    session: &str,
    args: &[String],
    stdin: Option<&str>,
    limits: bool,
    via: Via<'_>,
) -> Result<Value, BrowserError> {
    let mut cmd = Command::new(bin);
    cmd.args(["--session", session, "--json"]);
    isolate(&mut cmd, via, std::env::vars_os());
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
        return Err(if v["code"] == "tab_gone" {
            BrowserError::TabGone(failure(&v))
        } else {
            BrowserError::Failed(failure(&v))
        });
    }
    Ok(v.get("data").cloned().unwrap_or(v))
}

impl Browser {
    /// `name` as configured: found on PATH, or kept as given so that running it reports `Missing`.
    #[must_use]
    pub fn new(name: &str, window: Window) -> Self {
        Self {
            // Absolute: calls run in the search dir.
            bin: Self::resolve(name)
                .map_or_else(|| name.into(), |p| std::path::absolute(&p).unwrap_or(p)),
            fallback_deadline: Duration::from_secs(30),
            window,
            live: Mutex::default(),
            ran: Mutex::default(),
            owner_config: Mutex::default(),
            // The default dir: every call drops `AGENT_BROWSER_SOCKET_DIR` with the rest of `AGENT_BROWSER_*`.
            socket_dir: std::env::var_os("XDG_RUNTIME_DIR")
                .filter(|d| !cfg!(windows) && !d.is_empty())
                .map(|d| PathBuf::from(d).join("agent-browser")),
        }
    }

    /// The key of the user's session `name`. Run, batch and close map it to the current generation's agent-browser
    /// session, `web-mcp-<pid>-g<n>-<name>`: the pid keeps two servers off the same tab. At most `web-mcp-` + 10 pid
    /// digits + `-g99-` + 32 name characters = 55 bytes, which leaves room in agent-browser's ~103-byte socket path.
    #[must_use]
    #[expect(
        clippy::unused_self,
        reason = "the window's session key, asked of its browser"
    )]
    pub fn session(&self, name: &str) -> String {
        name.to_owned()
    }

    /// The key of engine `e`'s tab, mapped like the user ones: `browser` names can't start with `search-`.
    #[must_use]
    #[expect(
        clippy::unused_self,
        reason = "the window's session key, asked of its browser"
    )]
    pub fn engine_session(&self, e: Engine) -> String {
        format!("search-{}", e.name())
    }

    /// Starts the window, or asks its owner whether Chrome came back on a new url: before any deadline starts.
    ///
    /// # Errors
    /// When there is no search folder, browser or extension, or the owner fails.
    pub async fn warm(&self) -> Result<(), BrowserError> {
        self.live(true).await.map(drop)
    }

    /// The window: the one last seen unless `fresh` (or none was), else the owner's answer now. A newer generation
    /// closes the old one's sessions in the background.
    async fn live(&self, fresh: bool) -> Result<Live, BrowserError> {
        let cached = self.live.lock().expect("window").clone();
        if !fresh && let Some(l) = cached {
            return Ok(l);
        }
        let now = self.window.live(self).await.map_err(BrowserError::Failed)?;
        let renewed = {
            let mut cur = self.live.lock().expect("window");
            // A racing call already saw this generation or a later one.
            if let Some(c) = cur.as_ref().filter(|c| c.r#gen >= now.r#gen) {
                return Ok(c.clone());
            }
            cur.replace(now.clone()).is_some()
        };
        if renewed {
            self.retire(now.r#gen);
        }
        Ok(now)
    }

    /// Closes, in the background and without `--cdp`, the sessions of generations before `current`: their Chrome is
    /// gone.
    fn retire(&self, current: u32) {
        let old: BTreeMap<String, u32> = {
            let mut ran = self.ran.lock().expect("sessions");
            let (old, keep) = std::mem::take(&mut *ran)
                .into_iter()
                .partition(|(_, g)| *g < current);
            *ran = keep;
            old
        };
        if old.is_empty() {
            return;
        }
        let Ok(config) = self.window.attach_config() else {
            return;
        };
        let bin = self.bin.clone();
        tokio::spawn(async move {
            let close = ["close".to_owned()];
            futures::future::join_all(old.keys().map(|s| {
                let close = call(&bin, s, &close, None, false, Via::Detached(&config));
                tokio::time::timeout(CLOSE_TIMEOUT, close)
            }))
            .await;
        });
    }

    /// Notes `key`'s session in generation `g` as run, and returns it.
    fn track(&self, key: &str, g: u32) -> String {
        let s = name(key, g);
        self.ran.lock().expect("sessions").insert(s.clone(), g);
        s
    }

    /// Runs `op` in `key`'s tab of the window. A gone tab gets one `tab new` and one retry; any other failure asks
    /// the owner again, and a new generation (Chrome came back) gets one retry under its new name.
    async fn attached(&self, key: &str, op: Op<'_>) -> Result<Value, BrowserError> {
        let mut live = self.live(false).await?;
        let config = self.window.attach_config().map_err(BrowserError::Failed)?;
        let (mut rebound, mut renewed) = (false, false);
        loop {
            let session = self.track(key, live.r#gen);
            let via = Via::Tab {
                config: &config,
                cdp: &live.url,
            };
            let answer = match op {
                Op::Run(args) => self.run_with(&session, args, None, true, via).await,
                Op::Batch(cmds, limits, may_fail) => self
                    .batch_with(&session, cmds, limits, via, may_fail)
                    .await
                    .map(Value::Array),
            };
            match answer {
                Err(BrowserError::TabGone(_)) if !rebound => {
                    rebound = true;
                    let new = ["tab".to_owned(), "new".to_owned()];
                    self.run_with(&session, &new, None, false, via).await?;
                }
                Err(BrowserError::Failed(e)) if !renewed => {
                    renewed = true;
                    match self.live(true).await {
                        Ok(now) if now.r#gen != live.r#gen => live = now,
                        _ => return Err(BrowserError::Failed(e)),
                    }
                }
                answer => return answer,
            }
        }
    }

    /// Closes `key`'s tab (a key from `session`) and forgets it; a session this process never ran is left alone.
    ///
    /// # Errors
    /// As `run`; never retried.
    pub async fn close(&self, key: &str) -> Result<Value, BrowserError> {
        let live = self.live.lock().expect("window").clone();
        let Some(live) = live else {
            return Ok(json!({"closed": false}));
        };
        let session = name(key, live.r#gen);
        if self
            .ran
            .lock()
            .expect("sessions")
            .remove(&session)
            .is_none()
        {
            return Ok(json!({"closed": false}));
        }
        let config = self.window.attach_config().map_err(BrowserError::Failed)?;
        self.end(&session, &config, Some(&live.url)).await
    }

    /// `tab close` while `session`'s generation is current (`cdp`), then `close` without `--cdp`, which also works
    /// after its Chrome died. A tab already gone counts as closed.
    async fn end(
        &self,
        session: &str,
        config: &Path,
        cdp: Option<&str>,
    ) -> Result<Value, BrowserError> {
        let tab = match cdp {
            Some(cdp) => {
                let tab_close = ["tab".to_owned(), "close".to_owned()];
                let via = Via::Tab { config, cdp };
                self.run_with(session, &tab_close, None, false, via).await
            }
            None => Ok(Value::Null),
        };
        let tab = match tab {
            Err(BrowserError::TabGone(_)) => Ok(Value::Null),
            Err(BrowserError::Failed(m)) if m.contains("Cannot close the last tab") => {
                Ok(Value::Null)
            }
            t => t,
        };
        let close = ["close".to_owned()];
        let closed = self
            .run_with(session, &close, None, false, Via::Detached(config))
            .await;
        tab.and(closed)
    }

    /// Closes every session still open, in parallel, best effort, each within 5 s; then the owner, which closes
    /// Chrome.
    pub async fn close_all(&self) {
        let ran = std::mem::take(&mut *self.ran.lock().expect("sessions"));
        let live = self.live.lock().expect("window").clone();
        if let (Some(live), Ok(config)) = (&live, self.window.attach_config()) {
            futures::future::join_all(ran.iter().map(|(s, g)| {
                let cdp = (*g == live.r#gen).then_some(live.url.as_str());
                tokio::time::timeout(CLOSE_TIMEOUT, self.end(s, &config, cdp))
            }))
            .await;
        }
        let owner = self.owner_config.lock().expect("owner").clone();
        if let Some(config) = owner {
            let (owner, close) = (self.window.owner(), ["close".to_owned()]);
            let close = self.run_owner(&owner, &config, &close);
            let _ = tokio::time::timeout(CLOSE_TIMEOUT, close).await;
        }
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

    /// Runs `agent-browser … <args>` in `key`'s tab and returns its `data`.
    ///
    /// # Errors
    /// `Missing` when the binary can't be started; `Failed` when there is no window, or the call times out,
    /// answers `{"success": false}` or answers no JSON; `TabGone` when the tab is gone twice.
    pub async fn run(&self, key: &str, args: &[String]) -> Result<Value, BrowserError> {
        self.attached(key, Op::Run(args)).await
    }

    /// Runs `args` in the window's owner `session`, under its `config` (`<search dir>/profiles/<n>/agent-browser.json`),
    /// in the search dir, with agent-browser's default timeout.
    ///
    /// # Errors
    /// As `run`.
    pub(crate) async fn run_owner(
        &self,
        session: &str,
        config: &Path,
        args: &[String],
    ) -> Result<Value, BrowserError> {
        *self.owner_config.lock().expect("owner") = Some(config.to_owned());
        self.run_with(session, args, None, false, Via::Owner(config))
            .await
    }

    /// `limits`: cap and wrap the page output (for answers read as text; off where the output is data).
    async fn run_with(
        &self,
        session: &str,
        args: &[String],
        stdin: Option<&str>,
        limits: bool,
        via: Via<'_>,
    ) -> Result<Value, BrowserError> {
        call(&self.bin, session, args, stdin, limits, via).await
    }

    /// Runs `commands` as one `batch --json` (read from stdin, so no value is parsed as a flag) in `key`'s tab and
    /// returns each command's result.
    ///
    /// # Errors
    /// As `run`, or when the answer is not one result per command or a command failed.
    pub async fn batch(
        &self,
        key: &str,
        commands: &[Vec<&str>],
    ) -> Result<Vec<Value>, BrowserError> {
        let answer = self.attached(key, Op::Batch(commands, true, None)).await;
        answer.map(entries)
    }

    /// `may_fail`: the index of a command whose failure doesn't fail the batch.
    async fn batch_with(
        &self,
        session: &str,
        commands: &[Vec<&str>],
        limits: bool,
        via: Via<'_>,
        may_fail: Option<usize>,
    ) -> Result<Vec<Value>, BrowserError> {
        let input = json!(commands).to_string();
        let args = ["batch".to_owned(), "--json".to_owned()];
        let answer = self
            .run_with(session, &args, Some(&input), limits, via)
            .await?;
        // One entry per command: {"command", "success", "result"}.
        let entries = answer.as_array().ok_or_else(|| {
            BrowserError::Failed("agent-browser's batch answer is not a list".into())
        })?;
        if let Some(gone) = entries.iter().find(|e| e["code"] == "tab_gone") {
            return Err(BrowserError::TabGone(failure(gone)));
        }
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

    /// The rendered `<body>` of `url` and the URL the browser ended on (redirects included), from one batch in
    /// `key`'s tab within `deadline`.
    ///
    /// Without `search`: the tab is closed again. With it: the batch waits on `ready_js` first, with `--timeout`
    /// `deadline` less `READ_MARGIN`, so a page that never gets ready (a consent wall, changed markup) times the
    /// wait out and is still read before the deadline: the parser decides what it is. That tab stays open for the
    /// next search unless the batch failed or the deadline passed.
    ///
    /// # Errors
    /// As `batch`, when the deadline passes, or when it answers no HTML or no URL.
    pub async fn render(
        &self,
        url: &Url,
        key: &str,
        search: Option<SearchRun<'_>>,
        deadline: Duration,
    ) -> Result<(String, Url), BrowserError> {
        // Never 0: what agent-browser makes of a zero timeout is unknown.
        let wait = deadline
            .saturating_sub(READ_MARGIN)
            .max(Duration::from_millis(100))
            .as_millis()
            .to_string();
        let mut cmds = vec![vec!["open", url.as_str()]];
        if let Some(s) = &search {
            cmds.push(vec!["wait", "--fn", s.ready_js, "--timeout", &wait]);
        }
        cmds.extend([vec!["get", "html", "body"], vec!["get", "url"]]);
        // The HTML is data for the extractor: no output cap, no boundary markers.
        let batch = self.attached(key, Op::Batch(&cmds, false, search.as_ref().map(|_| 1)));
        let answer = tokio::time::timeout(deadline, batch)
            .await
            .unwrap_or(Err(BrowserError::Timeout(deadline)))
            .map(entries);
        // A fetch's tab never outlives the fetch; an engine's stays unless it failed (its page may be stuck).
        if search.is_none() || answer.is_err() {
            let session = self
                .live
                .lock()
                .expect("window")
                .as_ref()
                .map(|l| name(key, l.r#gen));
            let _ = tokio::time::timeout(CLOSE_TIMEOUT, self.close(key)).await;
            if search.is_some()
                && let Some(s) = session
            {
                self.session_gone(&s).await;
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
    /// batch in a tab of its own that is closed again. The window starts before the fallback's deadline.
    ///
    /// # Errors
    /// As `batch`, or when it answers no HTML or no URL.
    pub async fn rendered_html(&self, url: &Url) -> Result<(String, Url), BrowserError> {
        static N: AtomicU64 = AtomicU64::new(0);
        self.warm().await?;
        let key = format!("{FETCH_PREFIX}{}", N.fetch_add(1, Ordering::Relaxed));
        self.render(url, &key, None, self.fallback_deadline).await
    }
}

/// What `attached` runs in a tab.
#[derive(Clone, Copy)]
enum Op<'a> {
    /// A call's args, its output limited.
    Run(&'a [String]),
    /// A batch's commands, whether its output is limited, and the index of a command that may fail.
    Batch(&'a [Vec<&'a str>], bool, Option<usize>),
}

/// A batch's results, from `attached`'s answer to an `Op::Batch`.
fn entries(v: Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a,
        v => vec![v],
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
    use std::sync::Arc;

    use super::*;
    use crate::profile::Profiles;

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

    /// The fake agent-browser with a window over a fresh search dir (the extension unpacked, a dummy browser, a
    /// socket dir). The fake logs beside each call's config: the owner's in `profiles/1/calls.jsonl`, attached
    /// calls in `calls.jsonl`.
    fn fake(tag: &str) -> (PathBuf, Browser) {
        // The fake sits next to the test binary's deps/ folder; cargo builds it for the integration tests.
        let exe = std::env::current_exe().unwrap();
        let bin = exe.parent().and_then(Path::parent).unwrap().join(format!(
            "fake-agent-browser{}",
            std::env::consts::EXE_SUFFIX
        ));
        assert!(bin.is_file(), "build the fake first: cargo build --bins");
        let dir =
            std::env::temp_dir().join(format!("web-mcp-browser-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ext = dir.join("extensions/idcac-8f70ab94");
        std::fs::create_dir_all(&ext).unwrap();
        std::fs::write(ext.join("manifest.json"), "{}").unwrap();
        std::fs::create_dir_all(dir.join("sock")).unwrap();
        std::fs::write(dir.join("browser"), "").unwrap();
        let _ = rustls::crypto::ring::default_provider().install_default();
        let p = Profiles::new(Some(dir.clone()))
            .unwrap()
            .with_chrome(dir.join("browser"));
        let mut b = Browser::new(&bin.to_string_lossy(), Window::new(Ok(Arc::new(p))));
        b.socket_dir = Some(dir.join("sock"));
        (dir, b)
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

    fn same_dir(cwd: &Value, dir: &Path) {
        let cwd = PathBuf::from(cwd.as_str().unwrap());
        assert_eq!(cwd.canonicalize().unwrap(), dir.canonicalize().unwrap());
    }

    const READY_JS: &str = "!!(document.querySelector('#r'));";
    const CDP: &str = "ws://127.0.0.1:9222/devtools/browser/1";

    #[test]
    fn check_session_reserves_search() {
        for s in [
            "search-1",
            "web-mcp-search-ab12cd34-brave",
            "web-mcp-fetch-1",
            "window",
        ] {
            assert!(check_session(s).is_err(), "{s}");
        }
        for s in ["research", "searches", "s1", "windows"] {
            assert!(check_session(s).is_ok(), "{s}");
        }
    }

    #[test]
    fn search_calls_drop_agent_browser_env() {
        let mut cmd = Command::new("x");
        let config = Path::new("/srv/search/attach.json");
        let via = Via::Tab {
            config,
            cdp: "ws://127.0.0.1:1/devtools/browser/x",
        };
        let env = [
            ("AGENT_BROWSER_PROXY", "http://127.0.0.1:9"),
            ("agent_browser_headed", "1"),
            ("PATH", "/bin"),
        ]
        .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        isolate(&mut cmd, via, env);
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
                Some(OsStr::new("8000"))
            )),
            "{set:?}"
        );
        assert!(!set.iter().any(|(k, _)| *k == "PATH"), "{set:?}");
        assert_eq!(
            cmd.as_std().get_current_dir(),
            Some(Path::new("/srv/search"))
        );
        let argv: Vec<_> = cmd.as_std().get_args().collect();
        assert_eq!(
            argv,
            [
                OsStr::new("--cdp"),
                OsStr::new("ws://127.0.0.1:1/devtools/browser/x"),
                OsStr::new("--pin-tab"),
                OsStr::new("--config"),
                config.as_os_str()
            ]
        );
    }

    #[tokio::test]
    async fn owner_calls_run_in_the_search_dir_without_timeout() {
        let (dir, b) = fake("owner");
        let slot = dir.join("profiles/1");
        std::fs::create_dir_all(&slot).unwrap();
        let config = slot.join("agent-browser.json");
        std::fs::write(&config, "{}").unwrap();
        b.run_owner(
            "web-mcp-1-window",
            &config,
            &["open".into(), "about:blank".into()],
        )
        .await
        .unwrap();
        let c = calls(&slot);
        assert_eq!(
            args(&c[0]),
            [
                "--session",
                "web-mcp-1-window",
                "--json",
                "--config",
                config.to_str().unwrap(),
                "open",
                "about:blank"
            ]
        );
        assert_eq!(c[0]["env"], json!({}));
        same_dir(&c[0]["cwd"], &dir);
    }

    #[tokio::test]
    async fn render_search_tolerates_failed_wait() {
        let (dir, b) = fake("wait");
        let url = Url::parse("http://example.com/wait-fail?q=x").unwrap();
        let run = SearchRun { ready_js: READY_JS };
        let (html, landed) = b
            .render(&url, "search-brave", Some(run), Duration::from_secs(5))
            .await
            .unwrap();
        assert!(html.contains("Rendered page for"), "{html}");
        assert_eq!(landed, url);
        let c = calls(&dir);
        assert_eq!(c.len(), 1, "a tab that answered stays open: {c:?}");
        let session = name("search-brave", 1);
        let attach = dir.join("attach.json");
        assert_eq!(
            args(&c[0]),
            [
                "--session",
                &session,
                "--json",
                "--cdp",
                CDP,
                "--pin-tab",
                "--config",
                attach.to_str().unwrap(),
                "batch",
                "--json"
            ]
        );
        let batch: Value = serde_json::from_str(c[0]["stdin"].as_str().unwrap()).unwrap();
        assert_eq!(
            batch,
            json!([
                ["open", url.as_str()],
                ["wait", "--fn", READY_JS, "--timeout", "3000"],
                ["get", "html", "body"],
                ["get", "url"]
            ])
        );
        assert_eq!(
            c[0]["env"],
            json!({"AGENT_BROWSER_DEFAULT_TIMEOUT": "8000"})
        );
        same_dir(&c[0]["cwd"], &dir);
    }

    #[tokio::test]
    async fn render_closes_on_deadline() {
        let (dir, b) = fake("deadline");
        b.warm().await.unwrap();
        let url = Url::parse("http://example.com/slow").unwrap();
        let run = SearchRun { ready_js: READY_JS };
        let err = b
            .render(&url, "search-bing", Some(run), Duration::from_millis(500))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("did not finish"), "{err}");
        let c = calls(&dir);
        assert_eq!(c.len(), 3, "{c:?}");
        let tab = args(&c[1]);
        assert_eq!(tab[tab.len() - 2..], ["tab", "close"]);
        assert!(
            tab.contains(&"--cdp") && tab.contains(&"--pin-tab"),
            "{tab:?}"
        );
        let close = args(&c[2]);
        assert_eq!(close.last(), Some(&"close"));
        assert!(close.contains(&"--config"), "{close:?}");
        assert!(
            !close.contains(&"--cdp") && !close.contains(&"--pin-tab"),
            "{close:?}"
        );
        for call in &c[1..] {
            assert_eq!(
                call["env"],
                json!({"AGENT_BROWSER_DEFAULT_TIMEOUT": "8000"})
            );
            same_dir(&call["cwd"], &dir);
        }
    }

    #[tokio::test]
    async fn close_waits_for_session_files() {
        let (dir, b) = fake("gone");
        b.warm().await.unwrap();
        let sock = dir.join("sock");
        let key = "search-duckduckgo";
        let session = name(key, 1);
        let files = [
            sock.join(format!("{session}.pid")),
            sock.join(format!("{session}.sock")),
        ];
        // A page that hangs past the deadline: the render fails, and its tab is closed.
        let url = Url::parse("http://example.com/slow").unwrap();
        let deadline = Duration::from_millis(300);
        let run = || SearchRun { ready_js: READY_JS };
        for f in &files {
            std::fs::write(f, "").unwrap();
        }
        // Files that never go: the wait gives up after 1 s (plus the deadline and the two closing calls).
        let t = std::time::Instant::now();
        b.render(&url, key, Some(run()), deadline)
            .await
            .unwrap_err();
        let capped = t.elapsed();
        assert!(capped >= deadline + Duration::from_secs(1), "{capped:?}");
        assert!(capped < Duration::from_secs(3), "{capped:?}");
        assert_eq!(args(calls(&dir).last().unwrap()).last(), Some(&"close"));
        // Files that go after 500 ms end the wait then, well before the cap.
        let gone = files.clone();
        let remover = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            for f in &gone {
                std::fs::remove_file(f).unwrap();
            }
        });
        let t = std::time::Instant::now();
        b.render(&url, key, Some(run()), deadline)
            .await
            .unwrap_err();
        let waited = t.elapsed();
        remover.join().unwrap();
        assert!(waited >= Duration::from_millis(500), "{waited:?}");
        assert!(
            waited + Duration::from_millis(400) < capped,
            "{waited:?} vs {capped:?}"
        );
    }

    #[tokio::test]
    async fn render_reads_a_page_that_never_gets_ready() {
        let (dir, b) = fake("never");
        b.warm().await.unwrap();
        let url = Url::parse("http://example.com/wait-slow").unwrap();
        let run = SearchRun { ready_js: READY_JS };
        let deadline = READ_MARGIN + Duration::from_millis(700);
        let t = std::time::Instant::now();
        let (html, landed) = b
            .render(&url, "search-google", Some(run), deadline)
            .await
            .unwrap();
        assert!(t.elapsed() < deadline, "{:?}", t.elapsed());
        assert!(html.contains("Rendered page for"), "{html}");
        assert_eq!(landed, url);
        let c = calls(&dir);
        let batch: Value = serde_json::from_str(c[0]["stdin"].as_str().unwrap()).unwrap();
        assert_eq!(
            batch[1],
            json!(["wait", "--fn", READY_JS, "--timeout", "700"])
        );
        assert_eq!(c.len(), 1, "a read page keeps its tab: {c:?}");
    }
}
