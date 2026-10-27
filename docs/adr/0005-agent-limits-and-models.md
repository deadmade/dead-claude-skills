# flows caps its agents per phase and names a model for each

Under ultracode a `/research-flow` could start 60 to 250 agents, and almost none of them named a model, so they ran on
the session's model. The user wanted "a bit of limitations", not bans, and stronger models for review only "if it
makes sense, not always". flow-rules' **Agents** section now gives each phase a cap, batches per-item work into at
most 4 agents, asks the user before going past a cap, and names a model (and in a Workflow an effort) for every agent
by its role. The installer sets `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=8` unless the user set it.

## Considered options

- **Settings only.** Rejected as not enough: `workflowSizeGuideline` is advice Claude Code sends to the model, and a
  prompt asking for more scale overrides it. Concurrency (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`) is the only
  limit Claude Code enforces, and nothing caps a run's total below 1,000 agents. A plugin can't ship either: its
  `settings.json` honours only `agent` and `subagentStatusLine`.
- **`CLAUDE_CODE_SUBAGENT_MODEL`, with or without `_FORCE`.** Rejected: one model for every agent in every session,
  flows or not. `_FORCE` also throws away every per-role choice.
- **Banning Workflows in flow phases.** Rejected by the user ("dont want to ban shit straight out"). A Workflow may run
  one phase, within its cap, with a model on every `agent()`.
- **A hook that refuses spawns past a count.** Deferred: it needs Claude Code's `agent.spawn` mod hook to see
  workflow agents, which isn't checked yet.

## Probes

Run on Claude Code 2.1.311 with a throwaway project, the session on `opus`, reading the model from each agent's
transcript:

| Probe                                                                  | Result                                 |
| ---------------------------------------------------------------------- | -------------------------------------- |
| Workflow `agent()` with no model                                       | session model (`opus`)                 |
| `agent()` with `model: 'sonnet'`                                       | `sonnet`                               |
| `agent()` with `agentType` of an agent whose frontmatter says `haiku`  | `haiku`                                |
| the same with `model: 'sonnet'` too                                    | `sonnet`: the call wins                |
| `agent()` with `model: 'haiku', effort: 'low'`                         | `haiku`, accepted                      |
| tools of a workflow agent, and of a `general-purpose` Agent-tool agent | neither has the Agent or Workflow tool |

## Consequences

- **Most of it is advice.** Caps, batching and models are rules Claude follows, like the gates. The concurrency
  variable is the only enforced part, and Claude Code before 2.1.269 ignores it.
- **Naming a model is the rule that matters most.** A model on the call wins over `model: inherit` in flows' vendored
  agents, so the rules work without changing their frontmatter.
- **Counts can drift.** Pack syncs can add fan-out; the `overrides` markers catch the sentences quoted today, not
  new ones.
