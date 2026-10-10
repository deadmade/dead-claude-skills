//! `brv gen`: a synthetic review cache, for the mod's spike and its budget tests. It writes the same files and prints
//! the same progress lines as `brv review`, with code-like text and highlight spans of a realistic density.

use std::fmt::Write as _;
use std::io::{self, Write};
use std::path::Path;
use std::time::Instant;

use anyhow::Result;

use crate::cache::{LinesWriter, Progress, finish, write_manifest};
use crate::format::{
    CHUNK_LINES, FileRecord, Kind, MAX_COLS, Manifest, Meta, Strings, count, file_flags, span,
};
use crate::styles::Style;

/// Small, fast, deterministic: the same `--seed` gives the same cache.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        // n is small; the remainder fits.
        usize::try_from(self.next() % n as u64).unwrap_or(0)
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len())]
    }
}

const KEYWORDS: &[&str] = &[
    "let", "fn", "pub", "if", "else", "match", "return", "for", "in", "async", "await", "impl",
];
const IDENTS: &[&str] = &[
    "review", "chunk", "offset", "cells", "manifest", "base", "head", "frame", "span", "style",
    "cursor", "width", "height", "buffer", "result", "context", "options", "index", "value",
    "parent",
];
const TYPES: &[&str] = &[
    "Vec<u8>",
    "String",
    "Option<usize>",
    "Result<()>",
    "HashMap<String, u32>",
    "Path",
];
const EXTS: &[&str] = &[
    "rs", "ts", "tsx", "cs", "py", "nix", "json", "yaml", "toml", "sh",
];

/// One generated line and the spans a highlighter would give it.
fn code_line(rng: &mut Rng, text: &mut String, spans: &mut Vec<u32>) {
    text.clear();
    spans.clear();
    let indent = rng.below(4) * 4;
    text.extend(std::iter::repeat_n(' ', indent));
    let mut push = |text: &mut String, s: &str, style: Option<Style>| {
        let col = text.chars().count();
        text.push_str(s);
        if let Some(style) = style
            && col < MAX_COLS
        {
            let len = s.chars().count().min(MAX_COLS - col);
            // Both are under MAX_COLS (512).
            spans.push(span(
                u16::try_from(col).unwrap_or(0),
                u16::try_from(len).unwrap_or(0),
                style as u8,
            ));
        }
    };
    match rng.below(10) {
        0 => push(
            text,
            &format!(
                "// {} the {} before {}",
                rng.pick(IDENTS),
                rng.pick(IDENTS),
                rng.pick(IDENTS)
            ),
            Some(Style::Comment),
        ),
        1 => {}
        _ => {
            push(text, rng.pick(KEYWORDS), Some(Style::Keyword));
            push(text, " ", None);
            push(text, rng.pick(IDENTS), Some(Style::Variable));
            push(text, ": ", Some(Style::Punctuation));
            push(text, rng.pick(TYPES), Some(Style::Type));
            push(text, " = ", Some(Style::Operator));
            push(text, rng.pick(IDENTS), Some(Style::Function));
            push(text, "(", Some(Style::Punctuation));
            if rng.below(2) == 0 {
                push(
                    text,
                    &format!("\"{}\"", rng.pick(IDENTS)),
                    Some(Style::String),
                );
            } else {
                push(text, &rng.below(4096).to_string(), Some(Style::Number));
            }
            push(text, ");", Some(Style::Punctuation));
            // An occasional very long line, as minified or generated code has.
            if rng.below(200) == 0 {
                let long = format!(" {}", rng.pick(IDENTS).repeat(60));
                push(text, &long, Some(Style::Variable));
            }
        }
    }
}

/// A file to generate: its path and its hunks as (deleted, added) line counts.
struct Planned {
    path: String,
    hunks: Vec<(usize, usize)>,
}

impl Planned {
    /// The file header, then per hunk its header, 3 + 3 lines of context and the changed lines.
    fn line_count(&self) -> usize {
        1 + self
            .hunks
            .iter()
            .map(|(del, add)| 1 + 6 + del + add)
            .sum::<usize>()
    }
}

/// Plans files until they add up to `lines`, so the manifest (file list with counts) can go out before any chunk.
fn plan(rng: &mut Rng, lines: usize) -> Vec<Planned> {
    let mut planned = Vec::new();
    let mut total = 0;
    while total < lines {
        let ext = rng.pick(EXTS);
        let path = format!(
            "src/{}/{}_{}.{ext}",
            rng.pick(IDENTS),
            rng.pick(IDENTS),
            planned.len()
        );
        let hunks = (0..=rng.below(4))
            .map(|_| (rng.below(12), rng.below(16)))
            .collect();
        let file = Planned { path, hunks };
        total += file.line_count();
        planned.push(file);
    }
    planned
}

fn manifest(rng: &mut Rng, planned: &[Planned]) -> Manifest {
    let mut strings = Strings::default();
    let mut files = Vec::with_capacity(planned.len());
    let mut first_line = 0;
    for (i, p) in planned.iter().enumerate() {
        let line_count = count(p.line_count());
        let flags = if i % 97 == 96 {
            file_flags::COLLAPSED
        } else {
            0
        };
        files.push(FileRecord {
            path: strings.add(&p.path),
            blob: strings.add(&format!("{:040x}", rng.next())),
            status_flags: u32::from(b'M') | (flags << 8),
            added: count(p.hunks.iter().map(|h| h.1).sum()),
            removed: count(p.hunks.iter().map(|h| h.0).sum()),
            first_line,
            line_count,
        });
        first_line += line_count;
    }
    let meta = Meta {
        total_lines: first_line,
        chunk_lines: count(CHUNK_LINES),
        base_name: strings.add("main"),
        head_name: strings.add("demo"),
        base_sha: strings.add(&"b".repeat(40)),
        head_sha: strings.add(&"d".repeat(40)),
        merge_base_sha: strings.add(&"b".repeat(40)),
    };
    Manifest {
        meta,
        files,
        strings,
    }
}

fn write_file<W: Write>(rng: &mut Rng, out: &mut LinesWriter<W>, file: &Planned) -> Result<()> {
    let (mut text, mut spans) = (String::new(), Vec::new());
    out.push(Kind::File, 0, 0, &file.path, &[])?;
    let mut old = 1 + count(rng.below(50));
    let mut new = old;
    for &(del, add) in &file.hunks {
        let mut header = String::new();
        write!(
            header,
            "@@ -{old},{} +{new},{} @@ fn {}()",
            6 + del,
            6 + add,
            rng.pick(IDENTS)
        )?;
        out.push(Kind::Hunk, 0, 0, &header, &[])?;
        for i in 0..3 + del + add + 3 {
            code_line(rng, &mut text, &mut spans);
            let (kind, o, n) = if i < 3 || i >= 3 + del + add {
                (Kind::Context, old, new)
            } else if i < 3 + del {
                (Kind::Del, old, 0)
            } else {
                (Kind::Add, 0, new)
            };
            out.push(kind, o, n, &text, &spans)?;
            old += u32::from(o != 0);
            new += u32::from(n != 0);
        }
        let gap = 5 + count(rng.below(80));
        old += gap;
        new += gap;
    }
    Ok(())
}

/// Writes a cache of about `lines` diff lines under `dir` and prints the progress protocol.
///
/// # Errors
/// When the directory or a file in it cannot be written, or stdout is closed.
pub fn run(dir: &Path, lines: usize, seed: u64) -> Result<()> {
    let started = Instant::now();
    std::fs::create_dir_all(dir)?;
    let mut rng = Rng(seed | 1);
    let planned = plan(&mut rng, lines);
    let manifest = manifest(&mut rng, &planned);
    let mut progress = Progress(io::stdout().lock());
    write_manifest(dir, &manifest, &mut progress)?;
    // The real review writes colours in a second pass; here they are known at once, so they go out with the text.
    let mut out = LinesWriter::new(dir, &mut progress, true);
    for file in &planned {
        write_file(&mut rng, &mut out, file)?;
    }
    out.flush()?;
    finish(dir, &mut progress)?;
    eprintln!(
        "brv gen: {} lines, {} files in {:?}",
        manifest.meta.total_lines,
        manifest.files.len(),
        started.elapsed()
    );
    Ok(())
}
