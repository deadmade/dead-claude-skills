//! What a project holds: flow runs and audits read from its folders, sessions read from the Claude transcripts, and the
//! list of entries the views get, with each flow run's status.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use jiff::Timestamp;
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use super::projects::subdirs;
use super::status::{Facts, Status, status};
use crate::activity::prompt_of;
use crate::doc::{
    self, DeviationStatus, FlowDoc, Gate, Ledger, PlanDoc, TaskState, parse_audit, parse_flow,
    parse_ledger, parse_plan,
};

/// Loose sessions older than this are left out.
const LOOSE_SECS: i64 = 7 * 24 * 3600;
/// A transcript's head is read for its cwd and first prompt: at most this many lines and bytes.
const HEAD_LINES: usize = 40;
const HEAD_BYTES: u64 = 8 * 1024 * 1024;
/// A head line longer than this is skipped.
const MAX_LINE: u64 = 1024 * 1024;
const PROMPT_CHARS: usize = 200;
const AUDIT_CONDUCTORS: [&str; 3] = ["test-audit", "doc-audit", "harden"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct FlowRunSummary {
    pub slug: String,
    pub conductor: String,
    pub phase: String,
    pub now: Option<String>,
    pub status: Status,
    pub gates: Vec<Gate>,
    pub open_deviations: u32,
    /// Tasks done and tasks in all, once a build log exists.
    pub progress: Option<(u32, u32)>,
    pub last_activity: String,
    /// How many checkouts and worktrees hold this run's flow.md; the newest one is shown.
    pub copies: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AuditSummary {
    pub file: String,
    pub date: String,
    pub conductor: String,
    pub scope: Option<String>,
    pub findings_by_severity: Vec<(String, u32)>,
    /// `None` when the report has no `Picks:` line.
    pub open: Option<bool>,
    /// How many findings the user picked; `None` when the report has no `Picks:` line.
    pub picks: Option<u32>,
    /// How many findings have a `Fixed` line.
    pub fixed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SessionSummary {
    pub id: String,
    pub started: String,
    pub last_activity: String,
    pub first_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind")]
pub enum Entry {
    FlowRun(FlowRunSummary),
    Audit(AuditSummary),
    Loose(SessionSummary),
}

/// A flow run with its documents, for the flow run view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct FlowRun {
    pub summary: FlowRunSummary,
    pub flow: FlowDoc,
    pub plan: Option<PlanDoc>,
    pub ledger: Option<Ledger>,
    /// The sessions that edited or wrote its flow.md, newest first.
    pub sessions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub enum DocName {
    Flow,
    Spec,
    Plan,
}

impl DocName {
    pub(crate) fn file(self) -> &'static str {
        match self {
            DocName::Flow => "flow.md",
            DocName::Spec => "spec.md",
            DocName::Plan => "plan.md",
        }
    }
}

/// A Claude session found on disk. Its transcript is read only for the head here; the rest on demand.
#[derive(Debug, Clone)]
pub(crate) struct Session {
    pub path: PathBuf,
    /// The `~/.claude/projects/<dir>` folder holding the transcript.
    pub dir: PathBuf,
    pub project: String,
    pub mtime: Timestamp,
    pub started: String,
    pub first_prompt: Option<String>,
}

/// What the head of a transcript says.
pub(crate) struct Head {
    pub cwd: PathBuf,
    pub started: Option<String>,
    pub first_prompt: Option<String>,
}

pub(crate) fn timestamp(t: SystemTime) -> Timestamp {
    Timestamp::try_from(t).unwrap_or(Timestamp::UNIX_EPOCH)
}

pub(crate) fn mtime(path: &Path) -> Option<Timestamp> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(timestamp)
}

/// Reads and drops the rest of the current line; returns how many bytes that was.
fn skip_line(reader: &mut BufReader<File>) -> u64 {
    let mut skipped = 0;
    loop {
        let Ok(buf) = reader.fill_buf() else {
            return skipped;
        };
        if buf.is_empty() {
            return skipped;
        }
        let (used, done) = buf
            .iter()
            .position(|&b| b == b'\n')
            .map_or((buf.len(), false), |i| (i + 1, true));
        reader.consume(used);
        skipped += used as u64;
        if done {
            return skipped;
        }
    }
}

/// The session's working directory (the first `cwd` in its first 40 lines), start time and first prompt. A line over
/// 1 MiB is skipped, and the read stops once it has a `cwd` and a user entry or has gone through 8 MiB.
pub(crate) fn read_head(path: &Path) -> Option<Head> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut main: Vec<Value> = Vec::new();
    let mut line = Vec::new();
    let (mut spent, mut has_cwd, mut has_prompt) = (0, false, false);
    for _ in 0..HEAD_LINES {
        line.clear();
        let n = (&mut reader)
            .take(MAX_LINE)
            .read_until(b'\n', &mut line)
            .ok()?;
        if n == 0 {
            break;
        }
        spent += n as u64;
        if !line.ends_with(b"\n") && n as u64 == MAX_LINE {
            // A line over the cap (a pasted image): skip the rest of it and go on with the next.
            spent += skip_line(&mut reader);
        } else if let Ok(entry) = serde_json::from_slice::<Value>(&line)
            && entry.is_object()
        {
            has_cwd |= entry.get("cwd").is_some();
            has_prompt |= entry.get("type").and_then(Value::as_str) == Some("user")
                && entry.get("isMeta").and_then(Value::as_bool) != Some(true);
            main.push(entry);
        }
        if (has_cwd && has_prompt) || spent >= HEAD_BYTES {
            break;
        }
    }
    let first = |key: &str| {
        main.iter()
            .find_map(|e| e.get(key)?.as_str().filter(|s| !s.is_empty()))
            .map(str::to_string)
    };
    let cwd = PathBuf::from(first("cwd")?);
    let started = first("timestamp");
    let first_prompt = main
        .iter()
        .find_map(prompt_of)
        .map(|p| p.text.chars().take(PROMPT_CHARS).collect());
    Some(Head {
        cwd,
        started,
        first_prompt,
    })
}

/// One flow run as found on disk: the newest flow.md of its slug and the documents next to it.
pub(crate) struct RunDoc {
    pub slug: String,
    /// `docs/features/<slug>` of the winning copy.
    pub dir: PathBuf,
    pub mtime: Timestamp,
    pub copies: u32,
    pub flow: FlowDoc,
    pub plan: Option<PlanDoc>,
    pub ledger: Option<Ledger>,
}

#[derive(Default)]
pub(crate) struct Docs {
    pub runs: Vec<RunDoc>,
    pub audits: Vec<AuditSummary>,
}

fn read_text(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Reads the flow runs and audits under `roots`. The same slug (or audit file) in several roots is one entry: the
/// copy written last.
pub(crate) fn load_docs(roots: &[PathBuf]) -> Docs {
    let mut flows: BTreeMap<String, Vec<(PathBuf, Timestamp)>> = BTreeMap::new();
    let mut audits: BTreeMap<String, Vec<(PathBuf, Timestamp)>> = BTreeMap::new();
    for root in roots {
        for dir in subdirs(&root.join("docs/features")) {
            if let (Some(slug), Some(at)) = (dir.file_name(), mtime(&dir.join("flow.md"))) {
                flows
                    .entry(slug.to_string_lossy().into_owned())
                    .or_default()
                    .push((dir, at));
            }
        }
        let Ok(read) = fs::read_dir(root.join("docs/audits")) else {
            continue;
        };
        for path in read.flatten().map(|e| e.path()) {
            let md = path.extension().is_some_and(|e| e == "md");
            if let (true, Some(name), Some(at)) = (md, path.file_name(), mtime(&path)) {
                audits
                    .entry(name.to_string_lossy().into_owned())
                    .or_default()
                    .push((path, at));
            }
        }
    }
    let runs = flows
        .into_iter()
        .filter_map(|(slug, copies)| {
            let (dir, at) = newest(&copies)?;
            let flow = parse_flow(&read_text(&dir.join("flow.md"))?);
            let plan = read_text(&dir.join("plan.md")).map(|t| parse_plan(&t));
            let ledger = ledger_of(&dir, &slug);
            Some(RunDoc {
                slug,
                dir,
                mtime: at,
                copies: u32::try_from(copies.len()).unwrap_or(u32::MAX),
                flow,
                plan,
                ledger,
            })
        })
        .collect();
    let audits = audits
        .into_iter()
        .filter_map(|(file, copies)| {
            let (path, _) = newest(&copies)?;
            Some(audit_summary(file, &read_text(&path)?))
        })
        .collect();
    Docs { runs, audits }
}

fn newest(copies: &[(PathBuf, Timestamp)]) -> Option<(PathBuf, Timestamp)> {
    copies.iter().max_by_key(|(_, at)| *at).cloned()
}

/// The SDD build log whose plan is `docs/features/<slug>/plan.md`, from the `.superpowers/sdd/*/progress.md` of the
/// checkout the run's folder sits in.
fn ledger_of(feature_dir: &Path, slug: &str) -> Option<Ledger> {
    let root = feature_dir.parent()?.parent()?.parent()?;
    let wanted = format!("docs/features/{slug}/");
    subdirs(&root.join(".superpowers/sdd"))
        .into_iter()
        .filter_map(|d| read_text(&d.join("progress.md")))
        .map(|t| parse_ledger(&t))
        .find(|l| {
            l.plan
                .as_ref()
                .is_some_and(|p| p.replace('\\', "/").contains(&wanted))
        })
}

/// `<YYYY-MM-DD>-<flow>-<scope>.md` to its date and conductor; a name of another shape keeps what it can.
fn audit_summary(file: String, text: &str) -> AuditSummary {
    let doc = parse_audit(text);
    let date = doc::dates(&file)
        .first()
        .filter(|(at, _)| *at == 0)
        .map(|(_, d)| (*d).to_string())
        .unwrap_or_default();
    let rest = file.get(date.len()..).unwrap_or("").trim_start_matches('-');
    let conductor = AUDIT_CONDUCTORS
        .iter()
        .find(|c| rest.starts_with(**c))
        .map_or_else(
            || rest.split(['-', '.']).next().unwrap_or("").to_string(),
            |c| (*c).to_string(),
        );
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let mut fixed = doc.fixed.clone();
    fixed.sort_unstable();
    fixed.dedup();
    let mut by_severity: Vec<(String, u32)> = Vec::new();
    for finding in &doc.findings {
        match by_severity.iter_mut().find(|(s, _)| *s == finding.severity) {
            Some((_, n)) => *n += 1,
            None => by_severity.push((finding.severity.clone(), 1)),
        }
    }
    AuditSummary {
        file,
        date,
        conductor,
        scope: doc.scope,
        findings_by_severity: by_severity,
        open: doc.open,
        picks: doc.picks.as_ref().map(|p| count(p.len())),
        fixed: count(fixed.len()),
    }
}

fn progress(run: &RunDoc) -> Option<(u32, u32)> {
    let ledger = run.ledger.as_ref()?;
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let done = ledger
        .tasks
        .iter()
        .filter(|t| t.state == TaskState::Done)
        .count();
    let planned = run.plan.as_ref().map_or(0, |p| p.tasks.len());
    Some((count(done), count(planned.max(ledger.tasks.len()))))
}

/// A project's entries, flow runs first (newest first), then audits (newest first), then loose sessions.
#[derive(Default)]
pub(crate) struct Derived {
    pub entries: Vec<Entry>,
    /// Slug to the sessions linked to that run, newest first.
    pub linked: HashMap<String, Vec<String>>,
}

/// Builds the entries from the documents on disk, the project's sessions and what the link scans found.
pub(crate) fn derive(
    docs: &Docs,
    sessions: &[(&str, &Session)],
    links: &HashMap<String, Vec<String>>,
    now: Timestamp,
) -> Derived {
    let mut runs: Vec<(Timestamp, FlowRunSummary)> = Vec::new();
    let mut linked = HashMap::new();
    let mut taken: HashSet<&str> = HashSet::new();
    for run in &docs.runs {
        let mut mine: Vec<(&str, &Session)> = sessions
            .iter()
            .filter(|(id, _)| links.get(*id).is_some_and(|l| l.contains(&run.slug)))
            .copied()
            .collect();
        mine.sort_by(|a, b| b.1.mtime.cmp(&a.1.mtime).then(a.0.cmp(b.0)));
        taken.extend(mine.iter().map(|(id, _)| *id));
        let grew = mine.first().map(|(_, s)| s.mtime);
        let last = grew.map_or(run.mtime, |g| g.max(run.mtime));
        let status = status(
            &Facts {
                phase: run.flow.phase.as_deref(),
                now_line: run.flow.now.as_deref(),
                last_activity: last,
                transcript: grew,
            },
            now,
        );
        let open = run
            .flow
            .deviations
            .iter()
            .filter(|d| d.status == DeviationStatus::Open)
            .count();
        runs.push((
            last,
            FlowRunSummary {
                slug: run.slug.clone(),
                conductor: run.flow.flow.clone().unwrap_or_default(),
                phase: run.flow.phase.clone().unwrap_or_default(),
                now: run.flow.now.clone(),
                status,
                gates: run.flow.gates.clone(),
                open_deviations: u32::try_from(open).unwrap_or(u32::MAX),
                progress: progress(run),
                last_activity: last.to_string(),
                copies: run.copies,
            },
        ));
        linked.insert(
            run.slug.clone(),
            mine.iter().map(|(id, _)| (*id).to_string()).collect(),
        );
    }
    runs.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.slug.cmp(&b.1.slug)));

    let mut audits: Vec<&AuditSummary> = docs.audits.iter().collect();
    audits.sort_by(|a, b| b.file.cmp(&a.file));

    let mut loose: Vec<(&str, &Session)> = sessions
        .iter()
        .filter(|(id, s)| {
            !taken.contains(id) && now.as_second() - s.mtime.as_second() <= LOOSE_SECS
        })
        .copied()
        .collect();
    loose.sort_by(|a, b| b.1.mtime.cmp(&a.1.mtime).then(a.0.cmp(b.0)));

    let entries = runs
        .into_iter()
        .map(|(_, r)| Entry::FlowRun(r))
        .chain(audits.into_iter().cloned().map(Entry::Audit))
        .chain(loose.into_iter().map(|(id, s)| {
            Entry::Loose(SessionSummary {
                id: id.to_string(),
                started: s.started.clone(),
                last_activity: s.mtime.to_string(),
                first_prompt: s.first_prompt.clone(),
            })
        }))
        .collect();
    Derived { entries, linked }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_first_line_does_not_hide_the_cwd() {
        let path =
            std::env::temp_dir().join(format!("flow-cockpit-head-{}.jsonl", std::process::id()));
        let image = "A".repeat(2 * 1024 * 1024);
        let text = format!(
            "{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":[{{\"type\":\"image\",\"data\":\"{image}\"}}]}}}}\n\
             {{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"Hello\"}},\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/x/y\"}}\n"
        );
        fs::write(&path, text).unwrap();
        let head = read_head(&path);
        fs::remove_file(&path).ok();
        let head = head.unwrap();
        assert_eq!(head.cwd, Path::new("/x/y"));
        assert_eq!(head.first_prompt.as_deref(), Some("Hello"));
    }
}
