//! The SDD build log (`progress.md`): one `Task <n>: ...` line per event.

use std::collections::BTreeMap;

use serde::Serialize;
use ts_rs::TS;

use super::flow::{Ruling, ruling};
use super::{TaskId, normalize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct Ledger {
    pub plan: Option<String>,
    pub tasks: Vec<LedgerTask>,
    pub rulings: Vec<Ruling>,
}

/// `id` as in the plan: `8`, or `8b` for a task added during a build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct LedgerTask {
    pub id: String,
    pub state: TaskState,
    pub fix_rounds: u32,
    pub security: Vec<String>,
    pub later: Vec<String>,
    pub story: Vec<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
pub enum TaskState {
    #[default]
    NotStarted,
    Building,
    Review,
    Waiting,
    Done,
}

/// Reads a ledger. A line that begins `Task <id>:` (or `Tasks <a>-<b>:`, a range of plain numbers) is an entry;
/// indented lines under it, and nothing else, are its wrapped text. Any other top-level line (a `Ruling:`, a `Note`)
/// is an entry of its own, never joined to a task. A `Ruling:` anywhere is collected under `rulings`. Tasks come in id
/// order.
#[must_use]
pub fn parse_ledger(text: &str) -> Ledger {
    let text = normalize(text);
    let mut tasks: BTreeMap<TaskId, LedgerTask> = BTreeMap::new();
    let mut ledger = Ledger::default();
    for entry in entries(&text) {
        if ledger.plan.is_none() && entry.starts_with('#') {
            ledger.plan = plan_of(&entry);
        }
        if let Some((_, call)) = entry.split_once("Ruling:") {
            let mut r = ruling(call);
            r.raw = strip_bullet(&entry).to_string();
            ledger.rulings.push(r);
        }
        if let Some((ids, rest)) = task_entry(&entry) {
            for id in ids {
                apply(tasks.entry(id).or_insert_with(|| blank(id)), rest);
            }
        }
    }
    ledger.tasks = tasks.into_values().collect();
    ledger
}

fn blank(id: TaskId) -> LedgerTask {
    LedgerTask {
        id: id.to_string(),
        state: TaskState::NotStarted,
        fix_rounds: 0,
        security: Vec::new(),
        later: Vec::new(),
        story: Vec::new(),
        model: None,
    }
}

fn strip_bullet(s: &str) -> &str {
    s.strip_prefix("- ")
        .or_else(|| s.strip_prefix("* "))
        .unwrap_or(s)
        .trim()
}

/// Lines joined into entries. Blank lines and headings end an entry; every other line starts one, and only an indented line continues the one above.
fn entries(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut open = false;
    for line in text.lines() {
        let t = line.trim();
        let indented = line.starts_with([' ', '\t']);
        if t.is_empty() {
            open = false;
        } else if t.starts_with('#') && !indented {
            out.push(t.to_string());
            open = false;
        } else if open && indented {
            let last = out.last_mut().expect("open means an entry exists");
            last.push(' ');
            last.push_str(t);
        } else {
            out.push(t.to_string());
            open = true;
        }
    }
    out
}

/// `# SDD ledger — plan: <path>` to the path.
fn plan_of(heading: &str) -> Option<String> {
    let (_, path) = heading.split_once("plan:")?;
    Some(path.trim().to_string()).filter(|p| !p.is_empty())
}

/// `Task 5: rest` to `([5], "rest")`, `Task 8b: rest` to `([8b], "rest")`; `Task 1-5: rest` and `Tasks 1-5: rest`
/// cover a range of plain numbers.
fn task_entry(entry: &str) -> Option<(Vec<TaskId>, &str)> {
    let line = strip_bullet(entry);
    let rest = line
        .strip_prefix("Task ")
        .or_else(|| line.strip_prefix("Tasks "))?;
    let (head, text) = rest.split_once(':')?;
    let ids = match head.trim().split_once('-') {
        Some((a, b)) => {
            let (a, b) = (a.trim().parse::<u32>().ok()?, b.trim().parse::<u32>().ok()?);
            // A bogus range (`Task 5-99999999: x`) must not allocate millions of tasks.
            if b < a || b - a > 999 {
                vec![TaskId::plain(a)]
            } else {
                (a..=b).map(TaskId::plain).collect()
            }
        }
        None => vec![TaskId::parse(head.trim())?],
    };
    Some((ids, text.trim()))
}

/// Updates a task with one entry's text (after `Task <n>:`).
fn apply(task: &mut LedgerTask, text: &str) {
    let lower = text.to_ascii_lowercase();
    // A security entry is a finding or note that starts with "security"; "review clean, no security findings" is not.
    if lower.starts_with("security") {
        task.security.push(text.to_string());
    }
    if let Some(item) = deferred(text) {
        task.later.push(item.to_string());
        return;
    }
    let state = if lower.starts_with("complete") {
        TaskState::Done
    } else if let Some(after) = lower.strip_prefix("fix round") {
        // `fix round 2/5 (...)` closes a round; `fix round 1 implemented <sha>` is a step inside one.
        let token = after.split_whitespace().next().unwrap_or("");
        if token
            .split_once('/')
            .is_some_and(|(r, cap)| r.parse::<u32>().is_ok() && cap.parse::<u32>().is_ok())
        {
            task.fix_rounds += 1;
        }
        TaskState::Review
    } else if lower.starts_with("dispatched") {
        task.model = model_of(text).or(task.model.take());
        TaskState::Building
    } else if lower.starts_with("in progress") {
        TaskState::Building
    } else if lower.starts_with("done")
        || lower.starts_with("review")
        || lower.starts_with("implemented")
    {
        TaskState::Review
    } else if lower.starts_with("needs_context")
        || lower.starts_with("waiting")
        || lower.starts_with("blocked")
    {
        TaskState::Waiting
    } else {
        return;
    };
    task.state = state;
    task.story.push(text.to_string());
}

/// The item text of a `minor (deferred):`, `minor:` or `parked:` entry, without its tag.
fn deferred(text: &str) -> Option<&str> {
    let lower = text.to_ascii_lowercase();
    ["minor (deferred)", "parked", "minor"]
        .iter()
        .find_map(|tag| {
            // The tag is ASCII, so its length is a char boundary in `text` too.
            let rest = lower.starts_with(tag).then(|| &text[tag.len()..])?;
            let rest = rest.trim_start();
            // "parked the ..." (no colon) is still an item, "minority" is not.
            match rest.strip_prefix(':') {
                Some(item) => Some(item.trim()),
                None if *tag != "minor" && lower.starts_with(tag) => Some(text.trim()),
                None => None,
            }
        })
}

/// The word after `implementer` in a dispatch line, past a session id: `implementer 01a0-... (opus)` gives `opus`.
fn model_of(text: &str) -> Option<String> {
    let (_, after) = text.split_once("implementer")?;
    after
        .split_whitespace()
        .map(|w| w.trim_matches(['(', ')', ',', ';']))
        .find(|w| !(w.is_empty() || w.len() >= 20 && w.contains('-')) && *w != "BASE")
        .map(str::to_string)
}
