// The stub tools read none of the config or arguments yet; later tasks do. Remove this then.
#![allow(dead_code)]

mod config;
mod tools;

use rmcp::{ServiceExt, transport::stdio};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("web-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let server = tools::Server::new(config::Config::from_env()?);
    server.serve(stdio()).await?.waiting().await?;
    Ok(())
}
