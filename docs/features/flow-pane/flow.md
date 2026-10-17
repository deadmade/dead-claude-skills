---
phase: finish
---

# Flow pane: flow

## Request

> Hey, could we create a plan with feature flow to implement this flow pane (best fit). A pane or band above the
> prompt that reads docs/features/*/flow.md. It shows the current phase, which gates are approved, any deviations,
> and for research-flow the hypothesis, baseline and result. These runs last for hours and resume across sessions;
> right now the state only lives in a markdown file. One key could resume the run or open the spec.

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved: 2026-10-17 ("approved, write the plan")
- Gate 2, plan approved: 2026-10-17 ("approved, subagent-driven"; incl. round-2 fixes), execution: subagent-driven

## Skipped

## Grounding

- Mod shape used everywhere: `hooks/hooks.json` → `register.tsx`, `types/index.d.ts` for `$.state` atoms, pure logic
  in a sibling `.ts` that tests import (`cswap/hooks/cswap.ts`, `night-city/hooks/onibi.ts`).
- Panes: `$.ui.open({id,title})` + `ui.render {component:'Pane', requestId}` (`cswap/hooks/register.tsx:146-152`,
  `tui-review/hooks/register.tsx:476`). Keys are `<Button hotkey>` inside the pane (`cswap/hooks/register.tsx:187`).
  A band's hotkeys fire only once the band has focus (ctrl+x tab or a click), or a bare digit in an empty composer
  (engine types, `Button.hotkey`).
- Resume: `$.prompt.submit({text, asUser:true})` (`tui-review/hooks/register.tsx:290`) can send `/feature-flow`.
  Both skills resume without an argument and ask when several runs are open; an argument starts a new run
  (`feature-flow/SKILL.md:46-48`, `research-flow/SKILL.md:45-46`), so resuming one specific run needs a skill change.
- Files: `$.fs.list(dir)` gives entries with `mtimeMs`, `$.fs.read`, `$.fs.exists`; `$.clock.every` polls
  (`cswap/hooks/register.tsx:137`). No markdown parser in any mod; `scripts/sync-lib.mjs:33` has the frontmatter regex
  to copy.
- flow.md in practice: Gates lines carry free text after the date and can be reopened/re-approved
  (`cyberpunk-theme`, `language-skills`); unfilled Gate 2 still reads `<date>`. Deviations are numbered lists or
  `**D1 – …**` bullets. Extra sections appear. No research-flow file exists yet. Open runs today: cyberpunk-theme
  (execute), installer-rewrite, installer-ux, language-skills (finish), flow-pane (ground).
- Collision: night-city draws an `AbovePrompt` band and doesn't call `next(e)` while Onibi visits
  (`night-city/hooks/register.tsx:79-101`).
- Wiring: `plugins/feature-flow/` has no hooks yet. Mod tests run only via explicit steps in `.github/workflows/test.yml`
  (cswap, night-city); a new mod needs one. Tests fake files with `on('fs.read')`/`on('fs.list')` hooks, so flow.md
  samples can be inline strings.

## Prior art

- [Kiro specs](https://kiro.dev/docs/specs/best-practices/): per-feature markdown in the repo, an IDE task view on top,
  and a "Sync Files" button because the files drift from the UI.
- [Spec Kit](https://github.com/github/spec-kit/blob/main/spec-driven.md): one folder and one git branch per feature;
  the branch says which run is active; no status UI.
- [Taskmaster](https://docs.task-master.dev/capabilities/task-structure) and
  [BMAD](https://docs.bmad-method.org/plan/choose-a-planning-path/): machine state in JSON/TOML, markdown as the view.
  [MLflow tracking](https://mlflow.org/docs/latest/ml/tracking/): hypothesis-style params and metrics as typed fields.
- [Cline Memory Bank](https://docs.cline.bot/prompting/cline-memory-bank): markdown only, no UI, freshness relies on
  the agent writing.
- [Statusline](https://code.claude.com/docs/en/statusline): display only (no keys), event-driven, 300ms debounce.
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference): `$.fs` has no watch; `ui.render` re-runs
  only on prop/width change, so poll with `$.clock.every` or `$.ui.invalidate`; draw to `e.props.bodyColumns`; a pane
  a mod opens by itself shows only at ≥144 columns (110 once the user opened it); `$.state` resets on `/clear` and
  `/resume`.
- [Hooks, FileChanged](https://code.claude.com/docs/en/hooks): a real watcher, but paths outside the cwd root need
  absolute `watchPaths` from SessionStart; how it reaches a mod is unverified.
- Approaches: A band polled from frontmatter; B FileChanged-driven redraw; C statusline segment (no resume key); D a
  separate machine-readable state file next to flow.md.

## Options

- Purpose (2026-10-17): a "you are here" marker while developing a feature with `/feature-flow` (user).
- Which run (2026-10-17): the current one plus a count of the other open runs (user, over listing all open runs).
- Key (2026-10-17): resumes the run where it stopped; a new flow is picked up as soon as its flow.md exists (user).
- Shape (2026-10-17): one band above the prompt, not a side pane (Claude's call, user accepted the play-back).
- Source and refresh (2026-10-17): **A**, poll `docs/features/*/flow.md` by mtime and parse fixed tokens (user).
  Rejected: B FileChanged-driven redraw (needs a hook file, delivery to a mod unverified), C a separate `flow.json`
  (two files to keep in step, hand edits go stale).
- Builder check (2026-10-17): minor findings settled as Claude's calls in the spec ($.command.run, yield to
  night-city via next(e) first, "None…" deviations, positional gate dates, no overwrite of an existing slug).
  Worktrees: user chose "handle both": scan `.worktrees/*/` and `.claude/worktrees/*/` too, newest copy wins.
- Claude's calls: the mod lives in the feature-flow plugin; the band yields to night-city's Onibi; skills accept a
  slug to resume one run.
- Grill round 1 (2026-10-17): Q1 old open runs shown however old; Q2 key `1`, first prompt only; Q3 a done run
  stays until session end; Q4 subagent writes count; Q5 no hide setting; Q6 research cells as written; Q7 CI step
  plus CLAUDE.md Checks. User: "yes to all". Frontier empty. No CONTEXT.md terms (run/current run/open run are
  defined in the spec) and no ADR (nothing hard to reverse).

## Plan review

Round 1 (2026-10-17), three reviewers (correctness, fit, simpler). 25 findings merged into 20, 0 dropped. User:
"yes to all, go with your recommendations".

- F1 (blocking): scan from `$.session.repo()?.root`, not the session's directory, which moves into a worktree. Spec
  "Where it looks" made explicit (no change in intent).
- F2 two-level scan by `$.fs.list`, built from each poll; F3 skill resume task moved before the key; F4 resuming a
  worktree copy works in that worktree; F5 skill descriptions/argument hints; F6 README.md sentence, spec's
  "feature-flow README" dropped (none exists) *(spec edit, reopens Gate 1 for that item)*; F7 timer first, every
  refresh caught; F8 only successful writes count, no await on refresh; F9 one refresh at a time; F10 write the
  atom every poll; F11 verdict regex + tests; F12 a "reopened" without a later date is open, limit noted *(spec
  edit, reopens Gate 1 for the gate rule)*; F13 one atom, module variables for the rest; F14 test merges.
- F15–F20: command looked up once with a name fallback and a toast; no tsconfig/tsc; hooks.json in Task 1;
  research line its own task; spec read caught; press by key, sentence before "Opt-in.".
- Shape changed (task order, a new task), so round 2 re-reviews the changed parts.

Round 2 (2026-10-17), one reviewer on Tasks 3–5 and the order. 8 findings, 0 dropped. Claude applied them as
plan-only fixes, to be confirmed at Gate 2: test harness (bottom `ui.render`/`tool.call` hooks, `session.start`,
`{ value }` fakes); `session.repo`/`cwd` are async and `SessionRepo` has `remote`, not `origin`, plus a no-repo test;
`finally { busy = false }` and the failed-poll test fails `session.repo`; errored write = `isError: true`, tested;
`touched.path` stat'ed for its mtime, tested; `toMatchObject` in Task 1 and a default `claim = null`; the render hook
reads the atom; EnterWorktree refusal fallback in Task 3.

## Deviations

From the final whole-branch review (2026-10-17), outside the plan:

- **D1 – where a reopening is written.** The band only sees "Reopened <date>" on the `- Gate N` line (the spec's
  stated limit), but feature-flow `SKILL.md:115` and research-flow `SKILL.md:38-39` don't say where to record a
  reopening, so it lands under Plan review and the band shows `gate 1 ✓` for an open gate. Options: (a) one sentence
  in each skill: record it on the Gate line as `Reopened <date>: <why>`, the re-approval date after it; (b) leave it,
  accept the limit. Recommendation: (a), it makes the anti-goal hold for new runs at the cost of one line per skill.
- **D2 – stale open runs on main.** cyberpunk-theme (`execute`) and installer-rewrite, installer-ux, language-skills
  (`finish`) are merged but not `done`. In a fresh clone every mtime is checkout time, so the fallback picks one
  arbitrarily and shows a shipped run with a resume key plus `+3 open`. Grill Q1 called marking them done separate
  housekeeping. Options: (a) set `phase: done` in those four files in this branch; (b) leave them for later.
  Recommendation: (a), four one-line edits that make the band useful from the first session.

Decision (2026-10-17): the user chose (a) for both ("yes to both, go with your recommendations"). Folded into the
final fix wave with review items 3 (Windows separator in the spec lookup) and 4 ("1 resumes it from an idle prompt").

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
| 1. band: slug, phase, gates, deviations | T1, T2, T4 | `hooks/flow.ts:9,37,112`; `hooks/register.tsx:140` | `flow.test.ts` gateDate/parseFlow/bandLines; `register.test.ts:123,275` |
| 2. research: claim, baseline, feature, verdict | T5 | `hooks/flow.ts:29,57,112`; `hooks/register.tsx:62,80` | `flow.test.ts` research cases; `register.test.ts:341,352,364` |
| 3. `+N open` | T2, T4 | `hooks/flow.ts:91,112` | `flow.test.ts` pickCurrent/bandLines; `register.test.ts:140` |
| 4. current run = this session's last write, else newest open | T2, T4 | `hooks/flow.ts:80,91`; `hooks/register.tsx:121,129` | `register.test.ts:194,214,230,298,314,324` |
| 5. key `1` resumes via `$.command.run` | T2, T4 | `hooks/flow.ts:130`; `hooks/register.tsx:108,140` | `register.test.ts:241,254` |
| 6. skills resume by slug, never overwrite | T3 | `skills/feature-flow/SKILL.md:44-56`, `skills/research-flow/SKILL.md:43-52` | grep + `npm test` (prose) |
| 7. follows edits within a poll | T4 | `hooks/register.tsx:108` (5 s `$.clock.every`) | `register.test.ts:165,173,186` |
| 8. right from main checkout or a worktree | T4 | `hooks/register.tsx` `copies()` (repo root + `.worktrees/*` + `.claude/worktrees/*`) | `register.test.ts:123,134,140,155` |
| anti-goal: never hide a survey/agent view/other band | T4 | `hooks/register.tsx:140` | `register.test.ts:262,269` |
| CI + docs | T6 | `.github/workflows/test.yml`, `CLAUDE.md`, `README.md`, descriptions | `npm test` 116/0; `claude plugin test .` 43/0 |
| D1 reopen on the Gate line; D2 merged runs done | final fix | both SKILL.md; four flow.md frontmatters | re-review |

No goal without code, no code without a goal (paths relative to `plugins/feature-flow/` where not given). Verified
2026-10-17: `claude plugin test .` 43 pass / 0 fail, `claude plugin validate .` passed, `npm test` 116 pass / 0 fail /
1 skipped. Per-task reviews: all clean; Task 4 needed one fix round (shared width across surfaces, key per current
run, session.end reset). Final review (most capable model): ready with fixes; D1/D2 decided by the user, items 3–4
fixed and re-reviewed.

Not verifiable here, needs a live session: the engine's real name for the skill command (tests fake
`feature-flow:feature-flow`; the lookup also accepts any command whose `plugin` is `feature-flow`), and that a bare
`1` in an empty prompt presses the band's Button in a real terminal.
