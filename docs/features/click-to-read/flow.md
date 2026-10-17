---
phase: done
---

# Click-to-read file pane: flow

## Request

"Lets implement this pls" — following up on: "but I coud not intercept that with a mod?" after asking to read md
documents in the terminal by clicking the file path, like in Claude Desktop. Proposed shape: a mod that redraws
Claude's replies with path mentions as links it answers; a plain click opens the file rendered in a pane beside the
chat; ctrl/cmd+click keeps the system opener.

## Artifacts

- Spec: [2026-10-17-click-to-read-design.md](../../superpowers/specs/2026-10-17-click-to-read-design.md) (builder check done, answers folded in 2026-10-17)
- Plan: [2026-10-17-click-to-read.md](../../superpowers/plans/2026-10-17-click-to-read.md)
- ADRs: none (no decision met the three ADR conditions)
- CONTEXT.md: none (no new domain terms; pane/reply are Claude Code's words)

## Gates

- Gate 1, spec approved: 2026-10-17
- Gate 2, plan approved: 2026-10-17, execution: native

## Skipped

## Grounding

Repo plumbing (explorer 1):

- Mod shape: `.claude-plugin/plugin.json` (version = package.json 0.3.0, `types`), `hooks/hooks.json`
  `{ "modules": ["./register.tsx"] }`, `types/index.d.ts` (`PluginState`), `tsconfig.json` (tui-review/night-city).
- Pane precedent `plugins/tui-review/hooks/register.tsx`: command registered in `session.start` (l.506), opened by
  `$.ui.open({ id, title, focus })` (l.476), closed by `$.ui.close` (l.373) / `on('ui.close')` (l.517), drawn by
  `ui.render` on `Pane` (l.578), keys are `<Button plain hotkey>` (l.618-639), wheel via `ui.scroll` (l.573; without
  that hook the engine scrolls the tree itself). Its Raster/blit windowing is for 100k-line diffs; not needed here.
- Files: `$.fs.read(path)` → UTF-8, relative to `$.session.cwd()`, rejects over 4 MiB; `$.fs.exists`.
- No mod in the repo hooks `AssistantMessage` or uses `Markdown`/`Link`/`onLinkPress`. night-city rewrites
  `Spinner`/`TurnDuration`/`AbovePrompt` props with `next({...e, props})` (`plugins/night-city/hooks/register.tsx:79-104`).
- Tests: `claude plugin test .`, `claude-code/testing`; pane tests mount `pane()` from `plugins/tui-review/tests/harness.ts:130`;
  night-city tests transcript components via `$.ui.render({ component, props })`.
- Shipping: marketplace entry (check-repo fails without it), installer `CATEGORIES` `tools` page
  (`installer/core.mjs` ~355) + the hardcoded opt-in list in `installer/core.test.mjs:51-77`, README.md plugin prose
  (l.9-13), own plugin README, CI step in `.github/workflows/test.yml` like cswap/night-city. Not in the dead-skills bundle.

Mod API, build 2.1.302 (explorer 2; line numbers in the bundled plugin-authoring `types/claude-code.d.ts`):

- Any transcript component can be answered with a whole tree (`RenderResultOf` 10784). `AssistantMessage` props:
  `text` (markdown), `isFirstOfReply`, `isSummary?`, `onScreen?` (10274-10305); a rewrite changes only the drawing.
  `ToolResult.output` is the tool's result object, schema-checked on rewrite (10365-10404).
- Only a plugin-drawn `Markdown` with `key` + `onLinkPress` intercepts clicks (5841-5878): plain single click in the
  fullscreen terminal; ctrl/alt/cmd click opens as before. `pressableLinks` ≤ 256 hrefs; links outside it keep the
  surface's behaviour. Only `https:`/`http:`/`file:` links draw. `Link` cannot intercept.
- Not declared: whether the engine or `Markdown` linkifies bare paths (assume not: the mod writes `[p](file:///…)`
  links), whether `e.link.href` for `file:` is percent-encoded, whether `AssistantMessage` re-renders per streaming
  delta, what non-terminal surfaces do with a press.
- Pane: `$.ui.open({ id, title, focus, closeOnEscape, columns })` (7550-7620); a press counts as asked → placed at any
  width (docked from 110 cols in fullscreen, else inline). Body is a tree; the engine scrolls it (wheel, arrows, page
  keys); 100 000 characters per drawing, beyond that draw the slice in view.
- `$.fs.read(path)` UTF-8, ≤ 4 MiB, absolute paths as given, no permission prompt; `$.session.cwd()` for relative.
- Tests: `mounted.press({ key, link: { href } })` presses a Markdown link (16341-16347, 16478-16485).

## Prior art

No terminal AI agent found that opens files from chat in an in-app Markdown pane; Warp's Markdown viewer (split pane,
Cmd/Ctrl+click on a `.md` path, [docs](https://docs.warp.dev/terminal/more-features/markdown-viewer/)) is the closest.

- **A. Program writes OSC 8, terminal handles the click** (kitty `hyperlinked_grep` + `open_actions`,
  [docs](https://sw.kovidgoyal.net/kitty/open_actions/)): exact paths, but the click never reaches the app. That is
  today's ctrl/cmd+click fallback.
- **B. Host finds paths in rendered text, checks they exist, opens its own viewer** (VS Code
  [terminalLinkParsing.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkParsing.ts),
  [terminalLocalLinkDetector.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/terminalContrib/links/browser/terminalLocalLinkDetector.ts);
  Zed, Warp): works on prose; false positives (`1.2.3`, `a/b`) are killed by the existence check, not by the regex.
  VS Code trims trailing `.'"]`, parses `:line:col` suffixes, caps 10 links/line.
- **C. TUI draws the path itself with a click handler, from structured data** (opencode
  [PR #38645](https://github.com/anomalyco/opencode/pull/38645), unmerged): exact, but only covers what the app draws;
  OSC 8 links "never fired" under mouse capture.
- Mod fit: B for reply prose via `Markdown` `onLinkPress`, with `$.fs.exists` as the false-positive filter (the
  report's open risk; the API has it). OSC 8 spec ([gist](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)):
  percent-encode non-ASCII in `file://` URIs, ~2083-byte practical limit.

## Options

- How it gets made (settled in conversation before the flow started; the user asked for the mod route):
  **chosen** prior-art B through the mod API: redraw replies containing `.md` paths as a plugin `Markdown` with
  `onLinkPress`, open a `Pane`. **Rejected** A (OSC 8 only; the click never reaches Claude Code, which is today's
  ctrl+click) and C (click handlers on tool-call data; the user wants reply text, not tool rows).
- Brainstorm answers: flow/spec/plan files; read only; `.md` only; auto refresh; reply text only; small visual
  differences on redrawn replies OK; links inside the open document swap the pane.

## Plan review

Round 1 (2026-10-17): three reviewers (fable, opus, sonnet), each on correctness, fit and simpler; all three
confirmed by experiment that `$.ui.mount` on `AssistantMessage`, `find` and `press({ key, link })` work in the kit.
None dropped; one downgraded (pane placement: `PaneOpenArgs` docs say a press is placed at any width). User:
"all recommendations" on every item.

- B1 commits before Task 5 fail check-repo → listing moved into Task 1.
- B2 `$.ui.scroll` missing in the test kit → call kept, guarded with `.catch`, no scroll assertions.
- S1 races (fast clicks, close during load/refresh) → generation counter, tick in-flight skip, race tests.
- S2 risky facts last → checkpoint after Task 2: the user tries it with `--plugin-dir`.
- S3 checks during streaming → in-flight sharing, 2 s negative cache, links rewritten once at load.
- S4 limits → over-long replies via `next` with rewritten text, hrefs > 2048 skipped, pane cut after rewrite at a
  newline.
- S5 code spans with extra text → a code span is one token, linked only when it is exactly a path.
- S6 `file:` targets → treated as paths.
- S7 refresh after reload → timer started by the pane's drawing, stopped by every close.
- S8 plan mechanics → `plugin` in mounts, `key="q"`, `state.set` recording, module reset, awaited `env.get`.
- C1 cwd fallback inside the pane (spec goal 7 amended); C2 de-duplicated hrefs; C3 `stat` kind check, errors
  caught; C4 `/` separators internally; C5 size as well as mtime; C6 no non-terminal pane branch.
- Co-author rule kept: it is the user's own startup-hook rule.

Round 2 (2026-10-17, one opus reviewer, re-check after the task order changed): round-1 fixes confirmed in the kit.
New findings were plan mechanics, applied without a user decision since none changes the spec: negative cache
dropped by `$.clock.after` and `mock.clock` in every test; the person's close moved to the Manual check (the kit
can't raise it); missing stat answered `{ deny: 'ENOENT' }`; `load` stats directly, not through the link cache;
the checkpoint toast lands in Task 2's commit; prettier limited to touched paths; over-long replies `next(e)`
unchanged; polling runs on error documents too; race-test setup and `host()` parameters spelled out.

## Execution

- Native, on this branch. Task 1 `9fc8e1c`, Task 2 `a218a8f`, checkpoint, Task 3 `0cec867`, Task 4 `71aeada`, Task 5
  `c26b425`; main merged and md-pane moved to `plugins/mods/md-pane/` (`93402fe`, main's #47 grouped the mods); final
  review fixes `f978632`.
- Checkpoint (user, 2026-10-17): a plain click toasted `file:///home/deadmade/dead-claude-skills/docs/features/click-to-read/flow.md`
  (href arrives as written); ctrl+click still opens the system app; streaming not reported as a problem.
- Final review (opus): C1 Windows test-host paths, I1 behind main, I2 nested/longer fences, I3 close during a press's
  state write: all fixed (I2/I3 with failing tests first; C1 only provable on the Windows CI job). Minors deferred:
  non-ENOENT stat errors reload each tick, Markdown edge cases (link titles, double-backtick spans, `<…>` targets,
  `notes.md.bak`, `_…_`, `%20` targets), a cwd lookup on every fullscreen reply render.

- Finished 2026-10-17: the user chose a PR, https://github.com/deadmade/dead-claude-skills/pull/49.

## Deviations

None from the spec. Plan-level rulings (test-kit workarounds, two extra tests, the refresh change check) are listed in
the final message of the run; the plan's paths predate the move to `plugins/mods/`.

## Walkthrough

| spec goal                                                                             | plan task | file:line                                                                                                               | test                                                                     |
| ------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1 `.md` paths in replies become links (bare, code, link; cwd, `~`, absolute, Windows) | T1, T2    | `plugins/mods/md-pane/hooks/paths.ts:50`, `:75`, `:93`; `plugins/mods/md-pane/hooks/register.tsx:157`                   | `paths.test.ts` find/resolve/href tests; `register.test.ts:93`, `:307`   |
| Only existing files; look-alikes and fences skipped                                   | T1, T2    | `plugins/mods/md-pane/hooks/paths.ts:30`; `plugins/mods/md-pane/hooks/register.tsx` `isFile`                            | `paths.test.ts` look-alike and fence tests; `register.test.ts:101`       |
| 2 plain click opens the file rendered in a pane, titled                               | T3        | `plugins/mods/md-pane/hooks/register.tsx:101`, `:165`                                                                   | `register.test.ts:195`                                                   |
| 3 ctrl/cmd+click keeps the system opener                                              | T2        | `pressableLinks` only intercepts plain clicks                                                                           | checkpoint (user)                                                        |
| 4 one pane; another path swaps, the open one stays                                    | T3        | `plugins/mods/md-pane/hooks/register.tsx:101-116`                                                                       | `register.test.ts:204`, `:213`, `:267`                                   |
| 5 auto refresh on change                                                              | T4        | `plugins/mods/md-pane/hooks/register.tsx:124`                                                                           | `register.test.ts:318`-`:405`                                            |
| 6 scroll (engine), close with q/Esc/mark/ctrl+x x; closes on session end              | T3, T4    | `plugins/mods/md-pane/hooks/register.tsx:113`, `:186`, `:191`, `:198`                                                   | `register.test.ts:291`, `:299`, `:357`, `:368`, `:419`; Esc/mark: manual |
| 7 links inside the doc swap, doc folder then cwd                                      | T3        | `plugins/mods/md-pane/hooks/register.tsx:76` (`linked` bases)                                                           | `register.test.ts:221`, `:230`                                           |
| 8 missing / too large / long documents                                                | T3        | `plugins/mods/md-pane/hooks/register.tsx:83`, `:92`                                                                     | `register.test.ts:238`, `:248`, `:256`, `:378`                           |
| Fullscreen terminal only; summaries and over-long replies untouched                   | T2        | `plugins/mods/md-pane/hooks/register.tsx:157-163`                                                                       | `register.test.ts:107`, `:149`                                           |
| Streaming: one stat per existing path, misses kept 2 s                                | T2        | `plugins/mods/md-pane/hooks/register.tsx` `isFile`                                                                      | `register.test.ts:117`, `:124`, `:133`                                   |
| Shipped: marketplace, installer Tools page, CI, docs                                  | T1, T5    | `.claude-plugin/marketplace.json`, `installer/core.mjs`, `.github/workflows/test.yml`, `plugins/mods/md-pane/README.md` | `npm test` (check-repo, `core.test.mjs`)                                 |
