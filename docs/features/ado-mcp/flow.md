---
phase: execute
---

# ado MCP server: flow

## Request

"Lets design this idea properly" (/feature-flow), after a chat that settled the idea: a Rust CLI `ado`, like `gh`,
for a self-hosted Azure DevOps Server, so Claude Code can do everyday dev work there without curl or a third-party
MCP server.

## Artifacts

- Spec: [spec.md](spec.md) (draft, builder check done 2026-10-18)
- Plan: [plan.md](plan.md) (2026-10-18)
- Smoke checklist: [smoke.md](smoke.md) (2026-10-18)
- ADRs:
- Glossary: [GLOSSARY.md](../../../GLOSSARY.md), section "Azure DevOps (mcp-azure)"

## Gates

- Gate 1, spec approved: 2026-10-18 ("approved"). ADR 0002 offered, not taken up.
- Gate 2, plan approved: 2026-10-18 ("approved, subagent-driven"), plan revision 2, execution: subagent-driven
- Gates 1 and 2 again for D1: 2026-10-18 ("I approve"), spec revised, plan revision 3

## Deviations

- **D1, 2026-10-18: use Microsoft's `azure_devops_rust_api` crate at runtime** (reverses the Options line "No Microsoft
  `azure_devops_rust_api` crate"). Raised by the user after Task 6: hand-written calls mean writing the API contract
  ourselves, and Microsoft no longer publishes the OpenAPI specs (MicrosoftDocs/vsts-rest-api-specs is gone). The
  user's words: "lets just use the crate for now. Dont want to reverse engineer the api".
  - Options: 1, the crate's clients and models at runtime; 2, the crate's models in tests only, calls stay ours.
    Recommended 1; the user picked **1** ("1").
  - Spike (0.39.1, against a local server, 2026-10-18):
    - `.endpoint("https://server/tfs")` with organization `Coll` gives `/tfs/Coll/My%20Proj/_apis/...`.
    - `Credential::from_pat` sends `Authorization: Basic base64(":" + pat)`.
    - `.transport()` takes our own `reqwest::Client`, so our timeouts, no-redirect policy and default headers stay.
    - azure_core 1.1 uses the same `reqwest =0.13.5` and the platform verifier, so ESET is unchanged.
    - A failed call keeps the status and the raw body, so the `TF…` message and our one-line errors still work.
    - Every call sends `api-version=7.1-preview`.
  - Costs:
    - The models are strict: one field the crate marks required and the server leaves out fails the whole call
      ("missing field `project`", seen with our trimmed fixtures). Only the smoke test on 2022.2 shows how often.
    - The crate forces azure_core's default features, so aws-lc-rs (C code) is compiled in. Release build 3 min
      instead of 1.5; a one-call spike binary is 6.8 MB against our 5.4 MB.
    - Tasks 3, 4 and 6 (done) are partly reworked.
  - Kept: the remote and collection check before any request, the PAT only to `ADO_ORG_URL`, one-line errors,
    output shaping, the write prompts, the cache, the installer and plugin work.
  - Decision: 2026-10-18, spec and plan revision 3 approved ("I approve").
- **D2, 2026-10-18: three places where the crate falls short** (found in Task 6a, confirmed against the crate's
  source in review).
  - `pr_list status=all`: `PullRequestStatus` has no `All` and the builder takes no extra query, so that one request
    is built by hand (still read into the crate's `GitPullRequestList`).
  - `pr_threads`: the crate's `PropertiesCollection` drops property names, and `CodeReviewThreadType` is how system
    threads are hidden, so the raw body is parsed for that field too.
  - Work-item titles in `pr_view`: the batch call exists only per project, so it is sent with an empty project
    (linked items can live in other projects) and the guard drops the empty segment.
  - Options: A, keep these three; B, replace `status=all` with three crate calls merged (worse ordering and paging).
    Recommended A.
  - Decision: 2026-10-18, A ("yes, keep them").
- **D3, 2026-10-18: build logs read raw** (Task 8). The crate's `get_build_log` reads the answer as a JSON string,
  but the server sends plain text, so `pipeline_log` reads the raw body of the same crate call (guard and error lines
  unchanged). Options: A, the raw read; B, none that works without patching the crate. Recommended A.
  - Decision: 2026-10-18, A ("yes, keep the raw log read").
- **D4, 2026-10-18: the pull request PATCH is hand-written** (Task 9). The crate's `GitPullRequestUpdateOptions` has
  no `isDraft` and no `lastMergeSourceCommit`, which `pr_update draft=` and `pr_complete` need. So `pr_update` and
  `pr_complete` send their PATCH through our `Api::send` at the crate's path and `7.1-preview`; the completion
  options inside it are still the crate's model (so `bypassPolicy` is never sent). Options: A, keep the hand-written
  PATCH; B, drop `draft` from `pr_update` and complete via the crate (loses `lastMergeSourceCommit`, which the server
  uses to refuse completing a PR that moved). Recommended A.
  - Decision: 2026-10-18, B ("b"). Held until the Task 9 review says whether another crate call carries both fields,
    and flagged to the user: the server may require `lastMergeSourceCommit` to complete a PR at all.
  - The review confirmed no crate call carries `isDraft` or `lastMergeSourceCommit`. Microsoft's 7.1 Update page
    lists the updatable fields (status, title, description, completionOptions, mergeOptions, autoCompleteSetBy.id,
    targetRefName), and neither is among them, so B follows the documented call. The smoke test checks a direct
    `pr_complete`; if the server demands the commit, D4 comes back to the user.
- **D5, 2026-10-18: `pipeline_cancel` is a hand-sent PATCH** (Task 10). The crate's `update_build` takes a whole
  `Build` and always serializes its required fields (definition, id, priority, project, reason), so it can't send
  just `{"status":"cancelling"}`. Options: A, a hand-sent PATCH of `{"status":"cancelling"}` through our `Api::send`
  (guard and error lines unchanged); B, GET the build through the crate and PATCH the whole object back (two calls,
  and it writes back every field it read, so a change made in between could be overwritten). Recommended A.
  - Decision: 2026-10-18, A ("a is ok").
- **D6, 2026-10-18: walkthrough gaps** (Phase 7, see Walkthrough).
  - Goal with no code: goal 4's "lists default to 20 with a more line" isn't met by `repo_list` and `pipeline_view`'s
    stage/job lines; only the 40,000-character reply cap (R11) bounds them. Options: A, give `repo_list` a `limit`
    (default 20) and a more line, and leave `pipeline_view` as is (a run's stages and jobs are few); B, leave both to
    the cap. Recommended A.
  - Code with no goal: 12 extras, all added by reviews for robustness or safety (timeouts, headers, per-section
    `unavailable`, unknown-status threads, the `git diff` hint, refusing link queries, the 20,000-line log window,
    failed jobs without a failed step, one step per `full` page, three installer messages and `--clean` keeping
    `pluginConfigs`). Recommended: keep them all.
  - Decision: pending.
- **D7, 2026-10-28: work-item comments read by hand** (fix flow `docs/features/ado-mcp-wi-comments-missing-url/`).
  The server sends a comment's `mentions` without a `url`, which the crate's `CommentList`, `Comment` and
  `CommentMention` require, so every `wi_view` with a mentioning comment showed `comments: unavailable`. `wi_view`
  reads the raw body into its own `RawComments` (only what it shows); `wi_comment` sends with `.send()` and doesn't decode
  the reply, which would otherwise fail after the comment was posted. The crate's repo is archived (2026-10-26).
  - Decision: 2026-10-28, approved in that fix flow.

## Walkthrough

At HEAD 3fa1e1f. `src/` and `tests/` are under `crates/ado-mcp/`; `mcp-azure/` is `plugins/opt-in/mcp/mcp-azure/`;
JS tests are named by their title's first words.

| Goal | Plan task | Code | Test |
| --- | --- | --- | --- |
| 1 one stdio MCP server, `--version` | 1, 11 | src/main.rs:13-25; src/tools.rs:200-220,404-411 | tests/mcp.rs::version_flag, ::initialize_has_instructions |
| 1 plugin keeps its name and userConfig keys | 13 | mcp-azure/.claude-plugin/plugin.json:2,10-29 | installer/core.test.mjs::"mcp-azure asks for its settings itself" |
| 1 built (win x64, linux musl), released, version-synced, Nix | 1, 12 | .github/workflows/build-ado-mcp.yml:19-21,43-46; release.yml:77-81,106; scripts/check-repo.mjs:76; scripts/release.mjs:46; flake.nix:111-125 | installer/core.test.mjs::"web-mcp downloads its own archive"; check-repo (npm test); build-ado-mcp.yml `--version` step |
| 1 crate `=0.39.1`, 7 features, `.endpoint()`/`.transport()` (D1) | 6a | Cargo.toml:20-21; src/api.rs:238-277 | tests/api.rs::sends_auth_version_and_suppress, ::root_hosted_collection |
| 1 hand-written: `/vsts/info`, `connectionData`, `status=all` (D2), `pipeline_cancel` (D5) | 4, 6a, 10 | src/ctx.rs:207-211,258; src/pr.rs:183-201; src/pipeline.rs:855-866 | tests/ctx.rs::resolves_from_remote, ::me_cached_and_preview; tests/pr.rs::list_filters; tests/pipeline.rs::cancel_body |
| 1 raw body where the crate falls short: threads, WI batch, log (D2, D3) | 6a, 7, 8 | src/pr.rs:347-355,501-510,574-586; src/wi.rs:308-312,367-377; src/pipeline.rs:753-770; src/api.rs:119-128,139-143 | tests/pr.rs::threads_hide_system_and_resolved, ::view_sections; tests/pipeline.rs::log_crlf_and_missing_log; src/api.rs::squeeze_cuts_double_slashes |
| 2 reads carry no mark (read-only hint), writes the `_meta` mark | 1, 9, 11 | src/tools.rs:22-35,61-67,89 | tests/mcp.rs::tools_and_marks; smoke.md step 5 |
| 2 pr_list: status (default active), creator, reviewer `me`, branches, limit | 6, 6a | src/pr.rs:154-245 | tests/pr.rs::list_one_line_each, ::list_filters, ::list_reviewer_by_name; tests/ctx.rs::user_unique_unknown_and_me |
| 2 pr_view: no id, the current branch's PR | 6 | src/pr.rs:252-289,433-445 | tests/pr.rs::view_by_branch, ::view_no_active_pr_and_unknown_id |
| 2 pr_view: head, reviewers and votes, checks, work items, latest run (merge ref, else source) | 6, 6a | src/pr.rs:132-150,291-420,449-497 | tests/pr.rs::view_sections, ::view_run_falls_back_to_source, ::view_no_run |
| 2 pr_threads: no system threads or deleted comments; active and pending unless `all` (D2) | 6, 6a | src/pr.rs:512-520,587-602,619-623 | src/pr.rs::system_threads; tests/pr.rs::threads_hide_system_and_resolved |
| 2 pr_threads: id, status, `file:line`, author, text | 6 | src/pr.rs:533-563 | tests/pr.rs::thread_location |
| 2 pr_files: latest iteration, change type | 6, 6a | src/pr.rs:644-692 | tests/pr.rs::files_follow_next_skip, ::files_stop_on_an_empty_page; smoke.md step 4 |
| 2 wi_view: type, title, state, assignee, area/iteration, parent, children, PRs | 7 | src/wi.rs:92-129,214-231 | tests/wi.rs::view_lines, ::view_unassigned_and_bare; src/wi.rs::last_ids |
| 2 wi_view: description and acceptance criteria as text, last comments | 5, 7 | src/out.rs:63-152; src/wi.rs:131-165,177-213,232-255 | tests/wi.rs::view_lines, ::view_clips_text_not_markup, ::view_comments_in_the_items_project; src/out.rs::html_to_text_keeps_lists |
| 2 wi_query: filters (`me`, state, type, title) or raw WIQL, one line each | 7 | src/wi.rs:259-289,316-395 | tests/wi.rs::query_filters_build_wiql, ::query_assigned_by_name, ::query_raw_wiql_passthrough, ::query_keeps_the_wiql_order |
| 2 pipeline_runs: by pipeline, branch, PR, result | 8 | src/pipeline.rs:129-225 | tests/pipeline.rs::runs_by_pr_uses_merge_ref; tests/ctx.rs::pipeline_by_name |
| 2 pipeline_view: stages and jobs, result, duration, issues | 8 | src/pipeline.rs:100-108,274-310,326-402 | tests/pipeline.rs::view_tree_skips_phase; src/pipeline.rs::tree_loop_does_not_fan_out, ::durations; smoke.md step 4 |
| 2 pipeline_log: failed steps cleaned, errors ±5, last 50 (D3) | 8 | src/pipeline.rs:82-84,404-476,506 | src/pipeline.rs::clean_strips_noise, ::excerpt_context_and_tail; tests/pipeline.rs::log_crlf_and_missing_log; smoke.md step 4 |
| 2 pipeline_log: `step`; `full` + `start`, 2000 lines or 39,000 chars (R8) | 8 | src/pipeline.rs:85-98,490-505,558-603,779-782 | src/pipeline.rs::page_cuts_at_lines_or_chars; tests/pipeline.rs::log_full_paged, ::log_matrix_steps_failed_first; smoke.md step 4 |
| 2 pipeline_log: whole reply in budget, steps past it named (R9) | 8 | src/pipeline.rs:605-671,728-793 | src/pipeline.rs::budget_names_what_is_left_out; tests/pipeline.rs::log_budget_names_the_rest |
| 2 repo_list | 8 | src/pipeline.rs:870-902 | tests/pipeline.rs::repo_list_lines |
| 2 project_list (fix-flow `ado-mcp-default-project-400`) | — | src/pipeline.rs:904-953 | tests/api.rs::project_list_names_every_project, ::project_list_short_pages, ::project_list_ignored_skip, ::project_list_none |
| 2 pr_create: source/target defaults, draft, reviewers, work items | 9 | src/pr.rs:808-892 | tests/pr.rs::create_defaults_and_reviewers |
| 2 pr_update: title, description, abandon/reactivate, no draft (D4) | 9 | src/pr.rs:894-941 | tests/pr.rs::update_only_given_fields |
| 2 pr_comment (`file:line`), pr_reply, pr_thread_status | 9 | src/pr.rs:943-1063 | tests/pr.rs::comment_anchor, ::comment_line_needs_file, ::reply_and_thread_status |
| 2 pr_vote: five votes | 9 | src/pr.rs:1065-1097 | tests/pr.rs::vote_values |
| 2 pr_complete: strategy, delete source, transition, auto; no bypass (D4) | 9 | src/pr.rs:1099-1142 | tests/pr.rs::complete_queued, ::complete_never_bypasses; smoke.md step 5 |
| 2 wi_create: type, title, description, assignee, parent | 10 | src/wi.rs:418-460 | tests/wi.rs::create_json_patch, ::create_needs_type_and_title |
| 2 wi_update: state, assignee, title, `fields` (R10: no project) | 10 | src/wi.rs:401-416,462-500 | tests/wi.rs::update_custom_field, ::update_refuses_bad_field_names; smoke.md step 5 |
| 2 wi_comment | 10 | src/wi.rs:502-529 | tests/wi.rs::comment_preview_version |
| 2 pipeline_run: name or id, branch, parameters | 10 | src/pipeline.rs:796-844 | tests/pipeline.rs::run_ref_and_params |
| 2 pipeline_cancel (D5) | 10 | src/pipeline.rs:846-868 | tests/pipeline.rs::cancel_body |
| 2 each write answers one line with the id | 9, 10 | src/pr.rs:891,940,997-1000,1020,1062,1096,1129-1141; src/wi.rs:459,499,528; src/pipeline.rs:838-843,867 | tests/pr.rs::create_defaults_and_reviewers, ::vote_values; tests/wi.rs::create_json_patch |
| 3 instructions: under 4096, `git diff`, `branch` | 1 | src/tools.rs:37-48,407-411 | tests/mcp.rs::initialize_has_instructions |
| 3 instructions: instead of curl, writes prompt, PR/WI/pipeline words | 1 | src/tools.rs:38-40,45-47 | none |
| 4 plain text, id first, no URLs or GUIDs, dates, display names | 6, 7, 8 | src/pr.rs:124-150,399-401; src/wi.rs:103-112,141-147; src/pipeline.rs:200-214 | tests/pr.rs::list_one_line_each; tests/wi.rs::view_lines |
| 4 lists show 20, a cut names the next call | 5–8 | src/out.rs:19-41,58-61; src/pr.rs:155,227-240; src/wi.rs:291-306,387-389; src/pipeline.rs:114-125,217-219 | tests/pr.rs::list_more_line, ::list_more_line_keeps_filters; tests/wi.rs::query_more_line; src/out.rs::cut_reports_more |
| 4 long text cut with the exact call | 5, 6, 7 | src/out.rs:8-17; src/pr.rs:488-495,550-554; src/wi.rs:131-136 | src/out.rs::clip_names_the_rest; tests/pr.rs::view_clips_description, ::threads_full_and_scoped_calls |
| 4 no colours or control; every reply capped at 40,000 at a line end (R11) | 5, final | src/out.rs:43-56,182-211; src/tools.rs:76-83 | src/out.rs::finish_strips_and_caps, ::finish_drops_a_half_cut_line; tests/pr.rs::view_strips_control_sequences, ::threads_reply_is_capped |
| 5 project folder from `ADO_PROJECT_DIR`; remote and branch via `git` (R3) | 1, 2, 13 | mcp-azure/.mcp.json:9; src/config.rs:38-41; src/remote.rs:132-150 | src/remote.rs::branch_of_temp_repo; tests/ctx.rs::resolves_from_remote |
| 5 `/vsts/info` once per remote, ids from it | 4 | src/ctx.rs:198-222 | tests/ctx.rs::resolves_from_remote, ::ctx_uses_ids_not_names |
| 5 HTTPS and SSH remotes, SSH mapped at the collection (R4) | 2 | src/remote.rs:31-116 | src/remote.rs::https_same, ::ssh_with_tfs, ::ssh_without_tfs, ::scp_style |
| 5 host and collection match before any request; other server names both (R4) | 2, 3, 6a | src/remote.rs:61-70,82-114; src/api.rs:144-146,354-362; src/ctx.rs:73-87 | src/remote.rs::other_host_refused, ::other_collection_refused, ::cannot_leave_the_collection; src/api.rs::guard_refuses_outside_org; tests/ctx.rs::other_server_sends_nothing |
| 5 redirects not followed (PAT stays on the server) | 3 | src/api.rs:235-236 | none |
| 5 `project`/`repo` override; outside an ADO clone `project` is required (R7; default project removed by fix-flow `ado-mcp-default-project-400`) | 4 | src/ctx.rs:109-134,198-229 | tests/ctx.rs::explicit_args_win, ::no_default_project_outside_clone, ::github_clone_needs_project; tests/wi.rs::view_outside_clone_uses_the_items_project |
| 5 optional `branch` where the current branch is inferred | 4, 6, 9, 10 | src/ctx.rs:130-132; src/pr.rs:31-32; src/pipeline.rs:76-77,799-813 | tests/pr.rs::view_by_branch; tests/pipeline.rs::run_ref_and_params; smoke.md step 3 |
| 6 one reqwest client per process | 3, 6a | src/api.rs:230-237,250 | none |
| 6 a tool's requests concurrent; parallel calls concurrent | 1, 6, 7 | src/pr.rs:452-456; src/wi.rs:191-201; src/main.rs:13; Cargo.toml:14 | tests/pr.rs::view_concurrent; tests/wi.rs::view_concurrent; tests/ctx.rs::concurrent_scopes_all_ok |
| 6 in-memory cache: `/vsts/info`, ids, `me`, pipeline ids | 4 | src/ctx.rs:58-71,136-148,254-261,322-358 | tests/ctx.rs::me_cached_and_preview, ::pipeline_by_name, ::concurrent_scopes_all_ok |
| 6 an id that 404s is re-resolved once | 4, 6, 7, 8 | src/ctx.rs:231-248,311-316; src/pipeline.rs:181-186,831-835 | tests/ctx.rs::stale_id_retried_once; tests/pipeline.rs::runs_404_resolves_the_name_again; tests/wi.rs::query_retries_a_stale_project |
| 6 live data never cached; no cache file, no daemon | 4 | src/ctx.rs:58-64 (all the cache holds) | none |
| 7 Basic `:PAT`, PAT from sensitive `ado_pat` via `env` | 3, 13 | src/api.rs:221-225; mcp-azure/.claude-plugin/plugin.json:17-23; mcp-azure/.mcp.json:7 | tests/api.rs::sends_auth_version_and_suppress; installer/core.test.mjs::"mcp-azure asks for its settings itself" |
| 7 PAT never printed or logged | 1, 3 | src/config.rs:6-7; src/api.rs:38-40,223 | tests/mcp.rs::errors_are_tool_errors_without_pat, ::missing_url_is_one_line; tests/api.rs::maps_401_without_secret |
| 7 https only, http to loopback (R12) | final | src/config.rs:35-37,51-63 | src/config.rs::http_only_to_loopback; tests/mcp.rs::plain_http_url_is_refused |
| 7 TLS: rustls, platform verifier, aws-lc-rs; untrusted-certificate line (R5) | 3, 6a | Cargo.toml:18-21; src/api.rs:447-473 | src/api.rs::certificate_errors_are_found_through_io_errors; smoke.md step 2 |
| 7 401 (and HTML 203), 403 names the scope (R6), 404 names what | 3 | src/api.rs:34,69-76,483-495,524-533 | tests/api.rs::maps_401_without_secret, ::html_203_is_one_line, ::maps_403_scope; src/api.rs::tf_code_and_404_label |
| 7 409/412: names the existing PR | 3, 9 | src/api.rs:497-516,535-543; src/pr.rs:869-887 | tests/pr.rs::create_conflict_names_pr; tests/api.rs::refused_line_carries_the_message |
| 7 429: `Retry-After` once; no retry policy, no resend | 3, 6a | src/api.rs:186-200,260-261,284-314,402-414 | tests/api.rs::retry_after_once, ::second_429_gives_up, ::no_resend_on_dropped_connection; tests/pr.rs::write_sent_once_on_404 |
| 7 unreadable answer names the field | 3, 6a | src/api.rs:64-67,105-107 | tests/api.rs::missing_field_names_it; smoke.md step 4 |
| 7 other failures on one line: 5xx, unreachable, not JSON, config | 1, 3 | src/api.rs:431-453,475-481,534; src/config.rs:22-34 | tests/api.rs::server_error_line, ::unreachable_names_the_host, ::not_json_is_one_line |
| 8 7.1: crate `7.1-preview`; `connectionData` `-preview.1`; hand-sent `7.1-preview`; `/vsts/info` none | 4, 6a, 10 | Cargo.toml:20; src/api.rs:28-31; src/ctx.rs:209,258; src/pr.rs:201; src/pipeline.rs:861 | tests/api.rs::sends_auth_version_and_suppress; tests/ctx.rs::me_cached_and_preview; tests/pipeline.rs::cancel_body |
| 8 `ado_api_version` removed; a stale value ignored | 13 | mcp-azure/.claude-plugin/plugin.json:10-36; src/config.rs:20-48 | installer/core.test.mjs::"mcp-azure asks for its settings itself" |
| 8 option comes back if the server needs 7.0 | 15 | smoke.md:30 | smoke.md step 2 |
| 9 `binPath` (default `ado-mcp`), `.mcp.json` runs it as `ado` | 13 | mcp-azure/.claude-plugin/plugin.json:30-35; mcp-azure/.mcp.json:3-4 | installer/core.test.mjs::"web-mcp downloads its own archive"; smoke.md step 1 |
| 9 README (tools, 4 scopes, setup), descriptions; THIRD_PARTY, CLAUDE.md, README | 13, 14 | mcp-azure/README.md:12-73; .claude-plugin/marketplace.json:56; CLAUDE.md:22,61-75; README.md:12 | none |
| 9 `BIN_PLUGINS` mcp-azure → ado-mcp, crate folder by binary | 13 | installer/core.mjs:351-355; installer/install.mjs:367-377 | installer/core.test.mjs::"web-mcp downloads its own archive" |
| 9 asks URL and hidden PAT (default project removed by fix-flow `ado-mcp-default-project-400`); Enter keeps a saved value | 13 | installer/core.mjs:357-384; installer/install.mjs:703-730; installer/ui.mjs:107-137 | installer/core.test.mjs::"configValues trims answers"; installer/ui.test.mjs::"secret returns the typed text", ::"line stops at the first Enter" |
| 9 installs, downloads, one `configure --values-stdin` with `binPath`; PAT on stdin only | 13 | installer/install.mjs:366-406,731-741,760; installer/core.mjs:407-408 | installer/core.test.mjs::"configureArgs reads the values from stdin" |
| 9 empty PAT or Claude Code < 2.1.285: handoff, no API-version line (R2) | 13 | installer/core.mjs:386-405; installer/install.mjs:472-476,698-731,795-799 | installer/core.test.mjs::"selfConfigure prompts", ::"configure needs Claude Code 2.1.285", ::"afterPrompts hands off" |
| 9 mcp-github keeps the handoff | 13 | installer/core.mjs:358; installer/install.mjs:468-471 | installer/core.test.mjs::"mcp-azure asks for its settings itself" |
| 10 unit tests: thread filter, log cleaning, cuts, HTML, remotes, error mapping | 2, 3, 5, 6, 8 | src/pr.rs:1165; src/pipeline.rs:909-1009; src/out.rs:232-316; src/remote.rs:156-296; src/api.rs:606-700 | are the tests (e.g. src/remote.rs::decodes_spaces_once) |
| 10 fake server replaying fixtures that fit the crate's models | 1, 3, 6a | tests/common/mod.rs:93-205; tests/fixtures.rs:70 | tests/fixtures.rs::fixtures_fit_models |
| 10 `cargo test` and clippy in CI on Linux and Windows | 1 | .github/workflows/ado-mcp.yml:19,35-39 | is the check |
| 11 smoke: TLS through ESET, `vsts/info` on the remote | 15 | smoke.md:24-57 | smoke.md steps 2, 3 |
| 11 smoke: each read, one of each write on scratch items | 15 | smoke.md:59-122 | smoke.md steps 4, 5 |
| 11 smoke: minimal PAT; outputs pasted back, never JSON | 15 | smoke.md:6-7,124-129 | smoke.md step 6 |

Goals with no code:

- 4: `repo_list` and `pipeline_view`'s stage and job lines have no 20-item default or more line; only the R11 cap
  of 40,000 characters bounds them.

Code with no goal:

- Request timeouts, 10 s to connect and 60 s per request, with the `ADO_TIMEOUT_MS` debug hook
  (`src/api.rs:33,174-184,233-234`; plan review S9).
- `User-Agent: ado-mcp/<version>` and `X-TFS-FedAuthRedirect: Suppress` on every request
  (`src/api.rs:36,148,226-231`).
- `pr_view` and `wi_view` print a failed section as `unavailable (…)` instead of failing
  (`src/pr.rs:472-487`, `src/wi.rs:247-255`; Task 6 review).
- `pr_threads` also shows threads of unknown status by default (`src/pr.rs:600`).
- `pr_files` prints a `git diff target...source` line, only for shell-safe ref names (`src/pr.rs:631-638,693-706`).
- `wi_query` refuses link queries (`src/wi.rs:342-348`).
- `pipeline_log` by default reads at most a step's last 20,000 lines (`src/pipeline.rs:87-88,526-544,746-766`; final
  security review).
- `pipeline_log` reports a failed job with no failed step, with its issues (`src/pipeline.rs:506-522`).
- `pipeline_log full=true` with several failed steps shows the first and names the others
  (`src/pipeline.rs:673-693,713-717`).
- Installer: an installed mcp-azure left without a required value keeps the others and gets a "not set" summary line
  (`installer/core.mjs:393-399`); R2 covers only a new install.
- Installer: the mcp-azure handoff note says to run the installer again (`installer/install.mjs:475`).
- Installer: `--clean` keeps our plugins' `pluginConfigs`, every `binPath` included (`installer/core.mjs:237-240`;
  Task 13 review).

## Skipped

## Grounding

Written for the CLI design. With the MCP-only choice, read `crates/ado` as `crates/ado-mcp` and
`plugins/opt-in/ado` as the existing `plugins/opt-in/mcp/mcp-azure`.

Shipping a third binary follows web-mcp's path:

- **Crate.** `crates/ado` with its own `Cargo.lock` (there is no workspace).
  - `[package]` matches web-mcp: `version` equal to package.json, edition 2024, `rust-version = "1.97"`, MIT,
    `publish = false`.
  - Lints and release profile as web-mcp: clippy pedantic (`crates/web-mcp/Cargo.toml:48-49`) and the release
    profile (`:51-54`).
  - `--version` must print `<name> <version>`: `installer/install.mjs:316-321` parses it, and CI smoke-tests it.
- **TLS can be reused.** web-mcp builds reqwest `=0.13.5` with `rustls-no-provider` and installs ring by hand
  (`crates/web-mcp/src/main.rs:43`, client in `src/fetch.rs:98-108`). Its lock file pulls in
  `rustls-platform-verifier` (`Cargo.lock:3057`), which uses the OS trust store, so ESET's root should verify on
  Windows. Inferred from the lock file, not tested.
- **CI and release.**
  - Copy `build-web-mcp.yml` and `web-mcp.yml`.
  - `release.yml`: add an `ado:` job (`:74-75`), add it to `publish.needs` (`:78`), and add a notes line
    (`:101-102`).
- **Installer.**
  - `installer/core.mjs`: an `ado` entry in `BIN_PLUGINS` (`:347-350`) and on the `tools` category page (`:418`).
  - `installer/install.mjs`: an `ado@` constant with its `applyBin` call (`:312`, `:703`), and the hardcoded crate
    folder fixed at `:370`.
  - `installer/core.test.mjs`: the opt-ins list (`:63-91`) and the `BIN_PLUGINS` folders (`:381-392`).
- **Version sync.** A `CRATES` entry in `scripts/check-repo.mjs` (`:73-76`), a `scripts/release.mjs` entry
  (`:43-46`), and a `marketplace.json` entry. `scripts/plugin-dirs.mjs` picks up `plugins/opt-in/ado` by itself.
- **Nix.** One `buildRustPackage` block in `flake.nix`, like `:98-109`.
- **Docs.** README "tools" sentence (`:13-16`) and the plugin's own README. CLAUDE.md: "the two Rust crates" (`:22`),
  the layout list, the release and CI lists, and the per-crate check commands.
- **Open: how Claude finds the binary.**
  - `applyBin` (`install.mjs:359-386`) puts a downloaded binary in `~/.claude/bin`, which is not on PATH, and sets
    the plugin's `binPath`.
  - The existing plugins read that setting from code: web-mcp from `.mcp.json` (`${user_config.binPath}`),
    tui-review from mod options. A CLI that Claude calls through Bash has neither.
  - No plugin ships a `bin/` folder. The only Bash pre-approval precedent is skill `allowed-tools`
    (`Bash(cargo:*)` in rust-skills).
- **Claude Code facts** (from the code.claude.com docs, read 2026-10-18):
  - A plugin's `bin/` folder is on the Bash tool's PATH (plugins/components, "Executables"). A binary in
    `~/.claude/bin` is outside the plugin, so that doesn't help.
  - `${user_config.KEY}` is substituted in MCP server config and in skill bodies (manifest-reference, "Reference a
    saved value").
  - Plugins can't ship permission allow rules: plugin `settings.json` keeps only `agent` and `subagentStatusLine`
    (plugins/components, "Default settings").
  - Skill `allowed-tools` lasts one turn (skills, "Pre-approve tools for a skill").
  - Bash rules match the literal command text, so `Bash(ado …)` doesn't match `C:\…\ado.exe …`
    (permissions, "What a Bash rule doesn't match").
  - Native Windows has no Bash sandbox (sandboxing, intro). MCP servers run outside the sandbox anyway.
- **Open: Bash sandbox.** `core.mjs:38` turns on `autoAllowBashIfSandboxed` when the sandbox toggle is on. Sandboxed
  Bash may block the work server's host unless it is added to `sandbox.network`.

## Prior art

Report from the prior-art agent, 2026-10-18; every source was fetched in that run.

- **`az devops` refuses Azure DevOps Server outright.** Since extension 1.0.6, `resolve_instance_project_and_repo`
  raises "doesn't support Azure DevOps Server"
  ([services.py](https://raw.githubusercontent.com/Azure/azure-devops-cli-extension/master/azure-devops/azext_devops/dev/common/services.py),
  [#1172](https://github.com/Azure/azure-devops-cli-extension/issues/1172)).
  - Worth copying: it resolves a git remote with `GET {remoteUrl}/vsts/info` (header
    `X-TFS-FedAuthRedirect: Suppress`). The answer gives the server URL, project id and repo id, which settles where
    the collection ends in URLs like `/tfs/Coll/…`.
  - It caches that answer per remote.
- **gh, glab, tea.**
  - Remote parsing: scp-style `host:path` becomes `ssh://`; with several remotes, `upstream` beats `origin`.
  - Tokens go to the OS keyring, with environment variables overriding.
  - Output when stdout isn't a terminal: tables without headers
    ([go-gh table.go](https://raw.githubusercontent.com/cli/go-gh/trunk/pkg/tableprinter/table.go)).
- **azdocli (Rust, community).** Works on-prem, PAT encrypted with DPAPI on Windows. No remote inference, and its
  output uses emoji. Not a base to fork.
- **REST facts at 7.1, from the Server docs.**
  - **Threads.**
    - `commentType` is `text|codeChange|system`.
    - System threads carry a `CodeReviewThreadType` property (`VoteUpdate`, `ReviewersUpdate`, `RefUpdate`,
      `MergeAttempt`).
    - Thread status is `active|fixed|wontFix|closed|byDesign|pending`.
  - **PR update.**
    - `mergeStrategy` is `noFastForward|squash|rebase|rebaseMerge`.
    - A description holds at most 4000 characters.
    - Votes are 10, 5, 0, -5 or -10, set by PUT on the reviewer.
  - **Policy evaluations.** They need `7.1-preview.1`, and their `artifactId` is
    `vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}`, not the PR's own artifactId.
  - **Work items.**
    - Updates are JSON Patch (`application/json-patch+json`), with `test /rev` for optimistic locking.
    - A batch get takes at most 200 ids, and WIQL is a POST.
    - Comments need `7.1-preview.4` and page with a `continuationToken`.
  - **Builds.**
    - Failures are found in the timeline: records with `result=failed`, their `issues[]` and `log.id`.
    - Logs take `startLine`/`endLine`.
    - The continuation token comes back in the `X-MS-ContinuationToken` header (per the official Python SDK).
  - **Runs.** POST `_apis/pipelines/{id}/runs`.
- **Pitfalls.**
  - PAT authentication fails on Server if IIS Basic Authentication is turned on.
  - Project names with spaces break tools that percent-encode only part of the path. Decode the remote once, then
    use the ids from `/vsts/info`.
  - The documented PAT write scopes look incomplete; test them against a real minimal PAT.
  - On Windows, rustls-platform-verifier checks revocation.
- **azdocli, read in full on 2026-10-18** (clone of `christianhelle/azdocli` main, MIT, © 2025 Christian Helle).
  It has about 17k lines of Rust, and 32 of its source files are built on `azure_devops_rust_api` (with
  `.endpoint(...)` set to the on-prem URL, `src/auth/factory.rs:95`) plus tokio. Its logic is typed against that
  crate's models, so it doesn't compile without the crate. Two parts are worth reading as references:
  - `src/pr/comments.rs:141-183`: system-thread detection (every comment of type system or unknown), the
    deleted-thread filter, and `file:line` from `threadContext.rightFileStart`/`leftFileStart`.
  - `src/auth/url.rs`: splitting a collection URL into base and collection.
  Its `migrate/` folder, half the code base, is irrelevant here.
- **Approaches.**
  - **Hand-rolled REST over reqwest** (gh, glab, tea): fits.
  - **Generated SDK:** async, Services-first, more lookups.
  - **Wrapping `az`:** blocked on Server.
  - **Forking azdocli:** wrong output style.

## Options

Settled in the chat before this flow started (the user's words in quotes):

- Language: Rust ("can we build it in rust?"), shipped like tui-review and web-mcp.
- ~~No Microsoft `azure_devops_rust_api` crate~~ (reversed by D1): "a lot of hell to use a crate that focuses on cloud primarily". Hand-written
  calls to "just the important endpoints for dev work, similar to what the gh cli provides".
- Server: Azure DevOps Server 2022.2 (AzureDevopsServer_20240806.7), self-hosted. Auth: PAT ("I can create a key").
- Pipelines: YAML only; classic Releases out.
- Output tuned for AI agents, "not unnecessary crap": proposal (one line per item, system threads dropped, logs
  trimmed to the failed step, truncation with the command for more, `--json` escape hatch) answered "lgtm".
- Fast, and safe when Claude runs several in parallel: proposal (concurrent requests per command, one connection,
  small ID cache with atomic writes, no daemon) given; the user's next answer moved on.
- Read and write, "like gh".
- Windows first ("windows primarly"): PAT in Windows Credential Manager, file on Linux, `ADO_PAT` override (proposal).
- The user tests against the real server at work once a build exists.
- **Interface: B, an MCP server only** ("B pls, goal is for claude I can use the ui"), picked 2026-10-18.
  - Rejected: A, a CLI only, which would need a binary path, Bash permission rules and Windows shell quoting.
  - Rejected: C, a CLI and MCP from one binary.
  - With B, the PAT is a `sensitive` userConfig value, which Claude Code keeps in the platform's secure credential
    store (manifest-reference, "Where values are stored"). So the server needs no credential code of its own, and
    the earlier `ado auth login` and Credential Manager proposal is dropped.
- **Our server replaces the npm one inside `mcp-azure`** ("yes, replace mcp-azure with ours", 2026-10-18;
  recommended so the existing settings carry over).
  - The plugin keeps its name and its userConfig keys (`ado_org_url`, `ado_pat`, `ado_default_project`,
    `ado_api_version`), and gains `binPath`.
  - `@tiberriver256/mcp-server-azure-devops` leaves the repo and THIRD_PARTY.md.
  - Rejected: a new plugin alongside mcp-azure.
- **Permissions** (builder check, 2026-10-18):
  - Options offered: A, allow the reads on first use; B, the installer writes allow rules. Recommended A.
  - The user asked whether Claude can always ask. Answer: yes, through the server-side
    `anthropic/requiresUserInteraction` mark.
  - Picked: "writes only". Write tools carry the mark; reads are allowed on first use (A).
- **Linux CA**: "no wsl at work", so there is no CA setting.
- **Grill round 1** (2026-10-18), all recommendations accepted:
  - Q1: API 7.1 fixed, option removed
  - Q2: optional `branch` arg for worktrees
  - Q4: no bypass-policy
  - Q5: `wi_update` takes any field
  - Q6: server instructions
  - Q7: only outputs are pasted back, not raw JSON
  - Q8: log limits
  - Q9: one server
- **Grill Q3 → Q10:** the user asked whether the installer can install mcp-azure too. Yes, with
  `claude plugin configure --values-stdin`, the PAT over stdin. Accepted.
- **Grill Q11, integration tests.**
  - Options offered: A, the fake server only; B, A plus a live suite the user runs; C, B plus CI against dev.azure.com.
  - Recommended B. The user picked **A**.
  - There is no official Azure DevOps Server container (sources in the chat: Microsoft Learn, Docker agents and the
    unattended install).
- **Reusing azdocli** (the user asked, 2026-10-18): it is only a reference. Its code sits on the SDK the user ruled
  out, so nothing copies over as is. A function ported close to verbatim keeps its MIT notice and gets a
  THIRD_PARTY.md line _(my call)_.
- TLS: the work browser shows the server's certificate as issued by ESET, i.e. ESET's HTTPS scanning re-signs traffic
  with a root it installed in the Windows store. So `ado` must trust the OS certificate store, not a bundled root list.

### Plan review round 1 (2026-10-18)

Three reviewers ran: correctness, fit and simpler. All findings traced to a source; none were dropped. Two unknowns
were checked against the real CLI (Claude Code 2.1.302, in a throwaway `CLAUDE_CONFIG_DIR`):

- `claude plugin install` with closed stdin installs a plugin whose required and sensitive options are unset. It
  exits 0 with "3 userConfig options not yet set".
- `configure --values-stdin` merges: sending `{binPath}` after `{url, pat}` leaves all three configured.
- `configure --json` lists the `configured` option names, so "Enter keeps" can be shown per option.

Blocking:

- B1: pipeline_view must walk Stage → Phase → Job → Task.
- B2: the concurrency test asserts dedup the spec doesn't ask for.
- B3: existing mcp-azure installs never get the binary or a configure step.

Should-fix:

- S1: the PAT could go to the remote's host before the host check.
- S2: a different collection on the same host is not caught.
- S3: paging (`$top=limit+1`; pr_files `nextSkip`).
- S4: the fake server must log request bodies.
- S5: one merged configure through `applyBin`.
- S6: `connectionData` is preview-only.
- S7: `pr_complete` is asynchronous.
- S8: TF401179 has no PR id.
- S9: no timeouts.
- S10: installer UI, decisions, `secret()` and PAT hygiene.
- S11: SSH mapping by the collection segment.
- S12: binary-only like web-mcp.
- S13: task order.

Consider: 14 small items (listed in the chat).

Decisions (2026-10-18, "yes, accept all"): every recommendation accepted, including the pr_view merge-ref spec amendment (Gate 1 reopened for that line and approved with it). Plan revised to revision 2; its shape changed only by merging the plugin into the installer task and dropping the library, both from the review itself, so no second round.
