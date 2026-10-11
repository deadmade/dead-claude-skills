---
phase: execute
---

# Installer UX: flow

## Request
Hey, I would like to improve the installer. It currently is functional at best but its hard to read, to understand
and I cant even navigate back a page. Also enter and space can be a bit confusing

## Artifacts
- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- ADRs: none (no decision met the three conditions)
- CONTEXT.md: none

## Gates
- Gate 1, spec approved: 2026-10-11 (approved via plan mode exit)
- Gate 2, plan approved: 2026-10-11, execution: native

## Skipped
- Phase 3 grilling ran inline (one round, one open decision) since the design questions were settled during
  brainstorming; no CONTEXT.md terms emerged.

## Grounding
- `installer/install.mjs` (543 lines): I/O + UI; page loop + review loop at `install.mjs:408-462`.
- `installer/core.mjs`: pure decisions; `CATEGORIES` / `categorize` at `core.mjs:240-262`, `HINTS` at `core.mjs:265`.
- `@clack/prompts` 1.8.1, `@clack/core` 1.5.1 (transitive) pinned in `npm-shrinkwrap.json`.
- Tests: `node --test installer/*.test.mjs` (release.yml, flake.nix).

## Prior art
- clack 1.8.1 has no back action ([clack#39](https://github.com/bombshell-dev/clack/issues/39)); core actions fixed to
  up/down/left/right/space/enter/cancel; `Prompt` class usable for custom prompts.
- huh (Go): paged forms, shift+tab back. sv / create-vue: one big clack multiselect. inquirer checkbox: no back.
- `a`/`i` broken in groupMultiselect ([clack#550](https://github.com/bombshell-dev/clack/issues/550)).

## Options
- Pain points (user): where am I / what's next; grey font hard to read; space vs enter.
- Navigation: user asked for a top tab bar.
- Finish: tabs only choose, enter → separate review (picked) vs. Review as last tab.
- Build: custom `@clack/core` prompt (recommended, picked) vs. hub menu vs. one groupMultiselect.
- `a` on Danger tab: disabled (recommended, picked) vs. same everywhere.

## Plan review
Round 1 (2026-10-11), reviewers: correctness, fit, simpler. 0 findings dropped. User: apply all recommendations.
- Blocking: `Prompt` subclass with `render()` method crashes / shadows base render → plain `new Prompt({render})` + closure state.
- Blocking: enter without changes resolved `undefined` → return closure state after `prompt()`.
- Frame overflow: `limitOptions` rowPadding default 4 → computed rowPadding + "≤ rows" test.
- Vacuous color tests (`styleText` strips color off-TTY) → `FORCE_COLOR=1` in tabs.test.mjs, raw escape asserts.
- `describe` rename contradiction → keep `option()`, `hint`→`detail`, drop `clip()`.
- Shrinkwrap diff expectation includes `engines` → fixed.
- Consider, all applied: keep always-installed note (spec edit); `bulk: false` in CATEGORIES (spec edit); esc
  manual-check text; footers private, no mutation assertion; tests keep shipping in npx.

## Deviations

## Walkthrough
| spec goal | plan task | file:line | test |
|---|---|---|---|
