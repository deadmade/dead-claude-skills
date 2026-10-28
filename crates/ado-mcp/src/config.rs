use std::path::PathBuf;

use anyhow::{Context as _, Result, bail};
use url::{Host, Url};

/// What the plugin's `.mcp.json` passes in. No `Debug`: the PAT must not reach a log by accident.
pub struct Config {
    /// The collection URL, always ending in `/` so `Url::join` keeps the collection.
    pub org_url: Url,
    pub pat: String,
    pub project_dir: PathBuf,
}

impl Config {
    /// Reads `ADO_ORG_URL`, `ADO_PAT` and `ADO_PROJECT_DIR` (default: the working directory).
    ///
    /// # Errors
    /// When a required variable is unset or empty, or `ADO_ORG_URL` is not a URL.
    pub fn from_env() -> Result<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let need = |k: &str| {
            var(k).with_context(|| {
                format!("{k} is not set: configure it with /plugin configure mcp-azure")
            })
        };
        let mut org = need("ADO_ORG_URL")?;
        let pat = need("ADO_PAT")?;
        if !org.ends_with('/') {
            org.push('/');
        }
        let Ok(org_url) = Url::parse(&org) else {
            bail!("ADO_ORG_URL is not a URL: configure it with /plugin configure mcp-azure");
        };
        if !secure(&org_url) {
            bail!("ADO_ORG_URL must be https (the PAT would travel in clear text)");
        }
        let project_dir = match var("ADO_PROJECT_DIR") {
            Some(d) => PathBuf::from(d),
            None => std::env::current_dir()?,
        };
        Ok(Self {
            org_url,
            pat,
            project_dir,
        })
    }
}

/// `https`, or `http` to this machine only (the tests' fake server): Basic auth carries the PAT as is.
fn secure(url: &Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => match url.host() {
            Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
            Some(Host::Ipv4(ip)) => ip.is_loopback(),
            Some(Host::Ipv6(ip)) => ip.is_loopback(),
            None => false,
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_only_to_loopback() {
        let ok = |u: &str| secure(&Url::parse(u).unwrap());
        for u in [
            "https://ado.example/tfs/Coll/",
            "http://127.0.0.1:8080/tfs/Coll/",
            "http://127.9.9.9/Coll/",
            "http://[::1]:80/Coll/",
            "http://LOCALHOST/Coll/",
        ] {
            assert!(ok(u), "{u}");
        }
        for u in [
            "http://ado.example/tfs/Coll/",
            "http://10.0.0.1/Coll/",
            "http://localhost.evil.example/Coll/",
            "http://[::2]/Coll/",
            "ftp://ado.example/Coll/",
            "file:///Coll/",
            "ws://127.0.0.1/Coll/",
        ] {
            assert!(!ok(u), "{u}");
        }
    }
}
