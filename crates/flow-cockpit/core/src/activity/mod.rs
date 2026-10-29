//! What a Claude session and its subagents did, turn by turn, from the transcripts. Claude Code's transcript format
//! is parsed here and nowhere else. The format is not documented or stable, so every field is read defensively: a
//! line that does not parse (a half line at the end of a file still being written) or an entry kind we do not know
//! is skipped, never an error.
//!
//! A session is read through a [`TranscriptCache`], which reads only what each file gained since its last read, and
//! answers a page of turns at a time. A tool call's input stays out of the turns: [`TranscriptCache::tool_input`]
//! reads it, one call at a time.

mod transcript;

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

pub use transcript::TranscriptCache;

/// How many turns a page holds when the window doesn't say.
pub const PAGE: usize = 20;

/// A prompt or a reply, with the entry's timestamp. `agent` is the subagent that wrote it, `None` for the main session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Text {
    pub at: String,
    pub text: String,
    pub agent: Option<String>,
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

/// One tool call, without its input (that comes from `tool_input`, by `id`). `agent` is the subagent that made it,
/// `None` for the main session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ToolCall {
    pub id: String,
    pub at: String,
    pub agent: Option<String>,
    pub tool: String,
    pub summary: String,
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

/// A page of a session's turns, oldest first: the turns whose indexes are `start` up to `start + turns.len()`, out of
/// `total`. Indexes count from the session's oldest turn, so a turn keeps its index as newer ones arrive.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct Activity {
    pub turns: Vec<Turn>,
    pub start: usize,
    pub total: usize,
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

/// A tool call as the cache keeps it: its input is left in the file, at the line starting at `offset`.
struct Stub {
    id: String,
    at: String,
    agent: Option<String>,
    tool: String,
    summary: String,
    offset: u64,
}

/// What one transcript line adds to the turns: a prompt that opens one, or an assistant entry's text blocks and tool
/// calls. Thinking blocks and anything unknown are left out.
enum Item {
    Prompt(Text),
    Said {
        at: String,
        texts: Vec<Text>,
        tools: Vec<Stub>,
    },
}

/// The assistant entry's text blocks and tool calls, or `None` when it has neither.
fn said(entry: &Value, agent: Option<&str>, offset: u64) -> Option<Item> {
    let (mut texts, mut tools) = (Vec::new(), Vec::new());
    let when = at(entry);
    let text = |text: String| Text {
        at: when.clone(),
        text,
        agent: agent.map(str::to_string),
    };
    match content(entry) {
        Some(Value::String(s)) if !s.trim().is_empty() => texts.push(text(s.clone())),
        Some(Value::Array(blocks)) => {
            for b in blocks {
                match str_of(b, "type") {
                    Some("text") => {
                        let t = owned(b, "text");
                        if !t.trim().is_empty() {
                            texts.push(text(t));
                        }
                    }
                    Some("tool_use") => {
                        let tool = owned(b, "name");
                        tools.push(Stub {
                            id: owned(b, "id"),
                            at: when.clone(),
                            agent: agent.map(str::to_string),
                            summary: summary(&tool, b.get("input").unwrap_or(&Value::Null)),
                            tool,
                            offset,
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    (!texts.is_empty() || !tools.is_empty()).then_some(Item::Said {
        at: when,
        texts,
        tools,
    })
}

/// A user entry that is not `isMeta` and whose text does not start with `<` (injected reminders and command echoes)
/// is a prompt and opens a turn. The text is the string content or the array's `text` blocks joined, so a prompt
/// with an image still counts and a tool result (no text blocks) does not.
pub(crate) fn prompt_of(entry: &Value) -> Option<Text> {
    if str_of(entry, "type") != Some("user")
        || entry.get("isMeta").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let text = match content(entry)? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| str_of(b, "type") == Some("text"))
            .filter_map(|b| str_of(b, "text"))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    (!text.trim().is_empty() && !text.starts_with('<')).then(|| Text {
        at: at(entry),
        text,
        agent: None,
    })
}

/// What a run of a transcript's lines holds, in order.
#[derive(Default)]
struct Lines {
    items: Vec<Item>,
    /// Tool-result id to whether it failed; a later result for the same id wins.
    results: HashMap<String, bool>,
    first_at: Option<String>,
    last_at: Option<String>,
}

impl Lines {
    /// Adds one line (its newline stripped), which starts at byte `offset` of its file. A subagent's transcript
    /// (`agent` set) opens no turns: only the main session's prompts do.
    fn add(&mut self, line: &[u8], offset: u64, agent: Option<&str>) {
        let Ok(entry) = serde_json::from_str::<Value>(&String::from_utf8_lossy(line)) else {
            return;
        };
        if !entry.is_object() {
            return;
        }
        if let Some(t) = str_of(&entry, "timestamp") {
            self.first_at.get_or_insert_with(|| t.to_string());
            self.last_at = Some(t.to_string());
        }
        match str_of(&entry, "type") {
            Some("user") => {
                for b in content(&entry)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|b| str_of(b, "type") == Some("tool_result"))
                {
                    if let Some(id) = str_of(b, "tool_use_id") {
                        let failed = b.get("is_error").and_then(Value::as_bool) == Some(true);
                        self.results.insert(id.to_string(), failed);
                    }
                }
                if agent.is_none()
                    && let Some(prompt) = prompt_of(&entry)
                {
                    self.items.push(Item::Prompt(prompt));
                }
            }
            Some("assistant") => self.items.extend(said(&entry, agent, offset)),
            _ => {}
        }
    }
}

/// One file's lines as read so far: the complete ones, then the last line while it has no newline yet.
struct Parts<'a> {
    done: &'a Lines,
    tail: &'a Lines,
}

impl<'a> Parts<'a> {
    fn items(&self) -> impl Iterator<Item = &'a Item> {
        self.done.items.iter().chain(&self.tail.items)
    }

    fn result(&self, id: &str) -> Option<bool> {
        self.tail
            .results
            .get(id)
            .or_else(|| self.done.results.get(id))
            .copied()
    }
}

/// A subagent's lines with the facts from its `.meta.json`.
struct AgentParts<'a> {
    id: &'a str,
    meta: &'a Value,
    parts: Parts<'a>,
}

fn agent_info(a: &AgentParts<'_>) -> AgentInfo {
    let meta = |k: &str| str_of(a.meta, k).map(str::to_string);
    let finished = a.meta.get("finished").and_then(Value::as_bool) == Some(true);
    let (done, tail) = (a.parts.done, a.parts.tail);
    AgentInfo {
        id: a.id.to_string(),
        description: meta("description"),
        kind: meta("agentType"),
        model: meta("model"),
        started: done.first_at.clone().or_else(|| tail.first_at.clone()),
        ended: if finished {
            tail.last_at.clone().or_else(|| done.last_at.clone())
        } else {
            None
        },
    }
}

/// A turn while the page is assembled: where it starts and the items that went into it.
struct Slot<'a> {
    prompt: Option<&'a Text>,
    start: &'a str,
    items: Vec<&'a Item>,
}

/// Groups the transcripts into turns and builds the page of the `limit` turns before index `before` (the newest when
/// `None`). A subagent's entries go into the turn that was open when they were written. Only the page's turns are
/// built; the rest are counted.
fn page(
    main: &Parts<'_>,
    agents: &[AgentParts<'_>],
    before: Option<usize>,
    limit: usize,
) -> Activity {
    let mut slots: Vec<Slot> = Vec::new();
    for item in main.items() {
        match item {
            Item::Prompt(p) => slots.push(Slot {
                prompt: Some(p),
                start: &p.at,
                items: Vec::new(),
            }),
            Item::Said { at, .. } => {
                if slots.is_empty() {
                    slots.push(Slot {
                        prompt: None,
                        start: at,
                        items: Vec::new(),
                    });
                }
                if let Some(last) = slots.last_mut() {
                    last.items.push(item);
                }
            }
        }
    }
    // The open turn at `at` is the last that started at or before it, else the first. Turns start in time order in
    // every transcript seen; a binary search finds it then.
    let sorted = slots.windows(2).all(|w| w[0].start <= w[1].start);
    for item in agents.iter().flat_map(|a| a.parts.items()) {
        let Item::Said { at, .. } = item else {
            continue;
        };
        if slots.is_empty() {
            slots.push(Slot {
                prompt: None,
                start: at,
                items: Vec::new(),
            });
        }
        let i = if sorted {
            slots
                .partition_point(|s| s.start <= at.as_str())
                .saturating_sub(1)
        } else {
            slots
                .iter()
                .rposition(|s| s.start <= at.as_str())
                .unwrap_or(0)
        };
        slots[i].items.push(item);
    }

    let total = slots.len();
    let end = before.unwrap_or(total).min(total);
    let start = end.saturating_sub(limit);
    // The last result for a call wins, files in the order main, then the agents by id.
    let failed = |id: &str| {
        agents
            .iter()
            .rev()
            .map(|a| &a.parts)
            .chain(std::iter::once(main))
            .find_map(|p| p.result(id))
            .unwrap_or(false)
    };
    let turns = slots[start..end]
        .iter()
        .map(|slot| {
            let mut turn = Turn {
                prompt: slot.prompt.cloned(),
                ..Turn::default()
            };
            for item in &slot.items {
                if let Item::Said { texts, tools, .. } = item {
                    turn.replies.extend(texts.iter().cloned());
                    turn.tools.extend(tools.iter().map(|s| ToolCall {
                        id: s.id.clone(),
                        at: s.at.clone(),
                        agent: s.agent.clone(),
                        tool: s.tool.clone(),
                        summary: s.summary.clone(),
                        failed: failed(&s.id),
                    }));
                }
            }
            turn.replies.sort_by(|a, b| a.at.cmp(&b.at));
            turn.tools.sort_by(|a, b| a.at.cmp(&b.at));
            turn
        })
        .collect();
    Activity {
        turns,
        start,
        total,
        agents: agents.iter().map(agent_info).collect(),
        live: Live::default(),
    }
}

/// The input of the call `id` in the line read back from its file, when that line still holds it.
fn input_in(line: &[u8], id: &str) -> Option<ToolDetail> {
    let entry: Value = serde_json::from_str(&String::from_utf8_lossy(line)).ok()?;
    content(&entry)?
        .as_array()?
        .iter()
        .filter(|b| str_of(b, "type") == Some("tool_use"))
        .find(|b| str_of(b, "id") == Some(id))
        .map(|b| detail(&owned(b, "name"), b.get("input").unwrap_or(&Value::Null)))
}
