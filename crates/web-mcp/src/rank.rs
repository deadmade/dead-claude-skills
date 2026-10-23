//! BM25 over one search's own passages, in RAM, and reciprocal rank fusion.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use sha2::{Digest, Sha256};
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, STORED, STRING, Schema, TEXT, Value as _};
use tantivy::{IndexReader, IndexWriter, TantivyDocument};

/// tantivy's smallest writer arena (`MEMORY_BUDGET_NUM_BYTES_MIN`, not exported); one per batch.
const ARENA: usize = 15_000_000;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassageDoc {
    pub text: String,
    pub url: String,
    pub title: String,
    /// The archived copy, relative to `.web`.
    pub path: String,
    /// RFC 3339.
    pub fetched: String,
}

#[derive(Clone, Debug)]
pub struct Hit {
    pub doc: PassageDoc,
    pub score: f32,
}

#[derive(Clone, Copy)]
struct Fields {
    text: Field,
    url: Field,
    title: Field,
    path: Field,
    fetched: Field,
    hash: Field,
}

/// The passage schema (text is indexed with tantivy's default tokenizer).
fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let f = Fields {
        text: b.add_text_field("text", TEXT | STORED),
        url: b.add_text_field("url", STORED),
        title: b.add_text_field("title", STORED),
        path: b.add_text_field("path", STORED),
        fetched: b.add_text_field("fetched", STORED),
        hash: b.add_text_field("hash", STRING | STORED),
    };
    (b.build(), f)
}

fn stored(d: &TantivyDocument, f: Field) -> String {
    d.get_first(f)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned()
}

fn passage(d: &TantivyDocument, f: Fields) -> PassageDoc {
    PassageDoc {
        text: stored(d, f.text),
        url: stored(d, f.url),
        title: stored(d, f.title),
        path: stored(d, f.path),
        fetched: stored(d, f.fetched),
    }
}

fn hash(d: &PassageDoc) -> String {
    let mut h = Sha256::new();
    h.update(d.url.as_bytes());
    h.update([0]); // so no URL/text split of the same bytes collides
    h.update(d.text.as_bytes());
    h.finalize()
        .iter()
        .fold(String::with_capacity(64), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// One search's own passages in RAM: BM25 over just these, never the archive.
pub struct MemIndex {
    tantivy: tantivy::Index,
    reader: IndexReader,
    f: Fields,
}

impl MemIndex {
    /// Passages with the same URL and text collapse to one.
    ///
    /// # Errors
    /// When tantivy can't build the index.
    pub fn new(docs: Vec<PassageDoc>) -> anyhow::Result<MemIndex> {
        let (schema, f) = schema();
        let tantivy = tantivy::Index::create_in_ram(schema);
        let mut writer: IndexWriter = tantivy.writer_with_num_threads(1, ARENA)?;
        let mut seen = HashSet::new();
        for d in docs {
            let h = hash(&d);
            if !seen.insert(h.clone()) {
                continue;
            }
            let mut t = TantivyDocument::new();
            t.add_text(f.text, &d.text);
            t.add_text(f.url, &d.url);
            t.add_text(f.title, &d.title);
            t.add_text(f.path, &d.path);
            t.add_text(f.fetched, &d.fetched);
            t.add_text(f.hash, &h);
            writer.add_document(t)?;
        }
        writer.commit()?;
        let reader = tantivy.reader()?;
        Ok(MemIndex { tantivy, reader, f })
    }

    /// The best `k` passages by BM25; the query never fails on syntax.
    ///
    /// # Errors
    /// When tantivy can't read the index.
    pub fn search(&self, query: &str, k: usize) -> anyhow::Result<Vec<Hit>> {
        if k == 0 {
            return Ok(Vec::new());
        }
        let searcher = self.reader.searcher();
        let (q, _) =
            QueryParser::for_index(&self.tantivy, vec![self.f.text]).parse_query_lenient(query);
        searcher
            .search(&q, &TopDocs::with_limit(k).order_by_score())?
            .into_iter()
            .map(|(score, addr)| {
                let d: TantivyDocument = searcher.doc(addr)?;
                Ok(Hit {
                    doc: passage(&d, self.f),
                    score,
                })
            })
            .collect()
    }
}

/// Reciprocal rank fusion: score = Σ 1 / (k + rank), rank from 1; ties keep the first list's order.
/// A passage is the same across lists when its URL and text are.
pub fn rrf(lists: &[Vec<Hit>], k: f32) -> Vec<Hit> {
    let mut fused: Vec<Hit> = Vec::new();
    let mut at: HashMap<(&str, &str), usize> = HashMap::new();
    for list in lists {
        for (rank, h) in list.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)] // ranks are small
            let s = 1.0 / (k + (rank + 1) as f32);
            let i = *at.entry((&h.doc.url, &h.doc.text)).or_insert_with(|| {
                fused.push(Hit {
                    doc: h.doc.clone(),
                    score: 0.0,
                });
                fused.len() - 1
            });
            fused[i].score += s;
        }
    }
    // Stable: equal scores keep first-seen order, which is the first list's.
    fused.sort_by(|a, b| b.score.total_cmp(&a.score));
    fused
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str, url: &str) -> PassageDoc {
        PassageDoc {
            text: text.into(),
            url: url.into(),
            title: "T".into(),
            path: "pages/x/page.md".into(),
            fetched: "2026-10-17T12:00:00Z".into(),
        }
    }

    #[test]
    fn bm25_finds_exact_phrase_first() {
        let idx = MemIndex::new(vec![
            doc("quick quick quick foxes everywhere", "https://a/"),
            doc("the quick brown fox jumps over the lazy dog", "https://b/"),
            doc("a brown bear and a red fox", "https://c/"),
            doc("nothing related at all", "https://d/"),
        ])
        .unwrap();
        let hits = idx.search("quick brown fox", 10).unwrap();
        assert_eq!(hits[0].doc.url, "https://b/");
        assert!(hits.iter().all(|h| h.doc.url != "https://d/"));
        assert_eq!(hits[0].doc.title, "T");
        // Query syntax from a user never errors.
        idx.search("fox AND (\"unclosed", 3).unwrap();
        assert_eq!(idx.search("fox", 0).unwrap().len(), 0);
    }

    #[test]
    fn same_passage_twice_is_one_hit() {
        let mut later = doc("the same words again", "https://s/");
        later.fetched = "2026-10-18T12:00:00Z".into();
        let idx = MemIndex::new(vec![
            doc("the same words again", "https://s/"),
            later.clone(),
            later,
        ])
        .unwrap();
        assert_eq!(idx.search("same words", 10).unwrap().len(), 1);
        // The same text from another URL is another passage.
        let idx = MemIndex::new(vec![
            doc("the same words again", "https://s/"),
            doc("the same words again", "https://other/"),
        ])
        .unwrap();
        assert_eq!(idx.search("same words", 10).unwrap().len(), 2);
    }

    #[test]
    fn rrf_matches_hand_computed() {
        let hit = |t: &str| Hit {
            doc: doc(t, "https://r/"),
            score: 0.0,
        };
        let l1 = vec![hit("a"), hit("b"), hit("c")];
        let l2 = vec![hit("c"), hit("a"), hit("d")];
        let fused = rrf(&[l1, l2], 60.0);
        let got: Vec<_> = fused
            .iter()
            .map(|h| (h.doc.text.as_str(), h.score))
            .collect();
        let want = [
            ("a", 1.0 / 61.0 + 1.0 / 62.0),
            ("c", 1.0 / 63.0 + 1.0 / 61.0),
            ("b", 1.0 / 62.0),
            ("d", 1.0 / 63.0),
        ];
        assert_eq!(got.len(), want.len());
        for ((gt, gs), (wt, ws)) in got.iter().zip(want) {
            assert_eq!(*gt, wt);
            assert!((gs - ws).abs() < 1e-6, "{gt}: {gs} vs {ws}");
        }
        // A tie keeps the first list's order.
        let tie = rrf(&[vec![hit("x"), hit("y")], vec![hit("y"), hit("x")]], 60.0);
        assert_eq!(tie[0].doc.text, "x");
        assert_eq!(tie[1].doc.text, "y");
    }
}
