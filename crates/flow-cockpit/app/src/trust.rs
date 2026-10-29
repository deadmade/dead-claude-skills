//! Which folders a `trusted` entry in `config.toml` lets a repository's extensions load from. A trusted path trusts one
//! repository: that checkout, and the worktrees git links to it in both directions (the worktree's `.git` file names
//! `<main>/.git/worktrees/<n>`, and that folder's `gitdir` names the worktree's `.git` back). A trusted worktree trusts
//! its main checkout and that checkout's other worktrees the same way. Nothing else the index groups into the project
//! (a same-named folder, a copied `origin`, a clone under `.claude/worktrees/`) is ever looked at, and a linked folder
//! is never a checkout or a worktree.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// `config.toml`'s `trusted`, ready to match project roots against: each absolute entry as written and as it
/// resolves on disk, read once when the setting is read. A relative entry matches nothing, and `~` is not expanded.
#[derive(Debug, Default)]
pub struct Trusted(Vec<PathBuf>);

impl Trusted {
    #[must_use]
    pub fn new(entries: &[PathBuf]) -> Trusted {
        let mut forms = Vec::new();
        for entry in entries.iter().filter(|e| e.is_absolute()) {
            forms.push(lexical(entry));
            if let Ok(real) = fs::canonicalize(entry) {
                forms.push(real);
            }
        }
        Trusted(forms)
    }

    fn names(&self, root: &Path) -> bool {
        self.0.iter().any(|t| t == root)
    }
}

/// The folders a repository's extensions may load from for a project with these roots: [`mains`], then their
/// [`worktrees`]. Reads only the trusted roots' own `.git` and those main checkouts' `.git/worktrees/` records; another
/// root of the project is never touched.
#[cfg(test)]
#[must_use]
pub fn repositories(roots: &[PathBuf], trusted: &Trusted) -> Vec<PathBuf> {
    let mains = mains(roots, trusted);
    let worktrees = worktrees(&mains);
    mains.into_iter().chain(worktrees).collect()
}

/// The main checkouts that a trusted root of a project with these roots is or leads to, sorted. Reads only the trusted
/// roots' own `.git`, and for a worktree its main checkout's record of it.
#[must_use]
pub fn mains(roots: &[PathBuf], trusted: &Trusted) -> Vec<PathBuf> {
    let mut mains: Vec<PathBuf> = roots
        .iter()
        .filter(|root| trusted.names(root) && is_real_dir(root))
        .filter_map(|root| main_of(root))
        .collect();
    mains.sort();
    mains.dedup();
    mains
}

/// The worktrees git links both ways to these main checkouts, sorted: a walk of each one's `.git/worktrees/` records.
#[must_use]
pub fn worktrees(mains: &[PathBuf]) -> Vec<PathBuf> {
    let mut worktrees: Vec<PathBuf> = mains.iter().flat_map(|m| worktrees_of(m)).collect();
    worktrees.sort();
    worktrees.dedup();
    worktrees
}

/// The repository a trusted folder belongs to: itself when its `.git` is a folder or when it has none (a plain folder
/// the user named), the main checkout when it is a worktree linked both ways; none for a `.git` file git doesn't link
/// back, or a linked `.git`.
fn main_of(root: &Path) -> Option<PathBuf> {
    let git = root.join(".git");
    let Ok(meta) = fs::symlink_metadata(&git) else {
        return Some(root.to_path_buf());
    };
    if meta.is_dir() {
        return Some(root.to_path_buf());
    }
    if !meta.is_file() {
        return None;
    }
    let admin = admin_of(root)?;
    let worktrees = admin.parent()?;
    let dot_git = worktrees.parent()?;
    if worktrees.file_name()? != "worktrees" || dot_git.file_name()? != ".git" {
        return None;
    }
    let main = dot_git.parent()?.to_path_buf();
    let real = is_real_dir(&main) && is_real_dir(dot_git) && is_real_dir(worktrees);
    (real && links_back(&admin, root)).then_some(main)
}

/// The worktrees git recorded for `main` that link back to it, each a real folder (not a link), as is the folder of
/// records.
fn worktrees_of(main: &Path) -> Vec<PathBuf> {
    #[cfg(test)]
    tests::WALKS.with(|n| n.set(n.get() + 1));
    let records = main.join(".git").join("worktrees");
    if !is_real_dir(&records) {
        return Vec::new();
    }
    let Ok(read) = fs::read_dir(records) else {
        return Vec::new();
    };
    read.flatten()
        .filter(|e| e.file_type().is_ok_and(|k| k.is_dir()))
        .filter_map(|e| {
            let admin = e.path();
            let git_file = recorded(&admin.join("gitdir"), &admin)?;
            let worktree = git_file.parent()?.to_path_buf();
            let linked = git_file.file_name()? == ".git"
                && is_real_dir(&worktree)
                && fs::symlink_metadata(&git_file).is_ok_and(|m| m.is_file())
                && admin_of(&worktree).is_some_and(|a| same_path(&a, &admin));
            linked.then_some(worktree)
        })
        .collect()
}

/// The admin folder a worktree's `.git` file names (`gitdir: <path>`, relative to the worktree when git wrote it so).
fn admin_of(worktree: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(worktree.join(".git")).ok()?;
    let target = text.trim().strip_prefix("gitdir:")?.trim();
    Some(lexical(&worktree.join(target)))
}

/// Whether the admin folder's `gitdir` names this worktree's `.git`.
fn links_back(admin: &Path, worktree: &Path) -> bool {
    recorded(&admin.join("gitdir"), admin)
        .is_some_and(|git| same_path(&git, &worktree.join(".git")))
}

/// The path a git record file holds, relative to `base` when git wrote it so.
fn recorded(file: &Path, base: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(file).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| lexical(&base.join(text)))
}

/// The same path as written, or as it resolves: git records the paths it saw, which may differ by a link.
fn same_path(a: &Path, b: &Path) -> bool {
    lexical(a) == lexical(b)
        || matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// A folder, not a link to one.
pub fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

/// `a/b/../c` as `a/c`, without reading the disk.
fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::Cell;

    use super::*;

    thread_local! {
        /// How many times this test's thread walked a checkout's worktree records.
        pub(crate) static WALKS: Cell<usize> = const { Cell::new(0) };
    }

    struct Temp(PathBuf);

    impl Drop for Temp {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    /// A temp folder holding the checkout `app` (a `.git` folder) with the linked worktree `app/.claude/worktrees/wt`.
    fn temp(tag: &str) -> Temp {
        let dir =
            std::env::temp_dir().join(format!("flow-cockpit-trust-{}-{tag}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(dir.join("app/.git")).unwrap();
        let t = Temp(dir);
        link(
            &t.0.join("app"),
            &t.0.join("app/.claude/worktrees/wt"),
            "wt",
        );
        t
    }

    /// Records `worktree` as `main`'s worktree `name`, both ways, as `git worktree add` does.
    fn link(main: &Path, worktree: &Path, name: &str) {
        let admin = main.join(".git/worktrees").join(name);
        fs::create_dir_all(&admin).unwrap();
        fs::create_dir_all(worktree).unwrap();
        fs::write(
            admin.join("gitdir"),
            format!("{}\n", worktree.join(".git").display()),
        )
        .unwrap();
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", admin.display()),
        )
        .unwrap();
    }

    fn trusted(entries: &[&Path]) -> Trusted {
        Trusted::new(&entries.iter().map(|p| p.to_path_buf()).collect::<Vec<_>>())
    }

    #[test]
    fn a_trusted_checkout_or_its_worktree_trusts_both() {
        let t = temp("both");
        let (app, wt) = (t.0.join("app"), t.0.join("app/.claude/worktrees/wt"));
        let roots = [app.clone(), wt.clone()];
        let both = vec![app.clone(), wt.clone()];
        assert_eq!(repositories(&roots, &trusted(&[&app])), both);
        assert_eq!(repositories(&roots, &trusted(&[&wt])), both);
        // As written with a trailing slash or `..`, too.
        assert_eq!(repositories(&roots, &trusted(&[&wt.join("")])), both);
        assert_eq!(
            repositories(&roots, &trusted(&[&t.0.join("x/../app")])),
            both
        );
        // Relative written by git (`worktree.useRelativePaths`).
        fs::write(
            app.join(".git/worktrees/wt/gitdir"),
            "../../../.claude/worktrees/wt/.git\n",
        )
        .unwrap();
        fs::write(wt.join(".git"), "gitdir: ../../../.git/worktrees/wt\n").unwrap();
        assert_eq!(repositories(&roots, &trusted(&[&wt])), both);
    }

    #[test]
    fn untrusted_entries_and_prefixes_trust_nothing() {
        let t = temp("prefix");
        let app = t.0.join("app");
        let app2 = t.0.join("app2");
        fs::create_dir_all(app2.join(".git")).unwrap();
        let roots = [app2.clone()];
        assert_eq!(
            repositories(&roots, &trusted(&[&app])),
            Vec::<PathBuf>::new()
        );
        // A relative entry matches nothing, wherever the window runs; `~` is not expanded.
        let relative = Trusted::new(&[PathBuf::from("app2"), PathBuf::from("~/app2")]);
        assert_eq!(
            repositories(&[PathBuf::from("app2")], &relative),
            Vec::<PathBuf>::new()
        );
        assert_eq!(repositories(&roots, &relative), Vec::<PathBuf>::new());
        // Not even when it would resolve against the window's working folder.
        let here = std::env::current_dir().unwrap();
        let dot = Trusted::new(&[PathBuf::from(".")]);
        assert_eq!(repositories(&[here], &dot), Vec::<PathBuf>::new());
    }

    /// A trusted entry is resolved when `trusted` is read, not on every poll: a link retargeted later trusts nothing
    /// new until the setting is read again.
    #[cfg(unix)]
    #[test]
    fn trusted_entries_resolve_when_read() {
        let t = temp("resolve");
        let app = t.0.join("app");
        let other = t.0.join("other");
        fs::create_dir_all(other.join(".git")).unwrap();
        let link = t.0.join("link");
        std::os::unix::fs::symlink(&app, &link).unwrap();
        let read = trusted(&[&link]);
        assert!(repositories(std::slice::from_ref(&app), &read).contains(&app));
        fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&other, &link).unwrap();
        assert_eq!(
            repositories(std::slice::from_ref(&other), &read),
            Vec::<PathBuf>::new()
        );
        assert_eq!(
            repositories(std::slice::from_ref(&other), &trusted(&[&link])),
            [other]
        );
    }

    /// Another root the index puts in the project (a stray clone in the worktrees folder, a same-named folder) is
    /// never one of the trusted repository's, and nothing of it is read: the folders listed are all the loader sees.
    #[test]
    fn a_clone_in_the_worktrees_folder_is_no_worktree() {
        let t = temp("stray");
        let app = t.0.join("app");
        let stray = t.0.join("app/.claude/worktrees/pr");
        fs::create_dir_all(stray.join(".git")).unwrap();
        let elsewhere = t.0.join("Downloads/app");
        fs::create_dir_all(elsewhere.join(".git")).unwrap();
        let roots = [
            elsewhere,
            app.clone(),
            stray,
            t.0.join("app/.claude/worktrees/wt"),
        ];
        assert_eq!(
            repositories(&roots, &trusted(&[&app])),
            [app, t.0.join("app/.claude/worktrees/wt")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_worktree_folder_is_ignored() {
        let t = temp("linked");
        let app = t.0.join("app");
        let real = t.0.join("elsewhere/wt2");
        let slot = t.0.join("app/.worktrees/wt2");
        link(&app, &real, "wt2");
        // git's record and the `.git` file both name the link, as if the worktree had been made through it.
        fs::create_dir_all(slot.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&real, &slot).unwrap();
        fs::write(
            app.join(".git/worktrees/wt2/gitdir"),
            format!("{}\n", slot.join(".git").display()),
        )
        .unwrap();
        let roots = [app.clone(), slot.clone()];
        assert_eq!(
            repositories(&roots, &trusted(&[&app])),
            [app.clone(), t.0.join("app/.claude/worktrees/wt")]
        );
        // Trusting the link itself trusts nothing either.
        assert_eq!(
            repositories(&roots, &trusted(&[&slot])),
            Vec::<PathBuf>::new()
        );
    }

    /// A linked `.git/worktrees` in a trusted checkout is no record folder: its records list nothing, and a worktree
    /// naming an admin folder inside it leads to no main checkout.
    #[cfg(unix)]
    #[test]
    fn a_linked_worktrees_record_folder_is_ignored() {
        let t = temp("linked-records");
        let app = t.0.join("app");
        let records = t.0.join("records");
        fs::rename(app.join(".git/worktrees"), &records).unwrap();
        std::os::unix::fs::symlink(&records, app.join(".git/worktrees")).unwrap();
        let wt = t.0.join("app/.claude/worktrees/wt");
        let roots = [app.clone(), wt.clone()];
        assert_eq!(
            repositories(&roots, &trusted(&[&app])),
            std::slice::from_ref(&app)
        );
        assert_eq!(
            repositories(&roots, &trusted(&[&wt])),
            Vec::<PathBuf>::new()
        );
    }

    #[test]
    fn a_gitdir_forged_one_way_links_nothing() {
        let t = temp("forged");
        let app = t.0.join("app");
        // A folder whose `.git` file names app's worktree record, which names another folder: not app's worktree.
        let forged = t.0.join("forged");
        fs::create_dir_all(&forged).unwrap();
        fs::write(
            forged.join(".git"),
            format!("gitdir: {}\n", app.join(".git/worktrees/wt").display()),
        )
        .unwrap();
        let roots = [app.clone(), forged.clone()];
        assert_eq!(
            repositories(&roots, &trusted(&[&forged])),
            Vec::<PathBuf>::new()
        );
        assert!(!repositories(&roots, &trusted(&[&app])).contains(&forged));
        // A record in app's `.git/worktrees/` naming a folder whose `.git` doesn't name it back.
        let claimed = t.0.join("claimed");
        fs::create_dir_all(claimed.join(".git")).unwrap();
        let admin = app.join(".git/worktrees/claimed");
        fs::create_dir_all(&admin).unwrap();
        fs::write(
            admin.join("gitdir"),
            format!("{}\n", claimed.join(".git").display()),
        )
        .unwrap();
        assert!(!repositories(std::slice::from_ref(&app), &trusted(&[&app])).contains(&claimed));
    }

    #[test]
    fn a_trusted_folder_without_git_is_its_own() {
        let t = temp("plain");
        let plain = t.0.join("plain");
        fs::create_dir_all(&plain).unwrap();
        assert_eq!(
            repositories(std::slice::from_ref(&plain), &trusted(&[&plain])),
            [plain]
        );
    }
}
