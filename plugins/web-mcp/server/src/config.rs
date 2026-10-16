use std::path::PathBuf;

use url::Url;

pub struct Config {
    pub project: PathBuf,
    pub searxng: Url,
    pub agent_browser: String,
}

impl Config {
    /// Reads `CLAUDE_PROJECT_DIR`, `WEB_MCP_SEARXNG_URL` and `WEB_MCP_AGENT_BROWSER`, each with its default.
    ///
    /// # Errors
    /// When `WEB_MCP_SEARXNG_URL` is not a URL.
    pub fn from_env() -> Result<Self, url::ParseError> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Ok(Self {
            project: var("CLAUDE_PROJECT_DIR").map_or_else(|| PathBuf::from("."), PathBuf::from),
            searxng: Url::parse(
                &var("WEB_MCP_SEARXNG_URL").unwrap_or_else(|| "http://127.0.0.1:8888".into()),
            )?,
            agent_browser: var("WEB_MCP_AGENT_BROWSER").unwrap_or_else(|| "agent-browser".into()),
        })
    }
}
