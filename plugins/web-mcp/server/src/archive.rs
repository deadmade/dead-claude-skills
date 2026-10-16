//! The on-disk archive: `.web/<date>_<run>/` with an `index.jsonl` line per stored item.
//! Every file is written to `<name>.tmp` and renamed; the index line is appended last.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::{fmt::Write as _, io};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use url::{Host, Url};

pub enum Item {
    Search {
        query: String,
        json: String,
    },
    Page {
        url: Url,
        final_url: Url,
        raw: Vec<u8>,
        raw_ext: &'static str,
        rendered: Option<String>,
        markdown: String,
        images: Vec<(String, Vec<u8>)>,
    },
    Pdf {
        url: Url,
        bytes: Vec<u8>,
        text: String,
    },
    Screenshot {
        session: String,
        jpeg: Vec<u8>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Archived {
    /// Relative to `.web`.
    pub path: PathBuf,
    pub sha256: String,
    /// RFC 3339.
    pub time: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Search,
    Page,
    Pdf,
    Image,
    Screenshot,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexEntry {
    pub url: String,
    pub query: Option<String>,
    pub time: String,
    #[serde(rename = "type")]
    pub kind: Kind,
    pub sha256: String,
    pub path: String,
}

struct Inner {
    /// Absolute `.web` folder.
    web: PathBuf,
    run: PathBuf,
    index: Mutex<fs::File>,
    cache: StdMutex<HashMap<String, Archived>>,
    seq: AtomicU64,
}

#[derive(Clone)]
pub struct Archive(Arc<Inner>);

impl Archive {
    /// # Errors
    /// When the folders or files under `.web` can't be created.
    pub fn open(project: &Path, now: &jiff::Zoned) -> io::Result<Self> {
        let web = std::path::absolute(project)?.join(".web");
        match std::fs::symlink_metadata(&web) {
            Ok(m) if !m.is_dir() => {
                return Err(io::Error::other(format!(
                    "{} is not a real directory",
                    web.display()
                )));
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => std::fs::create_dir_all(&web)?,
            Err(e) => return Err(e),
        }
        let ignore = web.join(".gitignore");
        // create_new (O_EXCL) never follows a symlink, even a dangling one.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&ignore)
        {
            Ok(mut f) => std::io::Write::write_all(&mut f, b"*\n")?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        let name = format!("{}-{}", now.strftime("%Y-%m-%d_%H%M%S"), std::process::id());
        let run = web.join(name);
        std::fs::create_dir(&run)?;
        let index = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(run.join("index.jsonl"))?;
        Ok(Self(Arc::new(Inner {
            web,
            run,
            index: Mutex::new(fs::File::from_std(index)),
            cache: StdMutex::default(),
            seq: AtomicU64::new(0),
        })))
    }

    /// Stores the item and appends its index line(s). Runs in its own task, so a cancelled
    /// caller can't leave it half-done.
    ///
    /// # Errors
    /// When a file can't be written.
    pub async fn put(&self, item: Item) -> io::Result<Archived> {
        let inner = Arc::clone(&self.0);
        tokio::spawn(async move { inner.put(item).await })
            .await
            .map_err(io::Error::other)?
    }

    /// The latest page put for this URL in this run. Never for private URLs.
    #[must_use]
    pub fn cached(&self, url: &Url) -> Option<Archived> {
        if is_private(url) {
            return None;
        }
        self.0.cache.lock().ok()?.get(url.as_str()).cloned()
    }
}

impl Inner {
    fn rel(&self, p: &Path) -> PathBuf {
        p.strip_prefix(&self.web).unwrap_or(p).to_path_buf()
    }

    async fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
        static TMP: AtomicU64 = AtomicU64::new(0);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).await?;
        }
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(format!(
            ".{}-{}.tmp",
            std::process::id(),
            TMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&tmp, bytes).await?;
        fs::rename(&tmp, path).await
    }

    #[allow(clippy::too_many_lines)] // one arm per item kind
    async fn put(&self, item: Item) -> io::Result<Archived> {
        let time = jiff::Timestamp::now().to_string();
        let mut lines: Vec<IndexEntry> = Vec::new();
        let mut keys: Vec<String> = Vec::new();
        let entry = |url: String, query, kind, sha256, path: &Path| IndexEntry {
            url,
            query,
            time: time.clone(),
            kind,
            sha256,
            path: self.rel(path).to_string_lossy().into_owned(),
        };
        let main = match item {
            Item::Search { query, json } => {
                let name = format!("{}-{}", sanitize(&query, 40), short_hash(&query));
                let path = self.run.join("searches").join(name + ".json");
                Self::write(&path, json.as_bytes()).await?;
                lines.push(entry(
                    String::new(),
                    Some(query),
                    Kind::Search,
                    sha(json.as_bytes()),
                    &path,
                ));
                (path, sha(json.as_bytes()))
            }
            Item::Page {
                url,
                final_url,
                raw,
                raw_ext,
                rendered,
                markdown,
                images,
            } => {
                let dir = self.run.join("pages").join(slug(&final_url));
                Self::write(&dir.join(format!("raw.{raw_ext}")), &raw).await?;
                if let Some(r) = &rendered {
                    Self::write(&dir.join("rendered.html"), r.as_bytes()).await?;
                }
                let md = dir.join("page.md");
                Self::write(&md, markdown.as_bytes()).await?;
                let raw_sha = sha(&raw);
                for (name, bytes) in &images {
                    let p = dir.join("images").join(sanitize_file(name));
                    Self::write(&p, bytes).await?;
                    lines.push(entry(
                        final_url.to_string(),
                        None,
                        Kind::Image,
                        sha(bytes),
                        &p,
                    ));
                }
                lines.push(entry(
                    final_url.to_string(),
                    None,
                    Kind::Page,
                    raw_sha.clone(),
                    &md,
                ));
                keys = vec![url.to_string(), final_url.to_string()];
                (md, raw_sha)
            }
            Item::Pdf { url, bytes, text } => {
                let s = slug(&url);
                let path = self.run.join("pdfs").join(format!("{s}.pdf"));
                Self::write(&path, &bytes).await?;
                Self::write(
                    &self.run.join("pdfs").join(format!("{s}.txt")),
                    text.as_bytes(),
                )
                .await?;
                lines.push(entry(url.to_string(), None, Kind::Pdf, sha(&bytes), &path));
                (path, sha(&bytes))
            }
            Item::Screenshot { session, jpeg } => {
                let n = self.seq.fetch_add(1, Ordering::Relaxed);
                let path = self
                    .run
                    .join("screenshots")
                    .join(format!("{}-{n}.jpg", sanitize(&session, 40)));
                Self::write(&path, &jpeg).await?;
                lines.push(entry(
                    String::new(),
                    None,
                    Kind::Screenshot,
                    sha(&jpeg),
                    &path,
                ));
                (path, sha(&jpeg))
            }
        };
        {
            let mut index = self.index.lock().await;
            for l in &lines {
                let mut s = serde_json::to_string(l).map_err(io::Error::other)?;
                s.push('\n');
                index.write_all(s.as_bytes()).await?;
            }
            index.flush().await?;
        }
        let archived = Archived {
            path: self.rel(&main.0),
            sha256: main.1,
            time,
        };
        if let Ok(mut c) = self.cache.lock() {
            for k in keys {
                c.insert(k, archived.clone());
            }
        }
        Ok(archived)
    }
}

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn short_hash(s: &str) -> String {
    sha(s.as_bytes())[..8].to_owned()
}

/// Lowercase `[a-z0-9-]`, other runs collapsed to one `-`, cut to `max` chars.
fn sanitize(s: &str, max: usize) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        let c = if c.is_ascii_alphanumeric() { c } else { '-' };
        if c != '-' || !out.ends_with('-') {
            out.push(c);
        }
    }
    let mut out: String = out.trim_matches('-').chars().take(max).collect();
    if out.is_empty() {
        out.push('x');
    }
    out
}

/// A file name from the outside: no path parts, no leading dot.
fn sanitize_file(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let base = base.trim_start_matches('.');
    if base.is_empty() {
        "image".into()
    } else {
        base.replace(['\0', ':'], "_")
    }
}

#[must_use]
pub fn slug(url: &Url) -> String {
    let mut s = String::new();
    let _ = write!(s, "{}{}", url.host_str().unwrap_or(""), url.path());
    format!("{}-{}", sanitize(&s, 80 - 9), short_hash(url.as_str()))
}

#[must_use]
pub fn is_private(url: &Url) -> bool {
    match url.host() {
        None => false,
        Some(Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
        Some(Host::Ipv4(ip)) => is_private_ip(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v4| is_private_ip(IpAddr::V4(v4)))
        }
    }
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || (v.octets()[0] == 100 && v.octets()[1] & 0xc0 == 64) // CGNAT 100.64.0.0/10
        }
        IpAddr::V6(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn open(dir: &Path) -> Archive {
        Archive::open(dir, &jiff::Zoned::now()).unwrap()
    }

    fn page(url: &str, rendered: Option<&str>) -> Item {
        Item::Page {
            url: u(url),
            final_url: u(url),
            raw: b"<p>hi</p>".to_vec(),
            raw_ext: "html",
            rendered: rendered.map(Into::into),
            markdown: "hi".into(),
            images: vec![("a.png".into(), vec![1, 2, 3])],
        }
    }

    fn index_lines(a: &Archive) -> Vec<IndexEntry> {
        std::fs::read_to_string(a.0.run.join("index.jsonl"))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn open_writes_gitignore_and_run_dir() {
        let d = tempdir();
        let a = open(&d);
        assert_eq!(
            std::fs::read_to_string(d.join(".web/.gitignore")).unwrap(),
            "*\n"
        );
        assert!(a.0.run.is_dir());
        assert!(a.0.run.starts_with(d.join(".web")));
        assert!(a.0.run.file_name().unwrap().to_string_lossy().contains('_'));
    }

    #[tokio::test]
    async fn put_page_writes_files_then_index_line() {
        let d = tempdir();
        let a = open(&d);
        let got = a
            .put(page("https://example.com/a/b", Some("<r/>")))
            .await
            .unwrap();
        let dir = a.0.web.join(got.path.parent().unwrap());
        for f in ["raw.html", "rendered.html", "page.md", "images/a.png"] {
            assert!(dir.join(f).is_file(), "{f}");
        }
        assert_eq!(got.sha256, sha(b"<p>hi</p>"));
        let lines = index_lines(&a);
        let p = lines.iter().find(|l| l.kind == Kind::Page).unwrap();
        assert_eq!(p.url, "https://example.com/a/b");
        assert_eq!(p.path, got.path.to_string_lossy());
        let raw = std::fs::read_to_string(a.0.run.join("index.jsonl")).unwrap();
        assert!(raw.contains(r#""type":"page""#));
    }

    #[tokio::test]
    async fn concurrent_puts_keep_index_lines_whole() {
        let d = tempdir();
        let a = open(&d);
        let hs: Vec<_> = (0..64)
            .map(|i| {
                let a = a.clone();
                tokio::spawn(async move {
                    a.put(Item::Search {
                        query: format!("q{i}"),
                        json: "{}".repeat(500),
                    })
                    .await
                })
            })
            .collect();
        for h in hs {
            h.await.unwrap().unwrap();
        }
        assert_eq!(index_lines(&a).len(), 64);
    }

    #[tokio::test]
    async fn dropped_put_leaves_no_partial_files() {
        let d = tempdir();
        let a = open(&d);
        let a2 = a.clone();
        let h = tokio::spawn(async move { a2.put(page("https://example.com/x", None)).await });
        tokio::task::yield_now().await;
        h.abort();
        tokio::time::sleep(Duration::from_millis(300)).await;
        let lines = index_lines(&a);
        let mut files = Vec::new();
        walk(&a.0.run, &mut files);
        let real: Vec<_> = files
            .iter()
            .filter(|f| f.extension().is_none_or(|e| e != "tmp") && !f.ends_with("index.jsonl"))
            .collect();
        assert!(
            (lines.len() == 2 && real.len() == 3) || real.is_empty(),
            "{lines:?} {real:?}"
        );
    }

    #[tokio::test]
    async fn cached_hits_same_run_only() {
        let d = tempdir();
        let a = open(&d);
        let url = u("https://example.com/c");
        assert!(a.cached(&url).is_none());
        let got = a.put(page(url.as_str(), None)).await.unwrap();
        assert_eq!(a.cached(&url), Some(got));
        let b = Archive::open(
            &d,
            &jiff::Zoned::now()
                .checked_add(jiff::Span::new().seconds(5))
                .unwrap(),
        )
        .unwrap();
        assert!(b.cached(&url).is_none());
    }

    #[tokio::test]
    async fn rendered_put_replaces_cached_shell() {
        let d = tempdir();
        let a = open(&d);
        let url = u("https://example.com/spa");
        let shell = a.put(page(url.as_str(), None)).await.unwrap();
        let full = a.put(page(url.as_str(), Some("<r/>"))).await.unwrap();
        assert_eq!(a.cached(&url), Some(full));
        let _ = shell;
    }

    #[tokio::test]
    async fn private_urls_never_cached() {
        let d = tempdir();
        let a = open(&d);
        for s in [
            "http://localhost:3000/",
            "http://192.168.1.5/",
            "http://[::1]/",
            "http://a.localhost/",
            "http://0.0.0.0:3000/",
            "http://[::]/",
            "http://100.64.1.1/",
        ] {
            let url = u(s);
            assert!(is_private(&url), "{s}");
            a.put(page(s, None)).await.unwrap();
            assert!(a.cached(&url).is_none(), "{s}");
        }
        assert!(!is_private(&u("https://example.com/")));
        let outside = u("http://100.128.0.1/");
        assert!(!is_private(&outside));
        let got = a.put(page(outside.as_str(), None)).await.unwrap();
        assert_eq!(a.cached(&outside), Some(got));
    }

    #[cfg(unix)]
    #[test]
    fn gitignore_symlink_is_not_followed() {
        let d = tempdir();
        let outside = tempdir().join("victim");
        std::fs::create_dir_all(d.join(".web")).unwrap();
        std::os::unix::fs::symlink(&outside, d.join(".web/.gitignore")).unwrap();
        Archive::open(&d, &jiff::Zoned::now()).unwrap();
        assert!(!outside.exists());
    }

    #[test]
    fn slug_is_bounded_and_clean() {
        let s = slug(&u(&format!("https://Example.com/{}", "A_b/".repeat(60))));
        assert!(
            s.len() <= 89
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        );
    }

    #[tokio::test]
    async fn same_url_put_8_times_in_parallel() {
        let d = tempdir();
        let a = open(&d);
        let hs: Vec<_> = (0..8)
            .map(|_| {
                let a = a.clone();
                tokio::spawn(async move { a.put(page("https://example.com/same", None)).await })
            })
            .collect();
        for h in hs {
            h.await.unwrap().unwrap();
        }
        assert_eq!(index_lines(&a).len(), 16); // page + image line per put
        let mut files = Vec::new();
        walk(&a.0.run, &mut files);
        assert!(
            files
                .iter()
                .all(|f| f.extension().is_none_or(|e| e != "tmp"))
        );
        let dir = files
            .iter()
            .find(|f| f.ends_with("raw.html"))
            .unwrap()
            .parent()
            .unwrap()
            .to_owned();
        assert_eq!(std::fs::read(dir.join("raw.html")).unwrap(), b"<p>hi</p>");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_web_dir_is_refused() {
        let d = tempdir();
        let target = tempdir();
        std::os::unix::fs::symlink(&target, d.join(".web")).unwrap();
        assert!(Archive::open(&d, &jiff::Zoned::now()).is_err());
        assert!(std::fs::read_dir(&target).unwrap().next().is_none());
    }

    #[test]
    fn existing_run_dir_name_is_refused() {
        let d = tempdir();
        let now = jiff::Zoned::now();
        Archive::open(&d, &now).unwrap();
        assert!(Archive::open(&d, &now).is_err());
    }

    fn walk(p: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(p).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }

    fn tempdir() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let d = std::env::temp_dir().join(format!(
            "web-mcp-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
