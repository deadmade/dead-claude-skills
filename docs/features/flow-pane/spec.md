# Flow pane: spec

## Intent

The user builds features with `/feature-flow` (and sometimes `/research-flow`). A run lasts hours and spans sessions,
and its state lives only in `docs/features/<slug>/flow.md`. The user wants a "you are here" marker while they build:
one glance says where the run stands without opening the file, and one key picks the run up where it stopped.

## Goals

1. A band above the prompt shows the **current run**: its slug, its `phase:`, each gate (approved with its date, or
   open), and whether its Deviations section holds anything.
2. A research run (`flow: research`) also shows the hypothesis claim, the baseline and feature numbers once they exist,
   and the verdict once it is written.
3. The band shows how many other runs are open (`+3 open`).
4. **Current run:** the run whose `flow.md` this session last wrote through a Write or Edit tool call. Until there is
   one, the open run whose `flow.md` changed most recently. A run created in this session (`/feature-flow <new
   thing>`) becomes current as soon as its `flow.md` is written; no key press.
5. One key resumes the shown run where it stopped: it submits `/feature-flow <slug>` (or `/research-flow <slug>` for a
   research run) as if the user typed it.
6. feature-flow and research-flow accept an existing run's slug as the argument and resume exactly that run, instead
   of starting a new feature.
7. The band follows the file: edits by hand, by another session or by Claude show up within a few seconds.

## Non-goals

- A side pane. The band is the only surface (decided: a pane a mod opens itself only shows at ≥144 columns, and the
  band is what the user pictured).
- Opening the spec or plan from the band.
- Editing flow.md from the band, approving gates, or any write at all. The mod only reads.
- A separate machine-readable state file (`flow.json`). flow.md stays the only record (option A, decided).
- Listing every open run. One run plus a count (decided).
- Telling an open deviation from a decided one. The free-text formats in real files don't allow it reliably.

## Anti-goals

- The band showing a gate as approved when it isn't, or a wrong phase. When a field can't be read, show `?`, never a
  guess.
- The resume key firing while the user types a prompt, or mid-run.
- The band hiding something more important: a survey (`hasSurvey`) or an agent's transcript view.

## Decided

- **Source and refresh (option A):** the mod reads `docs/features/*/flow.md` (relative to the working directory)
  through `$.fs.list` / `$.fs.read`, polls on `$.clock.every` every few seconds, and re-reads only files whose
  `mtimeMs` changed. No hook file, no file watcher.
- **Lives in the `feature-flow` plugin** as its mod (`plugins/feature-flow/hooks/`), so installing the skill gives the
  marker. Pure parsing in its own `.ts` that the tests import, like `cswap/hooks/cswap.ts`.
- **Surface:** `ui.render` on `{ component: 'AbovePrompt' }`. Yield with `next(e)` when there is no run to show, when
  `hasSurvey`, or when `view.agentId` is set (the night-city pattern, `plugins/night-city/hooks/register.tsx:81`).
- **Open run:** a `flow.md` whose frontmatter `phase:` isn't `done`.

## Reading flow.md

Real files drift from the template (`docs/features/*/flow.md`), so the reader takes only fixed tokens:

- **Frontmatter:** `phase:` and `flow:` from the leading `---` block (the regex in `scripts/sync-lib.mjs:33`).
  No frontmatter or no `phase:` → phase `?`.
- **Gates:** the lines under `## Gates` starting `- Gate 1` and `- Gate 2`. A gate is approved when the text after
  its first `:` holds an ISO date (`YYYY-MM-DD`) and its last date isn't the one right after the last "Reopened"
  (any case); the band shows that last date. Otherwise the gate is open.
  Samples: `cyberpunk-theme` (free text after the date), `language-skills` (reopened, then re-approved),
  `flow-pane` (`<date>` placeholder = open).
- **Deviations:** the section `## Deviations` up to the next `## ` heading; any line that isn't blank or an HTML
  comment means "deviations".
- **Research only:**
  - Hypothesis: the `**Claim:**` bullet of the `## Hypothesis` section in the spec linked from `- Spec:` under
    `## Artifacts` (format: `plugins/feature-flow/skills/research-flow/references/literature.md:37-48`). No link, no
    section or no claim → no hypothesis shown.
  - Results: the `baseline` and `feature` rows of the table under `## Results`, their `numbers` cell; empty cells show
    nothing.
  - Verdict: the `Verdict:` line under `## Results`, shown only when it names exactly one of supported, not
    supported, inconclusive (the template line lists all three).

## The band

One line for a feature run; a second line for a research run. Example (Claude's mock-up, wording left to the
builder):

```
flow-pane · plan · gate 1 ✓ 10-17 · gate 2 – · deviations · +3 open        1 resume
H: caching cuts p95 by 30% · baseline 412ms · feature 280ms · supported
```

- Fits `e.props.bodyColumns`: drop segments from the right (count, then deviations) before truncating the slug.
- The resume Button uses the digit hotkey `1` (a bare digit in an empty prompt presses a band Button).

## Claude's calls (not discussed with the user)

- **Resume key only when nothing runs:** the Button shows only while this session hasn't yet written the current run's
  flow.md and no turn is running (`isWorking`). The hotkey fires only from an empty prompt anyway, but a prompt
  starting with "1" would trigger it; hiding it once the session works on the run limits that to the first prompt
  of a session. After that the band shows status only.
- **A finished run:** when the session's current run reaches `phase: done`, the band keeps showing it, marked done,
  without the key, until the session ends; then it falls back to the open runs like any other.
- **Night-city:** while Onibi visits (a few seconds) night-city returns its own band without `next(e)`, so the flow
  band yields. No change to night-city.
- **"Last written by this session":** Write and Edit tool calls whose `file_path` ends in `docs/features/<slug>/flow.md`.
  Edits through Bash (`sed`) aren't seen; the mtime fallback covers them.
- **Poll interval:** 5 seconds.
- **Resume argument:** a slug resumes only when `docs/features/<slug>/flow.md` exists; anything else is still a new
  feature. research-flow does the same for `flow: research` runs, feature-flow for the others.

## Constraints

- No npm dependencies; the mod uses only the `$` engine interface (`$.fs`, `$.clock`, `$.prompt`, `$.ui`).
- The mod ships at the repo's one version (`check-repo.mjs` fails on drift); `plugin.json` gains `hooks`/`types` the
  way cswap's does.
- Mod tests run with `claude plugin test .` in `plugins/feature-flow`; CI needs a step for it in
  `.github/workflows/test.yml` next to cswap's and night-city's, on Linux and Windows. Tests fake files with
  `on('fs.list')` / `on('fs.read')` and inline flow.md samples (no file system in plugin tests).
- README.md, the feature-flow README/description, and CLAUDE.md (layout + checks) describe the mod.

## Left to the builder

- Exact wording, glyphs and colours of the band.
- How state is kept between polls (module variables or `$.state` atoms with a `types/index.d.ts` contract).
- Test layout and the inline samples, as long as the three real gate shapes above are covered.
