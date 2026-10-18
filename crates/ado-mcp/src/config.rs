use std::path::PathBuf;

use anyhow::{Context as _, Result, bail};
use url::Url;

/// What the plugin's `.mcp.json` passes in. No `Debug`: the PAT must not reach a log by accident.
pub struct Config {
    /// The collection URL, always ending in `/` so `Url::join` keeps the collection.
    pub org_url: Url,
    pub pat: String,
    pub default_project: Option<String>,
    pub project_dir: PathBuf,
}

impl Config {
    /// Reads `ADO_ORG_URL`, `ADO_PAT`, `ADO_DEFAULT_PROJECT` and `ADO_PROJECT_DIR` (default: the working directory).
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
        let project_dir = match var("ADO_PROJECT_DIR") {
            Some(d) => PathBuf::from(d),
            None => std::env::current_dir()?,
        };
        Ok(Self {
            org_url,
            pat,
            default_project: var("ADO_DEFAULT_PROJECT"),
            project_dir,
        })
    }
}
