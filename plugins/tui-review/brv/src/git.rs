//! Which commits a review shows: HEAD against the branch it is stacked on, not against main.
//!
//! For `main → b1 → b2`, reviewing `b2` shows only `b2`'s own commits. The base is, in order: the `--base` the person
//! gave (remembered as `branch.<name>.brvBase`), that remembered pick, or the branch whose merge-base with HEAD is
//! nearest to HEAD, counting steps over all of HEAD's parents (so a branch that merged main in still picks main).
//! The diff is always `merge_base(base, HEAD)..HEAD`, so a base that moved on after this branch was
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

/// Commits walked back from HEAD to measure how near each merge-base is. A merge-base past this counts as far, and
/// only wins when no branch has one nearer. About 10 ms with a commit-graph.
const WALK_LIMIT: usize = 50_000;

/// Finds the review range for HEAD of `repo`.
///
/// # Errors
/// When HEAD has no commit, the given base does not resolve, or no base can be found.
pub fn resolve(repo: &gix::Repository, base: Option<&str>) -> Result<Range> {
    let head = repo.head_id().context("HEAD has no commit yet")?.detach();
    let head_ref = repo.head_name()?;
    let head_branch = head_ref
        .as_ref()
        .and_then(|name| name.as_bstr().strip_prefix(b"refs/heads/").map(|short| short.to_str_lossy().into_owned()));
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
    let merge_base =
        repo.merge_base(base, head).with_context(|| format!("{base_name} and {head_name} share no history"))?.detach();
    Ok(Range { head, head_name, base, base_name, merge_base })
}

fn peel(repo: &gix::Repository, spec: &str) -> Result<ObjectId> {
    let id = repo.rev_parse_single(spec).with_context(|| format!("no branch or commit named {spec}"))?;
    Ok(id.object()?.peel_to_commit()?.id)
}

fn remembered(repo: &gix::Repository, branch: &str) -> Option<String> {
    let key = format!("branch.{branch}.{BASE_KEY}");
    repo.config_snapshot().string(key.as_str()).map(|v| v.to_str_lossy().into_owned())
}

/// Saves `base` as `branch.<branch>.brvBase` in the repository's own config, so the pick sticks.
fn remember(repo: &gix::Repository, branch: &str, base: &str) -> Result<()> {
    if remembered(repo, branch).as_deref() == Some(base) {
        return Ok(());
    }
    let path = repo.common_dir().join("config");
    let mut config = gix::config::File::from_path_no_includes(path.clone(), gix::config::Source::Local)?;
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
    /// The tip's commit time, to skip branches older than everything walked.
    time: i64,
}

/// The candidate whose merge-base with HEAD is nearest to HEAD. On a tie: one whose tip is that merge-base (it has not
/// moved on), then the default branch, then a local branch, then the name.
fn detect(repo: &gix::Repository, head: ObjectId, head_branch: Option<&str>) -> Result<(String, ObjectId)> {
    let candidates = candidates(repo, head, head_branch)?;
    if candidates.is_empty() {
        bail!("no other branch to review against; pass a base: /tui-review <branch>");
    }
    let near = Ancestry::walk(repo, head)?;
    let cache = repo.commit_graph_if_enabled()?;
    let mut graph = repo.revision_graph(cache.as_ref());
    let mut merge_bases: HashMap<ObjectId, Option<ObjectId>> = HashMap::new();
    let mut ranked = |c| {
        let rank = rank(c, head, &near, &mut merge_bases, |tip| {
            repo.merge_base_with_graph(tip, head, &mut graph).ok().map(gix::Id::detach)
        });
        rank.map(|rank| (rank, c))
    };
    // A tip older than every walked commit cannot have a near merge-base: those are only looked at when no branch
    // had one nearer.
    let (near_ones, far): (Vec<_>, Vec<_>) =
        candidates.iter().partition(|c| near.dist.contains_key(&c.tip) || c.time >= near.oldest);
    let best = near_ones
        .into_iter()
        .filter_map(&mut ranked)
        .min_by(|a, b| a.0.cmp(&b.0))
        .or_else(|| far.into_iter().filter_map(&mut ranked).min_by(|a, b| a.0.cmp(&b.0)));
    best.map(|(_, c)| (c.name.clone(), c.tip))
        .ok_or_else(|| anyhow!("no branch shares history with HEAD; pass a base: /tui-review <branch>"))
}

/// How `c` ranks as the base, or `None` when it shares no history with HEAD or contains it (stacked on top).
fn rank<'a>(
    c: &'a Candidate,
    head: ObjectId,
    near: &Ancestry,
    merge_bases: &mut HashMap<ObjectId, Option<ObjectId>>,
    merge_base: impl FnOnce(ObjectId) -> Option<ObjectId>,
) -> Option<Rank<'a>> {
    // A tip HEAD descends from is its own merge-base: no walk needed.
    let mb = *merge_bases
        .entry(c.tip)
        .or_insert_with(|| if near.dist.contains_key(&c.tip) { Some(c.tip) } else { merge_base(c.tip) });
    let mb = mb.filter(|mb| *mb != head)?;
    let d = near.dist.get(&mb).copied().unwrap_or(usize::MAX);
    Some((d, c.tip != mb, !c.is_default, !c.is_local, c.name.as_str()))
}

/// HEAD's ancestors near it: how many parent steps back each is (HEAD is 0), breadth first over all parents.
struct Ancestry {
    dist: HashMap<ObjectId, usize>,
    /// Commit time of the last commit walked when the walk stopped short; `i64::MIN` when it saw all history.
    oldest: i64,
}

impl Ancestry {
    fn walk(repo: &gix::Repository, head: ObjectId) -> Result<Ancestry> {
        let mut dist = HashMap::from([(head, 0)]);
        let mut walked = 0;
        let mut last = None;
        let walk = repo.rev_walk([head]).sorting(gix::revision::walk::Sorting::BreadthFirst).all()?;
        for info in walk {
            if walked == WALK_LIMIT {
                break;
            }
            let info = info?;
            let d = dist.get(&info.id).copied().unwrap_or(0);
            for parent in &info.parent_ids {
                dist.entry(*parent).or_insert(d + 1);
            }
            walked += 1;
            last = Some(info.id);
        }
        let oldest = match last {
            Some(last) if walked == WALK_LIMIT => repo.find_commit(last)?.time()?.seconds,
            _ => i64::MIN,
        };
        Ok(Ancestry { dist, oldest })
    }
}

/// Local and remote-tracking branches, minus HEAD's own branch and its remote copies.
fn candidates(repo: &gix::Repository, head: ObjectId, head_branch: Option<&str>) -> Result<Vec<Candidate>> {
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
            if branch == "HEAD" || Some(branch) == head_branch || upstream.as_deref() == Some(name.as_str()) {
                continue;
            }
        }
        let Ok(commit) = reference.peel_to_commit() else {
            continue;
        };
        if commit.id == head {
            continue;
        }
        let time = commit.time().map_or(i64::MAX, |t| t.seconds);
        let is_default = defaults.iter().any(|d| d == &name);
        out.push(Candidate { name, tip: commit.id, is_default, is_local, time });
    }
    Ok(out)
}

/// `remote/branch` that `branch` tracks, from `branch.<name>.remote` and `.merge`.
fn upstream(repo: &gix::Repository, branch: &str) -> Option<String> {
    let config = repo.config_snapshot();
    let remote = config.string(format!("branch.{branch}.remote").as_str())?;
    let merge = config.string(format!("branch.{branch}.merge").as_str())?;
    let merge = merge.to_str_lossy();
    Some(format!("{}/{}", remote.to_str_lossy(), merge.strip_prefix("refs/heads/").unwrap_or(&merge)))
}

/// What counts as the default branch: `main`, `master`, and whatever each remote's `HEAD` points at.
fn default_branches(repo: &gix::Repository) -> Vec<String> {
    let mut out = vec!["main".to_owned(), "master".to_owned()];
    for remote in repo.remote_names() {
        let remote = remote.to_str_lossy();
        let name = format!("refs/remotes/{remote}/HEAD");
        if let Ok(Some(r)) = repo.try_find_reference(name.as_str())
            && let Some(target) = r.target().try_name()
            && let Some(short) = target.as_bstr().to_str_lossy().strip_prefix("refs/remotes/")
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

/// Opens the repository that holds `dir`, searching upward like git does.
///
/// # Errors
/// When `dir` is not inside a git repository.
pub fn open(dir: &Path) -> Result<gix::Repository> {
    let mut repo = gix::discover(dir).with_context(|| format!("{} is not in a git repository", dir.display()))?;
    repo.object_cache_size_if_unset(64 * 1024 * 1024);
    Ok(repo)
}
