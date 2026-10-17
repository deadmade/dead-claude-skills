//! Diff and highlight throughput, for digging into a failed `tests/perf.rs` budget: `cargo bench --bench review`.

use brv::diff::{FileDiff, hunk_lines};
use brv::format::{Kind, LinesChunk};
use brv::highlight::row_spans;
use divan::Bencher;
use tree_sitter_highlight::Highlighter;

fn main() {
    divan::main();
}

/// A Rust file of `lines` lines, and the same file with one line in 20 changed.
fn sources(lines: usize) -> (String, String) {
    let line = |i: usize, salt: usize| format!("    pub fn f{i}(x: u32) -> u32 {{ x.wrapping_add({salt}) }} // note\n");
    let old = (0..lines).map(|i| line(i, i)).collect::<Vec<_>>().concat();
    let new = (0..lines).map(|i| line(i, if i % 20 == 0 { i + 7 } else { i })).collect::<Vec<_>>().concat();
    (old, new)
}

#[divan::bench(args = [1_000, 10_000])]
fn diff(bencher: Bencher, lines: usize) {
    let (old, new) = sources(lines);
    bencher.counter(divan::counter::ItemsCount::new(lines)).bench(|| {
        let mut out = LinesChunk::default();
        hunk_lines(divan::black_box(&old), divan::black_box(&new), &mut out)
    });
}

#[divan::bench(args = [1_000, 10_000])]
fn highlight(bencher: Bencher, lines: usize) {
    let (old, new) = sources(lines);
    let mut chunk = LinesChunk::default();
    chunk.push(Kind::File, 0, 0, "a.rs");
    let (added, removed) = hunk_lines(&old, &new, &mut chunk);
    let file =
        FileDiff { path: "a.rs".into(), status: b'M', old: None, new: None, added, removed, flags: 0, lines: chunk };
    let mut highlighter = Highlighter::new();
    bencher
        .counter(divan::counter::ItemsCount::new(lines * 2))
        .bench_local(|| row_spans(&file, &old, &new, &mut highlighter));
}
