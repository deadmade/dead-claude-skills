# Cursor -> Claude Code rewrites for the vendored pstack subset.
# Run by scripts/sync-pstack.sh as: perl -0777 -pi scripts/pstack-rewrites.pl <files>
# Rules match content, never line numbers. Anything they miss is caught by the guard in sync-pstack.sh.

my $CLAUDE_MODELS = '`fable`, `opus`, `sonnet`, `haiku`';
my $CURSOR_PANEL  = qr/`claude-fable-5-1-thinking-max`, `gpt-5\.6-sol-max`, `grok-4\.6-fast-xhigh`, `claude-opus-5-thinking-xhigh`/;

# --- subagent config blocks (how, why, interrogate) -------------------------------------------
# read-only subagents -> Explore (Claude Code's read-only agent type)
s/- `subagent_type`: `generalPurpose`\n(- `model`: [^\n]*\n)- `readonly`: `true`\n/- `subagent_type`: `Explore`\n$1/g;
# "not readonly" subagents (MCP access) -> general-purpose; the Cursor Ask-mode caveat doesn't apply
s/- `subagent_type`: `generalPurpose`\n(- `model`: [^\n]*\n)- `readonly`: `false`[^\n]*\n/- `subagent_type`: `general-purpose`\n$1/g;

# --- model panels and defaults ------------------------------------------------------------------
s/Use your configured architect runners \(defaults $CURSOR_PANEL\)\./Use one runner per model: $CLAUDE_MODELS./g;
s/Use `arena runners` from `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise default to one each on $CURSOR_PANEL\./Default to one each on $CLAUDE_MODELS./g;
s/choose one model from the `arena cross-judge pool` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use $CURSOR_PANEL\. Prefer a different model family from the parent's\./choose one model from $CLAUDE_MODELS. Prefer a different model from the parent's./g;
s/Spawn one readonly judge subagent/Spawn one read-only judge subagent (`subagent_type`: `Explore`)/g;

s/Use the `interrogate reviewers` list from `~\/\.cursor\/rules\/pstack-models\.mdc` when present, one reviewer per entry, extending or shrinking the Reviewer A\/B\/C\/D labels below to the configured entry count\. Otherwise use the table defaults\./Use the table below./g;
s/\| Reviewer A \| `claude-fable-5-1-thinking-max` \|/| Reviewer A | `fable` |/g;
s/\| Reviewer B \| `gpt-5\.6-sol-max` \|/| Reviewer B | `opus` |/g;
s/\| Reviewer C \| `grok-4\.6-fast-xhigh` \|/| Reviewer C | `sonnet` |/g;
s/\| Reviewer D \| `claude-opus-5-thinking-xhigh` \|/| Reviewer D | `haiku` |/g;
s/\| Subagent \| Default model \|/| Subagent | Model |/g;
s/- `model`: the configured `interrogate reviewers` entry, or the table default with no configured line/- `model`: the reviewer's model from the table/g;
s/If a model slug is rejected as unresolvable when you try to spawn the subagent,[^\n]*\n/Valid `model` values for the Agent tool are $CLAUDE_MODELS.\n/g;

s/your configured (how-explorer|why-investigators) model \(default `grok-4\.6-fast-xhigh`\)/`sonnet`/g;
s/your configured (how-explainer|why-synthesizer) model \(default `claude-fable-5-1-thinking-max`\)/`fable`/g;

# --- swarm: Cursor cloud workers -> local background agents -----------------------------------
s/Fan out N parallel cloud workers\./Fan out N parallel background workers./g;
s/N is total workers, not the cloud concurrency limit\./N is total workers, not a concurrency limit./g;
s/Pick the worker model from `swarm workers` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use `grok-4\.6-fast-xhigh`\./Use `sonnet` as the worker model./g;
s/Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the configured model\. Use `environment: "local"` only when the worker needs access to something on the user's computer\./Spawn all N workers in one message with the Agent tool: `subagent_type: general-purpose`, `run_in_background: true`, `isolation: "worktree"` for workers that write, and the chosen `model`./g;
s/When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\./When a worker must start from a non-default branch, tell it to check that branch out in its worktree first./g;

# --- tool names ---------------------------------------------------------------------------------
s/Open a todolist/Open a todo list (`TodoWrite`)/g;
s/\btodolist\b/todo list/g;
s/`Task`/`Agent`/g;
s/\bthe Task tool\b/the Agent tool/g;
s/\bTask (subagent|tool)\b/Agent $1/g;

# --- MCP discovery (why) ------------------------------------------------------------------------
s/list the available MCPs from the Cursor environment\. Use the available-tools map when present\. Otherwise inspect the `mcps\/` directory Cursor exposes for enabled MCP servers\./list the MCP servers available in this session. Their tools show up as `mcp__<server>__<tool>`./g;

# --- transcripts (recall, show-me-your-work) ----------------------------------------------------
s{Transcripts live at `~/\.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>\.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" \(so `/Users/you/proj` becomes `Users-you-proj`\)\.}{Transcripts live at `~/.claude/projects/<slug>/<uuid>.jsonl`, where `<slug>` is the workspace path with every "/" (and other non-alphanumeric character) turned into "-" (so `/Users/you/proj` becomes `-Users-you-proj`).}g;
s{Read this run's transcript under the active workspace's `agent-transcripts/` directory \(the system prompt names the path\)\. Don't glob across `~/\.cursor/projects/\*/`\.}{Read this run's transcript in this workspace's transcript directory, `~/.claude/projects/<slug>/` (the newest `.jsonl`). Don't glob across `~/.claude/projects/*/`.}g;

# --- Comment Sicko agent ------------------------------------------------------------------------
s/subagent_type: "Comment Sicko"/subagent_type: "pstack-picks:comment-sicko"/g;
s/^name: Comment Sicko$/name: comment-sicko/mg;

# --- sibling-skill note (SKILL.md files and the agent, right after the frontmatter) -------------
if ($ARGV =~ m{/skills/[^/]+/SKILL\.md$}) {
  s{\A(---\n.*?\n---\n)}{$1\n> **Claude Code port:** skills this file names (for example **how**, **why**, **unslop**, **arena**, or a **...** principle skill) are sibling skills in this plugin. They are user-invoked, so the Skill tool can't load them. To use one, read `\${CLAUDE_SKILL_DIR}/../<name>/SKILL.md` (principle skills: `\${CLAUDE_SKILL_DIR}/../principle-<name>/SKILL.md`) and follow it. Subagents use the Agent tool; valid `model` values are $CLAUDE_MODELS.\n}s;
} elsif ($ARGV =~ m{/agents/[^/]+\.md$}) {
  s{\A(---\n.*?\n---\n)}{$1\n> **Claude Code port:** to run the **how** or **why** skill, read its `SKILL.md` from the pstack-picks plugin (glob `~/.claude/plugins/**/pstack-picks/**/skills/<name>/SKILL.md`) and follow it. They are user-invoked, so the Skill tool can't load them.\n}s;
}
