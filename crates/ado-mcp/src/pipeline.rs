//! The pipeline read tools: `pipeline_runs`, `pipeline_view` and `pipeline_log`; and `repo_list`.

use std::collections::HashMap;
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
/// Step names an error lists.
const NAMES_MAX: usize = 20;
/// Lines of error context an excerpt shows before it points at the full log.
const EXCERPT_MAX: usize = 300;
/// Characters per `full` page (Ruling R8): 2000 long lines would fill the reply.
const PAGE_CHARS: usize = 40_000;

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

/// `{type} {message}`, on one line, without terminal control sequences.
fn issue(i: &Issue) -> String {
    let kind = i
        .type_
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_default();
    let msg = strip_ansi(i.message.as_deref().unwrap_or_default());
    let words: Vec<&str> = msg.split_whitespace().collect();
    format!("{kind} {}", words.join(" "))
}

/// The first 20 issues as indented lines, then how many were left out.
fn issue_lines(issues: &[String], rest: &str) -> Vec<String> {
    let mut lines: Vec<String> = issues
        .iter()
        .take(ISSUES_MAX)
        .map(|i| format!("  {i}"))
        .collect();
    if issues.len() > ISSUES_MAX {
        lines.push(format!(
            "  … {} more issues{rest}",
            issues.len() - ISSUES_MAX
        ));
    }
    lines
}

/// `a, b, c`, the first 20, then `… and N more`.
fn name_list(names: &[&str]) -> String {
    let mut s = names
        .iter()
        .take(NAMES_MAX)
        .copied()
        .collect::<Vec<_>>()
        .join(", ");
    if names.len() > NAMES_MAX {
        let _ = write!(s, " … and {} more", names.len() - NAMES_MAX);
    }
    s
}

type Children<'a> = HashMap<Option<&'a str>, Vec<&'a TimelineRecord>>;

/// Stage and Job lines under `parent`, by `order`; a Phase's Jobs show at the Phase's own level.
fn tree(kids: &Children, parent: Option<&str>, depth: usize, hops: u8, out: &mut Vec<String>) {
    // The records come from the server: a parent loop (duplicate ids) must not recurse forever.
    if hops > 4 {
        return;
    }
    for r in kids.get(&parent).into_iter().flatten() {
        let k = kind(r);
        if matches!(k, "Stage" | "Job") {
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
        }
        // A Job's children are Tasks, which aren't shown; a record without an id has none.
        let Some(id) = r.id.as_deref() else { continue };
        match k {
            "Phase" => tree(kids, Some(id), depth, hops + 1, out),
            "Stage" => tree(kids, Some(id), depth + 1, hops + 1, out),
            _ => {}
        }
    }
}

/// # Errors
/// When the scope, the run or the server fails.
pub(crate) async fn pipeline_view(ctx: &Ctx, a: &RunArgs) -> Result<String, ApiError> {
    let (_, t) = timeline(ctx, a.project.as_deref(), a.run).await?;
    let mut kids: Children = HashMap::new();
    for r in &t.records {
        kids.entry(r.parent_id.as_deref()).or_default().push(r);
    }
    for v in kids.values_mut() {
        v.sort_by_key(|r| r.order);
    }
    let mut lines = Vec::new();
    tree(&kids, None, 0, 0, &mut lines);
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
        lines.extend(issue_lines(
            &issues,
            &format!(": pipeline_log run={}", a.run),
        ));
    }
    Ok(lines.join("\n"))
}

/// Skips the rest of an OSC string: up to BEL, ST or `ESC \`.
fn skip_osc(chars: &mut std::str::Chars) {
    while let Some(c) = chars.next() {
        match c {
            '\x07' | '\u{9c}' => return,
            '\x1b' => {
                chars.next();
                return;
            }
            _ => {}
        }
    }
}

/// Skips the rest of a CSI sequence: parameter and intermediate bytes, then a final byte in `@`..=`~`.
fn skip_csi(chars: &mut std::str::Chars) {
    for c in chars.by_ref() {
        if ('@'..='~').contains(&c) {
            return;
        }
    }
}

/// The text without terminal control: CSI and OSC sequences (7- and 8-bit), any other escape with the character
/// after it, and every other control character but `\t` (`\n` becomes a space).
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.next() {
                Some('[') => skip_csi(&mut chars),
                // An OSC 8 hyperlink would leak its URL.
                Some(']') => skip_osc(&mut chars),
                _ => {}
            },
            '\u{9b}' => skip_csi(&mut chars),
            '\u{9d}' => skip_osc(&mut chars),
            '\t' => out.push(c),
            // Only issue messages hold line breaks; log lines are split already.
            '\n' => out.push(' '),
            c if c.is_control() => {}
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

/// A log as `(is_error, text)` lines, one per line of `raw` (so a page's line numbers hold): no timestamps, terminal
/// control or `##[group]`-style markers; errors and warnings marked. One pass over the input.
pub(crate) fn clean_log(raw: &str) -> Vec<(bool, String)> {
    // shortcut: a lone `\r` (CR-only progress output) is dropped, not split into lines; split on it if such logs
    // read as run-together lines.
    raw.lines()
        .map(|l| {
            let l = strip_ansi(l);
            let l = strip_time(&l);
            let l = ["##[group]", "##[endgroup]", "##[section]", "##[command]"]
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
            (err, text)
        })
        .collect()
}

/// The error lines with their context (merged, `…` between the pieces, at most 300 lines, then how many error lines
/// were left out and `rest`, the call that shows them), then the last 50 lines.
pub(crate) fn excerpt(lines: &[(bool, String)], rest: &str) -> String {
    let tail = lines.len().saturating_sub(TAIL);
    let mut out: Vec<&str> = Vec::new();
    // The first line before the tail not printed yet.
    let mut next = 0;
    let mut shown = 0;
    for (i, _) in lines[..tail].iter().enumerate().filter(|(_, (e, _))| *e) {
        let from = i.saturating_sub(CONTEXT).max(next);
        let to = (i + CONTEXT + 1).min(tail);
        if from >= to {
            continue;
        }
        if shown + (to - from) > EXCERPT_MAX {
            break;
        }
        if from > next && !out.is_empty() {
            out.push("…");
        }
        out.extend(lines[from..to].iter().map(|(_, l)| l.as_str()));
        shown += to - from;
        next = to;
    }
    let left = lines[next..tail].iter().filter(|(e, _)| *e).count();
    let note = more(&format!("{left} more error lines: {rest}"));
    if left > 0 {
        out.push(&note);
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
                name_list(&names)
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
            let issues: Vec<String> = job.issues.iter().map(issue).collect();
            let mut lines = vec![format!("{}: failed with no failed step", name(job))];
            lines.extend(issue_lines(&issues, &format!(": pipeline_view run={run}")));
            notes.push(lines.join("\n"));
        }
    }
    Ok((hits, notes))
}

/// The `pipeline_log` call for `step` from line `start` on.
fn page_call(run: u32, step: &str, start: u64) -> String {
    format!("pipeline_log run={run} step=\"{step}\" full=true start={start}")
}

/// One `full` page from line `start`: at most 2000 lines and 40,000 characters (the server may ignore the range
/// it was asked for), then the call for the next page when the log goes on.
fn page(
    lines: &[(bool, String)],
    start: u32,
    total: Result<Option<i64>, &ApiError>,
    next: impl Fn(u64) -> String,
) -> String {
    let mut out = Vec::new();
    let mut chars = 0;
    for (_, l) in lines.iter().take(PAGE as usize) {
        let n = l.chars().count() + 1;
        if !out.is_empty() && chars + n > PAGE_CHARS {
            break;
        }
        chars += n;
        out.push(l.as_str());
    }
    let after = u64::from(start) + out.len() as u64;
    let cut_here = out.len() < lines.len();
    let note = match total {
        _ if cut_here => Some(more(&next(after))),
        Ok(Some(n)) if u64::try_from(n).unwrap_or(0) >= after => Some(more(&next(after))),
        Ok(_) => None,
        Err(e) => Some(format!(
            "… line count unavailable ({e}); if the log goes on: {}",
            next(after)
        )),
    };
    out.extend(note.as_deref());
    out.join("\n")
}

/// # Errors
/// When the scope, the run, the step or the server fails.
pub(crate) async fn pipeline_log(ctx: &Ctx, a: &LogArgs) -> Result<String, ApiError> {
    let run = a.run;
    let (proj, t) = timeline(ctx, a.project.as_deref(), run).await?;
    let id = run_id(run)?;
    let (mut targets, notes) = targets(&t.records, given(a.step.as_deref()), run)?;
    if targets.is_empty() && notes.is_empty() {
        return Ok(format!(
            "run #{run} has no failed step; pass step to read one"
        ));
    }
    let api = &ctx.api;
    let full = a.full == Some(true);
    let start = a.start.unwrap_or(1).max(1);
    let end = start.saturating_add(PAGE - 1);
    let mut out = Vec::new();
    // A full page is one step's: the others are named so the agent can pass their step.
    if full && targets.len() > 1 {
        let others: Vec<&str> = targets[1..].iter().map(|r| name(r)).collect();
        out.push(format!(
            "showing {} only; also failed: {}; pass step to page through one",
            name(targets[0]),
            name_list(&others)
        ));
        targets.truncate(1);
    }
    let counts = if full {
        api.az(|| {
            api.build
                .builds_client()
                .get_build_logs(&api.org, &proj, id)
                .into_future()
        })
        .await
        .map(|l| l.value)
    } else {
        Ok(Vec::new())
    };
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
        let lines = match raw {
            Err(e) => {
                let _ = write!(text, "\nlog unavailable ({e})");
                out.push(text);
                continue;
            }
            Ok(body) => clean_log(&String::from_utf8_lossy(&body)),
        };
        let step = name(r);
        let body = if full {
            let total = counts.as_ref().map(|c| {
                c.iter()
                    .find(|c| c.build_log_reference.id == log.id)
                    .and_then(|c| c.line_count)
            });
            page(&lines, start, total, |n| page_call(run, step, n))
        } else {
            excerpt(&lines, &page_call(run, step, 1))
        };
        let _ = write!(text, "\n{body}");
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
                   not 2026-03-05T10:00:20Z a stamp\n\
                   \x1b]8;;https://x.example/\x07link\x1b]8;;\x07 here\n\
                   \x1b]0;my title\x1b\\after\n\
                   \u{9b}31mc1\u{9b}0m\n\
                   bell\x07 nul\0 tab\tok\n\
                   open \x1b]8;;https://y.example/ never closed\n\
                   trailing esc\x1b";
        let lines = clean_log(raw);
        let all: Vec<&str> = lines.iter().map(|(_, l)| l.as_str()).collect();
        assert_eq!(
            all,
            [
                "Run cargo",
                "red done",
                "",
                "ERROR boom",
                "WARNING careful",
                "cargo test",
                "",
                "not 2026-03-05T10:00:20Z a stamp",
                "link here",
                "after",
                "c1",
                "bell nul tab\tok",
                "open ",
                "trailing esc",
            ]
        );
        let errors: Vec<usize> = (0..lines.len()).filter(|i| lines[*i].0).collect();
        assert_eq!(errors, [3]);
        let joined = all.join("\n");
        for noise in [
            "\x1b",
            "\r",
            "\x07",
            "\0",
            "\u{9b}",
            "##[",
            "https",
            "title",
            "2026-03-05T10:00:21",
        ] {
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
        assert_eq!(excerpt(&lines, "x"), want.join("\n"));
        let short = vec![(true, "ERROR x".to_owned())];
        assert_eq!(excerpt(&short, "x"), "--- last 50 lines ---\nERROR x");
    }

    #[test]
    fn excerpt_caps_errors() {
        let lines: Vec<(bool, String)> = (0..5000).map(|i| (true, format!("ERROR {i}"))).collect();
        let out = excerpt(&lines, "pipeline_log run=7 step=\"T\" full=true start=1");
        let out: Vec<&str> = out.lines().collect();
        assert_eq!(out.len(), EXCERPT_MAX + 2 + TAIL, "{out:?}");
        assert_eq!(out[EXCERPT_MAX - 1], "ERROR 299");
        assert_eq!(
            out[EXCERPT_MAX],
            "… more: 4650 more error lines: pipeline_log run=7 step=\"T\" full=true start=1"
        );
        assert_eq!(out[EXCERPT_MAX + 1], "--- last 50 lines ---");
    }

    fn plain(n: usize, width: usize) -> Vec<(bool, String)> {
        (0..n).map(|i| (false, format!("{i:0width$}"))).collect()
    }

    #[test]
    fn page_cuts_at_lines_or_chars() {
        let next = |n| format!("next {n}");
        // The server ignored the range and sent 2500 short lines: 2000 shown.
        let out = page(&plain(2500, 4), 1, Ok(None), next);
        assert_eq!(out.lines().count(), PAGE as usize + 1);
        assert!(out.ends_with("\n… more: next 2001"), "{out}");
        // Ruling R8: 100-character lines stop at 40,000 characters (396 lines of 101 with the newline).
        let out = page(&plain(2000, 100), 501, Ok(Some(2500)), next);
        assert_eq!(out.lines().count(), 397);
        assert!(out.ends_with("\n… more: next 897"), "{out}");
        assert!(out.chars().count() < PAGE_CHARS + 100);
        // All shown: more only when the line count says the log goes on.
        assert_eq!(
            page(&plain(10, 4), 1, Ok(Some(10)), next).lines().count(),
            10
        );
        assert!(page(&plain(10, 4), 1, Ok(Some(11)), next).ends_with("… more: next 11"));
        let e = ApiError::local("boom");
        assert!(
            page(&plain(10, 4), 1, Err(&e), next)
                .ends_with("\n… line count unavailable (boom); if the log goes on: next 11")
        );
    }

    fn records(json: serde_json::Value) -> Vec<TimelineRecord> {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn tree_survives_bad_records() {
        let recs = records(serde_json::json!([
            {"id": "s", "type": "Stage", "name": "S", "order": 1},
            // Same id as its parent: a loop.
            {"id": "s", "parentId": "s", "type": "Phase", "name": "P", "order": 1},
            {"parentId": "s", "type": "Job", "name": "J", "order": 2},
            {"type": "Stage", "name": "No id", "order": 2},
        ]));
        let mut kids: Children = HashMap::new();
        for r in &recs {
            kids.entry(r.parent_id.as_deref()).or_default().push(r);
        }
        let mut out = Vec::new();
        tree(&kids, None, 0, 0, &mut out);
        assert!(out.len() < 20, "{out:?}");
        assert_eq!(out[0], "S:");
        assert!(out.contains(&"No id:".to_owned()), "{out:?}");
        assert!(!out.iter().any(|l| l.contains('P')), "{out:?}");
    }

    #[test]
    fn job_note_caps_issues_and_strips() {
        let issues: Vec<serde_json::Value> = (0..25)
            .map(|i| serde_json::json!({"type": "error", "message": format!("e{i}\x1b[31m\r\nx")}))
            .collect();
        let recs = records(serde_json::json!([
            {"id": "j", "type": "Job", "name": "Deploy", "result": "failed", "issues": issues},
        ]));
        let (hits, notes) = targets(&recs, None, 7).unwrap();
        assert_eq!(hits.len(), 0);
        let lines: Vec<&str> = notes[0].lines().collect();
        assert_eq!(lines.len(), 1 + ISSUES_MAX + 1);
        assert_eq!(lines[1], "  error e0 x");
        assert_eq!(lines[21], "  … 5 more issues: pipeline_view run=7");
    }

    #[test]
    fn unknown_step_names_capped() {
        let tasks: Vec<serde_json::Value> = (0..25)
            .map(|i| serde_json::json!({"type": "Task", "name": format!("t{i}")}))
            .collect();
        let e = targets(&records(serde_json::Value::Array(tasks)), Some("x"), 7).unwrap_err();
        assert!(
            e.msg
                .starts_with("no step \"x\" in run #7; its steps: t0, t1,"),
            "{e}"
        );
        assert!(e.msg.ends_with(", t19 … and 5 more"), "{e}");
    }

    #[test]
    fn durations() {
        assert_eq!(took(None), "");
        assert_eq!(took(Some(9)), "9s");
        assert_eq!(took(Some(295)), "4m 55s");
        assert_eq!(took(Some(3610)), "1h 0m");
    }
}
