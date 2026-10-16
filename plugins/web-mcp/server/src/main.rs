mod archive;
mod config;
mod extract;
mod fetch;
mod images;
mod limits;
mod tools;

use std::sync::Arc;

use rmcp::{ServiceExt, transport::stdio};

/// State shared by every tool call.
pub struct Ctx {
    pub cfg: config::Config,
    pub http: reqwest::Client,
    pub limits: limits::HostLimits,
    pub archive: archive::Archive,
    pub inflight: fetch::Inflight,
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
    let ctx = Ctx {
        http: reqwest::Client::builder()
            .user_agent(concat!("web-mcp/", env!("CARGO_PKG_VERSION")))
            .build()?,
        limits: limits::HostLimits::default(),
        archive: archive::Archive::open(&cfg.project, &jiff::Zoned::now())?,
        inflight: fetch::Inflight::default(),
        cfg,
    };
    let server = tools::Server::new(Arc::new(ctx));
    server.serve(stdio()).await?.waiting().await?;
    Ok(())
}
