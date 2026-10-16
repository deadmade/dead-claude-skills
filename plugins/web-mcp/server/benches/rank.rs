// Standalone bench: the crate is a binary, so pull the modules in by path.
#![allow(dead_code, unused_imports)]
#[path = "../src/passages.rs"]
mod passages;
#[path = "../src/rank.rs"]
mod rank;

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use rank::{Index, PassageDoc};

fn doc(i: usize, text: String) -> PassageDoc {
    PassageDoc {
        text,
        url: format!("https://example.com/{}", i / 20),
        title: "Bench".into(),
        path: "pages/bench/page.md".into(),
        fetched: "2026-10-17T12:00:00Z".into(),
    }
}

/// ~300 tokens of varied words, unique per `i`.
fn passage(i: usize) -> String {
    (0..240)
        .map(|w| format!("w{} ", (i * 7919 + w * 104_729) % 5000))
        .chain([format!("unique{i}")])
        .collect()
}

fn bench(c: &mut Criterion) {
    let article = include_str!("../tests/fixtures/article.html").repeat(20);
    c.bench_function("split/article×20", |b| {
        b.iter(|| passages::split(black_box(&article)));
    });

    let rt = tokio::runtime::Runtime::new().unwrap();
    let web = std::env::temp_dir().join(format!("web-mcp-bench-rank-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&web);
    let idx = Index::open(&web).unwrap();
    rt.block_on(idx.add((0..10_000).map(|i| doc(i, passage(i))).collect()))
        .unwrap();
    c.bench_function("search/10k", |b| {
        b.iter(|| {
            idx.search(black_box("w42 w1337 w4999 unique77"), 10)
                .unwrap()
        });
    });

    // One page's worth of passages per add, as fetch does; includes opening the writer.
    let mut n = 10_000;
    c.bench_function("add_batch/20", |b| {
        b.iter(|| {
            let docs = (n..n + 20).map(|i| doc(i, passage(i))).collect();
            n += 20;
            rt.block_on(idx.add(docs)).unwrap();
        });
    });
    drop(idx);
    let _ = std::fs::remove_dir_all(&web);
}

criterion_group!(benches, bench);
criterion_main!(benches);
