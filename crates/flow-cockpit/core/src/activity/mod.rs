//! What a Claude session and its subagents did, turn by turn, from the transcripts.

mod transcript;

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

pub use transcript::{Transcript, read_transcript};

/// A prompt or a reply, with the entry's timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Text {
    pub at: String,
    pub text: String,
}

/// The tool's input, kept in the parts a view shows as a diff, a file or a command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind")]
pub enum ToolDetail {
    Edit {
        file: String,
        old: String,
        new: String,
    },
    Write {
        file: String,
        content: String,
    },
    Command {
        command: String,
        description: Option<String>,
    },
    /// Any other tool: its input as JSON text.
    Other {
        json: String,
    },
}

/// One tool call. `agent` is the subagent that made it, `None` for the main session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ToolCall {
    pub id: String,
    pub at: String,
    pub agent: Option<String>,
    pub tool: String,
    pub summary: String,
    pub detail: ToolDetail,
    pub failed: bool,
}

/// One user prompt and what followed it, subagents' tool calls included, in time order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct Turn {
    pub prompt: Option<Text>,
    pub replies: Vec<Text>,
    pub tools: Vec<ToolCall>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AgentInfo {
    pub id: String,
    pub description: Option<String>,
    pub kind: Option<String>,
    pub model: Option<String>,
    pub started: Option<String>,
    /// The last entry's time, once the agent has finished.
    pub ended: Option<String>,
}

/// What the session waits for, from capture (always `None` until capture is read).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct Live {
    pub waiting: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct Activity {
    pub turns: Vec<Turn>,
    pub agents: Vec<AgentInfo>,
    pub live: Live,
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn owned(v: &Value, key: &str) -> String {
    str_of(v, key).unwrap_or_default().to_string()
}

fn at(entry: &Value) -> String {
    owned(entry, "timestamp")
}

fn content(entry: &Value) -> Option<&Value> {
    entry.get("message")?.get("content")
}

/// The tool-result ids that failed, over all entries.
fn failures<'a>(entries: impl Iterator<Item = &'a Value>) -> HashMap<String, bool> {
    let mut out = HashMap::new();
    for e in entries.filter(|e| str_of(e, "type") == Some("user")) {
        let Some(blocks) = content(e).and_then(Value::as_array) else {
            continue;
        };
        for b in blocks
            .iter()
            .filter(|b| str_of(b, "type") == Some("tool_result"))
        {
            if let Some(id) = str_of(b, "tool_use_id") {
                let failed = b.get("is_error").and_then(Value::as_bool) == Some(true);
                out.insert(id.to_string(), failed);
            }
        }
    }
    out
}

fn detail(tool: &str, input: &Value) -> ToolDetail {
    match tool {
        "Edit" => ToolDetail::Edit {
            file: owned(input, "file_path"),
            old: owned(input, "old_string"),
            new: owned(input, "new_string"),
        },
        "Write" => ToolDetail::Write {
            file: owned(input, "file_path"),
            content: owned(input, "content"),
        },
        "Bash" => ToolDetail::Command {
            command: owned(input, "command"),
            description: str_of(input, "description").map(str::to_string),
        },
        _ => ToolDetail::Other {
            json: input.to_string(),
        },
    }
}

/// A short line naming what the call touched: the command's description or first line, else the first of a few
/// well-known input fields, else the tool's name.
fn summary(tool: &str, input: &Value) -> String {
    let line = |s: &str| {
        s.lines()
            .next()
            .unwrap_or_default()
            .chars()
            .take(120)
            .collect()
    };
    if tool == "Bash"
        && let Some(d) = str_of(input, "description").filter(|d| !d.is_empty())
    {
        return line(d);
    }
    [
        "file_path",
        "command",
        "pattern",
        "url",
        "query",
        "description",
    ]
    .iter()
    .find_map(|k| str_of(input, k).filter(|s| !s.is_empty()))
    .map_or_else(|| tool.to_string(), line)
}

/// The assistant entry's text blocks and tool calls. Thinking blocks and anything unknown are skipped.
fn assistant_parts(
    entry: &Value,
    agent: Option<&str>,
    failed: &HashMap<String, bool>,
) -> (Vec<Text>, Vec<ToolCall>) {
    let (mut texts, mut tools) = (Vec::new(), Vec::new());
    let when = at(entry);
    match content(entry) {
        Some(Value::String(s)) if !s.trim().is_empty() => texts.push(Text {
            at: when,
            text: s.clone(),
        }),
        Some(Value::Array(blocks)) => {
            for b in blocks {
                match str_of(b, "type") {
                    Some("text") => {
                        let text = owned(b, "text");
                        if !text.trim().is_empty() {
                            texts.push(Text {
                                at: when.clone(),
                                text,
                            });
                        }
                    }
                    Some("tool_use") => {
                        let id = owned(b, "id");
                        let tool = owned(b, "name");
                        let input = b.get("input").unwrap_or(&Value::Null);
                        tools.push(ToolCall {
                            failed: failed.get(&id).copied().unwrap_or(false),
                            id,
                            at: when.clone(),
                            agent: agent.map(str::to_string),
                            summary: summary(&tool, input),
                            detail: detail(&tool, input),
                            tool,
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    (texts, tools)
}

/// A user entry with string content that does not start with `<` (those are injected reminders and command
/// echoes) is a prompt and opens a turn.
fn prompt_of(entry: &Value) -> Option<Text> {
    if str_of(entry, "type") != Some("user") {
        return None;
    }
    let text = content(entry)?.as_str()?;
    (!text.trim().is_empty() && !text.starts_with('<')).then(|| Text {
        at: at(entry),
        text: text.to_string(),
    })
}

fn agent_info(sub: &transcript::SubTranscript) -> AgentInfo {
    let meta = |k: &str| str_of(&sub.meta, k).map(str::to_string);
    let times = || sub.entries.iter().filter_map(|e| str_of(e, "timestamp"));
    let finished = sub.meta.get("finished").and_then(Value::as_bool) == Some(true);
    AgentInfo {
        id: sub.id.clone(),
        description: meta("description"),
        kind: meta("agentType"),
        model: meta("model"),
        started: times().next().map(str::to_string),
        ended: if finished {
            times().next_back().map(str::to_string)
        } else {
            None
        },
    }
}

/// Groups the transcript into turns. A subagent's tool calls go into the turn that was open when they were made.
#[must_use]
pub fn activity(t: &Transcript) -> Activity {
    let failed = failures(
        t.main
            .iter()
            .chain(t.agents.iter().flat_map(|a| a.entries.iter())),
    );
    let mut turns: Vec<Turn> = Vec::new();
    let mut starts: Vec<String> = Vec::new();
    for e in &t.main {
        if let Some(prompt) = prompt_of(e) {
            starts.push(prompt.at.clone());
            turns.push(Turn {
                prompt: Some(prompt),
                ..Turn::default()
            });
            continue;
        }
        if str_of(e, "type") != Some("assistant") {
            continue;
        }
        let (texts, tools) = assistant_parts(e, None, &failed);
        if texts.is_empty() && tools.is_empty() {
            continue;
        }
        if turns.is_empty() {
            starts.push(at(e));
            turns.push(Turn::default());
        }
        if let Some(turn) = turns.last_mut() {
            turn.replies.extend(texts);
            turn.tools.extend(tools);
        }
    }
    for sub in &t.agents {
        for e in sub
            .entries
            .iter()
            .filter(|e| str_of(e, "type") == Some("assistant"))
        {
            let (_, tools) = assistant_parts(e, Some(&sub.id), &failed);
            for call in tools {
                if turns.is_empty() {
                    starts.push(call.at.clone());
                    turns.push(Turn::default());
                }
                let i = starts.iter().rposition(|s| *s <= call.at).unwrap_or(0);
                if let Some(turn) = turns.get_mut(i) {
                    turn.tools.push(call);
                }
            }
        }
    }
    for turn in &mut turns {
        turn.tools.sort_by(|a, b| a.at.cmp(&b.at));
    }
    Activity {
        turns,
        agents: t.agents.iter().map(agent_info).collect(),
        live: Live::default(),
    }
}
