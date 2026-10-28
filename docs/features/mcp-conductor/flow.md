---
flow: feature
phase: ground
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

## Options

## Plan review

## Tasks

## Rulings

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
