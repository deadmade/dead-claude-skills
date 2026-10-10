//! Chunk encoding: what `brv` pays per 1,024 diff lines on the way to disk.

use brv::format::{CHUNK_LINES, HlChunk, Kind, LinesChunk, span};

fn main() {
    divan::main();
}

fn sample_line(i: usize) -> String {
    // One line in eight indented with a tab, as Go or a Makefile would be.
    let indent = if i.is_multiple_of(8) { "\t" } else { "    " };
    format!("{indent}let value_{i}: Option<usize> = review(\"chunk\", {i}, &mut cells); // keep")
}

#[divan::bench]
fn encode_lines_chunk(bencher: divan::Bencher) {
    let lines: Vec<String> = (0..CHUNK_LINES).map(sample_line).collect();
    bencher
        .counter(divan::counter::ItemsCount::new(CHUNK_LINES))
        .bench(|| {
            let mut chunk = LinesChunk::default();
            for (i, line) in lines.iter().enumerate() {
                chunk.push(Kind::Add, 0, u32::try_from(i).unwrap_or(0), line);
            }
            chunk.encode()
        });
}

#[divan::bench]
fn encode_hl_chunk(bencher: divan::Bencher) {
    bencher
        .counter(divan::counter::ItemsCount::new(CHUNK_LINES))
        .bench(|| {
            let mut chunk = HlChunk::default();
            for _ in 0..CHUNK_LINES {
                chunk.push_line((0..8u16).map(|s| span(s * 6, 5, 1)));
            }
            chunk.encode()
        });
}
