# Spec: skill composition

State and history: [flow.md](flow.md) (the owner's words, every decision with its date, evidence E1–E10).
Supporting: [grounding.md](grounding.md) (today's duplicates, conflicts, sharp edges, usage) and
[skill-map.md](skill-map.md) (per-flow map of which pack item owns each step; unverified by a second reader).

## Intent

This marketplace exists to combine skills from established packs (superpowers, ponytail, Matt Pocock's, pstack, Trail
of Bits, Anthropic's) into the owner's way of working. Today the combining doesn't hold: packs fire on their own,
overlap, contradict each other, and decide for the owner mid-build. The case that started this: a .NET API build run
through `/feature-flow` or `/implement`. Per-customer database routing got threaded through every class instead of
being resolved once at the edge, and nobody asked the owner.

The owner's model, in their words: the flows "are the conductors that activate these skills - i dont want to be the one
that activates them and I dont want that claude adds them to their context". Gates exist so the owner catches the
model's errors and assumptions before code exists, and that must hold during the build too.

## Goals

Success, as the owner picked it: **the right skill at the right moment**, **assumptions reach me**, **clean by
default** (inside conductor work).

1. **Only conductors activate leaf skills.** Nothing a pack ships is listed or fires on its own.
   - **Packs inside flows, not installed** (Gate 1 reopened 2026-10-23 by the plan review; this replaces the
     installer copy into flows' data directory): superpowers, ponytail, mattpocock-picks, pstack-picks, tob-picks and
     paper-lookup stay synced, one folder per pack, unchanged except for the existing transforms. Their sync scripts
     now write to `plugins/flows/packs/<pack>/`. They are no longer installed as plugins. They ship with flows, so
     they are always at flows' version and the installer copies nothing. Claude Code only scans a plugin's `skills/`,
     `agents/` and `hooks/hooks.json`, so nothing under `packs/` lists or fires. Conductors read packs by path from
     `${CLAUDE_PLUGIN_ROOT}/packs`, which each conductor's SKILL.md states.
   - **Their hooks never run:** superpowers' bootstrap, ponytail's SessionStart, SubagentStart and UserPromptSubmit
     hooks, and ponytail's band.
   - **Still installed:** packs that bring tools: web-mcp, tui-review, graphify, self-review, csharp-skills,
     rust-skills, postgres, hallmark, the MCP plugins, and the official plugins except code-review.
   - **Packs are libraries.** Each conductor picks the skills its steps need. A skill no run has used yet is not a
     removal candidate on that count.
   - **Process vs domain** (owner, 2026-10-23, builder check): the rule covers process skills: how to work (brainstorm,
     plan, TDD, review, style). Domain skills Claude may pick on its own stay as they are: how to write good C#, Rust,
     SQL or web UI (csharp routers, rust-skills, postgres, hallmark, graphify), and claude-security, claude-md-improver,
     skill-creator. security-guidance's hooks stay too.
2. **Outside a conductor, Claude runs plain.** No ponytail, no superpowers bootstrap. dead-skills drops its
   `superpowers` and `ponytail` dependencies. rules.md stays.
3. **ponytail is applied by the conductors at chosen steps** (skill-map.md, finding 4):
   - `before-you-write` in Plan and every builder brief;
   - `smallest-complete-change`, `bug-fix-rule` and `never-cut` in builder briefs and fixes;
   - the `lite` smallest option as one option at brainstorm and report gates;
   - `ponytail-review` as the plan review's Simpler angle and in /harden;
   - `ponytail-debt` over the branch's added lines at Finish;
   - the footer as the "Not checked" line of reports.

   Inside build flows TDD beats ponytail's no-test-for-trivial rule.

4. **The build stops and asks on a deviation** (agreed 2026-10-22). The approved plan is the contract.
   - **What is a deviation:** a new or changed public interface, a new library or outside call, a changed data flow or
     error handling, or files the task didn't list. These stop the build and go to the owner.
   - **What isn't:** private names and small cleanups inside the task's files. The build goes on and records them.
   - **Where it is enforced:**
     - in every builder and task-review brief;
     - in the coordinating session, as a fifth stop next to SDD's four. It is written in the conductor's own text,
       overriding "Continuous execution" and "Rulings, not stalls" for deviation-class decisions;
     - by a mechanical check of each task's changed files against its Files list.
   - It applies to every build flow: feature-flow, research-flow, implement, fix-flow, upgrade, and harden's fixes.
   - **Rulings** section in flow.md: written as each call is made.
   - **Decisions** row in /verify's verdict: every ruling, deviation and new `shortcut:` comment. The owner confirms or
     reopens each before the branch is approved.
5. **Seams are decided before the build.**
   - feature-flow and research-flow ask, for each cross-cutting concern the feature adds, where it is resolved and which
     modules never see it. Sources: `codebase-design`, `principle-boundary-discipline` and
     `principle-redesign-from-first-principles`, at Brainstorm and Grill.
   - The answer goes verbatim into the plan's Global Constraints, so builders and reviewers get it.
   - implement asks the same in Read when its input doesn't say.
   - pstack's `principle-laziness-protocol` is added to pstack-picks. Its "a new signal through types, schemas or
     pipelines: stop, find a more direct path" goes into every builder brief.
6. **Stack packs by detection.** One flow-rules rule maps repo files to pack skills: `*.csproj` → csharp-skills,
   `Cargo.toml` → rust-skills, SQL migrations → postgres, a web frontend → hallmark. The matching skills go into the plan,
   builder and review briefs.
7. **Each flow uses the step owners in skill-map.md.** That includes the pieces no conductor uses today: pstack `why`,
   `blast-radius`, `codebase-design`, the boundary principles, tob's checkers, and the language packs. A placed pack's
   agents run as `general-purpose` with the agent file's text as the prompt.
8. **Duplicates resolved:**
   - code-review@official leaves dead-skills (self-review's bug pass does the same job).
   - /verify runs the suite once and reuses the result.
   - pr-test-analyzer runs once; its report feeds test-audit.
   - Specs and plans live only in `docs/features/<slug>/`. The conductors override brainstorming's and writing-plans'
     paths and commits.
   - writing-skills owns skill writing; skill-creator is used only for its eval tooling.
9. **New pieces:**
   - `/integrate` in flows:
     - commits under the owner's rules (one-sentence messages, no co-author lines, `git add -u`);
     - writes the PR body;
     - hands over `git push` and `gh` as `!` lines, because the sandbox blocks them;
     - watches CI and stops on red with the cause and options. It never auto-pushes.
   - A vendor-a-pack checklist in this repo's docs.
   - /self-review offers /fix-flow for findings that need a cause.
10. **Drift guard:** every place a conductor overrides a pack quotes the sentence it overrides. check-repo fails, the
    sync PR included, when that sentence is gone or changed. No model runs.
11. **Docs:**
    - The `/plugin install` route leaves the README; installing is through the installer UI only.
    - CLAUDE.md, the READMEs and THIRD_PARTY.md describe the placed packs.

## Non-goals

- Per-plugin versions for stale installs (ADR 0003, later). The six packs are out of that problem: they leave the
  marketplace, so the installer retires the old ponytail 5.2.0 and superpowers 7.0.0 installs.
- ponytail's band (the owner has a later idea for it).
- `claude plugin eval` suites, as the measure or in CI.
- Rewriting vendored skill text. Overrides live in conductor text and flow-rules.
- Token cost as a goal.

## Anti-goals

- **"They dont work together as a whole."** Each piece passing on its own isn't success. Judge whole conductor runs,
  and keep the composition intact when upstream packs change.
- **Settings to tune:** no env vars, toggles or per-machine options. It works the same on every machine.
- **A build that rules and carries on** for a decision the plan didn't make.

## Constraints

- Vendored folders are overwritten on every sync (CLAUDE.md "Vendored content"). Changes go into sync transforms or
  conductor text.
- The flows plugin's `dependencies` come from `uses.json` (`scripts/flows-uses.mjs`). Placed packs leave
  `dependencies` but stay listed in `uses.json`, and check-repo still fails when a listed skill is gone.
- The installer is Node stdlib only, and new logic goes into `core/` or `system/` with a test (CLAUDE.md).
- The marketplace removes a plugin by unlisting it; the installer then uninstalls it. Placed packs leave
  `marketplace.json`, and existing installs are retired.
- Only the main session can ask the owner or start a workflow. Every stop passes through the coordinating session.

## Left to the builder

- Whether the packs keep their own `.claude-plugin/plugin.json` under `packs/`.
- The quote check's format (the plan picks inline markers).
- The mechanical changed-files check: a script the coordinator runs per task, or text the reviewer applies.
- The order of work across the 11 conductors. It is all one branch (owner, 2026-10-23); the owner's trial runs come
  after it.
- Pack skills are reachable only through conductors; typing `/grilling` or `/how` by hand goes away (owner,
  2026-10-23).

## Hypothesis

- **Claim:** the conductors are recomposed as above. In the owner's own conductor runs on real work, decisions outside
  the plan then reach the owner before they are built. Each step loads the skill its conductor names, and the owner
  judges the run as working as a whole.
- **Evidence:**
  - E4: a duplicate silently replaces the intended skill in 19.9 pp of runs, and models disclose the swap in 0.9%. So
    skill use is read from transcripts, not from Claude's account.
  - E3 and E8: extra listed skills lower loading; explicit selection lifts the share of skills loaded from 53% to 73%.
  - E1: review works with outside feedback, which here is the changed-files check.
  - E9 and E10 against: most skills add little, and scaffolding gains shrink with stronger models. So the claim is
    about skill use and decisions reaching the owner, not pass rate.
- **Metric and method:**
  - The owner runs the flows (owner, 2026-10-22: "I will run the flows!"). A transcript script reads each conductor run
    on this machine (`~/.claude/projects/**`) and reports three numbers:
    - **m1, unasked deviations:** build-phase edits to files outside the task's Files list, or new public interfaces,
      with no stop to the owner before them.
    - **m2, step-skill share:** the share of conductor steps whose named skill file was read, or its Skill call made,
      before the step's first action. Each version is measured against its own `uses.json` and SKILL.md.
    - **m3, the owner's verdict** per run, recorded in flow.md at Finish: worked as a whole, yes or no, and clean, yes
      or no.
  - Sessions are grouped into runs by the flow.md they resume.
- **Baseline:** the same script over the conductor sessions already on this machine, before any change. That is 23
  sessions from 2026-10-11 to 2026-10-22, all on this repo. m3 has no baseline. The owner's .NET case is the
  qualitative reference.
- **Threshold** (owner, 2026-10-23: "I will decide that must feel right cant just meassure it"): **supported when the
  owner judges, after their own runs, that the flows work as a whole.** No number is set in advance. m1 and m2, before
  and after, are reported next to the owner's verdict as input to it, not as a bar. When the owner judges it hasn't
  worked, that is "not supported"; when the runs were too few or too different to judge, "inconclusive". The owner
  decides how many runs that takes. The owner chose to stay in research-flow on these terms over switching to
  /feature-flow.
- **Threats to validity:**
  - The tasks differ before and after.
  - The baseline is all on this repo, not product code.
  - The owner isn't blind to the change.
  - n = 5.
  - Model updates during the period (E10).
  - The baseline's conductors were older versions.
  - ponytail and superpowers on this machine are old installs (non-goal above). The new layout doesn't use them, but a
    run that loads them anyway is a confounder to check for in the transcript.
  - m1 depends on a Files list, which old plans may not have had; there it counts only new public interfaces.
