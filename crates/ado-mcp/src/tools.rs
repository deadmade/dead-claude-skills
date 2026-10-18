use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde_json::{Value, json};

use crate::api::{Api, V71};
use crate::config::Config;

/// The tools that change something on the server. Claude Code prompts on every call to these.
pub(crate) const WRITES: [&str; 12] = [
    "pr_create",
    "pr_update",
    "pr_comment",
    "pr_reply",
    "pr_thread_status",
    "pr_vote",
    "pr_complete",
    "wi_create",
    "wi_update",
    "wi_comment",
    "pipeline_run",
    "pipeline_cancel",
];

const INSTRUCTIONS: &str = "\
Azure DevOps Server tools: pull requests (pr_*), work items (wi_*), pipeline runs (pipeline_*) and repos. \
Use them instead of curl or az for anything on the Azure DevOps server; they read the git remote, so they work \
inside a clone without extra arguments (pass project and repo to override it).\n\
- There is no diff tool. To read a pull request's patch, run a local `git diff` against the target branch \
(pr_files lists the changed files).\n\
- Tools that default to the current branch take a `branch` argument. In a git worktree, pass your own branch: \
the project folder's branch is not necessarily yours.\n\
- Every write tool (pr_create, pr_update, pr_comment, pr_reply, pr_thread_status, pr_vote, pr_complete, wi_create, \
wi_update, wi_comment, pipeline_run, pipeline_cancel) asks the user for approval on every call. Say what you are \
about to do, then call it once; in dontAsk mode these calls are denied.\n\
- Lists show 20 items and say how to get more (limit). Long text is cut with the call that shows the rest.";

pub struct Server {
    // Read by the tools from Task 4 on.
    #[allow(dead_code)]
    cfg: Arc<Config>,
    api: Api,
    router: ToolRouter<Self>,
}

impl Server {
    /// # Errors
    /// When the HTTP client can't be built.
    pub fn new(cfg: Arc<Config>) -> anyhow::Result<Self> {
        let api = Api::new(&cfg)?;
        let mut router = Self::tool_router();
        for name in WRITES {
            if let Some(tool) = router.map.get_mut(name) {
                // Claude Code asks the user on every call, even in auto and bypass modes.
                let meta = json!({"anthropic/requiresUserInteraction": true});
                tool.attr.meta = serde_json::from_value(meta).ok();
            }
        }
        Ok(Self { cfg, api, router })
    }
}

fn error(msg: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(msg)])
}

#[tool_router]
impl Server {
    // Temporary diagnostic; Task 11 removes it.
    #[tool(
        description = "Check that the Azure DevOps server answers and the PAT works; prints how many projects it listed.",
        annotations(read_only_hint = true)
    )]
    async fn ping(&self) -> CallToolResult {
        match self
            .api
            .get::<Value>("_apis/projects", &[("$top", "1".into())], V71)
            .await
        {
            Ok(v) => CallToolResult::success(vec![ContentBlock::text(format!(
                "projects: {}",
                v["count"]
            ))]),
            Err(e) => error(e.to_string()),
        }
    }
}

#[tool_handler(router = self.router)]
impl ServerHandler for Server {
    // By hand: `tool_handler`'s `instructions` takes only a literal.
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("ado-mcp", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}
