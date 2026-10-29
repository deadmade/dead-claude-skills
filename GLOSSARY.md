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

**Lookup**:
One request for one record about a target, such as a domain's DNS records or a CVE, answered by sources rather than
by search.
_Avoid_: query, probe

**Source**:
An outside service web-mcp reads records from directly, such as OSV or crt.sh.
_Avoid_: provider, backend

**Engine**:
One of SearXNG's search sites, such as `github` or `bing`; a filtered search names the engines it uses.
_Avoid_: source

## Azure DevOps (mcp-azure)

**Collection**:
The top level of an Azure DevOps Server instance, holding projects; it is the first path segment after the server
(`https://server/tfs/DefaultCollection`). The cloud service calls the same level an organization.
_Avoid_: organization, org (for the self-hosted server)

**Pull request iteration**:
One push to a pull request's source branch, as the server numbers them; "the PR's files" means the files changed as
of the latest iteration.
_Avoid_: revision, update

**Thread**:
A conversation on a pull request: one or more comments with a status (active, fixed, won't fix, closed, by design,
pending), optionally anchored to a file and line.
_Avoid_: comment (for the whole conversation), discussion

**System thread**:
A thread the server writes itself to record an event, such as a vote, a reviewer change or a push; never shown to
Claude.
_Avoid_: activity, event comment

**Pipeline**:
A YAML pipeline definition in a project. Classic release pipelines are not meant.
_Avoid_: build definition, release

**Run** (pipeline):
One execution of a pipeline, with a result. The REST API calls it a build. web-mcp's Run is a different thing.
_Avoid_: build, job (a job is one part of a run)

**Test run**:
One set of test results a pipeline run published: one per job and attempt, and one per result file unless the
publishing task merges them; a run can publish several.
_Avoid_: run (alone), test pass

**Hit**:
One search result: a file, a work item or a wiki page. A place inside a file that matched is a match.
_Avoid_: result, match (for the whole hit)

**Step**:
One task inside a run's job, with its own result and log.
_Avoid_: task, timeline record

**Work item**:
A tracked unit of work of some type (bug, user story, task, …) in a project's process.
_Avoid_: issue, ticket

**Read tool**:
An mcp-azure tool that never changes anything on the server; the user may allow it once for good.
_Avoid_: query tool

**Write tool**:
An mcp-azure tool that changes something on the server; Claude Code asks the user before every call, in every
permission mode but `dontAsk`, which denies it.
_Avoid_: action, mutation
