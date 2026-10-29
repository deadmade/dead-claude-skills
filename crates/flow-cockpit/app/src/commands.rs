//! The window's read-only commands. Each reads the shared index or the extensions folders and changes nothing; the
//! poll thread is the only writer of the index.
//!
//! The commands run off the main thread (`async`), so reading a large transcript for `session` never stalls the
//! window, and they share the index through a read lock. A session's transcript is read outside that lock, through
//! the transcript cache, which reads only what the files gained since. A session's capture file, likewise, through
//! the capture cache.

// Tauri hands a command its `State` by value.
#![expect(clippy::needless_pass_by_value)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use flow_cockpit_core::activity::{
    Activity, CaptureCache, PAGE, SessionLive, ToolDetail, TranscriptCache,
};
use flow_cockpit_core::index::{DocName, Entry, FlowRun, Index, Project};
use tauri::State;

use crate::views::{Extensions, ViewInfo, Views};

/// What the commands and the poll share.
pub struct Shared {
    index: RwLock<Index>,
    pub views: Views,
    /// Set by the first `entries` answer: the window has painted, and the poll may start the link scan.
    painted: AtomicBool,
    transcripts: Mutex<TranscriptCache>,
    captures: Mutex<CaptureCache>,
}

impl Shared {
    #[must_use]
    pub fn new(index: Index, views: Views) -> Shared {
        Shared {
            index: RwLock::new(index),
            views,
            painted: AtomicBool::new(false),
            transcripts: Mutex::new(TranscriptCache::default()),
            captures: Mutex::new(CaptureCache::default()),
        }
    }

    /// A panic during a read leaves the cache with what it had parsed, which is still worth showing.
    fn transcripts(&self) -> MutexGuard<'_, TranscriptCache> {
        self.transcripts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// A page of the session's turns (see [`TranscriptCache::page`]), `limit` [`PAGE`] when not given, with what it
    /// waits for. The index is only asked for the paths: the reads never hold the index lock.
    pub fn session(
        &self,
        id: &str,
        before: Option<usize>,
        limit: Option<usize>,
    ) -> Option<Activity> {
        let path = self.read().session_path(id)?;
        let mut page = self
            .transcripts()
            .page(&path, before, limit.unwrap_or(PAGE));
        page.live = self.live(id).map(|s| s.live).unwrap_or_default();
        Some(page)
    }

    /// What the session waits for, from its capture file, and when it last wrote anything; `None` for a session the
    /// index doesn't know. Like
    /// [`Shared::session`], the read never holds the index lock.
    pub fn live(&self, id: &str) -> Option<SessionLive> {
        let (path, capture) = {
            let index = self.read();
            (index.session_path(id)?, index.capture_path(id))
        };
        Some(self.captures().live(&capture, &path))
    }

    /// Like the transcripts: a panic during a read leaves what was read, which is still worth showing.
    fn captures(&self) -> MutexGuard<'_, CaptureCache> {
        self.captures.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// One tool call's input, by the session and the call's id.
    pub fn tool_input(&self, session: &str, tool: &str) -> Option<ToolDetail> {
        let path = self.read().session_path(session)?;
        self.transcripts().tool_input(&path, tool)
    }

    /// A panic in another holder leaves the index as it was last written, which is still worth showing.
    pub fn read(&self) -> RwLockReadGuard<'_, Index> {
        self.index.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn write(&self) -> RwLockWriteGuard<'_, Index> {
        self.index.write().unwrap_or_else(PoisonError::into_inner)
    }

    #[must_use]
    pub fn painted(&self) -> bool {
        self.painted.load(Ordering::Acquire)
    }

    /// The project's entries; the first answer lets the poll start the link scan.
    pub fn entries(&self, project: &str) -> Vec<Entry> {
        let entries = self.read().entries(project);
        self.painted.store(true, Ordering::Release);
        entries
    }
}

type Data<'a> = State<'a, Arc<Shared>>;

#[tauri::command(async)]
pub fn projects(data: Data<'_>) -> Vec<Project> {
    data.read().projects()
}

#[tauri::command(async)]
pub fn entries(data: Data<'_>, project: &str) -> Vec<Entry> {
    data.entries(project)
}

#[tauri::command(async)]
pub fn flow_run(data: Data<'_>, project: &str, slug: &str) -> Option<FlowRun> {
    data.read().flow_run(project, slug)
}

/// `name` is the binding's `DocName`: `"Flow"`, `"Spec"` or `"Plan"`.
#[tauri::command(async)]
pub fn doc(data: Data<'_>, project: &str, slug: &str, name: &str) -> Option<String> {
    let name = match name {
        "Flow" => DocName::Flow,
        "Spec" => DocName::Spec,
        "Plan" => DocName::Plan,
        _ => return None,
    };
    data.read().doc(project, slug, name)
}

/// The newest `limit` turns (20 when not given) before the turn index `before` (the newest when not given).
#[tauri::command(async)]
pub fn session(
    data: Data<'_>,
    id: &str,
    before: Option<usize>,
    limit: Option<usize>,
) -> Option<Activity> {
    data.session(id, before, limit)
}

/// The input of the session's tool call `tool`, by its id.
#[tauri::command(async)]
pub fn tool_input(data: Data<'_>, session: &str, tool: &str) -> Option<ToolDetail> {
    data.tool_input(session, tool)
}

#[tauri::command(async)]
pub fn views(data: Data<'_>) -> Vec<ViewInfo> {
    data.views.list()
}

/// The view's code, types stripped; the error names the line. `builtin: true` reads the default extensions' view
/// even when one of the user's replaces it: the runtime draws it below a broken replacement.
#[tauri::command(async)]
pub fn view_source(data: Data<'_>, id: &str, builtin: Option<bool>) -> Result<String, String> {
    data.views.source(id, builtin.unwrap_or(false))
}

/// The loaded extensions' styles, the ones switched off, and where the defaults were looked for when missing.
#[tauri::command(async)]
pub fn extensions(data: Data<'_>) -> Extensions {
    data.views.extensions()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::thread;
    use std::time::{Duration, Instant};

    use flow_cockpit_core::index::{Config, Home};
    use jiff::Timestamp;

    use super::*;
    use crate::paths::Defaults;

    /// A home with one session, `s1`, of one prompt; removed when dropped.
    struct Home1(PathBuf, Shared);

    impl Drop for Home1 {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    fn home(tag: &str) -> Home1 {
        let root =
            std::env::temp_dir().join(format!("flow-cockpit-cmd-{}-{tag}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        let cwd = root.join("work/alpha");
        fs::create_dir_all(&cwd).unwrap();
        let folder: String = cwd
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let dir = root.join("claude/projects").join(folder);
        fs::create_dir_all(&dir).unwrap();
        let cwd_json = cwd.to_string_lossy().replace('\\', "\\\\");
        fs::write(
            dir.join("s1.jsonl"),
            format!(
                "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"Hi.\"}},\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"{cwd_json}\"}}\n"
            ),
        )
        .unwrap();
        let home = Home {
            claude_projects: root.join("claude/projects"),
            capture_dir: root.join("capture"),
        };
        let index = Index::build(&home, &Config::default(), Timestamp::now());
        let views = Views::new(
            Defaults {
                found: None,
                looked: Vec::new(),
            },
            root.join("extensions"),
            Vec::new(),
        );
        Home1(root, Shared::new(index, views))
    }

    /// A session read waits on the transcripts, never on the index: while one is slow, the poll can still write.
    #[test]
    fn session_read_leaves_the_index_lock_free() {
        let h = home("unlocked");
        let shared = &h.1;
        // A slow read of another session holds the transcripts.
        let held = shared.transcripts();
        thread::scope(|s| {
            let reader = s.spawn(|| shared.session("s1", None, None));
            thread::sleep(Duration::from_millis(100));
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut wrote = false;
            while !wrote && Instant::now() < deadline {
                wrote = shared.index.try_write().is_ok();
            }
            drop(held);
            assert!(
                wrote,
                "the index stayed locked while the read waited for the transcripts"
            );
            let page = reader.join().unwrap().expect("s1 is in the index");
            assert_eq!(page.turns.len(), 1);
        });
        assert!(shared.session("nope", None, None).is_none());
        assert!(shared.tool_input("s1", "toolu_nope").is_none());
    }
}
