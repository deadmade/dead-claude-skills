//! `wiki`: a project wiki's page as markdown, or its pages as a tree.

use azure_devops_rust_api::wiki::models::wiki_create_base_parameters::Type;
use azure_devops_rust_api::wiki::models::{VersionControlRecursionType, WikiPage, WikiV2};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

use crate::api::ApiError;
use crate::ctx::{Ctx, given, seg};
use crate::out::{DESC_MAX, args, clip, cut, more};

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct WikiArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// The wiki's name, as search prints it. Default: the project's only wiki.
    pub wiki: Option<String>,
    /// The page path, as search prints it: /Runbooks/Deploy. Without it, the wiki's pages are listed.
    pub path: Option<String>,
    /// The whole page; by default it is cut at 4000 characters.
    pub full: Option<bool>,
    /// How many pages to list. Default 100.
    pub limit: Option<u16>,
}

/// The pages under `page` by path, one per line, two spaces deeper per level, in the wiki's own order.
fn tree(page: &WikiPage, depth: usize, out: &mut Vec<String>) {
    let mut subs: Vec<&WikiPage> = page.sub_pages.iter().collect();
    subs.sort_by_key(|p| p.order.unwrap_or(i32::MAX));
    for p in subs {
        out.push(format!(
            "{}{}",
            "  ".repeat(depth),
            p.path.as_deref().unwrap_or("?")
        ));
        tree(p, depth + 1, out);
    }
}

fn name(w: &WikiV2) -> &str {
    w.wiki_create_base_parameters.name.as_deref().unwrap_or("?")
}

/// The wiki named `want` (by name, any case, or id), else the project's only one.
fn pick(mut wikis: Vec<WikiV2>, want: Option<&str>, project: &str) -> Result<WikiV2, ApiError> {
    let names = || wikis.iter().map(name).collect::<Vec<_>>().join(", ");
    if wikis.is_empty() {
        return Err(ApiError::local(format!("{project} has no wiki")));
    }
    if let Some(want) = want {
        let at = wikis
            .iter()
            .position(|w| name(w).eq_ignore_ascii_case(want) || w.id.as_deref() == Some(want));
        return match at {
            Some(i) => Ok(wikis.swap_remove(i)),
            None => Err(ApiError::local(format!(
                "not found: wiki {want}; {project} has: {}",
                names()
            ))),
        };
    }
    if wikis.len() > 1 {
        return Err(ApiError::local(format!(
            "several wikis: {}; pass wiki=",
            names()
        )));
    }
    Ok(wikis.remove(0))
}

/// # Errors
/// When the scope or the server fails, the project has no wiki or several and none is named, or the page is missing.
pub(crate) async fn wiki(ctx: &Ctx, a: &WikiArgs) -> Result<String, ApiError> {
    let (named, want, path) = (
        given(a.project.as_deref()),
        given(a.wiki.as_deref()),
        given(a.path.as_deref()),
    );
    let first = ctx.scope(named, None, None).await?;
    let api = &ctx.api;
    // A 404 may be a project id gone stale: the scope is looked up again once before it reads as a missing page.
    let (wiki, page) = ctx
        .retry_stale(&first.key, || async {
            let s = ctx.scope(named, None, None).await?;
            let project = seg(&s.project_id);
            let list = api
                .az(|| {
                    api.wiki
                        .wikis_client()
                        .list(&api.org, &project)
                        .into_future()
                })
                .await
                .map_err(|e| e.with_what(&format!("project {}", s.project)))?;
            let wiki = pick(list.value, want, &s.project)?;
            // The crate puts the identifier into the URL raw; an id holds no `/` or space, a name may.
            let id = wiki.id.clone().ok_or_else(|| {
                ApiError::local("unexpected answer from the server: missing field `id`")
            })?;
            // A code wiki is published from a branch; a project wiki has one branch only.
            let version = (wiki.wiki_create_base_parameters.type_ == Some(Type::CodeWiki))
                .then(|| wiki.versions.first().and_then(|v| v.version.clone()))
                .flatten();
            let page = api
                .az(|| {
                    let call = api.wiki.pages_client().get_page(&api.org, &project, &id);
                    let call = match path {
                        Some(p) => call.path(p).include_content(true),
                        None => call
                            .path("/")
                            .recursion_level(VersionControlRecursionType::Full),
                    };
                    match &version {
                        Some(v) => call.version_descriptor_version(v),
                        None => call,
                    }
                    .into_future()
                })
                .await
                // Labelled here, not after the retry: a scope's own 404 keeps its wording.
                .map_err(|e| e.with_what(&format!("page {}", path.unwrap_or("/"))))?;
            Ok((wiki, page))
        })
        .await?;
    let name = name(&wiki);
    let scope = args(&[("project", named), ("wiki", Some(name))]);
    if let Some(p) = path {
        let mut text = format!("{name}:{}", page.path.as_deref().unwrap_or(p));
        let content = page
            .wiki_page_create_or_update_parameters
            .content
            .unwrap_or_default();
        if !content.is_empty() {
            let rest = format!("wiki{scope}{} full=true", args(&[("path", Some(p))]));
            text.push('\n');
            if a.full == Some(true) {
                text.push_str(&content);
            } else {
                text.push_str(&clip(&content, DESC_MAX, &rest));
            }
        }
        return Ok(text);
    }
    let limit = usize::from(a.limit.unwrap_or(100).max(1));
    let mut lines = Vec::new();
    tree(&page, 0, &mut lines);
    if lines.is_empty() {
        return Ok(format!("{name} has no pages"));
    }
    let (mut lines, has_more) = cut(lines, limit);
    if has_more {
        lines.push(more(&format!("wiki{scope} limit={}", limit * 2)));
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(path: &str, order: i32, sub_pages: Vec<WikiPage>) -> WikiPage {
        WikiPage {
            path: Some(path.into()),
            order: Some(order),
            sub_pages,
            ..WikiPage::default()
        }
    }

    #[test]
    fn tree_indents_in_order() {
        let root = page(
            "/",
            0,
            vec![
                page(
                    "/B",
                    1,
                    vec![
                        page("/B/Y", 1, vec![page("/B/Y/Z", 0, vec![])]),
                        page("/B/X", 0, vec![]),
                    ],
                ),
                page("/A", 0, vec![]),
            ],
        );
        let mut out = Vec::new();
        tree(&root, 0, &mut out);
        assert_eq!(out, ["/A", "/B", "  /B/X", "  /B/Y", "    /B/Y/Z"]);
    }
}
