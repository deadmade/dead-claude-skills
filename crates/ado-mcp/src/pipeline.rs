//! The pipeline read tools: `pipeline_runs`, `pipeline_view` and `pipeline_log`; and `repo_list`.

use std::fmt::Write as _;

use azure_devops_rust_api::build::models::{
    BuildQueryOrder, BuildResult, Issue, Timeline, TimelineRecord, timeline_record,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

use crate::api::ApiError;
use crate::ctx::{Ctx, given, seg};
use crate::out::{cut, more, ref_name};
use crate::pr::full_ref;

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct ProjectArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct RunsArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Pipeline name or id.
    pub pipeline: Option<String>,
    /// Only runs of this branch.
    pub branch: Option<String>,
    /// Only runs of this pull request (its merge ref); wins over branch.
    pub pr: Option<u32>,
    /// succeeded, partiallySucceeded, failed or canceled.
    pub result: Option<String>,
    /// How many to list. Default 20.
    pub limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct RunArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Run id, as `pipeline_runs` lists it.
    pub run: u32,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct LogArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Run id, as `pipeline_runs` lists it.
    pub run: u32,
    /// A step's name. Default: the failed steps.
    pub step: Option<String>,
    /// The whole log, 2000 lines per call, instead of the error lines and the last 50.
    pub full: Option<bool>,
    /// With full: the first line to show. Default 1.
    pub start: Option<u32>,
}

/// Lines of context around an error line, and the length of the tail.
const CONTEXT: usize = 5;
const TAIL: usize = 50;
/// Lines per `full` call.
const PAGE: u32 = 2000;
/// A log line is cut here: one minified file on a line would fill the reply.
const LINE_MAX: usize = 1000;
const ISSUES_MAX: usize = 20;

/// `4m 55s`; empty while it hasn't finished.
fn took(secs: Option<i64>) -> String {
    match secs {
        None => String::new(),
        Some(s) if s >= 3600 => format!("{}h {}m", s / 3600, s % 3600 / 60),
        Some(s) if s >= 60 => format!("{}m {}s", s / 60, s % 60),
        Some(s) => format!("{s}s"),
    }
}

fn run_id(run: u32) -> Result<i32, ApiError> {
    i32::try_from(run).map_err(|_| ApiError::local(format!("not found: run #{run}")))
}

/// The same call for the next page.
fn next_runs(a: &RunsArgs, limit: usize) -> String {
    let mut call = String::from("pipeline_runs");
    let pr = a.pr.map(|n| n.to_string());
    let args = [
        ("project", &a.project),
        ("pipeline", &a.pipeline),
        ("branch", &a.branch),
        ("pr", &pr),
        ("result", &a.result),
    ];
    for (k, v) in args {
        if let Some(v) = given(v.as_deref()) {
            if v.contains(' ') {
                let _ = write!(call, " {k}=\"{v}\"");
            } else {
                let _ = write!(call, " {k}={v}");
            }
        }
    }
    let _ = write!(call, " limit={}", limit * 2);
    call
}

/// # Errors
/// When the scope, the pipeline or the server fails.
pub(crate) async fn pipeline_runs(ctx: &Ctx, a: &RunsArgs) -> Result<String, ApiError> {
    let limit = a.limit.unwrap_or(20).max(1);
    let top = i32::try_from(limit.saturating_add(1)).unwrap_or(i32::MAX);
    let result = match given(a.result.as_deref())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        None => None,
        Some("succeeded") => Some(BuildResult::Succeeded),
        Some("partiallysucceeded") => Some(BuildResult::PartiallySucceeded),
        Some("failed") => Some(BuildResult::Failed),
        Some("canceled") => Some(BuildResult::Canceled),
        Some(_) => {
            return Err(ApiError::local(
                "result is succeeded, partiallySucceeded, failed or canceled",
            ));
        }
    };
    let branch =
        a.pr.map(|n| format!("refs/pull/{n}/merge"))
            .or_else(|| given(a.branch.as_deref()).map(full_ref));
    let p = a.project.as_deref();
    let first = ctx.scope(p, None, None).await?;
    let builds = ctx
        .retry_stale(&first.key, || async {
            let s = ctx.scope(p, None, None).await?;
            let def = match given(a.pipeline.as_deref()) {
                Some(n) => Some(ctx.pipeline_id(&s, n).await?.to_string()),
                None => None,
            };
            let (api, proj) = (&ctx.api, seg(&s.project_id));
            api.az(|| {
                let mut b = api
                    .build
                    .builds_client()
                    .list(&api.org, &proj)
                    .query_order(BuildQueryOrder::QueueTimeDescending)
                    .top(top);
                if let Some(d) = &def {
                    b = b.definitions(d);
                }
                if let Some(br) = &branch {
                    b = b.branch_name(br);
                }
                if let Some(r) = &result {
                    b = b.result_filter(r.clone());
                }
                b.into_future()
            })
            .await
        })
        .await?;
    let (builds, has_more) = cut(builds.value, limit);
    let mut lines: Vec<String> = builds
        .iter()
        .map(|b| {
            let state = b
                .result
                .as_ref()
                .map(ToString::to_string)
                .or_else(|| b.status.as_ref().map(ToString::to_string))
                .unwrap_or_default();
            let queued = b
                .queue_time
                .map_or_else(|| "?".into(), |t| t.date().to_string());
            let secs = b
                .start_time
                .zip(b.finish_time)
                .map(|(s, f)| (f - s).whole_seconds());
            let line = format!(
                "#{} {}  {}  {state}  {queued}  {}",
                b.id,
                b.definition.name.as_deref().unwrap_or_default(),
                ref_name(b.source_branch.as_deref().unwrap_or_default()),
                took(secs)
            );
            line.trim_end().to_owned()
        })
        .collect();
    if has_more {
        lines.push(more(&next_runs(a, limit)));
    }
    Ok(if lines.is_empty() {
        "no runs".into()
    } else {
        lines.join("\n")
    })
}

/// The run's timeline, and the project segment it was read from.
async fn timeline(
    ctx: &Ctx,
    project: Option<&str>,
    run: u32,
) -> Result<(String, Timeline), ApiError> {
    let id = run_id(run)?;
    let first = ctx.scope(project, None, None).await?;
    ctx.retry_stale(&first.key, || async {
        let proj = seg(&ctx.scope(project, None, None).await?.project_id);
        let api = &ctx.api;
        // No timeline id: the build's own timeline (`…/timeline/`).
        let t = api
            .az(|| {
                api.build
                    .timeline_client()
                    .get(&api.org, &proj, id, "")
                    .into_future()
            })
            .await?;
        Ok((proj, t))
    })
    .await
    .map_err(|e| e.with_what(&format!("run #{run}")))
}

fn kind(r: &TimelineRecord) -> &str {
    r.type_.as_deref().unwrap_or_default()
}

fn name(r: &TimelineRecord) -> &str {
    r.name.as_deref().unwrap_or("?")
}

/// The result, else the state (`inProgress`, `pending`).
fn state(r: &TimelineRecord) -> String {
    r.result
        .as_ref()
        .map(ToString::to_string)
        .or_else(|| r.state.as_ref().map(ToString::to_string))
        .unwrap_or_default()
}

fn failed(r: &TimelineRecord) -> bool {
    r.result == Some(timeline_record::Result::Failed)
}

/// `{type} {message}`, on one line.
fn issue(i: &Issue) -> String {
    let kind = i
        .type_
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();
    let msg: Vec<&str> = i
        .message
        .as_deref()
        .unwrap_or_default()
        .split_whitespace()
        .collect();
    format!("{kind} {}", msg.join(" "))
}

/// Stage and Job lines under `parent`, by `order`; a Phase's Jobs show at the Phase's own level.
fn tree(
    recs: &[TimelineRecord],
    parent: Option<&str>,
    depth: usize,
    hops: u8,
    out: &mut Vec<String>,
) {
    // The records come from the server: a parent loop must not recurse forever.
    if hops > 4 {
        return;
    }
    let mut children: Vec<&TimelineRecord> = recs
        .iter()
        .filter(|r| r.parent_id.as_deref() == parent)
        .collect();
    children.sort_by_key(|r| r.order);
    for r in children {
        match kind(r) {
            "Phase" => tree(recs, r.id.as_deref(), depth, hops + 1, out),
            "Stage" | "Job" => {
                let secs = r
                    .start_time
                    .zip(r.finish_time)
                    .map(|(s, f)| (f - s).whole_seconds());
                let line = format!(
                    "{}{}: {} {}",
                    "  ".repeat(depth),
                    name(r),
                    state(r),
                    took(secs)
                );
                out.push(line.trim_end().to_owned());
                tree(recs, r.id.as_deref(), depth + 1, hops + 1, out);
            }
            _ => {}
        }
    }
}

/// # Errors
/// When the scope, the run or the server fails.
pub(crate) async fn pipeline_view(ctx: &Ctx, a: &RunArgs) -> Result<String, ApiError> {
    let (_, t) = timeline(ctx, a.project.as_deref(), a.run).await?;
    let mut lines = Vec::new();
    tree(&t.records, None, 0, 0, &mut lines);
    if lines.is_empty() {
        lines.push(format!("run #{} has no stages or jobs yet", a.run));
    }
    let issues: Vec<String> = t
        .records
        .iter()
        .flat_map(|r| &r.issues)
        .map(issue)
        .collect();
    if !issues.is_empty() {
        lines.push("issues:".into());
        lines.extend(issues.iter().take(ISSUES_MAX).map(|i| format!("  {i}")));
        if issues.len() > ISSUES_MAX {
            lines.push(format!(
                "  … {} more issues: pipeline_log run={}",
                issues.len() - ISSUES_MAX,
                a.run
            ));
        }
    }
    Ok(lines.join("\n"))
}

/// Strips ANSI CSI sequences (and any other escape with the character after it) and `\r`.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {}
            '\x1b' => {
                // `ESC [`, parameter and intermediate bytes, then a final byte in `@`..=`~`.
                if chars.next() == Some('[') {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// The line without a leading `2026-03-05T10:00:20.1234567Z `.
fn strip_time(l: &str) -> &str {
    let (t, rest) = l.split_once(' ').unwrap_or((l, ""));
    let b = t.as_bytes();
    let stamp = b.len() >= 20
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[10] == b'T'
        && t.ends_with('Z');
    if stamp { rest } else { l }
}

/// A log as `(is_error, text)` lines: no timestamps, ANSI codes, `\r` or `##[group]`-style markers; errors and
/// warnings marked. One pass over the input.
pub(crate) fn clean_log(raw: &str) -> Vec<(bool, String)> {
    raw.lines()
        .filter_map(|l| {
            let l = strip_ansi(l);
            let l = strip_time(&l);
            if l.starts_with("##[endgroup]") {
                return None;
            }
            let l = ["##[group]", "##[section]", "##[command]"]
                .iter()
                .find_map(|p| l.strip_prefix(p))
                .unwrap_or(l);
            let (err, mut text) = if let Some(e) = l.strip_prefix("##[error]") {
                (true, format!("ERROR {e}"))
            } else if let Some(w) = l.strip_prefix("##[warning]") {
                (false, format!("WARNING {w}"))
            } else {
                (false, l.to_owned())
            };
            if let Some((at, _)) = text.char_indices().nth(LINE_MAX) {
                text.truncate(at);
                text.push('…');
            }
            Some((err, text))
        })
        .collect()
}

/// The error lines with their context (merged, `…` between the pieces), then the last 50 lines.
pub(crate) fn excerpt(lines: &[(bool, String)]) -> String {
    let tail = lines.len().saturating_sub(TAIL);
    let mut out: Vec<&str> = Vec::new();
    // The first line before the tail not printed yet.
    let mut next = 0;
    for (i, _) in lines[..tail].iter().enumerate().filter(|(_, (e, _))| *e) {
        let from = i.saturating_sub(CONTEXT).max(next);
        let to = (i + CONTEXT + 1).min(tail);
        if from >= to {
            continue;
        }
        if from > next && !out.is_empty() {
            out.push("…");
        }
        out.extend(lines[from..to].iter().map(|(_, l)| l.as_str()));
        next = to;
    }
    out.push("--- last 50 lines ---");
    out.extend(lines[tail..].iter().map(|(_, l)| l.as_str()));
    out.join("\n")
}

/// The steps whose logs to show: `step`'s, else the failed ones; and a note for each failed job with no failed step.
fn targets<'a>(
    recs: &'a [TimelineRecord],
    step: Option<&str>,
    run: u32,
) -> Result<(Vec<&'a TimelineRecord>, Vec<String>), ApiError> {
    let tasks = || recs.iter().filter(|r| kind(r) == "Task");
    if let Some(step) = step {
        let hits: Vec<_> = tasks()
            .filter(|r| name(r).eq_ignore_ascii_case(step))
            .collect();
        if hits.is_empty() {
            let names: Vec<&str> = tasks().map(name).collect();
            return Err(ApiError::local(format!(
                "no step \"{step}\" in run #{run}; its steps: {}",
                names.join(", ")
            )));
        }
        return Ok((hits, Vec::new()));
    }
    let hits: Vec<_> = tasks().filter(|r| failed(r)).collect();
    let mut notes = Vec::new();
    // A job can fail with no failed step (a timeout, a lost agent): its issues say why.
    for job in recs.iter().filter(|r| kind(r) == "Job" && failed(r)) {
        if !hits
            .iter()
            .any(|t| t.parent_id.is_some() && t.parent_id == job.id)
        {
            let mut s = format!("{}: failed with no failed step", name(job));
            for i in &job.issues {
                let _ = write!(s, "\n  {}", issue(i));
            }
            notes.push(s);
        }
    }
    Ok((hits, notes))
}

/// # Errors
/// When the scope, the run, the step or the server fails.
pub(crate) async fn pipeline_log(ctx: &Ctx, a: &LogArgs) -> Result<String, ApiError> {
    let run = a.run;
    let (proj, t) = timeline(ctx, a.project.as_deref(), run).await?;
    let id = run_id(run)?;
    let (targets, notes) = targets(&t.records, given(a.step.as_deref()), run)?;
    if targets.is_empty() && notes.is_empty() {
        return Ok(format!(
            "run #{run} has no failed step; pass step to read one"
        ));
    }
    let api = &ctx.api;
    let full = a.full == Some(true);
    let start = a.start.unwrap_or(1).max(1);
    let end = start.saturating_add(PAGE - 1);
    let counts = if full {
        let logs = api
            .az(|| {
                api.build
                    .builds_client()
                    .get_build_logs(&api.org, &proj, id)
                    .into_future()
            })
            .await?;
        logs.value
    } else {
        Vec::new()
    };
    let mut out = Vec::new();
    for r in targets {
        let Some(log) = &r.log else {
            out.push(format!("{}: no log ({})", name(r), state(r)));
            continue;
        };
        // The crate reads this answer as a JSON string; the log is plain text, so the raw body it is.
        let raw = api
            .az(|| {
                let mut b = api
                    .build
                    .builds_client()
                    .get_build_log(&api.org, &proj, id, log.id);
                if full {
                    b = b.start_line(i64::from(start)).end_line(i64::from(end));
                }
                b.send()
            })
            .await
            .map(|r| r.into_raw_response().into_body());
        let mut text = format!("{}: {}", name(r), state(r));
        match raw {
            Err(e) => {
                let _ = write!(text, "\nlog unavailable ({e})");
            }
            Ok(body) => {
                let lines = clean_log(&String::from_utf8_lossy(&body));
                if full {
                    for (_, l) in &lines {
                        let _ = write!(text, "\n{l}");
                    }
                    let total = counts
                        .iter()
                        .find(|c| c.build_log_reference.id == log.id)
                        .and_then(|c| c.line_count);
                    if total.is_some_and(|n| n > i64::from(end)) {
                        let call = format!(
                            "pipeline_log run={run} step=\"{}\" full=true start={}",
                            name(r),
                            u64::from(end) + 1
                        );
                        let _ = write!(text, "\n{}", more(&call));
                    }
                } else {
                    let _ = write!(text, "\n{}", excerpt(&lines));
                }
            }
        }
        out.push(text);
    }
    out.extend(notes);
    Ok(out.join("\n\n"))
}

/// # Errors
/// When the scope or the server fails.
pub(crate) async fn repo_list(ctx: &Ctx, a: &ProjectArgs) -> Result<String, ApiError> {
    let p = a.project.as_deref();
    let first = ctx.scope(p, None, None).await?;
    let mut repos = ctx
        .retry_stale(&first.key, || async {
            let proj = seg(&ctx.scope(p, None, None).await?.project_id);
            let api = &ctx.api;
            api.az(|| {
                api.git
                    .repositories_client()
                    .list(&api.org, &proj)
                    .into_future()
            })
            .await
        })
        .await?
        .value;
    repos.sort_by_key(|r| r.name.to_lowercase());
    let lines: Vec<String> = repos
        .iter()
        .map(|r| {
            let branch = r.default_branch.as_deref().map_or("none", ref_name);
            format!("{}  default: {branch}", r.name)
        })
        .collect();
    Ok(if lines.is_empty() {
        "no repos".into()
    } else {
        lines.join("\n")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_strips_noise() {
        let raw = "2026-03-05T10:00:20.1234567Z ##[group]Run cargo\r\n\
                   2026-03-05T10:00:21.0000000Z \x1b[1;31mred\x1b[0m done\r\n\
                   2026-03-05T10:00:22.0000000Z ##[endgroup]\r\n\
                   2026-03-05T10:00:23.0000000Z ##[error]boom\r\n\
                   ##[warning]careful\n\
                   ##[command]cargo test\n\
                   2026-03-05T10:00:24.0000000Z\n\
                   not 2026-03-05T10:00:20Z a stamp";
        let lines = clean_log(raw);
        let all: Vec<&str> = lines.iter().map(|(_, l)| l.as_str()).collect();
        assert_eq!(
            all,
            [
                "Run cargo",
                "red done",
                "ERROR boom",
                "WARNING careful",
                "cargo test",
                "",
                "not 2026-03-05T10:00:20Z a stamp"
            ]
        );
        let errors: Vec<bool> = lines.iter().map(|(e, _)| *e).collect();
        assert_eq!(errors, [false, false, true, false, false, false, false]);
        let joined = all.join("\n");
        for noise in ["\x1b", "\r", "##[group]", "2026-03-05T10:00:21"] {
            assert!(!joined.contains(noise), "{noise:?}");
        }
        let long = clean_log(&"é".repeat(LINE_MAX + 5));
        assert_eq!(long[0].1.chars().count(), LINE_MAX + 1);
    }

    #[test]
    fn excerpt_context_and_tail() {
        let mut lines: Vec<(bool, String)> = (0..200).map(|i| (false, format!("l{i}"))).collect();
        for i in [10, 14, 40, 148, 170] {
            lines[i].0 = true;
        }
        let range = |r: std::ops::Range<usize>| r.map(|i| format!("l{i}")).collect::<Vec<_>>();
        let mut want = range(5..20);
        want.push("…".into());
        want.extend(range(35..46));
        want.push("…".into());
        // The error at 148 shows up to the tail; the one at 170 is in the tail.
        want.extend(range(143..150));
        want.push("--- last 50 lines ---".into());
        want.extend(range(150..200));
        assert_eq!(excerpt(&lines), want.join("\n"));
        let short = vec![(true, "ERROR x".to_owned())];
        assert_eq!(excerpt(&short), "--- last 50 lines ---\nERROR x");
    }

    #[test]
    fn durations() {
        assert_eq!(took(None), "");
        assert_eq!(took(Some(9)), "9s");
        assert_eq!(took(Some(295)), "4m 55s");
        assert_eq!(took(Some(3610)), "1h 0m");
    }
}
