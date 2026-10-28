//! The work item tools: the reads `wi_view` and `wi_query`, and the writes `wi_create`, `wi_update` and `wi_comment`.

use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

use azure_devops_rust_api::wit::models::{
    CommentCreate, CommentSortOrder, JsonPatchOperation, Wiql, WorkItem, WorkItemBatchGetRequest,
    WorkItemExpand, json_patch_operation::Op, work_item_batch_get_request::ErrorPolicy,
    work_item_query_result::QueryResultType,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{ApiError, json};
use crate::ctx::{Ctx, given, seg};
use crate::out::{DESC_MAX, args, clip, cut, html_to_text, more};
use crate::remote::decode_path;

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiViewArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Work item id.
    pub id: u32,
    /// Show the whole description, acceptance criteria and comments instead of the first 4000 characters, and up
    /// to 200 comments instead of the last 5.
    pub full: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiQueryArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// A raw WIQL query; the filters below are ignored when it is given.
    pub wiql: Option<String>,
    /// Assigned to: `me` or a display name.
    pub assigned: Option<String>,
    /// State, such as Active.
    pub state: Option<String>,
    /// Work item type, such as Bug.
    pub r#type: Option<String>,
    /// Text in the title.
    pub title: Option<String>,
    /// How many to list. Default 20.
    pub limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiCreateArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Work item type, such as Bug, Task or User Story.
    pub r#type: String,
    pub title: String,
    /// The description (HTML).
    pub description: Option<String>,
    /// Assignee: `me` or a display name.
    pub assigned: Option<String>,
    /// The parent work item's id.
    pub parent: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiUpdateArgs {
    /// Work item id (unique in the collection, so no project).
    pub id: u32,
    /// New state, such as Active or Resolved.
    pub state: Option<String>,
    /// New assignee: `me` or a display name.
    pub assigned: Option<String>,
    pub title: Option<String>,
    /// Any other fields, by reference name (`Microsoft.VSTS.Common.Priority`, `Custom.Team`) → value.
    pub fields: Option<BTreeMap<String, Value>>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiCommentArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Work item id.
    pub id: u32,
    /// The comment (HTML).
    pub text: String,
}

/// A string field, or `?`.
fn field<'a>(w: &'a WorkItem, k: &str) -> &'a str {
    w.fields.get(k).and_then(Value::as_str).unwrap_or("?")
}

/// The assignee's display name, or `nobody`.
fn assignee(w: &WorkItem) -> &str {
    w.fields.get("System.AssignedTo").map_or("nobody", |v| {
        v.get("displayName").unwrap_or(v).as_str().unwrap_or("?")
    })
}

/// `#{id} {type} {state}  "{title}"`
fn head(w: &WorkItem) -> String {
    format!(
        "#{} {} {}  \"{}\"",
        w.id,
        field(w, "System.WorkItemType"),
        field(w, "System.State"),
        field(w, "System.Title")
    )
}

/// The last number in a link's url: `…/workItems/100` and `vstfs:///Git/PullRequestId/{p}%2F{r}%2F412` alike.
fn last_id(url: &str) -> Option<u32> {
    url.rsplit(['/', 'F']).next()?.parse().ok()
}

/// `#a, #b` (or `!a, !b`) of the relations of type `rel` whose url contains `needle`.
fn links(w: &WorkItem, mark: char, rel: &str, needle: &str) -> String {
    let ids: Vec<String> = w
        .relations
        .iter()
        .filter(|r| r.link.rel == rel && r.link.url.contains(needle))
        .filter_map(|r| last_id(&r.link.url))
        .map(|id| format!("{mark}{id}"))
        .collect();
    ids.join(", ")
}

/// The hierarchy rels, which `wi_view` shows as parent and children.
const PARENT: &str = "System.LinkTypes.Hierarchy-Reverse";
const CHILD: &str = "System.LinkTypes.Hierarchy-Forward";

/// The `rest` of a git artifact link `vstfs:///Git/{kind}/{project}%2F{repo}%2F{rest}`, percent-decoded.
fn git_artifact(url: &str, kind: &str) -> Option<String> {
    let id = decode_path(url.strip_prefix(&format!("vstfs:///Git/{kind}/"))?);
    let mut parts = id.splitn(3, '/');
    let (proj, repo, rest) = (parts.next()?, parts.next()?, parts.next()?);
    (!proj.is_empty() && !repo.is_empty() && !rest.is_empty()).then(|| rest.to_owned())
}

/// The links after parent, children and PRs: work item links grouped by the server's name for them, commits by short
/// sha, branches by name, and hyperlinks and attachments only counted, since their URLs stay out of the reply.
fn other_links(w: &WorkItem) -> Vec<String> {
    let mut named: Vec<(&str, Vec<String>)> = Vec::new();
    let (mut commits, mut branches) = (Vec::new(), Vec::new());
    let (mut hyperlinks, mut files) = (0, 0);
    for r in &w.relations {
        let (rel, url) = (r.link.rel.as_str(), r.link.url.as_str());
        match rel {
            "Hyperlink" => hyperlinks += 1,
            "AttachedFile" => files += 1,
            "ArtifactLink" => {
                if let Some(sha) = git_artifact(url, "Commit")
                    && sha.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    commits.push(sha.get(..8).unwrap_or(&sha).to_owned());
                } else if let Some(r) = git_artifact(url, "Ref")
                    && let Some(name) = r.strip_prefix("GB").filter(|n| !n.is_empty())
                {
                    branches.push(name.to_owned());
                }
            }
            PARENT | CHILD => {}
            _ if url.to_ascii_lowercase().contains("/_apis/wit/workitems/") => {
                let Some(id) = last_id(url) else { continue };
                // Without a name, the rel's last word: `System.LinkTypes.Related` reads `Related`.
                let name = r
                    .link
                    .attributes
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| rel.rsplit_once('.').map_or(rel, |(_, w)| w));
                match named.iter_mut().find(|(n, _)| *n == name) {
                    Some((_, ids)) => ids.push(format!("#{id}")),
                    None => named.push((name, vec![format!("#{id}")])),
                }
            }
            _ => {}
        }
    }
    let mut out: Vec<String> = named
        .into_iter()
        .map(|(name, ids)| format!("{name}: {}", ids.join(", ")))
        .collect();
    for (title, list) in [("commits", commits), ("branches", branches)] {
        if !list.is_empty() {
            out.push(format!("{title}: {}", list.join(", ")));
        }
    }
    let counts: Vec<String> = [("links", hyperlinks), ("attachments", files)]
        .into_iter()
        .filter(|&(_, n)| n > 0)
        .map(|(title, n)| format!("{title}: {n}"))
        .collect();
    if !counts.is_empty() {
        out.push(counts.join("  "));
    }
    out
}

/// Rich text as plain text, cut after the conversion so the cut counts readable characters; `whole` is the call
/// that shows it all.
fn text(html: &str, full: bool, whole: &str) -> String {
    let t = html_to_text(html);
    if full { t } else { clip(&t, DESC_MAX, whole) }
}

/// A work item's comments, read by hand: the server sends mentions without the `url` the crate's `CommentMention`
/// (inside `CommentList`) requires. `comments` must be there, as `null` or a list, so a body of another shape reads
/// as unavailable rather than as no comments.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComments {
    total_count: Option<usize>,
    #[serde(deserialize_with = "null_as_empty")]
    comments: Vec<RawComment>,
}

/// One comment: only what `comments` shows.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComment {
    text: Option<String>,
    created_by: Option<Author>,
    created_date: Option<String>,
}

/// A comment's author.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Author {
    display_name: Option<String>,
}

/// `null` as an empty list, as the crate's models read it.
fn null_as_empty<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Vec<T>, D::Error> {
    Ok(Option::<Vec<T>>::deserialize(d)?.unwrap_or_default())
}

/// The `2026-03-05` of an RFC 3339 time in UTC, else `?`.
fn day(time: Option<&str>) -> &str {
    let d = time.map_or("", |t| t.split_once('T').map_or(t, |(d, _)| d));
    let b = d.as_bytes();
    let shaped = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if shaped { d } else { "?" }
}

fn comments(list: &RawComments, full: bool, whole: &str) -> String {
    let mut out = String::from("comments:");
    for c in &list.comments {
        let date = day(c.created_date.as_deref());
        let author = c
            .created_by
            .as_ref()
            .and_then(|a| a.display_name.as_deref());
        let body = text(c.text.as_deref().unwrap_or_default(), full, whole);
        let _ = write!(
            out,
            "\n  {date} {}: {}",
            author.unwrap_or("?"),
            body.replace('\n', "\n    ")
        );
    }
    let total = list.total_count.unwrap_or_default();
    let older = total.saturating_sub(list.comments.len());
    // A `full` call fetched the most it can: there is no bigger call to name.
    if older > 0 && full {
        let _ = write!(out, "\n  … {older} older comments");
    } else if older > 0 {
        let _ = write!(out, "\n  … {older} older comments: {whole}");
    }
    out
}

/// The item as `wi_view` shows it, up to its comments: head, assignment, links, description and acceptance criteria.
fn item_text(item: &WorkItem, full: bool, whole: &str) -> String {
    let mut out = head(item);
    let _ = write!(
        out,
        "\nassigned: {}  area: {}  iteration: {}",
        assignee(item),
        field(item, "System.AreaPath"),
        field(item, "System.IterationPath")
    );
    for (title, mark, rel, needle) in [
        ("parent", '#', PARENT, ""),
        ("children", '#', CHILD, ""),
        ("PRs", '!', "ArtifactLink", "PullRequestId"),
    ] {
        let ids = links(item, mark, rel, needle);
        if !ids.is_empty() {
            let _ = write!(out, "\n{title}: {ids}");
        }
    }
    for line in other_links(item) {
        let _ = write!(out, "\n{line}");
    }
    for (label, f) in [
        ("", "System.Description"),
        (
            "acceptance criteria:\n",
            "Microsoft.VSTS.Common.AcceptanceCriteria",
        ),
    ] {
        let html = item.fields.get(f).and_then(Value::as_str);
        if let Some(t) = html.map(|h| text(h, full, whole)).filter(|t| !t.is_empty()) {
            let _ = write!(out, "\n\n{label}{t}");
        }
    }
    out
}

/// # Errors
/// When the scope, the work item or the server fails.
pub(crate) async fn wi_view(ctx: &Ctx, a: &WiViewArgs) -> Result<String, ApiError> {
    let id = a.id;
    let num = wi_id(id)?;
    let full = a.full == Some(true);
    let whole = format!(
        "wi_view id={id}{} full=true",
        args(&[("project", a.project.as_deref())])
    );
    let top = if full { 200 } else { 5 };
    let scope = match ctx.scope(a.project.as_deref(), None, None).await {
        Ok(s) => Some(s),
        // The clone names no project of this collection, and no project was passed: the item is collection-wide and
        // names its own project.
        Err(e) if given(a.project.as_deref()).is_none() && e.status.is_none() => None,
        Err(e) => return Err(e),
    };
    let api = &ctx.api;
    let comments_in = |proj: String| async move {
        let raw = api
            .az(|| {
                api.wit
                    .comments_client()
                    .get_comments(&api.org, &proj, num)
                    .top(top)
                    .order(CommentSortOrder::Desc)
                    .send()
            })
            .await?
            .into_raw_response()
            .into_body();
        json::<RawComments>(&raw)
    };
    // No project: an id is unique in the collection. The guard cuts the `//` this leaves.
    let fetch = api.az(|| {
        api.wit
            .work_items_client()
            .get_work_item(&api.org, num, "")
            .expand(WorkItemExpand::Relations)
            .into_future()
    });
    let (got, first) = match &scope {
        Some(s) => {
            let (got, notes) = tokio::join!(fetch, comments_in(seg(&s.project_id)));
            (got, Some(notes))
        }
        None => (fetch.await, None),
    };
    let item = got.map_err(|e| e.with_what(&format!("work item #{id}")))?;
    // The comments path needs the item's own project, which only the item names.
    let home = item
        .fields
        .get("System.TeamProject")
        .and_then(Value::as_str);
    let notes = match (first, home) {
        (None, Some(home)) => comments_in(seg(home)).await,
        (None, None) => Err(ApiError::local("the work item names no project")),
        (Some(Err(e)), Some(home))
            if e.status == Some(404) && scope.as_ref().is_some_and(|s| s.project != home) =>
        {
            comments_in(seg(home)).await
        }
        (Some(notes), _) => notes,
    };
    let mut out = item_text(&item, full, &whole);
    match notes {
        Ok(list) if list.comments.is_empty() => {}
        Ok(list) => {
            let _ = write!(out, "\n\n{}", comments(&list, full, &whole));
        }
        Err(e) => {
            let _ = write!(out, "\n\ncomments: unavailable ({e})");
        }
    }
    Ok(out)
}

/// A WIQL string literal.
fn lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The WIQL the filters ask for.
fn build_wiql(a: &WiQueryArgs) -> String {
    let mut q =
        String::from("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project");
    if let Some(u) = given(a.assigned.as_deref()) {
        let who = if u.eq_ignore_ascii_case("me") {
            "@Me".into()
        } else {
            lit(u)
        };
        let _ = write!(q, " AND [System.AssignedTo] = {who}");
    }
    for (f, v) in [
        ("System.State", &a.state),
        ("System.WorkItemType", &a.r#type),
    ] {
        if let Some(v) = given(v.as_deref()) {
            let _ = write!(q, " AND [{f}] = {}", lit(v));
        }
    }
    if let Some(t) = given(a.title.as_deref()) {
        let _ = write!(q, " AND [System.Title] CONTAINS {}", lit(t));
    }
    q.push_str(" ORDER BY [System.ChangedDate] DESC");
    q
}

/// The same call for the next page.
fn next_call(a: &WiQueryArgs, limit: usize) -> String {
    let mut call = String::from("wi_query");
    if given(a.wiql.as_deref()).is_some() {
        call.push_str(" (the same wiql)");
    }
    call += &args(&[
        ("project", a.project.as_deref()),
        ("assigned", a.assigned.as_deref()),
        ("state", a.state.as_deref()),
        ("type", a.r#type.as_deref()),
        ("title", a.title.as_deref()),
    ]);
    let _ = write!(call, " limit={}", limit * 2);
    call
}

/// What the batch answers: with `errorPolicy=omit`, a missing item is a `null`, which the crate's list can't hold.
#[derive(Deserialize)]
struct Batch {
    value: Vec<Option<WorkItem>>,
}

/// # Errors
/// When the scope, the query or the server fails.
pub(crate) async fn wi_query(ctx: &Ctx, a: &WiQueryArgs) -> Result<String, ApiError> {
    let limit = a.limit.unwrap_or(20).max(1);
    let top = i32::try_from(limit.saturating_add(1)).unwrap_or(i32::MAX);
    let wiql = given(a.wiql.as_deref()).map_or_else(|| build_wiql(a), str::to_owned);
    let body = Wiql { query: Some(wiql) };
    let api = &ctx.api;
    let first = ctx.scope(a.project.as_deref(), None, None).await?;
    let (proj, found) = ctx
        .retry_stale(&first.key, || async {
            let proj = seg(&ctx
                .scope(a.project.as_deref(), None, None)
                .await?
                .project_id);
            // No team: the guard cuts the `//` this leaves.
            let found = api
                .az(|| {
                    api.wit
                        .wiql_client()
                        .query_by_wiql(&api.org, body.clone(), &proj, "")
                        .top(top)
                        .into_future()
                })
                .await?;
            Ok((proj, found))
        })
        .await?;
    if found.query_result_type == Some(QueryResultType::WorkItemLink)
        || !found.work_item_relations.is_empty()
    {
        return Err(ApiError::local(
            "link queries are not supported; use FROM WorkItems",
        ));
    }
    let ids: Vec<i32> = found.work_items.iter().filter_map(|r| r.id).collect();
    let (ids, has_more) = cut(ids, limit);
    let mut items = Vec::new();
    for chunk in ids.chunks(200) {
        let req = WorkItemBatchGetRequest {
            ids: chunk.to_vec(),
            fields: [
                "System.Id",
                "System.WorkItemType",
                "System.State",
                "System.Title",
                "System.AssignedTo",
            ]
            .map(String::from)
            .into(),
            error_policy: Some(ErrorPolicy::Omit),
            ..WorkItemBatchGetRequest::default()
        };
        let raw = api
            .az(|| {
                api.wit
                    .work_items_client()
                    .get_work_items_batch(&api.org, req.clone(), &proj)
                    .send()
            })
            .await?
            .into_raw_response()
            .into_body();
        let batch: Batch = json(&raw)?;
        items.extend(batch.value.into_iter().flatten());
    }
    // The batch needn't answer in the order asked; the query's order is the one that counts.
    let rank: HashMap<i32, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    items.sort_by_key(|w| rank.get(&w.id).copied());
    let mut lines: Vec<String> = items
        .iter()
        .map(|w| format!("{}  {}", head(w), assignee(w)))
        .collect();
    if has_more {
        lines.push(more(&next_call(a, limit)));
    }
    Ok(if lines.is_empty() {
        "no work items".into()
    } else {
        lines.join("\n")
    })
}

fn wi_id(id: u32) -> Result<i32, ApiError> {
    i32::try_from(id).map_err(|_| ApiError::local(format!("not found: work item #{id}")))
}

/// A field reference name such as `System.Title` or `Custom.Team_Name`: two or more `.`-separated words of ASCII
/// letters, digits and `_`, so nothing can end the JSON Patch path.
fn field_name(k: &str) -> bool {
    let mut parts = k.split('.');
    let word = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    parts.clone().count() >= 2 && parts.all(word)
}

fn add(path: String, value: Value) -> JsonPatchOperation {
    JsonPatchOperation {
        op: Some(Op::Add),
        path: Some(path),
        value: Some(value),
        from: None,
    }
}

/// The assignee as the server takes it: the one matching user's display name.
async fn assignee_name(ctx: &Ctx, who: Option<&str>) -> Result<Option<Value>, ApiError> {
    Ok(match given(who) {
        Some(u) => Some(Value::String(ctx.user(u).await?.name)),
        None => None,
    })
}

/// # Errors
/// When the assignee, the scope or the server fails.
pub(crate) async fn wi_create(ctx: &Ctx, a: &WiCreateArgs) -> Result<String, ApiError> {
    let kind = given(Some(&a.r#type)).ok_or_else(|| ApiError::local("no type: pass type"))?;
    if given(Some(&a.title)).is_none() {
        return Err(ApiError::local("no title: pass title"));
    }
    let mut ops = vec![add("/fields/System.Title".into(), json!(a.title))];
    if let Some(d) = &a.description {
        ops.push(add("/fields/System.Description".into(), json!(d)));
    }
    if let Some(who) = assignee_name(ctx, a.assigned.as_deref()).await? {
        ops.push(add("/fields/System.AssignedTo".into(), who));
    }
    if let Some(p) = a.parent {
        let url = format!("{}_apis/wit/workItems/{p}", ctx.cfg.org_url);
        let rel = json!({"rel": "System.LinkTypes.Hierarchy-Reverse", "url": url});
        ops.push(add("/relations/-".into(), rel));
    }
    let proj = seg(&ctx
        .scope(a.project.as_deref(), None, None)
        .await?
        .project_id);
    let api = &ctx.api;
    let item = api
        .az(|| {
            api.wit
                .work_items_client()
                .create(&api.org, ops.clone(), &proj, seg(kind))
                .into_future()
        })
        .await
        .map_err(|e| e.with_what(&format!("work item type {kind}")))?;
    Ok(format!("created #{} {kind} \"{}\"", item.id, a.title))
}

/// # Errors
/// When nothing or a bad field name is given, or the assignee, the work item or the server fails.
pub(crate) async fn wi_update(ctx: &Ctx, a: &WiUpdateArgs) -> Result<String, ApiError> {
    let mut fields = a.fields.clone().unwrap_or_default();
    if let Some(k) = fields.keys().find(|k| !field_name(k)) {
        return Err(ApiError::local(format!("bad field name: {k}")));
    }
    for (k, v) in [("System.State", &a.state), ("System.Title", &a.title)] {
        if let Some(v) = v {
            fields.insert(k.into(), json!(v));
        }
    }
    if fields.is_empty() && given(a.assigned.as_deref()).is_none() {
        return Err(ApiError::local(
            "nothing to update: give state, assigned, title or fields",
        ));
    }
    let num = wi_id(a.id)?;
    if let Some(who) = assignee_name(ctx, a.assigned.as_deref()).await? {
        fields.insert("System.AssignedTo".into(), who);
    }
    let names: Vec<&str> = fields.keys().map(String::as_str).collect();
    let names = names.join(", ");
    let ops: Vec<JsonPatchOperation> = fields
        .into_iter()
        .map(|(k, v)| add(format!("/fields/{k}"), v))
        .collect();
    let api = &ctx.api;
    // No project: an id is unique in the collection, so an item in any project updates. The guard cuts the `//`.
    api.az(|| {
        api.wit
            .work_items_client()
            .update(&api.org, ops.clone(), num, "")
            .into_future()
    })
    .await
    .map_err(|e| e.with_what(&format!("work item #{}", a.id)))?;
    Ok(format!("updated #{}: {names}", a.id))
}

/// # Errors
/// When the scope, the work item or the server fails.
pub(crate) async fn wi_comment(ctx: &Ctx, a: &WiCommentArgs) -> Result<String, ApiError> {
    let num = wi_id(a.id)?;
    let proj = seg(&ctx
        .scope(a.project.as_deref(), None, None)
        .await?
        .project_id);
    let body = CommentCreate {
        text: Some(a.text.clone()),
    };
    let api = &ctx.api;
    api.az(|| {
        api.wit
            .comments_client()
            .add_comment(&api.org, body.clone(), &proj, num)
            // Not decoded: the crate's `Comment` holds `CommentMention`s, which require a `url` the server leaves out.
            .send()
    })
    .await
    // The comments path needs the item's project; a retry elsewhere would send the write twice.
    .map_err(|e| {
        let id = a.id;
        e.with_what(&format!(
            "work item #{id} (if #{id} is in another project, pass project)"
        ))
    })?;
    Ok(format!("commented on #{}", a.id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_day() {
        assert_eq!(day(Some("2026-03-06T09:00:00.123Z")), "2026-03-06");
        assert_eq!(day(Some("2026-03-06")), "2026-03-06");
        for bad in [
            None,
            Some(""),
            Some("T09:00"),
            Some("yesterday"),
            Some("2026-3-6T09:00Z"),
        ] {
            assert_eq!(day(bad), "?", "{bad:?}");
        }
    }

    #[test]
    fn field_names() {
        for good in [
            "System.Title",
            "Custom.Team_Name",
            "Microsoft.VSTS.Common.Priority",
        ] {
            assert!(field_name(good), "{good}");
        }
        for bad in [
            "",
            "a/b",
            "a b",
            "x~1",
            "-",
            "a\"b",
            "Ünter",
            ".",
            "..",
            ".Title",
            "System..Title",
            "_",
            "System.",
            "Title",
        ] {
            assert!(!field_name(bad), "{bad}");
        }
    }

    fn item_with(relations: &[Value]) -> WorkItem {
        serde_json::from_value(json!({"id": 1, "fields": {}, "url": "u", "relations": relations}))
            .unwrap()
    }

    fn rel(rel: &str, url: &str, attributes: &Value) -> Value {
        json!({"rel": rel, "url": url, "attributes": attributes})
    }

    const WI: &str = "http://dev.example/tfs/Coll/_apis/wit/workItems/";
    const IDS: &str =
        "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455%2F3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01%2F";

    #[test]
    fn other_links_by_kind() {
        let named = |n: &str| json!({"isLocked": false, "name": n});
        let w = item_with(&[
            rel(
                "System.LinkTypes.Related",
                &format!("{WI}4"),
                &named("Related"),
            ),
            rel(
                "System.LinkTypes.Hierarchy-Reverse",
                &format!("{WI}100"),
                &named("Parent"),
            ),
            rel(
                "System.LinkTypes.Hierarchy-Forward",
                &format!("{WI}101"),
                &named("Child"),
            ),
            rel(
                "System.LinkTypes.Duplicate-Reverse",
                &format!("{WI}7"),
                &named("Duplicate Of"),
            ),
            rel(
                "Microsoft.VSTS.Common.TestedBy-Forward",
                &format!("{WI}12"),
                &named("Tested By"),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Commit/{IDS}2d9e7b10aa55c3"),
                &named("Fixed in Commit"),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Ref/{IDS}GBfeature%2Fx"),
                &named("Branch"),
            ),
            rel(
                "ArtifactLink",
                "vstfs:///Git/Commit/garbage",
                &named("Fixed in Commit"),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/PullRequestId/{IDS}412"),
                &named("Pull Request"),
            ),
            rel(
                "System.LinkTypes.Related",
                &format!("{WI}9"),
                &named("Related"),
            ),
            rel(
                "AttachedFile",
                "http://dev.example/tfs/Coll/_apis/wit/attachments/0a1b?fileName=a.png",
                &named("a.png"),
            ),
            rel(
                "AttachedFile",
                "http://dev.example/tfs/Coll/_apis/wit/attachments/2c3d",
                &named("b.txt"),
            ),
            rel("Hyperlink", "https://example.com/doc", &json!({})),
        ]);
        let got = other_links(&w);
        assert_eq!(
            got,
            [
                "Related: #4, #9",
                "Duplicate Of: #7",
                "Tested By: #12",
                "commits: 2d9e7b10",
                "branches: feature/x",
                "links: 1  attachments: 2",
            ]
        );
        let all = got.join("\n");
        assert!(!all.contains("vstfs") && !all.contains("http"), "{all}");
    }

    /// A link without a `name` goes by its rel's last word; artifact links that don't parse, or aren't a commit or a
    /// branch, are left out; a lone count stands alone.
    #[test]
    fn other_links_edges() {
        let w = item_with(&[
            rel(
                "System.LinkTypes.Dependency-Forward",
                &format!("{WI}5"),
                &json!({"isLocked": false}),
            ),
            rel(
                "System.LinkTypes.Related",
                "http://x/_apis/wit/workItems/abc",
                &json!({"name": "Related"}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Commit/{IDS}zz12"),
                &json!({}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Commit/{IDS}"),
                &json!({}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Ref/{IDS}GTv1.0"),
                &json!({}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Ref/{IDS}GB"),
                &json!({}),
            ),
            rel("ArtifactLink", "vstfs:///Build/Build/17", &json!({})),
            rel(
                "AttachedFile",
                "http://x/_apis/wit/attachments/1",
                &json!(null),
            ),
        ]);
        assert_eq!(
            other_links(&w),
            ["Dependency-Forward: #5", "attachments: 1"]
        );
        assert_eq!(other_links(&item_with(&[])), Vec::<String>::new());
    }

    /// A work item url in any case; a short sha whole; a branch decoded as UTF-8, a byte that isn't as U+FFFD.
    #[test]
    fn other_links_case_short_sha_and_utf8() {
        let w = item_with(&[
            rel(
                "System.LinkTypes.Related",
                "http://dev.example/tfs/Coll/_apis/wit/workitems/6",
                &json!({"name": "Related"}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Commit/{IDS}abc12"),
                &json!({}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Ref/{IDS}GBf%C3%BCr"),
                &json!({}),
            ),
            rel(
                "ArtifactLink",
                &format!("vstfs:///Git/Ref/{IDS}GB%FF"),
                &json!({}),
            ),
        ]);
        assert_eq!(
            other_links(&w),
            ["Related: #6", "commits: abc12", "branches: für, \u{FFFD}"]
        );
    }

    #[test]
    fn last_ids() {
        assert_eq!(last_id("http://x/_apis/wit/workItems/100"), Some(100));
        assert_eq!(last_id("vstfs:///Git/PullRequestId/p%2Fr%2F412"), Some(412));
        assert_eq!(last_id("vstfs:///Git/Commit/p%2Fr%2Fabc"), None);
    }
}
