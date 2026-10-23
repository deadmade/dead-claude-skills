# Skill composition: grounding

From the Phase 1 workflow, 2026-10-22: six read-only readers (superpowers, ponytail, flows, the picks, the
official and built-in layer, usage in this repo's transcripts), a skeptic per reader (105 claims confirmed, 29 partly
true, 2 refuted and dropped), a synthesis and a completeness critic. `M/<id>:N` = a transcript line under
`~/.claude/projects/-home-deadmade-dead-claude-skills/`.

Copies: flows, self-review and picks from the repo (= installed 0.5.0); superpowers lines from installed 7.0.0 unless marked v7.0.1 (vendored, uncommitted); ponytail from the repo, matching installed 5.2.0 on cited lines. `plugin/skill:N` = that plugin's skills/<skill>/SKILL.md; `FR` = plugins/flows/references/flow-rules.md; `M/<id>:N` = transcript line under ~/.claude/projects/-home-deadmade-dead-claude-skills/. Tokens = chars/4. Refuted claims dropped, skeptic corrections applied.

## 1. Inventory by job

| Job                              | Who does it                                                                                                                                                                                       | Verdict                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Design, brainstorming            | superpowers:brainstorming (flows/feature-flow:61); feature-flow's grounding and Options (:48-67); pstack-picks:architect, arena (:108)                                                            | duplicated; v7.0.1 brainstorming also grounds and proposes approaches (:38-45,139-148) |
| Grilling, spec                   | mattpocock-picks:grilling, domain-modeling (flows/feature-flow:82); brainstorming's builder check (:160-177); grill-me, grill-with-docs are one-line aliases (:7)                                 | duplicated                                                                             |
| Planning                         | superpowers:writing-plans (flows/feature-flow:97); native plan mode; mattpocock-picks:to-tickets (flows/implement:41)                                                                             | conflicting: plan mode stood in for Gate 1 (M/7681c1b5:339)                            |
| Plan review                      | feature-flow references/plan-review.md:9-37; writing-plans self-review (:163-177); SDD preflight (:162-182)                                                                                       | duplicated                                                                             |
| Execution                        | superpowers:subagent-driven-development, executing-plans (flows/feature-flow:116)                                                                                                                 | one owner, conflicting rules (§3)                                                      |
| TDD                              | superpowers:test-driven-development (flows/fix-flow:53); ponytail/ponytail:41                                                                                                                     | conflicting                                                                            |
| Debugging                        | superpowers:systematic-debugging (flows/fix-flow:47); fix-flow:30-43 repeats its first steps (:58-68)                                                                                             | duplicated                                                                             |
| Code review                      | self-review:self-review (flows/verify:38), SDD final review, ponytail:ponytail-review, code-review:code-review, bundled code-review, superpowers:requesting-code-review, pstack-picks:interrogate | duplicated                                                                             |
| Verification, finishing          | flows:verify → superpowers:verification-before-completion, finishing-a-development-branch (flows/verify:31,71); bundled /verify, /run                                                             | duplicated, conflicting                                                                |
| Simplify, bloat                  | ponytail rules; ponytail-review/audit as /harden "Bloat" (flows/harden:26-27); built-in simplify (FR:68); self-review code-simplifier (self-review/self-review:101); pstack-picks:no-comments     | conflicting                                                                            |
| Security                         | security-guidance hooks; built-in security-review (self-review/self-review:67-68); claude-security:claude-security, tob-picks:sharp-edges (flows/harden:23-25)                                    | duplicated                                                                             |
| Docs                             | flows:doc-audit → tob-picks:spec-to-code-compliance, pstack technical-writing, unslop (flows/doc-audit:39-68)                                                                                     | one owner, never run                                                                   |
| CLAUDE.md upkeep                 | rules.md:3 → revise-claude-md; flows/learn:38; claude-md-improver (flows/doc-audit:51, self-review/self-review:69-72); /init                                                                      | duplicated                                                                             |
| Test quality                     | flows:test-audit (tob mutation/property, self-review:pr-test-analyzer); same agent in /self-review (flows/verify:49-51)                                                                           | duplicated                                                                             |
| Research, web                    | flows:research-flow (web-mcp search, paper-lookup: research-flow references/literature.md:14-15); bundled /deep-research; context7                                                                | duplicated                                                                             |
| Learning, memory                 | flows:learn, pstack-picks:recall (flows/learn:24), mattpocock-picks:handoff, auto memory                                                                                                          | conflicting: recall skips the current chat (pstack-picks/recall:21)                    |
| Understanding code               | flows:understand; pstack-picks:how; graphify:graphify; ponytail's map; Explore (FR:58,62)                                                                                                         | duplicated                                                                             |
| Skill authoring                  | superpowers:writing-skills, skill-creator:skill-creator, `claude plugin eval`                                                                                                                     | conflicting (§3); no conductor uses one                                                |
| Git, worktrees                   | superpowers:using-git-worktrees (via SDD); EnterWorktree; feature-flow resume (:34-40)                                                                                                            | conflicting (§3)                                                                       |
| Parallel agents                  | superpowers:dispatching-parallel-agents; inline fan-outs (flows/harden:21); Workflow tool                                                                                                         | duplicated; skill and Workflow unused                                                  |
| Dependency upgrade               | flows:upgrade, one package (flows/upgrade:18)                                                                                                                                                     | one owner, never run                                                                   |
| Integrate: push, PR, CI, release | finishing only (§5)                                                                                                                                                                               | missing                                                                                |
| Vendoring upstream packs         | none (§5)                                                                                                                                                                                         | missing                                                                                |
| Tickets                          | mattpocock-picks:to-tickets, to-spec (to-tickets:11)                                                                                                                                              | one owner, unconfigured                                                                |
| Decision record                  | flow.md Deviations (FR:29-32), SDD ledger, pstack-picks:show-me-your-work, ponytail:ponytail-debt                                                                                                 | duplicated, unconnected                                                                |

## 2. Always-on context

| Source                                                                                          | Event                                | Reaches                                    | ~Tokens       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------- |
| superpowers session-start: using-superpowers in `<EXTREMELY_IMPORTANT>` (M/baa58561:8)          | SessionStart startup, clear, compact | main                                       | 850           |
| ponytail-activate.js: rules 2,859 chars + map ~2,090 (M/baa58561:7)                             | SessionStart, incl. resume           | main                                       | 1,240         |
| plugins/default/rules.md (M/baa58561:6)                                                         | SessionStart                         | main                                       | 75            |
| Skill listing: 58 entries, 19,930 chars, no dmi skill (M/baa58561:18)                           | start                                | main                                       | 5,000         |
| Agent listing: 23 types, 17 from plugins (M/107308f4)                                           | start                                | main                                       | 1,800         |
| CLAUDE.md, 14,724 chars (M/baa58561:22)                                                         | start                                | main, most subagents                       | 3,700         |
| Harness commit attribution (M/baa58561:26)                                                      | start                                | main                                       | 60            |
| ponytail-subagent.js, no matcher (claude-codex-hooks.json:16-27)                                | SubagentStart                        | 319 of 326 agent transcripts               | 715           |
| ponytail, security-guidance                                                                     | UserPromptSubmit                     | nothing on ordinary prompts                | 0             |
| security-guidance pattern warning, once per file and rule (security_reminder_hook.py:2405-2421) | PostToolUse edit                     | main                                       | ≤400          |
| security-guidance findings, high/critical (hooks.json:97-122)                                   | Stop, SubagentStop, commit           | main (rewake)                              | ~300 if fired |
| graphify hook-guard                                                                             | PreToolUse                           | only with graphify-out/graph.json (absent) | 0             |

Totals: ~12.7k tokens per session (hooks 2.2k, listings 6.8k, CLAUDE.md 3.7k); ~715 per subagent from hooks; ~0 per prompt plus event-driven security-guidance text, which `claude plugin details` counts as ~0.

Listing budget (2.1.307 binary `zut()`/`Bh()`; skills doc): 1% of the context window at 3 chars/token for claude-opus-5-5, i.e. 30,000 chars at 1M, 66% used. At 200K it is 6,000, below the ~9,474 bundled entries keep, so every plugin skill would show as a bare name; `skillOverrides` can't trim plugin skills.

## 3. Duplicates and conflicts

Conflict = same job, contradictory instructions.

| Overlap                                              | Kind                      | Lines                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| code-review:code-review vs self-review's bug pass    | true duplicate            | only a provenance comment differs (`diff`); scripts/sync-self-review.mjs:1-3 vendors it to avoid the plugin, yet plugins/default/.claude-plugin/plugin.json:11 still installs it                      |
| SDD final review, /verify's self-review, interrogate | same job, different depth | superpowers/subagent-driven-development:445-469; flows/verify:38-40; self-review references/synthesis.md:3 restates pstack-picks/interrogate:72                                                       |
| Suite run three times                                | true duplicate            | flows/verify:31-34,55; self-review/self-review:100; superpowers/finishing-a-development-branch:14-26                                                                                                  |
| pr-test-analyzer twice                               | true duplicate            | self-review/self-review:75; flows/test-audit:48-50                                                                                                                                                    |
| writing-skills vs skill-creator                      | duplicate, opposite rules | superpowers/writing-skills:99 "ONLY when to use" vs skill-creator/skill-creator:67 "both what … AND … when"                                                                                           |
| "Fix the root cause once"                            | duplicate                 | ponytail/ponytail:38; flows/fix-flow:54-55; superpowers/systematic-debugging:168-189                                                                                                                  |
| Plan deviations                                      | conflict                  | "stop … let the user decide" (FR:29-32, flows/feature-flow:119-122) vs "Rulings, not stalls" (superpowers/subagent-driven-development:17-31, executing-plans:27-43); FR:21-23 overrides only handoffs |
| Finishing menu                                       | conflict                  | flows/verify:71-73 offers discard; superpowers/finishing-a-development-branch:55-82,132-135: exactly three options, discard only on explicit request                                                  |
| Commits                                              | conflict                  | FR:34 vs superpowers/brainstorming:156-158 ("committed"), writing-plans:132-137; rules.md:1-2 "never add co-author lines" vs the harness's Co-Authored-By (M/baa58561:26)                             |
| Spec and plan home                                   | conflict                  | superpowers/brainstorming:157, writing-plans:16 (docs/superpowers/) vs flows/feature-flow:27 (docs/features/<slug>/)                                                                                  |
| Vague requests, tests                                | conflict                  | ponytail/ponytail:27,41 vs superpowers/using-superpowers:30, brainstorming v7.0.1:247-253, test-driven-development:24-29,330                                                                          |
| Reply endings, `shortcut:`                           | conflict                  | ponytail/ponytail:15,42 vs SDD task-reviewer-prompt.md:66-71,140-143 and pstack-picks agents/comment-sicko.md:14-30                                                                                   |
| doc-audit vs spec-to-code-compliance                 | conflict                  | flows/doc-audit:39-47 checks inline; tob-picks/spec-to-code-compliance:32-34 "Do not check requirements in this context"                                                                              |
| EnterWorktree on resume                              | conflict                  | flows/feature-flow:37, research-flow:48 vs the tool's "ONLY when explicitly instructed"                                                                                                               |
| Bare /verify, /upgrade                               | name clash                | built-in /verify runs the app, /upgrade opens the plan page (commands doc); a plugin's bare name yields to an existing command (skills doc)                                                           |

## 4. Sharp edges (by impact)

1. **Conductors run only when typed.** All 11 are dmi (flows/*/SKILL.md:4), absent from the listing, named only in CLAUDE.md:52; the router sends "build X" and "fix this bug" to superpowers (superpowers/using-superpowers:20-31). Six never ran (§7).
2. **Installs keep upstream copies.** Installed ponytail 5.2.0, superpowers 7.0.0, web-mcp 0.4.0 (installed_plugins.json) vs vendored 0.5.0 (plugins/shared/ponytail/.claude-plugin/plugin.json:3); `outdated()` never downgrades (installer/core/plugins.ts:107-116); ADR 0003 (docs/adr/0003-per-plugin-versions.md:17-18) is unimplemented. The band mod never loads, contrary to README.md:9.
3. **Execution decides for the user.** The web-mcp SDD ledger has 30 "Ruling:" lines, some design-level (.superpowers/sdd/plan/progress.md:127-134,161), against one Deviation (docs/features/web-mcp/flow.md:223-238). With no Rulings slot (flow-template.md:10-60), four runs copied some by hand, click-to-read didn't (docs/features/click-to-read/flow.md:138-139). The controller also fixed findings itself (progress.md:139,153,158,165) against superpowers/subagent-driven-development:408-409.
4. **Reading dmi skills by path fights the harness**, whose refusal says "Do not replicate this skill's workflow by other means" (2.1.307 binary) against FR:40-46. `${CLAUDE_SKILL_DIR}` stays literal in a file read by path (self-review/self-review:87), and the FR:44 glob matches 6–7 cached versions, some different.
5. **CONTEXT.md vs GLOSSARY.md.** Conductors name CONTEXT.md (flows/feature-flow:53,86, learn:39, understand:51); domain-modeling writes GLOSSARY.md (mattpocock-picks/domain-modeling:3,40,62), the only one in the repo.
6. **Worktrees.** Native ones branch from origin's default branch (`worktree.baseRef` "fresh", unset), so uncommitted or unpushed spec, plan and flow.md are missing (docs/features/skill-composition/flow.md:36-37). finishing removes only .worktrees/ (superpowers/finishing-a-development-branch:169-201), leaving ≥4 merged worktrees, and its Option 1 merges in the shared main checkout (:88-100); a repro aborted on a dirty file.
7. **Ponytail everywhere.** Its persona and footer reach every agent type, reviewers included (§2); resume and /clear reset its level (ponytail-activate.js:192); one level per repo (ponytail-runtime.js:49-50); vendored hooks exit 1 from the checkout (package.json:6 `"type": "module"`), untested.
8. **Sandbox vs integration.** Push, gh and worktree removal fail (M/498cd524:2707,2779); ~64 replies hand the user a `!` command; /verify has no rule for blocked checks (flows/verify:15,31-34).
9. **Commits.** FR:34's "with the user's agreement" is undefined; rules.md reaches SDD implementers only via a plan's Global Constraint (docs/features/web-mcp/plan.md:47).
10. **Sub-skills outrun conductor assumptions.** feature-flow's Size override (:68-70) fits 7.0.0, not v7.0.1, which writes a doc for small changes (brainstorming v7.0.1:188-196); systematic-debugging's Phase 4 writes the fix before fix-flow's gate (:168-189; flows/fix-flow:47-49), plausible but unobserved.
11. **Work past the gates.** pstack architect implements without a checkpoint by default (pstack-picks/architect:45-49), offered before Gate 2 (flows/feature-flow:108); spec-compliance writes spec-compliance/ (workflows/spec-compliance.js:17,525) and teach writes MISSION.md, lessons/ into cwd (mattpocock-picks/teach:12-20), though flows/understand:19 promises no state.
12. **/harden.** claude-security needs AskUserQuestion and Workflow, which subagents lack (sub-agents doc), with no declined-scan fallback (FR:66); "Bloat" passes are full reviews (ponytail/ponytail-review:12); the /simplify fallback edits code (FR:68).
13. **Stale state misleads.** Four flow.md are open; self-review takes the first as the spec (self-review/self-review:47-49); "newest copy" resume can enter another session's worktree (flows/feature-flow:34-40).
14. **/learn → revise-claude-md** re-drafts, re-gates (claude-md-management commands/revise-claude-md.md:6-54) and writes `.claude.local.md`, which Claude Code never loads (:20,25; memory doc).
15. **Weak guards.** A prior-art agent's false fact reached the user (M/baa58561:207,239); pstack names nine skipped principles (e.g. pstack-picks/architect:37,51,63,80); scripts/flows-uses.mjs:65 matches substrings; /implement accepts plans SDD's task-brief can't parse (subagent-driven-development/scripts/task-brief:30-41).

## 5. Gaps

- **Integrate loop** (commit, push, PR, CI, conflicts, release): 57 such prompts in 39 sessions, 5 release requests (M/6f671f70:506).
- **Vendoring an upstream pack**, the repo's core job: ad hoc each time (M/06727504:10, M/8d1e6945:10); five feature-flow runs re-derived the touch points (docs/features/language-skills/flow.md:34-39).
- **Sync-PR review:** via /self-review, skipping its passes (M/125089c6:126).
- **Findings to fixes:** the user chains /self-review and /flows:fix-flow (M/3dcbb73a:11, M/b4010fae:258).
- **Flow state:** no spec/plan home (FR:8-12), Rulings slot, or Verify/Learned section in feature templates, though FR:15-16 says /verify and /learn write there; no cleanup of open runs.
- **Branching:** fix-flow and upgrade never branch (flows/fix-flow:51-55, upgrade:40-44).
- **Drift guard:** superpowers vendored without transform (scripts/sync-release.mjs:21-25); feature-flow's overrides went stale twice (docs/features/superpowers-v7/flow.md:115-118).
- **Skill evals:** nine conductors written without writing-skills or skill-creator (M/ad8ac387:513-582); only rust-skills and csharp-skills have evals.
- **Ponytail scoping and debt:** no PONYTAIL_SUBAGENT_MATCHER (ponytail-subagent.js:46-49); ponytail-debt unused over 12 `shortcut:` markers.

## 6. superpowers and ponytail

**superpowers** (15 skills, SessionStart router). Flows use eight (uses.json): brainstorming, writing-plans, subagent-driven-development, executing-plans, test-driven-development, systematic-debugging, verification-before-completion, finishing; using-git-worktrees and requesting-code-review only inside SDD. Unused: receiving-code-review, dispatching-parallel-agents, writing-skills, diagnosing-superpowers. Re-implemented: grounding and options (flows/feature-flow:48-67), plan review, parallel dispatch, findings triage (FR:83-93). Fights: §3's deviation, menu, commit and spec-home rows; the router bypasses conductors; dropping out of feature-flow leaves work unconducted (docs/features/vendor-superpowers/flow.md:26-27).

**ponytail** (rules for session and subagents, map, levels, review, audit, debt, gain, help, band; installed: upstream 5.2.0, §4.2). Flows use review and audit in /harden only, never run; they ignore levels, debt, band and matcher. Re-implemented: plan-review.md:17 and flows/fix-flow:54-55 restate ponytail/ponytail:25-32,38. Fights: its smallest-version and no-test-for-trivial rules (ponytail/ponytail:27,41) vs brainstorming and TDD (winner untested); footer and `shortcut:` vs SDD reviewers; the map points reuse at vendored folders CLAUDE.md forbids editing (ponytail-map.js:102).

## 7. Usage

| Measure                                             | Count                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conductors typed since flows installed (2026-10-17) | feature-flow 4, research-flow 2 (one sent by the band, M/eba0aae4:12), fix-flow 2; verify, learn only read inside fix-flow (M/3dcbb73a:227); six others 0                                         |
| Older /feature-flow:feature-flow; /self-review      | 14; 9                                                                                                                                                                                             |
| Feature runs reaching the end                       | finishing 6 of 8, verification 2 of 8; no flows-0.5.0 feature run passed Gate 2                                                                                                                   |
| superpowers Skill calls                             | 55, 52 in conductor runs: brainstorming 15, writing-plans 11, finishing 7, executing-plans 6, TDD 5, SDD 4, worktrees 4, verification 2, debugging 1                                              |
| Router alone                                        | 3 of 89 non-conductor sessions invoked superpowers; 1 of 22 plan-mode ones brainstormed                                                                                                           |
| Other picks                                         | grilling 10, domain-modeling 6, paper-lookup 3, ponytail-review 1, ponytail-audit 1, mutation-testing 1; pstack by path 8; never: 11 mattpocock, 15 pstack, 3 tob skills, graphify, skill-creator |
| Gate answers                                        | 41 of 52 took "(Recommended)"                                                                                                                                                                     |
| Typed by hand                                       | `! git push` 33 (22 sessions), `! gh` 20                                                                                                                                                          |
| flow.md                                             | 19: 15 done, 4 open; no docs/audits/                                                                                                                                                              |

Counts are deduped by tool_use id over the project's and worktrees' transcripts. They show superpowers running as a library under typed conductors, not via its router; plan mode standing in elsewhere; review going through typed /self-review; integration done by hand; gates mostly ratifying recommendations. No transcripts cover 2026-10-18 02:00 to 10-21 17:20, when c2032c1 landed.

## 8. Open questions for the owner

1. Should plain requests reach conductors, or stay typed-only with raw superpowers as default?
2. During execution, who rules on deviations, the user or SDD, and must rulings reach flow.md?
3. Who commits specs, plans and task work, with which trailer?
4. Specs and plans: docs/features/<slug>/ or docs/superpowers/?
5. Worktrees: when, from which base, who removes them; do fix-flow and upgrade branch?
6. Ponytail: in subagents? the map? levels per phase? precedence over TDD and brainstorming?
7. Which single review path does /verify keep; does code-review@claude-plugins-official stay?
8. Versions: upstream numbers (ADR 0003), a forced downgrade, or url sources again?
9. Which never-used picks stay?
10. Rename /verify and /upgrade, or document the /flows: prefix?
11. How many question rounds and gates, given 41 of 52 accepted recommendations?
12. Which missing flows to build, and which stay manual under the sandbox?
13. Keep security-guidance's turn-end reviews in a shared checkout (its README:58 advises against)?

Unverified: which instruction wins in each conflict; whether self-review's agents auto-delegate; why web-mcp 0.5.0 was orphaned; Windows without Git Bash (superpowers' run-hook.cmd exits silently); the user's own herdr SessionStart hook size.

## Completeness critic

- **The usage numbers cover only work on the marketplace itself.** §7 counts only this repo's transcripts. The owner's failing case (a .NET API with customer-split databases, "every class touched for routing instead of the edge", docs/features/skill-composition/flow.md:27) is in no transcript on this machine: grepping `DbContext|customer split|tenant` outside the current session finds nothing. The 9 other project folders show 0 conductor commands and 0 marketplace Skill calls (only `dataviz` and `update-config`). Nobody has seen how conductors behave on product code.

- **The report re-asks decisions the owner already made.** skill-composition/flow.md:38 says only conductors activate leaf skills (not the user, not Claude picking from the listing). :51 says ponytail's always-on hooks go. :57 says no env vars or toggles, and ponytail stays synced but is not installed. §8 Q1 and Q6 ask these again. §5's "no PONYTAIL_SUBAGENT_MATCHER" gap proposes the kind of toggle :57 rules out.

- **No conductor uses the language and boundary skills.**
  - `grep -rliE 'csharp|rust-skills|postgres|hallmark' plugins/flows` finds 0 files.
  - No build conductor names codebase-design, principle-boundary-discipline or "boundary" (0 hits). Only /harden reaches codebase-design, through improve-codebase-architecture.
  - csharp-skills and postgres are not installed here (absent from `enabledPlugins`), so how they work with the conductors is untested.
  - §1 has no row for language guidance or boundaries.

- **Components missing from the §1 inventory:**
  - **plugin-authoring** (bundled, for mods and hooks): 8 Skill calls between 10-11 and 10-15, the 4th most used skill.
  - **tui-review**: it is /verify Phase 6 (flows/verify:19,55-57). `/tui-review` ran 15 times in 6 sessions, all on 2026-10-10.
  - **pstack-picks**: blast-radius (in fix-flow's and upgrade's uses.json), why, bro.
  - **mattpocock-picks**: wait-what, to-questionnaire, improve-codebase-architecture, and setup-matt-pocock-skills, which to-tickets:11 depends on.
  - **tob-picks:spec-compliance**: a workflow, not a skill; spec-to-code-compliance:32-34 always hands off to it.
  - **claude-automation-recommender**: installed by dead-skills plugin.json:12, 0 calls.
  - **Browser automation twice**: bundled claude-in-chrome and web-mcp's `browser`.
  - **Opt-in MCP plugins**: mcp-github (PRs and Actions over HTTP), mcp-azure and atlassian, none installed. These matter for the Integrate and Tickets rows while the sandbox blocks `gh`.

- **Claude Code ships integration pieces the report doesn't list.** The 2.1.307 binary registers bundled `commit` and `pr` skills (`isEnabled:()=>ozr()`, missing from the M/baa58561:18 listing) and a built-in `commit-push-pr` ("Commit, push, and open a PR"). It also names built-in workflows autopilot, bugfix, dashboard, deep-research, docs and investigate (the `xvo` list); §1 has only deep-research. Unverified whether any of these are available to this user.

- **The dcg hook blocks commands too, not only the sandbox.** The user's PreToolUse hook on `Bash|PowerShell` runs dcg 0.14.4. `dcg test` reports BLOCKED for `git branch -d` and `-D` (superpowers finishing-a-development-branch:110,156), `git reset --hard` and `git clean -fd`. It also blocked my own redirect to `"$TMPDIR/…"`. The memory file sandbox-worktree-cleanup.md adds that the sandbox mounts `.git/config.lock`, so `git push -u` can't record the upstream. §4.6 and §4.8 mention neither.

- **What §2 leaves out:**
  - Context7's MCP instructions, ~640 chars (M/baa58561:17, from dead-skills `.mcp.json`).
  - Sandbox instructions, 5,078 chars (:12), and session context, 1,225 chars (:23).
  - The "CLAUDE.md 14,724 chars" figure is CLAUDE.md 13,980 plus MEMORY.md 744 (:22).
  - claude-security's 9 agents take 2,908 of the 7,141 agent-listing chars; most are internal `scan-*` agents.
  - claude-security's hooks: a scan suggestion after `git push` or `gh pr create`, a menu banner, and an auto-deny of the scan confirmation after 60 s (hooks.py:303-312).

- **Specs and plans live in three places, all in use.**
  - docs/features holds 8 spec.md and 9 plan.md.
  - docs/superpowers holds 6 specs and 4 plans, and the same features are split across both homes: click-to-read, turn-notifications, ponytail-v5, per-plugin-versions, and skillspector, whose spec is specs/2026-10-21-skill-scanner-design.md.
  - ~/.claude/plans holds 36 plan-mode files, 5 of them since 10-17, none linked from a flow.md.
  - 11 of 19 flow.md lack the `flow:` key FR:8 requires.

- **Vendored skill changes skip CI.** None of the 12 sync-*.yml files gives create-pull-request a token. sync-release.yml:29 says such PRs start no other workflow, and only that file runs check-repo (:34). The open skillspector flow (skillspector/flow.md:3, phase grill; its grounding at :35 notes nothing reads skill bodies) targets exactly the "bad skills" complaint, and the report doesn't mention it.

- **Unverified items I could settle, and corrections:**
  - **self-review agents don't auto-delegate.** All 22 dispatches of `self-review:*` agents came from sessions where /self-review or a flow was typed. code-simplifier and the tob, pstack and claude-security agents were never dispatched.
  - **The web-mcp and ponytail 0.5.0 copies were rolled back.** Both landed in the cache on 10-21 at 19:18 and got `.orphaned_at` at 19:20:06, while the other plugins moved to 0.5.0. For web-mcp that is an upgrade, so "`outdated()` never downgrades" doesn't explain it. Cause still unknown.
  - **Windows without bash:** run-hook.cmd:39-41 exits 0 when it finds no bash, so superpowers' bootstrap is silently skipped. Confirmed.
  - **herdr hook:** it only writes to a socket (line 92), so it adds 0 tokens.
  - **Workflow tool:** 5 calls, including this run (M/107308f4), so "unused" is wrong.
  - **Bundled listing entries:** 8,326 chars, not ~9,474. The 200K conclusion still holds.

- **Not checked:** the "41 of 52 accepted recommendations" gate count, the other hosts' adapters in the installed ponytail 5.2.0 (`.cursor`, `.kiro`, …), and any machine other than this one.
