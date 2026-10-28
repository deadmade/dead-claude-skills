//! Reads a Claude Code session transcript (JSONL) and its subagents' transcripts. Claude Code's transcript format is
//! parsed here and nowhere else. The format is not documented or stable, so every field is read defensively: a line
//! that does not parse (a half line at the end of a file still being written) or an entry kind we do not know is
//! skipped, never an error.

use std::fs;
use std::path::Path;

use serde_json::Value;

/// One subagent's transcript with the facts from its `.meta.json`.
pub struct SubTranscript {
    pub(crate) id: String,
    pub(crate) meta: Value,
    pub(crate) entries: Vec<Value>,
}

/// A session's entries and its subagents'. Internal: the views get [`super::Activity`].
pub struct Transcript {
    pub(crate) main: Vec<Value>,
    pub(crate) agents: Vec<SubTranscript>,
}

/// Every line of `path` that parses as a JSON object; empty when the file is missing or unreadable.
fn read_entries(path: &Path) -> Vec<Value> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    String::from_utf8_lossy(&bytes)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(Value::is_object)
        .collect()
}

/// Reads the session at `main` and the subagents in `<session>/subagents/agent-*.jsonl` (the folder next to the
/// file, named like it without `.jsonl`), each with its `agent-*.meta.json`.
#[must_use]
pub fn read_transcript(main: &Path) -> Transcript {
    let mut agents = Vec::new();
    if let Ok(dir) = fs::read_dir(main.with_extension("").join("subagents")) {
        for entry in dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name
                .strip_prefix("agent-")
                .and_then(|n| n.strip_suffix(".jsonl"))
            else {
                continue;
            };
            let meta = fs::read(path.with_extension("meta.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or(Value::Null);
            agents.push(SubTranscript {
                id: id.to_string(),
                meta,
                entries: read_entries(&path),
            });
        }
    }
    agents.sort_by(|a, b| a.id.cmp(&b.id));
    Transcript {
        main: read_entries(main),
        agents,
    }
}
