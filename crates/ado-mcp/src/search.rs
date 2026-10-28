//! `search`: the server's own Search over work items, code and wiki. Scope, `infoCode`s and highlight markup are
//! resolved here.

use std::fmt::Write as _;

use azure_devops_rust_api::search::models::{
    CodeResult, CodeSearchRequest, EntitySearchRequest, EntitySearchRequestBase, WikiHit,
    WikiResult, WikiSearchRequest, WorkItemResult, WorkItemSearchRequest,
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
    if line.chars().count() > SNIPPET_MAX {
        line = line.chars().take(SNIPPET_MAX - 1).collect::<String>() + "…";
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

/// `#id [type] state  title`, then the best snippet that isn't the title (the title is on the line already), if any.
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
    if let Some(h) = not_title.and_then(|h| h.highlights.first()) {
        let _ = write!(out, "\n  {}", plain(h));
    }
    out
}

/// How many places in a code hit's content match: `matches.content` holds one offset each.
fn matches(m: Option<&Value>) -> usize {
    m.and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len)
}

/// `project/repo:path  (N matches)`.
fn code_hit(r: &CodeResult) -> String {
    let n = matches(r.matches.as_ref());
    format!(
        "{}/{}:{}  ({n} match{})",
        r.project
            .as_ref()
            .and_then(|p| p.name.as_deref())
            .unwrap_or("?"),
        r.repository
            .as_ref()
            .and_then(|p| p.name.as_deref())
            .unwrap_or("?"),
        r.path.as_deref().unwrap_or("?"),
        if n == 1 { "" } else { "es" }
    )
}

/// `project/wiki:path`, then the content snippet, else the first other one: a file-name hit only repeats the path.
fn wiki_hit(r: &WikiResult) -> String {
    let mut out = format!(
        "{}/{}:{}",
        r.project
            .as_ref()
            .and_then(|p| p.name.as_deref())
            .unwrap_or("?"),
        r.wiki
            .as_ref()
            .and_then(|w| w.name.as_deref())
            .unwrap_or("?"),
        r.path.as_deref().unwrap_or("?")
    );
    let on = |h: &&WikiHit, f: &str| h.field_reference_name.as_deref() == Some(f);
    let best = r
        .hits
        .iter()
        .find(|h| on(h, "content"))
        .or_else(|| r.hits.iter().find(|h| !on(h, "fileNames")));
    if let Some(h) = best.and_then(|h| h.highlights.first()) {
        let _ = write!(out, "\n  {}", plain(h));
    }
    out
}

/// A failed search: a 404 says Search is missing, or names the project too (a stale cached project id, or no
/// Search: the 404 can't tell which).
fn missing(mut e: ApiError, named: Option<&str>) -> ApiError {
    if let Some(p) = named {
        return e.with_what(&format!(
            "project {p}, or Search isn't installed on this collection"
        ));
    }
    if e.status == Some(404) {
        NOT_INSTALLED.clone_into(&mut e.msg);
    }
    e
}

/// The `infoCode` line, the count, a line per hit and the more line.
fn listed<T>(
    a: &SearchArgs,
    limit: usize,
    info_code: Option<i32>,
    count: Option<i32>,
    results: Vec<T>,
    line: fn(&T) -> String,
) -> Vec<String> {
    let mut lines: Vec<String> = info_code
        .and_then(info)
        .map(str::to_owned)
        .into_iter()
        .collect();
    // A rejected or unindexed search answers with no results: its line says why, `0 hits` would mislead.
    if lines.is_empty() || !results.is_empty() {
        let n = count
            .and_then(|c| usize::try_from(c).ok())
            .unwrap_or(results.len());
        lines.push(format!("{n} hit{}", if n == 1 { "" } else { "s" }));
    }
    let (hits, has_more) = cut(results, limit);
    lines.extend(hits.iter().map(line));
    if has_more {
        lines.push(more(&more_call(a, limit)));
    }
    lines
}

/// # Errors
/// When the scope or the server fails; a 404 says Search is missing, or names the project.
pub(crate) async fn search(ctx: &Ctx, a: &SearchArgs) -> Result<String, ApiError> {
    let limit = usize::from(a.limit.unwrap_or(20).max(1));
    let (named, repo) = (given(a.project.as_deref()), given(a.repo.as_deref()));
    if repo.is_some() && !matches!(a.kind, Kind::Code) {
        return Err(ApiError::local("repo narrows code search only"));
    }
    // Neither: the whole collection, even inside a clone (local search covers the clone). The guard cuts the `//`.
    let scope = match (named, repo) {
        (None, None) => None,
        _ => Some(ctx.scope(named, repo, None).await?),
    };
    let project = scope
        .as_ref()
        .map(|s| seg(&s.project_id))
        .unwrap_or_default();
    let filters = scope.as_ref().map(|s| match (a.kind, repo) {
        (Kind::Wi, _) => json!({"System.TeamProject": [s.project]}),
        (_, Some(r)) => json!({"Project": [s.project], "Repository": [r]}),
        _ => json!({"Project": [s.project]}),
    });
    let request = EntitySearchRequest {
        entity_search_request_base: EntitySearchRequestBase {
            filters,
            search_text: Some(a.text.clone()),
        },
        top: Some(i32::try_from(limit + 1).unwrap_or(i32::MAX)),
        include_facets: Some(false),
        ..EntitySearchRequest::default()
    };
    let api = &ctx.api;
    // Each search is sent once: no `retry_stale` around a POST.
    let lines = match a.kind {
        Kind::Wi => {
            let body = WorkItemSearchRequest {
                entity_search_request: request,
            };
            let found = api
                .az(|| {
                    api.search
                        .work_item_search_results_client()
                        .fetch_work_item_search_results(&api.org, body.clone(), &project)
                        .into_future()
                })
                .await
                .map_err(|e| missing(e, named))?;
            let info_code = found.entity_search_response.info_code;
            listed(a, limit, info_code, found.count, found.results, wi_hit)
        }
        Kind::Code => {
            let body = CodeSearchRequest {
                entity_search_request: request,
                include_snippet: None,
            };
            let found = api
                .az(|| {
                    api.search
                        .code_search_results_client()
                        .fetch_code_search_results(&api.org, body.clone(), &project)
                        .into_future()
                })
                .await
                .map_err(|e| missing(e, named))?;
            let empty = found.results.is_empty();
            let info_code = found.entity_search_response.info_code;
            let mut lines = listed(a, limit, info_code, found.count, found.results, code_hit);
            if let (true, Some(r), Some(id)) = (empty, repo, scope.and_then(|s| s.repo_id))
                && unindexed(ctx, &project, &id).await
            {
                lines.push(format!("{r} isn't indexed by Search yet"));
            }
            lines
        }
        Kind::Wiki => {
            let body = WikiSearchRequest {
                entity_search_request: request,
            };
            let found = api
                .az(|| {
                    api.search
                        .wiki_search_results_client()
                        .fetch_wiki_search_results(&api.org, body.clone(), &project)
                        .into_future()
                })
                .await
                .map_err(|e| missing(e, named))?;
            let info_code = found.entity_search_response.info_code;
            listed(a, limit, info_code, found.count, found.results, wiki_hit)
        }
    };
    Ok(lines.join("\n"))
}

/// Whether Search has no branch of the repo indexed, or doesn't know the repo. Any other failure says nothing.
async fn unindexed(ctx: &Ctx, project: &str, repo_id: &str) -> bool {
    let api = &ctx.api;
    // The crate puts both into the URL raw: `project` is a segment already, `repo_id` a GUID.
    let status = api
        .az(|| {
            api.search
                .repositories_client()
                .get(&api.org, project, repo_id)
                .into_future()
        })
        .await;
    match status {
        Ok(s) => s.indexed_branches.is_empty(),
        Err(e) => e.status == Some(404),
    }
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
    fn plain_keeps_200_characters_whole() {
        let line = plain(&"c".repeat(SNIPPET_MAX));
        assert_eq!(line, "c".repeat(SNIPPET_MAX));
        let line = plain(&"c".repeat(SNIPPET_MAX + 1));
        assert_eq!(line, "c".repeat(SNIPPET_MAX - 1) + "…");
    }

    #[test]
    fn matches_counts_content_offsets() {
        let m = json!({"content": [{"charOffset": 1}, {"charOffset": 9}], "fileName": [{"charOffset": 0}]});
        assert_eq!(matches(Some(&m)), 2);
        assert_eq!(matches(Some(&json!({"fileName": []}))), 0);
        assert_eq!(matches(None), 0);
    }

    #[test]
    fn unknown_info_codes_say_nothing() {
        for code in [0, 10, 12, -1] {
            assert_eq!(info(code), None, "{code}");
        }
    }
}
