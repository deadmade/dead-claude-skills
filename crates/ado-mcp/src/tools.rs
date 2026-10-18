use std::fmt::Write as _;
use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde_json::json;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

use crate::api::ApiError;
use crate::config::Config;
use crate::ctx::{Ctx, seg};
use crate::pr::{self, PrFilesArgs, PrListArgs, PrThreadsArgs, PrViewArgs};

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
    ctx: Arc<Ctx>,
    router: ToolRouter<Self>,
}

impl Server {
    /// # Errors
    /// When the HTTP client can't be built.
    pub fn new(cfg: Config) -> anyhow::Result<Self> {
        let ctx = Arc::new(Ctx::new(cfg)?);
        let mut router = Self::tool_router();
        for name in WRITES {
            if let Some(tool) = router.map.get_mut(name) {
                // Claude Code asks the user on every call, even in auto and bypass modes.
                let meta = json!({"anthropic/requiresUserInteraction": true});
                tool.attr.meta = serde_json::from_value(meta).ok();
            }
        }
        Ok(Self { ctx, router })
    }
}

fn error(msg: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(msg)])
}

fn reply(r: Result<String, ApiError>) -> CallToolResult {
    match r {
        Ok(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
        Err(e) => error(e.to_string()),
    }
}

// Temporary, for the context tests; Task 11 removes it.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "schemars")]
struct ScopeEchoArgs {
    project: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    /// A user to look up (`me` or a name); prints only that user.
    user: Option<String>,
    /// A pipeline name or id to resolve in the scope.
    pipeline: Option<String>,
    /// Also ask the server for the repo by its id, retrying once if that id is stale.
    check: Option<bool>,
}

#[tool_router]
impl Server {
    // Temporary diagnostic; Task 11 removes it.
    #[tool(
        description = "Check that the Azure DevOps server answers and the PAT works; prints how many projects it listed.",
        annotations(read_only_hint = true)
    )]
    async fn ping(&self) -> CallToolResult {
        let api = &self.ctx.api;
        match api
            .az(|| {
                api.core
                    .projects_client()
                    .list(&api.org)
                    .top(1)
                    .into_future()
            })
            .await
        {
            Ok(v) => CallToolResult::success(vec![ContentBlock::text(format!(
                "projects: {}",
                v.count.unwrap_or_default()
            ))]),
            Err(e) => error(e.to_string()),
        }
    }

    // Temporary, for the context tests; Task 11 removes it.
    #[tool(
        description = "Print the resolved project, repo and branch (and a user or pipeline).",
        annotations(read_only_hint = true)
    )]
    async fn scope_echo(&self, Parameters(a): Parameters<ScopeEchoArgs>) -> CallToolResult {
        match self.echo(a).await {
            Ok(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
            Err(e) => error(e.to_string()),
        }
    }

    #[tool(
        description = "List pull requests, one line each (id, status, branches, title, author, approvals). Defaults to the active ones in this repo.",
        annotations(read_only_hint = true)
    )]
    async fn pr_list(&self, Parameters(a): Parameters<PrListArgs>) -> CallToolResult {
        reply(pr::pr_list(&self.ctx, &a).await)
    }

    #[tool(
        description = "Show a pull request: reviewers and votes, policy checks, linked work items, latest pipeline run and the description. Without id, the active PR of the current branch.",
        annotations(read_only_hint = true)
    )]
    async fn pr_view(&self, Parameters(a): Parameters<PrViewArgs>) -> CallToolResult {
        reply(pr::pr_view(&self.ctx, &a).await)
    }

    #[tool(
        description = "Show a pull request's review threads with file and line (system threads and, unless all, resolved ones are left out). Without id, the active PR of the current branch.",
        annotations(read_only_hint = true)
    )]
    async fn pr_threads(&self, Parameters(a): Parameters<PrThreadsArgs>) -> CallToolResult {
        reply(pr::pr_threads(&self.ctx, &a).await)
    }

    #[tool(
        description = "List the files a pull request changes (latest iteration) and the git diff command that shows the patch. Without id, the active PR of the current branch.",
        annotations(read_only_hint = true)
    )]
    async fn pr_files(&self, Parameters(a): Parameters<PrFilesArgs>) -> CallToolResult {
        // The PR model is large; boxed, the tool's future stays small.
        reply(Box::pin(pr::pr_files(&self.ctx, &a)).await)
    }
}

impl Server {
    #[allow(clippy::many_single_char_names)] // temporary
    async fn echo(&self, a: ScopeEchoArgs) -> Result<String, crate::api::ApiError> {
        let ctx = &self.ctx;
        if let Some(u) = &a.user {
            let m = ctx.user(u).await?;
            return Ok(format!("user: {} {}", m.id, m.name));
        }
        let (p, r, b) = (a.project.as_deref(), a.repo.as_deref(), a.branch.as_deref());
        let first = ctx.scope(p, r, b).await?;
        let s = if a.check == Some(true) {
            ctx.retry_stale(&first.key, || async {
                let s = ctx.scope(p, r, b).await?;
                if let Some(id) = &s.repo_id {
                    let api = &ctx.api;
                    api.az(|| {
                        api.git
                            .repositories_client()
                            .get_repository(&api.org, seg(id), seg(&s.project_id))
                            .into_future()
                    })
                    .await?;
                }
                Ok(s)
            })
            .await?
        } else {
            first
        };
        let dash = |o: &Option<String>| o.clone().unwrap_or_else(|| "-".into());
        let repo = match &s.repo_id {
            Some(id) => format!("{id} {}", dash(&s.repo)),
            None => "-".into(),
        };
        let mut out = format!(
            "project: {} {}\nrepo: {repo}\nbranch: {}",
            s.project_id,
            s.project,
            dash(&s.branch)
        );
        if let Some(n) = &a.pipeline {
            let _ = write!(out, "\npipeline: {}", ctx.pipeline_id(&s, n).await?);
        }
        Ok(out)
    }
}

// The macro generates async fns without .await; the lint is new in clippy 1.99.
#[allow(unknown_lints, clippy::unused_async_trait_impl)]
#[tool_handler(router = self.router)]
impl ServerHandler for Server {
    // By hand: `tool_handler`'s `instructions` takes only a literal.
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("ado-mcp", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}
