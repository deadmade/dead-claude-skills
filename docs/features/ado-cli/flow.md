---
phase: ground
---

# ado CLI: flow

## Request

"Lets design this idea properly" (/feature-flow), after a chat that settled the idea: a Rust CLI `ado`, like `gh`,
for a self-hosted Azure DevOps Server, so Claude Code can do everyday dev work there without curl or a third-party
MCP server.

## Artifacts

- Spec:
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved:

## Skipped

## Grounding

## Prior art

## Options

Settled in the chat before this flow started (the user's words in quotes):

- Language: Rust ("can we build it in rust?"), shipped like tui-review and web-mcp.
- No Microsoft `azure_devops_rust_api` crate: "a lot of hell to use a crate that focuses on cloud primarily". Hand-written
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
- TLS: the work browser shows the server's certificate as issued by ESET, i.e. ESET's HTTPS scanning re-signs traffic
  with a root it installed in the Windows store. So `ado` must trust the OS certificate store, not a bundled root list.
