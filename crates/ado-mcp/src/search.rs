//! `search`: the server's own Search over work items, code and wiki. Scope, `infoCode`s and highlight markup are
//! resolved here.

use std::fmt::Write as _;

use azure_devops_rust_api::search::models::{
    EntitySearchRequest, EntitySearchRequestBase, WorkItemResult, WorkItemSearchRequest,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::ApiError;
use crate::ctx::{Ctx, given, seg};
use crate::out::{args, cut, html_to_text, more};

const NOT_INSTALLED: &str = "Search isn't installed or is turned off on this collection";
/// Characters of a hit's snippet line.
const SNIPPET_MAX: usize = 200;

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind {
    Code,
    Wi,
    Wiki,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Wi => "wi",
            Self::Wiki => "wiki",
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct SearchArgs {
    /// What to search: code, wi (work items) or wiki.
    pub kind: Kind,
    /// The search text, in the server's search syntax.
    pub text: String,
    /// Project name or id. Default: the whole collection.
    pub project: Option<String>,
    /// Repo name or id, for code; needs project or a clone of it.
    pub repo: Option<String>,
    /// How many hits to list. Default 20.
    pub limit: Option<u16>,
}

/// A highlight as one line of plain text: no `<highlighthit>` markers, entities decoded, at most 200 characters.
fn plain(highlight: &str) -> String {
    let text = html_to_text(
        &highlight
            .replace("<highlighthit>", "")
            .replace("</highlighthit>", ""),
    );
    let mut line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some((at, _)) = line.char_indices().nth(SNIPPET_MAX - 1) {
        line.truncate(at);
        line.push('…');
    }
    line
}

/// The line an `infoCode` adds above the hits, when it says something.
fn info(code: i32) -> Option<&'static str> {
    Some(match code {
        1 | 6 | 7 | 9 => "the search index is being rebuilt; results may be incomplete",
        2 => "search indexing hasn't started on this collection",
        3 => "the server rejected the query: invalid request",
        4 => "the server rejected the query: prefix wildcard not supported",
        5 => "the server rejected the query: several words with a code filter not supported",
        8 => "the server trimmed the results to its maximum",
        11 => "work items aren't searchable for this PAT",
        19 => "the server rejected the query: phrase with a code filter not supported",
        20 => "the server rejected the query: wildcard with a code filter not supported",
        _ => return None,
    })
}

/// The same search for `limit * 2` hits. `text` is quoted and escaped, so a phrase (`path:"a b"`) repeats exactly.
fn more_call(a: &SearchArgs, limit: usize) -> String {
    let text = serde_json::to_string(&a.text).unwrap_or_default();
    let scope = args(&[
        ("project", a.project.as_deref()),
        ("repo", a.repo.as_deref()),
    ]);
    format!(
        "search kind={} text={text}{scope} limit={}",
        a.kind.name(),
        limit * 2
    )
}

/// A string field of a work item hit; the Server 7.1 answer names them in lower case.
fn field<'a>(r: &'a WorkItemResult, k: &str) -> &'a str {
    r.fields
        .as_ref()
        .and_then(|f| f.get(k))
        .and_then(Value::as_str)
        .unwrap_or("?")
}

/// `#id [type] state  title`, then the best snippet that isn't the title (the title is on the line already).
fn wi_hit(r: &WorkItemResult) -> String {
    let mut out = format!(
        "#{} [{}] {}  {}",
        field(r, "system.id"),
        field(r, "system.workitemtype"),
        field(r, "system.state"),
        field(r, "system.title")
    );
    let not_title = r.hits.iter().find(|h| {
        !h.field_reference_name
            .as_deref()
            .is_some_and(|f| f.eq_ignore_ascii_case("system.title"))
    });
    if let Some(h) = not_title
        .or(r.hits.first())
        .and_then(|h| h.highlights.first())
    {
        let _ = write!(out, "\n  {}", plain(h));
    }
    out
}

/// # Errors
/// When the scope or the server fails; a 404 says Search is missing, or names the project.
pub(crate) async fn search(ctx: &Ctx, a: &SearchArgs) -> Result<String, ApiError> {
    let limit = usize::from(a.limit.unwrap_or(20).max(1));
    match a.kind {
        Kind::Wi => wi(ctx, a, limit).await,
        Kind::Code | Kind::Wiki => Err(ApiError::local(format!(
            "kind={} is not supported yet",
            a.kind.name()
        ))),
    }
}

async fn wi(ctx: &Ctx, a: &SearchArgs, limit: usize) -> Result<String, ApiError> {
    let named = given(a.project.as_deref());
    // No project: the whole collection, even inside a clone (local search covers the clone). The guard cuts the `//`.
    let (project, filters) = match named {
        Some(p) => {
            let s = ctx.scope(Some(p), None, None).await?;
            let filters = json!({"System.TeamProject": [s.project]});
            (seg(&s.project_id), Some(filters))
        }
        None => (String::new(), None),
    };
    let body = WorkItemSearchRequest {
        entity_search_request: EntitySearchRequest {
            entity_search_request_base: EntitySearchRequestBase {
                filters,
                search_text: Some(a.text.clone()),
            },
            top: Some(i32::try_from(limit + 1).unwrap_or(i32::MAX)),
            include_facets: Some(false),
            ..EntitySearchRequest::default()
        },
    };
    let api = &ctx.api;
    // Sent once: no `retry_stale` around a POST.
    let found = api
        .az(|| {
            api.search
                .work_item_search_results_client()
                .fetch_work_item_search_results(&api.org, body.clone(), &project)
                .into_future()
        })
        .await
        .map_err(|mut e| {
            if let Some(p) = named {
                // A stale cached project id is the likelier cause than a missing Search.
                return e.with_what(&format!("project {p}"));
            }
            if e.status == Some(404) {
                NOT_INSTALLED.clone_into(&mut e.msg);
            }
            e
        })?;
    let mut lines: Vec<String> = found
        .entity_search_response
        .info_code
        .and_then(info)
        .map(str::to_owned)
        .into_iter()
        .collect();
    lines.push(format!("{} hits", found.count.unwrap_or_default()));
    let (hits, has_more) = cut(found.results, limit);
    lines.extend(hits.iter().map(wi_hit));
    if has_more {
        lines.push(more(&more_call(a, limit)));
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_is_one_short_line() {
        let long = format!(
            "<div>a\n<highlighthit>b</highlighthit></div>{}",
            "c".repeat(300)
        );
        let line = plain(&long);
        assert!(line.starts_with("a b ccc"), "{line}");
        assert_eq!(line.chars().count(), SNIPPET_MAX);
        assert!(line.ends_with('…'));
    }

    #[test]
    fn unknown_info_codes_say_nothing() {
        for code in [0, 10, 12, -1] {
            assert_eq!(info(code), None, "{code}");
        }
    }
}
