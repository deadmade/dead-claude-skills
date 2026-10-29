//! plan.md: one `### Task <n>: <title>` block per task.

use serde::Serialize;
use ts_rs::TS;

use super::{TaskId, blocks, field, join, normalize, strip_comments, title};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct PlanDoc {
    pub title: Option<String>,
    pub tasks: Vec<PlanTask>,
}

/// `id` is the task's number, with a letter for a task added during a build (`8`, `8b`). `depends_on`: `None` when
/// the plan does not say, `Some(vec![])` for `none`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct PlanTask {
    pub id: String,
    pub title: String,
    pub does: Option<String>,
    pub depends_on: Option<Vec<String>>,
    pub markdown: String,
}

/// Reads a plan.md: a task is a `### Task <id>: <title>` heading and everything up to the next `##` or `###` heading.
/// Tasks come in id order, so a task added during a build sits after the one it follows wherever the file has it.
#[must_use]
pub fn parse_plan(text: &str) -> PlanDoc {
    let text = strip_comments(&normalize(text));
    let mut tasks: Vec<(TaskId, PlanTask)> = Vec::new();
    // A `## ` heading ends a task, so tasks are looked for inside each `##` section.
    for section in blocks(&text, "## ") {
        let section_text = section.lines.join("\n");
        for block in blocks(&section_text, "### ") {
            let Some((id, title)) = block.heading.and_then(task_heading) else {
                continue;
            };
            let lines = &block.lines;
            tasks.push((
                id,
                PlanTask {
                    id: id.to_string(),
                    title,
                    does: field(lines, "Does").filter(|d| !d.is_empty()),
                    depends_on: field(lines, "Depends on").and_then(|d| depends(&d)),
                    markdown: join(lines),
                },
            ));
        }
    }
    // Stable: tasks with the same id keep the file's order.
    tasks.sort_by_key(|(id, _)| *id);
    PlanDoc {
        title: title(&text),
        tasks: tasks.into_iter().map(|(_, t)| t).collect(),
    }
}

/// `Task 3: The title` to `(3, "The title")`, `Task 8b: The title` to `(8b, "The title")`.
fn task_heading(heading: &str) -> Option<(TaskId, String)> {
    let (id, rest) = TaskId::parse_prefix(heading.strip_prefix("Task ")?)?;
    let title = rest.trim_start_matches(|c: char| c.is_whitespace() || ":.–—-".contains(c));
    Some((id, title.trim().to_string()))
}

/// `none` is `Some(vec![])`; `Task 1, Task 2`, `Tasks 1 and 2` and `Task 8, Task 5b` list ids; anything else is not
/// written.
fn depends(value: &str) -> Option<Vec<String>> {
    let words: Vec<&str> = value
        .split(|c: char| c.is_whitespace() || ",.;()".contains(c))
        .filter(|w| !w.is_empty())
        .collect();
    if words
        .first()
        .is_some_and(|w| w.eq_ignore_ascii_case("none"))
    {
        return Some(Vec::new());
    }
    let mut out = Vec::new();
    let mut listing = false;
    for word in words {
        if word.eq_ignore_ascii_case("task") || word.eq_ignore_ascii_case("tasks") {
            listing = true;
            continue;
        }
        if listing && (word.eq_ignore_ascii_case("and") || word == "&") {
            continue;
        }
        match (listing, TaskId::parse(word)) {
            (true, Some(id)) => out.push(id.to_string()),
            _ => listing = false,
        }
    }
    (!out.is_empty()).then_some(out)
}
