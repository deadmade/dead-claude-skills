---
phase: finish
---

# Installer rewrite: flow

## Request

Hey, currently I feel the installer is sub standard when it comes tu accability and usability. Could we please
recreate it. First witthout a lib so we have no npm dep that can be exploitet. Second I want an awesome installation
flow that is actually usable. At the moment I cant even know what I have installed.

## Artifacts

- Spec: [spec.md](spec.md)
- Plan: [plan.md](plan.md)
- Mockups: scratchpad `installer-mockups.html` (local only, not in the repo)
- ADRs:
- CONTEXT.md: none (no domain terms beyond what core.mjs names)

## Gates

- Gate 1, spec approved: 2026-10-11
- Gate 2, plan approved: 2026-10-11 (with the 3 spec amendments from plan review round 1), execution: native

## Skipped

## Grounding

- `installer/core.mjs` pure, no deps; `install.mjs` uses clack for intro/outro, spinners, notes, log, confirm,
  select, text; chooser loop `install.mjs:419-447`; `tabs.mjs` is the clack chooser.
- `claude plugin list --json` has `version`; our plugins ship `plugin.json` versions (0.1.1); the user's machine has
  0.1.0 and git-sha versions. `claude plugin update <plugin>` exists.
- `npm-shrinkwrap.json` version lines are bumped/checked by `scripts/release.mjs` / `check-repo.mjs`.

## Prior art

- Zero-dep mechanics: clack/prompts/enquirer all use readline `emitKeypressEvents` + raw mode, restore on close;
  Windows key loss between prompts (nodejs#38663); `styleText` honours NO_COLOR only from 20.18.
- Readability: archinstall menu with current value per line; rustup/Homebrew state as words and `old -> new`;
  mason/lazy status groups; Debian/create-vite one question per screen; brew dry-run lists only changes; clig.dev.
- Approaches: full-screen redraw TUI / line-oriented numbered menu / flags + status command.

## Options

- "Installed?" pain: chooser doesn't show it + versions/outdated (not: status command, post-run summary).
- A11y meaning: simple keys + readable visuals (not: screen reader mode, non-interactive flags).
- Layout: rejected 0 (today's tabs + text labels: "does little to nothing"), first ASCII round (status sections,
  before/after table, two panes: "still hard to read"). HTML mockups: A start screen (picked), B status groups,
  C one question per screen. Color styles: A2 framed (picked), A1 tags, A3 counters.
- Updates: update all outdated, listed in review, untickable (recommended, picked) vs opt-in vs show only.
- Progress: one line per step (recommended, picked) vs spinner.
- Grill round 1: no select-all key; esc with pending changes asks first (default No); disabled plugins shown
  as `installed X, disabled`, never touched; ui.mjs + view.mjs split. Frontier empty after round 1.
- Fallback: always Unicode + color (user's pick; recommendation was NO_COLOR + ASCII frame + engines 20.18).

## Plan review

Round 1 (2026-10-11), reviewers: correctness, fit, simpler (3 agents via a small workflow). 0 dropped.
User: apply all must-fix; delete shrinkwrap (spec edit); keep the Updates screen on shared category code.

- Blocking: `step` name clash with `install.mjs:79` → local renamed `run`, ui exports `progress` (catches throws).
- readline: createInterface with `escapeCodeTimeout: 50`, no output, no bare emitKeypressEvents; close + pause stdin
  on cleanup; `line()` on readline/promises (ctrl-c → null); exit hook guarded by isTTY; `enter` mapped; SIGTERM/HUP.
- `confirm` built on `screen()`; `io` only on screen/confirm/line.
- `listed` normalised + deduped; update with `--json`; no downgrade for newer installs; one real-CLI update check.
- `note` wraps instead of cutting (copyable text); frame `columns - 1` wide.
- Leftover `p.cancel` / `dim` listed + grep check; tokens + HINTS in view data; shipped path via `source`;
  `platform-arch`; y/n only in confirm; `changeList(state, data)` moved to view; Task 5 split (Task 6 deps).
- Spec edits (reopen Gate 1 for these items only): Code section signatures; shrinkwrap deleted; no-downgrade rule.

## Deviations

None that change an interface or add a library. Rulings (ledger, `.superpowers/sdd/plan/progress.md`):

- T2: `wrap()` keeps color only for lines that fit; wrapped lines are plain. `rowsOf` exported; esc on review → start.
- T4: enter-after-return dropped by a flag, not a time window; ctrl-c via readline's `SIGINT` event.
- T5: leftover grep scoped to the three UI files; Quit/esc-confirmed/ctrl-c on a screen exit 0, ctrl-c at
  confirm/line prompts exit 130.
- T5 Step 8 (real `claude plugin update`) not run: it would modify the user's real plugins and the sandbox denies
  writes to `~/.claude/plugins`. Handed to the user.
- Final review fixes: screens fit the terminal height; review lists strip-defaults/clean removals (`data.sweep`);
  50 ms type-ahead guard in `screen()`; updates of a plugin not in `chosen` no longer counted.
- Deferred minors: throw on first draw skips cleanup; narrowing resize leaves reflowed lines; "1 changes" plural;
  applied strip-defaults reads "will turn off"; versionless row renders "undefined → X".

## Walkthrough

| spec goal                                                   | plan task | file:line                                                        | test                                                                                                            |
| ----------------------------------------------------------- | --------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| No npm dependency (clack, shrinkwrap gone)                  | 5, 6      | `package.json`, `installer/ui.mjs:2-5`, `installer/view.mjs:2-3` | repo checks; `git grep clack` empty                                                                             |
| Framed start screen, category values, Core line, Apply/Quit | 2, 3      | `installer/view.mjs:137-205`                                     | start shows kept, pending + and −, toggles and the Apply count; empty categories read none                      |
| Keys ↑/↓ enter esc only; esc asks with pending changes      | 2, 5      | `installer/view.mjs:101-127`, `installer/install.mjs:407-421`    | down/up wrap…; esc on start: quit when idle, ask-quit…; pty run                                                 |
| Category screen: states as words, disabled, description     | 3         | `installer/view.mjs:155-169, 207-236`                            | category states are words; category shows the focused item description                                          |
| Updates screen, skip, outdated rule (no downgrade)          | 1, 2, 3   | `installer/core.mjs:298`, `installer/view.mjs:50-54`             | outdated compares our shipped versions…; updates rows toggle skip…; updates screen shows from → to and skip     |
| Review lists only changes (incl. strip/clean removals)      | 3 + fix   | `installer/view.mjs:238-267`, `installer/install.mjs:401-405`    | review lists only non-empty groups…; review lists what strip-defaults sweeps away                               |
| `claude plugin update` step                                 | 5         | `installer/install.mjs:471-473`                                  | pty Apply run (log shows `plugin update … --json`)                                                              |
| One line per step; framed notes that wrap; summary ✓/✗      | 4, 5      | `installer/ui.mjs:117-139`                                       | progress turns a throw into failed; frame cuts…, wrap never cuts                                                |
| Raw mode/cursor restored on every exit; no type-ahead       | 4 + fix   | `installer/ui.mjs:12-82`                                         | screen resolves on enter and restores…; ctrl-c…; throwing move…; keys typed before a prompt…; pty ctrl-c checks |
| Fits narrow and short terminals                             | 3 + fix   | `installer/view.mjs:171-180, 269-275`                            | every line fits narrow terminals; every screen fits short, narrow terminals                                     |
| README describes the new flow                               | 6         | `README.md:31-38`                                                | —                                                                                                               |
