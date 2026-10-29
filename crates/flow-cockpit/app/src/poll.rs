//! The poll: every 2 s it stats the folders the cockpit reads and tells the window what changed. It stats, and reads
//! nothing else itself but `config.toml` when that changed: the Claude projects folder (each transcript and subagent
//! transcript), the capture folder, each project's `docs/` and `.superpowers/sdd/` trees, both extensions folders and
//! `config.toml`. A folder that doesn't exist yet is checked again on every tick, so one made later is seen.
//!
//! The poll is the index's only writer. Each tick it rebuilds the projects whose files changed, rescans links when a
//! transcript changed (the cache reads only what grew), and refreshes every status against the clock. A changed
//! `config.toml` switches extensions on and off, and rebuilds the index when the projects it hides or trusts changed.

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

/// `config.toml`: where it is, the settings last read from it, and its signature when they were read.
pub struct ConfigFile {
    path: PathBuf,
    /// A file that doesn't parse leaves these as they were (the defaults, at start).
    pub config: Config,
    sig: ConfigSig,
}

/// The signature of `config.toml` itself, a symlink's own included, and of the file it points to. home-manager links
/// it into the Nix store, where every file's mtime is 1: a switch to a file of the same length shows only in the new
/// link's own mtime.
type ConfigSig = (Option<Sig>, Option<Sig>);

fn config_sig(path: &Path) -> ConfigSig {
    let own = fs::symlink_metadata(path)
        .ok()
        .map(|meta| (meta.len(), meta.modified().ok()));
    (own, sig(path))
}

impl ConfigFile {
    /// Reads `path`; a file that doesn't parse is reported on stderr and gives the defaults. The signature is taken
    /// first, so a save while the window starts is read again on the poll's first tick.
    #[must_use]
    pub fn load(path: PathBuf) -> ConfigFile {
        let sig = config_sig(&path);
        let config = Config::load(&path).unwrap_or_else(|e| {
            eprintln!("flow-cockpit: {e}; using the defaults");
            Config::default()
        });
        ConfigFile { path, config, sig }
    }
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
    settings: ConfigFile,
    cache: LinkCache,
    /// Whether the link scan has run. It waits for the window's first `entries` answer, so the first paint never
    /// waits for transcripts to be read.
    scanned: bool,
    /// The Claude folders the index has caught up with. A folder outside this set holds a session in a working
    /// directory no project knew; it stays outside, and every tick its transcripts change builds the whole index
    /// again, until a build has loaded one of its sessions or a tick passes without a change. (Claude Code writes a
    /// queue line before the prompt, so the first build often finds no `cwd` yet.)
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
    /// since; `config.toml` from when `settings` read it, which is what the index was built with.
    #[must_use]
    pub fn new(home: Home, settings: ConfigFile, shared: &Shared) -> Poller {
        let transcripts = list_transcripts(&home.claude_projects);
        let (projects, entries) = snapshot(&shared.read());
        Poller {
            folders: folders_with_transcripts(&home.claude_projects, &transcripts),
            captures: list_files(&home.capture_dir),
            trees: trees_of(&projects),
            views: views_fingerprint(shared),
            settings,
            transcripts,
            projects,
            entries,
            home,
            cache: LinkCache::default(),
            scanned: false,
        }
    }

    /// One poll: brings the shared index up to date and returns what the window should hear, each project at most
    /// once.
    pub fn tick(&mut self, shared: &Shared, now: Timestamp) -> Vec<Event> {
        let mut events = Vec::new();
        let (switched, reconfigured) = self.reread_config(shared);
        let views = views_fingerprint(shared);
        if views != self.views || switched {
            self.views = views;
            events.push(Event::ViewsChanged);
        }

        let transcripts = list_transcripts(&self.home.claude_projects);
        let captures = list_files(&self.home.capture_dir);
        let folders = folders_with_transcripts(&self.home.claude_projects, &transcripts);
        let trees = trees_of(&self.projects);
        let root = &self.home.claude_projects;
        let moved: BTreeSet<OsString> = changed_paths(&self.transcripts, &transcripts)
            .filter_map(|p| folder_of(root, p))
            .collect();
        let (pending, quiet): (Vec<OsString>, Vec<OsString>) = folders
            .into_iter()
            .filter(|f| !self.folders.contains(f))
            .partition(|f| moved.contains(f));
        self.folders.extend(quiet);
        let new_folder = !pending.is_empty();
        let first_scan = !self.scanned && shared.painted();
        let mut touched = BTreeSet::new();
        if new_folder || first_scan || reconfigured {
            // Built and scanned outside the lock: the first scan may read gigabytes, and the window keeps answering
            // from the old index meanwhile. A rebuilt index keeps the same cache.
            let mut fresh = Index::build(&self.home, &self.settings.config, now);
            if self.scanned || first_scan {
                fresh.scan_links(&mut self.cache);
                self.scanned = true;
            }
            // A folder is caught up once the fresh index holds one of its sessions.
            let loaded: Vec<OsString> = pending
                .into_iter()
                .filter(|f| {
                    sessions_in(root, f, &transcripts).any(|id| fresh.session_path(id).is_some())
                })
                .collect();
            self.folders.extend(loaded);
            *shared.write() = fresh;
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
        if new_folder || reconfigured || projects != self.projects {
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

    /// Reads `config.toml` again when it changed, and hands the views its `disabled`. Returns whether `disabled`
    /// changed, and whether `hidden` or `trusted` did (the index is then built again). A file that doesn't parse
    /// changes nothing; a removed one is the defaults.
    fn reread_config(&mut self, shared: &Shared) -> (bool, bool) {
        let file = &mut self.settings;
        let now = config_sig(&file.path);
        if now == file.sig {
            return (false, false);
        }
        file.sig = now;
        let config = match Config::load(&file.path) {
            Ok(config) => config,
            Err(e) => {
                eprintln!("flow-cockpit: {e}; keeping the settings it had");
                return (false, false);
            }
        };
        let switched = config.disabled != file.config.disabled;
        if switched {
            shared.views.set_disabled(config.disabled.clone());
        }
        let reconfigured =
            config.hidden != file.config.hidden || config.trusted != file.config.trusted;
        file.config = config;
        (switched, reconfigured)
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

/// The ids of the sessions whose transcripts are directly in `folder`.
fn sessions_in<'a>(
    root: &'a Path,
    folder: &'a OsStr,
    transcripts: &'a HashMap<PathBuf, Sig>,
) -> impl Iterator<Item = &'a str> {
    transcripts
        .keys()
        .filter(move |p| p.parent() == Some(root.join(folder).as_path()))
        .filter_map(|p| p.file_stem()?.to_str())
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

/// Both extensions folders' fingerprints together.
fn views_fingerprint(shared: &Shared) -> u64 {
    shared
        .views
        .folders()
        .fold(0_u64, |acc, dir| acc.wrapping_add(fingerprint(dir)))
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
        for event in guarded(|| poller.tick(shared, Timestamp::now())) {
            emit(event);
        }
    }
}

/// Runs one tick's work. A panic in it is reported on stderr (after the panic message itself) and the tick tells the
/// window nothing; the next tick lists every folder afresh, so the window goes stale for one tick, not for good.
fn guarded<T: Default>(work: impl FnOnce() -> T) -> T {
    // AssertUnwindSafe: a poller left half-updated only makes the next tick see more as changed. The shared index's
    // lock may be poisoned, and `Shared` reads through that.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| {
        eprintln!("flow-cockpit: a poll tick failed; polling goes on");
        T::default()
    })
}

#[cfg(test)]
mod tests {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use flow_cockpit_core::index::{Entry, Index};

    use super::*;
    use crate::paths::Defaults;
    use crate::views::Views;

    struct World {
        root: PathBuf,
        home: Home,
        /// The default extensions folder.
        defaults: PathBuf,
        /// The user's extensions folder.
        user: PathBuf,
        config: PathBuf,
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
        /// An empty home: no Claude projects folder, capture folder, extensions folders or config yet.
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
                defaults: root.join("share/extensions"),
                user: root.join("config/extensions"),
                config: root.join("config/config.toml"),
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
            let file = self.starting(repo, id);
            append(&file, &self.user_line(repo, prompt));
            file
        }

        /// A session as Claude Code starts it: the transcript's first line is a queue entry with no `cwd`, and the
        /// prompt follows a few milliseconds later.
        fn starting(&self, repo: &str, id: &str) -> PathBuf {
            let cwd = self.path(repo);
            fs::create_dir_all(&cwd).unwrap();
            let dir = self.home.claude_projects.join(folder(&cwd));
            fs::create_dir_all(&dir).unwrap();
            let file = dir.join(format!("{id}.jsonl"));
            fs::write(
                &file,
                format!(
                    "{{\"type\":\"queue-operation\",\"operation\":\"enqueue\",\"timestamp\":\"{}\",\"sessionId\":\"{id}\"}}\n",
                    Timestamp::now()
                ),
            )
            .unwrap();
            file
        }

        fn user_line(&self, repo: &str, prompt: &str) -> String {
            format!(
                "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{prompt}\"}},\"timestamp\":\"{}\",\"cwd\":\"{}\"}}\n",
                Timestamp::now(),
                json_path(&self.path(repo))
            )
        }

        fn shared(&self) -> Shared {
            self.shared_with(&Config::default())
        }

        fn shared_with(&self, config: &Config) -> Shared {
            let index = Index::build(&self.home, config, Timestamp::now());
            let defaults = Defaults {
                found: Some(self.defaults.clone()),
                looked: vec![self.defaults.clone()],
            };
            Shared::new(
                index,
                Views::new(defaults, self.user.clone(), config.disabled.clone()),
            )
        }

        fn poller(&self, shared: &Shared) -> Poller {
            Poller::new(
                self.home.clone(),
                ConfigFile::load(self.config.clone()),
                shared,
            )
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

    fn loose(shared: &Shared, project: &str) -> Vec<String> {
        shared
            .read()
            .entries(project)
            .into_iter()
            .filter_map(|e| match e {
                Entry::Loose(s) => Some(s.id),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn new_folder_waits_for_its_first_session() {
        let w = World::empty("pending");
        w.repo("work/alpha");
        let shared = w.shared();
        let mut poller = w.poller(&shared);

        // A new project's first tick sees only the queue line Claude Code writes before the prompt.
        let s1 = w.starting("work/alpha", "s1");
        poller.tick(&shared, Timestamp::now());
        assert_eq!(shared.read().projects(), []);
        append(&s1, &w.user_line("work/alpha", "Hi."));
        assert_eq!(poller.tick(&shared, Timestamp::now()), [changed(None)]);
        let alpha = project_id(&shared, "alpha");
        assert_eq!(loose(&shared, &alpha), ["s1"]);

        // A session in a new subfolder of a known project, caught the same way.
        let s2 = w.starting("work/alpha/sub", "s2");
        poller.tick(&shared, Timestamp::now());
        append(&s2, &w.user_line("work/alpha/sub", "From a subfolder."));
        poller.tick(&shared, Timestamp::now());
        let mut ids = loose(&shared, &alpha);
        ids.sort();
        assert_eq!(ids, ["s1", "s2"]);

        // Once its session is in the index the folder is known: growth rebuilds only its project.
        append(&s2, &w.user_line("work/alpha/sub", "More."));
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [changed(Some(&alpha))]
        );
    }

    /// Not a timing test (each step adds or removes a file), so the Nix build runs it.
    #[test]
    fn extension_folder_changes_emit_views_changed() {
        let w = World::empty("extensions");
        let shared = w.shared();
        let mut poller = w.poller(&shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
        // Each extensions folder appears with an extension in it, gains a file, and loses it again.
        for folder in [&w.defaults, &w.user] {
            fs::create_dir_all(folder.join("mine")).unwrap();
            fs::write(folder.join("mine/mine.ts"), "export default {};\n").unwrap();
            assert_eq!(
                poller.tick(&shared, Timestamp::now()),
                [Event::ViewsChanged]
            );
            fs::write(folder.join("mine/style.css"), "section {}\n").unwrap();
            assert_eq!(
                poller.tick(&shared, Timestamp::now()),
                [Event::ViewsChanged]
            );
            fs::remove_file(folder.join("mine/style.css")).unwrap();
            assert_eq!(
                poller.tick(&shared, Timestamp::now()),
                [Event::ViewsChanged]
            );
            assert_eq!(poller.tick(&shared, Timestamp::now()), []);
        }
    }

    /// The defaults `docs` and `list`, one view each.
    fn two_defaults(w: &World) {
        for name in ["docs", "list"] {
            fs::create_dir_all(w.defaults.join(name)).unwrap();
            fs::write(
                w.defaults.join(name).join(format!("{name}.ts")),
                "export default {};\n",
            )
            .unwrap();
        }
    }

    fn view_ids(shared: &Shared) -> Vec<String> {
        shared.views.list().into_iter().map(|v| v.id).collect()
    }

    /// The window reads `config.toml` once at start and builds the index, which can take seconds; a save in between
    /// still applies on the first tick.
    #[test]
    fn config_saved_during_startup_applies_on_the_first_tick() {
        let w = World::empty("startup");
        two_defaults(&w);
        fs::create_dir_all(w.config.parent().unwrap()).unwrap();
        fs::write(&w.config, "disabled = []\n").unwrap();
        let settings = ConfigFile::load(w.config.clone());
        // Saved while the index builds.
        fs::write(&w.config, "disabled = ['docs']\n").unwrap();
        let shared = w.shared_with(&settings.config);
        let mut poller = Poller::new(w.home.clone(), settings, &shared);
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [Event::ViewsChanged]
        );
        assert_eq!(view_ids(&shared), ["list"]);
    }

    /// home-manager links `config.toml` into the Nix store, where every file's mtime is 1: a switch to a same-length
    /// file is seen by the new link's own mtime.
    #[cfg(unix)]
    #[test]
    fn config_symlink_switch_is_seen_at_the_same_length() {
        let w = World::empty("symlink");
        two_defaults(&w);
        let store = w.root.join("store");
        fs::create_dir_all(&store).unwrap();
        fs::create_dir_all(w.config.parent().unwrap()).unwrap();
        let epoch = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);
        for (file, text) in [
            ("a.toml", "disabled = ['docs']\n"),
            ("b.toml", "disabled = ['list']\n"),
        ] {
            fs::write(store.join(file), text).unwrap();
            fs::File::options()
                .write(true)
                .open(store.join(file))
                .unwrap()
                .set_modified(epoch)
                .unwrap();
        }
        std::os::unix::fs::symlink(store.join("a.toml"), &w.config).unwrap();
        let settings = ConfigFile::load(w.config.clone());
        let shared = w.shared_with(&settings.config);
        let mut poller = Poller::new(w.home.clone(), settings, &shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
        assert_eq!(view_ids(&shared), ["list"]);

        // A switch: a new link to a same-length file with the same mtime.
        fs::remove_file(&w.config).unwrap();
        std::os::unix::fs::symlink(store.join("b.toml"), &w.config).unwrap();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [Event::ViewsChanged]
        );
        assert_eq!(view_ids(&shared), ["docs"]);
    }

    #[test]
    fn config_change_rereads_disabled_and_hidden() {
        let w = World::alpha("config");
        fs::create_dir_all(w.defaults.join("activity")).unwrap();
        fs::write(
            w.defaults.join("activity/activity.ts"),
            "export default {};\n",
        )
        .unwrap();
        let shared = w.shared();
        let mut poller = w.poller(&shared);
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
        assert_eq!(shared.views.list().len(), 1);

        // `disabled` switches the extension off: the views reload, the data stays.
        fs::create_dir_all(w.config.parent().unwrap()).unwrap();
        fs::write(&w.config, "disabled = ['activity']\n").unwrap();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [Event::ViewsChanged]
        );
        assert_eq!(shared.views.list(), []);

        // `hidden` takes the project out of the list.
        fs::write(&w.config, "disabled = ['activity']\nhidden = ['alpha']\n").unwrap();
        assert_eq!(poller.tick(&shared, Timestamp::now()), [changed(None)]);
        assert_eq!(shared.read().projects(), []);

        // A file that doesn't parse keeps the settings it had.
        fs::write(&w.config, "disabled = [\n").unwrap();
        assert_eq!(poller.tick(&shared, Timestamp::now()), []);
        assert_eq!(shared.views.list(), []);

        // Both back: the project and the extension return.
        fs::remove_file(&w.config).unwrap();
        assert_eq!(
            poller.tick(&shared, Timestamp::now()),
            [Event::ViewsChanged, changed(None)]
        );
        assert_eq!(shared.views.list().len(), 1);
        assert_eq!(shared.read().projects().len(), 1);
    }

    #[test]
    fn a_panicking_tick_is_reported_and_polling_goes_on() {
        let failed: Vec<Event> = guarded(|| panic!("a broken tick"));
        assert_eq!(failed, []);
        assert_eq!(guarded(|| vec![Event::ViewsChanged]), [Event::ViewsChanged]);
    }
}
