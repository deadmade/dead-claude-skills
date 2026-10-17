---
phase: grill
---

# Flow pane: flow

## Request

> Hey, could we create a plan with feature flow to implement this flow pane (best fit). A pane or band above the
> prompt that reads docs/features/*/flow.md. It shows the current phase, which gates are approved, any deviations,
> and for research-flow the hypothesis, baseline and result. These runs last for hours and resume across sessions;
> right now the state only lives in a markdown file. One key could resume the run or open the spec.

## Artifacts

- Spec: [spec.md](spec.md)
- Plan:
- ADRs:
- CONTEXT.md:

## Gates

- Gate 1, spec approved:
- Gate 2, plan approved: <date>, execution: subagent-driven | native

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

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
