//! The archive's BM25 passage index at `.web/index/`, shared by every web-mcp process in the project.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context as _, anyhow};
use sha2::{Digest, Sha256};
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::directory::error::LockError;
use tantivy::merge_policy::LogMergePolicy;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, STORED, STRING, Schema, TEXT, Value as _};
use tantivy::{IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, TantivyError, Term};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::{mpsc, oneshot};

/// tantivy's smallest writer arena (`MEMORY_BUDGET_NUM_BYTES_MIN`, not exported); one per batch.
const ARENA: usize = 15_000_000;
const LOCK_WAIT: Duration = Duration::from_secs(5);
/// Measured: merging 8 × 4,000 passages took 0.45 s (8 × 16,000: 1.7 s) in release on an SSD.
const MAX_MERGE_DOCS: usize = 4_000;
const MIN_LAYER_DOCS: u32 = 100;

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

type Job = (Vec<PassageDoc>, oneshot::Sender<Result<(), String>>);

pub struct Index {
    tantivy: tantivy::Index,
    reader: IndexReader,
    f: Fields,
    jobs: mpsc::UnboundedSender<Job>,
    /// Commits made by this index's writer task.
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests
    commits: Arc<AtomicUsize>,
    /// Times the writer task waited for merges (only ever with an empty queue).
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests
    merge_waits: Arc<AtomicUsize>,
}

impl Index {
    /// # Errors
    /// When the directory can't be created or holds an index tantivy can't open.
    pub fn open(web_root: &Path) -> anyhow::Result<Index> {
        let dir = web_root.join("index");
        // A committed `.web/` could hold a symlink here that would take tantivy's files, or its index, elsewhere.
        if std::fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            anyhow::bail!("{} is a symlink; refusing to use it", dir.display());
        }
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        let mut b = Schema::builder();
        let f = Fields {
            text: b.add_text_field("text", TEXT | STORED),
            url: b.add_text_field("url", STORED),
            title: b.add_text_field("title", STORED),
            path: b.add_text_field("path", STORED),
            fetched: b.add_text_field("fetched", STORED),
            hash: b.add_text_field("hash", STRING | STORED),
        };
        let index = tantivy::Index::open_or_create(MmapDirectory::open(&dir)?, b.build())?;
        // OnCommitWithDelay watches meta.json, so other processes' commits show up too.
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;
        let (jobs, rx) = mpsc::unbounded_channel();
        let (commits, merge_waits) = (Arc::default(), Arc::default());
        let w = Writer {
            index: index.clone(),
            reader: Clone::clone(&reader),
            f,
            commits: Arc::clone(&commits),
            merge_waits: Arc::clone(&merge_waits),
        };
        std::thread::Builder::new()
            .name("web-mcp-index".into())
            .spawn(move || w.run(rx))?;
        Ok(Index {
            tantivy: index,
            reader,
            f,
            jobs,
            commits,
            merge_waits,
        })
    }

    /// Returns once the passages are committed and searchable here.
    ///
    /// # Errors
    /// When the commit fails, or another process holds the writer lock for over 5 s.
    pub async fn add(&self, docs: Vec<PassageDoc>) -> anyhow::Result<()> {
        let (tx, rx) = oneshot::channel();
        self.jobs
            .send((docs, tx))
            .map_err(|_| anyhow!("the index writer has stopped"))?;
        rx.await
            .map_err(|_| anyhow!("the index writer has stopped"))?
            .map_err(|e| anyhow!("indexing failed: {e}"))
    }

    /// The best `k` passages by BM25, only from the URLs in `only` when it is given; the query never fails
    /// on syntax.
    ///
    /// # Errors
    /// When tantivy can't read the index.
    pub fn search(
        &self,
        query: &str,
        k: usize,
        only: Option<&HashSet<String>>,
    ) -> anyhow::Result<Vec<Hit>> {
        if k == 0 {
            return Ok(Vec::new());
        }
        let searcher = self.reader.searcher();
        let (q, _) =
            QueryParser::for_index(&self.tantivy, vec![self.f.text]).parse_query_lenient(query);
        // Extra candidates so collapsing duplicates still leaves `k`.
        // shortcut: with `only` this post-filters tantivy's top 500 because url isn't indexed; indexing it
        // changes the on-disk schema, so it needs a new index dir or a migration. Same-URL passages from
        // earlier runs are accepted.
        let limit = if only.is_some() {
            500
        } else {
            k.saturating_mul(2)
        };
        let top = searcher.search(&q, &TopDocs::with_limit(limit).order_by_score())?;
        let mut hits: Vec<Hit> = Vec::new();
        let mut seen: HashMap<String, usize> = HashMap::new();
        for (score, addr) in top {
            let d: TantivyDocument = searcher.doc(addr)?;
            let get = |f: Field| {
                d.get_first(f)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned()
            };
            let doc = PassageDoc {
                text: get(self.f.text),
                url: get(self.f.url),
                title: get(self.f.title),
                path: get(self.f.path),
                fetched: get(self.f.fetched),
            };
            if only.is_some_and(|o| !o.contains(&doc.url)) {
                continue;
            }
            // Equal hashes (two processes racing past the add-time check) keep the newest copy.
            if let Some(&i) = seen.get(&get(self.f.hash)) {
                if newer(&doc.fetched, &hits[i].doc.fetched) {
                    hits[i].doc = doc;
                }
            } else {
                seen.insert(get(self.f.hash), hits.len());
                hits.push(Hit { doc, score });
            }
        }
        hits.truncate(k);
        Ok(hits)
    }
}

fn newer(a: &str, b: &str) -> bool {
    match (a.parse::<jiff::Timestamp>(), b.parse::<jiff::Timestamp>()) {
        (Ok(a), Ok(b)) => a > b,
        _ => a > b,
    }
}

fn hash(d: &PassageDoc) -> String {
    let mut h = Sha256::new();
    h.update(d.url.as_bytes());
    h.update([0]); // so no URL/text split of the same bytes collides
    h.update(d.text.as_bytes());
    format!("{:x}", h.finalize())
}

/// Merges stop at segments of `MAX_MERGE_DOCS` passages, so the biggest merge (about eight such
/// segments) takes ~0.45 s on an SSD: well inside the 5 s another process waits for the lock.
fn merge_policy() -> LogMergePolicy {
    let mut p = LogMergePolicy::default();
    p.set_max_docs_before_merge(MAX_MERGE_DOCS);
    // Small first layer: merges of a few pages' passages stay cheap instead of rewriting every
    // segment under tantivy's default 10,000-doc layer.
    p.set_min_layer_size(MIN_LAYER_DOCS);
    p
}

/// The one writer task: the writer is held only while batches are queued, so other processes can
/// take the lock in between.
struct Writer {
    index: tantivy::Index,
    reader: IndexReader,
    f: Fields,
    commits: Arc<AtomicUsize>,
    merge_waits: Arc<AtomicUsize>,
}

impl Writer {
    fn run(self, mut rx: mpsc::UnboundedReceiver<Job>) {
        // Kept open while batches are queued, so queued work never waits behind a merge.
        let mut open: Option<IndexWriter> = None;
        loop {
            let first = match rx.try_recv() {
                Ok(job) => job,
                Err(TryRecvError::Disconnected) => break,
                Err(TryRecvError::Empty) => {
                    if let Some(w) = open.take() {
                        // Queue drained: let merges finish, then release the lock for other processes.
                        self.merge_waits.fetch_add(1, Ordering::SeqCst);
                        let _ = w.wait_merging_threads();
                        continue;
                    }
                    match rx.blocking_recv() {
                        Some(job) => job,
                        None => break,
                    }
                }
            };
            let mut batch = vec![first];
            while let Ok(job) = rx.try_recv() {
                batch.push(job);
            }
            let docs = batch.iter().flat_map(|(d, _)| d);
            let result = match self.commit(open.take(), docs) {
                Ok(w) => {
                    open = Some(w);
                    Ok(())
                }
                Err(e) => Err(format!("{e:#}")),
            };
            for (_, tx) in batch {
                let _ = tx.send(result.clone());
            }
        }
        if let Some(w) = open {
            let _ = w.wait_merging_threads();
        }
    }

    /// Adds the passages not yet indexed and commits, with `open` or a newly locked writer; returns
    /// the writer, whose merges may still be running. On failure the batch is discarded and the
    /// writer's merges finish before its lock is released.
    fn commit<'a>(
        &self,
        open: Option<IndexWriter>,
        docs: impl Iterator<Item = &'a PassageDoc>,
    ) -> anyhow::Result<IndexWriter> {
        let mut writer = match open {
            Some(w) => w,
            None => self.lock()?,
        };
        match self.add_and_commit(&mut writer, docs) {
            Ok(()) => Ok(writer),
            Err(e) => {
                let _ = writer.wait_merging_threads();
                Err(e)
            }
        }
    }

    fn add_and_commit<'a>(
        &self,
        writer: &mut IndexWriter,
        docs: impl Iterator<Item = &'a PassageDoc>,
    ) -> anyhow::Result<()> {
        // Under the lock, so every other process's commit is visible to the duplicate check.
        self.reader.reload()?;
        let searcher = self.reader.searcher();
        let mut added = std::collections::HashSet::new();
        for d in docs {
            let h = hash(d);
            if searcher.doc_freq(&Term::from_field_text(self.f.hash, &h))? > 0
                || !added.insert(h.clone())
            {
                continue;
            }
            let mut doc = TantivyDocument::new();
            doc.add_text(self.f.text, &d.text);
            doc.add_text(self.f.url, &d.url);
            doc.add_text(self.f.title, &d.title);
            doc.add_text(self.f.path, &d.path);
            doc.add_text(self.f.fetched, &d.fetched);
            doc.add_text(self.f.hash, &h);
            writer.add_document(doc)?;
        }
        if added.is_empty() {
            return Ok(());
        }
        writer.commit()?;
        self.commits.fetch_add(1, Ordering::SeqCst);
        self.reader.reload()?;
        Ok(())
    }

    /// The index writer, waiting with backoff while another process holds the lock.
    fn lock(&self) -> anyhow::Result<IndexWriter> {
        let start = Instant::now();
        let mut wait = Duration::from_millis(10);
        loop {
            match self
                .index
                .writer_with_num_threads::<TantivyDocument>(1, ARENA)
            {
                Ok(w) => {
                    w.set_merge_policy(Box::new(merge_policy()));
                    return Ok(w);
                }
                Err(TantivyError::LockFailure(LockError::LockBusy, _))
                    if start.elapsed() < LOCK_WAIT =>
                {
                    std::thread::sleep(wait);
                    wait = (wait * 2).min(Duration::from_millis(250));
                }
                r => return r.context("opening the index writer"),
            }
        }
    }
}

/// Reciprocal rank fusion: score = Σ 1 / (k + rank), rank from 1; ties keep the first list's order.
/// A passage is the same across lists when its URL and text are.
#[cfg_attr(not(feature = "h4"), allow(dead_code))] // used by examples/h4.rs
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
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    fn temp_web(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "web-mcp-rank-{name}-{}-{}-{}",
            std::process::id(),
            jiff::Timestamp::now().as_nanosecond(),
            {
                static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                N.fetch_add(1, Ordering::Relaxed)
            }
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_index_dir_is_refused() {
        let web = temp_web("symlink");
        let target = temp_web("symlink-target");
        std::os::unix::fs::symlink(&target, web.join("index")).unwrap();
        assert!(Index::open(&web).is_err());
        assert!(std::fs::read_dir(&target).unwrap().next().is_none());
    }

    fn doc(text: &str, url: &str) -> PassageDoc {
        PassageDoc {
            text: text.into(),
            url: url.into(),
            title: "T".into(),
            path: "pages/x/page.md".into(),
            fetched: "2026-10-17T12:00:00Z".into(),
        }
    }

    #[tokio::test]
    async fn bm25_finds_exact_phrase_first() {
        let idx = Index::open(&temp_web("bm25")).unwrap();
        idx.add(vec![
            doc("quick quick quick foxes everywhere", "https://a/"),
            doc("the quick brown fox jumps over the lazy dog", "https://b/"),
            doc("a brown bear and a red fox", "https://c/"),
            doc("nothing related at all", "https://d/"),
        ])
        .await
        .unwrap();
        let hits = idx.search("quick brown fox", 10, None).unwrap();
        assert_eq!(hits[0].doc.url, "https://b/");
        assert!(hits.iter().all(|h| h.doc.url != "https://d/"));
        assert_eq!(hits[0].doc.title, "T");
        // Query syntax from a user never errors.
        idx.search("fox AND (\"unclosed", 3, None).unwrap();
        assert_eq!(idx.search("fox", 0, None).unwrap().len(), 0);
    }

    #[tokio::test]
    async fn search_only_keeps_listed_urls() {
        let idx = Index::open(&temp_web("only")).unwrap();
        idx.add(vec![
            doc("zebra stripes", "https://a/"),
            doc("zebra herds", "https://b/"),
        ])
        .await
        .unwrap();
        let only: HashSet<String> = ["https://b/".to_owned()].into();
        let hits = idx.search("zebra", 5, Some(&only)).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].doc.url, "https://b/");
        assert!(
            idx.search("zebra", 5, Some(&HashSet::new()))
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn added_passage_is_searchable_immediately() {
        let idx = Index::open(&temp_web("loop")).unwrap();
        for i in 0..100 {
            let word = format!("marker{i}");
            idx.add(vec![doc(
                &format!("passage {word}"),
                &format!("https://x/{i}"),
            )])
            .await
            .unwrap();
            let hits = idx.search(&word, 5, None).unwrap();
            assert_eq!(hits.len(), 1, "iteration {i}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn concurrent_adds_share_one_commit() {
        let idx = Index::open(&temp_web("group")).unwrap();
        let adds = (0..16).map(|i| idx.add(vec![doc(&format!("group{i}"), "https://g/")]));
        for r in futures::future::join_all(adds).await {
            r.unwrap();
        }
        let commits = idx.commits.load(Ordering::SeqCst);
        assert!((1..=2).contains(&commits), "{commits} commits");
        for i in 0..16 {
            assert_eq!(idx.search(&format!("group{i}"), 5, None).unwrap().len(), 1);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn queued_batches_dont_wait_for_merges() {
        let idx = Arc::new(Index::open(&temp_web("merges")).unwrap());
        // An add every 200 µs until 9 commits and a finished merge (20 s cap): the queue refills during every commit,
        // and the many small segments push the merge policy (layer of 100 docs, 8 segments) into merging. Slow commits
        // (Windows) make segments of uneven size that take more commits to fill a merge layer.
        let handle = tokio::runtime::Handle::current();
        let producer = {
            let idx = Arc::clone(&idx);
            std::thread::spawn(move || {
                let start = Instant::now();
                let mut adds = Vec::new();
                for i in 0.. {
                    let commits = idx.commits.load(Ordering::SeqCst);
                    let segments = idx.tantivy.searchable_segment_ids().unwrap().len();
                    let done = commits >= 9 && segments < commits;
                    if done && start.elapsed() > Duration::from_secs(1) {
                        break;
                    }
                    assert!(
                        start.elapsed() < Duration::from_secs(20),
                        "only {} commits after 20 s",
                        idx.commits.load(Ordering::SeqCst)
                    );
                    let idx = Arc::clone(&idx);
                    adds.push(handle.spawn(async move {
                        idx.add(vec![doc(&format!("burst{i}"), "https://m/")]).await
                    }));
                    std::thread::sleep(Duration::from_micros(200));
                }
                adds
            })
        };
        let adds = producer.join().unwrap();
        let n = adds.len();
        for a in adds {
            a.await.unwrap().unwrap();
        }
        let commits = idx.commits.load(Ordering::SeqCst);
        let waits = idx.merge_waits.load(Ordering::SeqCst);
        assert!(commits >= 4, "{commits} commits for {n} adds");
        // Waiting for merges happens only once the queue is empty, not between queued batches.
        assert!(
            waits * 4 <= commits,
            "{waits} merge waits over {commits} commits"
        );
        // Merges finish after the last batch is answered.
        let start = Instant::now();
        let segments = loop {
            let n = idx.tantivy.searchable_segment_ids().unwrap().len();
            if n < commits || start.elapsed() > Duration::from_secs(10) {
                break n;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        assert!(
            segments < commits,
            "no merges ran: {segments} segments, {commits} commits"
        );
        assert_eq!(idx.search("burst7", 5, None).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn same_passage_twice_is_one_hit() {
        let idx = Index::open(&temp_web("dup")).unwrap();
        let mut later = doc("the same words again", "https://s/");
        idx.add(vec![doc("the same words again", "https://s/")])
            .await
            .unwrap();
        later.fetched = "2026-10-18T12:00:00Z".into();
        idx.add(vec![later.clone(), later]).await.unwrap();
        assert_eq!(idx.search("same words", 10, None).unwrap().len(), 1);
        // The same text from another URL is another passage.
        idx.add(vec![doc("the same words again", "https://other/")])
            .await
            .unwrap();
        assert_eq!(idx.search("same words", 10, None).unwrap().len(), 2);
    }

    #[test]
    fn two_processes_share_the_index() {
        let web = temp_web("shared");
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let run = |me: &'static str, other: &'static str| {
            let (web, barrier) = (web.clone(), Arc::clone(&barrier));
            std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                rt.block_on(async {
                    barrier.wait();
                    let idx = Index::open(&web).unwrap();
                    barrier.wait();
                    idx.add(vec![doc(&format!("written by {me}"), "https://p/")])
                        .await
                        .unwrap();
                    let start = Instant::now();
                    while idx.search(other, 5, None).unwrap().is_empty() {
                        assert!(
                            start.elapsed() < Duration::from_secs(10),
                            "{me} never saw {other}"
                        );
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                });
            })
        };
        let (a, b) = (run("alpha", "bravo"), run("bravo", "alpha"));
        a.join().unwrap();
        b.join().unwrap();
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
