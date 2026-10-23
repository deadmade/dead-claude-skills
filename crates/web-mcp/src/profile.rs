//! The search profiles: one persistent, isolated browser profile per engine, each with its own agent-browser config
//! file, Consent-O-Matic (except for Bing), a lock and a rest shared by every web-mcp process on the machine.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs::{File, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use jiff::Timestamp;
use tokio::process::Command;

use crate::browser::Browser;
use crate::engines::Engine;

pub const CONSENT_URL: &str = "https://github.com/cavi-au/Consent-O-Matic/releases/download/v1.1.5/consent-o-matic-v1.1.5-unpacked-release-chromium.zip";
pub const CONSENT_SHA256: &str = "37cec881fc5f53c84419e39d6a01cb79ff0b06b8df556219ac5c74887ba1473a";

/// How long a blocked engine sits out.
pub const REST: Duration = Duration::from_mins(30);
/// Each engine's whole budget in a search, lock wait included.
pub const ENGINE_DEADLINE: Duration = Duration::from_secs(10);
/// The Consent-O-Matic download's budget.
const DOWNLOAD: Duration = Duration::from_secs(20);
/// The zip is 88 KB.
const DOWNLOAD_MAX: usize = 1 << 20;

/// The Chrome major the user agent names when the browser's version can't be read.
// shortcut: Helium's Chromium at the spike (2026-10-23); raise it when engines start refusing user agents this old.
const FALLBACK_MAJOR: u32 = 154;

/// Unpacks the extension `zip` into `dir/consent-o-matic-<first 8 hex of its sha256>` and returns that folder.
/// It goes through a temp folder and a rename, so the folder is whole or absent; one that exists is kept, unless it
/// has no `manifest.json` (then it is replaced).
///
/// # Errors
/// When the hash isn't `expected_sha256`, an entry is a symlink or would land outside the folder (nothing is
/// written then), or writing fails.
pub fn unpack(zip: &[u8], expected_sha256: &str, dir: &Path) -> Result<PathBuf, String> {
    let sha = crate::archive::sha(zip);
    if !sha.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!("its sha256 is {sha}, not {expected_sha256}"));
    }
    let mut archive =
        zip::ZipArchive::new(io::Cursor::new(zip)).map_err(|e| format!("bad zip: {e}"))?;
    let mut names = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let f = archive
            .by_index_raw(i)
            .map_err(|e| format!("bad zip: {e}"))?;
        match f.enclosed_name() {
            Some(name) if !f.is_symlink() => names.push((name, f.is_dir())),
            _ => return Err(format!("unsafe zip entry {:?}", f.name())),
        }
    }
    let target = dir.join(format!("consent-o-matic-{}", &sha[..8]));
    let whole = || target.join("manifest.json").is_file();
    if target.exists() && !whole() {
        std::fs::remove_dir_all(&target)
            .map_err(|e| format!("could not replace {}: {e}", target.display()))?;
    }
    let tmp = dir.join(format!(
        "consent-o-matic-{}.tmp-{}",
        &sha[..8],
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    let mut write = || -> io::Result<()> {
        std::fs::create_dir_all(&tmp)?;
        for (i, (name, is_dir)) in names.iter().enumerate() {
            let path = tmp.join(name);
            if *is_dir {
                std::fs::create_dir_all(&path)?;
                continue;
            }
            std::fs::create_dir_all(path.parent().unwrap_or(&tmp))?;
            let mut f = archive.by_index(i).map_err(io::Error::other)?;
            io::copy(&mut f, &mut File::create(&path)?)?;
        }
        std::fs::rename(&tmp, &target)
    };
    let written = write();
    if written.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    match written {
        Ok(()) => Ok(target),
        // Another web-mcp unpacked it first.
        Err(_) if whole() => Ok(target),
        Err(e) => Err(format!("could not unpack into {}: {e}", target.display())),
    }
}

/// What every engine's config needs, found once per search.
#[derive(Debug)]
pub struct Ready {
    /// The browser agent-browser launches (`executablePath`).
    pub chrome: PathBuf,
    /// The unpacked Consent-O-Matic.
    pub extension: PathBuf,
    /// A regular Chrome user agent for the browser's own major version.
    pub ua: String,
}

/// An engine's lock, held while its search runs; dropping it releases it.
pub struct EngineLock {
    _file: File,
}

/// The search folder: per engine `<engine>/agent-browser.json`, `profile/`, `lock` and `rest`, plus the shared
/// `extensions/` and, for Helium, `helium-wrap.sh`.
pub struct Profiles {
    dir: PathBuf,
    /// For the Consent-O-Matic download: https only, at most 5 redirects (GitHub redirects release assets).
    http: reqwest::Client,
}

impl Profiles {
    /// `dir` is `Config::search_dir`.
    ///
    /// # Errors
    /// When there is no `dir` or the HTTP client can't be built.
    pub fn new(dir: Option<PathBuf>) -> Result<Self, String> {
        let dir = dir.ok_or("no folder for the search profiles: set WEB_MCP_SEARCH_DIR")?;
        let http = reqwest::Client::builder()
            .user_agent(concat!("web-mcp/", env!("CARGO_PKG_VERSION")))
            .https_only(true)
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| e.to_string())?;
        // Absolute: the config files name paths in it, and agent-browser runs elsewhere.
        let dir = std::path::absolute(&dir).unwrap_or(dir);
        Ok(Self { dir, http })
    }

    /// The browser (`WEB_MCP_CHROME`, read now, or the first one found) and Consent-O-Matic, downloaded on first
    /// use.
    ///
    /// # Errors
    /// When the search folder isn't the user's, no browser is found or the extension can't be had.
    pub async fn ready(&self) -> Result<Ready, String> {
        let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty());
        let home = var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
        self.ready_with(
            var("WEB_MCP_CHROME").map(PathBuf::from),
            home.as_deref(),
            &var("PATH").unwrap_or_default(),
        )
        .await
    }

    async fn ready_with(
        &self,
        chrome_env: Option<PathBuf>,
        home: Option<&Path>,
        path: &OsStr,
    ) -> Result<Ready, String> {
        self.check_owner()?;
        let (chrome, major) = pick(chrome_env, home, path).await?;
        let chrome = std::path::absolute(&chrome).unwrap_or(chrome);
        let chrome = if !cfg!(windows) && chrome.file_name() == Some(OsStr::new("helium")) {
            self.helium_wrapper(&chrome)?
        } else {
            chrome
        };
        Ok(Ready {
            chrome,
            extension: self.extension().await?,
            ua: user_agent(major),
        })
    }

    /// Creates the search folder, and refuses it when another user owns it: web-mcp runs the Helium wrapper and
    /// loads the extension from there.
    fn check_owner(&self) -> Result<(), String> {
        let dir = &self.dir;
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt as _;
            let owner = std::fs::metadata(dir)
                .map_err(|e| format!("could not read {}: {e}", dir.display()))?
                .uid();
            // SAFETY: geteuid has no preconditions and cannot fail.
            let me = unsafe { libc::geteuid() };
            if owner != me {
                return Err(format!(
                    "the search folder {} belongs to another user (uid {owner}); set WEB_MCP_SEARCH_DIR",
                    dir.display()
                ));
            }
        }
        Ok(())
    }

    /// A `#!/bin/sh` script running `helium` without `exec`: nixpkgs' Helium runs in `bwrap --die-with-parent`,
    /// which kills it 10 s after agent-browser starts it directly (findings.md, R9).
    fn helium_wrapper(&self, helium: &Path) -> Result<PathBuf, String> {
        let quoted = utf8(helium)?.replace('\'', r"'\''");
        let path = self.dir.join("helium-wrap.sh");
        let script = format!("#!/bin/sh\n'{quoted}' \"$@\"\n");
        write_if_changed(&path, script.as_bytes(), true)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        Ok(path)
    }

    async fn extension(&self) -> Result<PathBuf, String> {
        let extensions = self.dir.join("extensions");
        let ext = extensions.join(format!("consent-o-matic-{}", &CONSENT_SHA256[..8]));
        let have = || ext.join("manifest.json").is_file();
        if have() {
            return Ok(ext);
        }
        let why = |e: &dyn std::fmt::Display| format!("could not download Consent-O-Matic: {e}");
        let _lock = lock_file(&self.dir.join("extensions.lock"), Instant::now() + DOWNLOAD)
            .await
            .map_err(|e| why(&e))?
            .ok_or_else(|| why(&"another web-mcp is still downloading it"))?;
        if have() {
            return Ok(ext);
        }
        let get = async {
            let resp = self
                .http
                .get(CONSENT_URL)
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|e| e.to_string())?;
            crate::fetch::read_capped(resp, DOWNLOAD_MAX)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "it is over 1 MiB".to_owned())
        };
        let zip = tokio::time::timeout(DOWNLOAD, get)
            .await
            .map_err(|_| why(&"no answer within 20 s"))?
            .map_err(|e| why(&e))?;
        unpack(&zip, CONSENT_SHA256, &extensions).map_err(|e| why(&e))
    }

    /// Writes `<engine>/agent-browser.json` (unless it already says the same) and returns its path.
    ///
    /// # Errors
    /// When it can't be written.
    pub fn config(&self, e: Engine, r: &Ready) -> Result<PathBuf, String> {
        let dir = self.dir.join(e.name());
        // Consent-O-Matic kills Bing's result page (findings.md, R7).
        let extensions = if e == Engine::Bing {
            vec![]
        } else {
            vec![utf8(&r.extension)?]
        };
        let json = serde_json::json!({
            "profile": utf8(&dir.join("profile"))?,
            "extensions": extensions,
            "executablePath": utf8(&r.chrome)?,
            "userAgent": r.ua,
            "headed": e.headed(),
            "idleTimeout": "120s",
            // Newline-separated, no commas: agent-browser splits `args` on both.
            "args": "--lang=en-US",
        });
        let path = dir.join("agent-browser.json");
        let text = serde_json::to_string_pretty(&json).expect("a JSON value serializes");
        write_if_changed(&path, text.as_bytes(), false)
            .map_err(|err| format!("could not write {}: {err}", path.display()))?;
        Ok(path)
    }

    /// The engine's agent-browser session: one per search folder, so two folders never share a browser.
    pub fn session(&self, e: Engine) -> String {
        let hash = crate::archive::sha(self.dir.as_os_str().as_encoded_bytes());
        format!("web-mcp-search-{}-{}", &hash[..8], e.name())
    }

    /// The engine's lock, shared by every web-mcp process, retried every 100 ms until `until`.
    pub async fn lock(&self, e: Engine, until: Instant) -> Option<EngineLock> {
        let path = self.dir.join(e.name()).join("lock");
        match lock_file(&path, until).await {
            Ok(file) => Some(EngineLock { _file: file? }),
            Err(err) => {
                eprintln!("web-mcp: could not lock {}: {err}", path.display());
                None
            }
        }
    }

    /// When the engine's rest ends, if it is resting at `now`.
    pub fn resting(&self, e: Engine, now: Timestamp) -> Option<Timestamp> {
        let rest = std::fs::read_to_string(self.dir.join(e.name()).join("rest")).ok()?;
        let until: Timestamp = rest.trim().parse().ok()?;
        (until > now).then_some(until)
    }

    /// Rests the engine until `until`. The caller holds its lock.
    pub fn rest(&self, e: Engine, until: Timestamp) {
        // Best effort: an engine that can't rest is only asked again.
        let path = self.dir.join(e.name()).join("rest");
        let _ = write_if_changed(&path, until.to_string().as_bytes(), false);
    }
}

/// A path for a config file or script: written lossily, it would name another file.
fn utf8(p: &Path) -> Result<&str, String> {
    p.to_str()
        .ok_or_else(|| format!("{} is not valid UTF-8", p.display()))
}

/// The browser for search and its Chrome major (findings.md, "Order and version"): `WEB_MCP_CHROME`, the newest
/// Chrome for Testing if it starts, `helium` or `chromium` on `path`. Never the user's branded Chrome: it ignores
/// extensions loaded from a folder.
async fn pick(
    chrome_env: Option<PathBuf>,
    home: Option<&Path>,
    path: &OsStr,
) -> Result<(PathBuf, u32), String> {
    let major_of = async |bin: &Path| {
        version(bin)
            .await
            .as_deref()
            .and_then(major)
            .unwrap_or(FALLBACK_MAJOR)
    };
    if let Some(p) = chrome_env {
        if !p.is_file() {
            return Err(format!(
                "WEB_MCP_CHROME={} is not a file: point it at a browser, or unset it and run `agent-browser install`",
                p.display()
            ));
        }
        let m = major_of(&p).await;
        return Ok((p, m));
    }
    if let Some((bin, m)) = home.and_then(newest_cft)
        && version(&bin).await.is_some()
    {
        return Ok((bin, m));
    }
    for name in ["helium", "chromium"] {
        if let Some(bin) = Browser::resolve_on(name, path) {
            let m = major_of(&bin).await;
            return Ok((bin, m));
        }
    }
    Err("no browser for search: set WEB_MCP_CHROME, run `agent-browser install`, or install Helium or Chromium".into())
}

/// The newest `agent-browser install` Chrome for Testing under `home` and its major, compared by number.
fn newest_cft(home: &Path) -> Option<(PathBuf, u32)> {
    let exes = if cfg!(windows) {
        ["chrome.exe", "chrome-win64/chrome.exe"]
    } else {
        ["chrome", "chrome-linux64/chrome"]
    };
    std::fs::read_dir(home.join(".agent-browser/browsers"))
        .ok()?
        .flatten()
        .filter_map(|e| {
            let v = four_part(e.file_name().to_str()?.strip_prefix("chrome-")?)?;
            let bin = exes
                .iter()
                .map(|x| e.path().join(x))
                .find(|p| p.is_file())?;
            Some((v, bin))
        })
        .max_by_key(|(v, _)| *v)
        .map(|(v, bin)| (bin, v[0]))
}

/// `<bin> --version`'s output, `None` when it doesn't start or fails; one spawn per binary per process.
async fn version(bin: &Path) -> Option<String> {
    static SEEN: Mutex<BTreeMap<PathBuf, Option<String>>> = Mutex::new(BTreeMap::new());
    if let Some(v) = SEEN.lock().expect("versions").get(bin) {
        return v.clone();
    }
    let run = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    let v = match tokio::time::timeout(Duration::from_secs(5), run).await {
        Ok(Ok(out)) if out.status.success() => {
            Some(String::from_utf8_lossy(&out.stdout).into_owned())
        }
        _ => None,
    };
    SEEN.lock()
        .expect("versions")
        .insert(bin.to_owned(), v.clone());
    v
}

/// The major of the first `a.b.c.d` in `--version` output; for Helium, of its Chromium.
fn major(version: &str) -> Option<u32> {
    let chromium = version
        .find("Chromium ")
        .map_or(version, |i| &version[i + "Chromium ".len()..]);
    chromium
        .split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .find_map(four_part)
        .map(|v| v[0])
}

fn four_part(s: &str) -> Option<[u32; 4]> {
    let mut n = s.split('.').map(|p| p.parse().ok());
    let v = [n.next()??, n.next()??, n.next()??, n.next()??];
    n.next().is_none().then_some(v)
}

/// Chrome's own user agent, reduced as Chrome reduces it, without `Headless`.
fn user_agent(major: u32) -> String {
    let platform = if cfg!(windows) {
        "Windows NT 10.0; Win64; x64"
    } else {
        "X11; Linux x86_64"
    };
    format!(
        "Mozilla/5.0 ({platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36"
    )
}

/// Replaces `path` with `content` through a temp file and a rename (another web-mcp may be reading or running it),
/// unless it already holds exactly that.
#[cfg_attr(not(unix), allow(unused_variables))]
fn write_if_changed(path: &Path, content: &[u8], executable: bool) -> io::Result<()> {
    static N: AtomicU64 = AtomicU64::new(0); // temp names unique per call, not only per process
    if std::fs::read(path).is_ok_and(|old| old == content) {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&tmp, content)?;
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Locks `path` (created if missing), retrying every 100 ms; `Ok(None)` once `until` has passed.
async fn lock_file(path: &Path, until: Instant) -> io::Result<Option<File>> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let f = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)?;
    loop {
        match f.try_lock() {
            Ok(()) => return Ok(Some(f)),
            Err(TryLockError::Error(e)) => return Err(e),
            Err(TryLockError::WouldBlock) => {}
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(None);
        }
        tokio::time::sleep(left.min(Duration::from_millis(100))).await;
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use super::*;

    fn tempdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("web-mcp-profile-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn profiles(dir: &Path) -> Profiles {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Profiles::new(Some(dir.to_owned())).unwrap()
    }

    #[test]
    fn no_search_dir_fails_search_only() {
        let err = Profiles::new(None).err().unwrap();
        assert_eq!(
            err,
            "no folder for the search profiles: set WEB_MCP_SEARCH_DIR"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn foreign_search_dir_is_refused() {
        // SAFETY: geteuid has no preconditions and cannot fail.
        if unsafe { libc::geteuid() } == 0 {
            return; // root owns `/`
        }
        let p = profiles(Path::new("/"));
        let err = p.ready_with(None, None, OsStr::new("")).await.unwrap_err();
        assert!(err.contains("belongs to another user"), "{err}");
    }

    #[test]
    fn broken_existing_version_is_replaced() {
        let dir = tempdir("broken");
        let zip = zip_of(&[("manifest.json", "{}")], None);
        let sha = crate::archive::sha(&zip);
        let target = dir.join(format!("consent-o-matic-{}", &sha[..8]));
        std::fs::create_dir_all(target.join("half")).unwrap();
        assert_eq!(unpack(&zip, &sha, &dir).unwrap(), target);
        assert!(target.join("manifest.json").is_file());
        assert!(!target.join("half").exists());
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_paths_are_refused() {
        use std::os::unix::ffi::OsStrExt as _;
        let dir = tempdir("utf8");
        let p = profiles(&dir);
        let mut r = ready(&dir);
        r.chrome = dir.join(OsStr::from_bytes(b"chr\xffme"));
        let err = p.config(Engine::Brave, &r).unwrap_err();
        assert!(err.contains("not valid UTF-8"), "{err}");
        assert!(p.helium_wrapper(&r.chrome).is_err());
    }

    fn zip_of(entries: &[(&str, &str)], symlink: Option<(&str, &str)>) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        for (name, body) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        if let Some((name, target)) = symlink {
            w.add_symlink(name, target, opts).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    fn ready(dir: &Path) -> Ready {
        Ready {
            chrome: dir.join("chrome"),
            extension: dir.join("extensions/consent-o-matic-37cec881"),
            ua: "Mozilla/5.0 Chrome/154.0.0.0".into(),
        }
    }

    #[test]
    fn bad_extension_hash_is_refused() {
        let dir = tempdir("badhash");
        let zip = zip_of(&[("manifest.json", "{}")], None);
        let err = unpack(&zip, &"0".repeat(64), &dir).unwrap_err();
        assert!(err.contains("sha256"), "{err}");
        assert_eq!(files_in(&dir), Vec::<String>::new());
    }

    #[test]
    fn symlink_or_escape_entries_are_refused() {
        let dir = tempdir("escape");
        for (i, zip) in [
            zip_of(&[("manifest.json", "{}")], Some(("link", "/etc/passwd"))),
            zip_of(&[("manifest.json", "{}"), ("../evil.js", "x")], None),
        ]
        .iter()
        .enumerate()
        {
            let sha = crate::archive::sha(zip);
            let got = unpack(zip, &sha, &dir);
            assert!(got.is_err(), "zip {i}: {got:?}");
            assert_eq!(files_in(&dir), Vec::<String>::new());
        }
        assert!(!dir.parent().unwrap().join("evil.js").exists());
    }

    #[test]
    fn unpack_keeps_existing_version() {
        let dir = tempdir("keep");
        let zip = zip_of(&[("manifest.json", "{\"v\":1}"), ("sub/a.js", "a")], None);
        let sha = crate::archive::sha(&zip);
        let got = unpack(&zip, &sha, &dir).unwrap();
        assert_eq!(got, dir.join(format!("consent-o-matic-{}", &sha[..8])));
        assert_eq!(std::fs::read_to_string(got.join("sub/a.js")).unwrap(), "a");
        std::fs::write(got.join("manifest.json"), "mine").unwrap();
        assert_eq!(unpack(&zip, &sha, &dir).unwrap(), got);
        assert_eq!(
            std::fs::read_to_string(got.join("manifest.json")).unwrap(),
            "mine"
        );
        assert_eq!(files_in(&dir), [format!("consent-o-matic-{}", &sha[..8])]);
    }

    #[test]
    fn config_types_match_agent_browser_schema() {
        let dir = tempdir("config");
        let p = profiles(&dir);
        let r = ready(&dir);
        let path = p.config(Engine::Brave, &r).unwrap();
        assert_eq!(path, dir.join("brave/agent-browser.json"));
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        assert_eq!(v["profile"], s(&dir.join("brave/profile")));
        assert_eq!(v["extensions"], serde_json::json!([s(&r.extension)]));
        assert_eq!(v["executablePath"], s(&r.chrome));
        assert_eq!(v["userAgent"], r.ua);
        assert_eq!(v["headed"], false);
        assert_eq!(v["idleTimeout"], "120s");
        let args = v["args"].as_str().unwrap();
        assert!(
            args.contains("--lang=en-US") && !args.contains(','),
            "{args}"
        );
        // Unchanged content is not rewritten.
        let before = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(20));
        p.config(Engine::Brave, &r).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            before
        );
    }

    #[test]
    fn bing_config_has_no_extension() {
        let dir = tempdir("bing");
        let p = profiles(&dir);
        let path = p.config(Engine::Bing, &ready(&dir)).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(v["extensions"], serde_json::json!([]));
    }

    #[test]
    fn rest_round_trips_and_expires() {
        let dir = tempdir("rest");
        let p = profiles(&dir);
        let now = Timestamp::now();
        assert_eq!(p.resting(Engine::Google, now), None);
        let until = now + REST;
        p.rest(Engine::Google, until);
        assert_eq!(p.resting(Engine::Google, now), Some(until));
        assert_eq!(p.resting(Engine::Bing, now), None);
        assert_eq!(p.resting(Engine::Google, until), None);
    }

    #[test]
    fn unreadable_rest_is_not_resting() {
        let dir = tempdir("badrest");
        let p = profiles(&dir);
        std::fs::create_dir_all(dir.join("google")).unwrap();
        std::fs::write(dir.join("google/rest"), "soon").unwrap();
        assert_eq!(p.resting(Engine::Google, Timestamp::now()), None);
    }

    #[tokio::test]
    async fn lock_waits_then_gives_up() {
        let dir = tempdir("lock");
        let p = profiles(&dir);
        let held = p.lock(Engine::Scholar, Instant::now()).await.unwrap();
        let t = Instant::now();
        assert!(
            p.lock(Engine::Scholar, t + Duration::from_millis(300))
                .await
                .is_none()
        );
        assert!(t.elapsed() >= Duration::from_millis(300));
        // Another engine's lock is its own.
        assert!(p.lock(Engine::Brave, Instant::now()).await.is_some());
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            drop(held);
        });
        let got = p
            .lock(Engine::Scholar, Instant::now() + Duration::from_secs(3))
            .await;
        assert!(got.is_some());
        release.join().unwrap();
    }

    #[test]
    fn session_name_carries_dir_hash() {
        let a = profiles(&tempdir("session-a"));
        let b = profiles(&tempdir("session-b"));
        let s = a.session(Engine::SemanticScholar);
        let hash = &crate::archive::sha(a.dir.as_os_str().as_encoded_bytes())[..8];
        assert_eq!(s, format!("web-mcp-search-{hash}-semanticscholar"));
        assert_ne!(s, b.session(Engine::SemanticScholar));
        assert!(crate::browser::check_session(&s).is_err());
    }

    #[test]
    fn version_majors_are_read() {
        assert_eq!(major("Helium 0.18.1.1 (Chromium 154.0.8037.57)"), Some(154));
        assert_eq!(major("Chromium 153.0.7000.1 built on NixOS"), Some(153));
        assert_eq!(major("Google Chrome for Testing 156.0.1.2"), Some(156));
        assert_eq!(major("nothing here 1.2"), None);
        assert!(user_agent(154).contains("Chrome/154.0.0.0 Safari/537.36"));
        assert!(!user_agent(154).contains("Headless"));
    }

    /// A dummy executable printing `out` for `--version`, exiting with `code`.
    #[cfg(unix)]
    fn exe(path: &Path, out: &str, code: i32) {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, format!("#!/bin/sh\necho '{out}'\nexit {code}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A search dir with Consent-O-Matic already unpacked, so `ready` never downloads.
    #[cfg(unix)]
    fn seeded(tag: &str) -> PathBuf {
        let dir = tempdir(tag);
        let ext = dir.join(format!(
            "extensions/consent-o-matic-{}",
            &CONSENT_SHA256[..8]
        ));
        std::fs::create_dir_all(&ext).unwrap();
        std::fs::write(ext.join("manifest.json"), "{}").unwrap();
        dir
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn browser_order_is_env_then_newest_cft_then_helium_then_chromium() {
        let dir = seeded("order");
        let p = profiles(&dir);
        let home = dir.join("home");
        let cft = home.join(".agent-browser/browsers");
        let bin = dir.join("bin");
        let path = std::env::join_paths([&bin]).unwrap();
        exe(&bin.join("chromium"), "Chromium 153.0.7000.1", 0);

        let r = p.ready_with(None, Some(&home), &path).await.unwrap();
        assert_eq!(r.chrome, bin.join("chromium"));
        assert!(r.ua.contains("Chrome/153.0.0.0"), "{}", r.ua);

        exe(
            &bin.join("helium"),
            "Helium 0.18.1.1 (Chromium 154.0.8037.57)",
            0,
        );
        let r = p.ready_with(None, Some(&home), &path).await.unwrap();
        assert_eq!(r.chrome, dir.join("helium-wrap.sh"));
        assert!(r.ua.contains("Chrome/154.0.0.0"), "{}", r.ua);

        // Newest by number, not by string; a folder without its binary doesn't count.
        exe(
            &cft.join("chrome-99.0.1.2/chrome"),
            "Google Chrome for Testing 99.0.1.2",
            0,
        );
        exe(
            &cft.join("chrome-156.0.1.2/chrome-linux64/chrome"),
            "Google Chrome for Testing 156.0.1.2",
            0,
        );
        std::fs::create_dir_all(cft.join("chrome-200.0.0.0")).unwrap();
        let r = p.ready_with(None, Some(&home), &path).await.unwrap();
        assert_eq!(r.chrome, cft.join("chrome-156.0.1.2/chrome-linux64/chrome"));
        assert!(r.ua.contains("Chrome/156.0.0.0"), "{}", r.ua);

        // A Chrome for Testing that doesn't start is passed over.
        let dead = home.join("dead");
        exe(
            &dead.join(".agent-browser/browsers/chrome-157.0.0.1/chrome"),
            "",
            1,
        );
        let r = p.ready_with(None, Some(&dead), &path).await.unwrap();
        assert_eq!(r.chrome, dir.join("helium-wrap.sh"));

        let mine = dir.join("mine");
        std::fs::write(&mine, "").unwrap();
        let r = p
            .ready_with(Some(mine.clone()), Some(&home), &path)
            .await
            .unwrap();
        assert_eq!(r.chrome, mine);
        assert!(
            r.ua.contains(&format!("Chrome/{FALLBACK_MAJOR}.0.0.0")),
            "{}",
            r.ua
        );

        let none = p.ready_with(None, None, OsStr::new("")).await.unwrap_err();
        assert!(none.contains("WEB_MCP_CHROME"), "{none}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn helium_gets_a_wrapper() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = seeded("helium");
        let p = profiles(&dir);
        let bin = dir.join("it's bin");
        exe(
            &bin.join("helium"),
            "Helium 0.18.1.1 (Chromium 154.0.8037.57)",
            0,
        );
        let path = std::env::join_paths([&bin]).unwrap();
        let r = p.ready_with(None, None, &path).await.unwrap();
        assert_eq!(r.chrome, dir.join("helium-wrap.sh"));
        let script = std::fs::read_to_string(&r.chrome).unwrap();
        let quoted = bin.join("helium").to_string_lossy().replace('\'', r"'\''");
        assert_eq!(script, format!("#!/bin/sh\n'{quoted}' \"$@\"\n"));
        let mode = std::fs::metadata(&r.chrome).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        let out = std::process::Command::new(&r.chrome)
            .arg("--version")
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("Helium"));
    }
}
