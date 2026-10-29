//! Writes the data the default extensions' views get, from an index over the fixture home (`fixtures/home/`, set up the way
//! `tests/index.rs` does), to `extensions/tests/fixtures/*.json` for the views' tests. Run with
//! `cargo test -p flow-cockpit-core --test dump_view_fixtures -- --ignored`.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use flow_cockpit_core::activity::TranscriptCache;
use flow_cockpit_core::index::{Config, DocName, Entry, Home, Index, LinkCache};
use jiff::Timestamp;
use serde_json::{Value, json};

const HOUR: i64 = 3600;
const DAY: i64 = 24 * HOUR;
/// What the temp folder's path becomes in the written JSON, so the fixtures don't change from run to run.
const SHOWN_ROOT: &str = "/home/you";

fn now() -> Timestamp {
    "2026-01-20T12:00:00Z".parse().unwrap()
}

fn ago(secs: i64) -> Timestamp {
    Timestamp::from_second(now().as_second() - secs).unwrap()
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

/// The fixture home in a fresh temp folder, with the `.git` folders git can't hold and fixed mtimes.
fn world(root: &Path) -> (Home, Config) {
    fs::remove_dir_all(root).ok();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/home");
    copy_tree(&fixture, root, &root.to_string_lossy());
    git_dir(
        &root.join("work/alpha"),
        "[remote \"origin\"]\n\turl = git@github.com:Acme/alpha.git\n",
    );
    git_dir(
        &root.join("work/alpha-2"),
        "[remote \"origin\"]\n\turl = https://github.com/acme/alpha\n",
    );
    for plain in ["a/solo", "b/solo", "work/secret"] {
        git_dir(&root.join(plain), "[core]\n\tbare = false\n");
    }
    // beta moved from old/beta (no `.git` left) to work/beta; git's stale record of the old worktree stays.
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
    // A live worktree of delta that sits inside gamma's `.claude/worktrees/`.
    git_dir(
        &root.join("work/gamma"),
        "[remote \"origin\"]\n\turl = git@github.com:acme/gamma.git\n",
    );
    git_dir(
        &root.join("work/delta"),
        "[remote \"origin\"]\n\turl = git@github.com:acme/delta.git\n",
    );
    let d_admin = root.join("work/delta/.git/worktrees/d");
    let d = root.join("work/gamma/.claude/worktrees/d");
    fs::create_dir_all(&d_admin).unwrap();
    fs::write(
        d_admin.join("gitdir"),
        format!("{}\n", d.join(".git").display()),
    )
    .unwrap();
    fs::write(d.join(".git"), format!("gitdir: {}\n", d_admin.display())).unwrap();
    let home = Home {
        claude_projects: root.join("claude/projects"),
        capture_dir: root.join("capture"),
    };
    for dir in fs::read_dir(&home.claude_projects).unwrap() {
        for file in fs::read_dir(dir.unwrap().path()).unwrap() {
            let file = file.unwrap().path();
            let old = file.file_name().is_some_and(|n| n == "s-old.jsonl");
            touch(&file, ago(if old { 10 * DAY } else { HOUR }));
        }
    }
    for (rel, secs) in [
        ("work/alpha/docs/features/login/flow.md", 3 * HOUR),
        (
            "work/alpha/.claude/worktrees/x/docs/features/login/flow.md",
            2 * HOUR,
        ),
        // Waiting, but older than login's session: "needs you first" and "latest activity" order the runs apart.
        ("work/alpha/docs/features/signup/flow.md", 4 * HOUR),
        (
            "work/alpha/.worktrees/y/docs/features/spiky/flow.md",
            5 * DAY,
        ),
    ] {
        touch(&root.join(rel), ago(secs));
    }
    let config = Config::load(&root.join("config.toml")).unwrap();
    (home, config)
}

fn write(dir: &Path, name: &str, value: &Value, root: &str) {
    let text = serde_json::to_string_pretty(value)
        .expect("plain data serialises")
        .replace(root, SHOWN_ROOT)
        + "\n";
    let path = dir.join(name);
    fs::write(&path, text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

/// Each session as one page of all its turns (`sessions.json`; the views' tests page it themselves), and every tool
/// call's input by `<session>/<call id>` (`inputs.json`).
#[derive(Default)]
struct Sessions {
    cache: TranscriptCache,
    pages: BTreeMap<String, Value>,
    inputs: BTreeMap<String, Value>,
}

impl Sessions {
    fn add(&mut self, index: &Index, id: &str) {
        let Some(path) = index.session_path(id) else {
            self.pages.insert(id.to_string(), Value::Null);
            return;
        };
        let page = self.cache.page(&path, None, usize::MAX);
        for call in page.turns.iter().flat_map(|t| &t.tools) {
            let input = self.cache.tool_input(&path, &call.id);
            self.inputs
                .insert(format!("{id}/{}", call.id), json!(input));
        }
        self.pages.insert(id.to_string(), json!(page));
    }
}

#[test]
#[ignore = "writes the views' test fixtures; run by hand"]
fn dump_view_fixtures() {
    let root: PathBuf =
        std::env::temp_dir().join(format!("flow-cockpit-views-{}", std::process::id()));
    let (home, config) = world(&root);
    let mut index = Index::build(&home, &config, now());
    index.scan_links(&mut LinkCache::default());
    let shown = root.to_string_lossy().replace('\\', "\\\\");

    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extensions/tests/fixtures");
    fs::create_dir_all(&out).unwrap();

    let projects = index.projects();
    let mut entries = BTreeMap::new();
    let mut runs = BTreeMap::new();
    let mut docs = BTreeMap::new();
    let mut sessions = Sessions::default();
    for project in &projects {
        let list = index.entries(&project.id);
        for entry in &list {
            match entry {
                Entry::FlowRun(run) => {
                    let key = format!("{}/{}", project.id, run.slug);
                    runs.insert(key.clone(), json!(index.flow_run(&project.id, &run.slug)));
                    let texts: BTreeMap<_, _> = [
                        ("Flow", DocName::Flow),
                        ("Spec", DocName::Spec),
                        ("Plan", DocName::Plan),
                    ]
                    .into_iter()
                    .map(|(k, name)| (k, index.doc(&project.id, &run.slug, name)))
                    .collect();
                    docs.insert(key, json!(texts));
                    for id in index
                        .flow_run(&project.id, &run.slug)
                        .map(|r| r.sessions)
                        .unwrap_or_default()
                    {
                        sessions.add(&index, &id);
                    }
                }
                Entry::Loose(s) => sessions.add(&index, &s.id),
                Entry::Audit(_) => {}
            }
        }
        entries.insert(project.id.clone(), json!(list));
    }
    write(&out, "projects.json", &json!(projects), &shown);
    write(&out, "entries.json", &json!(entries), &shown);
    write(&out, "runs.json", &json!(runs), &shown);
    write(&out, "docs.json", &json!(docs), &shown);
    write(&out, "sessions.json", &json!(sessions.pages), &shown);
    write(&out, "inputs.json", &json!(sessions.inputs), &shown);
    fs::remove_dir_all(&root).ok();
}
