mod api;
mod config;
mod ctx;
mod file;
mod out;
mod pipeline;
mod pr;
mod remote;
mod search;
mod tools;
mod wi;

use rmcp::{ServiceExt, transport::stdio};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("ado-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let cfg = config::Config::from_env()?;
    tools::Server::new(cfg)?
        .serve(stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
