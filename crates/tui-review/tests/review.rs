//! `tui-review review` against real repositories built with the git CLI: which base it picks, and what it writes.

use std::path::Path;
use std::process::Command;

use tui_review::diff::FileDiff;
use tui_review::format::{Kind, file_flags};
use tui_review::review::{Options, run};

struct Repo(tempfile::TempDir);

impl Repo {
    fn new() -> Repo {
        let repo = Repo(tempfile::tempdir().unwrap());
        repo.git(&["init", "-q", "-b", "main"]);
        repo
    }

    fn path(&self) -> &Path {
        self.0.path()
    }

    fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(self.path())
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    }

    fn write(&self, path: &str, text: impl AsRef<[u8]>) {
        let path = self.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Writes `path` and commits everything.
    fn commit(&self, path: &str, text: &str) -> String {
        self.write(path, text);
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", path]);
        self.git(&["rev-parse", "HEAD"])
    }

    fn base(&self, base: Option<&str>) -> String {
        let repo = tui_review::git::open(self.path()).unwrap();
        tui_review::git::resolve(&repo, base).unwrap().base_name
    }

    fn files(&self) -> Vec<FileDiff> {
        let repo = tui_review::git::open(self.path()).unwrap();
        let range = tui_review::git::resolve(&repo, None).unwrap();
        tui_review::diff::review(&repo, &range).unwrap()
    }
}

/// `main → b1 → b2`, checked out on b2.
fn stack() -> Repo {
    let repo = Repo::new();
    repo.commit("main.txt", "main\n");
    repo.git(&["checkout", "-q", "-b", "b1"]);
    repo.commit("b1.txt", "b1\n");
    repo.git(&["checkout", "-q", "-b", "b2"]);
    repo.commit("b2.txt", "b2\n");
    repo
}

fn paths(files: &[FileDiff]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[test]
fn a_stacked_branch_is_reviewed_against_its_parent() {
    let repo = stack();
    assert_eq!(repo.base(None), "b1");
    assert_eq!(paths(&repo.files()), ["b2.txt"]);
    repo.git(&["checkout", "-q", "b1"]);
    assert_eq!(repo.base(None), "main");
}

#[test]
fn a_parent_that_moved_on_stays_the_base_without_leaking_its_commits() {
    let repo = stack();
    repo.git(&["checkout", "-q", "b1"]);
    repo.commit("b1-later.txt", "later\n");
    repo.git(&["checkout", "-q", "b2"]);
    assert_eq!(repo.base(None), "b1");
    assert_eq!(paths(&repo.files()), ["b2.txt"]);
}

#[test]
fn main_that_moved_on_is_still_the_base() {
    let repo = Repo::new();
    repo.commit("a.txt", "a\n");
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit("f.txt", "f\n");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("main-later.txt", "later\n");
    // Another branch cut from the same point, with work of its own, ties with main and loses to it.
    repo.git(&["checkout", "-q", "-b", "other", "HEAD~1"]);
    repo.commit("o.txt", "o\n");
    repo.git(&["checkout", "-q", "feature"]);
    assert_eq!(repo.base(None), "main");
    assert_eq!(paths(&repo.files()), ["f.txt"]);
}

#[test]
fn a_branch_that_merged_main_in_is_reviewed_against_main() {
    let repo = Repo::new();
    repo.commit("a.txt", "a\n");
    repo.git(&["branch", "old"]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit("f.txt", "f\n");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("main-later.txt", "later\n");
    repo.git(&["checkout", "-q", "feature"]);
    repo.git(&["-c", "user.name=t", "merge", "-q", "--no-edit", "main"]);
    repo.commit("f2.txt", "f2\n");
    // `old` sits on feature's first-parent line, but main was merged in more recently.
    assert_eq!(repo.base(None), "main");
    assert_eq!(paths(&repo.files()), ["f.txt", "f2.txt"]);
}

#[test]
fn branches_stacked_on_top_and_this_branchs_remote_copy_are_not_bases() {
    let repo = stack();
    let pushed = repo.git(&["rev-parse", "HEAD"]);
    repo.commit("b2-more.txt", "more\n");
    // origin/b2 is an older push of this branch: nearest of all, but it is this branch.
    repo.git(&["update-ref", "refs/remotes/origin/b2", &pushed]);
    repo.git(&["checkout", "-q", "-b", "b3"]);
    repo.commit("b3.txt", "b3\n");
    repo.git(&["checkout", "-q", "b2"]);
    assert_eq!(repo.base(None), "b1");
}

#[test]
fn a_given_base_is_remembered_and_wins() {
    let repo = stack();
    assert_eq!(repo.base(Some("main")), "main");
    assert_eq!(repo.git(&["config", "branch.b2.tuiReviewBase"]), "main");
    assert_eq!(repo.base(None), "main");
    assert_eq!(paths(&repo.files()), ["b1.txt", "b2.txt"]);
    // A remembered base that is gone falls back to detection.
    repo.git(&["config", "branch.b2.tuiReviewBase", "deleted"]);
    assert_eq!(repo.base(None), "b1");
}

#[test]
fn a_base_remembered_under_the_old_brv_key_still_counts() {
    let repo = stack();
    repo.git(&["config", "branch.b2.brvBase", "main"]);
    assert_eq!(repo.base(None), "main");
}

#[test]
fn a_given_base_without_shared_history_is_not_remembered() {
    let repo = stack();
    repo.git(&["checkout", "-q", "--orphan", "unrelated"]);
    repo.commit("u.txt", "u\n");
    repo.git(&["checkout", "-q", "b2"]);
    let git = tui_review::git::open(repo.path()).unwrap();
    assert!(tui_review::git::resolve(&git, Some("unrelated")).is_err());
    assert_eq!(repo.base(None), "b1");
}

#[test]
fn a_branch_started_from_origin_main_is_reviewed_against_it() {
    let repo = Repo::new();
    repo.commit("a.txt", "a\n");
    repo.git(&["branch", "stale"]);
    repo.commit("upstream.txt", "upstream\n");
    // origin/main is ahead of local main, which stays at the old commit.
    repo.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    repo.git(&["reset", "-q", "--hard", "stale"]);
    repo.git(&["checkout", "-q", "-b", "feature", "origin/main"]);
    repo.git(&["config", "branch.feature.remote", "origin"]);
    repo.git(&["config", "branch.feature.merge", "refs/heads/main"]);
    repo.commit("f.txt", "f\n");
    assert_eq!(repo.base(None), "origin/main");
    assert_eq!(paths(&repo.files()), ["f.txt"]);
}

#[test]
fn a_branch_with_nothing_to_compare_says_how_to_pick_a_base() {
    let repo = Repo::new();
    repo.commit("a.txt", "a\n");
    let git = tui_review::git::open(repo.path()).unwrap();
    let err = tui_review::git::resolve(&git, None).unwrap_err().to_string();
    assert!(err.contains("/tui-review <branch>"), "{err}");
}

#[test]
fn files_are_listed_by_kind() {
    let repo = Repo::new();
    repo.write("keep.rs", "fn a() {}\n");
    repo.write("gone.txt", "bye\n");
    repo.write("old/name.txt", "same content for a rename\nline two\nline three\n");
    repo.write("Cargo.lock", "[[package]]\nname = \"a\"\n");
    repo.write("pic.png", b"\x89PNG\0\x01\x02");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "-m", "base"]);
    repo.git(&["checkout", "-q", "-b", "change"]);
    repo.write("keep.rs", "fn a() {}\nfn b() {}\n");
    std::fs::remove_file(repo.path().join("gone.txt")).unwrap();
    std::fs::rename(repo.path().join("old"), repo.path().join("new")).unwrap();
    repo.write("Cargo.lock", "[[package]]\nname = \"b\"\n");
    repo.write("pic.png", b"\x89PNG\0\x01\x03");
    repo.write("added.py", "print(1)\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-q", "-m", "change"]);

    let files = repo.files();
    let by = |p: &str| files.iter().find(|f| f.path == p).unwrap_or_else(|| panic!("{p} missing: {:?}", paths(&files)));
    assert_eq!(paths(&files), ["Cargo.lock", "added.py", "gone.txt", "keep.rs", "new/name.txt", "pic.png"]);

    let keep = by("keep.rs");
    assert_eq!((keep.status, keep.added, keep.removed), (b'M', 1, 0));
    assert!(keep.has_code());
    assert_eq!(keep.lines.text(0), "keep.rs");
    assert_eq!(keep.lines.text(1), "@@ -1 +1,2 @@");
    assert_eq!(keep.lines.kind(3), Kind::Add as u8);
    assert_eq!(keep.blob(), keep.new.unwrap());

    let gone = by("gone.txt");
    assert_eq!((gone.status, gone.removed), (b'D', 1));
    assert_eq!(gone.blob(), gone.old.unwrap(), "a deleted file's viewed mark goes by its old blob");

    let moved = by("new/name.txt");
    assert_eq!(moved.status, b'R');
    assert_eq!(moved.lines.text(0), "old/name.txt → new/name.txt");
    assert_eq!(moved.lines.text(1), "moved without changes");

    let lock = by("Cargo.lock");
    assert_ne!(lock.flags & file_flags::COLLAPSED, 0);
    assert_eq!((lock.lines.len(), lock.added, lock.removed), (2, 1, 1));
    assert!(!lock.has_code());

    let pic = by("pic.png");
    assert_ne!(pic.flags & file_flags::BINARY, 0);
    assert_eq!(pic.lines.text(1), "binary file");

    assert_eq!(by("added.py").status, b'A');
}

#[test]
fn a_run_announces_every_chunk_and_the_next_one_is_cached() {
    let repo = stack();
    let big = (0..3000).map(|i| format!("let x{i} = {i};\n")).collect::<Vec<_>>().concat();
    repo.commit("big.rs", &big);
    let cache = tempfile::tempdir().unwrap();
    let options = Options { repo: repo.path().to_owned(), base: None, cache: Some(cache.path().to_owned()) };

    let mut out = Vec::new();
    let summary = run(&options, &mut out).unwrap();
    let out = String::from_utf8(out).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    let dir = summary.dir.display().to_string();
    // 2 files: b2.txt (3 lines), big.rs (2 + 3000): 3005 lines, 3 chunks of 1024.
    assert_eq!(summary.lines, 3005);
    assert_eq!(
        lines,
        [format!("manifest {dir}").as_str(), "text 0", "text 1", "text 2", "hl 0", "hl 1", "hl 2", "done"]
    );
    for name in ["manifest.bin", "0000.lines", "0002.lines", "0000.hl", "0002.hl", "done"] {
        assert!(summary.dir.join(name).exists(), "{name}");
    }
    assert!(
        !std::fs::read_dir(&summary.dir).unwrap().any(|e| e.unwrap().path().extension().is_some_and(|x| x == "tmp"))
    );

    let mut again = Vec::new();
    assert!(run(&options, &mut again).unwrap().cached);
    assert_eq!(String::from_utf8(again).unwrap(), format!("cached {dir}\n"));

    // A new commit is a new review.
    repo.commit("b2.txt", "b2 changed\n");
    let mut third = Vec::new();
    let summary = run(&options, &mut third).unwrap();
    assert!(!summary.cached);
    assert_ne!(summary.dir.display().to_string(), dir);
}
