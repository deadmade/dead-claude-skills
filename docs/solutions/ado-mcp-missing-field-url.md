# ado-mcp: "unexpected answer from the server: missing field `url`" (wi_view comments unavailable)

- **Seen:** 2026-10-28, live Azure DevOps Server 2022.2: `wi_view id=153` showed the item, then
  `comments: unavailable (unexpected answer from the server: missing field 'url' at line 1 column 194)`; `wi_comment`
  could post and still report that error.
- **Cause:** `azure_devops_rust_api` 0.39.1's `CommentList` holds `CommentMention`s, whose `url` is required; the
  server leaves `url` out of a mention. The crate's repo is archived (2026-10-26), so no upstream fix comes.
- **Fix:** read the raw body (`.send()` + `into_raw_response().into_body()`) into our own struct with only what the
  tool shows (`RawComments` in `crates/ado-mcp/src/wi.rs`, via `api::json`); `wi_comment` doesn't decode its reply.
  Fix-flow `docs/features/ado-mcp-wi-comments-missing-url/`, deviation D7 in `docs/features/ado-mcp/flow.md`.
- **Spot it next time:** a fixture shaped to fit the crate model passes every test while the live server fails; build
  fixtures from real answers or the Server docs' samples, and give any field you don't show no chance to fail the read.
