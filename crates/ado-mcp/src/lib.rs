//! What the MCP server (`main.rs`) and the timetrack TUI (`bin/timetrack`) share: the config, the Azure DevOps client
//! and the tools.

mod api;
mod config;
mod ctx;
mod out;
mod pipeline;
mod pr;
mod remote;
mod tools;
mod wi;

pub use api::{Api, ApiError};
pub use config::Config;
pub use tools::Server;
pub use wi::{Ticket, mine, tickets};
