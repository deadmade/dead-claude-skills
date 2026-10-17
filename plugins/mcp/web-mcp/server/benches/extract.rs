// Standalone bench: the crate is a binary, so pull the module in by path.
#![allow(dead_code, unused_imports)]
#[path = "../src/extract.rs"]
mod extract;

use criterion::{Criterion, criterion_group, criterion_main};
use std::hint::black_box;
use url::Url;

fn bench(c: &mut Criterion) {
    let base = Url::parse("https://example.com/blog/post").unwrap();
    let article = include_str!("../tests/fixtures/article.html");
    // ~1 MB: the article body repeated inside one <article>.
    let (head, rest) = article.split_once("<article>").unwrap();
    let (body, tail) = rest.split_once("</article>").unwrap();
    let big = format!(
        "{head}<article>{}</article>{tail}",
        body.repeat(1_000_000 / body.len())
    );

    c.bench_function("extract_html/article", |b| {
        b.iter(|| extract::extract_html(black_box(article), &base));
    });
    c.bench_function("extract_html/1MB", |b| {
        b.iter(|| extract::extract_html(black_box(&big), &base));
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
