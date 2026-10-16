use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::schemars::{self, JsonSchema};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde::Deserialize;
use serde_json::json;

use crate::config::Config;

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub struct SearchArgs {
    pub query: String,
    pub papers: Option<bool>,
    pub max_passages: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub struct FetchArgs {
    pub url: String,
    pub images: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
#[serde(rename_all = "snake_case")]
pub enum BrowserAction {
    Open,
    Snapshot,
    Click,
    Fill,
    Type,
    Press,
    Scroll,
    Screenshot,
    Console,
    Network,
    Eval,
    Close,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
pub struct BrowserArgs {
    pub action: BrowserAction,
    pub session: String,
    pub url: Option<String>,
    pub r#ref: Option<String>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub js: Option<String>,
}

pub struct Server {
    config: Config,
    router: ToolRouter<Self>,
}

fn not_implemented() -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text("not implemented")])
}

impl Server {
    #[must_use]
    pub fn new(config: Config) -> Self {
        let mut router = Self::tool_router();
        if let Some(fetch) = router.map.get_mut("fetch") {
            // Claude Code's per-tool cap on result size; whole pages need more than the default.
            let meta = json!({"anthropic/maxResultSizeChars": 200_000});
            fetch.attr.meta = serde_json::from_value(meta).ok();
        }
        Self { config, router }
    }
}

#[tool_router]
impl Server {
    #[tool(
        description = "Search the web (self-hosted SearXNG) and the local archive.",
        annotations(read_only_hint = true)
    )]
    #[allow(clippy::unused_async)]
    async fn search(&self, _args: Parameters<SearchArgs>) -> CallToolResult {
        not_implemented()
    }

    #[tool(
        description = "Fetch a whole page as markdown, optionally with its images.",
        annotations(read_only_hint = true)
    )]
    #[allow(clippy::unused_async)]
    async fn fetch(&self, _args: Parameters<FetchArgs>) -> CallToolResult {
        not_implemented()
    }

    #[tool(description = "Drive a browser session through agent-browser.")]
    #[allow(clippy::unused_async)]
    async fn browser(&self, _args: Parameters<BrowserArgs>) -> CallToolResult {
        not_implemented()
    }
}

#[allow(clippy::unused_async_trait_impl)]
#[tool_handler(router = self.router, name = "web-mcp")]
impl ServerHandler for Server {}
