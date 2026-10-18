//! The pull request read tools: `pr_list`, `pr_view`, `pr_threads` and `pr_files`.

use std::fmt::Write as _;

use reqwest::Method;
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::api::{ApiError, V71, V71_P1};
use crate::ctx::{Ctx, Scope, given, seg};
use crate::out::{DESC_MAX, clip, cut, date, more, ref_name};

/// Where a tool works; all three default to the clone the server runs in.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct Where {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Repo name or id. Default: the clone's repo.
    pub repo: Option<String>,
    /// Branch for tools that default to "the current branch's PR". Default: the clone's current branch.
    pub branch: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct PrListArgs {
    #[serde(flatten)]
    pub at: Where,
    /// active (default), completed, abandoned or all.
    pub status: Option<String>,
    /// Author: `me` or part of a name.
    pub creator: Option<String>,
    /// Reviewer: `me` or part of a name.
    pub reviewer: Option<String>,
    /// Source branch.
    pub source: Option<String>,
    /// Target branch.
    pub target: Option<String>,
    /// How many to list. Default 20.
    pub limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct PrViewArgs {
    #[serde(flatten)]
    pub at: Where,
    /// Pull request id. Default: the active PR of the branch.
    pub id: Option<u32>,
    /// Show the whole description instead of the first 4000 characters.
    pub full: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct PrThreadsArgs {
    #[serde(flatten)]
    pub at: Where,
    /// Pull request id. Default: the active PR of the branch.
    pub id: Option<u32>,
    /// Also show resolved threads.
    pub all: Option<bool>,
    /// How many threads to show. Default 20.
    pub limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct PrFilesArgs {
    #[serde(flatten)]
    pub at: Where,
    /// Pull request id. Default: the active PR of the branch.
    pub id: Option<u32>,
}

#[derive(Deserialize)]
struct List<T> {
    value: Vec<T>,
}

#[derive(Deserialize, Default)]
struct Person {
    #[serde(rename = "displayName", default)]
    name: String,
}

#[derive(Deserialize)]
struct Reviewer {
    #[serde(rename = "displayName", default)]
    name: String,
    #[serde(default)]
    vote: i32,
    #[serde(rename = "isRequired", default)]
    required: bool,
}

#[derive(Deserialize)]
pub(crate) struct Pr {
    #[serde(rename = "pullRequestId")]
    pub id: u32,
    #[serde(default)]
    pub status: String,
    #[serde(rename = "isDraft", default)]
    pub draft: bool,
    #[serde(default)]
    pub title: String,
    #[serde(rename = "createdBy", default)]
    author: Person,
    /// With `refs/heads/`.
    #[serde(rename = "sourceRefName", default)]
    pub source: String,
    /// With `refs/heads/`.
    #[serde(rename = "targetRefName", default)]
    pub target: String,
    pub description: Option<String>,
    #[serde(default)]
    reviewers: Vec<Reviewer>,
}

impl Where {
    /// The scope, which must name a repo.
    async fn scope(&self, ctx: &Ctx) -> Result<Scope, ApiError> {
        let (p, r, b) = (
            self.project.as_deref(),
            self.repo.as_deref(),
            self.branch.as_deref(),
        );
        let s = ctx.scope(p, r, b).await?;
        prs_path(&s)?;
        Ok(s)
    }
}

/// `{project}/_apis/git/repositories/{repo}/pullrequests`, by id.
fn prs_path(s: &Scope) -> Result<String, ApiError> {
    let repo = s.repo_id.as_deref().ok_or_else(|| {
        ApiError::local(
            "no repo: pass repo, or open Claude Code in a clone of an Azure DevOps repo",
        )
    })?;
    Ok(format!(
        "{}/_apis/git/repositories/{}/pullrequests",
        seg(&s.project_id),
        seg(repo)
    ))
}

/// `refs/heads/{branch}`, unless it already is a ref.
fn full_ref(branch: &str) -> String {
    if branch.starts_with("refs/") {
        branch.to_owned()
    } else {
        format!("refs/heads/{branch}")
    }
}

/// `!{id}  {status}  {source} → {target}  "{title}"  {author}  {n} approvals`
fn line(pr: &Pr) -> String {
    let approvals = pr.reviewers.iter().filter(|r| r.vote >= 5).count();
    let rejected = if pr.reviewers.iter().any(|r| r.vote == -10) {
        ", rejected"
    } else {
        ""
    };
    format!(
        "!{}  {}{}  {} → {}  \"{}\"  {}  {approvals} approvals{rejected}",
        pr.id,
        pr.status,
        if pr.draft { " draft" } else { "" },
        ref_name(&pr.source),
        ref_name(&pr.target),
        pr.title,
        pr.author.name
    )
}

/// # Errors
/// When the scope, a user or the server fails.
pub(crate) async fn pr_list(ctx: &Ctx, a: &PrListArgs) -> Result<String, ApiError> {
    let limit = a.limit.unwrap_or(20).max(1);
    let status = given(a.status.as_deref()).unwrap_or("active");
    if !["active", "completed", "abandoned", "all"].contains(&status) {
        return Err(ApiError::local(
            "status is active, completed, abandoned or all",
        ));
    }
    let mut q = vec![
        ("searchCriteria.status", status.to_owned()),
        ("$top", (limit + 1).to_string()),
    ];
    if let Some(u) = given(a.creator.as_deref()) {
        q.push(("searchCriteria.creatorId", ctx.user(u).await?.id));
    }
    if let Some(u) = given(a.reviewer.as_deref()) {
        q.push(("searchCriteria.reviewerId", ctx.user(u).await?.id));
    }
    if let Some(b) = given(a.source.as_deref()) {
        q.push(("searchCriteria.sourceRefName", full_ref(b)));
    }
    if let Some(b) = given(a.target.as_deref()) {
        q.push(("searchCriteria.targetRefName", full_ref(b)));
    }
    let first = a.at.scope(ctx).await?;
    let prs: List<Pr> = ctx
        .retry_stale(&first.key, || async {
            let s = a.at.scope(ctx).await?;
            ctx.api.get(&prs_path(&s)?, &q, V71).await
        })
        .await?;
    let (prs, has_more) = cut(prs.value, limit);
    let mut lines: Vec<String> = prs.iter().map(line).collect();
    if has_more {
        lines.push(more(&format!("pr_list limit={}", limit * 2)));
    }
    Ok(if lines.is_empty() {
        "no pull requests".into()
    } else {
        lines.join("\n")
    })
}

/// The PR with `id`, else the active one whose source is the scope's branch.
///
/// # Errors
/// When there is no such PR, no branch to look for, or the server fails.
pub(crate) async fn resolve_pr(ctx: &Ctx, scope: &Scope, id: Option<u32>) -> Result<Pr, ApiError> {
    let base = prs_path(scope)?;
    if let Some(id) = id {
        // A 404 here means the PR doesn't exist, so no `retry_stale`.
        return ctx
            .api
            .get(&format!("{base}/{id}"), &[], V71)
            .await
            .map_err(|e| e.with_what(&format!("PR !{id}")));
    }
    let branch = scope
        .branch
        .as_deref()
        .ok_or_else(|| ApiError::local("no branch: pass id or branch"))?;
    let q = [
        ("searchCriteria.sourceRefName", full_ref(branch)),
        ("searchCriteria.status", "active".to_owned()),
        ("$top", "1".to_owned()),
    ];
    let mut found = ctx.api.get::<List<Pr>>(&base, &q, V71).await?.value;
    if found.is_empty() {
        return Err(ApiError::local(format!("no active PR for branch {branch}")));
    }
    Ok(found.remove(0))
}

#[derive(Deserialize)]
struct Eval {
    #[serde(default)]
    status: String,
    configuration: EvalConfig,
}

#[derive(Deserialize)]
struct EvalConfig {
    #[serde(rename = "type")]
    kind: EvalType,
}

#[derive(Deserialize)]
struct EvalType {
    #[serde(rename = "displayName", default)]
    name: String,
}

async fn checks(ctx: &Ctx, s: &Scope, id: u32) -> Result<Vec<String>, ApiError> {
    let q = [(
        "artifactId",
        format!("vstfs:///CodeReview/CodeReviewId/{}/{id}", s.project_id),
    )];
    let path = format!("{}/_apis/policy/evaluations", seg(&s.project_id));
    let evals: List<Eval> = ctx.api.get(&path, &q, V71_P1).await?;
    Ok(evals
        .value
        .iter()
        .map(|e| format!("{}: {}", e.configuration.kind.name, e.status))
        .collect())
}

#[derive(Deserialize)]
struct WiRef {
    id: String,
}

#[derive(Deserialize)]
struct Wi {
    id: u32,
    fields: Map<String, Value>,
}

async fn work_items(ctx: &Ctx, s: &Scope, id: u32) -> Result<Vec<String>, ApiError> {
    let refs: List<WiRef> = ctx
        .api
        .get(&format!("{}/{id}/workitems", prs_path(s)?), &[], V71)
        .await?;
    let ids: Vec<u32> = refs
        .value
        .iter()
        .filter_map(|r| r.id.parse().ok())
        .collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let body = json!({"ids": ids,
        "fields": ["System.Title", "System.WorkItemType", "System.State"]});
    let items: List<Wi> = ctx
        .api
        .send(
            Method::POST,
            "_apis/wit/workitemsbatch",
            &[],
            V71,
            &body,
            false,
        )
        .await?;
    let field = |w: &Wi, k: &str| {
        w.fields
            .get(k)
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_owned()
    };
    Ok(items
        .value
        .iter()
        .map(|w| {
            format!(
                "#{} {} {} \"{}\"",
                w.id,
                field(w, "System.WorkItemType"),
                field(w, "System.State"),
                field(w, "System.Title")
            )
        })
        .collect())
}

#[derive(Deserialize)]
struct Build {
    id: u32,
    result: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(rename = "queueTime", default)]
    queued: String,
    definition: BuildDef,
}

#[derive(Deserialize)]
struct BuildDef {
    #[serde(default)]
    name: String,
}

/// The newest build of the PR's merge ref, else of its source branch.
async fn latest_run(ctx: &Ctx, s: &Scope, pr: &Pr) -> Result<String, ApiError> {
    let path = format!("{}/_apis/build/builds", seg(&s.project_id));
    for branch in [format!("refs/pull/{}/merge", pr.id), pr.source.clone()] {
        let mut q = vec![
            ("branchName", branch),
            ("queryOrder", "queueTimeDescending".to_owned()),
            ("$top", "1".to_owned()),
        ];
        if let Some(repo) = &s.repo_id {
            q.push(("repositoryId", repo.clone()));
            q.push(("repositoryType", "TfsGit".to_owned()));
        }
        if let Some(b) = ctx
            .api
            .get::<List<Build>>(&path, &q, V71)
            .await?
            .value
            .first()
        {
            let state = b.result.as_deref().unwrap_or(&b.status);
            return Ok(format!(
                "#{} {} {state} {}",
                b.id,
                b.definition.name,
                date(&b.queued)
            ));
        }
    }
    Ok("none".into())
}

fn vote(v: i32) -> &'static str {
    match v {
        10 => "approved",
        5 => "approved with suggestions",
        -5 => "waiting",
        -10 => "rejected",
        _ => "no vote",
    }
}

/// `title` and the indented `lines` after `out`, when there are any.
fn section(out: &mut String, title: &str, lines: &[String]) {
    if !lines.is_empty() {
        let _ = write!(out, "\n{title}");
        for l in lines {
            let _ = write!(out, "\n  {l}");
        }
    }
}

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_view(ctx: &Ctx, a: &PrViewArgs) -> Result<String, ApiError> {
    let s = a.at.scope(ctx).await?;
    let pr = resolve_pr(ctx, &s, a.id).await?;
    let (checks, items, run) = tokio::join!(
        checks(ctx, &s, pr.id),
        work_items(ctx, &s, pr.id),
        latest_run(ctx, &s, &pr)
    );
    let mut out = line(&pr);
    let reviewers: Vec<String> = pr
        .reviewers
        .iter()
        .map(|r| {
            let req = if r.required { " (required)" } else { "" };
            format!("{}: {}{req}", r.name, vote(r.vote))
        })
        .collect();
    section(&mut out, "reviewers:", &reviewers);
    section(&mut out, "checks:", &checks?);
    section(&mut out, "work items:", &items?);
    let _ = write!(out, "\nlatest run: {}", run?);
    let desc = pr.description.as_deref().unwrap_or_default().trim();
    if !desc.is_empty() {
        let desc = if a.full == Some(true) {
            desc.to_owned()
        } else {
            clip(desc, DESC_MAX, &format!("pr_view id={} full=true", pr.id))
        };
        let _ = write!(out, "\n\n{desc}");
    }
    Ok(out)
}

#[derive(Deserialize)]
pub(crate) struct Thread {
    id: u32,
    status: Option<String>,
    #[serde(rename = "isDeleted", default)]
    deleted: bool,
    #[serde(rename = "threadContext")]
    context: Option<ThreadContext>,
    #[serde(default)]
    comments: Vec<Comment>,
    properties: Option<Map<String, Value>>,
}

#[derive(Deserialize)]
struct ThreadContext {
    #[serde(rename = "filePath")]
    path: Option<String>,
    #[serde(rename = "rightFileStart")]
    right: Option<Pos>,
    #[serde(rename = "leftFileStart")]
    left: Option<Pos>,
}

#[derive(Deserialize)]
struct Pos {
    line: Option<u32>,
}

#[derive(Deserialize)]
struct Comment {
    content: Option<String>,
    #[serde(rename = "commentType")]
    kind: Option<String>,
    #[serde(rename = "isDeleted", default)]
    deleted: bool,
    #[serde(default)]
    author: Person,
}

/// Threads the server writes itself (votes, policy and push updates) rather than a person.
fn is_system(t: &Thread) -> bool {
    t.properties
        .as_ref()
        .is_some_and(|p| p.contains_key("CodeReviewThreadType"))
        || t.comments
            .iter()
            .all(|c| matches!(c.kind.as_deref(), None | Some("system")))
}

fn status(t: &Thread) -> &str {
    t.status.as_deref().unwrap_or("unknown")
}

/// `/src/a.rs` as `src/a.rs`.
fn rel(path: &str) -> &str {
    path.trim_start_matches('/')
}

fn thread_text(t: &Thread) -> String {
    let mut out = format!("#{} {}", t.id, status(t));
    if let Some(ThreadContext {
        path: Some(path),
        right,
        left,
    }) = &t.context
    {
        let line = right.as_ref().or(left.as_ref()).and_then(|p| p.line);
        let _ = write!(out, "  {}", rel(path));
        if let Some(n) = line {
            let _ = write!(out, ":{n}");
        }
    }
    for c in &t.comments {
        let text = clip(
            c.content.as_deref().unwrap_or_default().trim(),
            2000,
            "the full comment is in the web UI",
        );
        let _ = write!(
            out,
            "\n   {}: {}",
            c.author.name,
            text.replace('\n', "\n      ")
        );
    }
    out
}

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_threads(ctx: &Ctx, a: &PrThreadsArgs) -> Result<String, ApiError> {
    let s = a.at.scope(ctx).await?;
    let pr = resolve_pr(ctx, &s, a.id).await?;
    let all = a.all == Some(true);
    let limit = a.limit.unwrap_or(20).max(1);
    let path = format!("{}/{}/threads", prs_path(&s)?, pr.id);
    let mut threads = ctx.api.get::<List<Thread>>(&path, &[], V71).await?.value;
    threads.retain_mut(|t| {
        t.comments.retain(|c| !c.deleted);
        !t.deleted && !t.comments.is_empty() && !is_system(t)
    });
    let before = threads.len();
    if !all {
        threads.retain(|t| matches!(status(t), "active" | "pending" | "unknown"));
    }
    let hidden = before - threads.len();
    let (threads, has_more) = cut(threads, limit);
    let mut lines: Vec<String> = threads.iter().map(thread_text).collect();
    if has_more {
        let all_arg = if all { " all=true" } else { "" };
        lines.push(more(&format!(
            "pr_threads id={}{all_arg} limit={}",
            pr.id,
            limit * 2
        )));
    }
    if hidden > 0 {
        lines.push(format!(
            "{hidden} resolved threads hidden: pr_threads id={} all=true",
            pr.id
        ));
    }
    Ok(if lines.is_empty() {
        "no threads".into()
    } else {
        lines.join("\n")
    })
}

#[derive(Deserialize)]
struct Iteration {
    id: u32,
}

#[derive(Deserialize)]
struct Changes {
    #[serde(rename = "changeEntries", default)]
    entries: Vec<Change>,
    #[serde(rename = "nextSkip")]
    next_skip: Option<u32>,
}

#[derive(Deserialize)]
struct Change {
    #[serde(rename = "changeType", default)]
    kind: String,
    item: Option<ChangeItem>,
}

#[derive(Deserialize)]
struct ChangeItem {
    #[serde(default)]
    path: String,
}

const MAX_FILES: usize = 2000;

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_files(ctx: &Ctx, a: &PrFilesArgs) -> Result<String, ApiError> {
    let s = a.at.scope(ctx).await?;
    let pr = resolve_pr(ctx, &s, a.id).await?;
    let base = format!("{}/{}/iterations", prs_path(&s)?, pr.id);
    let last = ctx
        .api
        .get::<List<Iteration>>(&base, &[], V71)
        .await?
        .value
        .iter()
        .map(|i| i.id)
        .max()
        .ok_or_else(|| ApiError::local(format!("PR !{} has no iterations", pr.id)))?;
    let path = format!("{base}/{last}/changes");
    let mut files = Vec::new();
    let mut skip = 0;
    loop {
        let q = [("$top", MAX_FILES.to_string()), ("$skip", skip.to_string())];
        let page: Changes = ctx.api.get(&path, &q, V71).await?;
        files.extend(page.entries);
        skip = page.next_skip.unwrap_or(0);
        if skip == 0 || files.len() >= MAX_FILES {
            break;
        }
    }
    let has_more = files.len() > MAX_FILES || skip > 0;
    files.truncate(MAX_FILES);
    let (source, target) = (ref_name(&pr.source), ref_name(&pr.target));
    let mut lines: Vec<String> = files
        .iter()
        .map(|f| {
            format!(
                "{}  {}",
                f.kind,
                rel(f.item.as_ref().map_or("", |i| &i.path))
            )
        })
        .collect();
    if has_more {
        lines.push(more(&format!("git diff {target}...{source} --stat")));
    }
    lines.push(format!("diff: git diff {target}...{source}"));
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(json: &Value) -> Thread {
        serde_json::from_value(json.clone()).unwrap()
    }

    #[test]
    fn system_threads() {
        let sys = json!({"id": 1, "comments": [{"commentType": "system"}, {}]});
        assert!(is_system(&thread(&sys)));
        let vote = json!({"id": 2, "properties": {"CodeReviewThreadType": {}},
            "comments": [{"commentType": "text"}]});
        assert!(is_system(&thread(&vote)));
        let human =
            json!({"id": 3, "comments": [{"commentType": "system"}, {"commentType": "text"}]});
        assert!(!is_system(&thread(&human)));
    }
}
