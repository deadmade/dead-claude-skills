//! The work item read tools: `wi_view` and `wi_query`.

use std::fmt::Write as _;

use azure_devops_rust_api::wit::models::{
    CommentList, CommentSortOrder, Wiql, WorkItem, WorkItemBatchGetRequest, WorkItemExpand,
    work_item_batch_get_request::ErrorPolicy,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::Value;

use crate::api::ApiError;
use crate::ctx::{Ctx, given, seg};
use crate::out::{DESC_MAX, clip, cut, html_to_text, more};

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WiViewArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Work item id.
    pub id: u32,
    /// Show the whole description, acceptance criteria and comments instead of the first 4000 characters.
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

/// Rich text as plain text, cut after the conversion so the cut counts readable characters.
fn text(html: &str, full: bool, id: i32) -> String {
    let t = html_to_text(html);
    if full {
        t
    } else {
        clip(&t, DESC_MAX, &format!("wi_view id={id} full=true"))
    }
}

fn comments(list: &CommentList, full: bool, id: i32) -> String {
    let mut out = String::from("comments:");
    for c in &list.comments {
        let date = c
            .created_date
            .map_or_else(|| "?".into(), |t| t.date().to_string());
        let author = c
            .created_by
            .as_ref()
            .and_then(|a| a.graph_subject_base.display_name.as_deref());
        let body = text(c.text.as_deref().unwrap_or_default(), full, id);
        let _ = write!(
            out,
            "\n  {date} {}: {}",
            author.unwrap_or("?"),
            body.replace('\n', "\n    ")
        );
    }
    let total = usize::try_from(list.total_count.unwrap_or_default()).unwrap_or_default();
    let older = total.saturating_sub(list.comments.len());
    if older > 0 {
        let _ = write!(out, "\n  … {older} older comments");
    }
    out
}

/// # Errors
/// When the scope, the work item or the server fails.
pub(crate) async fn wi_view(ctx: &Ctx, a: &WiViewArgs) -> Result<String, ApiError> {
    let id = a.id;
    let num =
        i32::try_from(id).map_err(|_| ApiError::local(format!("not found: work item #{id}")))?;
    let full = a.full == Some(true);
    let scope = ctx.scope(a.project.as_deref(), None, None).await?;
    let (api, proj) = (&ctx.api, seg(&scope.project_id));
    let (got, notes) = tokio::join!(
        // No project: an id is unique in the collection. The guard cuts the `//` this leaves.
        api.az(|| {
            api.wit
                .work_items_client()
                .get_work_item(&api.org, num, "")
                .expand(WorkItemExpand::Relations)
                .into_future()
        }),
        api.az(|| {
            api.wit
                .comments_client()
                .get_comments(&api.org, &proj, num)
                .top(5)
                .order(CommentSortOrder::Desc)
                .into_future()
        })
    );
    let item = got.map_err(|e| e.with_what(&format!("work item #{id}")))?;
    let mut out = head(&item);
    let _ = write!(
        out,
        "\nassigned: {}  area: {}  iteration: {}",
        assignee(&item),
        field(&item, "System.AreaPath"),
        field(&item, "System.IterationPath")
    );
    for (title, mark, rel, needle) in [
        ("parent", '#', "System.LinkTypes.Hierarchy-Reverse", ""),
        ("children", '#', "System.LinkTypes.Hierarchy-Forward", ""),
        ("PRs", '!', "ArtifactLink", "PullRequestId"),
    ] {
        let ids = links(&item, mark, rel, needle);
        if !ids.is_empty() {
            let _ = write!(out, "\n{title}: {ids}");
        }
    }
    for (label, f) in [
        ("", "System.Description"),
        (
            "acceptance criteria:\n",
            "Microsoft.VSTS.Common.AcceptanceCriteria",
        ),
    ] {
        let html = item.fields.get(f).and_then(Value::as_str);
        if let Some(t) = html.map(|h| text(h, full, num)).filter(|t| !t.is_empty()) {
            let _ = write!(out, "\n\n{label}{t}");
        }
    }
    match notes {
        Ok(list) if list.comments.is_empty() => {}
        Ok(list) => {
            let _ = write!(out, "\n\n{}", comments(&list, full, num));
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
    q
}

/// The same call for the next page.
fn next_call(a: &WiQueryArgs, limit: usize) -> String {
    let mut call = String::from("wi_query");
    if given(a.wiql.as_deref()).is_some() {
        call.push_str(" (the same wiql)");
    }
    let args = [
        ("project", &a.project),
        ("assigned", &a.assigned),
        ("state", &a.state),
        ("type", &a.r#type),
        ("title", &a.title),
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
    let s = ctx.scope(a.project.as_deref(), None, None).await?;
    let (api, proj) = (&ctx.api, seg(&s.project_id));
    let body = Wiql { query: Some(wiql) };
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
    let ids: Vec<i32> = found.work_items.iter().filter_map(|r| r.id).collect();
    let (ids, has_more) = cut(ids, limit);
    let mut lines = Vec::new();
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
        let batch: Batch = serde_json::from_slice(&raw)
            .map_err(|e| ApiError::local(format!("unexpected answer from the server: {e}")))?;
        lines.extend(
            batch
                .value
                .iter()
                .flatten()
                .map(|w| format!("{}  {}", head(w), assignee(w))),
        );
    }
    if has_more {
        lines.push(more(&next_call(a, limit)));
    }
    Ok(if lines.is_empty() {
        "no work items".into()
    } else {
        lines.join("\n")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_ids() {
        assert_eq!(last_id("http://x/_apis/wit/workItems/100"), Some(100));
        assert_eq!(last_id("vstfs:///Git/PullRequestId/p%2Fr%2F412"), Some(412));
        assert_eq!(last_id("vstfs:///Git/Commit/p%2Fr%2Fabc"), None);
    }
}
