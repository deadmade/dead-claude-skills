//! The pipeline tools: the reads `pipeline_runs`, `pipeline_view` and `pipeline_log`, the writes `pipeline_run` and
//! `pipeline_cancel`; and `repo_list` and `project_list`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;

use azure_devops_rust_api::build::models::{
    BuildQueryOrder, BuildResult, Issue, Timeline, TimelineRecord, timeline_record,
};
use azure_devops_rust_api::pipelines::models::{RunPipelineParameters, RunResourcesParameters};
use azure_devops_rust_api::test::models::{TestCaseResult, TestRun};
use reqwest::Method;
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::json;

use crate::api::{ApiError, V71_PREVIEW};
use crate::ctx::{Ctx, given, seg};
use crate::out::{REPLY_MAX, args, cut, full_ref, more, ref_name, strip_ansi};

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

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct PipelineRunArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Pipeline name or id.
    pub pipeline: String,
    /// The branch to run. Default: the clone's current branch.
    pub branch: Option<String>,
    /// Template parameters, name → value.
    pub parameters: Option<BTreeMap<String, String>>,
}

/// Lines of context around an error line, and the length of the tail.
const CONTEXT: usize = 5;
const TAIL: usize = 50;
/// Lines per `full` call.
const PAGE: u32 = 2000;
/// The most lines a default (non-`full`) call reads of a step's log: its end, where the errors and the tail are.
const WINDOW: u32 = 20_000;
/// A log line is cut here: one minified file on a line would fill the reply.
const LINE_MAX: usize = 1000;
const ISSUES_MAX: usize = 20;
/// Failed tests `pipeline_view` shows, and the stack trace lines of each.
const FAILED_MAX: usize = 20;
const STACK_MAX: usize = 5;
/// Step names an error lists.
const NAMES_MAX: usize = 20;
/// Lines of error context an excerpt shows before it points at the full log.
const EXCERPT_MAX: usize = 300;
/// Characters per `full` page (Ruling R8): 2000 long lines would fill the reply. Held under `REPLY_MAX` so the
/// budget's own "not shown" line always fits.
const PAGE_CHARS: usize = REPLY_MAX - 1000;

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
    let pr = a.pr.map(|n| n.to_string());
    let filters = args(&[
        ("project", a.project.as_deref()),
        ("pipeline", a.pipeline.as_deref()),
        ("branch", a.branch.as_deref()),
        ("pr", pr.as_deref()),
        ("result", a.result.as_deref()),
    ]);
    format!("pipeline_runs{filters} limit={}", limit * 2)
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
            let name = given(a.pipeline.as_deref());
            let def = match name {
                Some(n) => Some(ctx.pipeline_id(&s, n).await?.to_string()),
                None => None,
            };
            let (api, proj) = (&ctx.api, seg(&s.project_id));
            let found = api
                .az(|| {
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
                .await;
            // A 404 may be a pipeline id gone stale too: `retry_stale` then looks the name up again.
            if let (Err(e), Some(n)) = (&found, name)
                && e.status == Some(404)
            {
                ctx.forget_pipeline(&s, n);
            }
            found
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
    let mut line = format!("{kind} {}", words.join(" "));
    cap(&mut line);
    line
}

/// `text` cut to `LINE_MAX` characters, marked with `…`.
fn cap(text: &mut String) {
    if let Some((at, _)) = text.char_indices().nth(LINE_MAX) {
        text.truncate(at);
        text.push('…');
    }
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
fn tree<'a>(
    kids: &Children<'a>,
    parent: Option<&str>,
    depth: usize,
    hops: u8,
    seen: &mut HashSet<&'a str>,
    out: &mut Vec<String>,
) {
    // The records come from the server. `seen` expands each id once, so records that loop (duplicate ids) can't
    // fan out; `hops` bounds the recursion, which a long chain of distinct ids would otherwise deepen.
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
        let deeper = match k {
            "Phase" => depth,
            "Stage" => depth + 1,
            _ => continue,
        };
        if seen.insert(id) {
            tree(kids, Some(id), deeper, hops + 1, seen, out);
        }
    }
}

/// The job a test run came from (stage, phase and job name, by its `pipelineReference`) and that job's attempt
/// (stage, phase, job); none when the reference names no phase or job.
fn job_attempt(r: &TestRun) -> Option<(JobKey<'_>, (i32, i32, i32))> {
    let p = r.pipeline_reference.as_ref()?;
    let (s, ph, j) = (
        p.stage_reference.as_ref(),
        p.phase_reference.as_ref(),
        p.job_reference.as_ref(),
    );
    let key = (
        s.and_then(|s| s.stage_name.as_deref()),
        ph.and_then(|p| p.phase_name.as_deref()),
        j.and_then(|j| j.job_name.as_deref()),
    );
    if key.1.is_none() && key.2.is_none() {
        return None;
    }
    let attempt = (
        s.and_then(|s| s.attempt).unwrap_or(0),
        ph.and_then(|p| p.attempt).unwrap_or(0),
        j.and_then(|j| j.attempt).unwrap_or(0),
    );
    Some((key, attempt))
}

type JobKey<'a> = (Option<&'a str>, Option<&'a str>, Option<&'a str>);

/// The test runs that count, by id: a retried job publishes again, so of one job's runs only those of its latest
/// attempt; every run of that attempt (one per result file, all with one name), and every run that names no job.
fn latest_attempts(mut runs: Vec<TestRun>) -> Vec<TestRun> {
    runs.sort_by_key(|r| r.id);
    let mut latest: HashMap<JobKey, (i32, i32, i32)> = HashMap::new();
    for (job, attempt) in runs.iter().filter_map(job_attempt) {
        let top = latest.entry(job).or_insert(attempt);
        *top = (*top).max(attempt);
    }
    let keep: Vec<bool> = runs
        .iter()
        .map(|r| job_attempt(r).is_none_or(|(job, attempt)| latest[&job] == attempt))
        .collect();
    runs.into_iter()
        .zip(keep)
        .filter_map(|(r, k)| k.then_some(r))
        .collect()
}

/// `tests: <passed> passed, <failed> failed, <skipped> skipped` over `runs`, then the first `FAILED_MAX` failed tests
/// (the error's first line, the stack trace's first `STACK_MAX` lines), then how many of the counted failures weren't
/// shown, when `rest` is given (the failed tests couldn't all be read otherwise).
fn test_lines(runs: &[TestRun], failed: &[TestCaseResult], rest: Option<&str>) -> Vec<String> {
    let n = |v: Option<i32>| usize::try_from(v.unwrap_or(0)).unwrap_or(0);
    let (mut passed, mut fails, mut skipped) = (0, 0, 0);
    for r in runs {
        let (p, f) = (n(r.passed_tests), n(r.unanalyzed_tests));
        passed += p;
        fails += f;
        // A skipped test is published as `NotExecuted`: neither `notApplicableTests` nor `incompleteTests` counts it.
        skipped += n(r.total_tests).saturating_sub(p + f);
    }
    let mut lines = vec![format!(
        "tests: {passed} passed, {fails} failed, {skipped} skipped"
    )];
    let indented = |pad: &str, text: &str| {
        let mut line = format!("{pad}{text}");
        cap(&mut line);
        line
    };
    let shown = failed.len().min(FAILED_MAX);
    for t in &failed[..shown] {
        let mut head = t.test_case_title.clone().unwrap_or_else(|| "?".into());
        let msg = strip_ansi(t.error_message.as_deref().unwrap_or_default());
        if let Some(first) = msg.lines().map(str::trim).find(|l| !l.is_empty()) {
            let _ = write!(head, ": {first}");
        }
        lines.push(indented("  ", &head));
        let stack = strip_ansi(t.stack_trace.as_deref().unwrap_or_default());
        lines.extend(
            stack
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .take(STACK_MAX)
                .map(|l| indented("    ", l)),
        );
    }
    let left = fails.saturating_sub(shown);
    if let Some(rest) = rest.filter(|_| left > 0) {
        let s = if left == 1 { "" } else { "s" };
        lines.push(format!("  … {left} more failed test{s}{rest}"));
    }
    lines
}

/// The test result lines of run `run`: none when it published no tests or the server has no test area, one line when
/// its test runs can't be read, the summary and one line more when their failed tests can't.
async fn test_results(ctx: &Ctx, proj: &str, run: u32, rest: &str) -> Vec<String> {
    let unread = |e: ApiError| vec![format!("tests: couldn't be read ({e})")];
    let api = &ctx.api;
    let uri = format!("vstfs:///Build/Build/{run}");
    // Without `includeRunDetails` the runs carry no counts.
    let runs = api
        .az(|| {
            api.test
                .runs_client()
                .list(&api.org, proj)
                .build_uri(&uri)
                .include_run_details(true)
                .into_future()
        })
        .await;
    let runs = match runs {
        Ok(l) if !l.value.is_empty() => latest_attempts(l.value),
        Err(e) if e.status != Some(404) => return unread(e),
        _ => return Vec::new(),
    };
    let mut failed = Vec::new();
    for r in &runs {
        let remaining = FAILED_MAX.saturating_sub(failed.len());
        if remaining == 0 {
            break;
        }
        let Some(id) = r.id.filter(|_| r.unanalyzed_tests.unwrap_or(0) > 0) else {
            continue;
        };
        let top = i32::try_from(remaining).unwrap_or(i32::MAX);
        let page = api
            .az(|| {
                api.test
                    .results_client()
                    .list(&api.org, proj, id)
                    .outcomes("Failed")
                    .top(top)
                    .into_future()
            })
            .await;
        match page {
            Ok(l) => failed.extend(l.value.into_iter().take(remaining)),
            Err(e) => {
                let mut lines = test_lines(&runs, &failed, None);
                let e = e.with_what("test results");
                lines.push(format!("  failed tests couldn't be read ({e})"));
                return lines;
            }
        }
    }
    test_lines(&runs, &failed, Some(rest))
}

/// # Errors
/// When the scope, the run or the server fails.
pub(crate) async fn pipeline_view(ctx: &Ctx, a: &RunArgs) -> Result<String, ApiError> {
    let p = a.project.as_deref();
    let rest = format!(": pipeline_log run={}{}", a.run, args(&[("project", p)]));
    // The scope first: the timeline and the test runs are then asked for at once. A stale cached project id drops the
    // test lines for this one reply; the timeline's retry refreshes the cache for the next one.
    let proj = seg(&ctx.scope(p, None, None).await?.project_id);
    let (t, tests) = tokio::join!(
        timeline(ctx, p, a.run),
        test_results(ctx, &proj, a.run, &rest)
    );
    let (_, t) = t?;
    let mut kids: Children = HashMap::new();
    for r in &t.records {
        kids.entry(r.parent_id.as_deref()).or_default().push(r);
    }
    for v in kids.values_mut() {
        v.sort_by_key(|r| r.order);
    }
    let mut lines = Vec::new();
    tree(&kids, None, 0, 0, &mut HashSet::new(), &mut lines);
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
        lines.extend(issue_lines(&issues, &rest));
    }
    lines.extend(tests);
    Ok(lines.join("\n"))
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
    raw.strip_prefix('\u{feff}')
        .unwrap_or(raw)
        .lines()
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
            cap(&mut text);
            (err, text)
        })
        .collect()
}

/// The error lines with their context (merged, `…` between the pieces, at most 300 lines, then how many error lines
/// were left out and `call(line)`, the call that reads on from the first line not shown), then the last 50 lines.
pub(crate) fn excerpt(lines: &[(bool, String)], call: impl Fn(u64) -> String) -> String {
    let tail = lines.len().saturating_sub(TAIL);
    let mut out: Vec<&str> = Vec::new();
    // The first line before the tail not printed yet, and where the first piece left out starts.
    let mut next = 0;
    let mut stop = None;
    let mut shown = 0;
    for (i, _) in lines[..tail].iter().enumerate().filter(|(_, (e, _))| *e) {
        let from = i.saturating_sub(CONTEXT).max(next);
        let to = (i + CONTEXT + 1).min(tail);
        if from >= to {
            continue;
        }
        if shown + (to - from) > EXCERPT_MAX {
            stop = Some(from);
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
    let note = stop.map(|from| format!("… {left} more error lines: {}", call(from as u64 + 1)));
    out.extend(note.as_deref());
    out.push("--- last 50 lines ---");
    out.extend(lines[tail..].iter().map(|(_, l)| l.as_str()));
    out.join("\n")
}

/// The steps to show, and the failed-job notes with their job's name.
type Targets<'a> = (Vec<&'a TimelineRecord>, Vec<(String, String)>);

/// The steps whose logs to show: `step`'s, else the failed ones; and a note (and the job's name) for each failed
/// job with no failed step.
fn targets<'a>(
    recs: &'a [TimelineRecord],
    step: Option<&str>,
    run: u32,
    p: &str,
) -> Result<Targets<'a>, ApiError> {
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
        // Same-named steps (a matrix): the failed ones first.
        let mut hits = hits;
        hits.sort_by_key(|r| !failed(r));
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
            lines.extend(issue_lines(
                &issues,
                &format!(": pipeline_view run={run}{p}"),
            ));
            notes.push((lines.join("\n"), name(job).to_owned()));
        }
    }
    Ok((hits, notes))
}

/// How many lines a default call leaves unread of a log `total` lines long: all but the last `WINDOW`, which hold
/// what the excerpt shows (a log can be huge); 0 when the count is unknown.
fn unread(total: Result<Option<i64>, &ApiError>) -> i64 {
    match total {
        Ok(Some(n)) => (n - i64::from(WINDOW)).max(0),
        _ => 0,
    }
}

/// The lines a default call reads, and the number of the log's line before the first: `skipped`, unless the server
/// ignored the range and sent more than `WINDOW` lines, whose end is then the window.
fn window(lines: &[(bool, String)], skipped: i64) -> (&[(bool, String)], u64) {
    let from = lines.len().saturating_sub(WINDOW as usize);
    if skipped > 0 && from > 0 {
        (&lines[from..], from as u64)
    } else {
        (lines, skipped.unsigned_abs())
    }
}

/// The `pipeline_log` call for `step` from line `start` on; `p` is the ` project=…` the call was given.
fn page_call(run: u32, p: &str, step: &str, start: u64) -> String {
    format!("pipeline_log run={run}{p} step=\"{step}\" full=true start={start}")
}

/// The job a step runs in, by name.
fn job_of<'a>(recs: &'a [TimelineRecord], step: &TimelineRecord) -> &'a str {
    recs.iter()
        .find(|j| kind(j) == "Job" && j.id.is_some() && j.id == step.parent_id)
        .map_or("?", name)
}

/// One `full` page from line `start`: at most 2000 lines and `budget` characters, then the call for the next page
/// when the log goes on. More than 2000 lines, or the whole log for a later page, means the server ignored the range
/// it was asked for: the lines before `start` are skipped here.
fn page(
    lines: &[(bool, String)],
    start: u32,
    total: Result<Option<i64>, &ApiError>,
    budget: usize,
    next: impl Fn(u64) -> String,
) -> String {
    let known = total.ok().flatten();
    let whole = start > 1 && known.is_some_and(|n| usize::try_from(n) == Ok(lines.len()));
    let lines = if lines.len() > PAGE as usize || whole {
        &lines[(start as usize - 1).min(lines.len())..]
    } else {
        lines
    };
    if lines.is_empty()
        && let Some(n) = known.filter(|n| i64::from(start) > *n)
    {
        return format!("no lines from {start}; the log has {n}");
    }
    let mut out = Vec::new();
    let mut chars = 0;
    for (_, l) in lines.iter().take(PAGE as usize) {
        let n = l.chars().count() + 1;
        if !out.is_empty() && chars + n > budget {
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

/// The reply's blocks, in order, while they fit in `PAGE_CHARS`; the ones after that are named by their calls.
#[derive(Default)]
struct Budget {
    out: Vec<String>,
    used: usize,
    shown: bool,
    /// Set once a block didn't fit whole: later blocks only get named.
    spent: bool,
    left: Vec<String>,
}

impl Budget {
    /// Characters still free.
    fn room(&self) -> usize {
        PAGE_CHARS.saturating_sub(self.used)
    }

    /// A line that always shows, such as a header.
    fn head(&mut self, text: String) {
        self.used += text.chars().count() + 2;
        self.out.push(text);
    }

    /// `text` if it fits; a first block too long is cut at a line, with `whole` (the call that reads it all).
    /// `call` names it when it doesn't fit.
    fn add(&mut self, mut text: String, call: String, whole: &str) {
        let n = text.chars().count() + 2;
        if self.spent || (self.shown && n > self.room()) {
            self.spent = true;
            self.left.push(call);
            return;
        }
        if n > self.room() {
            let room = self.room().saturating_sub(whole.chars().count() + 100);
            let mut kept = 0;
            let mut at = 0;
            for l in text.split_inclusive('\n') {
                kept += l.chars().count();
                if kept > room {
                    break;
                }
                at += l.len();
            }
            text.truncate(at);
            let _ = write!(text, "… cut at the output limit: {whole}");
            self.spent = true;
        }
        self.used += text.chars().count() + 2;
        self.shown = true;
        self.out.push(text);
    }

    fn finish(mut self) -> String {
        if !self.left.is_empty() {
            let mut seen = HashSet::new();
            let calls: Vec<&str> = self
                .left
                .iter()
                .filter(|c| seen.insert(c.as_str()))
                .map(String::as_str)
                .collect();
            let line = format!("… output limit reached; not shown: {}", name_list(&calls));
            self.out.push(line);
        }
        self.out.join("\n\n")
    }
}

/// What a `full` call with several steps says first: which one it shows, and the others.
fn full_head(recs: &[TimelineRecord], targets: &[&TimelineRecord]) -> String {
    let first = targets[0];
    if targets
        .iter()
        .all(|r| name(r).eq_ignore_ascii_case(name(first)))
    {
        return format!(
            "{} steps named \"{}\"; showing job {}'s",
            targets.len(),
            name(first),
            job_of(recs, first)
        );
    }
    let others: Vec<&str> = targets[1..].iter().map(|r| name(r)).collect();
    format!(
        "showing {} only; also failed: {}; pass step to page through one",
        name(first),
        name_list(&others)
    )
}

/// # Errors
/// When the scope, the run, the step or the server fails.
pub(crate) async fn pipeline_log(ctx: &Ctx, a: &LogArgs) -> Result<String, ApiError> {
    let run = a.run;
    let (proj, t) = timeline(ctx, a.project.as_deref(), run).await?;
    let id = run_id(run)?;
    let p = args(&[("project", a.project.as_deref())]);
    let (mut targets, notes) = targets(&t.records, given(a.step.as_deref()), run, &p)?;
    if targets.is_empty() && notes.is_empty() {
        return Ok(format!(
            "run #{run} has no failed step; pass step to read one"
        ));
    }
    let api = &ctx.api;
    let full = a.full == Some(true);
    let start = a.start.unwrap_or(1).max(1);
    let end = start.saturating_add(PAGE - 1);
    let mut out = Budget::default();
    // A full page is one step's: the others are named so the agent can pass their step.
    if full && targets.len() > 1 {
        out.head(full_head(&t.records, &targets));
        targets.truncate(1);
    }
    // The line counts page a `full` call and bound the default one's download.
    let counts = api
        .az(|| {
            api.build
                .builds_client()
                .get_build_logs(&api.org, &proj, id)
                .into_future()
        })
        .await
        .map(|l| l.value);
    for r in targets {
        let step = name(r);
        let call = format!("pipeline_log run={run}{p} step=\"{step}\"");
        let whole = page_call(run, &p, step, 1);
        if out.spent {
            out.add(String::new(), call, &whole);
            continue;
        }
        let mut text = format!("{step}: {}", state(r));
        let Some(log) = &r.log else {
            out.add(format!("{step}: no log ({})", state(r)), call, &whole);
            continue;
        };
        let total = counts.as_ref().map(|c| {
            c.iter()
                .find(|c| c.build_log_reference.id == log.id)
                .and_then(|c| c.line_count)
        });
        let skipped = if full { 0 } else { unread(total) };
        if skipped > 0 {
            let _ = write!(
                text,
                " (first {skipped} lines not read; {whole} shows them)"
            );
        }
        // The crate reads this answer as a JSON string; the log is plain text, so the raw body it is.
        let raw = api
            .az(|| {
                let mut b = api
                    .build
                    .builds_client()
                    .get_build_log(&api.org, &proj, id, log.id);
                if full {
                    b = b.start_line(i64::from(start)).end_line(i64::from(end));
                } else if skipped > 0 {
                    b = b
                        .start_line(skipped + 1)
                        .end_line(skipped + i64::from(WINDOW));
                }
                b.send()
            })
            .await
            .map(|r| r.into_raw_response().into_body());
        let lines = match raw {
            Err(e) => {
                let _ = write!(text, "\nlog unavailable ({e})");
                out.add(text, call, &whole);
                continue;
            }
            Ok(body) => clean_log(&String::from_utf8_lossy(&body)),
        };
        let body = if full {
            // Room for the header, the more line and the separators.
            let room = out.room().saturating_sub(text.chars().count() + 300);
            page(&lines, start, total, room, |n| page_call(run, &p, step, n))
        } else {
            let (lines, offset) = window(&lines, skipped);
            excerpt(lines, |n| page_call(run, &p, step, n + offset))
        };
        let _ = write!(text, "\n{body}");
        out.add(text, call, &whole);
    }
    for (note, job) in notes {
        out.add(note, format!("{job} (pipeline_view run={run}{p})"), "");
    }
    Ok(out.finish())
}

/// # Errors
/// When there is no branch, or the scope, the pipeline or the server fails.
pub(crate) async fn pipeline_run(ctx: &Ctx, a: &PipelineRunArgs) -> Result<String, ApiError> {
    let (p, b) = (a.project.as_deref(), a.branch.as_deref());
    let first = ctx.scope(p, None, b).await?;
    // Only the lookups retry; the run itself is sent once.
    let (s, def) = ctx
        .retry_stale(&first.key, || async {
            let s = ctx.scope(p, None, b).await?;
            let def = ctx.pipeline_id(&s, &a.pipeline).await?;
            Ok((s, def))
        })
        .await?;
    let branch = full_ref(
        s.branch
            .as_deref()
            .ok_or_else(|| ApiError::local("no branch: pass branch"))?,
    );
    let body = RunPipelineParameters {
        resources: Some(RunResourcesParameters {
            repositories: Some(json!({"self": {"refName": branch}})),
            ..RunResourcesParameters::default()
        }),
        template_parameters: a.parameters.as_ref().map(|m| json!(m)),
        ..RunPipelineParameters::default()
    };
    let (api, proj) = (&ctx.api, seg(&s.project_id));
    let run = api
        .az(|| {
            api.pipelines
                .runs_client()
                .run_pipeline(&api.org, body.clone(), &proj, def)
                .into_future()
        })
        .await
        .map_err(|e| {
            // Not resent (a write), but the next call looks the name up again.
            if e.status == Some(404) {
                ctx.forget_pipeline(&s, &a.pipeline);
            }
            e.with_what(&format!("pipeline {}", a.pipeline.trim()))
        })?;
    Ok(format!(
        "queued run #{} of {} on {}",
        run.run_reference.id,
        run.pipeline.pipeline_base.name,
        ref_name(&branch)
    ))
}

/// # Errors
/// When the scope, the run or the server fails.
pub(crate) async fn pipeline_cancel(ctx: &Ctx, a: &RunArgs) -> Result<String, ApiError> {
    let run = a.run;
    let id = run_id(run)?;
    let proj = seg(&ctx
        .scope(a.project.as_deref(), None, None)
        .await?
        .project_id);
    // By hand: the crate's `update_build` takes a whole `Build`, whose required fields would go out with the status.
    ctx.api
        .send::<IgnoredAny>(
            Method::PATCH,
            &format!("{proj}/_apis/build/builds/{id}"),
            &[],
            V71_PREVIEW,
            &json!({"status": "cancelling"}),
            false,
        )
        .await
        .map_err(|e| e.with_what(&format!("run #{run}")))?;
    Ok(format!("cancelling run #{run}"))
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

/// Projects asked for per request (`$top`); the server may hand out fewer.
const PROJECTS_PAGE: i32 = 100;

/// Requests at most: 10,000 projects at full pages.
const PROJECT_PAGES: usize = 100;

/// Every well-formed project the PAT can see, sorted by name, one per line.
///
/// # Errors
/// When the server fails.
pub(crate) async fn project_list(ctx: &Ctx) -> Result<String, ApiError> {
    let api = &ctx.api;
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    let mut ended = false;
    for _ in 0..PROJECT_PAGES {
        // `$skip` follows what came back, so a server that hands out fewer than `$top` is still read to the end.
        let skip = i32::try_from(names.len()).unwrap_or(i32::MAX);
        let page = api
            .az(|| {
                api.core
                    .projects_client()
                    .list(&api.org)
                    .top(PROJECTS_PAGE)
                    .skip(skip)
                    .into_future()
            })
            .await?
            .value;
        let before = names.len();
        names.extend(
            page.into_iter()
                .map(|p| p.name)
                .filter(|n| seen.insert(n.clone())),
        );
        // An empty page ends the list; so does one with nothing new (a server that ignores `$skip`).
        if names.len() == before {
            ended = true;
            break;
        }
    }
    names.sort_by_cached_key(|n| n.to_lowercase());
    if names.is_empty() {
        return Ok("no projects visible to this PAT".into());
    }
    if !ended {
        names.push(format!("… the list stops at {} projects", names.len()));
    }
    Ok(names.join("\n"))
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
                   trailing esc\x1b\n\
                   a\x1b]0;t\x1b[31mb\n\
                   \x1bPq#0\x1b\\c \x1b_x\x1b\\d \x1b^y\x07e\n\
                   \u{90}z\u{9c}f \u{9f}z\u{9c}g \u{9e}z\u{9c}h";
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
                "ab",
                "c d e",
                "f g h",
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
        let bom = clean_log("\u{feff}2026-03-05T10:00:20.1234567Z first\r\nsecond");
        assert_eq!(bom[0].1, "first");
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
        assert_eq!(excerpt(&lines, |_| "x".into()), want.join("\n"));
        let short = vec![(true, "ERROR x".to_owned())];
        assert_eq!(
            excerpt(&short, |_| "x".into()),
            "--- last 50 lines ---\nERROR x"
        );
    }

    #[test]
    fn excerpt_caps_errors() {
        let lines: Vec<(bool, String)> = (0..5000).map(|i| (true, format!("ERROR {i}"))).collect();
        let out = excerpt(&lines, |n| page_call(7, "", "T", n));
        let out: Vec<&str> = out.lines().collect();
        assert_eq!(out.len(), EXCERPT_MAX + 2 + TAIL, "{out:?}");
        assert_eq!(out[EXCERPT_MAX - 1], "ERROR 299");
        assert_eq!(
            out[EXCERPT_MAX],
            "… 4650 more error lines: pipeline_log run=7 step=\"T\" full=true start=301"
        );
        assert_eq!(out[EXCERPT_MAX + 1], "--- last 50 lines ---");
    }

    fn page_at(
        lines: &[(bool, String)],
        start: u32,
        total: Result<Option<i64>, &ApiError>,
        next: impl Fn(u64) -> String,
    ) -> String {
        page(lines, start, total, PAGE_CHARS, next)
    }

    fn plain(n: usize, width: usize) -> Vec<(bool, String)> {
        (0..n).map(|i| (false, format!("{i:0width$}"))).collect()
    }

    #[test]
    fn page_cuts_at_lines_or_chars() {
        let next = |n| format!("next {n}");
        // The server ignored the range and sent 2500 short lines: 2000 shown.
        let out = page_at(&plain(2500, 4), 1, Ok(None), next);
        assert_eq!(out.lines().count(), PAGE as usize + 1);
        assert!(out.ends_with("\n… more: next 2001"), "{out}");
        // Ruling R8: 100-character lines stop at 39,000 characters, under the 40,000 reply cap (386 lines of 101
        // with the newline).
        let out = page_at(&plain(2000, 100), 501, Ok(Some(2500)), next);
        assert_eq!(out.lines().count(), 387);
        assert!(out.ends_with("\n… more: next 887"), "{out}");
        assert!(out.chars().count() < PAGE_CHARS + 100);
        // All shown: more only when the line count says the log goes on.
        assert_eq!(
            page_at(&plain(10, 4), 1, Ok(Some(10)), next)
                .lines()
                .count(),
            10
        );
        assert!(page_at(&plain(10, 4), 1, Ok(Some(11)), next).ends_with("… more: next 11"));
        // Past the end, and a server that ignored the range (the whole log, or more than a page).
        assert_eq!(
            page_at(&[], 3000, Ok(Some(2500)), next),
            "no lines from 3000; the log has 2500"
        );
        let out = page_at(&plain(2500, 4), 2001, Ok(Some(2500)), next);
        assert_eq!(out.lines().count(), 500);
        assert!(
            out.starts_with("2000\n") && out.ends_with("\n2499"),
            "{out}"
        );
        let out = page_at(&plain(100, 4), 51, Ok(Some(100)), next);
        assert_eq!(out.lines().next(), Some("0050"));
        let e = ApiError::local("boom");
        assert!(
            page_at(&plain(10, 4), 1, Err(&e), next)
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
        tree(&kids, None, 0, 0, &mut HashSet::new(), &mut out);
        assert!(out.len() < 20, "{out:?}");
        assert_eq!(out[0], "S:");
        assert!(out.contains(&"No id:".to_owned()), "{out:?}");
        assert!(!out.iter().any(|l| l.contains('P')), "{out:?}");
    }

    #[test]
    fn tree_loop_does_not_fan_out() {
        let mut recs = vec![serde_json::json!({"id": "s", "type": "Stage", "name": "root"})];
        recs.extend((0..100).map(|i| {
            serde_json::json!({"id": "s", "parentId": "s", "type": "Stage", "name": format!("s{i}")})
        }));
        let recs = records(serde_json::Value::Array(recs));
        let mut kids: Children = HashMap::new();
        for r in &recs {
            kids.entry(r.parent_id.as_deref()).or_default().push(r);
        }
        let mut out = Vec::new();
        tree(&kids, None, 0, 0, &mut HashSet::new(), &mut out);
        assert_eq!(out.len(), 101);
    }

    #[test]
    fn budget_names_what_is_left_out() {
        let block = |c: char, n: usize| {
            std::iter::repeat_n(format!("{c}"), n)
                .collect::<Vec<_>>()
                .join("\n")
        };
        let mut b = Budget::default();
        b.head("header".into());
        b.add(block('a', 10000), "call a".into(), "whole a");
        // 8 + 20,001 + 20,001 characters: `b` no longer fits, and nothing after it is shown.
        b.add(block('b', 10000), "call b".into(), "whole b");
        b.add(block('c', 1), "call c".into(), "whole c");
        b.add(String::new(), "call c".into(), "whole c");
        b.add(block('d', 1), "call d".into(), "whole d");
        let out = b.finish();
        assert!(out.chars().count() <= PAGE_CHARS, "{}", out.len());
        assert!(out.starts_with("header\n\na\n"));
        assert!(!out.contains("\nb") && !out.contains("\nc"));
        assert!(out.ends_with("a\n\n… output limit reached; not shown: call b, call c, call d"));
        // A first block too long for the budget is cut at a line and points at the whole log.
        let mut b = Budget::default();
        b.add(block('x', 30000), "call x".into(), "whole x");
        b.add(block('y', 1), "call y".into(), "whole y");
        let out = b.finish();
        assert!(out.chars().count() <= PAGE_CHARS, "{}", out.len());
        assert!(out.contains(
            "x\n… cut at the output limit: whole x\n\n… output limit reached; not shown: call y"
        ));
    }

    #[test]
    fn job_note_caps_issues_and_strips() {
        let issues: Vec<serde_json::Value> = (0..25)
            .map(|i| serde_json::json!({"type": "error", "message": format!("e{i}\x1b[31m\r\nx")}))
            .collect();
        let recs = records(serde_json::json!([
            {"id": "j", "type": "Job", "name": "Deploy", "result": "failed", "issues": issues},
        ]));
        let (hits, notes) = targets(&recs, None, 7, "").unwrap();
        assert_eq!(hits.len(), 0);
        let lines: Vec<&str> = notes[0].0.lines().collect();
        assert_eq!(lines.len(), 1 + ISSUES_MAX + 1);
        assert_eq!(lines[1], "  error e0 x");
        assert_eq!(lines[21], "  … 5 more issues: pipeline_view run=7");
    }

    #[test]
    fn unknown_step_names_capped() {
        let tasks: Vec<serde_json::Value> = (0..25)
            .map(|i| serde_json::json!({"type": "Task", "name": format!("t{i}")}))
            .collect();
        let e = targets(&records(serde_json::Value::Array(tasks)), Some("x"), 7, "").unwrap_err();
        assert!(
            e.msg
                .starts_with("no step \"x\" in run #7; its steps: t0, t1,"),
            "{e}"
        );
        assert!(e.msg.ends_with(", t19 … and 5 more"), "{e}");
    }

    fn test_run(id: i32, name: &str, total: i32, passed: i32, failed: i32) -> TestRun {
        serde_json::from_value(
            serde_json::json!({"id": id, "name": name, "totalTests": total,
            "passedTests": passed, "unanalyzedTests": failed}),
        )
        .unwrap()
    }

    /// A run named `Unit` that job `job` of stage `Build` published at `attempt`, as Runs - List shapes the reference.
    fn job_run(id: i32, job: &str, attempt: i32) -> TestRun {
        serde_json::from_value(serde_json::json!({"id": id, "name": "Unit",
            "pipelineReference": {"pipelineId": 77,
                "stageReference": {"stageName": "Build", "attempt": attempt},
                "phaseReference": {"phaseName": job, "attempt": attempt},
                "jobReference": {"jobName": "__default", "attempt": attempt}}}))
        .unwrap()
    }

    fn ids(runs: &[TestRun]) -> Vec<i32> {
        runs.iter().filter_map(|r| r.id).collect()
    }

    /// `PublishTestResults` makes one run per result file, all with the same name.
    #[test]
    fn same_job_attempt_all_count() {
        let kept = latest_attempts(vec![
            job_run(7, "Test", 1),
            job_run(5, "Test", 1),
            job_run(6, "Test", 1),
        ]);
        assert_eq!(ids(&kept), [5, 6, 7]);
    }

    #[test]
    fn retried_job_counts_latest_attempt() {
        let kept = latest_attempts(vec![
            job_run(5, "Test", 1),
            job_run(6, "Test", 1),
            job_run(8, "Test", 2),
            job_run(9, "Test", 2),
        ]);
        assert_eq!(ids(&kept), [8, 9]);
    }

    #[test]
    fn jobs_sharing_a_name_both_count() {
        let kept = latest_attempts(vec![job_run(5, "Test", 1), job_run(6, "Lint", 1)]);
        assert_eq!(ids(&kept), [5, 6]);
    }

    #[test]
    fn runs_without_reference_all_count() {
        let kept = latest_attempts(vec![
            test_run(9, "Unit", 1, 1, 0),
            test_run(5, "Unit", 1, 0, 1),
            job_run(3, "Test", 2),
        ]);
        assert_eq!(ids(&kept), [3, 5, 9]);
    }

    #[test]
    fn test_lines_summary_stack_and_cap() {
        let failed: Vec<TestCaseResult> = (0..21)
            .map(|i| {
                serde_json::from_value(serde_json::json!({"testCaseTitle": format!("t{i}"),
                    "errorMessage": "boom\x1b[31m\r\nsecond", "stackTrace": "  a\r\n\r\nb\nc\nd\ne\nf\n"}))
                .unwrap()
            })
            .collect();
        // Skipped: 30 − 4 − 25.
        let lines = test_lines(
            &[test_run(1, "Unit", 30, 4, 25)],
            &failed,
            Some(": pipeline_log run=7"),
        );
        assert_eq!(lines[0], "tests: 4 passed, 25 failed, 1 skipped");
        assert_eq!(lines[1], "  t0: boom");
        assert_eq!(
            lines[2..8],
            ["    a", "    b", "    c", "    d", "    e", "  t1: boom"]
        );
        assert_eq!(lines.len(), 1 + 20 * 6 + 1, "{lines:?}");
        assert_eq!(lines[115], "  t19: boom");
        assert_eq!(
            lines[lines.len() - 1],
            "  … 5 more failed tests: pipeline_log run=7"
        );
        let lines = test_lines(&[test_run(1, "Unit", 21, 0, 21)], &failed, Some(""));
        assert_eq!(lines[lines.len() - 1], "  … 1 more failed test");
        // Fewer results than the counts promise: the rest is counted from those shown.
        let lines = test_lines(&[test_run(1, "Unit", 25, 0, 25)], &failed[..10], Some(""));
        assert_eq!(lines[lines.len() - 1], "  … 15 more failed tests");
        // No error message, no stack trace: the name alone.
        let bare: TestCaseResult =
            serde_json::from_value(serde_json::json!({"testCaseTitle": "t"})).unwrap();
        let lines = test_lines(&[test_run(1, "Unit", 1, 0, 1)], &[bare], Some(""));
        assert_eq!(lines, ["tests: 0 passed, 1 failed, 0 skipped", "  t"]);
    }

    #[test]
    fn durations() {
        assert_eq!(took(None), "");
        assert_eq!(took(Some(9)), "9s");
        assert_eq!(took(Some(295)), "4m 55s");
        assert_eq!(took(Some(3610)), "1h 0m");
    }
}
