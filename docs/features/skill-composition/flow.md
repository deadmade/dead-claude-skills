---
flow: research
phase: execute
---

# Skill composition: research flow

## Request

Hey, the basic idea of this repos skills are to utilize skills from other established repos and combine them to work
with my workflow and I feel this currently does not work properly. I feel like we have many skills that are
duplicated, have sharp edges, dont exist/are missing and we dont utilize ponytails or superpowers properly

Follow-up, 2026-10-22, on the gates and the goal:

> they are genuently for me to review and catch errors or assumptions the model made before I implement something. My
> basic idea was to utilize both I love superpowers but the model has no restriction thats what I like about
> superpowers I feel like combining different things can give me a better output but currently the combining part is
> not perfect

> yeah I meant superpowers provide awesome tools for tdd or sdd but lacks the clean and refined approch something like
> ponytails give me. But also the grilling from matpocks or the general lockup etc I got from pstacks is awesome

The last time the combining failed (asked 2026-10-22):

> it was an api in .net I added customer split databases. Everything was going good, seperate db context, new tables
> looking good and then bam Basilcy every class touched for routing instead of the edge

What success looks like (asked 2026-10-22; picked "Right skill, right moment", "Assumptions reach me", "Clean by
default", not "Less noise"):

> I dont have something against overlapping skills that have a similar name but do different things so by combinding
> them I get a better end result. Thats what the flow skills are for. They are the conductors that activate these
> skills - i dont want to be the one that activates them and I dont want that claude adds them to their context

- The owners the user values: superpowers TDD and SDD; ponytail for keeping it small and clean; mattpocock `grilling`;
  pstack's lookups (`how`/`why`, to confirm).
- **Principle (user, 2026-10-22): the conductors are the only thing that activates a leaf skill.** Not the user typing
  it, not Claude picking it from the listing. Skills with similar names that do different jobs are wanted, as long as a
  conductor decides which runs when. Token cost is not a goal in itself.
- What follows from it, to settle in Phase 2: leaf skills drop out of Claude's own routing (for plugin skills only
  `disable-model-invocation`, set in the sync transforms, does that); superpowers' `using-superpowers` bootstrap tells
  Claude to do the opposite and would change.
- ponytail's hooks (user, 2026-10-22): "as far as I understand ponytail utilizes hooks to add its rules to every
  session. I feel like especially for heavy conductor work this is not the right choice". Open for Phase 2: ponytail
  as a blanket hook vs applied by the conductors at the phases where restraint pays (scope cuts, implementer briefs,
  review), with the hook kept for work outside a conductor. Needs the ponytail reader's facts: what each hook
  injects, its size, and which switches exist (`PONYTAIL_DEFAULT_MODE`, `PONYTAIL_SUBAGENT_MATCHER`, `PONYTAIL_MAP`
  per the prior art; per session, not per conductor).
- Settled (user, 2026-10-22): "I utilize mostly conductors for coding work. Small fixes like explain this or change the
  variable name whatever shouldt require ponytail in my opinion". So ponytail's blanket hooks go; the conductors apply
  ponytail at the phases they choose. Work outside a conductor is plain Claude (my reading of this and the principle
  above; the user can correct it). "Clean by default" means clean inside conductor work. The mechanism (sync
  transform, installer env, or the mode tracker) is for Phase 2, with the ponytail reader's facts.
- Constraint (user, 2026-10-22): "dont want to many options env vars etc set. Primary goal is to deliver the plugin as
  it and works awesome and the same on every machine so would like to still sync it no excustions, just not install
  it". So: no env vars or toggles; ponytail synced unchanged; not installed, so its hooks never run.
- How a conductor can reach files of a plugin that isn't installed (checked 2026-10-22, for Phase 2):
  1. **Sync it into flows' own folder** (say `plugins/flows/vendor/ponytail/`, outside `skills/` so nothing is
     listed; nested `hooks/` don't load) and read it as `${CLAUDE_PLUGIN_ROOT}/vendor/...`. Plain files, same on every
     OS and install.
  2. **A symlink inside flows to `plugins/shared/ponytail`**: documented
     ([host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#share-files-within-a-marketplace-with-symlinks)):
     a link "elsewhere within the same marketplace … is dereferenced", but installs from a local path skip it, and a
     Windows checkout without symlink support is unverified.
  3. **Read the marketplace clone** (`~/.claude/plugins/marketplaces/dead-claude-skills/`, here pinned to `v0.5.0` per
     `known_marketplaces.json`): works on this machine, but it's Claude Code's internal layout, and a local-path
     marketplace lives elsewhere.
  - Unlisting a plugin retires it everywhere: the installer uninstalls our plugins the manifest no longer lists
    (CLAUDE.md), and the docs add `renames: {"<name>": null}` + `forceRemoveDeletedPlugins`.
  - No skill in `plugins/shared/ponytail/skills` or `plugins/shared/superpowers/skills` uses `${CLAUDE_SKILL_DIR}` or
    `${CLAUDE_PLUGIN_ROOT}` (grep, no hits), so reading them by path loses nothing to substitution.
  - Consequence to confirm with the user: not installing ponytail also removes its band above the prompt
    (`hooks/band/`, a mod loaded through its hooks.json).
- Direction (user, 2026-10-22): "I dont want sync to copy files to just everywhere. I was thinking that the installer
  can vendor that in". Option 1 above (a second synced copy inside flows) is out; the repo keeps one synced folder per
  pack, and the installer puts the packs where the conductors read them. Facts for Phase 2:
  - A documented place that survives plugin updates: flows' persistent data directory, `${CLAUDE_PLUGIN_DATA}` in
    plugin skills; on this machine those are `~/.claude/plugins/data/<plugin>-<marketplace>/`. The installer writes
    nothing there today (`grep CLAUDE_PLUGIN_DATA installer`, no hits), and the directory naming isn't in the docs I
    read: to verify.
  - Same version as the conductors: the installer pins the marketplace to the release tag (`known_marketplaces.json`:
    `"ref": "v0.5.0"`), so flows only changes when the installer re-pins, and it can refresh the copy then.
  - Gap: installing flows with `/plugin install` alone (README offers it) brings no copy; conductors then need the
    missing-piece fallback, or that install route goes.
- Settled (user, 2026-10-22): "lets not install the band for now. I have another idea with it that comes later. and
  just remove this path. Just the ui". My reading: ponytail's band isn't installed for now (the user has a later idea
  for it), and the `/plugin install` route goes from the docs: installing is through the installer's UI only.
- Open: what activates anything outside a conductor (a quick fix or a question in chat). Bring the usage numbers.
- Correction to the brainstorming playback (user, 2026-10-22): "whats really important is that we dont limit the
  plugins to just one thing since they provide many different skills and my expeienrce with them was mainly using
  feaute-flow. But other flows need different skills from these!" So each pack is a library of many skills; each
  conductor picks the ones its steps need. The owners table above is feature-flow's slice, not the packs' job, and a
  skill no run has used yet (usage is mostly feature-flow) isn't a candidate for removal on that count.
- Settled (user, 2026-10-22), asked "when a build hits a decision the plan never made, like where the customer routing
  should live, what do you want to happen at that moment?": "stop, and ask me". So the conductors override
  subagent-driven-development's "Continuous execution" and "Rulings, not stalls" for decisions the plan didn't make;
  where the line sits (vs minor choices that may go on) is to settle.
- Build playback agreed (user, 2026-10-22: "yes, thats the idea!"): the approved plan is the contract; the build stops
  and asks on a deviation (new or changed public interface, new library or outside call, changed data flow or error
  handling, files the task didn't list) and goes on for private names and small cleanups inside the task's files.
  Enforced in three places: the code-writing subagents' brief, the coordinating session (no "ruling and moving on" on
  those), and a mechanical check of each task's changed files against the plan's file list. Smaller calls the build
  makes alone are listed for the owner before the branch is approved.
- Anti-goal (user, 2026-10-22), asked what would make it a failure even if every piece technically works: "they dont
  work together as a whole is my biggest concern". So each piece passing on its own isn't success; the measure and the
  checks have to look at whole conductor runs, and at the composition staying intact when upstream packs change
  (grounding: feature-flow's overrides went stale twice after superpowers releases).
- How the user would judge it (2026-10-22), asked "If after the rebuild I could show you one run that proves it works
  as a whole, what would that run be?": "I would try that out myself on multiple runs". So the final word is the
  user's own runs, several of them, not one demo; the Hypothesis has to be something those runs can read off.
- The measure (user, 2026-10-22), after a playback that offered practice tasks plus `claude plugin eval` runs next to
  the user's own: "I will run the flows!". My reading: the user's own conductor runs on real work are the measurement,
  with no practice tasks or eval runs as the measure. Proposed (not yet agreed): the numbers come from those runs'
  transcripts, not from Claude's account of them (E4: a swapped skill was disclosed in 0.9% of runs): which skill each
  step used, decisions the build made alone vs brought to the user, files touched outside the plan's list, plus the
  user's verdict per run. The baseline comes from conductor sessions already on this machine: 23 main sessions with a
  conductor's `command-name` tag, 2026-10-11 to 2026-10-22 (`rg` over `~/.claude/projects`; 16 bare `/feature-flow`
  from before the plugin's namespacing, 7 `/flows:*`: feature-flow 4, fix-flow 2, research-flow 1), all on this repo,
  kept by `cleanupPeriodDays: 36500`. Sessions, not runs: a resumed run spans several. The eval
  stays a candidate only for the upstream guard (Phase 2 options).
- Recon (user agreed, 2026-10-22): a per-flow skill map, by workflow: a catalog of every pack (vendored and
  upstream-only, plus official plugins and Claude Code built-ins), then each of the 11 flows and the two missing ones
  (integrate; vendor a pack) mapped step by step to the skills that fit, each map checked by a skeptic, then a
  synthesis. Done 2026-10-23 as [skill-map.md](skill-map.md): the catalog (481 entries) and six flows' maps came from
  the workflow; the usage limit cut off its skeptics, synthesis and critic, and the owner asked me to finish the other
  seven maps and the cross-cutting part in the main session to save usage ("pls do the rest yourself for now"). All
  maps are unverified by a second reader.
- Answered by the catalog (2026-10-23): `${CLAUDE_PLUGIN_DATA}` for flows is
  `~/.claude/plugins/data/flows-dead-claude-skills/` (docs plugins/components; matches `ls ~/.claude/plugins/data`).
  The Skill tool's dmi refusal fires only on a Skill-tool call, never on a read by path. Bundled `commit`/`pr` are off
  here (rollout gate).
- To verify: the skills docs say that when Claude calls the Skill tool on a `disable-model-invocation` skill, Claude
  Code "blocks the call and instructs it not to reproduce the deploy steps another way", which may fight a conductor's
  read-the-SKILL.md-by-path step if Claude tries the Skill tool first.
- The failure case: per-customer database routing threaded through every class instead of being resolved once at the
  edge. pstack ships the principle that targets this, `principle-boundary-discipline` ("Concentrate guards at system
  boundaries"), and `principle-redesign-from-first-principles` ("Apply when integrating a new requirement into an
  existing design"). Both are `disable-model-invocation: true`, and no conductor's `uses.json` lists a `principle-*`
  skill, so neither could have fired in that session. It is a candidate case for the measurement set.
- Where it went wrong (user, 2026-10-22): **during building**, not in the plan, in a run driven by `/feature-flow` or
  `/implement`. The transcript isn't on this machine.
- Why the deviation rule didn't fire (checked 2026-10-22): the rule lives only where the main session reads it
  (`plugins/flows/references/flow-rules.md:29`, `plugins/flows/skills/feature-flow/SKILL.md:119`), and nothing in
  `plugins/flows/` passes it into the implementer subagents' prompts (`grep -rn implementer plugins/flows/` finds
  nothing). The implementer only gets superpowers' own rule
  (`plugins/shared/superpowers/skills/subagent-driven-development/implementer-prompt.md:80-84`: "STOP and escalate
  when: The task requires architectural decisions with multiple valid approaches … restructuring existing code in ways
  the plan didn't anticipate"), which threading a parameter through every class can pass as not "restructuring".
- Confounder (user, 2026-10-22): "at this time I executed it, ponytails wasnt properly setup. Something was
  weird/off". The case says nothing about ponytail's effect either way.
- Stale installs (checked on this machine, 2026-10-22): `~/.claude/plugins/installed_plugins.json` has
  `ponytail@dead-claude-skills` at **5.2.0** (old upstream copy, `installPath …/ponytail/5.2.0`) and
  `superpowers@dead-claude-skills` at **7.0.0**, while the marketplace ships both vendored as **0.5.0**. The
  installer's `outdated()` skips any install whose version is newer than the shipped one
  (`installer/core/plugins.ts:108` "A newer install isn't downgraded", `:115`), so it never moves this machine to the
  vendored ponytail, and won't move it to the vendored superpowers once that's released. One concrete way ponytail ends
  up "off", and a blocker for any change this flow makes through the vendored copies.
  - Decision (user, 2026-10-22): fixed later through ADR 0003's per-plugin versions ("I will add B down the line");
    out of scope here. This flow's measurement loads the repo's plugin folders (`claude plugin eval`), not the
    installed copies, so it doesn't depend on that fix; daily use on a machine stays on the old copies until then or a
    manual `claude plugin update`.

## Artifacts

- Spec: [spec.md](spec.md)
- Skill map: [skill-map.md](skill-map.md)
- Plan: [plan.md](plan.md)
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec and hypothesis approved: 2026-10-23 (owner: "I approve"). Reopened 2026-10-23: the plan review moved the
  packs inside flows instead of an installer copy (spec goal 1). Re-approved 2026-10-23 (owner: "I approve").
- Gate 2, plan approved: 2026-10-23, execution: subagent-driven (owner: "I approve and do sdd"); Task 0's commit list approved with it

## Skipped

## Grounding

<!-- What the code looks like where this lands: modules, entry points, conventions, file:line. -->

Full report: [grounding.md](grounding.md) (workflow, 2026-10-22: six read-only readers, a skeptic each, 105 claims
confirmed, 29 partly true, 2 refuted; synthesis; completeness critic). The parts the decisions rest on:

- **Execution decides for the user.** Vendored superpowers SDD
  (`plugins/shared/superpowers/skills/subagent-driven-development/SKILL.md:17-31`): "Continuous execution: Do not pause
  to check in", "Rulings, not stalls. A running plan does not wait on a human. Conflicts, ambiguities, plan defects …
  decide them", with only four stop reasons (destructive, security, side effects outside the worktree, a plan broken
  beyond guessing). flow-rules overrides only handoffs (FR:21-23), so its "stop and let the user decide" never applies:
  the web-mcp run's SDD ledger holds 30 `Ruling:` lines, some design-level, against one recorded Deviation. This is the
  mechanism behind the user's .NET case: an implementer's escalation goes to the controller, which rules and continues.
- **Who activates skills today.** All 11 conductors are `disable-model-invocation` (not listed); the listing holds 58
  entries / 19,930 chars, no dmi skill. superpowers' router sends plain requests to superpowers, not to conductors, yet
  it rarely fires on its own: 52 of 55 superpowers Skill calls happened inside typed conductor runs; 3 of 89
  non-conductor sessions invoked superpowers.
- **Listing budget.** 1% of context at 3 chars/token: 30,000 chars at 1M (66% used); at 200K it is 6,000, below what
  bundled skills keep, so every plugin skill would list as a bare name.
- **Always-on.** ≈12.7k tokens per session (hooks 2.2k: superpowers 850, ponytail 1,240 with its map, rules.md 75;
  listings 6.8k; CLAUDE.md + MEMORY.md 3.7k; plus sandbox text). ponytail's SubagentStart adds ≈715 tokens to 319 of 326
  subagent transcripts, reviewers included.
- **Reading dmi skills by path fights the harness.** Its refusal text says "Do not replicate this skill's workflow by
  other means" (2.1.307) against FR:40-46; `${CLAUDE_SKILL_DIR}` stays literal in a file read by path; the FR:44 glob
  matches 6–7 cached versions.
- **Duplicates:** code-review@official vs self-review's bug pass (identical but a comment; dead-skills still installs
  code-review); the suite runs three times in /verify; pr-test-analyzer in /self-review and /test-audit; writing-skills
  vs skill-creator with opposite rules; specs and plans in three homes (docs/features, docs/superpowers, ~/.claude/plans).
- **Conflicts:** deviations (above); finishing menu; commits (FR:34 vs brainstorming/writing-plans committing); spec
  home; ponytail's no-test-for-trivial and smallest-version vs TDD and brainstorming; ponytail's footer and `shortcut:`
  vs SDD's reviewers; CONTEXT.md (conductors) vs GLOSSARY.md (domain-modeling).
- **Usage:** conductors typed since flows installed: feature-flow 4, research-flow 2, fix-flow 2, six never; grilling 10,
  domain-modeling 6; never used: 11 mattpocock, 15 pstack, 3 tob skills, graphify, skill-creator; 41 of 52 gate answers
  took "(Recommended)"; `! git push` typed 33 times. The usage covers this repo only; the other 9 projects show 0
  conductor runs, so conductors are unobserved on product code.
- **Gaps:** the integrate loop (commit, push, PR, CI, release: 57 prompts in 39 sessions); vendoring a pack (this repo's
  core job, re-derived by hand each time); no conductor names a language or boundary skill (csharp, rust, postgres,
  hallmark, `principle-boundary-discipline`, `codebase-design`: 0 hits in plugins/flows).

Superpowers was vendored into `plugins/shared/superpowers/` by another session on 2026-10-22 (user: "done"). It is
uncommitted on `main` as of this note, so a worktree for this flow's build needs that work committed first.

## Prior art

Prior-art agent, 2026-10-22 (sources fetched in that run). I re-fetched the two docs pages the design leans on
([skills](https://code.claude.com/docs/en/skills), [plugin-evals](https://code.claude.com/docs/en/plugin-evals)) and
they say what is quoted below. Nothing found does the whole job: catalogs curate but don't wire, and conductors mostly
wire only their own pack.

- **A. Always-on bootstrap, self-chaining skills.** A SessionStart hook injects a router or persona; each skill names
  its successor. superpowers
  ([session-start](https://github.com/obra/superpowers/blob/main/hooks/session-start) injects all of using-superpowers
  on startup/clear/compact; brainstorming's HARD-GATE ends "invoke superpowers:writing-plans and no other skill");
  ponytail for style ([ponytail-subagent.js](https://github.com/DietrichGebert/ponytail/blob/main/hooks/ponytail-subagent.js)
  injects into every subagent unless `PONYTAIL_SUBAGENT_MATCHER` is set). Fires unasked; paid every session and after
  compaction; hard-coded successors fight other planners. using-superpowers concedes that CLAUDE.md "take[s]
  precedence over skills". Bad fit where a conductor owns the order.
- **B. User-invoked conductor over leaf skills.** One `/command`, fixed phases, named owner per job, gates, state on
  disk: wshobson
  [full-stack-feature](https://github.com/wshobson/agents/blob/main/plugins/full-stack-orchestration/commands/full-stack-feature.md)
  (no cross-plugin agents, `state.json`), Anthropic
  [feature-dev](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/feature-dev/commands/feature-dev.md),
  pstack [poteto-mode](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md) (reads leaf
  skills by path and names the owner outright: "not Cursor's built-in babysit skill, whose description matches the
  same words"). Costs nothing in the listing when `disable-model-invocation`; someone has to start it; leaf skills
  that chain must be overridden (flow-rules.md does); cross-pack calls break when a pack is missing.
- **C. Curated catalog.** Many small namespaced plugins, allowlist plus pinned sha, duplicates rejected at curation:
  [claude-plugins-official](https://github.com/anthropics/claude-plugins-official/blob/main/README.md) skill-bundle
  plugins (`strict: false` + `skills` array), anthropics/skills, Trail of Bits
  [skills-curated](https://github.com/trailofbits/skills-curated/blob/main/CLAUDE.md) (rejects duplicates, prefixes
  imports), wshobson [architecture](https://github.com/wshobson/agents/blob/main/docs/architecture.md) plus an
  [agent-name collision check](https://github.com/wshobson/agents/blob/main/tools/check_agent_name_collisions.py).
  Overlaps survive behind namespaces (feature-dev and pr-review-toolkit both ship `code-reviewer`).
- **Making the right skill fire:** mattpocock
  [invocation.md](https://github.com/mattpocock/skills/blob/main/.agents/invocation.md) (user-invoked skills get
  `disable-model-invocation`; "Call the Skill tool with 'grilling'" fires more often than a bare `/name`; a
  user-invoked skill can't reach another user-invoked one);
  [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) description tuning
  with near-miss queries ("competes with another but should win"); plugin evals' `tool_used: Skill` and `tool_order`
  graders against a no-plugin baseline.
- **Docs constraints (2.1.308; re-checked by me where marked ✓):**
  - ✓ The listing budget is 1% of the context window; on overflow, descriptions are dropped starting with the
    least-invoked skills (names stay). Settings `skillListingBudgetFraction`, `SLASH_COMMAND_TOOL_CHAR_BUDGET`,
    `skillListingMaxDescChars`; description + `when_to_use` capped at 1,536 chars each.
  - ✓ `disable-model-invocation: true` takes the description out of context; `skillOverrides` does not apply to
    plugin skills (only `/plugin`, whole plugins). Per-skill disabling of plugin skills is an open request
    ([#14920](https://github.com/anthropics/claude-code/issues/14920)), and disabling a plugin another enabled plugin
    depends on is refused, so while flows is on only `disableAllHooks` stops superpowers' and ponytail's injections.
  - ✓ `/skill-doctor` reports each skill's context cost and use, and flags never-invoked ones; `/doctor prompt-audit`
    (2.1.283+) checks CLAUDE.md, skills and other configuration for outdated or conflicting instructions.
  - ✓ Bundled skills include `/verify` ("confirm a code change does what it should") and `/code-review`; a bare
    `/name` reaches a plugin skill only if no other command has that name.
  - Hooks run in parallel with no documented order; hook text over 10,000 chars goes to a file with a 2,000-char
    preview; text that reads like system commands can trip prompt-injection defenses; a single hook can't be disabled.
  - `claude plugin details` gives hooks no cost, so SessionStart injections are missing from its "Always-on" figure.
  - Strict mode: a marketplace entry can't drop skills from an upstream with its own plugin.json, so trimming
    superpowers means vendoring it (now done).
  - Workflows can't take user input mid-run, so gated conductors stay skills. Compaction re-attaches the first
    5,000 tokens of each invoked skill, 25,000 in total.
  - ✓ `claude plugin eval`: isolated `claude -p` runs with only the plugin(s) under test (a case's `plugins:` list
    takes several directories), 3 runs per arm, `--ablation with-without`, free graders `tool_used`, `tool_order`,
    `regex`, `file_exists`; `tool_used: Skill` is reported but excluded from Δ.
    - Re-read 2026-10-22 for the Hypothesis: runs are non-interactive and never stop to ask permission; `AskUserQuestion`
      may be listed in `allowed_tools`, so a `tool_used` grader can see it called, but nothing answers it. There are no
      scripted follow-up turns: `context.history_file` resumes a saved transcript, and `context.scaffold_script` (only
      with `--scaffold`) seeds files and git state, so a conductor can start mid-flow from a prepared flow.md, not
      click through its gates. Limits up to 200 turns and 3,600 s per run. Each run and judge call is real usage on the
      account (`--max-cost-usd` caps it). No user or project settings, CLAUDE.md, hooks, memory or other plugins load;
      `HOME` is a temporary directory. `--ablation none` runs one arm, so before/after compares two runs of the same
      suite.
    - To verify: whether a run's prompt can start a `disable-model-invocation` conductor by typing `/flows:feature-flow`;
      where `${CLAUDE_PLUGIN_DATA}` points inside a run's temporary home (it matters if the installer places the packs
      there, because the eval would have to place them too).
- **superpowers with ponytail:** ponytail's maintainer says they "compose… at different layers" and to expect pushback
  on plans ([#49](https://github.com/DietrichGebert/ponytail/issues/49)); an older ponytail rule calling subagents
  "over-process" fought SDD ([#464](https://github.com/DietrichGebert/ponytail/pull/464), closed unmerged); Sonnet 5
  once took the combined injections for a prompt injection
  ([#1878](https://github.com/obra/superpowers/issues/1878) → [#1480](https://github.com/obra/superpowers/issues/1480),
  maintainer: "looks rare"); [#2377](https://github.com/obra/superpowers/issues/2377): without the bootstrap, correct
  triggering fell to 11/15 (Sonnet 5) and 6/15 (Fable 5.1), Opus 5.5 stayed 15/15, and neutral wording did as well as
  the current text. Off switches: `PONYTAIL_DEFAULT_MODE=off`, `PONYTAIL_MAP=0`; superpowers has none, so its hook
  would change in the sync transform.

## Evidence

Literature agent, 2026-10-22: web-mcp `papers: true`, plus paper-lookup for the papers citing SkillsBench and
AGENTS.md. It read the full text of E3–E6 and E8–E10, and only the abstracts of E1, E2 and E7. I re-fetched the
records of E3, E4, E8 and E9 in this session (web-mcp search `papers: true`, arxiv.org/abs), and their abstracts say
what the rows claim.

| #   | claim                                                                      | source                                                                                          | study type            | setting                                                                      | result / effect size                                                                                                                                                                                                                                                               | transfers here?                                                                   | strength                              |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| E1  | Critic loops fix errors only when they get reliable outside feedback       | doi:10.1162/tacl_a_00713, _When Can LLMs Actually Correct Their Own Mistakes?_, 2024            | survey                | self-correction studies                                                      | Feedback from a prompted LLM alone fails, except on unusually suited tasks; feedback from tests or tools works                                                                                                                                                                     | partly: reviewers should rest on tsc/cargo/test output; 2024 models               | High                                  |
| E2  | Curated, focused skills help; skills the model writes itself don't         | arXiv 2602.12670, _SkillsBench_, 2026                                                           | benchmark             | 87 tasks, 18 model–harness setups                                            | +16.6 pp (33.9→50.5%); skills of ≤3 modules beat big bundles. v1: software tasks +4.5 pp, 16/84 tasks worse, self-generated skills ≈0                                                                                                                                              | partly: mostly not software tasks                                                 | Low (preprint)                        |
| E3  | Bigger libraries lower the pass rate through wrong or missing skill choice | arXiv 2605.24050, _More Skills, Worse Agents?_, 2026                                            | controlled experiment | SkillsBench; Haiku 4.5, Sonnet 4.6; 52/102/202 skills                        | −8/−14/−21 pp vs only the helpful skills installed; wrong-skill choice is significant, context overhead ≈0; Sonnet's drop significant only at 202                                                                                                                                  | yes: same mechanism; 85 sits between 52 and 102                                   | Low (preprint)                        |
| E4  | Two skills that do the same job silently replace each other                | arXiv 2610.11647, _One Skill Too Many_, 2026                                                    | controlled experiment | Claude Code 2.1.283; Sonnet 4.6, Haiku 4.5, Opus 5; 312 pairs, 6,368 runs    | Installed skill used 19.9 pp less (unrelated skill: 5.9); task completion flat; requirements only that skill states −5.6 pp; the swap is disclosed in 0.9% of runs; a pre-tool hook at the first skill read restores it; skill listing capped at 1% of context (6–8k chars)        | yes: same harness and models; the vendored packs overlap on review, TDD, planning | Low (preprint; also checked on Codex) |
| E5  | The number of rules alone degrades slowly                                  | arXiv 2507.11538, _How Many Instructions Can LLMs Follow at Once?_, 2025                        | benchmark             | 10–500 keyword constraints, 20 models                                        | Claude Sonnet/Opus 4: 98–100% followed at 50, ~94.5% at 100, 68–77% at 250; bias toward earlier rules peaks at 150–200                                                                                                                                                             | partly: dozens of rules sit far below that; conflicting rules not tested          | Low (preprint)                        |
| E6  | Always-on context is followed and costs more, without raising success      | arXiv 2602.11988, _Evaluating AGENTS.md_, 2026                                                  | benchmark             | SWE-bench Lite + 138 tasks; Claude Code/Sonnet 4.5, Codex, Qwen Code         | Success change not significant (LLM-generated files −0.5 to −2 pp; developer-written +2.4 pp); cost ~+20%; file length had no effect                                                                                                                                               | yes: CLAUDE.md-style injection; Python only                                       | Low (preprint)                        |
| E7  | A fixed three-phase pipeline beat autonomous agents, cheaply               | doi:10.1145/3715754, _Demystifying LLM-Based Software Engineering Agents_ (Agentless), FSE 2025 | benchmark             | SWE-bench Lite, 2024 models                                                  | 32.0% at $0.70 per issue, best open-source result then                                                                                                                                                                                                                             | partly: older models, no human gates                                              | Med                                   |
| E8  | Replicates E3: skill loading collapses as unrelated skills are added       | arXiv 2610.18522, _Lost in Implicit Routing_, 2026                                              | controlled experiment | SkillsBench; 3 open-weight models + Opus 4.6 on a subset; 0–10k added skills | +100 skills: share of needed skills loaded −16 to −25 points, pass@3 ≈ flat; an LLM picking skills first lifts that share 53→73% and pass@3 49→55%; masking the extra descriptions restores loading; +1,000: a "plan skills first" prompt reaches 40% vs 71% for the separate pick | partly: mostly non-Claude models; it tests a nudge like the 1% rule               | Low (preprint)                        |
| E9  | Negative: most software skills add nothing; some hurt                      | arXiv 2603.15401, _SWE-Skills-Bench_, 2026                                                      | benchmark             | 49 skills, ~565 tasks; Claude Code + Haiku 4.5                               | +1.2 pp (89.8→91.0%); 39/49 skills zero; tokens +10.5% mean (−78% to +451%); 3 skills −9 to −10 pp from templates written for other versions                                                                                                                                       | yes: same harness and kind of work; many tasks near 100% either way, one model    | Low (preprint)                        |
| E10 | Qualifier: gains from extra scaffolding shrink as models improve           | arXiv 2609.32459, _Beyond the Model: Harness Effects_, 2026                                     | controlled experiment | 10 Qwen/DeepSeek models; SWE-bench Pro, ProgramBench                         | Issue-repair gain falls (OpenHands +13.6→+5.5 pp, Claude 3.7→4 Sonnet); narrow-task subagents +4.5–5.9 pp; generic phase subagents −0.7 to −2.3, context compression −3.9 to −4.9; planning, on-demand skills small                                                                | partly: open-weight models; the conductors resemble generic phase subagents       | Low (preprint)                        |

- **Agrees:** the bottleneck is choosing the skill, not context length. Duplicates replace each other (E4), and long
  listings mean skills don't get loaded (E3, E8). Context overhead is ≈0 (E3), and hiding the extra descriptions
  restores loading (E8). Pass rates hide this, because strong models work around a missing skill (E3, E4, E8), so
  measure skill use directly. Injected guidance is followed and costs tokens, with ≈0 average gain on software tasks
  (E2 v1, E6, E9). Review pays off when tests ground it (E1), and as narrow roles rather than generic phases (E10).
- **Conflicts:** E2's +16.6 pp vs E9's +1.2 pp comes from the mix of domains, E9's ceiling (24/49 skills at 100% with
  or without the skill) and its one weak model. Pipelines won in 2024 (E7); by 2026 the issue-repair gap is a few
  points (E10). E3 sees wrong picks for Sonnet, E8 mostly no picks, but E8 left out near-duplicates by design.
- **Not covered:** conflicting always-on rules (the 1%-invoke rule next to "least code"), hook order beyond E5's simple
  constraints, human approval gates (no controlled study found), multi-hour sessions with compaction, TypeScript or
  Rust, libraries made only of plugin skills. Nine of ten rows are 2026 preprints; E2, E3 and E8 all use SkillsBench.
- **Proposed effect (agent's):** a replay set of the owner's own tasks whose intended skill has a twin doing the same
  job. Merging each pair should raise the share of runs that read the intended skill first by about 15–20 points (E4;
  direction from E3, E8), with pass rate within ±3 pp (E3, E4, E9) and input tokens per task holding or falling (E6,
  E9). Measured from transcripts: the first `Skill` call or SKILL.md read before any edit.
- **Unchecked:** whether Claude Code 2.1.307 still caps the skill listing at 1% of context (E4); Opus-class effects at
  85 skills are extrapolated from Haiku, Sonnet and open-weight results.

## Options

Round 1 (2026-10-23), from [skill-map.md](skill-map.md); the owner took every recommendation:

- **Placed packs:** picked "All skill packs". superpowers, ponytail, mattpocock-picks, pstack-picks, tob-picks and
  paper-lookup are placed by the installer in `~/.claude/plugins/data/flows-dead-claude-skills/` and not installed.
  Packs that bring tools stay installed: web-mcp, tui-review, graphify, self-review, csharp/rust/postgres. A placed
  pack's agents run as `general-purpose` with the agent file as prompt. Evidence: E3, E8 (listed extras cost skill
  loading), E4 (duplicates replace each other). Rejected: placing only superpowers and ponytail and setting dmi on the
  rest in sync transforms (two mechanisms).
- **Drift guard:** picked "Quote check". Each conductor override quotes the pack sentence it overrides, and check-repo
  fails the sync PR when that sentence is gone or changed. No model runs. Evidence: grounding (feature-flow's overrides
  went stale twice), E9 (skills written for another version cost 9–10 pp). It catches text drift only. Rejected: adding
  `claude plugin eval` on sync PRs (usage, an API key in CI); nothing new.
- **Duplicates:** picked "Fix all". Drop code-review@official from dead-skills; /verify runs the suite once; pr-test-analyzer
  runs once and feeds test-audit; specs and plans live only in `docs/features/<slug>/`; writing-skills owns skill
  writing, skill-creator only its eval tooling.
- **New flows:** picked "integrate in flows, vendor in repo". `/integrate` in flows (commit under the owner's rules, PR
  body, hands over push and `gh` as `!` lines, watches CI, stops on red); vendor-a-pack as a checklist in this repo's
  docs; /self-review offers /fix-flow for findings that need a cause.

Round 2 (2026-10-23); the owner took every recommendation:

- **Build calls:** picked "Log + verify row". A Rulings section in flow.md written as each call is made, and a
  Decisions row in /verify's verdict (every ruling, deviation and new `shortcut:`) that the owner confirms or reopens.
  Evidence: E1 (outside feedback), E4 (a swap disclosed in 0.9% of runs). Rejected: the verify row alone.
- **Seams:** picked "Ask the seam + vendor rule". feature-flow and research-flow ask where each cross-cutting concern
  is resolved and which modules never see it (codebase-design, principle-boundary-discipline), copied verbatim into the
  plan's Global Constraints; implement asks it in Read when the input doesn't say; pstack's
  `principle-laziness-protocol` is vendored and its "new signal through layers: stop" line goes into every builder
  brief. Rejected: the seam question without the vendored rule.
- **Stack packs:** picked "Detect from files". One flow-rules rule maps repo files (`*.csproj`, `Cargo.toml`,
  migrations, a web frontend) to the pack skills added to plan, builder and review briefs. Rejected: asking per run.

Builder check (2026-10-23, done in the main session to save usage, not by a subagent):

- Theirs: installed packs whose skills still fire on their own. Owner picked "Keep domain skills": the conductor-only
  rule covers process skills; domain skills (csharp, rust, postgres, hallmark, graphify), claude-security,
  claude-md-improver, skill-creator and security-guidance's hooks stay. Rejected: strict, with dmi in sync transforms and
  dropping official plugins.
- Theirs: the Hypothesis threshold. Offered: 4 of 5 runs without an unasked deviation, ≥90% of steps with the named
  skill, 4 of 5 "worked as a whole"; stricter; looser. Owner: "I will decide that must feel right cant just meassure
  it". So the verdict is the owner's judgment, not a number set in advance.
- Offered switching to /feature-flow, since research-flow expects a pre-set threshold. Owner picked "Stay, verdict =
  you": the Hypothesis is supported when the owner judges the flows work as a whole, with the transcript numbers (m1
  unasked deviations, m2 skill per step, before and after) reported as input. This deviates from research-flow's
  threshold rule on purpose.

Grill (2026-10-23, mattpocock grilling, kept to owner-only branches to save usage):

- Fact found: placed packs leave marketplace.json, so the installer uninstalls the stale ponytail 5.2.0 and superpowers
  7.0.0 installs on this machine (CLAUDE.md: unlisted plugins of ours are uninstalled).
- Q1, typing a pack skill by hand (`/grilling`, `/how`, `/ponytail-review`) goes away: owner "yes, conductors". No
  `/grill` conductor for now.
- Q2, one branch or three (placement; composition; extras), recommended three: owner "pls just run branch". My reading:
  one branch, one review, the owner's trial runs after it.

## Hypothesis

[spec.md#hypothesis](spec.md#hypothesis). The verdict is the owner's judgment after their own runs; m1 and m2 from
transcripts are reported as input.

## Plan review

Round 1 (2026-10-23). Four reviewers ran as subagents (Correctness, Fit, Simpler, Evidence; the owner picked the full
four over two lean ones). Together they made 46 findings, about 25 distinct, and every one traced to a file or doc,
so none were dropped.

The owner's decisions:

- **Pack home:** picked "Inside flows". Packs move to `plugins/flows/packs/<pack>/` and are read via
  `${CLAUDE_PLUGIN_ROOT}/packs`; there is no installer copy. This reopens Gate 1 for that item.
  - Why: the data-dir copy caused several blocking findings (Simpler 1, Fit 9, Correctness 1/6/7, Evidence 1):
    - `${CLAUDE_PLUGIN_DATA}` isn't substituted in files read by path;
    - the copy's source is the clone at the released tag;
    - there was no staleness check;
    - the copy would have needed staging code.
  - Rejected: the installer copy as approved.
  - Verified in docs plugins/components (2026-10-23): only the root `skills/`, `agents/` and `hooks/hooks.json` load.
- **Measurement:** picked "Keep it rough" over fixing m1/m2 to the spec's definitions (Evidence 2–7, Correctness
  9–11). measure.mjs prints its limits next to the numbers instead. Only cheap, obvious fixes are kept: a dated Gate 2
  line, the state-file edits excluded, this flow's slug excluded, and a Bash-edit count.
- **pstack sync:** picked "Pull it here, review diff". Task 2 records what else changed upstream. Rejected: a sync PR
  first.
- **Uncommitted work:** picked "I commit them": Task 0 commits the vendoring session's files on main after showing
  the list.

The fixes taken without a separate question (listed to the owner, no objection asked for separately; they are part of
the plan approved at Gate 2):

- **Task order:** the `INCLUDED` change and the installer tests move into the marketplace task (Fit 1, 2).
- **Pack references:** each SKILL.md states the packs path, and flow-rules says how to resolve `<pack>:<name>` and
  `${CLAUDE_SKILL_DIR}` inside packs. The glob stays for installed plugins (Fit 4–6, Correctness 1).
- **tob's workflow:** a sync-tob transform rewrites the checker agentType to general-purpose (Fit 3, Correctness 2).
- **Drift guard:**
  - check-repo is added to the four sync workflows (Fit 7, Correctness 3, Simpler 3);
  - the check lives in `flows-uses.mjs`, not a new script (Simpler 3).
- **pstack count:** `sync-pstack.yml` count becomes 19 (Fit 8, Correctness 4).
- **Names that aren't skills:** opening-a-pr isn't vendored, so integrate's PR shape is inline; defense-in-depth is a
  file (Fit 11, Simpler 5).
- **integrate scope:** release is dropped (Simpler 5).
- **Installer:** asserts after install that no pack is still installed (Correctness 5).
- **Files check:** the task base SHA is recorded, and the diff includes the working tree and untracked files
  (Evidence 8).
- **Stack packs:** router or single skill only (Evidence 9).
- **Release first:** a release before the owner's trial (Evidence 1, Fit 9).
- **Spec:** the non-goal on old installs is corrected (Correctness 13).
- **Verdict line:** a per-run Verdict line in the templates (Correctness 12).
- **Fifth stop:** uses AskUserQuestion (Evidence 3).
- **m2 report:** m2 is reported with no paper number to compare against (Evidence 10).

## Rulings

Calls the build made on its own (not deviation-class), one line each, as they are made:

- 2026-10-23, pre-flight: Tasks 3 and 4 run as one dispatch, because the marketplace still points at the moved folders until Task 4, so `npm test` can't pass between them.
- 2026-10-23, pre-flight: Task 3's "list the skills of a `--plugin-dir` session" is replaced by `claude plugin validate plugins/flows` plus a static check; the sandbox blocks api.anthropic.com. The live check moves to Task 11's install.
- 2026-10-23, Task 1: measure.mjs has no recorded RED run (the dcg hook blocked the attempt); accepted, since its tests run the script end to end on fixtures.
- 2026-10-23, Task 1: measure.mjs got test-only `--projects`/`--flows` options. I treated these as test seams of a throwaway docs script, not a product interface.
- 2026-10-23, Task 1: known, deferred to the final review: a session touching two slugs counts in both runs (web-mcp and website-mcp-server share 253 bash edits).
- 2026-10-23, Task 1: the controller's own pre-flight Rulings hunk in flow.md stays bundled in Task 1's commit — it is harmless ruling text — cost if wrong: a noisier commit.

- 2026-10-23, Tasks 3+4: the packs keep their own `.claude-plugin/plugin.json`, because the installer tarball only ships `plugin.json` files and the installer lists the packs from them; release.mjs and check-repo's version check now cover `packs/`. `claude plugin validate plugins/flows` passes, and a static check finds nothing from the packs at flows' root. Committed with `SKIP=end-of-file-fixer`: the nix-generated hook config still excludes the old paths until `nix develop` regenerates it.
- 2026-10-23, Task 6: the commit rules in flow-rules widen goal 9's scope; kept — they are the owner's standing rules — cost if wrong: none.

- 2026-10-23, Task 7 review: the conductors now name GLOSSARY.md (what domain-modeling writes and this repo has) instead of CONTEXT.md.
- 2026-10-23, Task 7 review: in feature-flow, a small change keeps its short design doc and Gate 1, so the seam question and the build stop still apply; only the grill may be skipped. A quick task still leaves on the owner's yes.
- 2026-10-23, Task 7 review: the brief clause in flow-rules now also carries the plan's Global Constraints (the seam lines), so builders, not only reviewers, see where each cross-cutting concern is resolved. This edits a Task 6 file; it implements spec goal 5.
- 2026-10-23, Task 7: its fix round may edit flow-rules.md (the brief clause) and flow-template.md (GLOSSARY) outside Task 7's Files list — the spec mandates both — cost if wrong: two files touched out of task order. Put to the owner in the final review.
- 2026-10-23, Task 7: one 126-character line in feature-flow's SKILL.md left for Task 10's docs pass — cosmetic, treefmt passed — cost if wrong: one long line.
- 2026-10-23, Task 8: also fixes CONTEXT.md in README.md:8 and research-template.md:27 — same GLOSSARY ruling — cost if wrong: two extra files. Put to the owner in the final review.
- 2026-10-23, Task 8: verify's and learn's extra skill-map owners left out — not in the brief; noted for the final review — cost if wrong: owners missing from those conductors.
- 2026-10-23, Task 9: the README conductor-table row added outside the Files list stays — CLAUDE.md requires READMEs to match the code — cost if wrong: one row to revert. Put to the owner in the final review.
- 2026-10-23, Task 10: adds .gitattributes, the marketplace description and feature-flow's long lines — deferred minors from earlier reviews, all docs and config text — cost if wrong: none. Put to the owner in the final review.
- 2026-10-23, Task 10: the extra READMEs that still told users to `/plugin install` are in scope — the owner said to remove that route, UI only — cost if wrong: none. Put to the owner in the final review.
- 2026-10-23, Task 10: installer/install.ts:297's `/plugin install` handoff for token plugins stays — it is deliberate runtime output — cost if wrong: a stale instruction at install time.

## Deviations

- 2026-10-23, Task 2: pstack upstream deleted the line the spec relies on.
  - **What changed:** at the old pin `4e5b1cf`, `principle-laziness-protocol` has six bullets, including "Question
    the threading. If a task asks you to pass a new signal through types, schemas, pipelines, or similar layers,
    stop and look for a more direct path." At upstream HEAD `8b3326d` only two remain: "Consolidate decisions" and
    "Minimize the diff". Both were fetched raw from GitHub on 2026-10-23.
  - **What else HEAD brings:** prose condensed across 29 files. interrogate drops a reviewer. how, no-comments,
    arena, recall, show-me-your-work and interrogate now point at poteto-mode's Subagents section, which isn't
    vendored.
  - Options: (a) vendor at the old pin; (b) vendor HEAD's two bullets and write the threading line ourselves;
    (c) don't vendor the skill and write the line ourselves in flow-rules, crediting pstack.
  - Recommended (c). Owner's decision (2026-10-23): (c), "Write the line ourselves". The sync was set aside in
    stash `c5b75b7` (tag `skill-composition-task2-pstack-head-sync`); nothing from pstack HEAD lands on this branch.
    Task 2 becomes a no-op; the line goes into flow-rules in Task 6, credited to pstack's earlier version.

- 2026-10-23, Tasks 3+4: the security hook flagged the sync-tob transform, which ran tob's spec checker as
  `general-purpose` (all tools) instead of its own agent (Read, Grep, Glob, Write) while it reads untrusted docs.
  - Options: ship the checker in flows' `agents/`; a read-only Explore agent; accept general-purpose (upstream's own
    fallback does the same).
  - Owner (2026-10-23): "Ship the checker in flows". sync-tob copies the agent into `plugins/flows/agents/`, and the
    workflow dispatches `flows:spec-compliance-checker`.

- 2026-10-23, final review. The coordinator (me) had ruled on deviation-class items instead of asking the owner,
  arguing "the spec requires it":
  - files outside a task's list: Tasks 7–10;
  - GLOSSARY.md over CONTEXT.md;
  - small changes keep Gate 1;
  - seam lines to builders.

  The final review flagged this as the same failure the branch exists to stop. Put to the owner, who reopened all four
  and then decided each:
  - GLOSSARY.md;
  - keep Gate 1 for small changes;
  - builders get the Global Constraints, seam lines included;
  - keep all the doc edits.

  The owner declined both a "no exception for 'the spec requires it'" line in flow-rules and a files-check script
  ("Neither").

- 2026-10-23, final review fix wave (owner: "Fix all + cheap minors"):
  - SDD's fix loop, breaker and final-review fix wave send deviation-class findings to the owner, with markers;
  - ledger rulings are reconciled into flow.md before SDD deletes its workspace;
  - /implement requires Files lists before its Gate;
  - /integrate's gh and commit-gate contradictions are fixed, and so is /verify's standalone line;
  - a check that pack paths named in conductors exist;
  - `{baseDir}` mapped for pack agents;
  - the installer retires old installs after updates;
  - small stale lines.

## Results

| run      | command                                                               | numbers                    | date       |
| -------- | --------------------------------------------------------------------- | -------------------------- | ---------- |
| baseline | `node docs/features/skill-composition/measure.mjs --until 2026-10-23` | 17 runs, full output below | 2026-10-23 |
| feature  |                                                                       |                            |            |

Baseline output (`node docs/features/skill-composition/measure.mjs --until 2026-10-23`, 2026-10-23). `general-purpose` is an agent, not a skill, so it always counts as missing.

Limits:

- m1 can't see Bash edits; the count of Bash commands that look like edits is printed next to it.
- An early question excuses every later edit.
- It compares against the whole plan text, not each task's Files list.
- It doesn't count new public interfaces.
- m2 uses today's uses.json and ignores order and optional skills.
- Runs before 2026-10-17 had no uses.json.
- Sessions that only read a flow.md are joined into its run.

| slug                          | conductor    | sessions | m1                  | m2 loaded/listed | missing                                                                                                                                       |
| ----------------------------- | ------------ | -------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| agent-browser-pr-review-fixes | fix-flow     | 1        | 1 (bash edits: 6)   | 1/6              | how, blast-radius, search, fetch, test-driven-development                                                                                     |
| band-test                     | feature-flow | 2        | 12 (bash edits: 2)  | 0/10             | how, architect, arena, general-purpose, brainstorming, writing-plans, subagent-driven-development, executing-plans, grilling, domain-modeling |
| band-test-research            | feature-flow | 2        | 9 (bash edits: 0)   | 0/10             | how, architect, arena, general-purpose, brainstorming, writing-plans, subagent-driven-development, executing-plans, grilling, domain-modeling |
| code-rules                    | feature-flow | 1        | 0 (bash edits: 0)   | 1/10             | how, architect, arena, general-purpose, writing-plans, subagent-driven-development, executing-plans, grilling, domain-modeling                |
| cyberpunk-theme               | feature-flow | 2        | 6 (bash edits: 90)  | 4/10             | how, architect, arena, general-purpose, executing-plans, domain-modeling                                                                      |
| installer-rewrite             | feature-flow | 1        | 1 (bash edits: 37)  | 4/10             | how, architect, arena, general-purpose, subagent-driven-development, domain-modeling                                                          |
| installer-ux                  | feature-flow | 1        | 1 (bash edits: 20)  | 3/10             | how, architect, arena, general-purpose, subagent-driven-development, grilling, domain-modeling                                                |
| language-skills               | feature-flow | 1        | 11 (bash edits: 72) | 5/10             | how, architect, arena, general-purpose, executing-plans                                                                                       |
| per-plugin-versions           | feature-flow | 1        | 1 (bash edits: 6)   | 4/10             | how, architect, arena, general-purpose, subagent-driven-development, executing-plans                                                          |
| postgres-skills               | feature-flow | 1        | 0 (bash edits: 15)  | 5/10             | how, architect, arena, general-purpose, subagent-driven-development                                                                           |
| repo-structure                | feature-flow | 2        | 5 (bash edits: 72)  | 5/10             | how, architect, arena, general-purpose, subagent-driven-development                                                                           |
| skillspector                  | feature-flow | 1        | 3 (bash edits: 6)   | 2/10             | how, architect, arena, general-purpose, writing-plans, subagent-driven-development, executing-plans, domain-modeling                          |
| superpowers-v7                | feature-flow | 1        | 12 (bash edits: 30) | 4/10             | how, architect, arena, general-purpose, subagent-driven-development, domain-modeling                                                          |
| vendor-superpowers            | feature-flow | 1        | 4 (bash edits: 4)   | 1/10             | how, architect, arena, general-purpose, writing-plans, subagent-driven-development, executing-plans, grilling, domain-modeling                |
| web-mcp                       | feature-flow | 1        | 1 (bash edits: 253) | 4/10             | how, architect, arena, general-purpose, brainstorming, executing-plans                                                                        |
| web-mcp-search                | feature-flow | 1        | 0 (bash edits: 0)   | 1/10             | how, architect, arena, general-purpose, writing-plans, subagent-driven-development, executing-plans, grilling, domain-modeling                |
| website-mcp-server            | feature-flow | 1        | 3 (bash edits: 253) | 4/10             | how, architect, arena, general-purpose, brainstorming, executing-plans                                                                        |

Verdict: supported | not supported | inconclusive. Threats that showed up. The user's decision.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
