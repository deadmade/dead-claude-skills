//! The document format: flow.md, plan.md, audit reports and the SDD build log, read into typed data.
//! Every parser takes any text and never panics; what it does not recognise stays in raw Markdown.

pub mod audit;
pub mod flow;
pub mod ledger;
pub mod plan;

pub use audit::{AuditDoc, Finding, parse_audit};
pub use flow::{Decision, Deviation, DeviationStatus, FlowDoc, Gate, Section, parse_flow};
pub use ledger::{Ledger, LedgerTask, TaskState, parse_ledger};
pub use plan::{PlanDoc, PlanTask, parse_plan};

/// Drops a byte-order mark and turns CRLF into LF.
pub(crate) fn normalize(text: &str) -> String {
    text.trim_start_matches('\u{feff}').replace("\r\n", "\n")
}

/// Removes `<!-- ... -->` (also across lines). An unterminated comment is kept as it is, so no text is lost.
pub(crate) fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        let Some(len) = rest[start + 4..].find("-->") else {
            break;
        };
        out.push_str(&rest[..start]);
        rest = &rest[start + 4 + len + 3..];
    }
    out.push_str(rest);
    out
}

/// A run of lines under one heading; `heading` is `None` for the lines before the first heading.
pub(crate) struct Block<'a> {
    pub heading: Option<&'a str>,
    pub lines: Vec<&'a str>,
}

fn is_fence(line: &str) -> bool {
    let line = line.trim_start();
    line.starts_with("```") || line.starts_with("~~~")
}

/// Splits `text` at lines starting with `prefix` (such as `"## "`), leaving fenced code alone.
pub(crate) fn blocks<'a>(text: &'a str, prefix: &str) -> Vec<Block<'a>> {
    let mut out = vec![Block {
        heading: None,
        lines: Vec::new(),
    }];
    let mut in_fence = false;
    for line in text.lines() {
        if is_fence(line) {
            in_fence = !in_fence;
        }
        match line.strip_prefix(prefix) {
            Some(heading) if !in_fence => out.push(Block {
                heading: Some(heading.trim()),
                lines: Vec::new(),
            }),
            _ => out.last_mut().expect("starts non-empty").lines.push(line),
        }
    }
    out
}

pub(crate) fn join(lines: &[&str]) -> String {
    lines.join("\n").trim().to_string()
}

/// The text of the first `# ` heading outside code fences.
pub(crate) fn title(text: &str) -> Option<String> {
    blocks(text, "# ")
        .into_iter()
        .find_map(|b| b.heading)
        .map(str::to_string)
        .filter(|t| !t.is_empty())
}

/// Every run of digits in `s` that fits a `u32`.
pub(crate) fn numbers(s: &str) -> Vec<u32> {
    s.split(|c: char| !c.is_ascii_digit())
        .filter_map(|run| run.parse().ok())
        .collect()
}

/// `YYYY-MM-DD` dates in `s` with their byte offsets.
pub(crate) fn dates(s: &str) -> Vec<(usize, &str)> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    for i in 0..b.len().saturating_sub(9) {
        let Some(w) = b.get(i..i + 10) else { break };
        let shaped = w.iter().enumerate().all(|(k, c)| {
            if k == 4 || k == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
        let alone = (i == 0 || !b[i - 1].is_ascii_digit())
            && b.get(i + 10).is_none_or(|c| !c.is_ascii_digit());
        if shaped && alone {
            out.push((i, &s[i..i + 10]));
        }
    }
    out
}

/// `line` without its list marker and surrounding bold marks.
pub(crate) fn plain(line: &str) -> &str {
    let line = line.trim();
    let line = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .unwrap_or(line);
    line.trim().trim_start_matches("**")
}

/// The value of a `Key: value` line (the key matched case-insensitively, `**Key:**` too), the lines wrapped under it
/// joined with a space; it ends at a blank line or the next bold or list line.
pub(crate) fn field(lines: &[&str], key: &str) -> Option<String> {
    field_span(lines, key).map(|(value, _)| value)
}

/// Like [`field`], with the range of lines it used.
pub(crate) fn field_span(lines: &[&str], key: &str) -> Option<(String, std::ops::Range<usize>)> {
    let pos = lines.iter().position(|l| key_value(l, key).is_some())?;
    let mut value = key_value(lines[pos], key)?.to_string();
    let mut end = pos + 1;
    for next in &lines[pos + 1..] {
        let t = next.trim();
        if t.is_empty() || t.starts_with("**") || t.starts_with("- ") || t.starts_with("* ") {
            break;
        }
        value.push(' ');
        value.push_str(t);
        end += 1;
    }
    Some((value.trim().to_string(), pos..end))
}

/// `lines` without the given range, as trimmed text.
pub(crate) fn without(lines: &[&str], span: &std::ops::Range<usize>) -> String {
    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| !span.contains(i))
        .map(|(_, l)| *l)
        .collect();
    join(&kept)
}

/// `value` of a single `Key: value` line.
pub(crate) fn key_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let t = plain(line);
    let head = t.get(..key.len())?;
    if !head.eq_ignore_ascii_case(key) {
        return None;
    }
    let rest = t[key.len()..].strip_prefix(':')?;
    Some(rest.trim().trim_start_matches("**").trim())
}
