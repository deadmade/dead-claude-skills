# dead-claude-skills

A personal Claude Code plugin marketplace and the installer that sets up a machine from it.

## Language

**Picks plugin**:
A vendored plugin that carries a hand-chosen subset of one upstream's skills (`tob-picks`, `mattpocock-picks`).
_Avoid_: bundle, collection

**Language plugin**:
A vendored plugin that carries all of one language ecosystem's upstream skills. These live under
`plugins/languages/`.
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

**Opt-in**:
A plugin the installer offers but doesn't install unless picked.

**Database plugin**:
A plugin for one database engine, living under `plugins/database/`. It can combine vendored skills with an MCP
server.
_Avoid_: DB pack, language plugin

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
_Avoid_: chunk, snippet, excerpt
