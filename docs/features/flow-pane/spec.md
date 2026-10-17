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
5. One key resumes the shown run where it stopped: it runs `/feature-flow <slug>` (or `/research-flow <slug>` for a
   research run) through `$.command.run`, as if the user typed it.
6. feature-flow and research-flow accept an existing run's slug as the argument and resume exactly that run, instead
   of starting a new feature.
7. The band follows the file: edits by hand, by another session or by Claude show up within a few seconds.
8. The band is right whether the session starts in the main checkout or in a worktree (user, 2026-10-17): during
   execute, superpowers moves the work into a worktree and flow.md is updated there, while the main checkout's copy
   stays behind until the branch merges.

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

- **Source and refresh (option A):** the mod reads `docs/features/*/flow.md` through `$.fs.list` / `$.fs.read`,
  polls on `$.clock.every` every few seconds, and re-reads only files whose `mtimeMs` changed. No hook file, no
  file watcher.
- **Where it looks (user, 2026-10-17):** the repository root (`$.session.repo()?.root`, the main working tree's
  root even from inside a worktree; the session's directory when there is no repository), plus every worktree under `.worktrees/*/` and
  `.claude/worktrees/*/` (the superpowers default and Claude Code's own). A run is one slug; when several copies of
  its flow.md exist, the newest `mtimeMs` wins. The copy this session last wrote is always among them, whatever its
  path.
- **Lives in the `feature-flow` plugin** as its mod (`plugins/feature-flow/hooks/`), so installing the skill gives the
  marker. Pure parsing in its own `.ts` that the tests import, like `cswap/hooks/cswap.ts`.
- **Surface:** `ui.render` on `{ component: 'AbovePrompt' }`. Yield with `next(e)` when there is no run to show, when
  `hasSurvey`, or when `view.agentId` is set (the night-city pattern, `plugins/night-city/hooks/register.tsx:81`).
  Otherwise call `next(e)` first and draw only when nothing beneath drew a band: hooks in the same tier have no
  stated order (`claude-code.d.ts` `TIERS`), so this is what lets night-city's Onibi win wherever it sits.
- **Open run:** a `flow.md` whose frontmatter `phase:` isn't `done`.

## Reading flow.md

Real files drift from the template (`docs/features/*/flow.md`), so the reader takes only fixed tokens:

- **Frontmatter:** `phase:` and `flow:` from the leading `---` block (the regex in `scripts/sync-lib.mjs:33`).
  No frontmatter or no `phase:` → phase `?`.
- **Gates:** the lines under `## Gates` starting `- Gate 1` and `- Gate 2`. A gate is approved when the text after
  its first `:` holds an ISO date (`YYYY-MM-DD`) and its last date isn't the one right after the last "Reopened"
  (any case); the band shows that last date. Otherwise the gate is open, and so is a gate whose last "Reopened" has
  no date after it. Limit: a reopening recorded elsewhere in flow.md (Options, Plan review) isn't seen. Compare positions on the line, not values:
  `language-skills` has three equal dates on one Gate 1 line.
  Samples: `cyberpunk-theme` (free text after the date), `language-skills` (reopened, then re-approved),
  `flow-pane` (`<date>` placeholder = open).
- **Deviations:** the section `## Deviations` up to the next `## ` heading. Its first line that isn't blank or an
  HTML comment decides: none, or one starting `None` / `- None` → no deviations; anything else → "deviations".
  Samples: `installer-rewrite`, `postgres-skills` (None…), `cyberpunk-theme`, `superpowers-v7` (deviations).
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

## Grilled (user, 2026-10-17)

- **Old open runs:** the fallback shows the most recently changed open run however old it is; no age cut-off.
- **Resume key:** `1`, shown only before this session wrote the run's flow.md and while no turn runs (below).
- **Finished run:** stays on the band marked done, without the key, until the session ends (below).
- **Subagent writes:** Write/Edit calls from subagents (`tool.call` with an `agentId`) count as this session's.
- **No setting** to hide the band; add one only if it gets in the way.
- **Research line:** the Results cells as written, truncated; no number parsing.
- **CI:** a `claude plugin test .` step for `plugins/feature-flow` in `test.yml` (Linux and Windows); CLAUDE.md's
  Checks/CI text names every mod test, night-city's included.

## Claude's calls (not discussed with the user)

- **Resume key only when nothing runs:** the Button shows only while this session hasn't yet written the current run's
  flow.md and no turn is running (`isWorking`). The hotkey fires only from an empty prompt anyway, but a prompt
  starting with "1" would trigger it; hiding it once the session works on the run limits that to the first prompt
  of a session. After that the band shows status only.
- **A finished run:** when the session's current run reaches `phase: done`, the band keeps showing it, marked done,
  without the key, until the session ends; then it falls back to the open runs like any other.
- **Night-city:** while Onibi visits (a few seconds) the flow band yields to it (see Surface). No change to
  night-city.
- **"Last written by this session":** Write and Edit tool calls (subagents' included) whose `file_path` ends in
  `docs/features/<slug>/flow.md`.
  Edits through Bash (`sed`) aren't seen; the mtime fallback covers them.
- **Poll interval:** 5 seconds.
- **Resume argument:** an argument that names an existing `docs/features/<slug>/flow.md` never creates a new run
  over it. feature-flow resumes it when it isn't `flow: research`; for a research run it says the run belongs to
  `/research-flow` and stops. research-flow mirrors that. A `phase: done` run: say it's done and ask what to do.
  Any other argument is a new feature, as today. Resuming also reads the newest copy of that flow.md, the worktree
  ones included, so the key and the skill agree on where the run stands.

## Constraints

- No npm dependencies; the mod uses only the `$` engine interface (`$.fs`, `$.clock`, `$.command`, `$.ui`).
- The mod ships at the repo's one version (`check-repo.mjs` fails on drift). Like cswap: `hooks/hooks.json`
  (`{ "modules": [...] }`) and a `"types"` entry in `plugin.json` if it keeps `$.state`; the generated
  `.claude-plugin/types/` stays gitignored.
- Mod tests run with `claude plugin test .` in `plugins/feature-flow`; CI needs a step for it in
  `.github/workflows/test.yml` next to cswap's and night-city's, on Linux and Windows. Tests fake files with
  `on('fs.list')` / `on('fs.read')` and inline flow.md samples (no file system in plugin tests).
- README.md, the feature-flow description (marketplace entry and `plugin.json`), and CLAUDE.md (layout + checks)
  describe the mod. (feature-flow has no README of its own.)

## Left to the builder

- Exact wording, glyphs and colours of the band.
- How state is kept between polls (module variables or `$.state` atoms with a `types/index.d.ts` contract).
- Test layout and the inline samples, as long as the three real gate shapes above are covered.
