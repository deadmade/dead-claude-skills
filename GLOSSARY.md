# dead-claude-skills

A personal Claude Code plugin marketplace and the installer that sets up a machine from it. Terms below are the ones
whose everyday meaning differs from what they mean here.

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

**Run**:
One execution of a pipeline, with a result. The REST API calls it a build.
_Avoid_: build, job (a job is one part of a run)

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
An mcp-azure tool that changes something on the server; Claude Code asks the user before every call, whatever the
permission mode.
_Avoid_: action, mutation
