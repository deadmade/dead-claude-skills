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
        /// What the search was narrowed to; empty when unfiltered. Part of the file name.
        filter: String,
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
        /// False for private pages (e.g. a private peer address), so `cached` never serves them.
        cache: bool,
    },
    Pdf {
        url: Url,
        final_url: Url,
        bytes: Vec<u8>,
        text: String,
        cache: bool,
    },
    Screenshot {
        session: String,
        jpeg: Vec<u8>,
    },
    /// One source's reply to a lookup, kept as the source sent it. Never cached: lookups always ask again.
    Lookup {
        kind: &'static str,
        target: String,
        source: &'static str,
        url: Url,
        status: u16,
        query: serde_json::Value,
        reply: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Archived {
    /// The page's or PDF's final URL; empty for searches and screenshots.
    pub url: String,
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
    Lookup,
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

    /// The absolute `.web` folder that `Archived::path` is relative to.
    #[must_use]
    pub fn web(&self) -> &Path {
        &self.0.web
    }

    /// A private scratch folder in this run's folder (made on demand), for files other programs write.
    ///
    /// # Errors
    /// When the folder can't be created.
    pub fn scratch(&self) -> io::Result<PathBuf> {
        let dir = self.0.run.join(".tmp");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// The latest page or PDF put for this URL in this run. Never for private URLs.
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
        let mut url_out = String::new();
        let entry = |url: String, query, kind, sha256, path: &Path| IndexEntry {
            url,
            query,
            time: time.clone(),
            kind,
            sha256,
            path: self.rel(path).to_string_lossy().into_owned(),
        };
        let main = match item {
            Item::Search {
                query,
                filter,
                json,
            } => {
                let hashed = if filter.is_empty() {
                    query.clone()
                } else {
                    format!("{query}\n{filter}")
                };
                let name = format!("{}-{}", sanitize(&query, 40), short_hash(&hashed));
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
                cache,
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
                if cache {
                    keys = vec![url.to_string(), final_url.to_string()];
                }
                url_out = final_url.to_string();
                (md, raw_sha)
            }
            Item::Pdf {
                url,
                final_url,
                bytes,
                text,
                cache,
            } => {
                let s = slug(&final_url);
                let path = self.run.join("pdfs").join(format!("{s}.pdf"));
                Self::write(&path, &bytes).await?;
                Self::write(
                    &self.run.join("pdfs").join(format!("{s}.txt")),
                    text.as_bytes(),
                )
                .await?;
                lines.push(entry(
                    final_url.to_string(),
                    None,
                    Kind::Pdf,
                    sha(&bytes),
                    &path,
                ));
                if cache {
                    keys = vec![url.to_string(), final_url.to_string()];
                }
                url_out = final_url.to_string();
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
            Item::Lookup {
                kind,
                target,
                source,
                url,
                status,
                query,
                reply,
            } => {
                #[derive(Serialize)]
                struct Record<'a> {
                    query: &'a serde_json::Value,
                    source: &'a str,
                    url: &'a str,
                    time: &'a str,
                    status: u16,
                    reply: serde_json::Value,
                }
                let n = self.seq.fetch_add(1, Ordering::Relaxed);
                let path = self.run.join("lookups").join(kind).join(format!(
                    "{}-{}-{}-{n}.json",
                    sanitize(&target, 40),
                    sanitize(source, 20),
                    short_hash(url.as_str())
                ));
                let reply =
                    serde_json::from_str(&reply).unwrap_or(serde_json::Value::String(reply));
                let record = Record {
                    query: &query,
                    source,
                    url: url.as_str(),
                    time: &time,
                    status,
                    reply,
                };
                let json = serde_json::to_vec_pretty(&record).map_err(io::Error::other)?;
                Self::write(&path, &json).await?;
                lines.push(entry(
                    url.to_string(),
                    Some(format!("{kind} {target}")),
                    Kind::Lookup,
                    sha(&json),
                    &path,
                ));
                url_out = url.to_string();
                (path, sha(&json))
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
            url: url_out,
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

/// A file name from the outside, valid on Windows too: no path parts, no leading dot, no trailing dot
/// or space, `_` for control and reserved characters, at most 100 bytes with the extension kept.
fn sanitize_file(name: &str) -> String {
    const MAX: usize = 100;
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let base: String = base
        .trim_start_matches('.')
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let base = base.trim_end_matches(['.', ' ']);
    if base.is_empty() {
        return "image".into();
    }
    if base.len() <= MAX {
        return base.to_owned();
    }
    let ext = Path::new(base)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() < 10)
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut end = MAX - ext.len();
    while !base.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{ext}", &base[..end])
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
        Some(Host::Ipv6(ip)) => is_private_ip(IpAddr::V6(ip)),
    }
}

/// Whether `ip` is in the comma-separated `WEB_MCP_TEST_PUBLIC_IP` list.
#[cfg(any(debug_assertions, feature = "test-hooks"))]
fn listed_public(list: Option<&str>, ip: IpAddr) -> bool {
    list.is_some_and(|l| l.split(',').any(|v| v.trim() == ip.to_string()))
}

#[must_use]
pub fn is_private_ip(ip: IpAddr) -> bool {
    // Tests and the H5 driver serve "public" pages from loopback; only debug builds or the `test-hooks`
    // feature read this, a normal release never does.
    #[cfg(any(debug_assertions, feature = "test-hooks"))]
    if listed_public(std::env::var("WEB_MCP_TEST_PUBLIC_IP").ok().as_deref(), ip) {
        return false;
    }
    match ip {
        IpAddr::V4(v) => {
            v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || (v.octets()[0] == 100 && v.octets()[1] & 0xc0 == 64) // CGNAT 100.64.0.0/10
        }
        IpAddr::V6(ip) => {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_public_ip_list() {
        let list = Some("127.0.0.2, 127.0.0.3");
        assert!(listed_public(list, "127.0.0.3".parse().unwrap()));
        assert!(!listed_public(list, "127.0.0.4".parse().unwrap()));
        assert!(!listed_public(None, "127.0.0.2".parse().unwrap()));
    }

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
            cache: true,
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
                        filter: String::new(),
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
    async fn pdfs_and_uncacheable_pages() {
        let d = tempdir();
        let a = open(&d);
        let (url, fin) = (u("https://example.com/p"), u("https://example.com/p.pdf"));
        let got = a
            .put(Item::Pdf {
                url: url.clone(),
                final_url: fin.clone(),
                bytes: b"%PDF".to_vec(),
                text: "t".into(),
                cache: true,
            })
            .await
            .unwrap();
        assert_eq!(got.url, fin.as_str());
        assert_eq!(a.cached(&url), Some(got.clone()));
        assert_eq!(a.cached(&fin), Some(got));
        let mut p = page("https://example.com/no", None);
        if let Item::Page { cache, .. } = &mut p {
            *cache = false;
        }
        a.put(p).await.unwrap();
        assert!(a.cached(&u("https://example.com/no")).is_none());
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
    fn long_and_illegal_image_names_are_sanitized() {
        let long = format!("{}.png", "a".repeat(300));
        let got = sanitize_file(&long);
        assert_eq!(got, format!("{}.png", "a".repeat(96)));
        assert_eq!(
            sanitize_file("a<b>c:d\"e|f?g*h\u{1}.jpg."),
            "a_b_c_d_e_f_g_h_.jpg"
        );
        assert_eq!(sanitize_file("dir\\..\\.x"), "x");
        assert!(sanitize_file(&"é".repeat(80)).len() <= 100);
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

    fn lookup() -> Item {
        Item::Lookup {
            kind: "dns",
            target: "example.com".into(),
            source: "Cloudflare DoH",
            url: u("https://cloudflare-dns.com/dns-query?name=example.com&type=A"),
            status: 200,
            query: serde_json::json!({"kind": "dns", "target": "example.com", "record": "A"}),
            reply: r#"{"Status":0}"#.into(),
        }
    }

    #[tokio::test]
    async fn put_lookup_writes_pretty_json_and_index_line() {
        let d = tempdir();
        let a = open(&d);
        let got = a.put(lookup()).await.unwrap();
        assert!(
            got.path.starts_with(a.0.rel(&a.0.run).join("lookups/dns")),
            "{got:?}"
        );
        let body = std::fs::read_to_string(a.0.web.join(&got.path)).unwrap();
        assert!(body.starts_with("{\n  \"query\": {"), "{body}");
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["reply"]["Status"], 0);
        assert_eq!(v["source"], "Cloudflare DoH");
        assert_eq!(v["status"], 200);
        let line = std::fs::read_to_string(a.0.run.join("index.jsonl")).unwrap();
        assert!(line.contains(r#""type":"lookup""#), "{line}");
        assert!(line.contains(r#""query":"dns example.com""#), "{line}");
        let url = u("https://cloudflare-dns.com/dns-query?name=example.com&type=A");
        assert!(line.contains(url.as_str()), "{line}");
        assert!(a.cached(&url).is_none());
    }

    #[tokio::test]
    async fn two_identical_lookups_write_two_files() {
        let d = tempdir();
        let a = open(&d);
        let x = a.put(lookup()).await.unwrap();
        let y = a.put(lookup()).await.unwrap();
        assert_ne!(x.path, y.path);
        assert!(a.0.web.join(&x.path).is_file() && a.0.web.join(&y.path).is_file());
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
