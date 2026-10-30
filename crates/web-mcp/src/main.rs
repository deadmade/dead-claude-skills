mod api;
mod archive;
mod browser;
mod config;
mod engines;
mod extract;
mod fetch;
mod fuse;
mod images;
mod limits;
mod lookup;
mod papers;
mod passages;
mod profile;
mod rank;
mod search;
mod tools;
mod window;

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
    pub lookup: lookup::Cache,
    /// `Err` without a search folder: then `search`, `browser` and the fetch fallback fail.
    pub profiles: Result<Arc<profile::Profiles>, String>,
    pub browser: browser::Browser,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    window::tie_to_process();
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("web-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let cfg = config::Config::from_env()?;
    // ring, not aws-lc-rs: no cmake or C toolchain needed to build.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let archive = archive::Archive::open(&cfg.project, &jiff::Zoned::now())?;
    let http = fetch::client(false)?;
    let profiles = profile::Profiles::new(cfg.search_dir.clone()).map(Arc::new);
    let ctx = Ctx {
        browser: browser_from(&cfg, profiles.clone()),
        profiles,
        archive,
        http,
        http_public: fetch::client(true)?,
        limits: limits::HostLimits::default(),
        inflight: fetch::Inflight::default(),
        lookup: lookup::Cache::default(),
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

/// The browser over the window of `profiles`. `WEB_MCP_FALLBACK_MS` shortens the fetch fallback's deadline (for
/// tests).
fn browser_from(
    cfg: &config::Config,
    profiles: Result<Arc<profile::Profiles>, String>,
) -> browser::Browser {
    let mut b = browser::Browser::new(&cfg.agent_browser, window::Window::new(profiles));
    if let Some(ms) = std::env::var("WEB_MCP_FALLBACK_MS")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        b.fallback_deadline = std::time::Duration::from_millis(ms);
    }
    b
}
