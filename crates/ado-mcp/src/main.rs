mod api;
mod config;
mod remote;
mod tools;

use std::sync::Arc;

use rmcp::{ServiceExt, transport::stdio};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("ado-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let cfg = config::Config::from_env()?;
    // ring, not aws-lc-rs: no cmake or C toolchain needed to build.
    let _ = rustls::crypto::ring::default_provider().install_default();
    tools::Server::new(Arc::new(cfg))?
        .serve(stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
