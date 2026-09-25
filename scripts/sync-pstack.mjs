// Vendor a curated subset of Cursor's pstack (cursor/plugins/pstack) into plugins/pstack-picks/,
// rewrite its Cursor-specific instructions for Claude Code (REWRITES below), and refuse
// to publish if any Cursor-ism survives. Idempotent: same upstream commit, same output.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, description, fail, finish, git, reportNew, sparseClone, tempDir } from "./sync-lib.mjs";

const UPSTREAM_URL = "https://github.com/cursor/plugins.git";
const SKILLS = [
  "how", "why", "recall", "bro", "interrogate", "blast-radius", "no-comments", "unslop", "technical-writing", "architect",
  "arena", "swarm",
  "show-me-your-work",
  "principle-separate-before-serializing-shared-state",
  "principle-redesign-from-first-principles",
  "principle-prove-it-works",
  "principle-fix-root-causes",
  "principle-type-system-discipline",
  "principle-boundary-discipline",
  "principle-model-the-domain",
  "principle-make-operations-idempotent",
];
const AGENTS = ["comment-sicko"];
// Upstream skills deliberately not vendored. Anything in neither list is reported as new.
const SKIPPED = [
  "automate-me", "create-verification-skill", "figure-it-out", "maintain-verification-skill", "make-bot-ui", "poteto-mode",
  "reflect", "setup-pstack", "tdd", "teach", "typescript-best-practices",
  "principle-attack-the-premise", "principle-build-the-lever", "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space", "principle-experience-first", "principle-foundational-thinking",
  "principle-guard-the-context-window", "principle-laziness-protocol", "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load", "principle-never-block-on-the-human", "principle-outcome-oriented-execution",
  "principle-sequence-verifiable-units", "principle-subtract-before-you-add", "principle-test-behavior-not-implementation",
];
// Cursor-isms that must not survive the rewrite, checked per line (case-sensitive; "cursor location" in prose is fine).
const GUARD =
  /\.cursor|Cursor|\bTask\b|AskQuestion|generalPurpose|[Rr]eadonly|environment: "|cloud_base_branch|agent-transcripts|mcps\/|todolist|grok-|gpt-5|sol-max|-thinking-|pstack-models|subagent_type: "Comment Sicko"|^name: Comment Sicko/;

// --- Cursor -> Claude Code rewrites -------------------------------------------------------------
// Applied in order to each whole .md file. Rules match content, never line numbers. Anything they miss is caught by GUARD.
const CLAUDE_MODELS = "`fable`, `opus`, `sonnet`, `haiku`";
const CURSOR_PANEL = String.raw`\`claude-fable-5-1-thinking-max\`, \`gpt-5\.6-sol-max\`, \`grok-4\.6-fast-xhigh\`, \`claude-opus-5-thinking-xhigh\``;
const re = (src, flags = "g") => new RegExp(src, flags);
const REWRITES = [
  // --- subagent config blocks (how, why, interrogate) ---
  // read-only subagents -> Explore (Claude Code's read-only agent type)
  [/- `subagent_type`: `generalPurpose`\n(- `model`: [^\n]*\n)- `readonly`: `true`\n/g, "- `subagent_type`: `Explore`\n$1"],
  // "not readonly" subagents (MCP access) -> general-purpose; the Cursor Ask-mode caveat doesn't apply
  [/- `subagent_type`: `generalPurpose`\n(- `model`: [^\n]*\n)- `readonly`: `false`[^\n]*\n/g, "- `subagent_type`: `general-purpose`\n$1"],

  // --- model panels and defaults (upstream reads `pstack-models.mdc` role lines; slugs matched loosely, they churn) ---
  [/Each spawn below names a role line in the `pstack-models\.mdc` rule and a default\.[^\n]*\n\n/g, ""],
  [/the `(how explorer|why investigators)` line, default `[^`]+`/g, "`sonnet`"],
  [/the `(how explainer|why synthesizer)` line, default `[^`]+`/g, "`fable`"],
  [/Take the runners from the `architect runners` line[^\n]*/g, `Use one runner per model: ${CLAUDE_MODELS}.`],
  [/Use the `arena runners` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\..*?from its error message\./g, `Default to one each on ${CLAUDE_MODELS}.`],
  [/choose one model from the `arena cross-judge pool` line[^\n]*?Prefer a different model family from the parent's\./g,
    `choose one model from ${CLAUDE_MODELS}. Prefer a different model from the parent's.`],
  [/Spawn one readonly judge subagent/g, "Spawn one read-only judge subagent (`subagent_type`: `Explore`)"],

  [/Use the `interrogate reviewers` line in `~\/\.cursor\/rules\/pstack-models\.mdc`[^\n]*/g, "Use the table below."],
  [/\| Reviewer A \| `[^`]+` \|/g, "| Reviewer A | `fable` |"],
  [/\| Reviewer B \| `[^`]+` \|/g, "| Reviewer B | `opus` |"],
  [/\| Reviewer C \| `[^`]+` \|/g, "| Reviewer C | `sonnet` |"],
  [/\| Reviewer D \| `[^`]+` \|/g, "| Reviewer D | `haiku` |"],
  [/\| Subagent \| Default model \|/g, "| Subagent | Model |"],
  [/- `model`: the configured `interrogate reviewers` entry[^\n]*/g, "- `model`: the reviewer's model from the table"],
  [/If the Task tool rejects a configured entry, run that reviewer[^\n]*\n/g, `Valid \`model\` values for the Agent tool are ${CLAUDE_MODELS}.\n`],

  // --- swarm: Cursor cloud workers -> local background agents ---
  [/Fan out N parallel cloud workers\./g, "Fan out N parallel background workers."],
  [/N is total workers, not the cloud concurrency limit\./g, "N is total workers, not a concurrency limit."],
  [/Pick the worker model from the `swarm workers` line[^\n]*?from its error message\./g, "Use `sonnet` as the worker model."],
  [/Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`[^\n]*/g,
    'Spawn all N workers in one message with the Agent tool: `subagent_type: general-purpose`, `run_in_background: true`, `isolation: "worktree"` for workers that write, and the chosen `model`.'],
  [/When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\./g,
    "When a worker must start from a non-default branch, tell it to check that branch out in its worktree first."],

  // --- tool names ---
  [/Open a todolist/g, "Open a todo list (`TodoWrite`)"],
  [/\btodolist\b/g, "todo list"],
  [/`Task`/g, "`Agent`"],
  [/\bthe Task tool\b/g, "the Agent tool"],
  [/\bTask (subagent|tool)\b/g, "Agent $1"],

  // --- MCP discovery (why) ---
  [/list the available MCPs from the Cursor environment\. Use the available-tools map when present\. Otherwise inspect the `mcps\/` directory Cursor exposes for enabled MCP servers\./g,
    "list the MCP servers available in this session. Their tools show up as `mcp__<server>__<tool>`."],

  // --- transcripts (recall, show-me-your-work) ---
  [/Transcripts live at `~\/\.cursor\/projects\/<slug>\/agent-transcripts\/<uuid>\/<uuid>\.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "\/" turned into "-" \(so `\/Users\/you\/proj` becomes `Users-you-proj`\)\./g,
    'Transcripts live at `~/.claude/projects/<slug>/<uuid>.jsonl`, where `<slug>` is the workspace path with every "/" (and other non-alphanumeric character) turned into "-" (so `/Users/you/proj` becomes `-Users-you-proj`).'],
  [/Read this run's transcript under the active workspace's `agent-transcripts\/` directory \(the system prompt names the path\)\. Don't glob across `~\/\.cursor\/projects\/\*\/`\./g,
    "Read this run's transcript in this workspace's transcript directory, `~/.claude/projects/<slug>/` (the newest `.jsonl`). Don't glob across `~/.claude/projects/*/`."],

  // --- Comment Sicko agent ---
  [/subagent_type: "Comment Sicko"/g, 'subagent_type: "pstack-picks:comment-sicko"'],
  [/^name: Comment Sicko$/gm, "name: comment-sicko"],
];
// Sibling-skill note, inserted right after the frontmatter of each SKILL.md and each agent.
const SKILL_NOTE = `\n> **Claude Code port:** skills this file names (for example **how**, **why**, **unslop**, **arena**, or a **...** principle skill) are sibling skills in this plugin. They are user-invoked, so the Skill tool can't load them. To use one, read \`\${CLAUDE_SKILL_DIR}/../<name>/SKILL.md\` (principle skills: \`\${CLAUDE_SKILL_DIR}/../principle-<name>/SKILL.md\`) and follow it. Subagents use the Agent tool; valid \`model\` values are ${CLAUDE_MODELS}.\n`;
const AGENT_NOTE = "\n> **Claude Code port:** to run the **how** or **why** skill, read its `SKILL.md` from the pstack-picks plugin (glob `~/.claude/plugins/**/pstack-picks/**/skills/<name>/SKILL.md`) and follow it. They are user-invoked, so the Skill tool can't load them.\n";

function rewrite(file, text) {
  for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement);
  const note = /\/skills\/[^/]+\/SKILL\.md$/.test(file) ? SKILL_NOTE : /\/agents\/[^/]+\.md$/.test(file) ? AGENT_NOTE : "";
  // Function replacement: the note contains `${`, which must not be read as a replacement pattern.
  if (note) text = text.replace(/^(---\n.*?\n---\n)/s, (fm) => fm + note);
  return text;
}

const files = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => join(dir, f).replaceAll("\\", "/"))
    .filter((f) => statSync(f).isFile());

const PLUGIN = join(ROOT, "plugins", "pstack-picks");

const up = sparseClone(
  UPSTREAM_URL,
  ["/pstack/LICENSE", ...SKILLS.map((s) => `/pstack/skills/${s}/`), ...AGENTS.map((a) => `/pstack/agents/${a}.md`)],
  { noCone: true },
);
const UP = join(up, "pstack");

for (const s of SKILLS) {
  if (!existsSync(join(UP, "skills", s, "SKILL.md"))) fail(`upstream pstack/skills/${s}/SKILL.md not found (renamed or removed?)`);
}
for (const a of AGENTS) {
  if (!existsSync(join(UP, "agents", `${a}.md`))) fail(`upstream pstack/agents/${a}.md not found`);
}

// New upstream skills: every directory under pstack/skills that is neither vendored nor skipped.
const known = new Set([...SKILLS, ...SKIPPED]);
const NEW = git("-C", up, "ls-tree", "-d", "--name-only", "HEAD", "pstack/skills/")
  .split("\n")
  .filter(Boolean)
  .map((d) => d.split("/").pop())
  .filter((s) => !known.has(s));
if (NEW.length) {
  for (const s of NEW) git("-C", up, "sparse-checkout", "add", `/pstack/skills/${s}/`);
  reportNew(NEW.map((s) => [s, description(join(UP, "skills", s, "SKILL.md"))]));
}

// Build into a staging dir, rewrite, guard, then swap in.
const STAGE = join(tempDir(), "stage");
mkdirSync(join(STAGE, "agents"), { recursive: true });
for (const s of SKILLS) cpSync(join(UP, "skills", s), join(STAGE, "skills", s), { recursive: true });
for (const a of AGENTS) cpSync(join(UP, "agents", `${a}.md`), join(STAGE, "agents", `${a}.md`));
cpSync(join(UP, "LICENSE"), join(STAGE, "LICENSE"));

const staged = [...files(join(STAGE, "skills")), ...files(join(STAGE, "agents"))];
for (const f of staged.filter((f) => f.endsWith(".md"))) writeFileSync(f, rewrite(f, readFileSync(f, "utf8")));

const leftovers = staged.flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .flatMap((line, i) => (GUARD.test(line) ? [`${f.slice(STAGE.length + 1)}:${i + 1}:${line}`] : [])),
);
if (leftovers.length) fail(`Cursor-specific text survived the rewrite; add a rule to REWRITES in scripts/sync-pstack.mjs:\n${leftovers.join("\n")}`);

for (const p of ["skills", "agents", "LICENSE", "UPSTREAM"]) rmSync(join(PLUGIN, p), { recursive: true, force: true });
for (const p of ["skills", "agents", "LICENSE"]) cpSync(join(STAGE, p), join(PLUGIN, p), { recursive: true });

finish("pstack-picks", git("-C", up, "rev-parse", "HEAD"), join(PLUGIN, "UPSTREAM"), PLUGIN);
