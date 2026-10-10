//! The review's text: which files changed between the merge-base and HEAD, and each one's hunks as diff lines.

use std::borrow::Cow;
use std::path::Path;

use anyhow::Result;
use gix::ObjectId;
use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached as Change;
use imara_diff::{Algorithm, Diff, Hunk, InternedInput};
use rayon::prelude::*;

use crate::format::{Kind, LinesChunk, count, file_flags};
use crate::git::Range;

/// Unchanged lines shown around each change, as `git diff` does.
pub const CONTEXT: u32 = 3;
/// Bytes git looks at to call a file binary.
const BINARY_SNIFF: usize = 8000;
/// A side bigger than this is listed, not diffed.
const MAX_BLOB: usize = 32 * 1024 * 1024;

/// One changed file as it goes into the cache.
pub struct FileDiff {
    /// The path comments and viewed marks refer to: the new path, or the old one for a deletion.
    pub path: String,
    /// `A`, `M`, `D`, `R` (renamed) or `C` (copied).
    pub status: u8,
    pub old: Option<ObjectId>,
    pub new: Option<ObjectId>,
    pub added: u32,
    pub removed: u32,
    pub flags: u32,
    /// The file's header line, then its hunks; or its header and one note.
    pub lines: LinesChunk,
}

impl FileDiff {
    /// Whether its lines are code worth colouring: not binary, not collapsed, not a note.
    #[must_use]
    pub fn has_code(&self) -> bool {
        self.flags & (file_flags::BINARY | file_flags::COLLAPSED) == 0
            && self.lines.len() > 1
            && self.lines.kind(1) == Kind::Hunk as u8
    }

    /// The new blob's id, or the old one's for a deletion: what "viewed" marks are kept under.
    #[must_use]
    pub fn blob(&self) -> ObjectId {
        self.new
            .or(self.old)
            .unwrap_or_else(|| ObjectId::null(gix::hash::Kind::Sha1))
    }
}

/// A file the trees disagree on: where it was and is, and the blobs on each side.
struct Changed {
    path: String,
    old_path: Option<String>,
    status: u8,
    old: Option<ObjectId>,
    new: Option<ObjectId>,
    mode_only: bool,
}

/// Every changed file between `range.merge_base` and `range.head`, diffed, in path order.
///
/// # Errors
/// When a commit, tree or blob cannot be read.
pub fn review(repo: &gix::Repository, range: &Range) -> Result<Vec<FileDiff>> {
    let changed = changed_files(repo, range)?;
    let sync = repo.clone().into_sync();
    changed
        .into_par_iter()
        .map_init(
            || sync.to_thread_local(),
            |repo, file| diff_file(repo, &file),
        )
        .collect()
}

fn changed_files(repo: &gix::Repository, range: &Range) -> Result<Vec<Changed>> {
    let old_tree = repo.find_commit(range.merge_base)?.tree()?;
    let new_tree = repo.find_commit(range.head)?.tree()?;
    let mut options = gix::diff::Options::default();
    options.track_path();
    options.track_rewrites(Some(gix::diff::Rewrites::default()));
    let path = |p: &gix::bstr::BString| p.to_str_lossy().into_owned();
    let mut out = Vec::new();
    for change in repo.diff_tree_to_tree(&old_tree, &new_tree, options)? {
        let file = match change {
            Change::Addition {
                location,
                entry_mode,
                id,
                ..
            } if entry_mode.is_blob_or_symlink() => Changed {
                path: path(&location),
                old_path: None,
                status: b'A',
                old: None,
                new: Some(id),
                mode_only: false,
            },
            Change::Deletion {
                location,
                entry_mode,
                id,
                ..
            } if entry_mode.is_blob_or_symlink() => Changed {
                path: path(&location),
                old_path: None,
                status: b'D',
                old: Some(id),
                new: None,
                mode_only: false,
            },
            Change::Modification {
                location,
                previous_entry_mode,
                previous_id,
                entry_mode,
                id,
            } if entry_mode.is_blob_or_symlink() && previous_entry_mode.is_blob_or_symlink() => {
                Changed {
                    path: path(&location),
                    old_path: None,
                    status: b'M',
                    old: Some(previous_id),
                    new: Some(id),
                    mode_only: previous_id == id,
                }
            }
            Change::Rewrite {
                source_location,
                source_id,
                location,
                id,
                entry_mode,
                copy,
                ..
            } if entry_mode.is_blob_or_symlink() => Changed {
                path: path(&location),
                old_path: Some(path(&source_location)),
                status: if copy { b'C' } else { b'R' },
                old: Some(source_id),
                new: Some(id),
                mode_only: false,
            },
            // Trees and submodules: their files are listed one by one, and a submodule's commits are not ours.
            _ => continue,
        };
        out.push(file);
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn blob<'a>(
    repo: &gix::Repository,
    id: Option<ObjectId>,
    buf: &'a mut Vec<u8>,
) -> Result<&'a [u8]> {
    buf.clear();
    if let Some(id) = id {
        let object = repo.find_object(id)?;
        buf.extend_from_slice(&object.data);
    }
    Ok(buf)
}

fn diff_file(repo: &mut gix::Repository, file: &Changed) -> Result<FileDiff> {
    let mut lines = LinesChunk::default();
    let header = match &file.old_path {
        Some(old) => format!("{old} → {}", file.path),
        None => file.path.clone(),
    };
    lines.push(Kind::File, 0, 0, &header);
    let mut out = FileDiff {
        path: file.path.clone(),
        status: file.status,
        old: file.old,
        new: file.new,
        added: 0,
        removed: 0,
        flags: 0,
        lines,
    };
    if file.mode_only {
        out.lines
            .push(Kind::Note, 0, 0, "mode changed, content unchanged");
        return Ok(out);
    }
    if file.old.is_some() && file.old == file.new {
        out.lines.push(Kind::Note, 0, 0, "moved without changes");
        return Ok(out);
    }
    let (mut old_buf, mut new_buf) = (Vec::new(), Vec::new());
    let old = blob(repo, file.old, &mut old_buf)?;
    let new = blob(repo, file.new, &mut new_buf)?;
    if old.len() > MAX_BLOB || new.len() > MAX_BLOB {
        out.lines.push(Kind::Note, 0, 0, "too large to show");
        return Ok(out);
    }
    if is_binary(old) || is_binary(new) {
        out.flags |= file_flags::BINARY;
        out.lines.push(Kind::Note, 0, 0, "binary file");
        return Ok(out);
    }
    let (old, new) = (String::from_utf8_lossy(old), String::from_utf8_lossy(new));
    let mut hunks = LinesChunk::default();
    let (added, removed) = hunk_lines(&old, &new, &mut hunks);
    out.added = added;
    out.removed = removed;
    if is_collapsed(&file.path) {
        out.flags |= file_flags::COLLAPSED;
        out.lines.push(
            Kind::Note,
            0,
            0,
            &format!("+{added} −{removed}, not shown: lockfile or generated"),
        );
    } else {
        for i in 0..hunks.len() {
            out.lines.push_from(&hunks, i);
        }
    }
    Ok(out)
}

/// Git's rule: a NUL in the first 8000 bytes.
#[must_use]
pub fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(BINARY_SNIFF)].contains(&0)
}

/// Lockfiles, minified and generated files: listed with their counts, not shown line by line.
#[must_use]
pub fn is_collapsed(path: &str) -> bool {
    const NAMES: &[&str] = &[
        "Cargo.lock",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lock",
        "bun.lockb",
        "flake.lock",
        "poetry.lock",
        "uv.lock",
        "Pipfile.lock",
        "Gemfile.lock",
        "composer.lock",
        "go.sum",
        "packages.lock.json",
        "pubspec.lock",
        "mix.lock",
    ];
    let name = path.rsplit('/').next().unwrap_or(path);
    NAMES.contains(&name)
        || name.contains(".min.")
        || has_ext(name, "map")
        || has_ext(name, "snap")
        || path.split('/').any(|part| part == "__generated__")
}

fn has_ext(name: &str, ext: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// Appends the hunks turning `old` into `new`, with [`CONTEXT`] lines around each change; returns (added, removed).
pub fn hunk_lines(old: &str, new: &str, out: &mut LinesChunk) -> (u32, u32) {
    let input = InternedInput::new(old, new);
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    diff.postprocess_lines(&input);
    let hunks: Vec<Hunk> = diff.hunks().collect();
    let before = |i: u32| line(&input.interner[input.before[i as usize]]);
    let after = |i: u32| line(&input.interner[input.after[i as usize]]);
    let (old_len, new_len) = (count(input.before.len()), count(input.after.len()));

    let mut start = 0;
    let mut prev_end = 0;
    while start < hunks.len() {
        // Hunks closer than two contexts apart share one header, as in `git diff`.
        let mut end = start;
        while end + 1 < hunks.len()
            && hunks[end + 1].before.start - hunks[end].before.end <= 2 * CONTEXT
        {
            end += 1;
        }
        let first = &hunks[start];
        let last = &hunks[end];
        let lead = CONTEXT.min(first.before.start - prev_end);
        let trail = CONTEXT.min(old_len - last.before.end);
        let (old_from, new_from) = (first.before.start - lead, first.after.start - lead);
        let (old_to, new_to) = (
            last.before.end + trail,
            (last.after.end + trail).min(new_len),
        );
        let header = format!(
            "@@ -{} +{} @@",
            span_label(old_from, old_to - old_from),
            span_label(new_from, new_to - new_from)
        );
        out.push(Kind::Hunk, 0, 0, &header);

        // Unchanged lines sit at a fixed offset between the sides; `shift` is new minus old, wrapping when negative.
        let context = |out: &mut LinesChunk, from: u32, to: u32, shift: u32| {
            for o in from..to {
                let n = o.wrapping_add(shift);
                out.push(Kind::Context, o + 1, n + 1, &after(n));
            }
        };
        let shift = |h: &Hunk| h.after.start.wrapping_sub(h.before.start);
        context(out, old_from, first.before.start, shift(first));
        for (k, h) in hunks[start..=end].iter().enumerate() {
            for o in h.before.clone() {
                out.push(Kind::Del, o + 1, 0, &before(o));
            }
            for n in h.after.clone() {
                out.push(Kind::Add, 0, n + 1, &after(n));
            }
            let next_start = hunks
                .get(start + k + 1)
                .filter(|_| start + k < end)
                .map_or(old_to, |n| n.before.start);
            context(
                out,
                h.before.end,
                next_start,
                h.after.end.wrapping_sub(h.before.end),
            );
        }
        prev_end = last.before.end;
        start = end + 1;
    }
    (diff.count_additions(), diff.count_removals())
}

/// `start,count` as in a hunk header (1-based; an empty side names the line before it).
fn span_label(start: u32, len: u32) -> String {
    match len {
        0 => format!("{start},0"),
        1 => format!("{}", start + 1),
        _ => format!("{},{len}", start + 1),
    }
}

/// A line's text without its line ending.
fn line<'a>(token: &&'a str) -> Cow<'a, str> {
    Cow::Borrowed(token.trim_end_matches(['\n', '\r']))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(chunk: &LinesChunk) -> Vec<String> {
        (0..chunk.len())
            .map(|i| {
                let sign = match chunk.kind(i) {
                    k if k == Kind::Add as u8 => "+",
                    k if k == Kind::Del as u8 => "-",
                    k if k == Kind::Context as u8 => " ",
                    _ => "",
                };
                format!(
                    "{sign}{}|{}|{}",
                    chunk.text(i),
                    chunk.old_no(i),
                    chunk.new_no(i)
                )
            })
            .collect()
    }

    #[test]
    fn hunks_have_context_numbers_and_merge_when_close() {
        let old: String = (1..=20)
            .map(|i| format!("l{i}\n"))
            .collect::<Vec<_>>()
            .concat();
        let new = old
            .replace("l5\n", "L5\n")
            .replace("l8\n", "")
            .replace("l19\n", "l19\nnew\n");
        let mut out = LinesChunk::default();
        let (added, removed) = hunk_lines(&old, &new, &mut out);
        assert_eq!((added, removed), (2, 2));
        assert_eq!(
            render(&out),
            [
                "@@ -2,10 +2,9 @@|0|0",
                " l2|2|2",
                " l3|3|3",
                " l4|4|4",
                "-l5|5|0",
                "+L5|0|5",
                " l6|6|6",
                " l7|7|7",
                "-l8|8|0",
                " l9|9|8",
                " l10|10|9",
                " l11|11|10",
                "@@ -17,4 +16,5 @@|0|0",
                " l17|17|16",
                " l18|18|17",
                " l19|19|18",
                "+new|0|19",
                " l20|20|20",
            ]
        );
    }

    #[test]
    fn new_and_deleted_files_are_one_hunk() {
        let mut out = LinesChunk::default();
        hunk_lines("", "a\nb\n", &mut out);
        assert_eq!(render(&out), ["@@ -0,0 +1,2 @@|0|0", "+a|0|1", "+b|0|2"]);
        let mut out = LinesChunk::default();
        hunk_lines("a\r\n", "", &mut out);
        assert_eq!(render(&out), ["@@ -1 +0,0 @@|0|0", "-a|1|0"]);
    }

    #[test]
    fn lockfiles_and_minified_collapse() {
        assert!(is_collapsed("Cargo.lock"));
        assert!(is_collapsed("web/package-lock.json"));
        assert!(is_collapsed("dist/app.min.js"));
        assert!(!is_collapsed("src/lock.rs"));
        assert!(is_binary(b"PNG\0\x01"));
        assert!(!is_binary(b"text"));
    }
}
