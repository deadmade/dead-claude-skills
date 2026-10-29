//! The poll: every 2 s it stats the folders the cockpit reads and tells the window what changed. It stats, and reads
//! nothing else itself: the Claude projects folder (each transcript and subagent transcript), the capture folder, each
//! project's `docs/` and `.superpowers/sdd/` trees, and the global views folder. A folder that doesn't exist yet is
//! checked again on every tick, so one made later is seen.
//!
//! The poll is the index's only writer. Each tick it rebuilds the projects whose files changed, rescans links when a
//! transcript changed (the cache reads only what grew), and refreshes every status against the clock.

use std::collections::{BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use flow_cockpit_core::index::{Config, Entry, Home, Index, LinkCache, Project};
use jiff::Timestamp;
use serde::Serialize;
use ts_rs::TS;

use crate::commands::Shared;

/// The `changed` event's payload: `project` is `None` when the project list itself may have changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Changed {
    pub project: Option<String>,
}

/// What a tick tells the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// `changed`.
    Changed(Changed),
    /// `views-changed`.
    ViewsChanged,
}

/// A file's size and mtime: a change in either is a change.
type Sig = (u64, Option<SystemTime>);

pub struct Poller {
    home: Home,
    config: Config,
    cache: LinkCache,
    /// Whether the link scan has run. It waits for the window's first `entries` answer, so the first paint never
    /// waits for transcripts to be read.
    scanned: bool,
    /// The Claude folders that held a transcript at the last full build. A folder outside this set means a session
    /// in a working directory no project knew: the tick builds the whole index again.
    folders: BTreeSet<OsString>,
    transcripts: HashMap<PathBuf, Sig>,
    captures: HashMap<PathBuf, Sig>,
    /// Per project, a fingerprint of the `docs/` and `.superpowers/sdd/` trees in its roots.
    trees: HashMap<String, u64>,
    views: u64,
    /// What the window was last told about.
    projects: Vec<Project>,
    entries: HashMap<String, Vec<Entry>>,
}

impl Poller {
    /// Takes the current state of every watched folder as the baseline: the first tick reports only what changed
    /// since.
    #[must_use]
    pub fn new(home: Home, config: Config, shared: &Shared) -> Poller {
        let transcripts = list_transcripts(&home.claude_projects);
        let (projects, entries) = snapshot(&shared.read());
        Poller {
            folders: folders_with_transcripts(&home.claude_projects, &transcripts),
            captures: list_files(&home.capture_dir),
            trees: trees_of(&projects),
            views: fingerprint(shared.views.global()),
            transcripts,
            projects,
            entries,
            home,
            config,
            cache: LinkCache::default(),
            scanned: false,
        }
    }

    /// One poll: brings the shared index up to date and returns what the window should hear, each project at most
    /// once.
    pub fn tick(&mut self, shared: &Shared, now: Timestamp) -> Vec<Event> {
        let mut events = Vec::new();
        let views = fingerprint(shared.views.global());
        if views != self.views {
            self.views = views;
            events.push(Event::ViewsChanged);
        }

        let transcripts = list_transcripts(&self.home.claude_projects);
        let captures = list_files(&self.home.capture_dir);
        let folders = folders_with_transcripts(&self.home.claude_projects, &transcripts);
        let trees = trees_of(&self.projects);
        let new_folder = folders.iter().any(|f| !self.folders.contains(f));
        let first_scan = !self.scanned && shared.painted();
        let mut touched = BTreeSet::new();
        if new_folder || first_scan {
            // Built and scanned outside the lock: the first scan may read gigabytes, and the window keeps answering
            // from the old index meanwhile. A rebuilt index keeps the same cache.
            let mut fresh = Index::build(&self.home, &self.config, now);
            if self.scanned || first_scan {
                fresh.scan_links(&mut self.cache);
                self.scanned = true;
            }
            *shared.write() = fresh;
            self.folders = folders;
        } else {
            let grown = transcripts != self.transcripts;
            touched = self.touched_projects(&transcripts, &captures, &trees);
            if !touched.is_empty() || (grown && self.scanned) {
                let mut index = shared.write();
                for id in &touched {
                    index.rebuild_project(id, now);
                }
                if grown && self.scanned {
                    index.scan_links(&mut self.cache);
                }
            }
        }
        // Every tick, files changed or not: a session that stopped writing goes from Working to Idle.
        shared.write().refresh(now);
        self.transcripts = transcripts;
        self.captures = captures;

        let (projects, entries) = snapshot(&shared.read());
        if new_folder || projects != self.projects {
            events.push(Event::Changed(Changed { project: None }));
            self.trees = trees_of(&projects);
        } else {
            for p in &projects {
                if touched.contains(&p.id) || self.entries.get(&p.id) != entries.get(&p.id) {
                    events.push(Event::Changed(Changed {
                        project: Some(p.id.clone()),
                    }));
                }
            }
            self.trees = trees;
        }
        self.projects = projects;
        self.entries = entries;
        events
    }

    /// The projects whose transcripts, capture files or documents changed since the last tick.
    fn touched_projects(
        &self,
        transcripts: &HashMap<PathBuf, Sig>,
        captures: &HashMap<PathBuf, Sig>,
        trees: &HashMap<String, u64>,
    ) -> BTreeSet<String> {
        let root = &self.home.claude_projects;
        let mut folders: BTreeSet<OsString> = changed_paths(&self.transcripts, transcripts)
            .filter_map(|p| folder_of(root, p))
            .collect();
        // A capture file is named after its session, whose transcript is `<folder>/<session>.jsonl`.
        let sessions: HashMap<&OsStr, OsString> = transcripts
            .keys()
            .filter(|p| p.parent().and_then(Path::parent) == Some(root.as_path()))
            .filter_map(|p| Some((p.file_stem()?, folder_of(root, p)?)))
            .collect();
        folders.extend(
            changed_paths(&self.captures, captures)
                .filter_map(|p| sessions.get(p.file_stem()?).cloned()),
        );
        let mut touched: BTreeSet<String> = self
            .projects
            .iter()
            .filter(|p| folders.iter().any(|f| holds_sessions_of(f, p)))
            .map(|p| p.id.clone())
            .collect();
        touched.extend(
            trees
                .iter()
                .filter(|(id, print)| self.trees.get(*id) != Some(print))
                .map(|(id, _)| id.clone()),
        );
        touched
    }
}

/// The projects and each one's entries, as the window sees them.
fn snapshot(index: &Index) -> (Vec<Project>, HashMap<String, Vec<Entry>>) {
    let projects = index.projects();
    let entries = projects
        .iter()
        .map(|p| (p.id.clone(), index.entries(&p.id)))
        .collect();
    (projects, entries)
}

/// Paths added, removed or changed between two listings.
fn changed_paths<'a>(
    before: &'a HashMap<PathBuf, Sig>,
    after: &'a HashMap<PathBuf, Sig>,
) -> impl Iterator<Item = &'a PathBuf> {
    let changed = after.iter().filter(|(p, s)| before.get(*p) != Some(*s));
    let removed = before.keys().filter(|p| !after.contains_key(*p));
    changed.map(|(p, _)| p).chain(removed)
}

/// The Claude folder (the first part under the projects folder) a transcript is in.
fn folder_of(root: &Path, path: &Path) -> Option<OsString> {
    let first = path.strip_prefix(root).ok()?.components().next()?;
    Some(first.as_os_str().to_os_string())
}

/// Claude Code names a working directory's folder by turning every character but letters and digits into `-`; a
/// session in a project's root, or in a folder under it, lands in a folder named after that.
fn holds_sessions_of(folder: &OsStr, project: &Project) -> bool {
    let folder = folder.to_string_lossy();
    project.roots.iter().any(|root| {
        let name: String = root
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        folder
            .strip_prefix(name.as_str())
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
    })
}

/// Every `<folder>/<session>.jsonl` and `<folder>/<session>/subagents/*.jsonl` under the projects folder.
fn list_transcripts(root: &Path) -> HashMap<PathBuf, Sig> {
    let mut out = HashMap::new();
    for (folder, _) in entries(root).filter(|(_, kind)| kind.is_dir()) {
        for (path, kind) in entries(&folder) {
            if kind.is_dir() {
                out.extend(list_files(&path.join("subagents")));
            } else if is_jsonl(&path)
                && let Some(s) = sig(&path)
            {
                out.insert(path, s);
            }
        }
    }
    out
}

/// The folders holding at least one top-level transcript.
fn folders_with_transcripts(
    root: &Path,
    transcripts: &HashMap<PathBuf, Sig>,
) -> BTreeSet<OsString> {
    transcripts
        .keys()
        .filter(|p| p.parent().and_then(Path::parent) == Some(root))
        .filter_map(|p| folder_of(root, p))
        .collect()
}

/// The `.jsonl` files directly in `dir`.
fn list_files(dir: &Path) -> HashMap<PathBuf, Sig> {
    entries(dir)
        .filter(|(p, kind)| kind.is_file() && is_jsonl(p))
        .filter_map(|(p, _)| {
            let s = sig(&p)?;
            Some((p, s))
        })
        .collect()
}

fn is_jsonl(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "jsonl")
}

fn sig(path: &Path) -> Option<Sig> {
    let meta = fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

/// A folder's entries with their types (symlinks not followed); none when it can't be read.
fn entries(dir: &Path) -> impl Iterator<Item = (PathBuf, fs::FileType)> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| Some((e.path(), e.file_type().ok()?)))
}

fn trees_of(projects: &[Project]) -> HashMap<String, u64> {
    projects
        .iter()
        .map(|p| {
            let print = p.roots.iter().fold(0_u64, |acc, root| {
                acc.wrapping_add(fingerprint(&root.join("docs")))
                    .wrapping_add(fingerprint(&root.join(".superpowers").join("sdd")))
            });
            (p.id.clone(), print)
        })
        .collect()
}

/// A number that changes when a file under `dir` is added, removed, resized or touched; 0 when `dir` is missing. A
/// sum, so the order the folder lists in doesn't matter.
fn fingerprint(dir: &Path) -> u64 {
    let mut sum = 0_u64;
    for (path, kind) in entries(dir) {
        if kind.is_dir() {
            sum = sum.wrapping_add(fingerprint(&path));
        } else {
            let mut h = DefaultHasher::new();
            path.hash(&mut h);
            sig(&path).hash(&mut h);
            sum = sum.wrapping_add(h.finish());
        }
    }
    sum
}

/// Ticks every 2 s for as long as the app runs.
pub fn run(shared: &Shared, poller: &mut Poller, mut emit: impl FnMut(Event)) {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        for event in poller.tick(shared, Timestamp::now()) {
            emit(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use flow_cockpit_core::index::{Entry, Index};

    use super::*;
    use crate::views::{BUILTIN, Views};

    struct World {
        root: PathBuf,
        home: Home,
        views: PathBuf,
    }

    impl Drop for World {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).ok();
        }
    }

    const FLOW: &str = "---\nflow: fix\nphase: build\n---\n";

    fn json_path(p: &Path) -> String {
        p.to_string_lossy().replace('\\', "\\\\")
    }

    /// Claude Code's folder name for a working directory.
    fn folder(cwd: &Path) -> String {
        cwd.to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect()
    }

    impl World {
        /// An empty home: no Claude projects folder, capture folder or views folder yet.
        fn empty(tag: &str) -> World {
            let root = std::env::temp_dir()
                .join(format!("flow-cockpit-poll-{}-{tag}", std::process::id()));
            fs::remove_dir_all(&root).ok();
            fs::create_dir_all(&root).unwrap();
            World {
                home: Home {
                    claude_projects: root.join("claude/projects"),
                    capture_dir: root.join("capture"),
                },
                views: root.join("config/views"),
                root,
            }
        }

        /// A home with project alpha: one session and one flow run, `login`.
        fn alpha(tag: &str) -> World {
            let w = World::empty(tag);
            w.repo("work/alpha");
            w.session("work/alpha", "s1", "Hi.");
            w.flow("work/alpha", "login");
            w
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.root.join(rel)
        }

        /// A checkout without a remote: its project is named after the folder.
        fn repo(&self, rel: &str) {
            fs::create_dir_all(self.path(rel).join(".git")).unwrap();
            fs::write(
                self.path(rel).join(".git/config"),
                "[core]\n\tbare = false\n",
            )
            .unwrap();
        }

        fn flow(&self, repo: &str, slug: &str) -> PathBuf {
            let dir = self.path(repo).join("docs/features").join(slug);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("flow.md"), FLOW).unwrap();
            dir.join("flow.md")
        }

        fn session(&self, repo: &str, id: &str, prompt: &str) -> PathBuf {
            let cwd = self.path(repo);
            fs::create_dir_all(&cwd).unwrap();
            let dir = self.home.claude_projects.join(folder(&cwd));
            fs::create_dir_all(&dir).unwrap();
            let file = dir.join(format!("{id}.jsonl"));
            fs::write(
                &file,
                format!(
                    "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{prompt}\"}},\"timestamp\":\"{}\",\"cwd\":\"{}\"}}\n",
                    Timestamp::now(),
                    json_path(&cwd)
                ),
            )
            .unwrap();
            file
        }

        fn shared(&self) -> Shared {
            let index = Index::build(&self.home, &Config::default(), Timestamp::now());
            Shared::new(index, Views::new(&BUILTIN, self.views.clone()))
        }

        fn poller(&self, shared: &Shared) -> Poller {
            Poller::new(self.home.clone(), Config::default(), shared)
        }
    }

    fn project_id(shared: &Shared, name: &str) -> String {
        shared
            .read()
            .projects()
            .into_iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("no project {name}"))
            .id
    }

    fn changed(project: Option<&str>) -> Event {
        Event::Changed(Changed {
            project: project.map(str::to_string),
        })
    }

    fn append(path: &Path, text: &str) {
        OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }

    #[test]
    fn poll_emits_once_per_change() {
        let w = World::alpha("once");
        let shared = w.shared();
        let alpha = project_id(&shared, "alpha");
        let mut poller = w.poller(&shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);

        let flow = w.path("work/alpha/docs/features/login/flow.md");
        for i in 0..10 {
            append(&flow, &format!("edit {i}\n"));
        }
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);

        let transcript = w
            .home
            .claude_projects
            .join(folder(&w.path("work/alpha")))
            .join("s1.jsonl");
        for i in 0..10 {
            append(
                &transcript,
                &format!(
                    "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"More {i}.\"}}}}\n"
                ),
            );
        }
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
    }

    #[test]
    fn poll_sees_folders_created_later() {
        let w = World::empty("later");
        w.repo("work/alpha");
        let shared = w.shared();
        let mut poller = w.poller(&shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);

        // The views folder appears with a view in it.
        fs::create_dir_all(&w.views).unwrap();
        fs::write(w.views.join("mine.ts"), "export default {};\n").unwrap();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [Event::ViewsChanged]
        );

        // Claude Code's projects folder appears with alpha's first session: a new folder means a full build.
        w.session("work/alpha", "s1", "Hi.");
        assert_eq!(poller.tick(&shared, Timestamp::now()), [changed(None)]);
        let alpha = project_id(&shared, "alpha");

        // alpha's docs/ appears with a flow run.
        w.flow("work/alpha", "login");
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert!(
            shared
                .read()
                .entries(&alpha)
                .iter()
                .any(|e| matches!(e, Entry::FlowRun(r) if r.slug == "login"))
        );

        // A session in a subfolder of alpha: its own new Claude folder.
        w.session("work/alpha/sub", "s2", "From a subfolder.");
        assert_eq!(poller.tick(&shared, Timestamp::now()), [changed(None)]);
        assert!(
            shared
                .read()
                .entries(&alpha)
                .iter()
                .any(|e| matches!(e, Entry::Loose(s) if s.id == "s2"))
        );

        // The capture folder appears with a file for alpha's session.
        fs::create_dir_all(&w.home.capture_dir).unwrap();
        fs::write(w.home.capture_dir.join("s1.jsonl"), "{}\n").unwrap();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
    }

    /// A 10 MB transcript that ends by writing login's flow.md.
    fn write_big(w: &World) {
        let cwd = w.path("work/alpha");
        let file = w.session("work/alpha", "s-big", "Big one.");
        let filler = "x".repeat(1024 * 1024);
        let line = format!(
            "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"{filler}\"}}]}}}}\n"
        );
        let write = format!(
            "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"Write\",\"input\":{{\"file_path\":\"{}/docs/features/login/flow.md\",\"content\":\"x\"}}}}]}}}}\n",
            json_path(&cwd)
        );
        append(&file, &(line.repeat(10) + &write));
    }

    fn linked(shared: &Shared, project: &str) -> Vec<String> {
        shared
            .read()
            .flow_run(project, "login")
            .map(|r| r.sessions)
            .unwrap_or_default()
    }

    #[test]
    fn first_paint_before_link_scan() {
        let w = World::alpha("paint");
        write_big(&w);
        let started = Instant::now();
        let shared = w.shared();
        let alpha = project_id(&shared, "alpha");
        let mut poller = w.poller(&shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);

        // The window's first answer comes from the heads alone: nothing of the big transcript read yet.
        let entries = shared.entries(&alpha);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(e, Entry::Loose(s) if s.id == "s-big"))
        );
        assert_eq!(poller.cache.bytes_read(), 0);
        assert_eq!(linked(&shared, &alpha), Vec::<String>::new());

        // The next tick scans and links the big session to login.
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert!(poller.cache.bytes_read() >= 10 * 1024 * 1024);
        assert_eq!(linked(&shared, &alpha), ["s-big"]);

        // A session that edits login's flow.md after launch is linked on the tick after it does.
        let late = w.session("work/alpha", "s-late", "Late.");
        append(
            &late,
            &format!(
                "{{\"type\":\"assistant\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"tool_use\",\"id\":\"t2\",\"name\":\"Edit\",\"input\":{{\"file_path\":\"{}/docs/features/login/flow.md\",\"old_string\":\"a\",\"new_string\":\"b\"}}}}]}}}}\n",
                json_path(&w.path("work/alpha"))
            ),
        );
        let before = poller.cache.bytes_read();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
        assert!(poller.cache.bytes_read() - before < 1024 * 1024);
        let mut sessions = linked(&shared, &alpha);
        sessions.sort();
        assert_eq!(sessions, ["s-big", "s-late"]);
    }
}
