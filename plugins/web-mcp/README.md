# web-mcp

A stdio MCP server (`web-mcp`, Rust) with three tools, available to Claude as `mcp__plugin_web-mcp_web__*`:

- `search`: self-hosted SearXNG and the local archive.
- `fetch`: a whole page as markdown, optionally with its images.
- `browser`: a browser session driven through `agent-browser`.

Everything is archived in `.web/` in the project before Claude sees it. `fetch` works: HTML pages come back as their
main content in markdown, PDFs as text, with up to six images on request; a URL fetched earlier in the run comes from
the archive (except localhost and private-network addresses). `search` and `browser` are still stubs that answer "not
implemented".

## Install

    /plugin install web-mcp@dead-claude-skills

It needs the `web-mcp` binary, which the installer downloads. By hand, build it with
`cargo build --release --manifest-path plugins/web-mcp/server/Cargo.toml` (or `nix build .#web-mcp`) and put it on PATH
or set its path with `/plugin configure web-mcp`.

## Configuration

Environment variables, set in `.mcp.json`: `WEB_MCP_SEARXNG_URL` (default `http://127.0.0.1:8888`) and
`WEB_MCP_AGENT_BROWSER` (default `agent-browser`).
