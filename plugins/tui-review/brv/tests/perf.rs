//! Speed and memory budgets for `brv review` on a large synthetic repository. Ignored by default, since they want a
//! release build: `cargo test --release --test perf -- --ignored --nocapture`. A slower change fails CI instead of
//! slipping in. Measured on a 4-core Linux container (base 19 ms, first chunk 50 ms, plain 60 ms, colours 2.7 s,
//! reopen 19 ms, 19 MB heap); each budget leaves 3-5x headroom (8x for the git-bound ones) for slower CI runners,
//! Windows ones in particular.
//!
//! The fixture (2,000 files across the ten grammars, a 2,000-commit history, 600 branches, and a feature branch
//! changing every file for about 100k diff lines) is built once with `git fast-import` and kept under the target dir.

use std::alloc::{GlobalAlloc, Layout, System};
use std::fmt::Write as _;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use brv::review::{Options, run};

/// Counts live heap bytes and the peak, so the memory budget is measured rather than guessed.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

// SAFETY: forwards to the system allocator and only adds bookkeeping.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            let live = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

const FILES: usize = 2_000;
const LINES_PER_FILE: usize = 120;
const HISTORY: usize = 2_000;
const OLD_BRANCHES: usize = 500;
const SIDE_BRANCHES: usize = 100;
const EXTS: [&str; 10] = ["rs", "cs", "ts", "tsx", "js", "py", "nix", "json", "yaml", "toml"];

/// A line of plausible code in the file's language, so the highlighter does real work.
fn code(ext: &str, i: usize, salt: usize) -> String {
    match ext {
        "rs" => format!("    pub fn f{i}(x: u32) -> u32 {{ x.wrapping_add({salt}) }} // note {i}"),
        "cs" => format!("    public static int F{i}(int x) => x + {salt}; // note {i}"),
        "ts" => format!("export function f{i}(x: number): number {{ return x + {salt}; }} // {i}"),
        "tsx" => format!("export const C{i} = () => <div className=\"c{salt}\">{{{i}}}</div>;"),
        "js" => format!("export const f{i} = (x) => x + {salt}; /* note {i} */"),
        "py" => format!("def f{i}(x):  return x + {salt}  # note {i}"),
        "nix" => format!("  f{i} = x: x + {salt}; # note"),
        "json" => format!("  \"k{i}\": {{ \"v\": {salt}, \"s\": \"text {i}\" }},"),
        "yaml" => format!("k{i}: {{ v: {salt}, s: \"text\" }} # note"),
        _ => format!("k{i} = {{ v = {salt}, s = \"text\" }} # note"),
    }
}

fn file_text(file: usize, version: usize) -> String {
    let ext = EXTS[file % EXTS.len()];
    let mut text = String::new();
    for i in 0..LINES_PER_FILE {
        // The feature branch rewrites one line in 20 and adds a few, for about 100k diff lines in all.
        let changed = version > 0 && i % 20 == 0;
        let salt = if changed { 7_000 + i } else { i };
        writeln!(text, "{}", code(ext, i, salt)).unwrap();
        if changed && i % 60 == 0 {
            writeln!(text, "{}", code(ext, i + 1000, salt)).unwrap();
        }
    }
    text
}

fn path_of(file: usize) -> String {
    format!("src/m{}/f{file}.{}", file % 40, EXTS[file % EXTS.len()])
}

fn data(out: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    writeln!(out, "data {}", bytes.len())?;
    out.write_all(bytes)?;
    writeln!(out)
}

fn commit(out: &mut impl Write, branch: &str, mark: usize, from: Option<usize>, msg: &str) -> io::Result<()> {
    writeln!(out, "commit refs/heads/{branch}\nmark :{mark}")?;
    writeln!(out, "committer t <t@t> {} +0000", 1_700_000_000 + mark)?;
    data(out, msg.as_bytes())?;
    if let Some(from) = from {
        writeln!(out, "from :{from}")?;
    }
    Ok(())
}

/// Builds the fixture once; later runs reuse it.
fn fixture() -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("brv-perf-v3");
    if dir.join(".git/brv-fixture-done").exists() {
        return dir;
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let git = |args: &[&str]| {
        let ok = Command::new("git").args(args).current_dir(&dir).status().unwrap().success();
        assert!(ok, "git {args:?}");
    };
    git(&["init", "-q", "-b", "main"]);
    let mut child =
        Command::new("git").args(["fast-import", "--quiet"]).current_dir(&dir).stdin(Stdio::piped()).spawn().unwrap();
    let mut out = io::BufWriter::new(child.stdin.take().unwrap());
    let started = Instant::now();
    // 1: every file. 2..=HISTORY: one small edit each, for history depth.
    commit(&mut out, "main", 1, None, "base").unwrap();
    for f in 0..FILES {
        writeln!(out, "M 100644 inline {}", path_of(f)).unwrap();
        data(&mut out, file_text(f, 0).as_bytes()).unwrap();
    }
    for m in 2..=HISTORY {
        commit(&mut out, "main", m, Some(m - 1), "edit").unwrap();
        writeln!(out, "M 100644 inline notes/n{}.md", m % 50).unwrap();
        data(&mut out, format!("edit {m}\n").as_bytes()).unwrap();
    }
    // Branches merged long ago (tips on main's line) and side branches with work of their own.
    for b in 0..OLD_BRANCHES {
        writeln!(out, "reset refs/heads/old-{b}\nfrom :{}", 1 + b * (HISTORY - 1) / OLD_BRANCHES).unwrap();
    }
    for b in 0..SIDE_BRANCHES {
        let mark = HISTORY + 1 + b;
        commit(&mut out, &format!("side-{b}"), mark, Some(1 + b * (HISTORY - 1) / SIDE_BRANCHES), "side").unwrap();
        writeln!(out, "M 100644 inline side/{b}.txt").unwrap();
        data(&mut out, b"side\n").unwrap();
    }
    // The feature branch: every file changed, cut from main's tip.
    commit(&mut out, "feature", HISTORY + SIDE_BRANCHES + 1, Some(HISTORY), "feature").unwrap();
    for f in 0..FILES {
        writeln!(out, "M 100644 inline {}", path_of(f)).unwrap();
        data(&mut out, file_text(f, 1).as_bytes()).unwrap();
    }
    out.flush().unwrap();
    drop(out);
    assert!(child.wait().unwrap().success());
    git(&["symbolic-ref", "HEAD", "refs/heads/feature"]);
    git(&["commit-graph", "write", "--reachable"]);
    std::fs::write(dir.join(".git/brv-fixture-done"), "").unwrap();
    eprintln!("fixture built in {:?}", started.elapsed());
    dir
}

/// Records when each protocol line arrives.
struct Timed {
    started: Instant,
    first_text: Option<Duration>,
    buf: Vec<u8>,
}

impl Write for Timed {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(bytes);
        if self.first_text.is_none() && self.buf.windows(7).any(|w| w == b"\ntext 0") {
            self.first_text = Some(self.started.elapsed());
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Prints a measure against its budget, and records it when over: every measure prints before the test fails.
fn check(over: &mut Vec<String>, name: &str, took: Duration, budget: Duration) {
    eprintln!("{name:<38} {took:>10.1?}   budget {budget:?}");
    if took > budget {
        over.push(format!("{name}: {took:?} is over its {budget:?} budget"));
    }
}

#[test]
#[ignore = "release-mode budgets: cargo test --release --test perf -- --ignored"]
fn review_budgets() {
    let repo = fixture();
    let cache = tempfile::tempdir().unwrap();
    let options = Options { repo: repo.clone(), base: None, cache: Some(cache.path().to_owned()) };

    let started = Instant::now();
    let git = brv::git::open(&repo).unwrap();
    let range = brv::git::resolve(&git, None).unwrap();
    let detect = started.elapsed();
    assert_eq!(range.base_name, "main");

    let peak_before = LIVE.load(Ordering::Relaxed);
    PEAK.store(peak_before, Ordering::Relaxed);
    let mut out = Timed { started: Instant::now(), first_text: None, buf: Vec::new() };
    let summary = run(&options, &mut out).unwrap();
    let peak = PEAK.load(Ordering::Relaxed) - peak_before;
    eprintln!("{} files, {} diff lines, {} threads", summary.files, summary.lines, rayon::current_num_threads());
    assert_eq!(summary.files, FILES);
    assert!(summary.lines > 90_000, "{} lines", summary.lines);

    let largest = std::fs::read_dir(&summary.dir).unwrap().map(|e| e.unwrap().metadata().unwrap().len()).max().unwrap();

    let reopen = Instant::now();
    assert!(run(&options, io::sink()).unwrap().cached);
    let reopen = reopen.elapsed();

    eprintln!();
    let mut over = Vec::new();
    // Git-bound: a cold first open on a Windows runner took 74 ms where Linux takes 19.
    check(&mut over, "base detection (600 branches)", detect, Duration::from_millis(150));
    check(&mut over, "manifest + first chunk", out.first_text.unwrap(), Duration::from_millis(300));
    // Windows pays for each chunk file's create and rename (a GitHub runner: 1 s for the plain pass, 6.3 s for colours,
    // where Linux takes 60 ms and 2.7 s); the first chunk, what the pane waits for, stays fast on both.
    let (plain, colour) = if cfg!(windows) { (2500, 12) } else { (300, 8) };
    check(&mut over, "plain pass", summary.resolve + summary.text, Duration::from_millis(plain));
    check(&mut over, "highlight pass", summary.colour, Duration::from_secs(colour));
    check(&mut over, "reopen with a complete cache", reopen, Duration::from_millis(150));
    eprintln!("{:<38} {:>7} MB   budget 100 MB", "peak heap", peak / 1_000_000);
    if peak >= 100_000_000 {
        over.push(format!("peak heap {peak} bytes"));
    }
    eprintln!("{:<38} {:>7} KB   budget 1024 KB", "largest cache file", largest / 1024);
    if largest > 1024 * 1024 {
        over.push(format!("largest cache file {largest} bytes"));
    }
    assert!(over.is_empty(), "{}", over.join("\n"));
}
