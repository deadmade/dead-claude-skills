mod archive;
mod config;
mod extract;
mod fetch;
mod images;
mod limits;
mod passages;
mod rank;
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
    let ctx = Ctx {
        index: rank::Index::open(archive.web())?,
        archive,
        http: fetch::client(false)?,
        http_public: fetch::client(true)?,
        limits: limits::HostLimits::default(),
        inflight: fetch::Inflight::default(),
        cfg,
    };
    let server = tools::Server::new(Arc::new(ctx));
    server.serve(stdio()).await?.waiting().await?;
    Ok(())
}
