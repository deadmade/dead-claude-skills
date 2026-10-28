# Writing style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one writing skill based on Williams and Bizup's _Style_ inside flows, check every Markdown write for
conversation shorthand and undefined abbreviations, give flows a `/copyedit` editor that applies the book with
candidates spaCy measures, set up its Python environment (the installer elsewhere, a flake package on NixOS), and
retire pstack's `technical-writing` and `unslop`.

**Architecture:** The plugin parts live in flows. The Node check (`hooks/prose.mjs`, entry `hooks/prose-check.mjs`)
runs as a `PostToolUse` command hook. `skills/writing/` is the writers' standard. `skills/copyedit/` saves the
document, has a fresh Opus agent edit it into a scratchpad file, checks that file's structure in Node
(`scripts/compare.mjs`) before copying it over, and shows the diff. Its measures are a Node part (`scripts/prepare.mjs`:
masking shared with `prose.mjs`, phrase candidates) and a Python part (`scripts/measure.py`: spaCy). `flow-rules.md`
runs `/copyedit` before spec, plan and audit-report gates. The installer's `prose` toggle syncs a locked uv project
(`installer/assets/prose/`) into `<config>/flows-prose/`; on NixOS, `flake.nix`'s `flows-prose` package provides
`flows-prose-python` instead.

**Tech Stack:** Node's standard library (`node:test`), Claude Code plugin hooks and skills, Python 3.13 with spaCy 3.8
and `en_core_web_trf` 3.8.0 on CPU-only PyTorch, uv (from PATH), nixpkgs, the installer's TypeScript.

**Spec:** [spec.md](spec.md), approved 2026-10-27; revised and approved 2026-10-28, twice (the editor design, then
the second plan review's decisions). ADR: [0005](../../adr/0005-prose-python-environment.md).

Tasks 1 and 2 are built (commits `55d4e4c`, `2287a4c`, `83df561`, `1ba2a0e`). Tasks 3–8 are the core; Tasks 9–12 add
the measures; Task 13 is acceptance.

## Global Constraints

- The rule, verbatim: _write for a smart reader who wasn't there, and omit needless words._
- Which files are checked: resolved in flows' `hooks/hooks.json` (matchers and `if` filters) and in `prose.mjs` (the
  flow.md exception); never seen by the skill, the editor or the conductors.
- When a document is copyedited: resolved in `flow-rules.md`; never seen by the hook or by each conductor's own gate
  text.
- How a document is edited: resolved in `/copyedit` and its guide; the conductors run it and never restate its steps.
- Where the Python environment is: resolved in the installer's prose step, `flake.nix`, and `/copyedit`'s measure
  step; never seen by `measure.py`, the editor agent or the conductors.
- What the writing standard says: resolved in the `writing` skill and the editing guide; the conductors name them and
  never restate their rules.
- The closing line of every check report, verbatim: "Fix what makes the prose worse for a reader. Leave a sentence as
  is when the finding is wrong."
- The check judges only the new text (a `Write`'s `content`, an `Edit`'s `new_string`), never looks inside code
  (fenced or inline), front matter, link targets or block quotes, and reports at most 10 findings. Its shorthand rule
  is off in files named `flow.md`. It uses Node's standard library only, runs in exec form, exits 2 with findings on
  stderr, and exits 0 silently with none, on any error, or when `FLOWS_PROSE_CHECK` is `off`. No model runs on any
  write.
- The editor runs on Opus (`model: "opus"` on the Agent call), as a fresh `general-purpose` agent. It writes one file,
  a `.txt` in the scratchpad; `/copyedit` saves the original before the agent starts, replaces the document only with
  `cp` after `compare.mjs` passes, and commits nothing.
- The editor prompt, verbatim, with `<doc>`, `<guide>`, `<candidates>` and `<out>` filled in; the bracketed paragraph
  only when a candidates file exists:

  ```
  You are a copy editor. Edit the Markdown document <doc> so it reads clearly to a smart reader who was not in the conversation that produced it.

  Edit by the method in <guide>: run its diagnoses on every sentence and paragraph, then revise where a diagnosis shows a problem and the change helps the reader.

  [Code has measured the document against the book and listed candidate problems by line in <candidates> (code spans appear as "X"). Judge each candidate by the book: fix it when the fix helps the reader, leave it when it doesn't (many passives and long openers are fine). The list is a starting point, not a limit: diagnose the sentences it doesn't name too.]

  Keep every fact, decision, number, name, date, version, quote, code span, code block, link and link target: nothing the document says may be lost or change meaning. Keep every heading and the order of sections. Keep every checkbox step, numbered item and table as it is (rows, columns and order); edit only the prose inside them. Elsewhere in a section you may rewrite, reorder, merge or split sentences, and turn prose into a list or a list into prose. Don't add content the original doesn't support, and don't add a summary, an introduction or a conclusion it lacks. Leave conversation labels (question numbers, round numbers, decision IDs) as they are: you weren't there, so you can't know what they meant.

  Read only the files named here. Write the whole edited document to <out> and write nothing else anywhere. Then reply with one line starting "Removed:" that lists anything you removed rather than reworded, or "Removed: nothing".
  ```

- The candidate kinds, as `measure.py` and `prepare.mjs` name them: `nominalization`, `passive`, `abstract subject`,
  `no link to the previous sentence`, `long opener` (over 8 words before the subject), `long subject` (over 7
  words), `subject-verb gap` (over 4 words), `list in a sentence` (four or more parallel items), `wordy`,
  `redundant`, `negative`. Nominalization suffixes: the prototype's 14 (`parse_check.py:90` in
  `docs/features/writing-style/editor-test/scripts/prototype/`), on a spaCy `NOUN`.
- The totals, as `measure.py` names them: words, sentences, mean sentence words, % sentences over 35 words, %
  passive sentences, nominalizations per 100 words, % abstract subjects (nominalization or expletive), mean words
  before subject, % openers over 8 words, mean subject words, % subjects over 7 words, % subject-verb gaps over 4
  words, % adjacent sentences sharing a content word, % sentences opening with old information, filler per 1,000
  words.
- Pins, verbatim: CPython `3.13` (uv-managed), `spacy>=3.8,<3.9`, `en_core_web_trf` from
  `https://github.com/explosion/spacy-models/releases/download/en_core_web_trf-3.8.0/en_core_web_trf-3.8.0-py3-none-any.whl`
  (sha256 `272a31e9d8530d1e075351d30a462d7e80e31da23574f1b274e200f3fff35bf5`), `torch` from the explicit index
  `https://download.pytorch.org/whl/cpu`. uv comes from PATH.
- The environment: `<CONFIG>/flows-prose/` (`CONFIG` is `installer/context.ts:10`: `CLAUDE_CONFIG_DIR` or `~/.claude`),
  holding `env/` (the venv; Python at `env/bin/python`, or `env\Scripts\python.exe` on Windows), `cache/` and
  `python/` (uv's cache and managed Pythons). The opt-out marker is `<CONFIG>/flows-prose.off`. On NixOS (`/etc/NIXOS`
  exists) the Python is the `flows-prose-python` command on PATH.
- The installer's rules (CLAUDE.md **Layout**): new logic goes into `core/` or `system/` with a test next to it, not
  into `install.ts` or a step; programs start through `system/proc.ts`; only erasable TypeScript syntax; imports name
  the `.ts` file; no runtime npm dependencies; the coverage floor (79) is raised, never lowered.
- Tests and code that spawn processes stay out of skill folders (`npm run scan-skills` scans them): `/copyedit`'s Node
  tests live in `scripts/copyedit.test.mjs`. The spaCy test runs only when `FLOWS_PROSE_TEST=1`, so the pre-commit
  hook never loads the model.
- No length limits, no banned-word lists, no grammar or spelling checks.
- Vendored content is never edited by hand: `plugins/flows/packs/pstack-picks/` changes only through
  `scripts/sync-pstack.mjs`, except its hand-written `.claude-plugin/plugin.json`.
- THIRD_PARTY.md changes in the task that adds what it credits.
- Commit messages are one sentence, with no co-author lines. Stage with `git add -u` plus new paths by name, never
  `git add -A`.
- The sandbox runs Node 22.22; `node --test "installer/**/*.test.ts"` runs there (checked 2026-10-28: 121 tests, 0
  failing). Typecheck with `npm ci` once, then `npm run typecheck`.
- Before you write (ponytail, verbatim): "Read the task and the code it touches. List every place your change must
  reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would
  destroy or expose, callers that stop working. That is scope. Extra features are not."
- TDD wins here: every change, trivial ones too, gets its failing test first.

## Review Focus

1. Code spans that pair across list items (a stray backtick in one item): masking still hides only code, for the
   check and for `/copyedit`'s measures alike. Pinned in Task 3 with the line from `web-mcp-search/plan.md:323`.
2. An editor result that drops a section, a code block, a checkbox step or a table row, or is empty or missing:
   `/copyedit` writes nothing and names what was lost. Pinned in Task 5.
3. The installer re-run with the environment current: no download beyond uv's own check; the toggle unticked: the
   folder is removed and the marker keeps it off; flows deselected: the folder is removed without the marker. Pinned
   in Task 11.
4. A Windows delete that fails on a locked file: one failure line, and the summary still prints. Pinned in Task 11.
5. `/copyedit` without the environment, or with one whose model doesn't load: the Node candidates still go to the
   editor, with one line saying spaCy's measures were skipped and why. Pinned in Task 12.

---

### Task 1: The code check (done)

Built in `55d4e4c`, fixed in `2287a4c`: `plugins/flows/hooks/prose.mjs` (`mask`, `newRanges`, `check`, `report`,
`main`), `prose-check.mjs`, `common-terms.txt`, `prose.test.mjs`, `fixtures/clean.md`, and the test glob in
`package.json:9` and `flake.nix:47,75`.

### Task 2: The hooks (done)

Built in `83df561`, fixed in `1ba2a0e`: `plugins/flows/hooks/hooks.json` with one `PostToolUse` entry (matcher
`Write|Edit`) and four handlers, and `hooks.test.mjs`. Task 3 removes the two prompt handlers.

### Task 3: Fix the check, drop the model check, add the off switch

**Files:**

- Modify: `plugins/flows/hooks/prose.mjs` (`mask`, `:38-44`; the label lookup, `:97`; `main`, `:136`)
- Modify: `plugins/flows/hooks/hooks.json` (remove both `type: "prompt"` handlers; the `description`)
- Test: `plugins/flows/hooks/prose.test.mjs`, `plugins/flows/hooks/hooks.test.mjs`

**Interfaces:**

- Produces: `mask(text: string, opts?: { code?: string }): string`; with `code` set, each inline code span becomes that
  word followed by spaces (same length), otherwise spaces as today. `main({ stdin, readFile, terms, env })`, `env`
  defaulting to `process.env`. `hooks.json` with exactly two handlers, both `{"type": "command", "command": "node",
"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs"]}`, one with `"if": "Write(**/*.md)"`, one with `"if":
"Edit(**/*.md)"`.

- [ ] **Step 1: Write the failing tests** in `prose.test.mjs`:
  - `inline code doesn't pair across list items`: ``- a `b` and a stray ` here\n- `pub const REST: Duration` (30 min)`` gives no `undefined` finding for `REST`, and `mask` blanks
    `pub const REST: Duration` but keeps `(30 min)`. The cause (checked 2026-10-28): the inline-code pattern at `:40`
    lets a span run across lines up to a blank line, so one unpaired backtick in an earlier list item inverts the
    pairing. A span ends at a line that starts a new block (a list marker, a heading, a table row, a `>` line) as well
    as at a blank line.
  - `mask can read code as a word`: ``mask('Run `npm test` now', { code: 'X' })`` is `'Run X          now'`.
  - `a label defined mid-line counts as defined`: in a file whose first paragraph says `everything marked _(my call)_
was decided by Claude`, a later `(my call)` gives no finding; so does a later `Q2` after `Q2 (latency): …` in the
    middle of a line. A bare `my call` with no such definition is still flagged.
  - `FLOWS_PROSE_CHECK=off turns the check off`: `main` with `env: { FLOWS_PROSE_CHECK: 'off' }` on text with `Q4`
    returns `{ code: 0, stderr: '' }`.

  In `hooks.test.mjs`, change the structure test to the Interfaces above: two handlers, no `prompt` key anywhere.

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test plugins/flows/hooks/prose.test.mjs plugins/flows/hooks/hooks.test.mjs`
  Expected: FAIL on the five changed tests.

- [ ] **Step 3: Implement.** In `mask`, end an inline span at a line that starts a new block, and add the `code`
      option. In the label lookup, a label also counts as defined after "marked" or "labelled" (with optional emphasis
      and parentheses around it), and when it is followed by a parenthesized gloss and a colon (`Q2 (latency):`)
      anywhere in a line. `main` returns `{ code: 0, stderr: '' }` when `env.FLOWS_PROSE_CHECK === 'off'`. In
      `hooks.json`, drop both prompt handlers; the description becomes "Prose check after every Markdown write or edit:
      prose-check.mjs flags conversation shorthand and undefined abbreviations in the new text. FLOWS_PROSE_CHECK=off
      turns it off."

- [ ] **Step 4: Run the tests**

  Run: `node --test plugins/flows/hooks/*.test.mjs && claude plugin validate plugins/flows`
  Expected: PASS, then "Validation passed" (warnings are fine; errors are not).

- [ ] **Step 5: Re-run the sample.** Pipe a `Write`-shaped hook input naming a scratchpad copy of
      `docs/features/web-mcp-search/plan.md`, then of `spec.md`, to `node plugins/flows/hooks/prose-check.mjs`.

  Expected: plan.md no longer names `REST`; spec.md no longer names `my call` on lines 3, 30, 43 or 56.

- [ ] **Step 6: Commit**

  ```bash
  git add -u
  git commit -m "Fix inline-code masking across list items and mid-line label definitions, drop the Haiku prose check, and add FLOWS_PROSE_CHECK=off."
  ```

### Task 4: The writing skill

**Files:**

- Modify: `scripts/flows-uses.mjs:16-27` (`readUses`) and `:55-58` (`checkUses`'s `flows` key)
- Test: `scripts/flows-uses.test.mjs` (including its `fixture()` at `:21-24`)
- Create: `plugins/flows/skills/writing/SKILL.md`
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Produces: the skill `flows:writing`, model-invocable (no `disable-model-invocation`). `readUses` treats only skills
  with `disable-model-invocation: true` as conductors; `checkUses` accepts a `flows` key whose names are such
  non-conductor skills of flows, and still rejects conductor names under it. `expectedDeps` never lists `flows`.

- [ ] **Step 1: Rewrite the fixture, then write the failing tests.** `fixture()`'s default `skillText` gains a
      frontmatter block with `disable-model-invocation: true`, and every call that passes its own text
      (`'writing-plans'`, `'nope'`, `'gone'`, `'nothing here'`) is wrapped the same way, so the existing tests keep
      testing conductors. Run `node --test scripts/flows-uses.test.mjs`: every existing test passes. Then add, in
      `flows-uses.test.mjs`: `a model-invocable skill is not a conductor` (a fixture plugin with one conductor and one
      plain skill: `readUses` returns only the conductor, and the rendered tree has no block for the plain skill);
      `uses.json may list flows' non-conductor skills` (`{"flows": ["writing"]}` passes `checkUses`, `{"flows":
    ["verify"]}` fails, and `expectedDeps` doesn't contain `flows`). In `writing-skill.test.mjs`: `the writing skill
    is model-invocable and states the rule` (frontmatter `name: writing`, no `disable-model-invocation`, the rule
      verbatim in the first paragraph of the body).

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test scripts/flows-uses.test.mjs scripts/writing-skill.test.mjs`
  Expected: FAIL on the three new tests only.

- [ ] **Step 3: Change `flows-uses.mjs`** to the interfaces above.

- [ ] **Step 4: Write the skill** from the spec's section **The skill**: the rule; the lesson table's lines in our own
      words, each with a before/after example taken from `docs/features/*/` (cite the file); Lesson 9's six operations;
      the density test with a link to `https://github.com/mlwelles/technical-writing-density`; lists for lists; no
      conversation shorthand; the kept rules from `technical-writing` and `unslop`; the credits to Gopen and Swan,
      Strunk and Pinker. Lesson 12 is titled "The Ethics of Style". About three pages. Start from the test's guide,
      `docs/features/writing-style/editor-test/book.md`, rewritten for a writer. Check wording only against the free
      sources in flow.md **Prior art**, never the book's text. Its description triggers on prose a person will read:
      specs, plans, reports, READMEs, PR descriptions, commit messages.

- [ ] **Step 5: Run the tests and the repo checks**

  Run: `node --test scripts/flows-uses.test.mjs scripts/writing-skill.test.mjs && node scripts/check-repo.mjs`
  Expected: PASS, then "repo checks passed".

- [ ] **Step 6: Source check (spec success criterion 2, the skill's half).** Dispatch a fresh `general-purpose` agent
      with the skill, the spec's skill section, flow.md **Prior art**, and
      `plugins/flows/packs/pstack-picks/skills/technical-writing/SKILL.md` and `unslop/SKILL.md` (present until
      Task 7). It reports any lesson stated unfaithfully against the cited free sources (with the source link), any
      sentence that copies a source, and any kept rule of the old skills that is missing. Fix each finding or record
      why not under **Rulings**.

- [ ] **Step 7: Run the skill scanner if `pipx` is available** (`npm run scan-skills`); otherwise record that CI runs
      it. Expected: no high or critical finding for `writing`.

- [ ] **Step 8: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/writing/SKILL.md scripts/writing-skill.test.mjs
  git commit -m "Add the writing skill, Williams and Bizup's Style in our own words, as flows' one prose standard."
  ```

### Task 5: `/copyedit`, without the measures

**Files:**

- Create: `plugins/flows/skills/copyedit/SKILL.md`, `plugins/flows/skills/copyedit/uses.json`
- Create: `plugins/flows/skills/copyedit/references/edit.md`
- Create: `plugins/flows/skills/copyedit/scripts/compare.mjs`
- Modify: `plugins/flows/README.md` (the generated tree, via `node scripts/flows-uses.mjs`)
- Test: `scripts/copyedit.test.mjs`, `scripts/writing-skill.test.mjs`

**Interfaces:**

- Consumes: `check` and `mask` from `prose.mjs` (Task 3).
- Produces:
  - `compare.mjs`: `structure(text: string): { headings: string[], blocks: string[], spans: string[], links: string[],
numbers: string[], checkboxes: string[], tableRows: number }` and `lost(saved: string, edited: string):
string[]` (one line per missing item; headings must keep their order; text is compared with line wrapping
    removed, so rewrapping isn't loss); `newFindings(saved, edited, { file, terms }): Finding[]` (the check's findings
    on the edited text whose `rule` and `match` occur more often than in the saved copy). CLI: `node compare.mjs
<saved> <edited> <file-name>` prints the `lost` lines and exits 1 when any; otherwise prints the new findings as
    `report` does and exits 0. An empty or missing edited file is loss.
  - `/copyedit <file.md>`, a conductor (`disable-model-invocation: true`), callable by the other conductors by reading
    its `SKILL.md`.

- [ ] **Step 1: Write the failing tests.** `scripts/copyedit.test.mjs`, over strings: `lost names a dropped heading, code
    block, link target, number, checkbox step and table row`; `lost accepts rewording and rewrapping` (the same
      content with sentences rewritten and lines rewrapped gives `[]`); `lost flags reordered headings`; `lost treats
    an empty edit as losing everything`; `newFindings ignores labels the original already had` (a saved copy with
      `Q3` and an edit keeping `Q3` and adding `D2` reports only `D2`). `writing-skill.test.mjs`: `copyedit is a
    conductor` (`disable-model-invocation: true`, `uses.json` passes `checkUses`).

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test scripts/copyedit.test.mjs scripts/writing-skill.test.mjs`
  Expected: FAIL, `Cannot find module` for `compare.mjs`, and the conductor test.

- [ ] **Step 3: Write `compare.mjs`** to the interfaces above. `preserve.py` in
      `docs/features/writing-style/editor-test/scripts/` shows the extraction the test used.

- [ ] **Step 4: Write `edit.md`** from `docs/features/writing-style/editor-test/book.md`, the guide the test used, with
      one change: its last section tells the editor to leave conversation labels alone, not to replace them. Run the
      source check of Task 4 Step 6 on it (spec criterion 2, the guide's half).

- [ ] **Step 5: Write `SKILL.md`**, the spec's **The editor** as steps, with paths through
      `${CLAUDE_SKILL_DIR}/../copyedit/` so they resolve when another conductor reads the file:
  1. Copy the document to `<scratchpad>/copyedit/<name>.saved.md`.
  2. (Task 12 adds the measures here.)
  3. The Agent tool with `subagent_type: "general-purpose"`, `model: "opus"`, and the editor prompt from Global
     Constraints, `<out>` = `<scratchpad>/copyedit/<name>.edited.txt`.
  4. `node ${CLAUDE_SKILL_DIR}/../copyedit/scripts/compare.mjs <saved> <out> <file>`. Exit 1: write nothing, show the
     lost items and stop. Exit 0: `cp <out> <file>`; show `git diff --no-index <saved> <file>`, the agent's
     `Removed:` line, and the new findings, if any.

  Commit nothing. `uses.json`: `{"claude-code": ["Agent"]}`. Run `node scripts/flows-uses.mjs`.

- [ ] **Step 6: Run the tests**

  Run: `node --test scripts/copyedit.test.mjs scripts/writing-skill.test.mjs scripts/flows-uses.test.mjs && node scripts/check-repo.mjs`
  Expected: PASS, then "repo checks passed".

- [ ] **Step 7: Try it once** on a scratchpad copy of `docs/features/web-mcp-search/spec.md`. Expected: a diff, a
      `Removed:` line, no lost items; the repo's file unchanged.

- [ ] **Step 8: Run the skill scanner if `pipx` is available.** Expected: no high or critical finding for `copyedit`.

- [ ] **Step 9: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/copyedit scripts/copyedit.test.mjs
  git commit -m "Add /copyedit, which has an Opus editor apply the book to a document and checks its structure before replacing it."
  ```

### Task 6: The copyedit pass and the conductors

**Files:**

- Modify: `plugins/flows/references/flow-rules.md` (a **Copyedit pass** subsection under **Running a flow**, `:24`;
  **Loading skills**, `:106`)
- Modify: `plugins/flows/skills/doc-audit/SKILL.md:19,73-74`, `plugins/flows/skills/doc-audit/uses.json:5`
- Modify: `plugins/flows/skills/integrate/SKILL.md:16,39-41`, `plugins/flows/skills/integrate/uses.json:3`
- Modify: `plugins/flows/README.md` (the generated tree; the `/integrate` row at `:19`)
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Consumes: `flows:writing` (Task 4) and `/copyedit` (Task 5).

- [ ] **Step 1: Extend `writing-skill.test.mjs`** with `the conductors use the writing skill`: doc-audit's and
      integrate's `SKILL.md` and `uses.json` don't match `/\bunslop\b/` or `/\btechnical-writing\b(?!-density)/`; both
      `uses.json` list `"flows": ["writing"]`; `flow-rules.md` names `copyedit/SKILL.md`.

- [ ] **Step 2: Run it to verify it fails.** Run: `node --test scripts/writing-skill.test.mjs`. Expected: FAIL on the
      new test.

- [ ] **Step 3: Edit flow-rules.md**: before a gate shows the user a `spec.md`, a `plan.md` or an audit report, the
      conductor runs `/copyedit` on it (reading `${CLAUDE_SKILL_DIR}/../copyedit/SKILL.md`), each time it goes to a
      gate, and the gate message says it was copyedited; flow.md gets only the check. In **Loading skills**:
      `flows:writing` is model-invocable and loads through the Skill tool.

- [ ] **Step 4: Edit the conductors.** doc-audit Phase 5 runs `flows:writing` over the changed docs; integrate Phase 2
      passes title and body through it. In both `uses.json`, replace the pstack writing entries with `"flows":
    ["writing"]` (integrate keeps `"pstack-picks": ["blast-radius"]`). Run `node scripts/flows-uses.mjs`, then update
      the `/integrate` row's text in flows' README by hand.

- [ ] **Step 5: Run the tests.** Run: `node --test scripts/writing-skill.test.mjs scripts/flows-uses.test.mjs && node
    scripts/check-repo.mjs`. Expected: PASS, then "repo checks passed".

- [ ] **Step 6: Commit**

  ```bash
  git add -u
  git commit -m "Copyedit specs, plans and audit reports before their gates and switch doc-audit and integrate to the writing skill."
  ```

### Task 7: Retire the pstack copies, with pstack's upstream update

**Files:**

- Modify: `scripts/sync-pstack.mjs` (move `unslop` and `technical-writing` from `SKILLS` to `SKIPPED`; extend `GUARD`;
  new `REWRITES`; `SKILL_NOTE`'s example list)
- Modify (by running the sync): `plugins/flows/packs/pstack-picks/` (deletes `skills/unslop/` and
  `skills/technical-writing/`; rewrites `skills/blast-radius/SKILL.md:50`, `skills/recall/SKILL.md:35`,
  `skills/show-me-your-work/SKILL.md:38` and every file's port note; upstream's own changes to `arena` and
  `interrogate`)
- Modify: `plugins/flows/packs/pstack-picks/.claude-plugin/plugin.json:4` (hand-written; the description names
  `unslop`)
- Modify: `.github/workflows/sync-pstack.yml:54` (the skill count, 18 → 16)
- Modify: `THIRD_PARTY.md:39-45`

**Interfaces:**

- Consumes: `flows:writing` from Task 4.

- [ ] **Step 1: Make the sync fail first.** Move the two skills to `SKIPPED` and add `\bunslop\b` and
      `\btechnical-writing\b` to `GUARD`, with a comment that they are retired names. Run `node scripts/sync-pstack.mjs`.

  Expected: FAIL, naming `blast-radius/SKILL.md`, `recall/SKILL.md`, `show-me-your-work/SKILL.md` and the port note.

- [ ] **Step 2: Add the rewrites.** `REWRITES` turn "Write the brief through the **unslop** skill", "Write it through
      `unslop`" and "(the **unslop** skill applies to log text too)" into references to flows' **writing** skill
      (`flows:writing`, through the Skill tool). In `SKILL_NOTE`, replace **unslop** in the example list with
      **recall**.

- [ ] **Step 3: Run the sync**

  Run: `node scripts/sync-pstack.mjs && git status --short plugins/flows/packs/pstack-picks && node scripts/check-repo.mjs`
  Expected: "pstack-picks synced to c742dd6… (changed)" (upstream was at `c742dd6` on 2026-10-28; a newer one is fine
  if the only other changes are upstream's); the two deletions, the rewritten files, and upstream's changes to
  `arena/SKILL.md` and `interrogate/` (four reference files deleted); "repo checks passed" (the quote check holds).
  Any other change, or a conductor naming a deleted file (`grep -rn interrogate/references plugins/flows/skills`):
  stop and report it as a deviation.

- [ ] **Step 4: Edit by hand** the pstack-picks `plugin.json` description (drop `unslop`), the count in
      `sync-pstack.yml:54` (16), and THIRD_PARTY.md's pstack-picks section (the commit, the two writing skills not
      vendored, replaced by flows' writing skill, the sync rewriting the references to them).

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: "repo checks passed", every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add scripts/sync-pstack.mjs
  git commit -m "Stop vendoring pstack's technical-writing and unslop, point their references at the writing skill, and take pstack's upstream update."
  ```

### Task 8: Docs and descriptions for the core

**Files:**

- Modify: `plugins/flows/README.md` (a section on the writing skill, the check and `/copyedit`: what the check flags,
  that it costs no model call, `FLOWS_PROSE_CHECK=off`)
- Modify: `plugins/flows/.claude-plugin/plugin.json:4` and flows' entry in `.claude-plugin/marketplace.json`
- Modify: `README.md` (the flows paragraph at `:18-24`)
- Modify: `CLAUDE.md` (the `plugins/flows/` bullet: the writing skill, the check and its off switch, `/copyedit` and
  the Opus editor; the `plugins/flows/packs/` bullet: pstack's two writing skills aren't vendored; **Vendored
  content**: pstack-picks' `plugin.json` is hand-written; **Checks**: the flows hook tests in `npm test`)
- Modify: `THIRD_PARTY.md` (technical-writing-density, MIT, paraphrased)
- Modify: `GLOSSARY.md` (prose check: code only, `FLOWS_PROSE_CHECK`; copyedit pass: run by `/copyedit`)

**Interfaces:** none.

- [ ] **Step 1: Write the docs** with the writing skill, then run the check over each changed Markdown file by piping
      a `Write`-shaped input naming it to `node plugins/flows/hooks/prose-check.mjs`.

  Expected: exit 0, or findings that are fixed or judged wrong.

- [ ] **Step 2: Run `npm test`.** Expected: "repo checks passed", every test passes.

- [ ] **Step 3: Commit**

  ```bash
  git add -u
  git commit -m "Describe the writing skill, the prose check and /copyedit in the docs, descriptions and credits."
  ```

### Task 9: The Node half of the measures

**Files:**

- Create: `plugins/flows/skills/copyedit/scripts/prepare.mjs`
- Create: `plugins/flows/skills/copyedit/data/phrases.tsv`
- Test: `scripts/copyedit.test.mjs`
- Modify: `THIRD_PARTY.md` (plainlanguage.gov, CC0; Strunk, public domain)

**Interfaces:**

- Consumes: `mask(text, { code: 'X' })` from Task 3.
- Produces, from `prepare.mjs`: `blocks(masked: string): Array<[number, number]>` (paragraphs, headings, list items,
  table cells); `loadPhrases(tsv: string): Phrase[]`, `Phrase = { kind: 'wordy' | 'redundant' | 'negative' | 'filler',
phrase: string, replacement: string, source: string }`; `findPhrases(masked: string, phrases: Phrase[]):
Candidate[]`, `Candidate = { line: number, kind: string, text: string, note: string }`, case-insensitive on word
  boundaries, `filler` rows never candidates; `prepare(text: string, phrases: Phrase[]): { masked: string, blocks,
candidates: Candidate[], filler: number }`; `formatCandidates(candidates: Candidate[]): string` (`line N: <kind>:
"<text>" (<note>)` per line). CLI: `node prepare.mjs <file.md> <outdir>` writes `<outdir>/prep.json` and
  `<outdir>/candidates.txt`.

- [ ] **Step 1: Write the failing tests** in `scripts/copyedit.test.mjs`: `blocks splits lists, tables and headings`;
      `findPhrases finds wordy, redundant and negative phrases` ("in order to" → `wordy` with note "to"; "each and
      every" → `redundant`; "not many" → `negative`; nothing inside a longer word or inside code); `filler counts but
    isn't a candidate`; `prepare keeps the masked text's length`; `formatCandidates` on two candidates.

- [ ] **Step 2: Run them to verify they fail.** Run: `node --test scripts/copyedit.test.mjs`. Expected: FAIL,
      `Cannot find module` for `prepare.mjs`.

- [ ] **Step 3: Write `phrases.tsv` and `prepare.mjs`.** The TSV's header is `kind\tphrase\treplacement\tsource`. Its
      rows come from plainlanguage.gov's "Use simple words and phrases", "Avoid hidden verbs" and "Use positive
      language" (CC0, `github.com/GSA/plainlanguage.gov`, `_pages/guidelines/words/`) and Strunk's rules 11 and 13
      (1920, Gutenberg 37134), each naming its source; the `filler` rows are `metrics.py`'s `FILLER` list (source
      `writing-style`). The prototype's tables (`editor-test/scripts/prototype/parse_check.py:35-85`) show which
      entries the test used; single-word substitutions are left out, as there.

- [ ] **Step 4: Run the tests.** Run: `node --test scripts/copyedit.test.mjs && node scripts/check-repo.mjs`.
      Expected: PASS, then "repo checks passed".

- [ ] **Step 5: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/copyedit/scripts/prepare.mjs plugins/flows/skills/copyedit/data/phrases.tsv
  git commit -m "Add /copyedit's Node measures: shared masking, block splitting and the phrase candidates."
  ```

### Task 10: The spaCy measures and their environments

**Files:**

- Create: `plugins/flows/skills/copyedit/scripts/measure.py`
- Create: `installer/assets/prose/pyproject.toml`, `installer/assets/prose/uv.lock`
- Modify: `flake.nix` (a `packages` output with `flows-prose`)
- Create: `scripts/fixtures/prose-sample.md`
- Test: `scripts/copyedit.test.mjs`
- Modify: `.github/workflows/test.yml:48` (also `grep -qx package/installer/assets/prose/uv.lock packed.txt`)
- Modify: `THIRD_PARTY.md` (downloaded at install, not vendored: CPython, spaCy, `en_core_web_trf`, PyTorch and their
  dependencies, with their licenses; on NixOS from nixpkgs)

**Interfaces:**

- Consumes: `prep.json` from Task 9.
- Produces: `python measure.py <outdir>/prep.json` rewrites `<outdir>/candidates.txt` with the phrase candidates and
  the spaCy candidates (the kinds in Global Constraints), sorted by line, and writes `<outdir>/totals.json` (the
  totals in Global Constraints). It exits 3 with one line on stderr when spaCy or the model can't load (any
  exception), and 1 when `prep.json` can't be read. `spacy.load('en_core_web_trf')` once, `n_process=1`.
- `flake.nix`: `packages.x86_64-linux.flows-prose`, a `writeShellScriptBin "flows-prose-python"` that execs a
  `python313.withPackages` holding spaCy and `spacy-models.en_core_web_trf` (attribute names checked with `nix eval`).

- [ ] **Step 1: Write the project files** (`pyproject.toml`):

  ```toml
  [project]
  name = "flows-prose"
  version = "0"
  requires-python = "==3.13.*"
  dependencies = ["spacy>=3.8,<3.9", "en_core_web_trf", "torch"]

  [tool.uv]
  package = false
  environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'", "sys_platform == 'win32' and platform_machine == 'AMD64'"]

  [tool.uv.sources]
  torch = { index = "pytorch-cpu" }
  en_core_web_trf = { url = "https://github.com/explosion/spacy-models/releases/download/en_core_web_trf-3.8.0/en_core_web_trf-3.8.0-py3-none-any.whl" }

  [[tool.uv.index]]
  name = "pytorch-cpu"
  url = "https://download.pytorch.org/whl/cpu"
  explicit = true
  ```

  Run `uv lock --project installer/assets/prose`. Expected: torch resolves to a `+cpu` version for both
  environments, the model wheel carries sha256 `272a31e9…5bf5`, and no `nvidia-*` package is in the lock. Then
  build the test environment from them: `UV_PROJECT=installer/assets/prose
UV_PROJECT_ENVIRONMENT=<scratchpad>/flows-prose/env UV_CACHE_DIR=<scratchpad>/flows-prose/cache
UV_PYTHON_INSTALL_DIR=<scratchpad>/flows-prose/python uv sync --frozen --managed-python --no-dev`.

- [ ] **Step 2: Write the failing test** in `scripts/copyedit.test.mjs`: `measure finds the tested kinds`, skipped
      unless `FLOWS_PROSE_TEST=1`; it runs `prepare.mjs` and then `$FLOWS_PROSE_PYTHON measure.py` on
      `scripts/fixtures/prose-sample.md`, whose lines carry `<!-- expect: <kind> -->` comments, and asserts one
      candidate of each expected kind on its line, none in the fixture's fenced block, and the 15 totals keys. Run it
      with `FLOWS_PROSE_TEST=1 FLOWS_PROSE_PYTHON=<scratchpad>/flows-prose/env/bin/python`. Expected: FAIL, no
      `measure.py`.

- [ ] **Step 3: Write `measure.py`.** Port `editor-test/scripts/metrics.py`'s measures and thresholds and the
      prototype's passive, nominalization (the 14 suffixes on a `NOUN`, with the light-verb and weak-verb-subject
      rules of `parse_check.py`, without WordNet) and list rules, over `prep.json`'s masked text and blocks.

- [ ] **Step 4: Run the test** as in Step 2. Expected: PASS. Then `npm test` without `FLOWS_PROSE_TEST`: the test is
      skipped and everything else passes.

- [ ] **Step 5: The NixOS package.** Add `flows-prose` to `flake.nix`, then run `nix build .#flows-prose` and the
      Step 2 test with `FLOWS_PROSE_PYTHON=./result/bin/flows-prose-python`. Expected: it builds and the test passes.
      If nixpkgs' spaCy or model attribute doesn't evaluate, stop and report it as a deviation.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/copyedit/scripts/measure.py installer/assets/prose scripts/fixtures/prose-sample.md
  git commit -m "Add /copyedit's spaCy measures with a locked uv project and a flows-prose Nix package for NixOS."
  ```

### Task 11: The installer's prose toggle

**Files:**

- Create: `installer/core/prose.ts`, `installer/core/prose.test.ts`
- Create: `installer/steps/prose.ts`
- Modify: `installer/system/files.ts` (a `removeDir` helper), `installer/system/files.test.ts`
- Modify: `installer/core/options.ts:32` (`TOGGLES` gains `prose`), `:70` (the tools page), `HINTS`, `unavailable`
  (only `linux-x64` and `win32-x64`)
- Modify: `installer/install.ts` (`current`, `chosen`, the step call last before the summary)
- Test: `installer/core/options.test.ts`

**Interfaces:**

- Consumes: `which` and `startSync` (`system/proc.ts`), `ASSETS` and `CONFIG` (`context.ts`).
- Produces, from `core/prose.ts`:
  - `proseDir(config: string): string` → `join(config, 'flows-prose')`; `proseMarker(config)` → `join(config,
'flows-prose.off')`.
  - `prosePython(config: string, platform: string): string` → `<dir>/env/bin/python`, or `<dir>\env\Scripts\python.exe`
    on `win32`.
  - `proseSync(assets: string, config: string): { args: string[], env: Record<string, string> }` → `args: ['sync',
'--frozen', '--managed-python', '--no-dev']`, `env: { UV_PROJECT: join(assets, 'prose'), UV_PROJECT_ENVIRONMENT:
    <dir>/env, UV_CACHE_DIR: <dir>/cache, UV_PYTHON_INSTALL_DIR: <dir>/python }`.
  - `proseDecision({ toggle, flows, nixos, installed }): 'nix' | 'sync' | 'remove' | 'needs-flows' | 'none'`: `nix`
    when toggle and flows are on on NixOS; `sync` when they are on elsewhere; `remove` when the environment is
    installed and toggle or flows is off; `needs-flows` when the toggle is on without flows; else `none`.
  - `proseDefault({ installed, optedOut, flows }): boolean` → `installed || (flows && !optedOut)`.
  - `uvHint(platform: string): string` → `winget install -e --id astral-sh.uv` on `win32`, `curl -LsSf
https://astral.sh/uv/install.sh | sh` elsewhere.
- From `system/files.ts`: `removeDir(path: string): string | undefined` (`rmSync` with `recursive`, `force` and
  `maxRetries: 5`; the error code on failure).
- `steps/prose.ts` exports `applyProse({ toggle, flows, unticked }: { toggle: boolean, flows: boolean, unticked:
boolean }): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** `core/prose.test.ts`: `prosePython per platform`; `proseSync keeps uv's
    files inside flows-prose`; `proseDecision` over its cases; `proseDefault` over its cases; `uvHint per platform`.
      `options.test.ts`: `prose is a tools toggle, unavailable off linux-x64 and win32-x64`. `files.test.ts`:
      `removeDir removes a tree and reports a failure instead of throwing` (a missing path is fine; a path under a
      read-only parent returns a code).

- [ ] **Step 2: Run them to verify they fail.** Run: `node --test installer/core/prose.test.ts
    installer/core/options.test.ts installer/system/files.test.ts`. Expected: FAIL, `core/prose.ts` not found.

- [ ] **Step 3: Implement `core/prose.ts`, `removeDir`, the toggle and the step.** The step, by `proseDecision`:
  - `sync`: `which('uv')`; missing is a failure line naming `uvHint`. Otherwise `startSync(uv, args, { stdio:
'inherit', env: { ...process.env, ...env } })`, then the smoke test `<python> -c "import spacy;
spacy.load('en_core_web_trf')"`; delete the marker; a `done` line ("prose: spaCy and en_core_web_trf ready in
    <dir>") or a failure line with the exit code.
  - `nix`: `which('flows-prose-python')`; present: the same smoke test with it; missing: a `done` line with "nix
    profile install github:deadmade/dead-claude-skills#flows-prose, or add that flake's flows-prose package to
    home.packages".
  - `remove`: `removeDir(proseDir(CONFIG))`; write the marker only when `unticked` (the user turned it off, not flows
    removed); a `done` line, or a failure line naming the folder to delete by hand.
  - `needs-flows`: a `done` line, "prose: needs flows, nothing set up".

  In `install.ts`: `installed` is `existsSync(prosePython(CONFIG, process.platform))`, or `flows-prose-python` on PATH
  on NixOS; `current.prose = installed`; `chosen.prose = proseDefault({ installed, optedOut:
existsSync(proseMarker(CONFIG)), flows: chosen[FLOWS] })`; call `applyProse` last, before the summary, with
  `unticked: current.prose && !on('prose')`.

- [ ] **Step 4: Run the checks.** Run: `node --test "installer/**/*.test.ts"` with the coverage flags of
      `package.json:9`, then `npm ci && npm run typecheck`. Expected: every test passes, coverage at or above the
      floor, no type errors.

- [ ] **Step 5: Run the step for real on Linux** against a scratchpad config folder:
      `CLAUDE_CONFIG_DIR=<scratchpad>/cfg node --input-type=module -e "import('./installer/steps/prose.ts').then(m =>
    m.applyProse({ toggle: true, flows: true, unticked: false }))"`, twice, then with `toggle: false, unticked:
    true`.

  Expected: the first run syncs and the smoke test loads the model; the second downloads nothing; the third removes
  `<scratchpad>/cfg/flows-prose/` and writes `flows-prose.off`.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add installer/core/prose.ts installer/core/prose.test.ts installer/steps/prose.ts
  git commit -m "Add the installer's prose toggle, which syncs /copyedit's spaCy environment with uv, or points NixOS at the flake package."
  ```

### Task 12: `/copyedit` measures, and their docs

**Files:**

- Modify: `plugins/flows/skills/copyedit/SKILL.md` (step 2)
- Modify: `plugins/flows/README.md`, `README.md` (the installer's tools page), `CLAUDE.md` (the installer bullet: the
  prose step, the lock and how to update it, `flake.nix`'s package; **Checks**: `FLOWS_PROSE_TEST`)

**Interfaces:**

- Consumes: `prepare.mjs` (Task 9), `measure.py` (Task 10), the environment's paths (Task 11).

- [ ] **Step 1: Write step 2 of `SKILL.md`.** Run `node ${CLAUDE_SKILL_DIR}/../copyedit/scripts/prepare.mjs <file>
    <scratchpad>/copyedit/`. Find the Python: `flows-prose-python` on PATH, else
      `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/flows-prose/env/bin/python` (`env/Scripts/python.exe` on Windows). When it exists, run `measure.py` on `prep.json`
      with the Bash tool's timeout at 600000 ms. No Python, exit 1 or 3, or a timeout: one line saying spaCy's measures
      were skipped and why, and the Node candidates go to the editor alone. Pass `candidates.txt` as `<candidates>`.
      After the copy, run both again on the new file and show the totals before and after as a table.

- [ ] **Step 2: Try it** on a scratchpad copy of `docs/features/web-mcp-search/spec.md`, once with
      `flows-prose-python` pointing at the Task 10 environment and once without. Expected: a candidates file with
      spaCy kinds, then one with phrase kinds only and the skip line; both runs end with a diff and no lost items.

- [ ] **Step 3: Write the docs**, then run the check over each changed Markdown file as in Task 8. Run `npm test`.
      Expected: "repo checks passed", every test passes.

- [ ] **Step 4: Commit**

  ```bash
  git add -u
  git commit -m "Feed /copyedit's editor the spaCy candidates when the prose environment exists, and document it."
  ```

### Task 13: Acceptance

**Files:**

- Modify: `docs/features/writing-style/flow.md` (results)
- Create: `docs/features/writing-style/editor-test/acceptance/` (the re-run's versions and rankings)

**Interfaces:** none.

- [ ] **Step 1: Spec success criterion 3.** Run `FLOWS_PROSE_TEST=1 FLOWS_PROSE_PYTHON=<scratchpad>/cfg/flows-prose/env/bin/python
    node --test scripts/copyedit.test.mjs` on the Task 11 environment, and again with the Nix package's
      `flows-prose-python`. Expected: both pass with no test skipped. Record Windows and the user's NixOS machine as
      untested until the user runs the installer there.

- [ ] **Step 2: Spec success criterion 4.** Run `/copyedit` as shipped on scratchpad copies of
      `docs/features/web-mcp-search/spec.md` and `findings.md` at commit `8281c59`. Score as
      `docs/features/writing-style/editor-test/README.md` describes, with three versions per section: the original,
      the stored `plain` version, and the new one. Two blind rankings per document (Sonnet and Fable judges) and the
      fact check against `data/<doc>.facts.jsonl`.

  Expected: the new version's mean rank beats `plain`'s over the four rankings and is worse in none; at most 1 of the
  304 claims lost or changed. A miss goes to the user under **Deviations**.

- [ ] **Step 3: Spec success criterion 5.** In a scratchpad folder, run
      `claude -p "Write a short spec for adding a --json flag to a CLI tool, as docs/spec.md, in the style a long design
    session would leave: refer to decisions as grill Q3 and D2. Revise the file after any hook feedback." --plugin-dir
    <dependency-free copy of plugins/flows> --permission-mode acceptEdits --output-format stream-json --verbose <
    /dev/null` (the copy as in flow.md **Rulings**).

  Expected: check findings appear, Claude revises, and the run ends with no more than three rounds of findings on the
  same file. More than three is looping: record it under **Deviations** for a counter.

- [ ] **Step 4: Record the results in flow.md and commit**

  ```bash
  git add -u && git add docs/features/writing-style/editor-test/acceptance
  git commit -m "Record the writing-style acceptance runs in its flow."
  ```
