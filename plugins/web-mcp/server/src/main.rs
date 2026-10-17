mod archive;
mod browser;
mod config;
mod extract;
mod fetch;
mod images;
mod limits;
mod papers;
mod passages;
mod rank;
mod search;
mod tools;

use std::sync::Arc;

use rmcp::{ServiceExt, transport::stdio};

/// State shared by every tool call.
pub struct Ctx {
    pub cfg: config::Config,
    pub http: reqwest::Client,
    /// Same, but its resolver never hands out private addresses: for fetches that may not reach them.
    pub http_public: reqwest::Client,
    pub limits: limits::HostLimits,
    pub archive: archive::Archive,
    pub inflight: fetch::Inflight,
    pub index: rank::Index,
    pub search: search::SearxNg,
    pub browser: browser::Browser,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("web-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let cfg = config::Config::from_env()?;
    // ring, not aws-lc-rs: no cmake or C toolchain needed to build.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let archive = archive::Archive::open(&cfg.project, &jiff::Zoned::now())?;
    let http = fetch::client(false)?;
    let ctx = Ctx {
        search: search::SearxNg {
            base: cfg.searxng.clone(),
            http: http.clone(),
        },
        index: rank::Index::open(archive.web())?,
        archive,
        browser: browser_from(&cfg),
        http,
        http_public: fetch::client(true)?,
        limits: limits::HostLimits::default(),
        inflight: fetch::Inflight::default(),
        cfg,
    };
    let ctx = Arc::new(ctx);
    let served = tools::Server::new(Arc::clone(&ctx))
        .serve(stdio())
        .await?
        .waiting()
        .await;
    // stdin closed: don't leave the sessions' daemons and browsers behind.
    ctx.browser.close_all().await;
    served?;
    Ok(())
}

/// `WEB_MCP_FALLBACK_MS` shortens the fetch fallback's deadline (for tests).
fn browser_from(cfg: &config::Config) -> browser::Browser {
    let mut b = browser::Browser::new(&cfg.agent_browser);
    if let Some(ms) = std::env::var("WEB_MCP_FALLBACK_MS")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        b.fallback_deadline = std::time::Duration::from_millis(ms);
    }
    b
}
