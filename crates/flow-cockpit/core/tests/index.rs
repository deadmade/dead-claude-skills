//! The index over a fake home. The committed `fixtures/home/` is copied to a fresh temp folder (`{ROOT}` in its text
//! files becomes that folder), because git can't hold a `.git` folder: the repositories' `.git/config`, a worktree's
//! `.git/worktrees/*/gitdir` and the 50 MB transcript are written here. `now` is fixed and the files' mtimes are set
//! from it, so no test reads the clock.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use flow_cockpit_core::index::{
    Config, DocName, Entry, FlowRunSummary, Home, Index, LinkCache, Project, Status,
};
use jiff::Timestamp;

const HOUR: i64 = 3600;
const DAY: i64 = 24 * HOUR;

fn now() -> Timestamp {
    "2026-01-20T12:00:00Z".parse().unwrap()
}

fn ago(secs: i64) -> Timestamp {
    Timestamp::from_second(now().as_second() - secs).unwrap()
}

/// A copy of the fixture home in its own temp folder, removed when dropped (also on a failed assert).
struct World {
    root: PathBuf,
    home: Home,
    config: Config,
}

impl Drop for World {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).ok();
    }
}

fn copy_tree(from: &Path, to: &Path, root: &str) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        // `.claude` and `.superpowers` are git-ignored here, so the fixture keeps them as `_claude` and `_superpowers`.
        let name = match entry.file_name().to_string_lossy().as_ref() {
            "_claude" => ".claude".to_string(),
            "_superpowers" => ".superpowers".to_string(),
            other => other.to_string(),
        };
        let target = to.join(name);
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target, root);
            continue;
        }
        let text = fs::read_to_string(entry.path()).unwrap();
        let is_json = entry.path().extension().is_some_and(|e| e == "jsonl");
        let root = if is_json {
            root.replace('\\', "\\\\")
        } else {
            root.to_string()
        };
        fs::write(target, text.replace("{ROOT}", &root)).unwrap();
    }
}

fn touch(path: &Path, at: Timestamp) {
    OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(SystemTime::from(at))
        .unwrap();
}

fn git_dir(repo: &Path, config: &str) {
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::write(repo.join(".git/config"), config).unwrap();
}

impl World {
    fn new(tag: &str) -> World {
        let root =
            std::env::temp_dir().join(format!("flow-cockpit-index-{}-{tag}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/home");
        copy_tree(&fixture, &root, &root.to_string_lossy());

        git_dir(
            &root.join("work/alpha"),
            "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:Acme/alpha.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
        );
        git_dir(
            &root.join("work/alpha-2"),
            "[remote \"origin\"]\n\turl = https://github.com/acme/alpha\n",
        );
        for plain in ["a/solo", "b/solo", "work/secret"] {
            git_dir(&root.join(plain), "[core]\n\tbare = false\n");
        }
        // A worktree git itself made, somewhere no convention names, found through the main checkout's .git.
        let z = root.join("elsewhere/z");
        fs::create_dir_all(&z).unwrap();
        let admin = root.join("work/alpha/.git/worktrees/z");
        fs::create_dir_all(&admin).unwrap();
        fs::write(
            admin.join("gitdir"),
            format!("{}\n", z.join(".git").display()),
        )
        .unwrap();
        fs::write(z.join(".git"), format!("gitdir: {}\n", admin.display())).unwrap();
        // beta moved from old/beta to work/beta: git still records the old worktree, whose folder was left behind
        // without its `.git` file, under the old checkout that has no `.git` at all.
        git_dir(
            &root.join("work/beta"),
            "[remote \"origin\"]\n\turl = git@github.com:acme/beta.git\n",
        );
        let stale = root.join("work/beta/.git/worktrees/old");
        fs::create_dir_all(&stale).unwrap();
        fs::write(
            stale.join("gitdir"),
            format!(
                "{}\n",
                root.join("old/beta/.claude/worktrees/old/.git").display()
            ),
        )
        .unwrap();

        let world = World {
            home: Home {
                claude_projects: root.join("claude/projects"),
                capture_dir: root.join("capture"),
            },
            config: Config::load(&root.join("config.toml")).unwrap(),
            root,
        };
        // Every session was last written an hour ago, the old one ten days ago; x's flow.md is newer than alpha's.
        for dir in fs::read_dir(&world.home.claude_projects).unwrap() {
            for file in fs::read_dir(dir.unwrap().path()).unwrap() {
                let file = file.unwrap().path();
                let old = file.file_name().is_some_and(|n| n == "s-old.jsonl");
                touch(&file, ago(if old { 10 * DAY } else { HOUR }));
            }
        }
        touch(
            &world.path("work/alpha/docs/features/login/flow.md"),
            ago(3 * HOUR),
        );
        touch(
            &world.path("work/alpha/.claude/worktrees/x/docs/features/login/flow.md"),
            ago(2 * HOUR),
        );
        world
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn index(&self) -> Index {
        Index::build(&self.home, &self.config, now())
    }

    fn scanned(&self) -> Index {
        let mut index = self.index();
        index.scan_links(&mut LinkCache::default());
        index
    }
}

fn project(index: &Index, name: &str) -> Project {
    index
        .projects()
        .into_iter()
        .find(|p| p.name == name)
        .unwrap_or_else(|| panic!("no project {name}"))
}

fn runs(index: &Index, project: &Project) -> Vec<FlowRunSummary> {
    index
        .entries(&project.id)
        .into_iter()
        .filter_map(|e| match e {
            Entry::FlowRun(r) => Some(r),
            _ => None,
        })
        .collect()
}

fn loose(index: &Index, project: &Project) -> Vec<String> {
    index
        .entries(&project.id)
        .into_iter()
        .filter_map(|e| match e {
            Entry::Loose(s) => Some(s.id),
            _ => None,
        })
        .collect()
}

fn run<'a>(runs: &'a [FlowRunSummary], slug: &str) -> &'a FlowRunSummary {
    runs.iter()
        .find(|r| r.slug == slug)
        .unwrap_or_else(|| panic!("no run {slug}"))
}

#[test]
fn folds_checkouts_by_remote() {
    let w = World::new("remote");
    let index = w.index();
    let alpha = project(&index, "alpha");
    for checkout in ["work/alpha", "work/alpha-2"] {
        assert!(alpha.roots.contains(&w.path(checkout)), "{checkout}");
    }
    assert_eq!(
        index
            .projects()
            .iter()
            .filter(|p| p.name == "alpha")
            .count(),
        1
    );
}

#[test]
fn folds_by_folder_name_without_remote() {
    let w = World::new("folder");
    let index = w.index();
    let solo = project(&index, "solo");
    assert_eq!(solo.roots, [w.path("a/solo"), w.path("b/solo")]);
}

#[test]
fn finds_worktrees_without_sessions() {
    let w = World::new("worktrees");
    let alpha = project(&w.index(), "alpha");
    for worktree in [
        "work/alpha/.claude/worktrees/x",
        "work/alpha/.worktrees/y",
        "elsewhere/z",
    ] {
        assert!(alpha.roots.contains(&w.path(worktree)), "{worktree}");
    }
}

#[test]
fn every_root_is_in_one_project() {
    let w = World::new("one-owner");
    let projects = w.index().projects();
    let mut owners: BTreeMap<PathBuf, Vec<String>> = BTreeMap::new();
    for p in &projects {
        for root in &p.roots {
            owners.entry(root.clone()).or_default().push(p.id.clone());
        }
    }
    let shared: Vec<_> = owners.iter().filter(|(_, ids)| ids.len() > 1).collect();
    assert!(shared.is_empty(), "roots in several projects: {shared:?}");

    // The leftover worktree stays with the remote-less folder it sits in; git's stale record doesn't claim it.
    let beta: Vec<_> = projects.iter().filter(|p| p.name == "beta").collect();
    assert_eq!(beta.len(), 2);
    let remote = beta.iter().find(|p| !p.id.starts_with("folder-")).unwrap();
    let folder = beta.iter().find(|p| p.id.starts_with("folder-")).unwrap();
    assert_eq!(remote.roots, [w.path("work/beta")]);
    assert_eq!(
        folder.roots,
        [w.path("old/beta"), w.path("old/beta/.claude/worktrees/old")]
    );
}

#[test]
fn hidden_project_is_left_out() {
    let w = World::new("hidden");
    let index = w.index();
    assert!(index.projects().iter().all(|p| p.name != "secret"));
    assert!(index.session("s-secret").is_none());
}

#[test]
fn newest_copy_wins() {
    let w = World::new("newest");
    let alpha = project(&w.index(), "alpha");
    let runs_now = runs(&w.index(), &alpha);
    let login = run(&runs_now, "login");
    assert_eq!((login.phase.as_str(), login.copies), ("build", 2));

    touch(
        &w.path("work/alpha/docs/features/login/flow.md"),
        ago(HOUR / 2),
    );
    let runs_later = runs(&w.index(), &alpha);
    let login = run(&runs_later, "login");
    assert_eq!((login.phase.as_str(), login.copies), ("spec", 2));
}

#[test]
fn finds_audits_with_picks_state() {
    let w = World::new("audits");
    let index = w.index();
    let alpha = project(&index, "alpha");
    let audits: Vec<_> = index
        .entries(&alpha.id)
        .into_iter()
        .filter_map(|e| match e {
            Entry::Audit(a) => Some(a),
            _ => None,
        })
        .collect();
    // Newest first.
    assert_eq!(audits.len(), 2);
    let a = &audits[0];
    assert_eq!(a.file, "2026-01-05-test-audit-installer.md");
    assert_eq!(
        (a.date.as_str(), a.conductor.as_str()),
        ("2026-01-05", "test-audit")
    );
    assert!(a.scope.as_deref().is_some_and(|s| s.contains("feat-x")));
    let severities: Vec<_> = a
        .findings_by_severity
        .iter()
        .map(|(s, n)| (s.as_str(), *n))
        .collect();
    assert_eq!(severities, [("high", 1), ("med", 1), ("low", 1)]);
    assert_eq!(a.open, Some(true));
    assert_eq!((a.picks, a.fixed), (Some(2), 1));

    // Without a `Picks:` line the state is unknown and nothing counts as picked.
    let b = &audits[1];
    assert_eq!(b.file, "2026-01-03-doc-audit-readme.md");
    assert_eq!(b.conductor, "doc-audit");
    assert_eq!((b.open, b.picks, b.fixed), (None, None, 0));
}

#[test]
fn session_links_by_editing_flow_md() {
    let w = World::new("links");
    let index = w.index();
    let alpha = project(&index, "alpha");
    assert!(loose(&index, &alpha).contains(&"s-link".to_string()));

    let scanned = w.scanned();
    let login = scanned.flow_run(&alpha.id, "login").unwrap();
    assert_eq!(login.sessions, ["s-link"]);
    assert!(!loose(&scanned, &alpha).contains(&"s-link".to_string()));
}

#[test]
fn mention_does_not_link() {
    let w = World::new("mention");
    let index = w.scanned();
    let alpha = project(&index, "alpha");
    let login = index.flow_run(&alpha.id, "login").unwrap();
    assert!(!login.sessions.contains(&"s-mention".to_string()));
    assert!(loose(&index, &alpha).contains(&"s-mention".to_string()));
}

#[test]
fn loose_sessions_only_last_7_days() {
    let w = World::new("loose");
    let index = w.scanned();
    let alpha = project(&index, "alpha");
    let mut ids = loose(&index, &alpha);
    ids.sort();
    assert_eq!(ids, ["s-mention", "s-wt"]);
    let summary = index
        .entries(&alpha.id)
        .into_iter()
        .find_map(|e| match e {
            Entry::Loose(s) if s.id == "s-mention" => Some(s),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        summary.first_prompt.as_deref(),
        Some("Read docs/features/login/flow.md and summarise it.")
    );
    assert_eq!(summary.started, "2026-01-19T11:00:00.000Z");
}

#[test]
fn flow_run_reads_its_documents() {
    let w = World::new("run");
    let index = w.scanned();
    let alpha = project(&index, "alpha");
    let login = index.flow_run(&alpha.id, "login").unwrap();
    let s = &login.summary;
    assert_eq!(
        (s.conductor.as_str(), s.phase.as_str()),
        ("feature", "build")
    );
    assert_eq!(s.gates.len(), 2);
    assert_eq!(s.open_deviations, 1);
    assert_eq!(s.progress, Some((1, 2)));
    assert_eq!(login.plan.unwrap().tasks.len(), 2);
    assert_eq!(login.ledger.unwrap().tasks.len(), 2);
    let flow = index.doc(&alpha.id, "login", DocName::Flow).unwrap();
    assert!(flow.contains("Building task 2 of 2."));
    assert!(index.doc(&alpha.id, "login", DocName::Spec).is_none());
    assert!(index.flow_run(&alpha.id, "nope").is_none());
}

#[test]
fn session_reads_its_activity() {
    let w = World::new("activity");
    let index = w.index();
    let turns = index.session("s-wt").unwrap().turns;
    assert_eq!(turns.len(), 1);
    assert!(index.session("nope").is_none());
}

#[test]
fn run_statuses_come_from_documents_and_transcripts() {
    let w = World::new("statuses");
    let alpha = project(&w.index(), "alpha");

    let idle = w.scanned();
    let runs_idle = runs(&idle, &alpha);
    assert_eq!(run(&runs_idle, "login").status, Status::Idle);
    assert_eq!(run(&runs_idle, "spiky").status, Status::Done);

    // The linked transcript grew a minute ago.
    touch(&w.path("claude/projects/-work-alpha/s-link.jsonl"), ago(60));
    let working = w.scanned();
    let runs_working = runs(&working, &alpha);
    assert_eq!(run(&runs_working, "login").status, Status::Working);

    let waiting_text = "---\nflow: feature\nphase: plan\nnow: Waiting for you to approve the plan (Gate 2).\n---\n";
    fs::write(
        w.path("work/alpha/.claude/worktrees/x/docs/features/login/flow.md"),
        waiting_text,
    )
    .unwrap();
    let waiting = w.scanned();
    let runs_waiting = runs(&waiting, &alpha);
    assert_eq!(run(&runs_waiting, "login").status, Status::Waiting);
}

#[test]
fn rebuild_project_touches_one_project() {
    let w = World::new("rebuild");
    let mut index = w.index();
    let alpha = project(&index, "alpha");
    let solo = project(&index, "solo");
    let solo_before = index.entries(&solo.id);

    // Both projects change on disk; only alpha is rebuilt.
    fs::write(
        w.path("work/alpha/.claude/worktrees/x/docs/features/login/flow.md"),
        "---\nflow: feature\nphase: review\n---\n",
    )
    .unwrap();
    let new_run = w.path("a/solo/docs/features/fresh");
    fs::create_dir_all(&new_run).unwrap();
    fs::write(
        new_run.join("flow.md"),
        "---\nflow: fix\nphase: build\n---\n",
    )
    .unwrap();

    index.rebuild_project(&alpha.id, now());
    let alpha_runs = runs(&index, &alpha);
    assert_eq!(run(&alpha_runs, "login").phase, "review");
    assert_eq!(index.entries(&solo.id), solo_before);

    index.rebuild_project(&solo.id, now());
    let solo_runs = runs(&index, &solo);
    assert_eq!(run(&solo_runs, "fresh").phase, "build");
}

/// A 50 MB transcript in alpha that ends with a Write of login's flow.md.
fn write_big(w: &World) -> PathBuf {
    let big = w.path("claude/projects/-work-alpha/s-big.jsonl");
    let cwd = w.path("work/alpha").to_string_lossy().replace('\\', "\\\\");
    let filler = "x".repeat(1024 * 1024);
    let mut file = fs::File::create(&big).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","message":{{"role":"user","content":"Big one."}},"timestamp":"2026-01-19T09:00:00.000Z","cwd":"{cwd}"}}"#
    )
    .unwrap();
    for _ in 0..50 {
        writeln!(
            file,
            r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{filler}"}}]}},"timestamp":"2026-01-19T09:00:01.000Z"}}"#
        )
        .unwrap();
    }
    writeln!(
        file,
        r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"t9","name":"Write","input":{{"file_path":"{cwd}/docs/features/login/flow.md","content":"x"}}}}]}},"timestamp":"2026-01-19T09:30:00.000Z"}}"#
    )
    .unwrap();
    drop(file);
    touch(&big, ago(HOUR));
    big
}

#[test]
fn second_link_scan_reads_under_2mb() {
    let w = World::new("big");
    write_big(&w);
    let mut index = w.index();
    let mut cache = LinkCache::default();
    index.scan_links(&mut cache);
    let first = cache.bytes_read();
    assert!(first >= 50 * 1024 * 1024, "first scan read {first}");
    let alpha = project(&index, "alpha");
    let login = index.flow_run(&alpha.id, "login").unwrap();
    assert!(login.sessions.contains(&"s-big".to_string()));

    index.scan_links(&mut cache);
    let second = cache.bytes_read() - first;
    assert!(second < 2 * 1024 * 1024, "second scan read {second}");
}

#[test]
fn grown_transcript_scans_only_its_tail() {
    let w = World::new("tail");
    let big = write_big(&w);
    let fresh = w.path("work/alpha/docs/features/fresh");
    fs::create_dir_all(&fresh).unwrap();
    fs::write(fresh.join("flow.md"), "---\nflow: fix\nphase: build\n---\n").unwrap();

    let mut index = w.index();
    let mut cache = LinkCache::default();
    index.scan_links(&mut cache);
    let first = cache.bytes_read();
    let alpha = project(&index, "alpha");
    let before = index.flow_run(&alpha.id, "fresh").unwrap().sessions;
    assert_eq!(before, Vec::<String>::new());

    // The live session writes about 1 KB more: an edit of the other run's flow.md.
    let cwd = w.path("work/alpha").to_string_lossy().replace('\\', "\\\\");
    let pad = "y".repeat(900);
    let mut file = OpenOptions::new().append(true).open(&big).unwrap();
    writeln!(
        file,
        r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{pad}"}},{{"type":"tool_use","id":"t10","name":"Edit","input":{{"file_path":"{cwd}/docs/features/fresh/flow.md","old_string":"a","new_string":"b"}}}}]}},"timestamp":"2026-01-19T09:40:00.000Z"}}"#
    )
    .unwrap();
    drop(file);

    index.scan_links(&mut cache);
    let second = cache.bytes_read() - first;
    assert!(second < 2 * 1024 * 1024, "second scan read {second}");
    let fresh_run = index.flow_run(&alpha.id, "fresh").unwrap();
    assert_eq!(fresh_run.sessions, ["s-big"]);
    let login = index.flow_run(&alpha.id, "login").unwrap();
    assert!(login.sessions.contains(&"s-big".to_string()));
}

#[test]
fn refresh_moves_statuses_and_cutoffs_with_the_clock() {
    let w = World::new("refresh");
    touch(&w.path("claude/projects/-work-alpha/s-link.jsonl"), ago(60));
    let mut index = w.scanned();
    let alpha = project(&index, "alpha");
    let login_status = |index: &Index| run(&runs(index, &alpha), "login").status;
    assert_eq!(login_status(&index), Status::Working);

    let later = |secs: i64| Timestamp::from_second(now().as_second() + secs).unwrap();
    index.refresh(later(3 * 60));
    assert_eq!(login_status(&index), Status::Idle);

    index.refresh(later(4 * DAY));
    assert_eq!(login_status(&index), Status::Stale);
    assert!(loose(&index, &alpha).contains(&"s-wt".to_string()));

    index.refresh(later(8 * DAY));
    assert_eq!(loose(&index, &alpha), Vec::<String>::new());
}

#[test]
fn rebuild_finds_a_session_in_a_worktree_made_since() {
    let w = World::new("newwt");
    let mut index = w.index();
    let alpha = project(&index, "alpha");

    let worktree = w.path("work/alpha/.worktrees/w");
    fs::create_dir_all(&worktree).unwrap();
    let folder: String = worktree
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = w.path("claude/projects").join(folder);
    fs::create_dir_all(&dir).unwrap();
    let cwd = worktree.to_string_lossy().replace('\\', "\\\\");
    let session = dir.join("s-new.jsonl");
    fs::write(
        &session,
        format!(
            r#"{{"type":"user","message":{{"role":"user","content":"New worktree."}},"timestamp":"2026-01-20T11:00:00.000Z","cwd":"{cwd}"}}"#
        ) + "\n",
    )
    .unwrap();
    touch(&session, ago(60));

    index.rebuild_project(&alpha.id, now());
    assert!(loose(&index, &alpha).contains(&"s-new".to_string()));
    assert!(project(&index, "alpha").roots.contains(&worktree));
}
