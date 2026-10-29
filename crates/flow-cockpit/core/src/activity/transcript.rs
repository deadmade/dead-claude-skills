//! Reads a session's transcript and its subagents' transcripts as they grow. Each file's parsed lines are kept with
//! the byte offset read so far, so a grown file is read only from there; one that shrank or was replaced is read
//! again from its start. A last line without its newline yet is parsed on every read and kept apart, until it is
//! complete.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

use super::{Activity, AgentParts, Item, Lines, Parts, ToolDetail, input_in, page};

/// How many sessions the cache keeps; the one used longest ago goes first.
const SESSIONS: usize = 4;

/// The sessions read so far, by the path of their main transcript.
#[derive(Default)]
pub struct TranscriptCache {
    sessions: HashMap<PathBuf, Session>,
    /// Counts the reads, to find the session used longest ago.
    clock: u64,
    bytes_read: u64,
}

#[derive(Default)]
struct Session {
    main: Cached,
    /// By agent id, from `agent-<id>.jsonl`.
    agents: BTreeMap<String, Agent>,
    used: u64,
}

#[derive(Default)]
struct Agent {
    meta: Value,
    file: Cached,
}

/// One file as read so far.
#[derive(Default)]
struct Cached {
    size: u64,
    mtime: Option<SystemTime>,
    id: u64,
    /// Just after the last line that ended in a newline: the next read starts here.
    offset: u64,
    done: Lines,
    /// The last line while it has no newline: parsed again on every read.
    tail: Lines,
}

impl Cached {
    fn parts(&self) -> Parts<'_> {
        Parts {
            done: &self.done,
            tail: &self.tail,
        }
    }

    /// Reads what the file gained since the last read. A missing file reads as empty.
    fn refresh(&mut self, path: &Path, agent: Option<&str>, bytes_read: &mut u64) {
        let Ok(meta) = fs::metadata(path) else {
            *self = Cached::default();
            return;
        };
        let (size, mtime, id) = (meta.len(), meta.modified().ok(), file_id(&meta));
        if (size, mtime, id) == (self.size, self.mtime, self.id) {
            return;
        }
        if size < self.offset || mtime < self.mtime || id != self.id {
            *self = Cached::default();
        }
        let Ok(mut file) = File::open(path) else {
            return;
        };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut line = Vec::new();
        self.tail = Lines::default();
        loop {
            line.clear();
            let n = match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(n) => n as u64,
            };
            *bytes_read += n;
            if line.ends_with(b"\n") {
                let text = line.strip_suffix(b"\n").unwrap_or(&line);
                self.done
                    .add(text.strip_suffix(b"\r").unwrap_or(text), self.offset, agent);
                self.offset += n;
            } else {
                self.tail.add(&line, self.offset, agent);
            }
        }
        // The size seen before the read: a file that grew during it differs next time, and is read from `offset`.
        (self.size, self.mtime, self.id) = (size, mtime, id);
    }
}

/// The file's identity where the OS gives one cheaply (its inode), so a file moved over the old one reads afresh;
/// 0 elsewhere.
#[cfg(unix)]
pub(super) fn file_id(meta: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
pub(super) fn file_id(_: &fs::Metadata) -> u64 {
    0
}

/// `<session>/subagents/agent-<id>.jsonl` for the transcript at `main` (the folder named like it without `.jsonl`).
fn subagents(main: &Path) -> PathBuf {
    main.with_extension("").join("subagents")
}

pub(super) fn agent_path(main: &Path, id: &str) -> PathBuf {
    subagents(main).join(format!("agent-{id}.jsonl"))
}

impl Session {
    /// Reads what the session's files gained, and finds subagents that started or went.
    fn refresh(&mut self, main: &Path, bytes_read: &mut u64) {
        self.main.refresh(main, None, bytes_read);
        let mut ids: Vec<String> = fs::read_dir(subagents(main))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                Some(
                    name.strip_prefix("agent-")?
                        .strip_suffix(".jsonl")?
                        .to_string(),
                )
            })
            .collect();
        ids.sort();
        self.agents.retain(|id, _| ids.binary_search(id).is_ok());
        for id in ids {
            let path = agent_path(main, &id);
            let agent = self.agents.entry(id.clone()).or_default();
            agent.meta = fs::read(path.with_extension("meta.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or(Value::Null);
            agent.file.refresh(&path, Some(&id), bytes_read);
        }
    }

    fn page(&self, before: Option<usize>, limit: usize) -> Activity {
        let agents: Vec<AgentParts> = self
            .agents
            .iter()
            .map(|(id, a)| AgentParts {
                id,
                meta: &a.meta,
                parts: a.file.parts(),
            })
            .collect();
        page(&self.main.parts(), &agents, before, limit)
    }

    /// The file and line offset of the call `id`.
    fn find(&self, main: &Path, id: &str) -> Option<(PathBuf, u64)> {
        let has = |parts: Parts<'_>| {
            parts.items().find_map(|item| match item {
                Item::Said { tools, .. } => tools.iter().find(|s| s.id == id).map(|s| s.offset),
                Item::Prompt(_) => None,
            })
        };
        if let Some(offset) = has(self.main.parts()) {
            return Some((main.to_path_buf(), offset));
        }
        self.agents
            .iter()
            .find_map(|(agent, a)| Some((agent_path(main, agent), has(a.file.parts())?)))
    }
}

impl TranscriptCache {
    /// How many bytes of transcripts this cache has read so far.
    #[must_use]
    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    /// The session's files brought up to date, read in full when the cache doesn't hold it.
    fn session(&mut self, main: &Path) -> &Session {
        self.clock += 1;
        if !self.sessions.contains_key(main) && self.sessions.len() >= SESSIONS {
            let oldest = self
                .sessions
                .iter()
                .min_by_key(|(_, s)| s.used)
                .map(|(p, _)| p.clone());
            if let Some(oldest) = oldest {
                self.sessions.remove(&oldest);
            }
        }
        let session = self.sessions.entry(main.to_path_buf()).or_default();
        session.used = self.clock;
        session.refresh(main, &mut self.bytes_read);
        session
    }

    /// The session at `main` (its subagents in `<session>/subagents/`): the `limit` turns before turn index `before`,
    /// or the newest when it is `None`, with its agents. A missing transcript reads as a session with no turns.
    pub fn page(&mut self, main: &Path, before: Option<usize>, limit: usize) -> Activity {
        self.session(main).page(before, limit)
    }

    /// The input of the session's tool call `id`, read back from its line; `None` when no call has that id.
    pub fn tool_input(&mut self, main: &Path, id: &str) -> Option<ToolDetail> {
        let (path, offset) = self.session(main).find(main, id)?;
        let mut file = File::open(path).ok()?;
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut line = Vec::new();
        BufReader::new(file).read_until(b'\n', &mut line).ok()?;
        input_in(&line, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_sessions_used_last() {
        let dir = std::env::temp_dir().join(format!("flow-cockpit-cache-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut cache = TranscriptCache::default();
        let paths: Vec<PathBuf> = (0..=SESSIONS)
            .map(|i| dir.join(format!("s{i}.jsonl")))
            .collect();
        for p in &paths {
            fs::write(p, "").unwrap();
            cache.page(p, None, 1);
        }
        fs::remove_dir_all(&dir).ok();
        assert_eq!(cache.sessions.len(), SESSIONS);
        assert!(!cache.sessions.contains_key(&paths[0]), "the oldest went");
        assert!(cache.sessions.contains_key(&paths[SESSIONS]));
    }
}
