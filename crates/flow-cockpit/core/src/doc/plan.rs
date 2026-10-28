//! plan.md: one `### Task <n>: <title>` block per task.

use serde::Serialize;
use ts_rs::TS;

use super::{blocks, field, join, normalize, strip_comments, title};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct PlanDoc {
    pub title: Option<String>,
    pub tasks: Vec<PlanTask>,
}

/// `depends_on`: `None` when the plan does not say, `Some(vec![])` for `none`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct PlanTask {
    pub n: u32,
    pub title: String,
    pub does: Option<String>,
    pub depends_on: Option<Vec<u32>>,
    pub markdown: String,
}

/// Reads a plan.md: a task is a `### Task <n>: <title>` heading and everything up to the next `##` or `###` heading.
#[must_use]
pub fn parse_plan(text: &str) -> PlanDoc {
    let text = strip_comments(&normalize(text));
    let mut tasks = Vec::new();
    // A `## ` heading ends a task, so tasks are looked for inside each `##` section.
    for section in blocks(&text, "## ") {
        let section_text = section.lines.join("\n");
        for block in blocks(&section_text, "### ") {
            let Some((n, title)) = block.heading.and_then(task_heading) else {
                continue;
            };
            let lines = &block.lines;
            tasks.push(PlanTask {
                n,
                title,
                does: field(lines, "Does").filter(|d| !d.is_empty()),
                depends_on: field(lines, "Depends on").and_then(|d| depends(&d)),
                markdown: join(lines),
            });
        }
    }
    PlanDoc {
        title: title(&text),
        tasks,
    }
}

/// `Task 3: The title` to `(3, "The title")`.
fn task_heading(heading: &str) -> Option<(u32, String)> {
    let rest = heading.strip_prefix("Task ")?;
    let digits = rest.split(|c: char| !c.is_ascii_digit()).next()?;
    let n = digits.parse().ok()?;
    let title =
        rest[digits.len()..].trim_start_matches(|c: char| c.is_whitespace() || ":.–—-".contains(c));
    Some((n, title.trim().to_string()))
}

/// `none` is `Some(vec![])`; `Task 1, Task 2` and `Tasks 1 and 2` list numbers; anything else is not written.
fn depends(value: &str) -> Option<Vec<u32>> {
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
        match (listing, word.parse::<u32>()) {
            (true, Ok(n)) => out.push(n),
            _ => listing = false,
        }
    }
    (!out.is_empty()).then_some(out)
}
