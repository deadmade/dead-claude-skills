use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde_json::json;

use rmcp::handler::server::wrapper::Parameters;

use crate::api::ApiError;
use crate::config::Config;
use crate::ctx::Ctx;
use crate::out;
use crate::pipeline::{self, LogArgs, PipelineRunArgs, ProjectArgs, RunArgs, RunsArgs};
use crate::pr::{
    self, PrCommentArgs, PrCompleteArgs, PrCreateArgs, PrFilesArgs, PrListArgs, PrReplyArgs,
    PrThreadStatusArgs, PrThreadsArgs, PrUpdateArgs, PrViewArgs, PrVoteArgs,
};
use crate::search::{self, SearchArgs};
use crate::wi::{self, WiCommentArgs, WiCreateArgs, WiQueryArgs, WiUpdateArgs, WiViewArgs};

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
Azure DevOps Server tools: pull requests (pr_*), work items (wi_*), pipeline runs (pipeline_*), repos and \
projects. Use them instead of curl or az for anything on the Azure DevOps server; they read the git remote, so they \
work inside a clone without extra arguments (pass project, and repo for the pr_* tools, to override it). Outside an \
Azure DevOps clone, pass project: project_list names them (wi_view takes the work item's own, wi_update needs none).\n\
- There is no diff tool. To read a pull request's patch, run a local `git diff` against the target branch \
(pr_files lists the changed files).\n\
- search finds work items, wiki pages and code in repos that aren't cloned; for the clone itself, search locally.\n\
- Tools that default to the current branch take a `branch` argument. In a git worktree, pass your own branch: \
the project folder's branch is not necessarily yours.\n\
- Every write tool (pr_create, pr_update, pr_comment, pr_reply, pr_thread_status, pr_vote, pr_complete, wi_create, \
wi_update, wi_comment, pipeline_run, pipeline_cancel) asks the user for approval on every call. Say what you are \
about to do, then call it once; in dontAsk mode these calls are denied.\n\
- Lists show 20 items and say how to get more (limit); repo_list and project_list show all, pr_files up to 2000 \
files, pipeline_view 20 issues (pipeline_log shows the rest). Long text is cut with the call that shows the rest.";

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

/// Every tool's answer goes out through here: server text (titles, comments, log lines) may hold terminal control,
/// and any reply is capped.
fn reply(r: Result<String, ApiError>) -> CallToolResult {
    match r {
        Ok(text) => CallToolResult::success(vec![ContentBlock::text(out::finish(&text))]),
        Err(e) => error(out::finish(&e.to_string())),
    }
}

#[tool_router]
impl Server {
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
        description = "Show a pull request's review threads with file and line (system threads and, unless all, resolved ones are left out); comments are cut at 2000 characters unless full. Without id, the active PR of the current branch.",
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

    #[tool(
        description = "Create a pull request from branch (default: the current branch) into target (default: the repo's default branch), optionally as a draft, with reviewers and linked work items."
    )]
    async fn pr_create(&self, Parameters(a): Parameters<PrCreateArgs>) -> CallToolResult {
        reply(pr::pr_create(&self.ctx, &a).await)
    }

    #[tool(
        description = "Change a pull request's title or description, or abandon or reactivate it (status). Only the given fields change. Without id, the active PR of the current branch."
    )]
    async fn pr_update(&self, Parameters(a): Parameters<PrUpdateArgs>) -> CallToolResult {
        reply(pr::pr_update(&self.ctx, &a).await)
    }

    #[tool(
        description = "Start a review thread on a pull request, optionally anchored to file and line (both or neither). Without id, the active PR of the current branch."
    )]
    async fn pr_comment(&self, Parameters(a): Parameters<PrCommentArgs>) -> CallToolResult {
        reply(Box::pin(pr::pr_comment(&self.ctx, &a)).await)
    }

    #[tool(
        description = "Reply on a pull request's review thread (the thread id from pr_threads). Without id, the active PR of the current branch."
    )]
    async fn pr_reply(&self, Parameters(a): Parameters<PrReplyArgs>) -> CallToolResult {
        reply(pr::pr_reply(&self.ctx, &a).await)
    }

    #[tool(
        description = "Set a pull request thread's status: active, fixed, wontFix, closed, byDesign or pending. Without id, the active PR of the current branch."
    )]
    async fn pr_thread_status(
        &self,
        Parameters(a): Parameters<PrThreadStatusArgs>,
    ) -> CallToolResult {
        reply(pr::pr_thread_status(&self.ctx, &a).await)
    }

    #[tool(
        description = "Vote on a pull request as the PAT's user: approve, approve-with-suggestions, wait, reject or reset. Without id, the active PR of the current branch."
    )]
    async fn pr_vote(&self, Parameters(a): Parameters<PrVoteArgs>) -> CallToolResult {
        reply(Box::pin(pr::pr_vote(&self.ctx, &a)).await)
    }

    #[tool(
        description = "Complete (merge) a pull request with a merge strategy (default squash), deleting the source branch and transitioning work items unless told not to; with auto, set auto-complete instead. Branch policies always apply. Without id, the active PR of the current branch."
    )]
    async fn pr_complete(&self, Parameters(a): Parameters<PrCompleteArgs>) -> CallToolResult {
        reply(Box::pin(pr::pr_complete(&self.ctx, &a)).await)
    }

    #[tool(
        description = "Show a work item: type, state, title, assignee, area and iteration, parent, children, linked PRs, the description and acceptance criteria as plain text, and the last 5 comments (full: the whole texts and up to 200 comments).",
        annotations(read_only_hint = true)
    )]
    async fn wi_view(&self, Parameters(a): Parameters<WiViewArgs>) -> CallToolResult {
        reply(wi::wi_view(&self.ctx, &a).await)
    }

    #[tool(
        description = "List work items, one line each (id, type, state, title, assignee), by filters (assigned `me` or a name, state, type, text in the title) or a raw WIQL query. Defaults to the project's items.",
        annotations(read_only_hint = true)
    )]
    async fn wi_query(&self, Parameters(a): Parameters<WiQueryArgs>) -> CallToolResult {
        reply(wi::wi_query(&self.ctx, &a).await)
    }

    #[tool(
        description = "Create a work item of a type (Bug, Task, User Story, …) with a title, and optionally a description (HTML), an assignee (`me` or a name) and a parent work item."
    )]
    async fn wi_create(&self, Parameters(a): Parameters<WiCreateArgs>) -> CallToolResult {
        reply(wi::wi_create(&self.ctx, &a).await)
    }

    #[tool(
        description = "Change a work item's state, assignee (`me` or a name), title, or any other field by reference name (fields: {\"Microsoft.VSTS.Common.Priority\": 1}). Only the given fields change."
    )]
    async fn wi_update(&self, Parameters(a): Parameters<WiUpdateArgs>) -> CallToolResult {
        reply(wi::wi_update(&self.ctx, &a).await)
    }

    #[tool(description = "Add a comment (HTML) to a work item.")]
    async fn wi_comment(&self, Parameters(a): Parameters<WiCommentArgs>) -> CallToolResult {
        reply(wi::wi_comment(&self.ctx, &a).await)
    }

    #[tool(
        description = "Queue a run of a pipeline (name or id) on a branch (default: the current branch), with optional template parameters."
    )]
    async fn pipeline_run(&self, Parameters(a): Parameters<PipelineRunArgs>) -> CallToolResult {
        reply(pipeline::pipeline_run(&self.ctx, &a).await)
    }

    #[tool(description = "Cancel a pipeline run (the run id from pipeline_runs).")]
    async fn pipeline_cancel(&self, Parameters(a): Parameters<RunArgs>) -> CallToolResult {
        reply(pipeline::pipeline_cancel(&self.ctx, &a).await)
    }

    #[tool(
        description = "List recent pipeline runs, newest first, one line each (id, pipeline, branch, result, date, duration). Filter by pipeline (name or id), branch, PR or result.",
        annotations(read_only_hint = true)
    )]
    async fn pipeline_runs(&self, Parameters(a): Parameters<RunsArgs>) -> CallToolResult {
        reply(pipeline::pipeline_runs(&self.ctx, &a).await)
    }

    #[tool(
        description = "Show a pipeline run's stages and jobs with result and duration, and its errors and warnings.",
        annotations(read_only_hint = true)
    )]
    async fn pipeline_view(&self, Parameters(a): Parameters<RunArgs>) -> CallToolResult {
        reply(pipeline::pipeline_view(&self.ctx, &a).await)
    }

    #[tool(
        description = "Read a pipeline run's logs, cleaned: by default each failed step's error lines with 5 lines of context and its last 50 lines, from at most its last 20,000 lines (and a failed job's issues when no step failed). step picks a step; full pages through the whole log, 2000 lines per call.",
        annotations(read_only_hint = true)
    )]
    async fn pipeline_log(&self, Parameters(a): Parameters<LogArgs>) -> CallToolResult {
        reply(pipeline::pipeline_log(&self.ctx, &a).await)
    }

    #[tool(
        description = "List the project's repos, one line each, with their default branch.",
        annotations(read_only_hint = true)
    )]
    async fn repo_list(&self, Parameters(a): Parameters<ProjectArgs>) -> CallToolResult {
        reply(pipeline::repo_list(&self.ctx, &a).await)
    }

    #[tool(
        description = "List the projects in the collection, one name per line.",
        annotations(read_only_hint = true)
    )]
    async fn project_list(&self) -> CallToolResult {
        reply(pipeline::project_list(&self.ctx).await)
    }

    #[tool(
        description = "Search the collection's work items, code or wiki with the server's own search (ranked). kind and text are required; project (and repo, for code) narrow it.",
        annotations(read_only_hint = true)
    )]
    async fn search(&self, Parameters(a): Parameters<SearchArgs>) -> CallToolResult {
        reply(search::search(&self.ctx, &a).await)
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
