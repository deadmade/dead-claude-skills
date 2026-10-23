//! H4 experiment: does adding model2vec embeddings (fused with BM25 by RRF) lift recall@5 on BEIR?
//! `cargo run --release --example h4 --features h4 -- --data <dir> [--sweep]`
#![allow(dead_code, unused_imports, clippy::cast_precision_loss)] // counts here are far below 2^52
#[path = "../src/passages.rs"]
mod passages;
#[path = "../src/rank.rs"]
mod rank;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, bail, ensure};
use model2vec_rs::model::StaticModel;
use rank::{Hit, MemIndex, PassageDoc, rrf};

const BASE: &str = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets";
const FUSE_K: f32 = 60.0;
const POOL: usize = 100;

struct Data {
    /// (id, title + text)
    docs: Vec<(String, String)>,
    queries: Vec<(String, String)>,
    qrels: HashMap<String, HashSet<String>>,
}

fn run(cmd: &mut Command) -> Result<()> {
    let st = cmd.status().with_context(|| format!("spawn {cmd:?}"))?;
    ensure!(st.success(), "{cmd:?} failed: {st}");
    Ok(())
}

fn load(dir: &Path, name: &str, max_queries: usize) -> Result<Data> {
    let root = dir.join(name);
    if !root.join("corpus.jsonl").exists() {
        std::fs::create_dir_all(dir)?;
        let zip = dir.join(format!("{name}.zip"));
        run(Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&zip)
            .arg(format!("{BASE}/{name}.zip")))?;
        // No zip crate; python3 is on every dev machine here (unzip is not).
        run(Command::new("python3")
            .args(["-I", "-m", "zipfile", "-e"])
            .arg(&zip)
            .arg(dir))?;
    }
    let lines = |f: &str| -> Result<Vec<serde_json::Value>> {
        std::fs::read_to_string(root.join(f))?
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| Ok(serde_json::from_str(l)?))
            .collect()
    };
    let s = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap_or("").to_owned();
    let docs: Vec<_> = lines("corpus.jsonl")?
        .iter()
        .map(|d| {
            (
                s(d, "_id"),
                format!("{} {}", s(d, "title"), s(d, "text"))
                    .trim()
                    .to_owned(),
            )
        })
        .collect();
    let mut qrels: HashMap<String, HashSet<String>> = HashMap::new();
    for l in std::fs::read_to_string(root.join("qrels/test.tsv"))?
        .lines()
        .skip(1)
    {
        let c: Vec<_> = l.split('\t').collect();
        if c.len() == 3 && c[2].trim().parse::<i64>().is_ok_and(|v| v > 0) {
            qrels
                .entry(c[0].to_owned())
                .or_default()
                .insert(c[1].to_owned());
        }
    }
    // Test split = queries that have test qrels, in file order.
    let queries: Vec<_> = lines("queries.jsonl")?
        .iter()
        .map(|q| (s(q, "_id"), s(q, "text")))
        .filter(|(id, _)| qrels.contains_key(id))
        .take(max_queries)
        .collect();
    qrels.retain(|id, _| queries.iter().any(|(q, _)| q == id));
    Ok(Data {
        docs,
        queries,
        qrels,
    })
}

/// BEIR recall@5: per query the share of its relevant docs in the top 5, averaged over queries.
fn recall_at_5(
    qrels: &HashMap<String, HashSet<String>>,
    ranked: &HashMap<String, Vec<String>>,
) -> f64 {
    let sum: f64 = qrels
        .iter()
        .map(|(q, rel)| {
            let found = ranked
                .get(q)
                .map_or(0, |r| r.iter().take(5).filter(|d| rel.contains(*d)).count());
            found as f64 / rel.len() as f64
        })
        .sum();
    sum / qrels.len() as f64
}

fn pdoc(id: &str, text: &str) -> PassageDoc {
    PassageDoc {
        text: text.into(),
        url: id.into(),
        title: String::new(),
        path: String::new(),
        fetched: "2026-10-17T00:00:00Z".into(),
    }
}

fn index_of(items: &[(String, String)]) -> Result<MemIndex> {
    MemIndex::new(items.iter().map(|(i, t)| pdoc(i, t)).collect())
}

fn unit(mut v: Vec<f32>) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    for x in &mut v {
        *x /= n;
    }
    v
}

fn ids(hits: &[Hit]) -> Vec<String> {
    hits.iter().map(|h| h.doc.url.clone()).collect()
}

fn eval(dir: &Path, name: &str, max_q: usize, model: &StaticModel) -> Result<(f64, f64)> {
    let d = load(dir, name, max_q)?;
    let distinct: HashSet<_> = d.docs.iter().map(|(_, t)| t).collect();
    println!(
        "{name}: {} docs ({} distinct texts), {} queries",
        d.docs.len(),
        distinct.len(),
        d.queries.len()
    );
    let idx = index_of(&d.docs)?;
    let embs: Vec<Vec<f32>> = model
        .encode(&d.docs.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>())
        .into_iter()
        .map(unit)
        .collect();
    let (mut bm, mut hy) = (HashMap::new(), HashMap::new());
    for (qid, q) in &d.queries {
        let bm25 = idx.search(q, POOL)?;
        let qe = unit(model.encode_single(q));
        let mut sc: Vec<(usize, f32)> = embs
            .iter()
            .enumerate()
            .map(|(i, e)| (i, e.iter().zip(&qe).map(|(a, b)| a * b).sum()))
            .collect();
        sc.sort_by(|a, b| b.1.total_cmp(&a.1));
        let dense: Vec<Hit> = sc
            .iter()
            .take(POOL)
            .map(|&(i, s)| Hit {
                doc: pdoc(&d.docs[i].0, &d.docs[i].1),
                score: s,
            })
            .collect();
        hy.insert(qid.clone(), ids(&rrf(&[bm25.clone(), dense], FUSE_K)));
        bm.insert(qid.clone(), ids(&bm25));
    }
    Ok((recall_at_5(&d.qrels, &bm), recall_at_5(&d.qrels, &hy)))
}

/// Whitespace-token windows; the sweep's stand-in for the server's splitter.
fn windows(text: &str, size: usize) -> Vec<String> {
    let t: Vec<&str> = text.split_whitespace().collect();
    t.chunks(size).map(|c| c.join(" ")).collect()
}

fn sweep(dir: &Path) -> Result<()> {
    let d = load(dir, "scifact", usize::MAX)?;
    for size in [128, 256, 512] {
        let items: Vec<(String, String)> = d
            .docs
            .iter()
            .flat_map(|(id, t)| windows(t, size).into_iter().map(move |w| (id.clone(), w)))
            .collect();
        let idx = index_of(&items)?;
        let mut ranked = HashMap::new();
        for (qid, q) in &d.queries {
            // Max-pool: a doc ranks where its best passage does.
            let mut seen = HashSet::new();
            let docs: Vec<String> = idx
                .search(q, POOL)?
                .into_iter()
                .map(|h| h.doc.url)
                .filter(|u| seen.insert(u.clone()))
                .collect();
            ranked.insert(qid.clone(), docs);
        }
        println!(
            "sweep scifact BM25 recall@5, {size}-token passages ({} passages): {:.4}",
            items.len(),
            recall_at_5(&d.qrels, &ranked)
        );
    }
    Ok(())
}

fn main() -> Result<()> {
    let a: Vec<String> = std::env::args().collect();
    let Some(i) = a.iter().position(|x| x == "--data") else {
        bail!("usage: h4 --data <dir> [--sweep]")
    };
    let dir = Path::new(a.get(i + 1).context("--data needs a directory")?);
    if a.iter().any(|x| x == "--sweep") {
        return sweep(dir);
    }
    let model = StaticModel::from_pretrained("minishlab/potion-base-8M", None, None, None)?;
    let mut rows = Vec::new();
    for (name, n) in [("scifact", usize::MAX), ("fiqa", 300)] {
        let (b, h) = eval(dir, name, n, &model)?;
        println!("{name}: BM25 {b:.4}  hybrid {h:.4}");
        rows.push((b, h));
    }
    let (b, h) = (
        rows.iter().map(|r| r.0).sum::<f64>() / 2.0,
        rows.iter().map(|r| r.1).sum::<f64>() / 2.0,
    );
    println!(
        "mean: BM25 {b:.4}  hybrid {h:.4}  delta {:+.4}  -> {}",
        h - b,
        if h >= b + 0.02 {
            "Task 12 runs"
        } else {
            "Task 12 skipped"
        }
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recall_at_5_counts_any_relevant_in_top5() {
        let rel: HashMap<String, HashSet<String>> = [(
            "q1".to_string(),
            ["a", "b"].iter().map(|s| s.to_string()).collect(),
        )]
        .into();
        let r = |ids: &[&str]| {
            HashMap::from([(
                "q1".to_string(),
                ids.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            )])
        };
        // BEIR: share of the relevant docs found; the 6th place doesn't count.
        assert!((recall_at_5(&rel, &r(&["x", "a", "y", "z", "w", "b"])) - 0.5).abs() < 1e-9);
        assert_eq!(recall_at_5(&rel, &r(&["x"])), 0.0);
        assert_eq!(recall_at_5(&rel, &r(&["b", "a"])), 1.0);
    }

    #[test]
    fn windows_split_by_tokens() {
        assert_eq!(windows("a b c d e", 2), ["a b", "c d", "e"]);
    }
}
