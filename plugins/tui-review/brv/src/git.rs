//! Which commits a review shows: HEAD against the branch it is stacked on, not against main.
//!
//! For `main → b1 → b2`, reviewing `b2` shows only `b2`'s own commits. The base is, in order: the `--base` the person
//! gave (remembered as `branch.<name>.brvBase`), that remembered pick, or the branch whose merge-base with HEAD is
//! nearest to HEAD. The diff is always `merge_base(base, HEAD)..HEAD`, so a base that moved on after this branch was
//! cut never leaks its new commits into the review.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use gix::ObjectId;
use gix::bstr::ByteSlice;

/// What to diff, and the names the pane's title shows.
#[derive(Debug, Clone)]
pub struct Range {
    pub head: ObjectId,
    /// The short branch name, or `HEAD` when detached.
    pub head_name: String,
    pub base: ObjectId,
    /// The base as the person would type it: `b1`, `origin/main`.
    pub base_name: String,
    pub merge_base: ObjectId,
}

/// Git config key under `branch.<name>` that remembers a base picked with `--base`.
pub const BASE_KEY: &str = "brvBase";

/// How far back along HEAD's first parents a merge-base still counts as "near"; past this, candidates tie.
const DEPTH_LIMIT: usize = 100_000;

/// Finds the review range for HEAD of `repo`.
///
/// # Errors
/// When HEAD has no commit, the given base does not resolve, or no base can be found.
pub fn resolve(repo: &gix::Repository, base: Option<&str>) -> Result<Range> {
    let head = repo.head_id().context("HEAD has no commit yet")?.detach();
    let head_ref = repo.head_name()?;
    let head_branch = head_ref.as_ref().and_then(|name| {
        name.as_bstr()
            .strip_prefix(b"refs/heads/")
            .map(|short| short.to_str_lossy().into_owned())
    });
    let head_name = head_branch.clone().unwrap_or_else(|| "HEAD".to_owned());

    let picked = match base {
        Some(base) => {
            let id = peel(repo, base)?;
            if let Some(branch) = &head_branch {
                remember(repo, branch, base)?;
            }
            Some((base.to_owned(), id))
        }
        None => match head_branch.as_deref().and_then(|b| remembered(repo, b)) {
            // A remembered base that no longer resolves (deleted branch) falls through to detection.
            Some(name) => peel(repo, &name).ok().map(|id| (name, id)),
            None => None,
        },
    };
    let (base_name, base) = match picked {
        Some(found) => found,
        None => detect(repo, head, head_branch.as_deref())?,
    };
    let merge_base = repo
        .merge_base(base, head)
        .with_context(|| format!("{base_name} and {head_name} share no history"))?
        .detach();
    Ok(Range {
        head,
        head_name,
        base,
        base_name,
        merge_base,
    })
}

fn peel(repo: &gix::Repository, spec: &str) -> Result<ObjectId> {
    let id = repo
        .rev_parse_single(spec)
        .with_context(|| format!("no branch or commit named {spec}"))?;
    Ok(id.object()?.peel_to_commit()?.id)
}

fn remembered(repo: &gix::Repository, branch: &str) -> Option<String> {
    let key = format!("branch.{branch}.{BASE_KEY}");
    repo.config_snapshot()
        .string(key.as_str())
        .map(|v| v.to_str_lossy().into_owned())
}

/// Saves `base` as `branch.<branch>.brvBase` in the repository's own config, so the pick sticks.
fn remember(repo: &gix::Repository, branch: &str, base: &str) -> Result<()> {
    if remembered(repo, branch).as_deref() == Some(base) {
        return Ok(());
    }
    let path = repo.common_dir().join("config");
    let mut config =
        gix::config::File::from_path_no_includes(path.clone(), gix::config::Source::Local)?;
    config.set_raw_value_by("branch", Some(branch.as_bytes().as_bstr()), BASE_KEY, base)?;
    let mut bytes = Vec::new();
    config.write_to(&mut bytes)?;
    crate::format::write_atomic(&path, &bytes)?;
    Ok(())
}

/// Lower is better: merge-base depth, then moved on, then not default, then remote, then the name.
type Rank<'a> = (usize, bool, bool, bool, &'a str);

/// A branch that could be the base: its name as typed, its tip, and how it ranks on a tie.
struct Candidate {
    name: String,
    tip: ObjectId,
    is_default: bool,
    is_local: bool,
}

/// The candidate whose merge-base with HEAD is nearest to HEAD along its first parents. On a tie: one whose tip is
/// that merge-base (it has not moved on), then the default branch, then a local branch, then the name.
fn detect(
    repo: &gix::Repository,
    head: ObjectId,
    head_branch: Option<&str>,
) -> Result<(String, ObjectId)> {
    let candidates = candidates(repo, head, head_branch)?;
    if candidates.is_empty() {
        bail!("no other branch to review against; pass a base: /tui-review <branch>");
    }
    let depth = first_parent_depths(repo, head)?;
    let mut merge_bases: HashMap<ObjectId, Option<ObjectId>> = HashMap::new();
    let mut best: Option<(Rank<'_>, &Candidate)> = None;
    for c in &candidates {
        let mb = *merge_bases.entry(c.tip).or_insert_with(|| {
            // A tip on HEAD's own line is its own merge-base: no walk needed.
            if depth.contains_key(&c.tip) {
                Some(c.tip)
            } else {
                repo.merge_base(c.tip, head).ok().map(gix::Id::detach)
            }
        });
        // No shared history, or the candidate contains HEAD (stacked on top of it, or the same commit).
        let Some(mb) = mb else { continue };
        if mb == head {
            continue;
        }
        let d = depth.get(&mb).copied().unwrap_or(DEPTH_LIMIT);
        let key = (d, c.tip != mb, !c.is_default, !c.is_local, c.name.as_str());
        if best.as_ref().is_none_or(|(k, _)| key < *k) {
            best = Some((key, c));
        }
    }
    best.map(|(_, c)| (c.name.clone(), c.tip)).ok_or_else(|| {
        anyhow!("no branch shares history with HEAD; pass a base: /tui-review <branch>")
    })
}

/// Local and remote-tracking branches, minus HEAD's own branch and its remote copies.
fn candidates(
    repo: &gix::Repository,
    head: ObjectId,
    head_branch: Option<&str>,
) -> Result<Vec<Candidate>> {
    let upstream = head_branch.and_then(|b| upstream(repo, b));
    let defaults = default_branches(repo);
    let mut out = Vec::new();
    for reference in repo.references()?.all()? {
        let Ok(mut reference) = reference else {
            continue;
        };
        let full = reference.name().as_bstr().to_str_lossy().into_owned();
        let (name, is_local) = if let Some(short) = full.strip_prefix("refs/heads/") {
            (short.to_owned(), true)
        } else if let Some(short) = full.strip_prefix("refs/remotes/") {
            (short.to_owned(), false)
        } else {
            continue;
        };
        if is_local && Some(name.as_str()) == head_branch {
            continue;
        }
        if !is_local {
            // `origin/HEAD` points at a branch listed anyway; `origin/<this branch>` is this branch.
            let branch = name.split_once('/').map_or(name.as_str(), |(_, b)| b);
            if branch == "HEAD"
                || Some(branch) == head_branch
                || upstream.as_deref() == Some(name.as_str())
            {
                continue;
            }
        }
        let Ok(tip) = reference.peel_to_commit() else {
            continue;
        };
        let tip = tip.id;
        if tip == head {
            continue;
        }
        let is_default = defaults.iter().any(|d| d == &name);
        out.push(Candidate {
            name,
            tip,
            is_default,
            is_local,
        });
    }
    Ok(out)
}

/// `remote/branch` that `branch` tracks, from `branch.<name>.remote` and `.merge`.
fn upstream(repo: &gix::Repository, branch: &str) -> Option<String> {
    let config = repo.config_snapshot();
    let remote = config.string(format!("branch.{branch}.remote").as_str())?;
    let merge = config.string(format!("branch.{branch}.merge").as_str())?;
    let merge = merge.to_str_lossy();
    Some(format!(
        "{}/{}",
        remote.to_str_lossy(),
        merge.strip_prefix("refs/heads/").unwrap_or(&merge)
    ))
}

/// What counts as the default branch: `main`, `master`, and whatever each remote's `HEAD` points at.
fn default_branches(repo: &gix::Repository) -> Vec<String> {
    let mut out = vec!["main".to_owned(), "master".to_owned()];
    for remote in repo.remote_names() {
        let remote = remote.to_str_lossy();
        let name = format!("refs/remotes/{remote}/HEAD");
        if let Ok(Some(r)) = repo.try_find_reference(name.as_str())
            && let Some(target) = r.target().try_name()
            && let Some(short) = target
                .as_bstr()
                .to_str_lossy()
                .strip_prefix("refs/remotes/")
        {
            out.push(short.to_owned());
            if let Some((_, branch)) = short.split_once('/') {
                out.push(branch.to_owned());
            }
        }
        out.push(format!("{remote}/main"));
        out.push(format!("{remote}/master"));
    }
    out
}

/// How many first-parent steps back from HEAD each commit on that line is (HEAD is 0).
fn first_parent_depths(repo: &gix::Repository, head: ObjectId) -> Result<HashMap<ObjectId, usize>> {
    let mut depth = HashMap::new();
    let mut at = Some(head);
    while let Some(id) = at
        && depth.len() < DEPTH_LIMIT
    {
        depth.insert(id, depth.len());
        at = repo
            .find_commit(id)?
            .parent_ids()
            .next()
            .map(gix::Id::detach);
    }
    Ok(depth)
}

/// Opens the repository that holds `dir`, searching upward like git does.
///
/// # Errors
/// When `dir` is not inside a git repository.
pub fn open(dir: &Path) -> Result<gix::Repository> {
    let mut repo = gix::discover(dir)
        .with_context(|| format!("{} is not in a git repository", dir.display()))?;
    repo.object_cache_size_if_unset(64 * 1024 * 1024);
    Ok(repo)
}
