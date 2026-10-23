use std::path::PathBuf;
use std::time::Duration;

use url::Url;

/// Where the paper APIs live: the real ones unless a test points them at a stub.
pub struct PaperUrls {
    pub arxiv: Url,
    pub openalex: Url,
    pub crossref: Url,
}

/// Where the lookup sources live: the real ones unless a test points them at a stub.
pub struct LookupUrls {
    pub doh: Url,
    /// The directory holding IANA's RDAP bootstrap files.
    pub rdap_bootstrap: Url,
    pub crtsh: Url,
    pub cdx: Url,
    /// The Wayback Machine's root, where `web/<timestamp>id_/<url>` serves a raw capture.
    pub wayback: Url,
    pub internetdb: Url,
    /// OSV's API root, ending in `/`.
    pub osv: Url,
    pub nvd: Url,
    pub epss: Url,
    pub kev: Url,
}

pub struct Config {
    pub papers: PaperUrls,
    pub lookup_urls: LookupUrls,
    /// Replaces every lookup source's own deadline (for tests).
    pub lookup_deadline: Option<Duration>,
    /// How long each paper source may take before a search answers without it.
    pub papers_deadline: Duration,
    pub project: PathBuf,
    pub searxng: Url,
    pub agent_browser: String,
    /// The search profiles' folder: per user and machine, not per project.
    pub search_dir: PathBuf,
}

impl Config {
    /// Reads `CLAUDE_PROJECT_DIR`, `WEB_MCP_SEARXNG_URL`, `WEB_MCP_AGENT_BROWSER`, `WEB_MCP_SEARCH_DIR` (unset:
    /// `$XDG_DATA_HOME/web-mcp`, `~/.local/share/web-mcp`, or `%LOCALAPPDATA%\web-mcp` on Windows) and
    /// `WEB_MCP_{ARXIV,OPENALEX,CROSSREF,DOH,RDAP,CRTSH,CDX,WAYBACK,INTERNETDB,OSV,NVD,EPSS,KEV}_URL`, each with its default, `WEB_MCP_PAPERS_MS` (8 s; shorter for
    /// tests) and `WEB_MCP_LOOKUP_MS` (unset: each lookup source's own deadline).
    ///
    /// # Errors
    /// When one of the URL variables is not a URL.
    pub fn from_env() -> Result<Self, url::ParseError> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let url = |k: &str, default: &str| Url::parse(&var(k).unwrap_or_else(|| default.into()));
        Ok(Self {
            papers: PaperUrls {
                arxiv: url("WEB_MCP_ARXIV_URL", "https://export.arxiv.org/api/query")?,
                openalex: url("WEB_MCP_OPENALEX_URL", "https://api.openalex.org/works")?,
                crossref: url("WEB_MCP_CROSSREF_URL", "https://api.crossref.org/works")?,
            },
            lookup_urls: LookupUrls {
                doh: url("WEB_MCP_DOH_URL", "https://cloudflare-dns.com/dns-query")?,
                rdap_bootstrap: url("WEB_MCP_RDAP_URL", "https://data.iana.org/rdap/")?,
                crtsh: url("WEB_MCP_CRTSH_URL", "https://crt.sh/")?,
                cdx: url("WEB_MCP_CDX_URL", "https://web.archive.org/cdx/search/cdx")?,
                wayback: url("WEB_MCP_WAYBACK_URL", "https://web.archive.org/")?,
                internetdb: url("WEB_MCP_INTERNETDB_URL", "https://internetdb.shodan.io/")?,
                osv: url("WEB_MCP_OSV_URL", "https://api.osv.dev/v1/")?,
                nvd: url(
                    "WEB_MCP_NVD_URL",
                    "https://services.nvd.nist.gov/rest/json/cves/2.0",
                )?,
                epss: url("WEB_MCP_EPSS_URL", "https://api.first.org/data/v1/epss")?,
                kev: url(
                    "WEB_MCP_KEV_URL",
                    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
                )?,
            },
            lookup_deadline: var("WEB_MCP_LOOKUP_MS")
                .and_then(|v| v.parse().ok())
                .map(Duration::from_millis),
            papers_deadline: var("WEB_MCP_PAPERS_MS")
                .and_then(|v| v.parse().ok())
                .map_or(Duration::from_secs(8), Duration::from_millis),
            project: var("CLAUDE_PROJECT_DIR").map_or_else(|| PathBuf::from("."), PathBuf::from),
            searxng: Url::parse(
                &var("WEB_MCP_SEARXNG_URL").unwrap_or_else(|| "http://127.0.0.1:8888".into()),
            )?,
            agent_browser: var("WEB_MCP_AGENT_BROWSER").unwrap_or_else(|| "agent-browser".into()),
            search_dir: var("WEB_MCP_SEARCH_DIR").map_or_else(default_search_dir, PathBuf::from),
        })
    }
}

fn default_search_dir() -> PathBuf {
    let var = |k: &str| {
        std::env::var_os(k)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(windows) {
        var("LOCALAPPDATA")
    } else {
        var("XDG_DATA_HOME").or_else(|| var("HOME").map(|h| h.join(".local/share")))
    }
    .unwrap_or_else(std::env::temp_dir)
    .join("web-mcp")
}
