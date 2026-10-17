---
phase: ground
---

# Flow pane: flow

## Request

> Hey, could we create a plan with feature flow to implement this flow pane (best fit). A pane or band above the
> prompt that reads docs/features/*/flow.md. It shows the current phase, which gates are approved, any deviations,
> and for research-flow the hypothesis, baseline and result. These runs last for hours and resume across sessions;
> right now the state only lives in a markdown file. One key could resume the run or open the spec.

## Artifacts

- Spec:
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

## Options

## Plan review

## Deviations

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |
