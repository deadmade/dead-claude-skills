//! Which project a working directory belongs to. A project is every checkout of one repository and its worktrees,
//! found from `.git` files alone (no `git` process): checkouts fold by their `origin` url, else by folder name.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

/// What the views see: an id to ask for the project's entries by, a name to show, and its folders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Every checkout and worktree, whether or not a session ran in it.
    pub roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Identity {
    pub id: String,
    pub name: String,
}

/// Resolves working directories to checkouts and checkouts to identities, remembering both.
#[derive(Default)]
pub(crate) struct Resolver {
    checkouts: HashMap<PathBuf, PathBuf>,
    identities: HashMap<PathBuf, Identity>,
}

impl Resolver {
    pub fn resolve(&mut self, cwd: &Path) -> (PathBuf, Identity) {
        let checkout = self
            .checkouts
            .entry(cwd.to_path_buf())
            .or_insert_with(|| checkout_of(cwd))
            .clone();
        let identity = self
            .identities
            .entry(checkout.clone())
            .or_insert_with(|| identity_of(&checkout))
            .clone();
        (checkout, identity)
    }
}

/// The main checkout `cwd` belongs to. A folder under `<checkout>/.claude/worktrees/` or `<checkout>/.worktrees/`
/// belongs to that checkout; otherwise the nearest folder holding a `.git` is the checkout, or, when that `.git` is a
/// worktree's file, the checkout it points back to. A folder that no longer exists is its own checkout.
fn checkout_of(cwd: &Path) -> PathBuf {
    let parts: Vec<Component> = cwd.components().collect();
    let named = |i: usize, name: &str| parts.get(i).is_some_and(|c| c.as_os_str() == name);
    if let Some(i) = (1..parts.len())
        .find(|&i| named(i, ".worktrees") || (named(i, ".claude") && named(i + 1, "worktrees")))
    {
        return parts[..i].iter().collect();
    }
    for dir in cwd.ancestors() {
        let git = dir.join(".git");
        if git.is_dir() {
            return dir.to_path_buf();
        }
        if git.is_file() {
            return main_of_worktree(&git).unwrap_or_else(|| dir.to_path_buf());
        }
    }
    cwd.to_path_buf()
}

/// A worktree's `.git` file holds `gitdir: <main>/.git/worktrees/<name>`.
fn main_of_worktree(git_file: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(git_file).ok()?;
    let target = Path::new(text.trim().strip_prefix("gitdir:")?.trim());
    target
        .ancestors()
        .find(|a| a.file_name().is_some_and(|n| n == ".git"))?
        .parent()
        .map(Path::to_path_buf)
}

fn identity_of(checkout: &Path) -> Identity {
    let folder = checkout.file_name().map_or_else(
        || "unknown".to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let remote = fs::read_to_string(checkout.join(".git/config"))
        .ok()
        .and_then(|c| origin_url(&c))
        .map(|u| normalize_remote(&u))
        .filter(|u| !u.is_empty());
    match remote {
        Some(url) => Identity {
            name: url.rsplit('/').next().unwrap_or(&url).to_string(),
            id: slug(&url),
        },
        None => Identity {
            id: format!("folder-{}", slug(&folder)),
            name: folder,
        },
    }
}

/// The `url` of `[remote "origin"]` in a git config.
fn origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line.replace(' ', "") == "[remote\"origin\"]";
        } else if in_origin
            && let Some((key, value)) = line.split_once('=')
            && key.trim().eq_ignore_ascii_case("url")
        {
            return Some(value.trim().to_string());
        }
    }
    None
}

/// `git@github.com:Acme/app.git` and `https://github.com/acme/app/` are both `github.com/acme/app`.
fn normalize_remote(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let url = url.split_once("://").map_or(url, |(_, rest)| rest);
    let url = match url.split_once('@') {
        Some((user, rest)) if !user.contains('/') => rest,
        _ => url,
    };
    url.replace(':', "/").to_lowercase()
}

fn slug(s: &str) -> String {
    let mapped: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    mapped.trim_matches('-').to_string()
}

/// The checkouts and every worktree of them that exists: `.claude/worktrees/*`, `.worktrees/*` and the folders git
/// recorded in `.git/worktrees/*/gitdir`. Sorted, each once.
pub(crate) fn roots_of(checkouts: &BTreeSet<PathBuf>) -> Vec<PathBuf> {
    let mut roots = checkouts.clone();
    for checkout in checkouts {
        for convention in [".claude/worktrees", ".worktrees"] {
            roots.extend(subdirs(&checkout.join(convention)));
        }
        for admin in subdirs(&checkout.join(".git/worktrees")) {
            let Ok(text) = fs::read_to_string(admin.join("gitdir")) else {
                continue;
            };
            if let Some(worktree) = Path::new(text.trim()).parent()
                && worktree.is_dir()
            {
                roots.insert(worktree.to_path_buf());
            }
        }
    }
    roots.into_iter().collect()
}

pub(crate) fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = read
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remotes_fold_across_url_shapes() {
        for url in [
            "git@github.com:Acme/app.git",
            "https://github.com/acme/app/",
            "ssh://git@github.com/acme/app.git",
            "https://user@github.com/acme/app",
        ] {
            assert_eq!(normalize_remote(url), "github.com/acme/app", "{url}");
        }
    }

    #[test]
    fn reads_only_the_origin_remote() {
        let config =
            "[remote \"upstream\"]\n\turl = u1\n[remote \"origin\"]\n\tfetch = x\n\turl = u2\n";
        assert_eq!(origin_url(config).as_deref(), Some("u2"));
        assert_eq!(origin_url("[core]\n\turl = nope\n"), None);
    }

    #[test]
    fn worktree_conventions_name_their_checkout() {
        assert_eq!(
            checkout_of(Path::new("/gone/app/.claude/worktrees/x/crates")),
            Path::new("/gone/app")
        );
        assert_eq!(
            checkout_of(Path::new("/gone/app/.worktrees/y")),
            Path::new("/gone/app")
        );
        assert_eq!(checkout_of(Path::new("/gone/app")), Path::new("/gone/app"));
    }
}
