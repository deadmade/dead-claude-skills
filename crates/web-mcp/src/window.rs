//! The one browser window per server: an owner session that launches Chrome from the slot's config, and the cdp
//! url every other session attaches to.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::browser::Browser;
use crate::profile::Profiles;

/// The window as it is now: its generation (from 1, one more each time Chrome came back on a new url) and its url.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Live {
    pub r#gen: u32,
    pub url: String,
}

pub struct Window {
    profiles: Result<Arc<Profiles>, String>,
    /// The owner's config and the last answer; `None` until the first `live`.
    state: tokio::sync::Mutex<Option<(PathBuf, Live)>>,
}

impl Window {
    #[must_use]
    pub fn new(profiles: Result<Arc<Profiles>, String>) -> Self {
        Self {
            profiles,
            state: tokio::sync::Mutex::new(None),
        }
    }

    /// The owner session: the same in every generation.
    #[must_use]
    #[expect(
        clippy::unused_self,
        reason = "the window's own name, asked of the window"
    )]
    pub fn owner(&self) -> String {
        format!("web-mcp-{}-window", std::process::id())
    }

    /// The config of every call attached to the window (`<search dir>/attach.json`), written if it changed.
    ///
    /// # Errors
    /// When there is no search folder, or the file can't be written.
    pub fn attach_config(&self) -> Result<PathBuf, String> {
        self.profiles
            .as_ref()
            .map_err(Clone::clone)?
            .attach_config()
    }

    /// The window's generation and cdp url, starting it on the first call.
    ///
    /// # Errors
    /// When there is no search folder, browser or extension, or the owner fails.
    pub async fn live(&self, b: &Browser) -> Result<Live, String> {
        let p = self.profiles.as_ref().map_err(Clone::clone)?;
        let mut state = self.state.lock().await;
        let owner = self.owner();
        let get_url = ["get".to_owned(), "cdp-url".to_owned()];
        let url = async |config: &Path| {
            let v = b.run_owner(&owner, config, &get_url).await;
            let v = v.map_err(|e| e.to_string())?;
            v["cdpUrl"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("agent-browser answered no cdp url: {v}"))
        };
        if let Some((config, live)) = state.as_mut() {
            // The owner relaunches a dead Chrome itself, on a new port; a dead daemon restarts from the config.
            let url = url(config).await?;
            if url != live.url {
                *live = Live {
                    r#gen: live.r#gen + 1,
                    url,
                };
            }
            return Ok(live.clone());
        }
        let ready = p.ready().await?;
        p.slot()?;
        let config = p.owner_config(&ready)?;
        // Linux: a Chrome a killed web-mcp left in this slot (Windows has the job for that). An owner with no
        // daemon closes without starting one (web-mcp-one-window/findings.md).
        if cfg!(target_os = "linux")
            && let Some(prev) = p.previous_owner().filter(|o| *o != owner)
        {
            let close = ["close".to_owned()];
            let close = b.run_owner(&prev, &config, &close);
            let _ = tokio::time::timeout(Duration::from_secs(5), close).await;
        }
        p.set_owner(&owner);
        let open = ["open".to_owned(), "about:blank".to_owned()];
        b.run_owner(&owner, &config, &open)
            .await
            .map_err(|e| e.to_string())?;
        let live = Live {
            r#gen: 1,
            url: url(&config).await?,
        };
        *state = Some((config, live.clone()));
        Ok(live)
    }
}

/// Puts web-mcp in a kill-on-close job, so the window's daemon and Chrome die with it, even when it is killed
/// (Windows). Best effort: one line on stderr when it can't.
pub fn tie_to_process() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };
        use windows_sys::Win32::System::Threading::GetCurrentProcess;

        // SAFETY: plain Win32 calls on a zeroed info struct and the handles they return. The job's handle is never
        // closed on success: the system closes it when web-mcp exits, which is what kills the job.
        unsafe {
            // No security attributes: the handle isn't inherited, so no child keeps the job open.
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let tied = !job.is_null()
                && SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast(),
                    u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                        .expect("a small struct"),
                ) != 0
                && AssignProcessToJobObject(job, GetCurrentProcess()) != 0;
            if !tied {
                eprintln!(
                    "web-mcp: its browser may outlive it: no kill-on-close job ({})",
                    std::io::Error::last_os_error()
                );
                if !job.is_null() {
                    CloseHandle(job);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fake agent-browser, with a window of its own that these tests never start.
    fn fake() -> Browser {
        let exe = std::env::current_exe().unwrap();
        let fake = exe.parent().and_then(Path::parent).unwrap().join(format!(
            "fake-agent-browser{}",
            std::env::consts::EXE_SUFFIX
        ));
        assert!(fake.is_file(), "build the fake first: cargo build --bins");
        Browser::new(&fake.to_string_lossy(), Window::new(Err("unused".into())))
    }

    /// A search dir with the extension unpacked and a dummy browser, and its window.
    fn window(tag: &str) -> (PathBuf, Window) {
        let dir = std::env::temp_dir().join(format!("web-mcp-window-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ext = dir.join("extensions/idcac-8f70ab94");
        std::fs::create_dir_all(&ext).unwrap();
        std::fs::write(ext.join("manifest.json"), "{}").unwrap();
        let chrome = dir.join("browser");
        std::fs::write(&chrome, "").unwrap();
        let _ = rustls::crypto::ring::default_provider().install_default();
        let p = Profiles::new(Some(dir.clone()))
            .unwrap()
            .with_chrome(chrome);
        (dir, Window::new(Ok(Arc::new(p))))
    }

    /// The fake's calls in slot 1, as their commands after the global flags.
    fn calls(dir: &Path) -> Vec<(String, String)> {
        std::fs::read_to_string(dir.join("profiles/1/calls.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| {
                let v: serde_json::Value = serde_json::from_str(l).unwrap();
                let a: Vec<&str> = v["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| a.as_str().unwrap())
                    .collect();
                // --session <s> --json --config <path> <command…>
                assert_eq!([a[0], a[2], a[3]], ["--session", "--json", "--config"]);
                (a[1].to_owned(), a[5..].join(" "))
            })
            .collect()
    }

    fn url(c: &str) -> String {
        format!("ws://127.0.0.1:9222/devtools/browser/{c}")
    }

    #[tokio::test]
    async fn live_starts_once_for_parallel_callers() {
        let (dir, w) = window("parallel");
        let b = fake();
        let (x, y) = tokio::join!(w.live(&b), w.live(&b));
        let first = Live {
            r#gen: 1,
            url: url("1"),
        };
        assert_eq!(x.unwrap(), first);
        assert_eq!(y.unwrap(), first);
        let opens: Vec<_> = calls(&dir)
            .into_iter()
            .filter(|(_, c)| c.starts_with("open"))
            .collect();
        assert_eq!(opens, [(w.owner(), "open about:blank".to_owned())]);
    }

    #[tokio::test]
    async fn same_url_keeps_the_generation() {
        let (dir, w) = window("same");
        let b = fake();
        w.live(&b).await.unwrap();
        let before = calls(&dir);
        assert_eq!(
            w.live(&b).await.unwrap(),
            Live {
                r#gen: 1,
                url: url("1")
            }
        );
        let after = calls(&dir);
        assert_eq!(
            after[before.len()..],
            [(w.owner(), "get cdp-url".to_owned())]
        );
    }

    #[tokio::test]
    async fn changed_url_starts_next_generation() {
        let (dir, w) = window("changed");
        let b = fake();
        assert_eq!(w.live(&b).await.unwrap().r#gen, 1);
        std::fs::write(dir.join("profiles/1/chrome"), "2").unwrap();
        assert_eq!(
            w.live(&b).await.unwrap(),
            Live {
                r#gen: 2,
                url: url("2")
            }
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn previous_owner_is_closed_first() {
        let (dir, w) = window("previous");
        std::fs::create_dir_all(dir.join("profiles/1")).unwrap();
        std::fs::write(dir.join("profiles/1/owner"), "web-mcp-999999-window").unwrap();
        w.live(&fake()).await.unwrap();
        let c = calls(&dir);
        assert_eq!(
            c[..2],
            [
                ("web-mcp-999999-window".to_owned(), "close".to_owned()),
                (w.owner(), "open about:blank".to_owned())
            ]
        );
        let owner = std::fs::read_to_string(dir.join("profiles/1/owner")).unwrap();
        assert_eq!(owner, w.owner());
    }

    /// Run as a helper (`WEB_MCP_TIE_HELPER` = a pid file): ties itself, starts a sleeping child, writes its pid
    /// and waits to be killed.
    #[cfg(windows)]
    #[test]
    fn tie_to_process_kills_children() {
        use std::time::{Duration, Instant};
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };

        if let Some(pid_file) = std::env::var_os("WEB_MCP_TIE_HELPER") {
            tie_to_process();
            let mut child = std::process::Command::new("ping")
                .args(["-n", "60", "127.0.0.1"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap();
            std::fs::write(pid_file, child.id().to_string()).unwrap();
            let _ = child.wait(); // until the test kills this helper
            return;
        }
        let pid_file = std::env::temp_dir().join(format!("web-mcp-tie-{}", std::process::id()));
        let _ = std::fs::remove_file(&pid_file);
        let mut helper = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "window::tests::tie_to_process_kills_children"])
            .env("WEB_MCP_TIE_HELPER", &pid_file)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let until = Instant::now() + Duration::from_secs(20);
        let pid = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_file)
                .ok()
                .and_then(|s| s.parse::<u32>().ok())
            {
                break pid;
            }
            assert!(Instant::now() < until, "the helper never started its child");
            std::thread::sleep(Duration::from_millis(50));
        };
        // SAFETY: plain Win32 calls on a pid and the handle they return, closed below.
        unsafe {
            let child = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            assert!(!child.is_null(), "the child is already gone");
            helper.kill().unwrap(); // TerminateProcess: no cleanup runs in the helper
            let gone = WaitForSingleObject(child, 2000) == WAIT_OBJECT_0;
            CloseHandle(child);
            assert!(gone, "the child outlived its killed parent");
        }
        let _ = helper.wait();
    }
}
