//! Audit reports: scope line, findings table, `Picks:` and `Fixed` lines.

use serde::Serialize;
use ts_rs::TS;

use super::{dates, key_value, normalize, numbers, plain, strip_comments};

/// `picks` and `open` are `None` for a report without a `Picks:` line (its state is unknown).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct AuditDoc {
    pub scope: Option<String>,
    pub findings: Vec<Finding>,
    pub picks: Option<Vec<u32>>,
    pub fixed: Vec<u32>,
    pub open: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Finding {
    pub n: u32,
    pub severity: String,
    pub location: String,
    pub text: String,
}

/// Reads an audit report. A report without a `Picks:` line has unknown state (`picks` and `open` are `None`).
#[must_use]
pub fn parse_audit(text: &str) -> AuditDoc {
    let text = strip_comments(&normalize(text));
    let lines: Vec<&str> = text.lines().collect();
    let picks = lines
        .iter()
        .find_map(|l| key_value(l, "Picks"))
        .and_then(picks);
    let fixed: Vec<u32> = lines
        .iter()
        .filter_map(|l| fixed_line(l))
        .flatten()
        .collect();
    let open = picks.as_ref().map(|p| p.iter().any(|n| !fixed.contains(n)));
    AuditDoc {
        scope: scope(&lines),
        findings: lines.iter().filter_map(|l| finding(l)).collect(),
        picks,
        fixed,
        open,
    }
}

/// The numbers of a `Fixed <date>: <numbers>` line.
fn fixed_line(line: &str) -> Option<Vec<u32>> {
    let t = plain(line);
    if !t.get(..5)?.eq_ignore_ascii_case("fixed") {
        return None;
    }
    let (before, after) = t[5..].split_once(':')?;
    (!dates(before).is_empty()).then(|| numbers(after))
}

/// `none` is no picks; numbers are the picks; an empty or unreadable value is not a pick list at all.
fn picks(value: &str) -> Option<Vec<u32>> {
    let picked = numbers(value);
    if !picked.is_empty() {
        Some(picked)
    } else if value.to_ascii_lowercase().contains("none") {
        Some(Vec::new())
    } else {
        None
    }
}

/// A `Scope:` line, else the first plain line under the title.
fn scope(lines: &[&str]) -> Option<String> {
    if let Some(value) = lines.iter().find_map(|l| key_value(l, "Scope")) {
        return Some(value.to_string()).filter(|v| !v.is_empty());
    }
    let skipped = |l: &&str| {
        let t = l.trim();
        t.is_empty()
            || ["#", "|", ">", "-", "*"].iter().any(|p| t.starts_with(p))
            || key_value(t, "Picks").is_some()
            || fixed_line(t).is_some()
    };
    lines
        .iter()
        .find(|l| !skipped(l))
        .map(|l| l.trim().to_string())
}

/// A table row `| n | severity | where | finding | ... |`; the header and separator rows have no number.
fn finding(line: &str) -> Option<Finding> {
    let t = line.trim();
    if !t.starts_with('|') {
        return None;
    }
    let cells = cells(t);
    let [n, severity, location, text, ..] = cells.as_slice() else {
        return None;
    };
    Some(Finding {
        n: n.parse().ok()?,
        severity: severity.clone(),
        location: location.trim_matches('`').to_string(),
        text: text.clone(),
    })
}

/// The trimmed cells of a table row; `\|` is a literal bar.
fn cells(row: &str) -> Vec<String> {
    let mut cells = vec![String::new()];
    let mut chars = row.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                chars.next();
                cells.last_mut().expect("never empty").push('|');
            }
            '|' => cells.push(String::new()),
            c => cells.last_mut().expect("never empty").push(c),
        }
    }
    // The text before the first bar is not a cell, nor is the text after the last bar when it is empty.
    cells.remove(0);
    if cells.last().is_some_and(|c| c.trim().is_empty()) {
        cells.pop();
    }
    cells.iter().map(|c| c.trim().to_string()).collect()
}
