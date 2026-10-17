//! `brv review`: diffs HEAD against its base into a cache the mod paints from, announcing each piece on stdout.
//!
//! Pass 1 writes the manifest and every `NNNN.lines` chunk (plain text, the pane can draw at once); pass 2 writes the
//! `NNNN.hl` colours. A complete cache is keyed by merge-base, HEAD and base, so reopening the same review only prints
//! `cached <dir>`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use rayon::prelude::*;
use tree_sitter_highlight::Highlighter;

use crate::cache::{HlWriter, LinesWriter, Progress, finish, write_manifest};
use crate::diff::{self, FileDiff};
use crate::format::{CHUNK_LINES, FileRecord, Manifest, Meta, Strings, VERSION, count};
use crate::git::{self, Range};
use crate::highlight;

/// Complete reviews kept per repository; older ones are removed after a new one is written.
const KEEP: usize = 5;
/// Files highlighted together before their colours are written: enough to keep every core busy, few enough that
/// memory stays flat and the first `hl` chunk goes out early.
const BATCH: usize = 64;

pub struct Options {
    /// Where to look for the repository; its root is found upward from here.
    pub repo: PathBuf,
    /// The base to review against, as typed; remembered for the branch.
    pub base: Option<String>,
    /// Where review caches go; defaults to `<git common dir>/brv`.
    pub cache: Option<PathBuf>,
}

/// What a run did, for `brv bench` and the stderr summary.
#[derive(Debug, Clone, Default)]
pub struct Summary {
    pub dir: PathBuf,
    pub cached: bool,
    pub files: usize,
    pub lines: u32,
    pub base: String,
    pub resolve: Duration,
    pub text: Duration,
    pub colour: Duration,
}

/// Runs a review, writing the protocol to `out`.
///
/// # Errors
/// When the repository, its objects or the cache cannot be read or written.
pub fn run<W: Write>(options: &Options, out: W) -> Result<Summary> {
    let mut progress = Progress(out);
    let started = Instant::now();
    let repo = git::open(&options.repo)?;
    let range = git::resolve(&repo, options.base.as_deref())?;
    let root = options.cache.clone().unwrap_or_else(|| repo.common_dir().join("brv"));
    let dir = root.join(dir_name(&range));
    let mut summary = Summary { dir: dir.clone(), base: range.base_name.clone(), ..Summary::default() };
    summary.resolve = started.elapsed();

    if dir.join("done").exists() {
        // Touched so pruning sees it as recent.
        crate::format::write_atomic(&dir.join("used"), b"")?;
        progress.say(format_args!("cached {}", dir.display()))?;
        summary.cached = true;
        return Ok(summary);
    }
    fs::create_dir_all(&dir).with_context(|| format!("cannot create {}", dir.display()))?;

    let files = diff::review(&repo, &range)?;
    let manifest = manifest(&range, &files);
    summary.files = files.len();
    summary.lines = manifest.meta.total_lines;
    write_manifest(&dir, &manifest, &mut progress)?;
    let mut text = LinesWriter::new(&dir, &mut progress, false);
    for file in &files {
        text.push_all(&file.lines)?;
    }
    text.flush()?;
    summary.text = started.elapsed().saturating_sub(summary.resolve);

    colour(&repo, &files, &dir, &mut progress)?;
    summary.colour = started.elapsed().saturating_sub(summary.resolve + summary.text);
    finish(&dir, &mut progress)?;
    prune(&root, &dir);
    Ok(summary)
}

/// `v<format>-<merge-base>-<head>-<base>`: a new commit, a moved base or a different base each get their own cache.
fn dir_name(range: &Range) -> String {
    let base: String = range
        .base_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' { c } else { '_' })
        .take(40)
        .collect();
    format!("v{VERSION}-{}-{}-{base}", short(range.merge_base), short(range.head))
}

fn short(id: gix::ObjectId) -> String {
    id.to_hex_with_len(12).to_string()
}

fn manifest(range: &Range, files: &[FileDiff]) -> Manifest {
    let mut strings = Strings::default();
    let mut records = Vec::with_capacity(files.len());
    let mut first_line = 0;
    for file in files {
        let line_count = count(file.lines.len());
        records.push(FileRecord {
            path: strings.add(&file.path),
            blob: strings.add(&file.blob().to_string()),
            status_flags: u32::from(file.status) | (file.flags << 8),
            added: file.added,
            removed: file.removed,
            first_line,
            line_count,
        });
        first_line += line_count;
    }
    let meta = Meta {
        total_lines: first_line,
        chunk_lines: count(CHUNK_LINES),
        base_name: strings.add(&range.base_name),
        head_name: strings.add(&range.head_name),
        base_sha: strings.add(&range.base.to_string()),
        head_sha: strings.add(&range.head.to_string()),
        merge_base_sha: strings.add(&range.merge_base.to_string()),
    };
    Manifest { meta, files: records, strings }
}

/// Pass 2: highlights files a batch at a time on every core and writes the colours in line order.
fn colour<W: Write>(repo: &gix::Repository, files: &[FileDiff], dir: &Path, progress: &mut Progress<W>) -> Result<()> {
    let sync = repo.clone().into_sync();
    let mut out = HlWriter::new(dir, progress);
    for batch in files.chunks(BATCH) {
        let rows: Vec<Vec<Vec<u32>>> = batch
            .par_iter()
            .map_init(
                || (sync.to_thread_local(), Highlighter::new(), Vec::new(), Vec::new()),
                |(repo, highlighter, old, new), file| {
                    if !file.has_code() || highlight::Lang::of(&file.path).is_none() {
                        return Ok(vec![Vec::new(); file.lines.len()]);
                    }
                    let old = text(repo, file.old, old)?;
                    let new = text(repo, file.new, new)?;
                    Ok(highlight::row_spans(file, &old, &new, highlighter))
                },
            )
            .collect::<Result<_>>()?;
        for file in rows {
            for spans in file {
                out.push_line(spans)?;
            }
        }
    }
    out.flush()?;
    Ok(())
}

fn text<'a>(
    repo: &gix::Repository,
    id: Option<gix::ObjectId>,
    buf: &'a mut Vec<u8>,
) -> Result<std::borrow::Cow<'a, str>> {
    buf.clear();
    if let Some(id) = id {
        buf.extend_from_slice(&repo.find_object(id)?.data);
    }
    Ok(String::from_utf8_lossy(buf))
}

/// Removes all but the [`KEEP`] most recently used reviews under `root`; `current` always stays. Best effort: a
/// cache another process still writes may fail to go, and is tried again next time.
fn prune(root: &Path, current: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path() != current && e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.0));
    for (_, dir) in dirs.into_iter().skip(KEEP - 1) {
        let _ = fs::remove_dir_all(dir);
    }
}
