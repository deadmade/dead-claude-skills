---
flow: feature
phase: brainstorm
---

# MCP conductor: flow

## Request

> Hey, im currently building more and more mcp clients and I kinda lack a proper skill for building them. Could we run /feature-flow for this and properly create a mcp build or a mcp review conductor?

## Artifacts

- Spec:
- Plan:
- ADRs:
- Glossary:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved:

## Skipped

## Grounding

- Adding a conductor: `plugins/flows/skills/<name>/SKILL.md` + `uses.json`, then `node scripts/flows-uses.mjs`
  (regenerates flows' `dependencies` and the README tree; `checkUses` at `scripts/flows-uses.mjs:49-92` needs every
  listed name to appear in the SKILL.md). Hand edits: `plugins/flows/README.md` table, `CLAUDE.md` conductor list, root
  `README.md` list, flows `plugin.json` and `marketplace.json:73` descriptions (both already miss `/integrate`; nothing
  checks them), flow-rules **State** / **A missing piece** if needed. No installer or test names a conductor.
- Conventions: four frontmatter keys (`name`, `description` ending "Use for /x [args].", `disable-model-invocation:
  true`, `argument-hint`), a phase table, "flow-rules.md applies", 50–110 lines typical. Build flows keep
  `docs/features/<slug>/flow.md`; audits write `docs/audits/<date>-<flow>-<scope>.md`. No conductor has build/review
  modes by argument: one would be a new pattern.
- Vendoring one more pack (e.g. an upstream MCP skill): small. `sync-security-audit.mjs` (~20 lines) and its workflow
  are the template; plus pack `plugin.json`, THIRD_PARTY.md, flow-rules pack list, READMEs; flake/treefmt already
  exclude `plugins/flows/packs/`.
- MCP already here: security-audit `AI-AND-LLM.md:51-60` (MCP trust inheritance, server/tool identity confusion,
  metadata-as-policy) plus tool classes `:34-50`; reached only through `/harden`'s security-domains pass. Not covered:
  MCP auth/OAuth, transport hardening (Origin/DNS rebinding), SSRF via resource URIs, sessions, `.mcp.json` config
  trust, spec conformance, tool-design quality. `PROTOCOLS-RPC-AND-MESSAGING.md` has no MCP/JSON-RPC.
- web-mcp (`crates/web-mcp`) uses rmcp 3.6.0 (`Cargo.toml:14`), stdio only; tools in `src/tools.rs:323-389`
  (`#[tool_router]`, `read_only_hint` annotations, `_meta` result cap at :310-320); protocol test `tests/mcp.rs` spawns
  the binary and speaks raw JSON-RPC (initialize, tools/list). `plugins/opt-in/mcp/*` are `.mcp.json` configs only.

## Prior art

Agent report, sources fetched in its run (blog posts labelled):

- **Spec drift.** Current MCP spec is 2026-07-28, breaking: no `initialize`/`Mcp-Session-Id` (`server/discover`
  instead), sampling/elicitation/roots become `InputRequiredResult` round trips, Roots/Sampling/Logging/DCR deprecated
  ([changelog](https://modelcontextprotocol.io/specification/latest/changelog)). Anthropic's skills still target
  2025-11-25 ([versions.md](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/mcp-server-dev/skills/build-mcp-server/references/versions.md));
  rmcp implements 2026-07-28 ([rust-sdk](https://github.com/modelcontextprotocol/rust-sdk)).
- **Build skills (server only):** anthropics/skills `mcp-builder` (Apache-2.0; research/plan → implement → Inspector →
  10-question eval via `scripts/evaluation.py`, needs `ANTHROPIC_API_KEY`); anthropics/claude-plugins-official
  `mcp-server-dev` (Apache-2.0; `build-mcp-server`/`build-mcp-app`/`build-mcpb`, tool-design rules: audit past 15 tools,
  search+execute past ~30, read vs write tools split, descriptions never instruct the model). Neither covers clients.
- **Review skills:** github/awesome-copilot `mcp-implementation-security-review` (MIT; server or client source, six
  steps incl. OWASP MCP Top 10, file:line evidence) and `mcp-security-audit` (MIT; configs only: secrets, shell
  injection, unpinned `npx`). jassics `mcp-security-review` is GPL-3.0: checklist source only, not vendorable.
- **Tooling:** Inspector CLI (`--method tools/list|tools/call`, `--strict`), `modelcontextprotocol/conformance`
  (`server --url`, `client --command`, auth scenarios). snyk/agent-scan sends configs to a remote API: opt-in at most.
- **Constraints:** [Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices)
  (confused deputy, no token passthrough, SSRF in OAuth discovery, local-server consent); tools spec treats annotations
  as untrusted, input errors as `isError`; stdio forbids non-MCP bytes on stdout; Streamable HTTP must validate `Origin`.
- **Pitfalls:** stdout logging, context bloat from tool definitions (~150k vs ~2k tokens with progressive discovery,
  [client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices.md)),
  tool poisoning / rug pull / cross-server shadowing and toxic agent flows (Invariant, vendor blog).
- **No skill for building MCP clients exists;** the client best-practices page and the review skills are the material.
- Approaches it saw: A vendor a build skill + thin conductor; B own build conductor; C review-only conductor; D one
  conductor with build/review modes. Its pick: D on B, borrowing mcp-builder's eval, vendoring the awesome-copilot
  review skills. Not yet weighed against this repo (no conductor has modes today).

## Options

- 2026-10-28, scope: the user builds MCP **servers**, not clients ("I build mcp servers not clients").
- 2026-10-28, user: primarily Rust and C#; wants already-published MCP skills that are usable and updated regularly;
  more interested in language-unspecific material, focused on building, running and rolling servers out.
- Upstream freshness checked (git log on the paths, 2026-10-28): `mcp-server-dev` (claude-plugins-official) 2026-03-20,
  04-17, 04-28; `mcp-builder` (anthropics/skills) last content change 2025-12-01; awesome-copilot
  `mcp-implementation-security-review` 2026-07-10, `mcp-security-audit` 2026-04-09 and 2026-10-07. dotnet/skills has
  only `troubleshoot-binlog-mcp` (not about building servers). `mcp-server-dev` sits in claude-plugins-official, which
  the marketplace already allows cross-marketplace dependencies on: it could be a flows dependency, not a vendored pack.

## Plan review

## Tasks

## Rulings

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
