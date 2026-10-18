//! When Claude Code was working, from its session logs (`projects/**/*.jsonl` under `CLAUDE_CONFIG_DIR` or `~/.claude`).
//! Claude works from your prompt to its last reply: the stretch before each reply or tool result counts, the stretch
//! before your next prompt doesn't. The format is Claude Code's own and undocumented, so lines that don't fit are
//! skipped.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use jiff::Timestamp;
use serde::Deserialize;
use serde::de::IgnoredAny;

use crate::log::Log;

/// A stretch longer than this between two log lines is someone away, not Claude working.
const CAP: i64 = 15 * 60;

/// Claude working from `start` to `end`, on `branch`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub start: Timestamp,
    pub end: Timestamp,
    pub branch: Option<String>,
}

#[derive(Deserialize)]
struct Rec {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<Timestamp>,
    #[serde(rename = "gitBranch")]
    branch: Option<String>,
    #[serde(rename = "toolUseResult")]
    tool_result: Option<IgnoredAny>,
}

/// The working stretches in one session log that end at or after `since`.
pub fn parse(text: &str, since: Timestamp) -> Vec<Segment> {
    let mut out = Vec::new();
    let mut prev: Option<Timestamp> = None;
    for line in text.lines() {
        // Most of a log's bytes are in lines without a timestamp worth parsing.
        if !line.contains("\"timestamp\"") {
            continue;
        }
        let Ok(r) = serde_json::from_str::<Rec>(line) else {
            continue;
        };
        let (Some(kind), Some(ts)) = (r.kind.as_deref(), r.timestamp) else {
            continue;
        };
        let working = match kind {
            "assistant" => true,
            "user" => r.tool_result.is_some(),
            _ => continue,
        };
        if working
            && let Some(p) = prev
            && p < ts
            && ts >= since
            && ts.as_second() - p.as_second() <= CAP
        {
            out.push(Segment {
                start: p.max(since),
                end: ts,
                branch: r.branch.filter(|b| !b.is_empty()),
            });
        }
        prev = Some(ts);
    }
    out
}

/// Where Claude Code keeps its session logs.
pub fn root() -> Option<PathBuf> {
    let var = |k| std::env::var_os(k).filter(|v| !v.is_empty());
    var("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            var("USERPROFILE")
                .or_else(|| var("HOME"))
                .map(|h| PathBuf::from(h).join(".claude"))
        })
        .map(|d| d.join("projects"))
}

/// Parsed logs by path, with the modification time and length they were parsed at.
pub type Cache = HashMap<PathBuf, (SystemTime, u64, Vec<Segment>)>;

/// Every working stretch since `since` in the logs under `dir`; logs unchanged since the last call come from `cache`.
// shortcut: only logs modified since `since` are read, so weeks before it show no Claude time; widen `since` if needed.
pub fn scan(dir: &Path, since: Timestamp, cache: &mut Cache) -> Vec<Segment> {
    let mut files = Vec::new();
    walk(dir, &mut files);
    let mut out = Vec::new();
    for path in files {
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if Timestamp::try_from(modified).is_ok_and(|m| m < since) {
            continue;
        }
        let fresh = cache
            .get(&path)
            .is_some_and(|(m, len, _)| *m == modified && *len == meta.len());
        if !fresh {
            let segs = fs::read_to_string(&path).map_or_else(|_| Vec::new(), |t| parse(&t, since));
            cache.insert(path.clone(), (modified, meta.len(), segs));
        }
        out.extend(cache[&path].2.iter().cloned());
    }
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

/// The ticket a branch points at: the first number in its name that is one of `known`.
pub fn ticket_of(branch: &str, known: &[i32]) -> Option<i32> {
    branch
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse().ok())
        .find(|id| known.contains(id))
}

/// Seconds covered by `spans`, overlaps counted once.
fn union(mut spans: Vec<(i64, i64)>) -> i64 {
    spans.sort_unstable();
    let mut total = 0;
    let mut end = i64::MIN;
    for (a, b) in spans {
        let a = a.max(end);
        if b > a {
            total += b - a;
            end = b;
        }
    }
    total
}

fn clip(s: &Segment, from: Timestamp, to: Timestamp) -> Option<(i64, i64)> {
    let (a, b) = (s.start.max(from).as_second(), s.end.min(to).as_second());
    (a < b).then_some((a, b))
}

/// Seconds Claude worked within `[from, to)`; sessions running side by side count once.
pub fn busy(segs: &[Segment], from: Timestamp, to: Timestamp) -> i64 {
    union(segs.iter().filter_map(|s| clip(s, from, to)).collect())
}

/// Seconds Claude worked within `[from, to)` per ticket, most first: the ticket the branch names, else the one timed
/// then; `None` when neither says.
pub fn per_ticket(
    segs: &[Segment],
    log: &Log,
    known: &[i32],
    from: Timestamp,
    to: Timestamp,
    now: Timestamp,
) -> Vec<(Option<i32>, i64)> {
    let mut by: HashMap<Option<i32>, Vec<(i64, i64)>> = HashMap::new();
    for s in segs {
        let Some(span) = clip(s, from, to) else {
            continue;
        };
        let ticket = s
            .branch
            .as_deref()
            .and_then(|b| ticket_of(b, known))
            .or_else(|| {
                let mid = Timestamp::from_second(i64::midpoint(span.0, span.1)).ok()?;
                log.all()
                    .find(|e| e.start <= mid && mid < e.end.unwrap_or(now))
                    .map(|e| e.ticket.id)
            });
        by.entry(ticket).or_default().push(span);
    }
    let mut out: Vec<(Option<i32>, i64)> = by.into_iter().map(|(t, v)| (t, union(v))).collect();
    out.sort_by_key(|(t, s)| (-s, *t));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::Entry;
    use ado_mcp::Ticket;

    fn ts(s: &str) -> Timestamp {
        s.parse().unwrap()
    }

    #[test]
    fn only_claudes_stretches_count() {
        let log = r#"{"type":"user","timestamp":"2026-10-19T09:00:00Z","gitBranch":"feature/4711-proxy","message":{"content":"go"}}
{"type":"assistant","timestamp":"2026-10-19T09:00:30Z","gitBranch":"feature/4711-proxy"}
{"type":"user","timestamp":"2026-10-19T09:02:00Z","gitBranch":"feature/4711-proxy","toolUseResult":{"ok":true}}
{"type":"assistant","timestamp":"2026-10-19T09:03:00Z","gitBranch":"feature/4711-proxy"}
not json at all, "timestamp"
{"type":"user","timestamp":"2026-10-19T09:10:00Z","gitBranch":"","message":{"content":"next"}}
{"type":"assistant","timestamp":"2026-10-19T09:10:20Z","gitBranch":""}
{"type":"assistant","timestamp":"2026-10-19T10:00:00Z","gitBranch":""}"#;
        let segs = parse(log, ts("2026-10-19T00:00:00Z"));
        let spans: Vec<(i64, Option<&str>)> = segs
            .iter()
            .map(|s| (s.end.as_second() - s.start.as_second(), s.branch.as_deref()))
            .collect();
        // Your 7 minutes before "next" and the 50-minute silence don't count.
        assert_eq!(
            spans,
            [
                (30, Some("feature/4711-proxy")),
                (90, Some("feature/4711-proxy")),
                (60, Some("feature/4711-proxy")),
                (20, None)
            ]
        );
        assert!(parse(log, ts("2026-10-20T00:00:00Z")).is_empty());
    }

    #[test]
    fn branch_first_then_the_running_ticket() {
        assert_eq!(ticket_of("feature/4711-proxy", &[815, 4711]), Some(4711));
        assert_eq!(ticket_of("release/2026", &[815, 4711]), None);
        let seg = |a: &str, b: &str, branch: Option<&str>| Segment {
            start: ts(a),
            end: ts(b),
            branch: branch.map(String::from),
        };
        let segs = [
            seg(
                "2026-10-19T09:00:00Z",
                "2026-10-19T09:30:00Z",
                Some("feature/4711-x"),
            ),
            // A second session on the same ticket at the same time counts once.
            seg("2026-10-19T09:10:00Z", "2026-10-19T09:20:00Z", Some("4711")),
            seg("2026-10-19T10:00:00Z", "2026-10-19T10:15:00Z", Some("main")),
            seg("2026-10-19T12:00:00Z", "2026-10-19T12:05:00Z", None),
        ];
        let dir = std::env::temp_dir().join(format!("timetrack-claude-{}", std::process::id()));
        let mut log = Log::open(dir.clone()).unwrap();
        log.entries.push(Entry {
            ticket: Ticket {
                id: 815,
                project: "P".into(),
                kind: "Task".into(),
                state: "New".into(),
                title: "t".into(),
            },
            start: ts("2026-10-19T09:45:00Z"),
            end: Some(ts("2026-10-19T11:00:00Z")),
        });
        let got = per_ticket(
            &segs,
            &log,
            &[815, 4711],
            ts("2026-10-19T00:00:00Z"),
            ts("2026-10-20T00:00:00Z"),
            ts("2026-10-19T13:00:00Z"),
        );
        assert_eq!(got, [(Some(4711), 1800), (Some(815), 900), (None, 300)]);
        assert_eq!(
            busy(
                &segs,
                ts("2026-10-19T09:15:00Z"),
                ts("2026-10-19T10:05:00Z")
            ),
            15 * 60 + 5 * 60
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
