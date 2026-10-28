//! `repo_file`: one file of any repo on the server as numbered lines, a page per call.

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

use crate::api::{ApiError, V71_PREVIEW};
use crate::ctx::{Ctx, given, seg};
use crate::out::{REPLY_MAX, args, more};

/// Lines per call.
const PAGE: usize = 200;
const NEEDS_REPO: &str = "pass repo (repo_list names them)";

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub(crate) struct RepoFileArgs {
    /// Project name or id. Default: the clone's project.
    pub project: Option<String>,
    /// Repo name or id. Default: the clone's repo; needed with project.
    pub repo: Option<String>,
    /// The file's path in the repo, as search prints it: /src/app.cs.
    pub path: String,
    /// The branch to read. Default: the repo's default branch.
    pub branch: Option<String>,
    /// The first line to show. Default 1.
    pub start: Option<u32>,
}

/// An items GET answer, read by hand (the D1 fallback for the crate's items call, which puts `path` into the URL
/// raw and again escaped).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    is_folder: Option<bool>,
    content: Option<String>,
    content_metadata: Option<Meta>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    is_binary: Option<bool>,
}

/// The lines `{n:>5}  {line}` from line `start` on: at most `max_lines`, and with a line end each, at most
/// `max_chars` characters. Then the line the next page starts at when lines were left out. A line too long for the
/// budget alone is cut, marked with `…`.
fn numbered(
    content: &str,
    start: usize,
    max_lines: usize,
    max_chars: usize,
) -> (String, Option<usize>) {
    let mut out = String::new();
    let (mut shown, mut used) = (0, 0);
    for (i, line) in content.lines().enumerate().skip(start.saturating_sub(1)) {
        let head = format!("{:>5}  ", i + 1);
        // Room for the `…` and the line end.
        let room = max_chars.saturating_sub(head.len() + 2);
        let row = match line.char_indices().nth(room) {
            Some((at, _)) => format!("{head}{}…", &line[..at]),
            None => format!("{head}{line}"),
        };
        let n = row.chars().count() + 1;
        if shown == max_lines || (shown > 0 && used + n > max_chars) {
            return (out, Some(i + 1));
        }
        if shown > 0 {
            out.push('\n');
        }
        out.push_str(&row);
        (shown, used) = (shown + 1, used + n);
    }
    (out, None)
}

/// # Errors
/// When no repo is named, the scope or the server fails, or the path is a folder or a binary file.
pub(crate) async fn repo_file(ctx: &Ctx, a: &RepoFileArgs) -> Result<String, ApiError> {
    let (project, repo) = (given(a.project.as_deref()), given(a.repo.as_deref()));
    // A project alone names no repo; refused before anything is sent.
    if project.is_some() && repo.is_none() {
        return Err(ApiError::local(NEEDS_REPO));
    }
    let first = ctx.scope(project, repo, None).await?;
    let branch = given(a.branch.as_deref());
    let what = branch.map_or_else(|| a.path.clone(), |b| format!("{} on {b}", a.path));
    // Without a version the server reads the default branch.
    let mut query = vec![
        ("path", a.path.clone()),
        ("includeContent", "true".to_owned()),
        ("includeContentMetadata", "true".to_owned()),
        ("$format", "json".to_owned()),
    ];
    if let Some(b) = branch {
        query.push(("versionDescriptor.version", b.to_owned()));
        query.push(("versionDescriptor.versionType", "branch".to_owned()));
    }
    // A 404 may be a repo id gone stale: the scope is looked up again once before it reads as a missing path.
    let item: Item = ctx
        .retry_stale(&first.key, || async {
            let s = ctx.scope(project, repo, None).await?;
            // Defensive: the refusal above leaves no scope without a repo.
            let repo_id = s
                .repo_id
                .as_deref()
                .ok_or_else(|| ApiError::local(NEEDS_REPO))?;
            let items = format!(
                "{}/_apis/git/repositories/{}/items",
                seg(&s.project_id),
                seg(repo_id)
            );
            // Labelled here, not after the retry: a scope's own 404 keeps its wording.
            ctx.api
                .get(&items, &query, V71_PREVIEW)
                .await
                .map_err(|e| e.with_what(&what))
        })
        .await?;
    if item.is_folder == Some(true) {
        return Err(ApiError::local(format!("{} is a folder", a.path)));
    }
    if item.content_metadata.and_then(|m| m.is_binary) == Some(true) {
        return Err(ApiError::local(format!("{} is a binary file", a.path)));
    }
    let content = item.content.unwrap_or_default();
    let n = content.lines().count();
    if n == 0 {
        return Ok(format!("{} is empty", a.path));
    }
    let path = args(&[("path", Some(&a.path))]);
    let scope = args(&[("project", project), ("repo", repo), ("branch", branch)]);
    let call = |next: usize| more(&format!("repo_file{path} start={next}{scope}"));
    // The page gets what the more line leaves; no next start is wider than the line count.
    let budget = REPLY_MAX.saturating_sub(call(n).chars().count() + 1);
    let start = a.start.unwrap_or(1).max(1) as usize;
    let (mut text, next) = numbered(&content, start, PAGE, budget);
    if text.is_empty() {
        let s = if n == 1 { "" } else { "s" };
        return Ok(format!("no lines from {start}; {} has {n} line{s}", a.path));
    }
    if let Some(next) = next {
        text.push('\n');
        text.push_str(&call(next));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbered_whole_file() {
        assert_eq!(
            numbered("a\r\n\tb\nc", 1, 200, 1000),
            ("    1  a\n    2  \tb\n    3  c".into(), None)
        );
    }

    #[test]
    fn numbered_200_lines_a_page() {
        let content: Vec<String> = (1..=250).map(|i| format!("l{i}")).collect();
        let (text, next) = numbered(&content.join("\n"), 1, 200, 39_000);
        assert_eq!(next, Some(201));
        assert_eq!(text.lines().count(), 200);
        assert!(text.ends_with("  200  l200"), "{text}");
        let (text, next) = numbered(&content.join("\n"), 201, 200, 39_000);
        assert_eq!(next, None);
        assert!(text.starts_with("  201  l201\n"), "{text}");
        assert!(text.ends_with("  250  l250"), "{text}");
    }

    #[test]
    fn numbered_cuts_a_long_line() {
        let content = format!("{}\nnext", "é".repeat(50_000));
        let (text, next) = numbered(&content, 1, 200, 39_000);
        assert_eq!(next, Some(2));
        // The cut row and its line end fit the budget: 7 for the number, 1 for the `…`.
        assert_eq!(text, format!("    1  {}…", "é".repeat(39_000 - 9)));
        assert_eq!(text.chars().count(), 39_000 - 1);
        // Alone at the end of the file, a cut line leaves nothing to page to.
        let (_, next) = numbered(&"é".repeat(50_000), 1, 200, 39_000);
        assert_eq!(next, None);
    }

    #[test]
    fn numbered_stops_at_the_char_budget() {
        let content = ["a".repeat(30), "b".repeat(30), "c".repeat(30)].join("\n");
        // Each row is 7 + 30 characters and a line end.
        let (text, next) = numbered(&content, 1, 200, 80);
        assert_eq!(next, Some(3));
        assert_eq!(text.lines().count(), 2);
    }
}
