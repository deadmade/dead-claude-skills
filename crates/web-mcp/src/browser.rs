//! agent-browser, driven as a child process: one `--json` call per action, one named session per browser.

use std::collections::BTreeSet;
use std::ffi::OsStr;
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
    if s.starts_with(FETCH_PREFIX) {
        return Err(format!(
            "session names starting with `{FETCH_PREFIX}` are reserved"
        ));
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
}

impl Browser {
    /// `name` as configured: found on PATH, or kept as given so that running it reports `Missing`.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self {
            bin: Self::resolve(name).unwrap_or_else(|| name.into()),
            fallback_deadline: Duration::from_secs(30),
            opened: Mutex::default(),
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
                self.run_with(s, &close, None, false),
            )
        }))
        .await;
    }

    /// A path to an existing file, or `name` found on PATH. On Windows each `PATHEXT` extension is
    /// tried too, so npm's `agent-browser.cmd` resolves (Rust runs `.cmd` files through cmd.exe itself).
    #[must_use]
    pub fn resolve(name: &str) -> Option<PathBuf> {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        let path = std::env::var_os("PATH").unwrap_or_default();
        resolve_in(name, &path, cfg!(windows).then_some(exts.as_str()))
    }

    /// Runs `agent-browser --session <session> --json … <args>` and returns its `data`.
    ///
    /// # Errors
    /// `Missing` when the binary can't be started; `Failed` when the call times out, answers
    /// `{"success": false}`, or answers no JSON.
    pub async fn run(&self, session: &str, args: &[String]) -> Result<Value, BrowserError> {
        self.run_with(session, args, None, true).await
    }

    /// `limits`: cap and wrap the page output (for answers read as text; off where the output is data).
    async fn run_with(
        &self,
        session: &str,
        args: &[String],
        stdin: Option<&str>,
        limits: bool,
    ) -> Result<Value, BrowserError> {
        let mut cmd = Command::new(&self.bin);
        cmd.args(["--session", session, "--json"]);
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
        self.batch_with(session, commands, true).await
    }

    async fn batch_with(
        &self,
        session: &str,
        commands: &[Vec<&str>],
        limits: bool,
    ) -> Result<Vec<Value>, BrowserError> {
        let input = json!(commands).to_string();
        let args = ["batch".to_owned(), "--json".to_owned()];
        let answer = self.run_with(session, &args, Some(&input), limits).await?;
        // One entry per command: {"command", "success", "result"}.
        let entries = answer.as_array().ok_or_else(|| {
            BrowserError::Failed("agent-browser's batch answer is not a list".into())
        })?;
        if let Some(bad) = entries.iter().find(|e| e["success"] == false) {
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
        let cmds = [
            vec!["open", url.as_str()],
            vec!["get", "html", "body"],
            vec!["get", "url"],
        ];
        // The HTML is data for the extractor: no output cap, no boundary markers.
        let answer = tokio::time::timeout(
            self.fallback_deadline,
            self.batch_with(&session, &cmds, false),
        )
        .await
        .unwrap_or_else(|_| {
            Err(BrowserError::Failed(format!(
                "the page did not finish within {} s",
                self.fallback_deadline.as_secs_f32()
            )))
        });
        // Whatever happened, the session (a daemon and its Chromium) must not outlive the fetch.
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            self.run_with(&session, &["close".to_owned()], None, false),
        )
        .await;
        let answer = answer?;
        let field =
            |v: &Value, key: &str| v.as_str().or_else(|| v[key].as_str()).map(str::to_owned);
        let html = field(&answer[1], "html");
        let landed = field(&answer[2], "url").and_then(|u| Url::parse(&u).ok());
        html.zip(landed)
            .ok_or_else(|| BrowserError::Failed("agent-browser returned no HTML or URL".into()))
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
}
