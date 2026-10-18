//! The pull request read tools: `pr_list`, `pr_view`, `pr_threads` and `pr_files`.

use std::fmt::Write as _;

use azure_devops_rust_api::build::models::BuildQueryOrder;
use azure_devops_rust_api::git::models::{
    CommentThread, GitPullRequest, GitPullRequestCommentThreadList, GitPullRequestList,
    IdentityRef, PullRequestStatus, comment::CommentType,
};
use azure_devops_rust_api::wit::models::WorkItemBatchGetRequest;
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::api::{ApiError, V71_PREVIEW};
use crate::ctx::{Ctx, Scope, given, seg};
use crate::out::{DESC_MAX, clip, cut, more, ref_name};

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

impl Where {
    /// The scope, which must name a repo.
    async fn scope(&self, ctx: &Ctx) -> Result<Scope, ApiError> {
        let (p, r, b) = (
            self.project.as_deref(),
            self.repo.as_deref(),
            self.branch.as_deref(),
        );
        let s = ctx.scope(p, r, b).await?;
        repo_id(&s)?;
        Ok(s)
    }
}

/// The scope's repo id and project id, as path segments.
fn ids(s: &Scope) -> Result<(String, String), ApiError> {
    Ok((seg(repo_id(s)?), seg(&s.project_id)))
}

fn repo_id(s: &Scope) -> Result<&str, ApiError> {
    s.repo_id.as_deref().ok_or_else(|| {
        ApiError::local(
            "no repo: pass repo, or open Claude Code in a clone of an Azure DevOps repo",
        )
    })
}

/// `refs/heads/{branch}`, unless it already is a ref.
fn full_ref(branch: &str) -> String {
    if branch.starts_with("refs/") {
        branch.to_owned()
    } else {
        format!("refs/heads/{branch}")
    }
}

fn name(i: &IdentityRef) -> &str {
    i.graph_subject_base
        .display_name
        .as_deref()
        .unwrap_or_default()
}

/// `!{id}  {status}  {source} → {target}  "{title}"  {author}  {n} approvals`
fn line(pr: &GitPullRequest) -> String {
    let votes = || pr.reviewers.iter().map(|r| r.vote.unwrap_or_default());
    let approvals = votes().filter(|v| *v >= 5).count();
    let rejected = if votes().any(|v| v == -10) {
        ", rejected"
    } else {
        ""
    };
    format!(
        "!{}  {}{}  {} → {}  \"{}\"  {}  {approvals} approvals{rejected}",
        pr.pull_request_id,
        pr.status,
        if pr.is_draft { " draft" } else { "" },
        ref_name(&pr.source_ref_name),
        ref_name(&pr.target_ref_name),
        pr.title.as_deref().unwrap_or_default(),
        name(&pr.created_by)
    )
}

/// # Errors
/// When the scope, a user or the server fails.
pub(crate) async fn pr_list(ctx: &Ctx, a: &PrListArgs) -> Result<String, ApiError> {
    let limit = a.limit.unwrap_or(20).max(1);
    let status = match given(a.status.as_deref()).unwrap_or("active") {
        "active" => Some(PullRequestStatus::Active),
        "completed" => Some(PullRequestStatus::Completed),
        "abandoned" => Some(PullRequestStatus::Abandoned),
        "all" => None,
        _ => {
            return Err(ApiError::local(
                "status is active, completed, abandoned or all",
            ));
        }
    };
    let top = i32::try_from(limit.saturating_add(1)).unwrap_or(i32::MAX);
    let creator = match given(a.creator.as_deref()) {
        Some(u) => Some(ctx.user(u).await?.id),
        None => None,
    };
    let reviewer = match given(a.reviewer.as_deref()) {
        Some(u) => Some(ctx.user(u).await?.id),
        None => None,
    };
    let source = given(a.source.as_deref()).map(full_ref);
    let target = given(a.target.as_deref()).map(full_ref);
    let first = a.at.scope(ctx).await?;
    let prs = ctx
        .retry_stale(&first.key, || async {
            let s = a.at.scope(ctx).await?;
            let (api, (repo, proj)) = (&ctx.api, ids(&s)?);
            let Some(status) = &status else {
                // By hand: the crate's `PullRequestStatus` has no `all`.
                let filters = [
                    ("searchCriteria.creatorId", &creator),
                    ("searchCriteria.reviewerId", &reviewer),
                    ("searchCriteria.sourceRefName", &source),
                    ("searchCriteria.targetRefName", &target),
                ];
                let mut q = vec![
                    ("searchCriteria.status", "all".to_owned()),
                    ("$top", top.to_string()),
                ];
                q.extend(
                    filters
                        .iter()
                        .filter_map(|(k, v)| Some((*k, (*v).clone()?))),
                );
                let path = format!("{proj}/_apis/git/repositories/{repo}/pullrequests");
                return api.get::<GitPullRequestList>(&path, &q, V71_PREVIEW).await;
            };
            api.az(|| {
                let mut b = api
                    .git
                    .pull_requests_client()
                    .get_pull_requests(&api.org, &repo, &proj)
                    .search_criteria_status(status.clone())
                    .top(top);
                if let Some(v) = &creator {
                    b = b.search_criteria_creator_id(v);
                }
                if let Some(v) = &reviewer {
                    b = b.search_criteria_reviewer_id(v);
                }
                if let Some(v) = &source {
                    b = b.search_criteria_source_ref_name(v);
                }
                if let Some(v) = &target {
                    b = b.search_criteria_target_ref_name(v);
                }
                b.into_future()
            })
            .await
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
pub(crate) async fn resolve_pr(
    ctx: &Ctx,
    scope: &Scope,
    id: Option<u32>,
) -> Result<GitPullRequest, ApiError> {
    let (api, (repo, proj)) = (&ctx.api, ids(scope)?);
    let prs = api.git.pull_requests_client();
    if let Some(id) = id {
        let not_found = |e: ApiError| e.with_what(&format!("PR !{id}"));
        let n = i32::try_from(id).map_err(|_| ApiError::local(format!("not found: PR !{id}")))?;
        // A 404 here means the PR doesn't exist, so no `retry_stale`.
        return api
            .az(|| {
                prs.get_pull_request(&api.org, &repo, n, &proj)
                    .into_future()
            })
            .await
            .map_err(not_found);
    }
    let branch = scope
        .branch
        .as_deref()
        .ok_or_else(|| ApiError::local("no branch: pass id or branch"))?;
    let mut found = api
        .az(|| {
            prs.get_pull_requests(&api.org, &repo, &proj)
                .search_criteria_source_ref_name(full_ref(branch))
                .search_criteria_status(PullRequestStatus::Active)
                .top(1)
                .into_future()
        })
        .await?
        .value;
    if found.is_empty() {
        return Err(ApiError::local(format!("no active PR for branch {branch}")));
    }
    Ok(found.remove(0))
}

async fn checks(ctx: &Ctx, s: &Scope, id: i32) -> Result<Vec<String>, ApiError> {
    let (api, proj) = (&ctx.api, seg(&s.project_id));
    let artifact = format!("vstfs:///CodeReview/CodeReviewId/{}/{id}", s.project_id);
    let evals = api
        .az(|| {
            api.policy
                .evaluations_client()
                .list(&api.org, &proj, &artifact)
                .into_future()
        })
        .await?;
    Ok(evals
        .value
        .iter()
        .map(|e| {
            let kind = e.configuration.as_ref().and_then(|c| {
                c.versioned_policy_configuration_ref
                    .policy_configuration_ref
                    .type_
                    .as_ref()
            });
            let status = e.status.as_ref().map(ToString::to_string);
            format!(
                "{}: {}",
                kind.map_or("policy", |t| t.display_name.as_str()),
                status.unwrap_or_default()
            )
        })
        .collect())
}

async fn work_items(ctx: &Ctx, s: &Scope, id: i32) -> Result<Vec<String>, ApiError> {
    let (api, (repo, proj)) = (&ctx.api, ids(s)?);
    let refs = api
        .az(|| {
            api.git
                .pull_request_work_items_client()
                .list(&api.org, &repo, id, &proj)
                .into_future()
        })
        .await?;
    let ids: Vec<i32> = refs
        .value
        .iter()
        .filter_map(|r| r.id.as_deref()?.parse().ok())
        .collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let body = WorkItemBatchGetRequest {
        ids,
        fields: ["System.Title", "System.WorkItemType", "System.State"]
            .map(String::from)
            .into(),
        ..WorkItemBatchGetRequest::default()
    };
    // No project: linked items can sit in another one. The guard cuts the `//` this leaves.
    let items = api
        .az(|| {
            api.wit
                .work_items_client()
                .get_work_items_batch(&api.org, body.clone(), "")
                .into_future()
        })
        .await?;
    let field = |f: &Value, k: &str| f.get(k).and_then(Value::as_str).unwrap_or("?").to_owned();
    Ok(items
        .value
        .iter()
        .map(|w| {
            format!(
                "#{} {} {} \"{}\"",
                w.id,
                field(&w.fields, "System.WorkItemType"),
                field(&w.fields, "System.State"),
                field(&w.fields, "System.Title")
            )
        })
        .collect())
}

/// The newest build of the PR's merge ref, else of its source branch.
async fn latest_run(ctx: &Ctx, s: &Scope, pr: &GitPullRequest) -> Result<String, ApiError> {
    let (api, proj) = (&ctx.api, seg(&s.project_id));
    let merge = format!("refs/pull/{}/merge", pr.pull_request_id);
    for branch in [&merge, &pr.source_ref_name] {
        let builds = api
            .az(|| {
                let mut b = api
                    .build
                    .builds_client()
                    .list(&api.org, &proj)
                    .branch_name(branch)
                    .query_order(BuildQueryOrder::QueueTimeDescending)
                    .top(1);
                if let Some(repo) = &s.repo_id {
                    b = b.repository_id(repo).repository_type("TfsGit");
                }
                b.into_future()
            })
            .await?;
        if let Some(b) = builds.value.first() {
            let state = b
                .result
                .as_ref()
                .map(ToString::to_string)
                .or_else(|| b.status.as_ref().map(ToString::to_string))
                .unwrap_or_default();
            let queued = b
                .queue_time
                .map_or_else(|| "?".into(), |t| t.date().to_string());
            return Ok(format!(
                "#{} {} {state} {queued}",
                b.id,
                b.definition.name.as_deref().unwrap_or_default()
            ));
        }
    }
    Ok("none".into())
}

fn vote(v: i64) -> &'static str {
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

/// The scope and the PR, looked up once more when a cached repo id turns out stale.
async fn find_pr(
    ctx: &Ctx,
    at: &Where,
    id: Option<u32>,
) -> Result<(Scope, GitPullRequest), ApiError> {
    let first = at.scope(ctx).await?;
    ctx.retry_stale(&first.key, || async {
        let s = at.scope(ctx).await?;
        let pr = resolve_pr(ctx, &s, id).await?;
        Ok((s, pr))
    })
    .await
}

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_view(ctx: &Ctx, a: &PrViewArgs) -> Result<String, ApiError> {
    let (s, pr) = find_pr(ctx, &a.at, a.id).await?;
    let id = pr.pull_request_id;
    let (checks, items, run) = tokio::join!(
        checks(ctx, &s, id),
        work_items(ctx, &s, id),
        latest_run(ctx, &s, &pr)
    );
    let mut out = line(&pr);
    let reviewers: Vec<String> = pr
        .reviewers
        .iter()
        .map(|r| {
            let req = if r.is_required == Some(true) {
                " (required)"
            } else {
                ""
            };
            let v = vote(r.vote.unwrap_or_default());
            format!("{}: {v}{req}", name(&r.identity_ref))
        })
        .collect();
    section(&mut out, "reviewers:", &reviewers);
    for (title, lines) in [("checks:", checks), ("work items:", items)] {
        match lines {
            Ok(lines) => section(&mut out, title, &lines),
            Err(e) => {
                let _ = write!(out, "\n{title} unavailable ({e})");
            }
        }
    }
    match run {
        Ok(run) => {
            let _ = write!(out, "\nlatest run: {run}");
        }
        Err(e) => {
            let _ = write!(out, "\nlatest run: unavailable ({e})");
        }
    }
    let desc = pr.description.as_deref().unwrap_or_default().trim();
    if !desc.is_empty() {
        let desc = if a.full == Some(true) {
            desc.to_owned()
        } else {
            clip(desc, DESC_MAX, &format!("pr_view id={id} full=true"))
        };
        let _ = write!(out, "\n\n{desc}");
    }
    Ok(out)
}

/// What the thread model can't hold: its `properties` (a `PropertiesCollection`) drops the property names.
#[derive(Deserialize)]
struct Props {
    properties: Option<Map<String, Value>>,
}

#[derive(Deserialize)]
struct List<T> {
    value: Vec<T>,
}

/// Threads the server writes itself (votes, policy and push updates) rather than a person.
fn is_system(t: &CommentThread, p: &Props) -> bool {
    p.properties
        .as_ref()
        .is_some_and(|p| p.contains_key("CodeReviewThreadType"))
        || t.comments
            .iter()
            .all(|c| matches!(c.comment_type, None | Some(CommentType::System)))
}

fn status(t: &CommentThread) -> String {
    t.status
        .as_ref()
        .map_or_else(|| "unknown".into(), ToString::to_string)
}

/// `/src/a.rs` as `src/a.rs`.
fn rel(path: &str) -> &str {
    path.trim_start_matches('/')
}

fn thread_text(t: &CommentThread) -> String {
    let mut out = format!("#{} {}", t.id.unwrap_or_default(), status(t));
    if let Some(ctx) = &t.thread_context
        && let Some(path) = &ctx.file_path
    {
        let pos = ctx
            .right_file_start
            .as_ref()
            .or(ctx.left_file_start.as_ref());
        let _ = write!(out, "  {}", rel(path));
        if let Some(n) = pos.and_then(|p| p.line) {
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
            c.author.as_ref().map_or("", name),
            text.replace('\n', "\n      ")
        );
    }
    out
}

fn unexpected(e: &serde_json::Error) -> ApiError {
    ApiError::local(format!("unexpected answer from the server: {e}"))
}

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_threads(ctx: &Ctx, a: &PrThreadsArgs) -> Result<String, ApiError> {
    let (s, pr) = find_pr(ctx, &a.at, a.id).await?;
    let (api, (repo, proj)) = (&ctx.api, ids(&s)?);
    let id = pr.pull_request_id;
    let all = a.all == Some(true);
    let limit = a.limit.unwrap_or(20).max(1);
    let body = api
        .az(|| {
            api.git
                .pull_request_threads_client()
                .list(&api.org, &repo, id, &proj)
                .send()
        })
        .await?
        .into_raw_response()
        .into_body();
    let list: GitPullRequestCommentThreadList =
        serde_json::from_slice(&body).map_err(|e| unexpected(&e))?;
    let props: List<Props> = serde_json::from_slice(&body).map_err(|e| unexpected(&e))?;
    let mut threads: Vec<CommentThread> = list
        .value
        .into_iter()
        .zip(&props.value)
        .filter_map(|(t, p)| {
            let mut t = t.comment_thread;
            t.comments.retain(|c| c.is_deleted != Some(true));
            let keep = t.is_deleted != Some(true) && !t.comments.is_empty() && !is_system(&t, p);
            keep.then_some(t)
        })
        .collect();
    let before = threads.len();
    if !all {
        threads.retain(|t| matches!(status(t).as_str(), "active" | "pending" | "unknown"));
    }
    let hidden = before - threads.len();
    let (threads, has_more) = cut(threads, limit);
    let mut lines: Vec<String> = threads.iter().map(thread_text).collect();
    if has_more {
        let all_arg = if all { " all=true" } else { "" };
        lines.push(more(&format!(
            "pr_threads id={id}{all_arg} limit={}",
            limit * 2
        )));
    }
    if hidden > 0 {
        lines.push(format!(
            "{hidden} resolved threads hidden: pr_threads id={id} all=true"
        ));
    }
    Ok(if lines.is_empty() {
        "no threads".into()
    } else {
        lines.join("\n")
    })
}

/// Whether `name` is safe to paste into a shell command.
fn plain_ref(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._/-".contains(c))
}

const MAX_FILES: u16 = 2000;

/// # Errors
/// When the scope, the PR or the server fails.
pub(crate) async fn pr_files(ctx: &Ctx, a: &PrFilesArgs) -> Result<String, ApiError> {
    let (s, pr) = find_pr(ctx, &a.at, a.id).await?;
    let (api, (repo, proj)) = (&ctx.api, ids(&s)?);
    let id = pr.pull_request_id;
    let last = api
        .az(|| {
            api.git
                .pull_request_iterations_client()
                .list(&api.org, &repo, id, &proj)
                .into_future()
        })
        .await?
        .value
        .iter()
        .filter_map(|i| i.id)
        .max()
        .ok_or_else(|| ApiError::local(format!("PR !{id} has no iterations")))?;
    let changes = api.git.pull_request_iteration_changes_client();
    let mut files = Vec::new();
    let mut skip = 0;
    loop {
        let page = api
            .az(|| {
                changes
                    .get(&api.org, &repo, id, last, &proj)
                    .top(i32::from(MAX_FILES))
                    .skip(skip)
                    .into_future()
            })
            .await?;
        let empty = page.change_entries.is_empty();
        files.extend(page.change_entries);
        skip = page.next_skip.unwrap_or(0);
        // An empty page with a `nextSkip` would repeat forever.
        if skip == 0 || empty || files.len() >= usize::from(MAX_FILES) {
            break;
        }
    }
    let has_more = files.len() > usize::from(MAX_FILES) || skip > 0;
    files.truncate(usize::from(MAX_FILES));
    let (source, target) = (ref_name(&pr.source_ref_name), ref_name(&pr.target_ref_name));
    let mut lines: Vec<String> = files
        .iter()
        .map(|f| {
            let change = &f.git_change.change;
            let path = change.item.as_ref().and_then(|i| i.get("path")?.as_str());
            format!("{}  {}", change.change_type, rel(path.unwrap_or_default()))
        })
        .collect();
    // The names come from the server and a branch name may hold shell syntax: only plain ones go in a command.
    let plain = [target, source].iter().all(|n| plain_ref(n));
    if has_more && plain {
        lines.push(more(&format!("git diff {target}...{source} --stat")));
    }
    lines.push(if plain {
        format!("diff: git diff {target}...{source}")
    } else {
        "diff: run git diff between the target and source branches".into()
    });
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn system(json: &Value) -> bool {
        let t: CommentThread = serde_json::from_value(json.clone()).unwrap();
        let p: Props = serde_json::from_value(json.clone()).unwrap();
        is_system(&t, &p)
    }

    #[test]
    fn plain_refs() {
        assert!(plain_ref("feature/login-retry_1.2"));
        for bad in ["", "-x", "x;rm -rf ~", "a$b", "a`b`", "a|b", "a&b", "a b"] {
            assert!(!plain_ref(bad), "{bad}");
        }
    }

    #[test]
    fn system_threads() {
        let sys = json!({"id": 1, "comments": [{"commentType": "system"}, {}]});
        assert!(system(&sys));
        let vote = json!({"id": 2, "properties": {"CodeReviewThreadType": {}},
            "comments": [{"commentType": "text"}]});
        assert!(system(&vote));
        let human =
            json!({"id": 3, "comments": [{"commentType": "system"}, {"commentType": "text"}]});
        assert!(!system(&human));
    }
}
