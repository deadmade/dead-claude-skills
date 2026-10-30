# Plan: agent limits and per-role models for the flows

## Decisions and status (2026-10-27)

- **Superseded in the end:** the user cut the rule to one short paragraph in flow-rules **Agents** (few agents,
  combined where it makes sense, a model that fits each job). The caps, tables and markers below were not kept; the
  installer default and the ADR were.

- The user's model is no ceiling; stronger models go to review only where the change calls for it.
- The numbers below stand. Workflows may run a phase; limits, not bans.
- test-audit gets no new gate. Its Requirements probe checks up to 10 requirements itself instead, because an agent
  can't start tob's workflow.
- The installer writes only the concurrency default, with no toggle.
- superpowers' "most capable" tier, the final whole-branch review included, runs on `fable`; verifiers stay on `opus`.
- Everything lives in flow-rules **Agents**; the conductors, their references and the flow.md templates stay as
  they are (the user: "I only want it in the flow rules"). Step 4's per-conductor edits are dropped: the section's
  caps and model table win over a conductor's own counts.
- Slice 1 is done: flow-rules **Agents**, the installer default, docs, and the probes in
  `docs/adr/0005-agent-limits-and-models.md`. Still open: the end-to-end measurement (step 7) and slices 2 and 3.

## Goal

When a flow runs, especially `/research-flow` under ultracode, it should not grow to 60–250 agents. Each agent should run on a model chosen for its role, not silently on the model the user selected. Nothing vendored is edited by hand. Every rule says whether the harness enforces it or it is advice. The user can override any of it.

## What exists today

**No limits anywhere.**

- Nothing in `plugins/flows/skills`, `references` or `agents` mentions a budget, concurrency or `effort`.
- `installer/core/settings.ts:117` writes exactly one env var, `CLAUDE_CODE_TMUX_TRUECOLOR`.
- `installer/core/settings.test.ts:185-187` asserts the env with `deepEqual`, so any new env key breaks that test.

**One shared home for flow rules.**

- `plugins/flows/references/flow-rules.md` has these sections: State (l.10), Running a flow (l.24), Homes and commits (l.94), Loading skills (l.106), and so on.
- The only Workflow call is at l.123-125: `args: {path, spec, limit}`. No conductor says which `limit` to pass.

**Fan-outs with no ceiling. All quotes below are verified.**

- `pstack-picks/skills/why/SKILL.md:31` "Default to the full parallel investigation." and `:49` "Spawn one investigator per category that has a matching MCP, …"
- `arena/SKILL.md:19` "Spawn more runners when the arena covers multiple design directions."
- `blast-radius/SKILL.md:40` "For a big or wide change, run it as an `arena`."
- `mattpocock-picks/skills/grilling/SKILL.md:28` "…dispatch a sub-agent to find it"
- `codebase-design/DESIGN-IT-TWICE.md:21` "Spawn 3+ sub-agents in parallel."
- `recall/SKILL.md:21` "Spawn parallel subagents on a fast, cheap model, …"
- `tob-picks/skills/spec-to-code-compliance/SKILL.md:32` is the heading "Do not check requirements in this context". test-audit's Requirements probe follows it with no gate in front.
- `self-review/references/upstream/code-review.md:22` spawns one Haiku scorer per issue. That file is vendored but lives outside `packs/`, so no marker can point at it today.
- `doc-audit/SKILL.md:41-45` runs one checker per claim.
- `harden/SKILL.md:30,34` runs one hunter per domain file and one verifier per candidate.

**Contradiction in plan review.** `feature-flow/references/plan-review.md:9-11` says both "Spawn 2–3" and "every angle below still runs". research-flow adds a fourth angle, Evidence, with no model (`research-flow/SKILL.md:92-98`).

**tob workflow size.** `tob-picks/workflows/spec-compliance.js:310-314` sets `DEFAULT_LIMIT = 10` and `MAX_LIMIT = 30`. With a budget, the limit becomes `floor(remaining/70k)`. That is about 3 + docs + limit + 2 × divergences agents, so up to roughly 93 + docs. The script sets no model.

**Models.**

- Explicit names come from our own `scripts/sync-pstack.mjs:79-117` (the `CLAUDE_MODELS` constant), from `plan-review.md` (fable/opus/sonnet) and from upstream code-review (Haiku/Sonnet).
- Superpowers uses only tiers: SDD `SKILL.md:139-176` says "Always specify the model explicitly … An omitted model inherits your session's model".
- Model not set, so the session model applies: `prior-art.md:8`, `literature.md:8`, grilling fact agents, Explore fallbacks, the Evidence reviewer, self-review's spec/standards, security and CLAUDE.md agents, harden, test-audit probes, and every agent in spec-compliance.js.
- Vendored flows agents: `plugins/flows/agents/{comment,pr-test,silent-failure,type-design}-analyzer.md:4` say `model: inherit`. `code-simplifier.md:4` says `model: opus`. `spec-compliance-checker.md` has no model line.

**Typical size today.** A `/research-flow` runs about 60–100 agents; the worst case is over 250. Most come from self-review's scorers, the SDD loop, doc-audit and test-audit through the tob Workflow, and plan-review re-reviews.

**What Claude Code documents** (workflows.md, sub-agents.md, env-vars.md, plugins/components.md):

- Workflow runs: 16 concurrent agents by default. `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1–256, v2.1.269+) changes that. There is a backstop of 1,000 agents per run.
- No setting caps the total below 1,000.
- `workflowSizeGuideline` (small <5, medium <10 is the default, large <50) is advice only, and a settings-file value shadows `/config`.
- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (Agent tool, default 20) is not enforced under ultracode and does not govern workflow agents.
- Ultracode cannot be turned off on its own; only `disableWorkflows` removes it, together with workflows.
- Model resolution order: the per-call `model`, then frontmatter (`inherit` means the session model), then `CLAUDE_CODE_SUBAGENT_MODEL`, then the session model. `_FORCE=1` overrides all of them.
- A Workflow script's model counts as the per-call model. `agent()` also takes `opts.effort` (the Workflow tool's own authoring reference lists it; the docs page doesn't).
- The Agent tool takes no per-call effort. Frontmatter `effort:` works for plugin agents.
- A plugin's `settings.json` honours only `agent` and `subagentStatusLine`, so env vars have to come from the installer.

## Design

### 1. Where each piece lives

| Piece                                                | Lives in                                                                                                          | Enforced or advice                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Workflow concurrency cap                             | installer env default `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=8`, written with `??=` so a hand-set value wins | **Enforced** by the harness, for Workflow runs only, v2.1.269+                                   |
| tob workflow size                                    | `flow-rules.md` always passes `limit` (default 10); optionally a sync-tob REWRITES entry lowers `MAX_LIMIT` to 12 | Passing `limit` is advice to the main agent. The `MAX_LIMIT` rewrite is **enforced**             |
| Per-phase caps, batching, no nesting, ask past a cap | new `flow-rules.md` section "Agents: how many and on which model"                                                 | Advice. Ultracode may override it                                                                |
| Model per role                                       | the same section, a role → model table; every spawn names `model`                                                 | Advice: Claude must pass it. Once passed, it outranks `inherit` frontmatter (**enforced** order) |
| Models on flows' own agents                          | frontmatter stamped by `sync-self-review.mjs` / `sync-tob.mjs` (slice 2)                                          | **Enforced**, unless a per-call model or `_FORCE` overrides it                                   |
| Per-prompt spawn ceiling and model clamp             | optional mod guard in `plugins/default/hooks/` (slice 3, only if the probe passes)                                | **Enforced**, if the probe passes                                                                |

The installer never writes `CLAUDE_CODE_SUBAGENT_MODEL`, `_FORCE`, `ultracode`, `disableWorkflows` or `workflowSizeGuideline`:

- `_FORCE` would erase every per-role choice.
- A global `SUBAGENT_MODEL` would change sessions that have nothing to do with flows.
- `workflowSizeGuideline` stays the user's own knob; flows reads it as "use the smaller of this and our phase cap".

### 2. Shared fan-out rules (in flow-rules.md)

1. **Batch per-item work.** Claims, issues, candidates, facts, papers, requirements, MCP categories and domain files go to `min(items, cap)` agents, each taking a list. Items past the cap are ranked and listed under **Deferred** in flow.md, never dropped silently. This is tob's clamp pattern.
2. **Small stays inline.** Keep the self-review small-diff rule and how's "take the simple path".
3. **No nesting.** Spawned agents run any sub-skill inline and spawn no agents of their own. In particular, the plan-review Fit reviewer runs blast-radius inline and never as an arena.
4. **Per message.** At most 8 agents in one message; the rest go in waves.
5. **Ask before going over.** Before a phase would exceed its cap, or push the run past its ask point, the conductor uses AskUserQuestion with the count, the models and a recommendation.
6. **Ledger.** flow.md gets one line per phase under a new "Agents" heading, for example `Phase 5: 4 (fable 1, opus 1, sonnet 2)`. It is a self-report, not enforcement.
7. **Precedence.** These caps win over any count in a conductor or pack text. A user's ruling, recorded under Rulings or in `agents:` frontmatter in flow.md, wins over these caps, so a resumed flow keeps it.

### 3. Budget per conductor and phase

| Conductor / phase                      | Today (typical / worst)        | Cap (agents)                                                                                       | At once                  | Notes                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FF/RF Phase 1 Ground                   | 7 / 15+                        | 8 (FF 7)                                                                                           | 6                        | how: 1 explainer, or ≤3 explorers + 1 explainer; why: ≤3 investigators (categories grouped) + 1 synthesizer, only when an existing concern moves; prior-art 1; literature 1 (RF), never one per paper |
| Brainstorm builder check               | 1                              | 1                                                                                                  | 1                        |                                                                                                                                                                                                       |
| Grill fact agents                      | 2–6 / no cap                   | 1 per round, ≤3 total                                                                              | 1                        | look the fact up inline first                                                                                                                                                                         |
| Plan review                            | 4 (+5 arena, +4 per re-review) | one per angle: FF 3, RF 4                                                                          | 4                        | a re-review reruns only the angles the change touched; arena/architect only on the user's yes (+5)                                                                                                    |
| Execute (SDD)                          | 20–30 / 98                     | the pack's own loop (≤12 per task), serial                                                         | 1                        | batching.md for small same-shape tasks; never pipeline tasks                                                                                                                                          |
| /verify → /self-review                 | 18–30                          | 14                                                                                                 | 8 (two waves)            | 1 haiku setup (list + summary), 5 sonnet bug reviewers, ≤3 batched haiku scorers, 2 spec/standards, 1 security, 1 CLAUDE.md, ≤4 specialists; small diff: 0                                            |
| /doc-audit                             | 3–10 / 93                      | ≤4 checkers (claims batched)                                                                       | 4                        | tob Workflow only on yes, `limit` 10 (about 15–35 agents)                                                                                                                                             |
| /test-audit                            | 4 + Workflow 15–93             | 4 probes + ≤4 checkers                                                                             | 4                        | Requirements Workflow only on yes, with its cost stated (new gate)                                                                                                                                    |
| /harden                                | 11 hunters + 1 per candidate   | ≤4 hunters (domain files batched) + ≤4 verifiers (≤5 candidates each, never a candidate it hunted) | 6                        | more on yes; claude-security keeps its own Workflow and effort                                                                                                                                        |
| /implement, /fix-flow, /upgrade Ground | —                              | ≤4                                                                                                 | 4                        |                                                                                                                                                                                                       |
| /learn standalone (recall)             | no cap                         | ≤3 haiku slices                                                                                    | 3                        |                                                                                                                                                                                                       |
| **Run ask point**                      | 60–100 / 250+                  | ask at RF 60 / FF 50, Execute included                                                             | 8 per Workflow run (env) | expected typical after the change: about 40–55                                                                                                                                                        |

### 4. Model and effort by role

Ladder: haiku < sonnet < opus < fable. "Session" means the user's `/model`. The effort column applies only to Workflow `agent()` opts and to stamped frontmatter, because the Agent tool has no per-call effort.

| Role                                                                                                                                                                                       | Model                                                                                         | Effort                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| Mechanical: self-review CLAUDE.md list/summary/scorer, recall slice, SDD "cheap" (plan text holds the full code)                                                                           | haiku                                                                                         | low                                   |
| Gather and search: how explorers, why investigators, grill facts, prior-art, literature, Explore fallbacks, test-audit probes, harden hunters, doc-audit checkers, spec-compliance-checker | sonnet                                                                                        | medium                                |
| Review: SDD task reviewer and re-review (superpowers' mid-tier floor), the four specialists (overriding `inherit`), spec/standards, security, RF Evidence angle                            | sonnet                                                                                        | medium (silent-failure-hunter high)   |
| SDD "standard" implementer                                                                                                                                                                 | sonnet                                                                                        | medium                                |
| SDD "most capable", fix rounds 4–5, final whole-branch review, harden verifiers, refuters                                                                                                  | opus, or the session model if it is lower                                                     | high                                  |
| how explainer, why synthesizer                                                                                                                                                             | fable (as sync-pstack writes it)                                                              | —                                     |
| Plan-review panel                                                                                                                                                                          | Correctness fable, Fit opus, Simpler sonnet, Evidence sonnet                                  | —                                     |
| arena / architect / interrogate (only on yes)                                                                                                                                              | as the pack writes them (model diversity is their point)                                      | —                                     |
| code-simplifier                                                                                                                                                                            | opus (its vendored pin)                                                                       | medium (slice 2)                      |
| spec-compliance.js discover/extract/undocumented/report                                                                                                                                    | sonnet via `opts.model` only if a sync rewrite adds it (slice 2); otherwise the session model | upstream: discover low, refute medium |

**Ceiling:** none by default, because the user asked not to have everything run on their selected model. A ruling `models: ceiling` clamps every role to the session model. `models: session` restores today's behaviour. `CLAUDE_CODE_SUBAGENT_MODEL` with `_FORCE=1` forces one model everywhere; it is documented and flows does not fight it.

### 5. Under ultracode or a Workflow (flow-rules subsection)

- **Ultracode lifts nothing.** The phase table, gates, caps and model table still govern.
- **One phase per script.** A Workflow script may cover at most one phase between two gates. It never asks the user anything; deviations come back as NEEDS_CONTEXT, so only the main session asks.
- **Models.** Every `agent()` passes `opts.model` (and `opts.effort`) from the table. An `agent()` with no model is a bug.
- **Size.** `parallel()` and `pipeline()` are sized to `min(phase cap, workflowSizeGuideline)`, using the batch-and-defer rule. The script's title names the flow, the phase and the agent count.
- **Execute stays serial.** This agrees with SDD's "Never dispatch multiple implementation subagents in parallel", so it needs no marker.
- **No nesting.** A conductor called inline (/verify → /self-review, /doc-audit, /test-audit) never starts a workflow of its own inside another. Subagents and workflow agents start no workflows.
- **tob's workflow.** It always gets an explicit `limit` (default 10) and runs only on the user's yes, with its cost stated as `3 + docs + limit + 2 × divergences`.

## Steps

### Slice 1: rules, installer default, docs (one PR, patch release)

1. **Probe, recorded in `docs/adr/0005-agent-limits-and-models.md`.** (0001–0004 already exist.) This changes no code. With a throwaway session, record the Claude Code version and the result for each of:
   - (a) whether a Workflow `agent()` with no `opts.model` runs on the session model;
   - (b) whether a Workflow `agent()` with an `agentType` honours that agent's frontmatter `model:`/`effort:`;
   - (c) whether general-purpose subagents have the Agent tool;
   - (d) whether the mod hook `agent.spawn` fires for workflow agents, and which fields `e` carries.

   Later steps that depend on a result name it.
   - **Test:** the ADR lists each probe with its version and result.

2. **New section in `plugins/flows/references/flow-rules.md`,** after "Running a flow": "## Agents: how many and on which model". It holds the rules in Design 2, the budget table in 3, the model table and overrides in 4, and the "### Under ultracode or a Workflow" subsection in 5. In "Loading skills" (l.123-125), change the tob call example to always pass `limit`.
   - **Test:** `npm test` (checkOverrides, checkPackPaths). Read through to confirm every rule carries a number.

3. **Override markers** in that section, one line each, with these verified quotes:
   - `pstack-picks/skills/why/SKILL.md`: "Default to the full parallel investigation." and "Spawn one investigator per category that has a matching MCP, all in a single message so they run concurrently, each owning exactly one tool or MCP."
   - `pstack-picks/skills/arena/SKILL.md`: "Spawn more runners when the arena covers multiple design directions."
   - `pstack-picks/skills/blast-radius/SKILL.md`: "For a big or wide change, run it as an `arena`."
   - `mattpocock-picks/skills/grilling/SKILL.md`: "When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it"
   - `mattpocock-picks/skills/codebase-design/DESIGN-IT-TWICE.md`: "Spawn 3+ sub-agents in parallel." (becomes exactly 3)
   - `pstack-picks/skills/recall/SKILL.md`: "Spawn parallel subagents on a fast, cheap model, each taking a slice of the corpus."
   - `tob-picks/skills/spec-to-code-compliance/SKILL.md`: "Do not check requirements in this context", put in test-audit next to its new gate.

   Superpowers' tier names need no marker, because mapping a tier to an id doesn't contradict it.
   - **Test:** `npm test`. Change one quoted word locally, confirm check-repo fails, then revert.

4. **Conductor call sites**, flows-owned files edited by hand:
   - `feature-flow/references/plan-review.md`: "one reviewer per angle (FF 3, RF 4)" replaces "Spawn 2–3". A re-review reruns only the angles the change touched. Fit runs blast-radius inline.
   - `research-flow/SKILL.md`: the Evidence angle runs on sonnet.
   - `research-flow/references/literature.md` and `feature-flow/references/prior-art.md`: one sonnet agent that covers every item itself and spawns nothing.
   - `feature-flow/SKILL.md` Phase 1: the how/why caps, and the Explore fallback (≤3 explorers, sonnet).
   - `self-review/SKILL.md` Phase 3: the two Haiku setup agents become one; scorers are batched into ≤3 Haiku agents; spec/standards, security and the specialists run on sonnet passed per call, and CLAUDE.md on haiku; two waves of ≤8. This is plain prose, because `upstream/` can't carry a marker.
   - `doc-audit/SKILL.md`: ≤4 batched checkers; the Workflow offer passes `limit: 10`.
   - `test-audit/SKILL.md`: the Requirements probe gets doc-audit's yes gate with its cost, and checks in context otherwise.
   - `harden/SKILL.md`: ≤4 hunters and ≤4 batched verifiers on opus.
   - `verify`, `fix-flow`, `implement`, `understand`: the Explore fallback model; a conductor called inline starts no workflow.
   - The three flow.md templates (`feature-flow/references/flow-template.md`, `research-flow/references/research-template.md`, `references/build-template.md`): `agents:` frontmatter, plus "Agents" and "Deferred" headings.
   - **Test:** `npm test`, with `uses.json` unchanged so the generated parts stay fresh. Grep flows' own text for any per-item spawn that isn't batched.

5. **Installer default** in `installer/core/settings.ts`. Add a named constant with a comment explaining that it needs v2.1.269+, older versions ignore it, and a hand-set value wins. Write it as `out.env = { CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: WORKFLOW_CONCURRENCY, ...out.env, CLAUDE_CODE_TMUX_TRUECOLOR: '1' }`. `resetSettings` already rebuilds from `mergeSettings({})`, so a clean slate gets it too. If the user wants it switchable, add an `agentLimits` toggle (the enforced draft's pattern): off deletes only a value still equal to ours, as `isOurStatusLine` does. That touches `core/options.ts`, `steps/settings.ts`, `ui/`, `context.ts` and `install.ts`, with their tests.
   - **Test:** in `installer/core/settings.test.ts`:
     - extend the `deepEqual` at :185-187 with the new key;
     - a user value of `'3'` survives;
     - no `CLAUDE_CODE_SUBAGENT_MODEL*` key is ever written;
     - `resetSettings` contains the default.

     Then `npm test` (the coverage floor holds; raise it if coverage went up) and `npm run typecheck`.

6. **Docs:**
   - `CLAUDE.md`: the flows bullet names the new flow-rules section and the ultracode rule; the installer note says it writes the concurrency default and never writes a subagent model.
   - `plugins/flows/README.md`: one paragraph on the caps, the model table and how to override them.
   - `README.md`: the installer paragraph names the env default; a line on what is enforced and what is advice; the minimum Claude Code version; the user's own knobs (`workflowSizeGuideline`, `CLAUDE_CODE_SUBAGENT_MODEL` with `_FORCE`).
   - THIRD_PARTY.md: no change in slice 1.
   - **Test:** `npm test` (check-repo), `nix fmt` with a clean diff.

7. **Measure, then release.** In a scratch repo with ultracode on, run `/research-flow` through Gate 2 plus 1–2 Execute tasks, then `/verify`. Count the Agent and Workflow spawns and their models from the transcript, and put the numbers in the PR description. Targets: Phase 1 ≤8, plan review = 4, no Workflow without a yes, every spawn naming a model. Then `npm run release -- patch` on main.

### Slice 2: pinned models through the sync transforms (after probe b)

8. **Stamp the flows agents.**
   - `scripts/sync-self-review.mjs`: an `AGENT_MODELS` table that replaces `model:` and adds `effort:` on the four `inherit` agents (sonnet; silent-failure-hunter high, comment-analyzer low, the others medium) and code-simplifier (opus/medium). The sync fails if the line is missing.
   - `scripts/sync-tob.mjs`: stamp `model: sonnet` / `effort: medium` into `FLOWS_CHECKER`. If probe (b) shows that Workflow ignores frontmatter, add a REWRITES entry giving the checker's `agent()` call `model: 'sonnet'` instead. Optionally add a REWRITES entry `const MAX_LIMIT = 30` → `12`. Each must match, or the sync fails.

   Rerun both syncs to regenerate `plugins/flows/agents/*.md` and `spec-compliance.js`, and record the modification in THIRD_PARTY.md.
   - **Test:** the git diff shows only the stamped lines; `npm test`; `npm run scan-skills`.

9. **Optional: let markers point at flows' vendored `upstream/`** with a `flows:` target in `scripts/flows-uses.mjs` (MARKER resolution), so the self-review scorer override is checked too.
   - **Test:** a new case in `scripts/flows-uses.test.mjs` that passes while the sentence is present and fails once it is removed.

### Slice 3: optional hard guard (only if probe d passes)

10. **Mod guard in the dead-skills bundle.**
    - `plugins/default/hooks/agents.mjs`: a pure `decide({requested, sessionModel, count}, limits) → {model?}|{deny}`, with tests in `agents.test.mjs`, which the npm test glob already covers.
    - `register.tsx`: an `agent.spawn` hook (or `tool.call` on Agent, the hook this mod already uses at l.44) that counts spawns per prompt and denies at 40, with a reason that steers Claude to batch or ask. With `models: ceiling`, it clamps a model above the session model.
    - A `/agent-limit <n|off>` command, plus `DEAD_SKILLS_AGENT_LIMIT` in env.
    - **Test:** `agents.test.mjs`, and `claude plugin test .` in `plugins/default`.
    - **Docs:** the dead-skills `description` and README, kept true.

11. **Optional: one line in `plugins/default/rules.md`** so plain ultracode sessions outside the flows also name a model per role and stay within the size guideline.

## Open questions for the user

1. **Should your selected model be a ceiling?** Recommendation: no ceiling by default. Roles get the table's model, so cheap roles drop to haiku or sonnet and the diversity panels keep their spread. `models: ceiling` is available as a ruling.
2. **Is fable above opus on the ladder?** Recommendation: haiku < sonnet < opus < fable, which matches how pstack uses fable for synthesis. Please confirm.
3. **Are the numbers right:** ask at 60 (RF) / 50 (FF), ≤8 per message, ≤4 per batched fan-out, 8 concurrent Workflow agents? Recommendation: yes, and stop to ask rather than hard-stop.
4. **May a Workflow run a phase (one phase between gates, models on every agent), or are Workflows banned for conductor phases?** Recommendation: allow one phase per script. A ban is likely to lose to ultracode's own instruction.
5. **Should the installer write only the concurrency default, or also `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, or `workflowSizeGuideline`, and should it sit behind a toggle?** Recommendation: only the concurrency default, without a toggle. Spawn depth waits for probe (c); a guideline in settings shadows `/config`.
6. **Should slice 2's pinned frontmatter models land?** Recommendation: yes, after probe (b). The four `inherit` analyzers get sonnet; it's cheap and they don't need the top model.
7. **Should the rules reach plain ultracode sessions** (slice 3, step 11)? Recommendation: not until slice 1 has been measured.
8. **Should test-audit's Requirements Workflow get the yes gate with its cost?** Recommendation: yes. It is the largest ungated fan-out.

## Not checked

- Whether an `agentType`'s frontmatter `model:` is honoured inside a Workflow.
- Whether subagents have the Agent tool in the user's version.
- `agent.spawn`'s fields, and whether a mod can read the session model.
- The exact set of model values the per-call `model` parameter accepts. sub-agents.md says "the same values as --model"; the SDK type lists four.
- The current Claude Code version on this machine, and therefore whether `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (v2.1.269+) is honoured.
- The third-party report that ultracode skips the subagent cap for workflow agents. It wasn't verified, but it agrees with the docs.
- The agent counts after the change are estimates until the measurement in step 7.
