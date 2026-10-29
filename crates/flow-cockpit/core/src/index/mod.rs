//! The run index: the user's projects, and in each its flow runs, audits and loose sessions with their status.
//! Which Claude session belongs to which flow run, and a run's status, are decided here and nowhere else.
//!
//! Projects come from the folders Claude Code has run in (`~/.claude/projects/*/*.jsonl`, the working directory in the
//! head of each transcript). [`Index::build`] reads only those heads and the documents, so a window can paint at once;
//! [`Index::scan_links`] then reads the transcripts for the flow.md files they edited, once per file version.

mod config;
mod entries;
mod links;
mod projects;
mod status;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use jiff::Timestamp;

pub use config::{Config, Home};
pub use entries::{AuditSummary, DocName, Entry, FlowRun, FlowRunSummary, SessionSummary};
pub use links::LinkCache;
pub use projects::Project;
pub use status::Status;

use entries::{Derived, Docs, Session, derive, load_docs, mtime, read_head};
use projects::{Resolver, roots_of};

struct ProjectData {
    name: String,
    checkouts: BTreeSet<PathBuf>,
    roots: Vec<PathBuf>,
    docs: Docs,
    derived: Derived,
}

pub struct Index {
    home: Home,
    config: Config,
    /// The clock: set by `build`, `rebuild_project` and `refresh`; a link scan derives statuses against it.
    now: Timestamp,
    resolver: Resolver,
    projects: BTreeMap<String, ProjectData>,
    /// Session id to the session, over all projects.
    sessions: HashMap<String, Session>,
    /// Session id to the slugs of the flow.md files it edited, from the link scans.
    links: HashMap<String, Vec<String>>,
}

impl Index {
    /// Finds the projects, their worktrees, flow runs, audits and sessions. Reads the head of each transcript, never
    /// the rest: no link scan, so every session is loose until [`Index::scan_links`] runs.
    #[must_use]
    pub fn build(home: &Home, config: &Config, now: Timestamp) -> Index {
        let mut index = Index {
            home: home.clone(),
            config: config.clone(),
            now,
            resolver: Resolver::default(),
            projects: BTreeMap::new(),
            sessions: HashMap::new(),
            links: HashMap::new(),
        };
        for dir in projects::subdirs(&home.claude_projects) {
            index.load_dir(&dir, None, &mut HashMap::new());
        }
        let ids: Vec<String> = index.projects.keys().cloned().collect();
        for id in ids {
            index.reload(&id, now);
        }
        index
    }

    /// Reads every transcript's flow.md edits and links the sessions to their flow runs. A transcript the cache
    /// already knows (same path, size and mtime) is not read again.
    pub fn scan_links(&mut self, cache: &mut LinkCache) {
        for (id, session) in &self.sessions {
            self.links.insert(id.clone(), cache.slugs(&session.path));
        }
        let ids: Vec<String> = self.projects.keys().cloned().collect();
        for id in ids {
            self.derive_project(&id, self.now);
        }
    }

    /// Reads one project's folders and sessions again, and nothing of any other project. A session in a folder no
    /// session of this project was in before is found by the next [`Index::build`].
    pub fn rebuild_project(&mut self, id: &str, now: Timestamp) {
        // The roots first: a worktree made since the last read has its own session folder.
        let Some(project) = self.projects.get_mut(id) else {
            return;
        };
        project.roots = roots_of(&project.checkouts);
        let mut dirs: BTreeSet<PathBuf> = self
            .sessions
            .values()
            .filter(|s| s.project == id)
            .map(|s| s.dir.clone())
            .collect();
        dirs.extend(
            project
                .roots
                .iter()
                .map(|r| self.home.claude_projects.join(encode(r)))
                .filter(|d| d.is_dir()),
        );
        let mut reuse = HashMap::new();
        self.sessions.retain(|_, s| {
            if s.project == id && dirs.contains(&s.dir) {
                reuse.insert(s.path.clone(), s.clone());
                false
            } else {
                true
            }
        });
        for dir in &dirs {
            self.load_dir(dir, Some(id), &mut reuse);
        }
        self.now = now;
        self.reload(id, now);
    }

    /// Moves the clock to `now` and derives every project's statuses and loose-session cut-off again from what the
    /// index holds. Reads nothing from disk, so a poll can call it every tick: a session that stopped writing goes
    /// from Working to Idle, and a quiet run to Stale, without any file changing.
    pub fn refresh(&mut self, now: Timestamp) {
        self.now = now;
        let ids: Vec<String> = self.projects.keys().cloned().collect();
        for id in ids {
            self.derive_project(&id, now);
        }
    }

    #[must_use]
    pub fn projects(&self) -> Vec<Project> {
        let mut out: Vec<Project> = self
            .projects
            .iter()
            .map(|(id, p)| Project {
                id: id.clone(),
                name: p.name.clone(),
                roots: p.roots.clone(),
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        out
    }

    /// Flow runs (newest first), then audits (newest first), then loose sessions (newest first).
    #[must_use]
    pub fn entries(&self, project: &str) -> Vec<Entry> {
        self.projects
            .get(project)
            .map(|p| p.derived.entries.clone())
            .unwrap_or_default()
    }

    #[must_use]
    pub fn flow_run(&self, project: &str, slug: &str) -> Option<FlowRun> {
        let p = self.projects.get(project)?;
        let run = p.docs.runs.iter().find(|r| r.slug == slug)?;
        let summary = p.derived.entries.iter().find_map(|e| match e {
            Entry::FlowRun(r) if r.slug == slug => Some(r.clone()),
            _ => None,
        })?;
        Some(FlowRun {
            summary,
            flow: run.flow.clone(),
            plan: run.plan.clone(),
            ledger: run.ledger.clone(),
            sessions: p.derived.linked.get(slug).cloned().unwrap_or_default(),
        })
    }

    /// The raw text of the run's flow.md, spec.md or plan.md, from the copy of the run that is shown.
    #[must_use]
    pub fn doc(&self, project: &str, slug: &str, name: DocName) -> Option<String> {
        let run = self
            .projects
            .get(project)?
            .docs
            .runs
            .iter()
            .find(|r| r.slug == slug)?;
        let bytes = fs::read(run.dir.join(name.file())).ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The session's transcript, for a [`crate::activity::TranscriptCache`] to read: the index never reads one
    /// whole, so a caller can let go of the index before the read.
    #[must_use]
    pub fn session_path(&self, id: &str) -> Option<PathBuf> {
        Some(self.sessions.get(id)?.path.clone())
    }

    /// Adds the sessions in one `~/.claude/projects/<dir>`. With `only`, sessions of other projects are skipped.
    /// `reuse` holds sessions of earlier reads by path: their head is not read again.
    fn load_dir(&mut self, dir: &Path, only: Option<&str>, reuse: &mut HashMap<PathBuf, Session>) {
        let Ok(read) = fs::read_dir(dir) else {
            return;
        };
        let mut files: Vec<PathBuf> = read
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
            .collect();
        files.sort();
        for path in files {
            let (Some(id), Some(at)) = (
                path.file_stem().map(|s| s.to_string_lossy().into_owned()),
                mtime(&path),
            ) else {
                continue;
            };
            if let Some(mut known) = reuse.remove(&path) {
                known.mtime = at;
                self.sessions.insert(id, known);
                continue;
            }
            let Some(head) = read_head(&path) else {
                continue;
            };
            let (checkout, identity) = self.resolver.resolve(&head.cwd);
            if self.config.hides(&identity.id, &identity.name)
                || only.is_some_and(|o| o != identity.id)
            {
                continue;
            }
            let project = self
                .projects
                .entry(identity.id.clone())
                .or_insert_with(|| ProjectData {
                    name: identity.name.clone(),
                    checkouts: BTreeSet::new(),
                    roots: Vec::new(),
                    docs: Docs::default(),
                    derived: Derived::default(),
                });
            project.checkouts.insert(checkout);
            self.sessions.insert(
                id,
                Session {
                    path,
                    dir: dir.to_path_buf(),
                    project: identity.id,
                    mtime: at,
                    started: head.started.unwrap_or_else(|| at.to_string()),
                    first_prompt: head.first_prompt,
                },
            );
        }
    }

    /// Finds the project's worktrees, reads its documents again and derives its entries.
    fn reload(&mut self, id: &str, now: Timestamp) {
        if let Some(p) = self.projects.get_mut(id) {
            p.roots = roots_of(&p.checkouts);
            p.docs = load_docs(&p.roots);
        }
        self.derive_project(id, now);
    }

    fn derive_project(&mut self, id: &str, now: Timestamp) {
        let sessions: Vec<(&str, &Session)> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.project == id)
            .map(|(k, s)| (k.as_str(), s))
            .collect();
        if let Some(p) = self.projects.get_mut(id) {
            p.derived = derive(&p.docs, &sessions, &self.links, now);
        }
    }
}

/// The name Claude Code gives a working directory's transcript folder: every character but letters and digits is `-`.
fn encode(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}
