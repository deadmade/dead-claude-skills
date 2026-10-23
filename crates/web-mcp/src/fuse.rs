//! Merging one search's engines: URL normalisation, RRF over the engines' lists, and the final order.

#![cfg_attr(not(test), allow(dead_code))]

use std::collections::HashMap;

use url::Url;

use crate::engines::{Engine, Found};
use crate::rank::{Hit, rrf};

/// A URL's identity across engines: lowercase host without `www.`, no fragment, no tracking
/// parameters, no trailing `/` on a non-root path; the scheme stays.
pub fn normalise(u: &Url) -> String {
    let mut u = u.clone();
    u.set_fragment(None);
    let kept: Vec<(String, String)> = u
        .query_pairs()
        .filter(|(k, _)| !(k.starts_with("utm_") || k == "gclid" || k == "fbclid"))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if kept.is_empty() {
        u.set_query(None);
    } else {
        u.query_pairs_mut().clear().extend_pairs(kept);
    }
    let path = u.path();
    if path.len() > 1 && path.ends_with('/') {
        let trimmed = path.trim_end_matches('/').to_owned();
        u.set_path(&trimmed);
    }
    let host = u.host_str().unwrap_or("");
    let host = host.strip_prefix("www.").unwrap_or(host);
    let port = u.port().map_or(String::new(), |p| format!(":{p}"));
    let query = u.query().map_or(String::new(), |q| format!("?{q}"));
    format!("{}://{host}{port}{}{query}", u.scheme(), u.path())
}

/// One result after fusing: the first-seen URL and title, and every engine that returned it.
#[derive(Debug, Clone)]
pub struct Fused {
    pub url: Url,
    pub title: String,
    pub snippets: Vec<String>,
    pub engines: Vec<Engine>,
    pub score: f32,
}

/// RRF over the engines' lists (rank = position), results matched by `normalise`d URL.
pub fn fuse(lists: &[(Engine, Vec<Found>)], k: f32) -> Vec<Fused> {
    let mut out: Vec<Fused> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for (engine, list) in lists {
        for (rank, f) in list.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)] // ranks are small
            let s = 1.0 / (k + (rank + 1) as f32);
            let i = *at.entry(normalise(&f.url)).or_insert_with(|| {
                out.push(Fused {
                    url: f.url.clone(),
                    title: f.title.clone(),
                    snippets: Vec::new(),
                    engines: Vec::new(),
                    score: 0.0,
                });
                out.len() - 1
            });
            let r = &mut out[i];
            r.score += s;
            if !r.engines.contains(engine) {
                r.engines.push(*engine);
            }
            if !f.snippet.is_empty() && !r.snippets.contains(&f.snippet) {
                r.snippets.push(f.snippet.clone());
            }
        }
    }
    // Stable: equal scores keep first-seen order, which is the first list's.
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    out
}

/// RRF of BM25's order and the same hits in the engines' order (`url_rank` by `normalise`d URL, unknown
/// last, BM25 order breaking ties), cut to `k`.
pub fn final_order(bm25: Vec<Hit>, url_rank: &HashMap<String, usize>, k: usize) -> Vec<Hit> {
    let mut by_engines = bm25.clone();
    by_engines.sort_by_key(|h| {
        Url::parse(&h.doc.url)
            .ok()
            .and_then(|u| url_rank.get(&normalise(&u)).copied())
            .unwrap_or(usize::MAX)
    });
    let mut fused = rrf(&[bm25, by_engines], 60.0);
    fused.truncate(k);
    fused
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::{Engine, Found};
    use crate::rank::{Hit, MemIndex, PassageDoc};
    use std::collections::HashMap;
    use url::Url;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn found(url: &str, snippet: &str) -> Found {
        Found {
            url: u(url),
            title: format!("title of {url}"),
            snippet: snippet.into(),
        }
    }

    fn doc(text: &str, url: &str) -> PassageDoc {
        PassageDoc {
            text: text.into(),
            url: url.into(),
            title: "T".into(),
            path: String::new(),
            fetched: String::new(),
        }
    }

    #[test]
    fn normalise_merges_variants() {
        assert_eq!(
            normalise(&u("https://www.Example.com/a/?utm_source=x#top")),
            normalise(&u("https://example.com/a"))
        );
        assert_eq!(
            normalise(&u("https://example.com/")),
            "https://example.com/"
        );
        assert_eq!(
            normalise(&u("https://example.com/a?id=1&fbclid=z&gclid=y")),
            "https://example.com/a?id=1"
        );
        assert_ne!(
            normalise(&u("http://example.com/a")),
            normalise(&u("https://example.com/a"))
        );
    }

    #[test]
    fn fuse_rewards_agreement() {
        let g = vec![
            found("https://g0.com/", ""),
            found("https://g1.com/", ""),
            found("https://both.com/", ""),
        ];
        let b = vec![
            found("https://b0.com/", ""),
            found("https://b1.com/", ""),
            found("https://www.both.com", ""),
        ];
        let fused = fuse(&[(Engine::Google, g), (Engine::Bing, b)], 60.0);
        assert_eq!(fused[0].url.as_str(), "https://both.com/");
        assert_eq!(fused[0].engines, [Engine::Google, Engine::Bing]);
        assert!((fused[0].score - 2.0 / 63.0).abs() < 1e-6);
    }

    #[test]
    fn fuse_keeps_distinct_snippets_once() {
        let a = vec![found("https://x.com/p", "one")];
        let b = vec![
            found("https://x.com/p/", "one"),
            found("https://y.com/", ""),
        ];
        let c = vec![found("https://x.com/p#f", "two")];
        let fused = fuse(
            &[(Engine::Google, a), (Engine::Bing, b), (Engine::Brave, c)],
            60.0,
        );
        assert_eq!(fused.len(), 2);
        assert_eq!(fused[0].snippets, ["one", "two"]);
        assert_eq!(fused[0].url.as_str(), "https://x.com/p");
        assert_eq!(fused[0].title, "title of https://x.com/p");
        assert_eq!(fused[1].snippets.len(), 0);
    }

    #[test]
    fn mem_index_ranks_only_given_docs() {
        let idx = MemIndex::new(vec![
            doc("tokio select cancel", "https://a/"),
            doc("unrelated cooking", "https://b/"),
        ])
        .unwrap();
        let hits = idx.search("tokio cancel", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc.url, "https://a/");
    }

    #[test]
    fn mem_index_collapses_duplicates() {
        let idx = MemIndex::new(vec![
            doc("same words", "https://a/"),
            doc("same words", "https://a/"),
            doc("same words", "https://b/"),
        ])
        .unwrap();
        assert_eq!(idx.search("same", 10).unwrap().len(), 2);
    }

    #[test]
    fn final_order_prefers_engine_top_on_bm25_tie() {
        let hit = |url: &str| Hit {
            doc: doc("t", url),
            score: 1.0,
        };
        let bm25 = vec![
            hit("https://a.com/"),
            hit("https://b.com/"),
            hit("https://c.com/"),
        ];
        let ranks: HashMap<String, usize> = [("https://c.com/", 0), ("https://a.com/", 1)]
            .map(|(k, v)| (k.to_owned(), v))
            .into();
        let got = final_order(bm25, &ranks, 2);
        let urls: Vec<_> = got.iter().map(|h| h.doc.url.as_str()).collect();
        assert_eq!(urls, ["https://a.com/", "https://c.com/"]);
        // Without the engines' help the BM25 order stands.
        let b = vec![hit("https://a.com/"), hit("https://b.com/")];
        assert_eq!(
            final_order(b, &HashMap::new(), 5)[1].doc.url,
            "https://b.com/"
        );
    }
}
