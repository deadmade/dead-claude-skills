//! `search`: the server's own Search over work items, code and wiki. Scope, `infoCode`s and highlight markup are
//! resolved here.

use std::fmt::Write as _;

use azure_devops_rust_api::search::models::{
    CodeResult, CodeSearchRequest, EntitySearchRequest, EntitySearchRequestBase, WikiResult,
    WikiSearchRequest, WorkItemResult, WorkItemSearchRequest,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::ApiError;
use crate::ctx::{Ctx, given, seg};
use crate::out::{args, cut, doubled, html_to_text, more};
use crate::remote::decode_path;

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
    /// Repo name, for code; needs project or a clone of it.
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

/// The same search for twice `limit` hits (`doubled`). `text` is quoted and escaped, so a phrase (`path:"a b"`)
/// repeats exactly.
fn more_call(a: &SearchArgs, limit: usize) -> String {
    let text = serde_json::to_string(&a.text).unwrap_or_default();
    let scope = args(&[
        ("project", a.project.as_deref()),
        ("repo", a.repo.as_deref()),
    ]);
    format!(
        "search kind={} text={text}{scope} limit={}",
        a.kind.name(),
        doubled(limit)
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

/// The page path the wiki tool takes, from a hit's git file path: a code wiki's folder `mapped` (any case) cut from
/// the front, `.md` cut, then in each segment `-` read as a space and percent-decoded (the wiki stores a literal `-`
/// as `%2D`). A segment that isn't UTF-8 decoded keeps it raw.
fn page_path(file_path: &str, mapped: Option<&str>) -> String {
    let folder = mapped.map_or("", |m| m.trim_end_matches('/'));
    let rest = file_path
        .get(..folder.len())
        .filter(|head| !folder.is_empty() && head.eq_ignore_ascii_case(folder))
        .map(|_| &file_path[folder.len()..])
        .filter(|rest| rest.starts_with('/'))
        .unwrap_or(file_path);
    let raw = rest.strip_suffix(".md").unwrap_or(rest);
    let pages: Option<Vec<String>> = raw
        .split('/')
        .map(|s| {
            let page = decode_path(&s.replace('-', " "));
            // `decode_path` turns bytes that aren't UTF-8 into U+FFFD.
            (!page.contains('\u{FFFD}') || s.contains('\u{FFFD}')).then_some(page)
        })
        .collect();
    pages.map_or_else(|| raw.to_owned(), |p| p.join("/"))
}

/// `project/wiki:path`, then the content snippet if there is one: a file-name or title hit only repeats the path.
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
        r.path.as_deref().map_or_else(
            || "?".to_owned(),
            |p| page_path(p, r.wiki.as_ref().and_then(|w| w.mapped_path.as_deref()))
        )
    );
    let content = r
        .hits
        .iter()
        .find(|h| h.field_reference_name.as_deref() == Some("content"));
    if let Some(h) = content.and_then(|h| h.highlights.first()) {
        let _ = write!(out, "\n  {}", plain(h));
    }
    out
}

/// A failed search: a 404 says Search is missing, or names the project or, in a clone, the repo too (a stale cached
/// id, or no Search: the 404 can't tell which).
fn missing(mut e: ApiError, named: Option<&str>, repo: Option<&str>) -> ApiError {
    let what = named
        .map(|p| format!("project {p}"))
        .or_else(|| repo.map(|r| format!("repo {r}")));
    if let Some(what) = what {
        return e.with_what(&format!(
            "{what}, or Search isn't installed on this collection"
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
    let mapped = info_code.and_then(info);
    let mut lines = Vec::new();
    match (mapped, info_code) {
        (Some(line), _) => lines.push(line.to_owned()),
        // A code `info` doesn't know may explain an empty answer too; above hits it says nothing.
        (None, Some(c)) if c != 0 && results.is_empty() => {
            lines.push(format!("the server answered with info code {c}"));
        }
        _ => {}
    }
    // A rejected or unindexed search answers with no results: its line says why, `0 hits` would mislead.
    if mapped.is_none() || !results.is_empty() {
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
/// When the scope or the server fails; a 404 says Search is missing, or names the project or repo.
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
                .map_err(|e| missing(e, named, repo))?;
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
                .map_err(|e| missing(e, named, repo))?;
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
                .map_err(|e| missing(e, named, repo))?;
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
    fn page_path_undoes_file_names() {
        assert_eq!(page_path("/Runbooks/Deploy.md", None), "/Runbooks/Deploy");
        assert_eq!(page_path("/Getting-Started.md", None), "/Getting Started");
        assert_eq!(
            page_path("/Q%2DA/Pre%2Dflight-Check.md", None),
            "/Q-A/Pre-flight Check"
        );
        assert_eq!(page_path("/Q%2DA/Read-me", None), "/Q-A/Read me");
        // Not UTF-8 once decoded: the raw path, `.md` cut.
        assert_eq!(page_path("/Bad%FF-Name.md", None), "/Bad%FF-Name");
    }

    #[test]
    fn page_path_drops_the_mapped_folder() {
        let p = |path, mapped| page_path(path, Some(mapped));
        assert_eq!(p("/docs/Runbooks/Deploy.md", "/docs"), "/Runbooks/Deploy");
        assert_eq!(p("/Docs/Runbooks/Deploy.md", "/docs/"), "/Runbooks/Deploy");
        assert_eq!(p("/src/My-Docs/A-B.md", "/src/my-docs"), "/A B");
        // Not under the folder, or no folder: as it is.
        assert_eq!(p("/docsx/a.md", "/docs"), "/docsx/a");
        assert_eq!(p("/docs.md", "/docs"), "/docs");
        assert_eq!(p("/Runbooks/Deploy.md", "/"), "/Runbooks/Deploy");
        assert_eq!(p("/Runbooks/Deploy.md", ""), "/Runbooks/Deploy");
    }

    #[test]
    fn more_call_limit_fits_a_u16() {
        let a = SearchArgs {
            kind: Kind::Wi,
            text: "x".into(),
            project: None,
            repo: None,
            limit: Some(40_000),
        };
        assert_eq!(more_call(&a, 20), "search kind=wi text=\"x\" limit=40");
        assert_eq!(
            more_call(&a, 40_000),
            "search kind=wi text=\"x\" limit=65535"
        );
    }

    #[test]
    fn info_codes_and_their_lines() {
        let rebuilt = "the search index is being rebuilt; results may be incomplete";
        let rejected = "the server rejected the query: ";
        for (code, line) in [
            (1, rebuilt.to_owned()),
            (
                2,
                "search indexing hasn't started on this collection".into(),
            ),
            (3, format!("{rejected}invalid request")),
            (4, format!("{rejected}prefix wildcard not supported")),
            (
                5,
                format!("{rejected}several words with a code filter not supported"),
            ),
            (6, rebuilt.to_owned()),
            (7, rebuilt.to_owned()),
            (8, "the server trimmed the results to its maximum".into()),
            (9, rebuilt.to_owned()),
            (11, "work items aren't searchable for this PAT".into()),
            (
                19,
                format!("{rejected}phrase with a code filter not supported"),
            ),
            (
                20,
                format!("{rejected}wildcard with a code filter not supported"),
            ),
        ] {
            assert_eq!(info(code), Some(line.as_str()), "{code}");
        }
    }

    #[test]
    fn unknown_info_codes_say_nothing() {
        for code in [0, 10, 12, -1] {
            assert_eq!(info(code), None, "{code}");
        }
    }
}
