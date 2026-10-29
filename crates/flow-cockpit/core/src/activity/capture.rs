//! What a session waits for, from the capture file the hooks write (`plugins/opt-in/flow-cockpit/hooks/lib.mjs`
//! defines its lines). Only `AskUserQuestion`'s tool events are captured, besides the session, turn, agent, permission
//! and notification events, so:
//!
//! - a question (`PreToolUse` with its questions) waits until `PostToolUse` or `PostToolUseFailure` with its
//!   `tool_use_id`, or a `UserPromptSubmit`; a transcript write does not end it, since Claude writes the question there
//!   itself;
//! - a permission prompt (`PermissionRequest`) waits until the same agent's next event (a denial too), or until its
//!   transcript (the session's, or the subagent's when the line has `agent`) is written more than [`FLUSH`] after it:
//!   after an allowed prompt the next captured event may be the turn's `Stop`, minutes later. A notification is not
//!   the session moving on: Claude Code sends one when the prompt shows;
//! - a `SessionStart` or `SessionEnd` ends every wait: the Claude process that waited is gone.
//!
//! Lines are read like transcripts: a line that does not parse, or of another format version, is skipped, and a last
//! line without its newline yet waits for the next read.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use jiff::{SignedDuration, Timestamp};
use serde::Deserialize;
use serde_json::Value;

use super::transcript::{agent_path, file_id};
use super::{Live, Waiting};

/// How long after a permission prompt a write to its transcript is still the entry that raised it: Claude Code
/// finishes writing that entry after the hook took its time (37 ms later in a real session). It assumes the hook's
/// `ts` and the file's mtime come from one wall clock that doesn't jump: a forward jump of more than this ends a fresh
/// prompt at once, a backward one keeps it until the next event.
const FLUSH: SignedDuration = SignedDuration::from_secs(2);

/// One capture line: the facts the waits are read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureEvent {
    pub at: Timestamp,
    /// The hook event's name, such as `PreToolUse` or `Stop`.
    pub event: String,
    /// The subagent the event was raised in; `None` for the main session.
    pub agent: Option<String>,
    pub tool_use_id: Option<String>,
    /// `AskUserQuestion`'s first question (its header when the question is empty), and whether the hook cut the
    /// questions.
    pub question: Option<(String, bool)>,
    /// The tool a permission prompt asks for.
    pub permission_tool: Option<String>,
}

/// A line as the hook writes it; fields the waits don't need are left out.
#[derive(Deserialize)]
struct Line {
    v: u32,
    ts: String,
    event: String,
    agent: Option<String>,
    tool_use_id: Option<String>,
    questions: Option<Vec<Value>>,
    #[serde(default)]
    questions_cut: bool,
    permission_tool: Option<String>,
}

fn parse(line: &[u8]) -> Option<CaptureEvent> {
    let l: Line = serde_json::from_slice(line).ok()?;
    if l.v != 1 {
        return None;
    }
    let question = l.questions.as_deref().and_then(<[Value]>::first).map(|q| {
        let text = |k: &str| q.get(k).and_then(Value::as_str).filter(|s| !s.is_empty());
        let text = text("question")
            .or_else(|| text("header"))
            .unwrap_or_default();
        (text.to_string(), l.questions_cut)
    });
    Some(CaptureEvent {
        at: l.ts.parse().ok()?,
        event: l.event,
        agent: l.agent,
        tool_use_id: l.tool_use_id,
        question,
        permission_tool: l.permission_tool,
    })
}

/// Reads the file's complete lines from byte `offset` into `add`, and returns the offset after the last of them.
fn read_from(path: &Path, offset: u64, mut add: impl FnMut(CaptureEvent)) -> u64 {
    let Ok(mut file) = File::open(path) else {
        return offset;
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return offset;
    }
    let mut reader = BufReader::new(file);
    let (mut offset, mut line) = (offset, Vec::new());
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(n) if n > 0 && line.ends_with(b"\n") => offset += n as u64,
            _ => return offset,
        }
        if let Some(event) = parse(&line) {
            add(event);
        }
    }
}

/// The capture file's events, in the order they were written. A missing file has none.
#[must_use]
pub fn read_capture(path: &Path) -> Vec<CaptureEvent> {
    let mut events = Vec::new();
    read_from(path, 0, |e| events.push(e));
    events
}

/// One open wait.
#[derive(Debug, Clone)]
struct Wait {
    at: Timestamp,
    agent: Option<String>,
    tool_use_id: Option<String>,
    waiting: Waiting,
}

/// The waits still open after the events read so far, oldest first.
#[derive(Debug, Clone, Default)]
struct Open {
    waits: Vec<Wait>,
    /// Per agent (`None` for the main session), the newest `ts` of its events applied so far.
    latest: HashMap<Option<String>, Timestamp>,
    /// The newest `ts` of an event that ended every wait: a session's start or end, or a prompt.
    cleared: Option<Timestamp>,
}

impl Open {
    fn add(&mut self, e: &CaptureEvent) {
        if e.event == "Notification" {
            return;
        }
        // Each hook is its own process and appends when it is done, so a line can land after a newer event of its
        // agent (a prompt decided at once, then the turn's Stop): the wait it would open has already ended.
        let late = self.latest.get(&e.agent).is_some_and(|t| *t > e.at)
            || self.cleared.is_some_and(|t| t > e.at);
        let latest = self.latest.entry(e.agent.clone()).or_insert(e.at);
        *latest = (*latest).max(e.at);
        if matches!(
            e.event.as_str(),
            "SessionStart" | "SessionEnd" | "UserPromptSubmit"
        ) {
            self.waits.clear();
            self.cleared = self.cleared.max(Some(e.at));
            return;
        }
        let question = |w: &Wait| matches!(w.waiting, Waiting::Question { .. });
        // Any other event is the agent it came from moving on from its permission prompt.
        self.waits.retain(|w| question(w) || w.agent != e.agent);
        if matches!(e.event.as_str(), "PostToolUse" | "PostToolUseFailure") {
            self.waits
                .retain(|w| !question(w) || w.tool_use_id != e.tool_use_id);
        }
        if late {
            return;
        }
        match e.event.as_str() {
            // Only `AskUserQuestion`'s are captured; one without its questions asks nothing to show.
            "PreToolUse" => {
                if let Some((text, cut)) = &e.question {
                    self.waits.push(Wait {
                        at: e.at,
                        agent: e.agent.clone(),
                        tool_use_id: e.tool_use_id.clone(),
                        waiting: Waiting::Question {
                            text: text.clone(),
                            cut: *cut,
                        },
                    });
                }
            }
            "PermissionRequest" => self.waits.push(Wait {
                at: e.at,
                agent: e.agent.clone(),
                tool_use_id: None,
                waiting: Waiting::Permission {
                    tool: e.permission_tool.clone().unwrap_or_default(),
                },
            }),
            _ => {}
        }
    }

    /// The newest wait, a permission prompt left out once its transcript was written more than [`FLUSH`] after it.
    /// `written` gives the time a transcript was last written: the agent's, or the session's for `None`.
    fn shown(&self, written: impl Fn(Option<&str>) -> Option<Timestamp>) -> Option<&Wait> {
        self.waits.iter().rev().find(|w| match w.waiting {
            Waiting::Question { .. } => true,
            Waiting::Permission { .. } => {
                written(w.agent.as_deref()).is_none_or(|t| t.duration_since(w.at) <= FLUSH)
            }
        })
    }
}

/// What the events, in the order they were written, leave the session waiting for. `written(agent)` is when that
/// agent's transcript (the session's for `None`) was last written, if known; a permission prompt ends once it was
/// written more than 2 s after the prompt.
#[must_use]
pub fn live(events: &[CaptureEvent], written: impl Fn(Option<&str>) -> Option<Timestamp>) -> Live {
    let mut open = Open::default();
    for e in events {
        open.add(e);
    }
    Live {
        waiting: open.shown(written).map(|w| w.waiting.clone()),
    }
}

/// What a session waits for, and when it last wrote anything: its capture file, its transcript, or the transcript of
/// the subagent its wait belongs to. A wait whose session went quiet long ago was left behind by a process that is
/// gone; the run's status stops counting it (see the index's status rules).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionLive {
    pub live: Live,
    pub written: Option<Timestamp>,
}

/// The capture files read so far, by path: each one's waits, and how far it was read.
#[derive(Debug, Default)]
pub struct CaptureCache {
    files: HashMap<PathBuf, Cached>,
}

#[derive(Debug, Default)]
struct Cached {
    size: u64,
    mtime: Option<SystemTime>,
    id: u64,
    /// Just after the last complete line: the next read starts here.
    offset: u64,
    open: Open,
}

fn written(path: &Path) -> Option<Timestamp> {
    let t = fs::metadata(path).and_then(|m| m.modified()).ok()?;
    Timestamp::try_from(t).ok()
}

impl CaptureCache {
    /// What the session waits for, from its capture file (read from where the last read stopped, or again from its
    /// start when it shrank or was replaced) and its transcript at `transcript`. A missing capture file waits for
    /// nothing.
    pub fn live(&mut self, capture: &Path, transcript: &Path) -> SessionLive {
        let Ok(meta) = fs::metadata(capture) else {
            self.files.remove(capture);
            return SessionLive::default();
        };
        let (size, mtime, id) = (meta.len(), meta.modified().ok(), file_id(&meta));
        let file = self.files.entry(capture.to_path_buf()).or_default();
        if (size, mtime, id) != (file.size, file.mtime, file.id) {
            if size < file.offset || mtime < file.mtime || id != file.id {
                *file = Cached::default();
            }
            let open = &mut file.open;
            file.offset = read_from(capture, file.offset, |e| open.add(&e));
            (file.size, file.mtime, file.id) = (size, mtime, id);
        }
        let stat = |agent: Option<&str>| match agent {
            Some(a) => written(&agent_path(transcript, a)),
            None => written(transcript),
        };
        let shown = file.open.shown(stat);
        let last = [
            mtime.and_then(|t| Timestamp::try_from(t).ok()),
            stat(None),
            shown.and_then(|w| stat(Some(w.agent.as_deref()?))),
        ];
        SessionLive {
            live: Live {
                waiting: shown.map(|w| w.waiting.clone()),
            },
            written: last.into_iter().flatten().max(),
        }
    }
}
