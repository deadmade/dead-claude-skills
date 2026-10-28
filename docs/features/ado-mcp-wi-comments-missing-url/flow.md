---
flow: fix
phase: done
---

# ado-mcp: wi_view comments fail on a missing url: flow

## Request

"wi_view ⚠️ The item itself shows correctly, but comments always fail with unavailable (… missing field 'url' …)."

## Artifacts

- Reproduction: below, under Findings.

## Gates

- Cause and fix, 2026-10-28: approved, option "own struct, both tools": `wi_view` reads the comments' raw body into
  our own struct (only what it shows); `wi_comment` sends with `.send()` and doesn't decode the reply.

**Task 1 Files:** `crates/ado-mcp/src/wi.rs`, `crates/ado-mcp/tests/{wi,fixtures}.rs`,
`crates/ado-mcp/tests/fixtures/wi-comments.json`, `docs/features/ado-mcp/flow.md`, `CLAUDE.md`, this flow.md.

## Skipped

## Findings

**Reproduction (2026-10-28, live server, project My4SELLERS):** `wi_view id=153` and `id=149` show the item, then
`comments: unavailable (unexpected answer from the server: missing field `url` at line 1 column 194)`; `id=72` fails
the same way at column 10920. The item itself (a separate call) is fine.

**Where:** `crates/ado-mcp/src/wi.rs` `wi_view` reads comments with the crate's `comments_client().get_comments()`,
decoded into `wit::models::CommentList`. In `azure_devops_rust_api` 0.39.1, `CommentList`, `Comment`,
`CommentMention` and `CommentReaction` all flatten `WorkItemTrackingResource` → `WorkItemTrackingResourceReference`,
whose `url: String` is required (`wit/models.rs:3550`). Our fixture `wi-comments.json` has a `url` everywhere and no
`mentions`, so the tests never saw the server's real shape.

**Cause (evidence):** the server sends each comment's `mentions` entries without a `url`; serde fails the whole list.
A probe (temporary test, deleted) decoding bodies into `CommentList`:
- a mention `{"artifactId":"<guid>","artifactType":"Person","commentId":1234,"targetId":"<guid>"}` without `url`
  as a comment's first field → `missing field url at line 1 column 195` (194 with a 3-digit `commentId`: the live error);
- a comment without `url` → fails at the comment's end (column 87 for a bare one), which can't be column 194 for a
  real comment carrying a `createdBy` identity; the list without `url` → fails at the body's end.
Two different items failing at the same column 194 fits the fixed-length GUID mention. Item 72's 10920 fits a long
first comment followed by one with a mention.

**Blast radius:** `wi_view` (comments only; the item is a separate call and degrades as designed). `wi_comment`
decodes the crate's `Comment` from `add_comment`'s answer: a comment that mentions someone would be posted and then
reported as an error (a retry posts it twice). No other tool uses the comment models.

**Upstream:** `microsoft/azure-devops-rust-api` was archived on 2026-10-26 (read-only), so no fix is coming; we pin
`=0.39.1`. The established workaround here is reading the raw body into our own struct (`wi_query`'s `Batch`, D2).

## Tasks

- Task 1: base e8542cbf1b74552dfdd8cd0f156db37fec6ae9a9, untracked at start: `docs/features/ado-mcp-default-project-400/flow.md`,
  this flow.md; the tree already carried the default-project flow's uncommitted edits (CLAUDE.md, `src/{api,config,ctx,pipeline,tools}.rs`,
  `tests/{api,ctx,mcp}.rs`, docs, installer, mcp-azure). Changed by this task: `src/wi.rs`, `tests/{wi,fixtures}.rs`,
  `tests/fixtures/wi-comments.json`, `docs/features/ado-mcp/flow.md`, CLAUDE.md. Files clean.
  - RED: with url-less mentions in `wi-comments.json` and `wi_comment`'s reply, `view_lines`, `view_full_reads_200_comments`,
    `view_comments_in_the_items_project` failed with `comments: unavailable (… missing field url at line 12 column 9)`,
    `comment_preview_version` with `missing field url at line 1 column 91`; `fixtures_fit_models` with
    `wi-comments.json: missing field url`.
  - GREEN: `cargo test --test wi` 23 passed; full suite green apart from `pr::view_concurrent` (see Rulings); clippy clean.

## Rulings

- 2026-10-28, Task 1: `pr::view_concurrent` fails under the full parallel `cargo test` (wall clock > 800 ms) and passes 3/3 alone; left as is — it times `pr_view`, which this fix doesn't touch — if wrong, a real `pr_view` concurrency regression hides behind load.
- 2026-10-28, Task 1: `Notes` keeps `createdDate` as a string and shows what precedes the `T` — the server sends UTC RFC 3339, as the old `OffsetDateTime::date()` showed — a non-UTC offset would show the server's local date.
- 2026-10-28, Task 1: only `src/wi.rs`, `tests/wi.rs` and `tests/fixtures.rs` are rustfmt'ed; `cargo fmt --check` also flags `tests/ctx.rs`, the default-project flow's uncommitted edit — not this fix's file.

## Deviations

## Verify

One `/verify` over both ado-mcp fix flows (`ado-mcp-default-project-400`, `ado-mcp-wi-comments-missing-url`), run
from feature-flow `ado-mcp-next` before its build, 2026-10-28; base e8542cb, uncommitted tree.

- **Checks** (latest run, e8542cb + tree): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` clean;
  `cargo test` 177 passed; check-repo passed; `npm test` 141 passed, 1 failed (`installer/files.test.mjs` clean slate:
  Windows `EPERM` creating a symlink, untouched code).
- **Review** (`/self-review`, 9 passes): security and the bug pass found nothing. 14 findings plus noted items, all
  fixed on the user's "fix all pls":
  - `project_list` pages until a page adds nothing, `$skip` follows what came back, says when it stops at 10,000.
  - `RawComments` (was `Notes`) requires `comments`, reads `null` as none.
  - `wi_view` outside an Azure DevOps clone reads the item's own project.
  - `api::json` serves the three raw reads; stricter comment date (`day`); both `view_concurrent` tests measure
    against a baseline call.
  - Docs: old spec and flow rows, README, CLAUDE.md, server instructions.
- **Docs** (`/doc-audit branch`, [report](../../audits/2026-10-28-doc-audit-branch.md)): 11 findings, all fixed
  ("all"); one code fix (`wi_view` treats `project: ""` as none).
- **Decisions** (gate, 2026-10-28): all confirmed. Read: skipped by the user. Commit: one commit for both fixes
  and the verify fixes (the user's pick).
- **Not checked:** whether `claude plugin configure --values-stdin` merges or replaces stored keys (decides whether
  URL and PAT survive an upgrade that sends only `binPath`); no live-server run of the changes.

## Learned

2026-10-28, picked "1-4":
- `docs/solutions/ado-mcp-missing-field-url.md`: the missing-`url` root cause and how to spot it.
- CLAUDE.md, Checks: concurrency tests bound the slow call against a fast first call; the Windows `EPERM` symlink
  failure in `installer/files.test.mjs` is the machine.
- Memory: the user's collection has Search with Code, Work items and Wiki.

## Run verdict
