//! flow.md: frontmatter, gates, decisions, deviations and the raw sections.

use serde::Serialize;
use ts_rs::TS;

use super::phases::{Phase, phases};
use super::{blocks, dates, field_span, join, normalize, strip_comments, title, without};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct FlowDoc {
    pub flow: Option<String>,
    pub phase: Option<String>,
    pub now: Option<String>,
    pub title: Option<String>,
    pub gates: Vec<Gate>,
    pub decisions: Vec<Decision>,
    pub deviations: Vec<Deviation>,
    /// The calls the build made on its own, one per `## Rulings` list item.
    pub rulings: Vec<Ruling>,
    /// The conductor's phases with their state at `phase:`; empty for a conductor or phase not known.
    pub phases: Vec<Phase>,
    /// Every `## ` section, in order, as raw Markdown (comments removed).
    pub sections: Vec<Section>,
}

/// `approved` is the date of the approval, `None` while the gate is open (or reopened and not approved again);
/// `raw` is the whole line, wrapped lines joined.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Gate {
    pub n: u8,
    pub what: String,
    pub approved: Option<String>,
    pub reopened: bool,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Decision {
    pub title: String,
    pub picked: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Deviation {
    pub title: String,
    pub status: DeviationStatus,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub enum DeviationStatus {
    Open,
    Decided {
        date: Option<String>,
        what: String,
    },
    /// An older shape without a `Status:` line.
    Unknown,
}

/// A call the build made on its own: `<date>, <scope>: <call> — <why> — costs <cost>` in flow.md, `<call> — <why> —
/// costs <cost>` in the build log. What does not split keeps `call` as the whole text and the parts `None`; `raw` is
/// the original text, wrapped lines joined.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Ruling {
    pub date: Option<String>,
    pub scope: Option<String>,
    pub call: String,
    pub why: Option<String>,
    pub cost: Option<String>,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Section {
    pub heading: String,
    pub markdown: String,
}

/// Reads a flow.md of any age: what does not parse stays in `sections`.
#[must_use]
pub fn parse_flow(text: &str) -> FlowDoc {
    let text = normalize(text);
    let (front, body) = frontmatter(&text);
    let body = strip_comments(body);
    let value = |key: &str| {
        front
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
    };

    let mut doc = FlowDoc {
        flow: value("flow"),
        phase: value("phase"),
        now: value("now"),
        title: title(&body),
        ..FlowDoc::default()
    };
    for block in blocks(&body, "## ") {
        let Some(heading) = block.heading else {
            continue;
        };
        let lower = heading.to_ascii_lowercase();
        if lower == "gates" {
            doc.gates.extend(gates(&block.lines));
        } else if lower == "options" {
            doc.decisions.extend(decisions(&block.lines));
        } else if lower.starts_with("deviations") {
            doc.deviations.extend(deviations(&block.lines));
        } else if lower == "rulings" {
            doc.rulings.extend(rulings(&block.lines));
        }
        doc.sections.push(Section {
            heading: heading.to_string(),
            markdown: join(&block.lines),
        });
    }
    doc.phases = phases(doc.flow.as_deref(), doc.phase.as_deref());
    doc
}

/// Flat `key: value` lines between the first two `---` lines; no YAML.
fn frontmatter(text: &str) -> (Vec<(String, String)>, &str) {
    let mut lines = text.split_inclusive('\n');
    let Some(first) = lines.next().filter(|l| l.trim() == "---") else {
        return (Vec::new(), text);
    };
    let mut offset = first.len();
    let mut pairs = Vec::new();
    for line in lines {
        offset += line.len();
        if line.trim() == "---" {
            return (pairs, &text[offset..]);
        }
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim();
            let unquoted = [('"', '"'), ('\'', '\'')]
                .iter()
                .find_map(|(open, close)| value.strip_prefix(*open)?.strip_suffix(*close))
                .unwrap_or(value);
            pairs.push((key.trim().to_ascii_lowercase(), unquoted.trim().to_string()));
        }
    }
    (Vec::new(), text)
}

fn gates(lines: &[&str]) -> Vec<Gate> {
    let mut raws: Vec<(u8, String)> = Vec::new();
    for line in lines {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Some(n) = gate_number(t) {
            raws.push((n, t.to_string()));
        } else if let Some((_, raw)) = raws.last_mut() {
            raw.push(' ');
            raw.push_str(t);
        }
    }
    raws.into_iter().map(|(n, raw)| gate(n, raw)).collect()
}

fn strip_marker(t: &str) -> &str {
    t.strip_prefix("- ")
        .or_else(|| t.strip_prefix("* "))
        .unwrap_or(t)
        .trim_start()
}

/// `n` of a `Gate <n>, ...` line.
fn gate_number(t: &str) -> Option<u8> {
    let rest = strip_marker(t).strip_prefix("Gate ")?;
    let digits = rest.split(|c: char| !c.is_ascii_digit()).next()?;
    rest[digits.len()..]
        .starts_with(',')
        .then(|| digits.parse().ok())?
}

fn gate(n: u8, raw: String) -> Gate {
    let line = strip_marker(&raw);
    let after_comma = line.split_once(',').map_or("", |(_, r)| r);
    let (what, rest) = after_comma.split_once(':').unwrap_or((after_comma, ""));
    let lower = rest.to_ascii_lowercase();
    let last_reopened = lower.rfind("reopened");
    let approved = match last_reopened {
        // Never reopened: the date the line starts with.
        None => dates(rest)
            .first()
            .filter(|(at, _)| rest[..*at].trim().is_empty())
            .map(|(_, d)| (*d).to_string()),
        // Reopened: only a date after the last "Reopened" counts, and not the reopening's own.
        Some(at) => dates(rest)
            .into_iter()
            .rev()
            .find(|(d, _)| *d > at && !lower[..*d].trim_end().ends_with("reopened"))
            .map(|(_, d)| d.to_string()),
    };
    Gate {
        n,
        what: what.trim().to_string(),
        approved,
        reopened: last_reopened.is_some(),
        raw,
    }
}

/// `### ` entries of a section: heading and the lines below it.
fn entries(text: &str) -> Vec<(&str, Vec<&str>)> {
    blocks(text, "### ")
        .into_iter()
        .filter_map(|b| Some((b.heading?, b.lines)))
        .collect()
}

fn decisions(lines: &[&str]) -> Vec<Decision> {
    let text = lines.join("\n");
    entries(&text)
        .into_iter()
        .map(|(heading, lines)| {
            let (picked, body) = match field_span(&lines, "Picked") {
                Some((value, span)) => (
                    Some(value).filter(|v| !v.is_empty()),
                    without(&lines, &span),
                ),
                None => (None, join(&lines)),
            };
            Decision {
                title: heading.to_string(),
                picked,
                body,
            }
        })
        .collect()
}

fn deviations(lines: &[&str]) -> Vec<Deviation> {
    let text = lines.join("\n");
    let headed = entries(&text);
    if headed.is_empty() {
        return list_items(lines);
    }
    headed
        .into_iter()
        .map(|(heading, lines)| {
            let (status, body) = match field_span(&lines, "Status") {
                Some((value, span)) => (status(&value), without(&lines, &span)),
                None => (DeviationStatus::Unknown, join(&lines)),
            };
            Deviation {
                title: heading.to_string(),
                status,
                body,
            }
        })
        .collect()
}

fn status(value: &str) -> DeviationStatus {
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("open") {
        return DeviationStatus::Open;
    }
    if !lower.starts_with("decided") {
        return DeviationStatus::Unknown;
    }
    let separators = |c: char| c.is_whitespace() || ":,;-–—".contains(c);
    let rest = value["decided".len()..].trim_start_matches(separators);
    match dates(rest).first() {
        Some((0, date)) => DeviationStatus::Decided {
            date: Some((*date).to_string()),
            what: rest[date.len()..]
                .trim_start_matches(separators)
                .trim()
                .to_string(),
        },
        _ => DeviationStatus::Decided {
            date: None,
            what: rest.trim().to_string(),
        },
    }
}

/// The list items of a Rulings section; prose around the list is not a ruling.
fn rulings(lines: &[&str]) -> Vec<Ruling> {
    let mut items: Vec<String> = Vec::new();
    for line in lines {
        if let Some(text) = item_marker(line) {
            items.push(text.to_string());
        } else if line.starts_with([' ', '\t'])
            && !line.trim().is_empty()
            && let Some(item) = items.last_mut()
        {
            item.push(' ');
            item.push_str(line.trim());
        }
    }
    items
        .iter()
        .filter(|text| !text.is_empty())
        .map(|text| ruling(text))
        .collect()
}

/// Splits one ruling's text (see [`Ruling`]); never fails.
pub(crate) fn ruling(text: &str) -> Ruling {
    let raw = text.trim();
    let head = dates(raw)
        .first()
        .filter(|(at, _)| *at == 0)
        .and_then(|(_, date)| {
            let (scope, rest) = raw[date.len()..].strip_prefix(',')?.split_once(':')?;
            let (scope, rest) = (scope.trim(), rest.trim());
            (!scope.is_empty() && !rest.is_empty())
                .then(|| ((*date).to_string(), scope.to_string(), rest))
        });
    let (date, scope, body) = match head {
        Some((date, scope, rest)) => (Some(date), Some(scope), rest),
        None => (None, None, raw),
    };
    let mut parts = body.split(" — ").map(str::trim);
    let call = parts.next().filter(|c| !c.is_empty()).unwrap_or(body);
    let why = parts.next().filter(|w| !w.is_empty()).map(str::to_string);
    let rest: Vec<&str> = parts.collect();
    let cost = (!rest.is_empty())
        .then(|| rest.join(" — "))
        .map(|c| {
            let lower = c.to_ascii_lowercase();
            if lower.starts_with("costs ") {
                c["costs ".len()..].trim().to_string()
            } else {
                c
            }
        })
        .filter(|c| !c.is_empty());
    Ruling {
        date,
        scope,
        call: call.to_string(),
        why,
        cost,
        raw: raw.to_string(),
    }
}

/// Older deviations: the top-level list items of the section, `1. **Title.** text` or `- **D1 – title.** text`,
/// whose status is unknown. "None ..." items are not deviations.
fn list_items(lines: &[&str]) -> Vec<Deviation> {
    let mut items: Vec<Vec<&str>> = Vec::new();
    for line in lines {
        if item_marker(line).is_some() {
            items.push(vec![line]);
        } else if let Some(item) = items.last_mut() {
            item.push(line);
        }
    }
    items
        .iter()
        .filter_map(|item| {
            let first = item_marker(item[0])?;
            let title =
                if let Some(bold) = first.strip_prefix("**").and_then(|r| r.split_once("**")) {
                    bold.0.trim().trim_end_matches(['.', ':', ' ']).to_string()
                } else {
                    first
                        .chars()
                        .take(100)
                        .collect::<String>()
                        .trim()
                        .to_string()
                };
            (!title.to_ascii_lowercase().starts_with("none")).then(|| Deviation {
                title,
                status: DeviationStatus::Unknown,
                body: join(item),
            })
        })
        .collect()
}

/// The text after a top-level list marker (`- `, `* `, `1. `, `1) `), `None` for any other line.
fn item_marker(line: &str) -> Option<&str> {
    if let Some(rest) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
        return Some(rest.trim());
    }
    let digits = line
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .filter(|d| !d.is_empty())?;
    let rest = line[digits.len()..]
        .strip_prefix('.')
        .or_else(|| line[digits.len()..].strip_prefix(')'))?;
    rest.strip_prefix(' ').map(str::trim)
}
