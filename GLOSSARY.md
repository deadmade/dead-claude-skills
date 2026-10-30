# dead-claude-skills

A personal Claude Code plugin marketplace and the installer that sets up a machine from it.

## Language

**Picks plugin**:
A vendored plugin that carries a hand-chosen subset of one upstream's skills (`tob-picks`, `mattpocock-picks`).
_Avoid_: bundle, collection

**Language plugin**:
A vendored plugin that carries all of one language ecosystem's upstream skills.
_Avoid_: language pack, LSP plugin

**Router skill**:
A generated skill in a language plugin whose body indexes library skills for one area. It is the only part Claude
Code lists.
_Avoid_: entry skill, hub

**Library skill**:
An upstream skill vendored into a language plugin's unscanned library, reached only through a router skill.
_Avoid_: sub-skill

**Bundle**:
The default plugin `dead-skills`, whose dependencies are the plugins every machine gets.
_Avoid_: default set

**Default plugin**:
The bundle, or a plugin it depends on. Every machine gets these.
_Avoid_: core plugin

**Shared plugin**:
A plugin that flows depends on and the bundle doesn't: a building block the conductors run.
_Avoid_: included plugin, building block

**Opt-in**:
A plugin the installer offers but doesn't install unless picked. Flows and some shared plugins are opt-ins too; the
plain opt-ins are the ones nothing else depends on.

**Database plugin**:
A plugin for one database engine. It can combine vendored skills with an MCP
server.
_Avoid_: DB pack, language plugin

**Release**:
One tagged `vX.Y.Z` cut of the whole repository: the installer, the marketplace and the binaries that machines get
together. Its number is the repo's, not any plugin's.
_Avoid_: version (alone), plugin release

**Plugin version**:
A plugin's own number, which moves only when that plugin changes. Vendored plugins synced from an upstream release
carry upstream's number.
_Avoid_: release version

## web-mcp

**Archive**:
Everything web-mcp has pulled into a project: pages, searches, PDFs, images and screenshots, kept in `.web/`.
_Avoid_: cache, store

**Run**:
The part of the archive written by one web-mcp server process, one folder per run.
_Avoid_: session (that word belongs to the browser)

**Session**:
One agent-browser browser, with its own tabs, cookies and history, named by the caller.
_Avoid_: tab, browser instance

**Passage**:
A piece of a page's text, a few hundred tokens long, returned word for word as one ranked search result.
_Avoid_: chunk, excerpt

**Lookup**:
One request for one record about a target, such as a domain's DNS records or a CVE, answered by sources rather than
by search.
_Avoid_: query, probe

**Source**:
An outside service web-mcp reads records from directly, such as OSV or crt.sh.
_Avoid_: provider, backend

**Engine**:
A search site whose result page web-mcp opens and reads, such as Google, Bing or Google Scholar; a search may name the
engines it uses.
_Avoid_: source, provider, backend

**Snippet**:
The short text an engine shows under one result; web-mcp ranks it alongside the passages of that search's pages.
_Avoid_: passage, summary

**Search profile**:
The browser profile web-mcp's searches run in, with cookies and settings of its own and never the user's.
_Avoid_: session (one browser), user profile

**Writing skill**:
The one standard for prose Claude writes for a person, based on Williams and Bizup's _Style_; flows' `writing` skill.
_Avoid_: style guide, unslop

**Conversation shorthand**:
A label only the session that coined it understands, such as a grill question number or a review round number.
_Avoid_: tag, reference

**Prose check**:
flows' code-only `PostToolUse` hook on each Write or Edit of a Markdown file: it flags conversation shorthand in the
new text, with no model call. `FLOWS_PROSE_CHECK=off` turns it off.
_Avoid_: linter, lint, model check

**Copyedit pass**:
A run of `/copyedit` on a spec, plan or audit report before its gate: a fresh Opus editor revises it for a reader who
wasn't in the conversation, by the `writing` skill (Williams and Bizup's _Style_), and code checks that nothing
was lost. A refused edit leaves the document as it was, and the gate says so.
_Avoid_: review, rewrite, polish
