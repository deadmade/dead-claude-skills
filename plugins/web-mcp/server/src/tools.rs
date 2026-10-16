use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::schemars::{self, JsonSchema};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde::Deserialize;
use serde_json::json;

use std::sync::Arc;
use std::time::Duration;

use url::Url;

use crate::Ctx;
use crate::fetch::{self, GetOpts};

const FETCH_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
#[allow(dead_code)] // read once search is implemented (Task 8)
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
#[allow(dead_code)] // read once browser is implemented (Task 10)
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
    ctx: Arc<Ctx>,
    router: ToolRouter<Self>,
}

fn error(msg: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(msg)])
}

fn not_implemented() -> CallToolResult {
    error("not implemented")
}

impl Server {
    #[must_use]
    pub fn new(ctx: Arc<Ctx>) -> Self {
        let mut router = Self::tool_router();
        if let Some(fetch) = router.map.get_mut("fetch") {
            // Claude Code's per-tool cap on result size; whole pages need more than the default.
            let meta = json!({"anthropic/maxResultSizeChars": 200_000});
            fetch.attr.meta = serde_json::from_value(meta).ok();
        }
        Self { ctx, router }
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
    async fn fetch(&self, Parameters(args): Parameters<FetchArgs>) -> CallToolResult {
        let url = match Url::parse(&args.url) {
            Ok(u) if matches!(u.scheme(), "http" | "https") => u,
            _ => return error(format!("{} is not an http(s) URL", args.url)),
        };
        let images = args.images.unwrap_or(false);
        let opts = GetOpts {
            images,
            ..GetOpts::default()
        };
        match fetch::get(&self.ctx, &url, FETCH_DEADLINE, opts).await {
            Ok(f) => fetch::render(&self.ctx, &f, images).await,
            Err(e) => error(format!("Fetching {url} failed: {e}")),
        }
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
