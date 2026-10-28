# Writing style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one writing skill based on Williams and Bizup's _Style_ inside flows, check every Markdown write for
conversation shorthand and undefined abbreviations, give flows a `/copyedit` editor that applies the book with
candidates spaCy measures, have the installer set up its Python environment, and retire pstack's `technical-writing`
and `unslop`.

**Architecture:** The plugin parts live in flows: the Node check (`hooks/prose.mjs`, entry `hooks/prose-check.mjs`)
runs as a `PostToolUse` command hook; `skills/writing/` is the writers' standard; `skills/copyedit/` measures a
document with a Python script, hands the candidates and an editing guide to a fresh Opus agent, and shows the diff;
`references/flow-rules.md` runs `/copyedit` before spec, plan and audit-report gates. The installer gets a `prose`
toggle whose step finds or downloads a pinned `uv` and syncs a locked Python project (`installer/assets/prose/`) into
`<config>/flows-prose/`.

**Tech Stack:** Node's standard library (`node:test`), Claude Code plugin hooks and skills, Python 3.13 with spaCy 3.8
and `en_core_web_trf` 3.8.0 on CPU-only PyTorch, `uv` 0.13.6, the installer's TypeScript (Node 26, type stripping).

**Spec:** [spec.md](spec.md), approved 2026-10-27 and, revised, 2026-10-28.

This plan replaces the first one after its Task 3 gate missed. Tasks 1 and 2 are built (commits `55d4e4c`,
`2287a4c`, `83df561`, `1ba2a0e`); numbering continues from there.

## Global Constraints

- The rule, verbatim: _write for a smart reader who wasn't there, and omit needless words._
- Which files are checked: resolved in flows' `hooks/hooks.json` (matchers and `if` filters) and in `prose.mjs` (the
  flow.md exception); never seen by the skill, the editor or the conductors.
- When a document is copyedited: resolved in `flow-rules.md`; never seen by the hook or by each conductor's own gate
  text.
- How a document is edited: resolved in `/copyedit` and its guide; the conductors run it and never restate its steps.
- Where the Python environment is: resolved in the installer's prose step and in `/copyedit`'s measure step; never
  seen by `measure.py`, the editor agent or the conductors.
- What the writing standard says: resolved in the `writing` skill and the editing guide; the conductors name them and
  never restate their rules.
- The closing line of every check report, verbatim: "Fix what makes the prose worse for a reader. Leave a sentence as
  is when the finding is wrong."
- The check judges only the new text (a `Write`'s `content`, an `Edit`'s `new_string`), never looks inside code
  (fenced or inline), front matter, link targets or block quotes, and reports at most 10 findings. Its shorthand rule
  is off in files named `flow.md`. It uses Node's standard library only, runs in exec form (`"command": "node"`,
  `"args"`), exits 2 with findings on stderr, and exits 0 silently with none or on any error. No model runs on any
  write.
- The editor runs on Opus (`model: "opus"` on the Agent call), as a fresh `general-purpose` agent that writes
  nothing: it returns the edited document as text. `/copyedit` commits nothing.
- The editor prompt, verbatim, with `<doc>`, `<guide>` and `<candidates>` filled in; the bracketed paragraph only when
  candidates exist:

  ```
  You are a copy editor. Edit the Markdown document <doc> so it reads clearly to a smart reader who was not in the conversation that produced it.

  Edit by the method in <guide>: run its diagnoses on every sentence and paragraph, then revise where a diagnosis shows a problem and the change helps the reader.

  [Code has measured the document against the book and listed candidate problems by line in <candidates> (code spans appear as "X"). Judge each candidate by the book: fix it when the fix helps the reader, leave it when it doesn't (many passives and long openers are fine). The list is a starting point, not a limit: diagnose the sentences it doesn't name too.]

  Keep every fact, decision, number, name, date, version, quote, code span, code block, link and link target: nothing the document says may be lost or change meaning. Keep every heading and the order of sections. Inside a section you may rewrite, reorder, merge or split sentences, and turn prose into a list or a list into prose. Don't add content the original doesn't support, and don't add a summary, an introduction or a conclusion it lacks. Leave conversation labels (question numbers, round numbers, decision IDs) as they are: you weren't there, so you can't know what they meant.

  Read only the files named here. Reply with the whole edited document between a line =====BEGIN===== and a line =====END=====, then a line starting "Removed:" that lists anything you removed rather than reworded, or says "Removed: nothing".
  ```

- The measures, as `measure.py` names them in `totals`, with the candidate thresholds: words, sentences, mean
  sentence words, % sentences over 35 words, % passive sentences, nominalizations per 100 words, % abstract subjects
  (nominalization or expletive), mean words before subject, % openers over 8 words, mean subject words, % subjects
  over 7 words, % subject-verb gaps over 4 words, % adjacent sentences sharing a content word, % sentences opening with
  old information, filler per 1,000 words.
- Pins, verbatim: CPython `3.13` (uv-managed), `spacy>=3.8,<3.9`, `en_core_web_trf` from
  `https://github.com/explosion/spacy-models/releases/download/en_core_web_trf-3.8.0/en_core_web_trf-3.8.0-py3-none-any.whl`
  (sha256 `272a31e9d8530d1e075351d30a462d7e80e31da23574f1b274e200f3fff35bf5`), `torch` from the explicit index
  `https://download.pytorch.org/whl/cpu`, `uv` 0.13.6 from `https://github.com/astral-sh/uv/releases/download/<ver>/`
  (`uv-x86_64-unknown-linux-musl.tar.gz`, `uv-x86_64-pc-windows-msvc.zip`; per-asset `<asset>.sha256`).
- The environment lives in `<CONFIG>/flows-prose/` (`CONFIG` is `installer/context.ts:10`: `CLAUDE_CONFIG_DIR` or
  `~/.claude`). Its Python is `bin/python` on Linux and `Scripts/python.exe` on Windows.
- The installer's rules (CLAUDE.md **Layout**): new logic goes into `core/` or `system/` with a test next to it, not
  into `install.ts` or a step; programs start through `system/proc.ts`; only erasable TypeScript syntax; imports name
  the `.ts` file; no runtime npm dependencies; the coverage floor (79) is raised, never lowered.
- No length limits, no banned-word lists, no grammar or spelling checks.
- Vendored content is never edited by hand: `plugins/flows/packs/pstack-picks/` changes only through
  `scripts/sync-pstack.mjs`, except its hand-written `.claude-plugin/plugin.json`.
- Commit messages are one sentence, with no co-author lines. Stage with `git add -u` plus new paths by name, never
  `git add -A`.
- The sandbox runs Node 22.22, so the installer's own tests don't run here (they need Node 26's type stripping); CI
  runs them on Linux and Windows. The `scripts/` and hook tests pass on 22.
- Before you write (ponytail, verbatim): "Read the task and the code it touches. List every place your change must
  reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would
  destroy or expose, callers that stop working. That is scope. Extra features are not."
- TDD wins here: every change, trivial ones too, gets its failing test first.

## Review Focus

1. A Markdown file whose code spans pair across list items (a stray backtick in one item): masking still hides only
   code, in both `prose.mjs` and `prose_text.py`. Pinned in Tasks 3 and 5 with the line from
   `web-mcp-search/plan.md:323`.
2. `/copyedit` on a machine without the environment, or with a broken one (spaCy missing, model missing): the measure
   step is skipped with one line saying why, and the edit still runs. Pinned in Task 8.
3. The editor's reply without the markers, or cut off: `/copyedit` writes nothing and says so. Pinned in Task 8.
4. The installer re-run with the environment already current: no download, no re-sync beyond uv's own check; with the
   toggle turned off: the folder is removed. Pinned in Task 7.
5. A `uv` on PATH older than the pin, or a `uv --version` that prints something unexpected: ours is downloaded and
   used; graphify's copy on PATH is left alone. Pinned in Task 6.

---

### Task 1: The code check (done)

Built in `55d4e4c`, fixed in `2287a4c`: `plugins/flows/hooks/prose.mjs` (`mask`, `newRanges`, `check`, `report`,
`main`), `prose-check.mjs`, `common-terms.txt`, `prose.test.mjs`, `fixtures/clean.md`, and the test glob in
`package.json:9` and `flake.nix:47,75`.

### Task 2: The hooks (done)

Built in `83df561`, fixed in `1ba2a0e`: `plugins/flows/hooks/hooks.json` with one `PostToolUse` entry (matcher
`Write|Edit`) and four handlers, and `hooks.test.mjs`. Task 3 removes the two prompt handlers.

### Task 3: Fix the check and drop the model check

**Files:**

- Modify: `plugins/flows/hooks/prose.mjs` (`mask`, at `:40`; the label-definition lookup, at `:97`)
- Modify: `plugins/flows/hooks/hooks.json` (remove both `type: "prompt"` handlers; the `description`)
- Test: `plugins/flows/hooks/prose.test.mjs`, `plugins/flows/hooks/hooks.test.mjs`

**Interfaces:**

- Produces: `hooks.json` with exactly two handlers, both `{"type": "command", "command": "node", "args":
["${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs"]}`, one with `"if": "Write(**/*.md)"`, one with `"if":
"Edit(**/*.md)"`. `prose.mjs`'s exports keep their signatures.

- [ ] **Step 1: Write the failing tests** in `prose.test.mjs`:
  - `inline code doesn't pair across list items`: the text ``- a `b` and a stray ` here\n- `pub const REST: Duration` (30 min)`` gives no `undefined` finding for `REST`, and `mask` blanks
    `pub const REST: Duration` but keeps `(30 min)`. The cause (checked 2026-10-28): `mask`'s inline-code pattern lets
    a span run across lines up to a blank line, so one unpaired backtick in an earlier list item inverts the pairing.
    A span ends at a line that starts a new block (a list marker, a heading, a table row, a `>` line) as well as at a
    blank line.
  - `a label defined mid-line counts as defined`: in a file whose first paragraph says `everything marked _(my call)_
was decided by Claude`, a later `(my call)` gives no finding; so does a later `Q2` after `Q2 (latency): …` in the
    middle of a line. A bare `my call` with no such definition is still flagged.

  In `hooks.test.mjs`, change the structure test to the Interfaces above: two handlers, no `prompt` key anywhere.

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test plugins/flows/hooks/prose.test.mjs plugins/flows/hooks/hooks.test.mjs`
  Expected: FAIL on the three changed tests.

- [ ] **Step 3: Fix `mask`** so an inline span stops at a line that starts a new block, and **the label lookup** so a
      label also counts as defined after "marked" or "labelled" (with optional emphasis and parentheses around it), and
      when it is followed by a parenthesized gloss and a colon (`Q2 (latency):`) anywhere in a line. **Edit
      `hooks.json`**: drop both prompt handlers; the description becomes "Prose check after every Markdown write or
      edit: prose-check.mjs flags conversation shorthand and undefined abbreviations in the new text."

- [ ] **Step 4: Run the tests**

  Run: `node --test plugins/flows/hooks/*.test.mjs && claude plugin validate plugins/flows`
  Expected: PASS, then "Validation passed" (warnings are fine; errors are not).

- [ ] **Step 5: Re-run the sample** to see the effect: pipe a `Write`-shaped hook input naming a scratchpad copy of
      `docs/features/web-mcp-search/plan.md`, then of `spec.md`, to `node plugins/flows/hooks/prose-check.mjs`.

  Expected: plan.md no longer names `REST`; spec.md no longer names `my call` on lines 3, 30, 43 or 56.

- [ ] **Step 6: Commit**

  ```bash
  git add -u
  git commit -m "Fix inline-code masking across list items and mid-line label definitions, and drop the Haiku prose check."
  ```

### Task 4: The writing skill

**Files:**

- Modify: `scripts/flows-uses.mjs:16-27` (`readUses`) and `:55-58` (`checkUses`'s `flows` key)
- Test: `scripts/flows-uses.test.mjs`
- Create: `plugins/flows/skills/writing/SKILL.md`
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Produces: the skill `flows:writing`, model-invocable (no `disable-model-invocation`). `readUses` treats only skills
  with `disable-model-invocation: true` as conductors; `checkUses` accepts a `flows` key whose names are such
  non-conductor skills of flows, and still rejects conductor names under it. `expectedDeps` never lists `flows`.

- [ ] **Step 1: Write the failing tests.** In `flows-uses.test.mjs`: `a model-invocable skill is not a conductor` (a
      fixture plugin with one conductor and one plain skill: `readUses` returns only the conductor, and the rendered
      tree has no block for the plain skill); `uses.json may list flows' non-conductor skills` (`{"flows": ["writing"]}`
      passes `checkUses`, `{"flows": ["verify"]}` fails, and `expectedDeps` doesn't contain `flows`). In
      `writing-skill.test.mjs`: `the writing skill is model-invocable and states the rule` (frontmatter `name: writing`,
      no `disable-model-invocation`, the rule verbatim in the first paragraph of the body).

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test scripts/flows-uses.test.mjs scripts/writing-skill.test.mjs`
  Expected: FAIL on the three new tests.

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
      Task 10). It reports any lesson stated unfaithfully against the cited free sources (with the source link), any
      sentence that copies a source, and any kept rule of the old skills that is missing. Fix each finding or record why
      not under **Rulings**.

- [ ] **Step 7: Run the skill scanner if `pipx` is available** (`npm run scan-skills`); otherwise record that CI runs
      it. Expected: no high or critical finding for `writing`.

- [ ] **Step 8: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/writing/SKILL.md scripts/writing-skill.test.mjs
  git commit -m "Add the writing skill, Williams and Bizup's Style in our own words, as flows' one prose standard."
  ```

### Task 5: The prose measures

**Files:**

- Create: `plugins/flows/skills/copyedit/scripts/prose_text.py` (standard library only)
- Create: `plugins/flows/skills/copyedit/scripts/measure.py`
- Create: `plugins/flows/skills/copyedit/data/phrases.tsv`, `plugins/flows/skills/copyedit/data/nominalizations.txt`
- Create: `plugins/flows/skills/copyedit/scripts/gen_nominalizations.py`
- Test: `plugins/flows/skills/copyedit/scripts/test_prose_text.py`, `test_measure.py`, `measure.test.mjs`,
  `fixtures/sample.md`
- Modify: `package.json:9`, `flake.nix:47` (add `plugins/flows/skills/*/scripts/*.test.mjs`), `flake.nix:75` (add
  `plugins/flows/skills/` to the `files` regex)

**Interfaces:**

- Produces, from `prose_text.py`:
  - `mask(text: str) -> str`: same length and newlines as `text`; fenced code, front matter, link targets, HTML
    comments and `>` lines become spaces; each inline code span becomes `X` followed by spaces, so sentences still
    parse. Inline spans end at a blank line or a line that starts a new block (Task 3's rule).
  - `blocks(masked: str) -> list[tuple[int, int]]`: the spans of paragraphs, headings, list items and table cells, so
    no sentence crosses two.
  - `load_phrases(path: str) -> list[Phrase]`, `Phrase = namedtuple('Phrase', 'kind phrase replacement source')`,
    `kind` in `wordy | redundant | negative | metadiscourse | filler`.
  - `find_phrases(text: str, phrases: list[Phrase]) -> list[tuple[int, int, Phrase]]`: case-insensitive, on word
    boundaries.
- Produces, from `measure.py`:
  - `measure(text: str, nlp) -> dict`: `{"candidates": [{"line": int, "kind": str, "text": str, "note": str}],
"totals": {<the measures in Global Constraints>: number}}`. Candidate kinds: `nominalization`, `passive`,
    `abstract subject`, `no link to the previous sentence`, `weak ending`, `long opener`, `long subject`,
    `subject-verb gap`, `long sentence`, and the five phrase kinds.
  - CLI: `python measure.py <file.md>` prints that dict as JSON; exits 3 with one line on stderr when spaCy or the
    model can't load, and 1 when the file can't be read.

- [ ] **Step 1: Write the failing tests.**
  - `test_prose_text.py` (`unittest`, no spaCy): `test_mask_keeps_length_and_hides_code` (the five masked kinds,
    `len(mask(t)) == len(t)`); `test_mask_list_item_backtick` (Review Focus 1's line); `test_blocks_split_lists_and_tables`;
    `test_find_phrases` ("in order to" → `wordy` with replacement "to"; "each and every" → `redundant`; "It is
    important to note that" → `metadiscourse`; no match inside a longer word).
  - `test_measure.py` (skips the whole class when `import spacy` or `spacy.load('en_core_web_trf')` fails):
    over `fixtures/sample.md`, `test_candidates` asserts one candidate per kind on the lines the fixture marks with an
    HTML comment (`<!-- expect: passive -->` and so on), and none in the fixture's fenced block;
    `test_totals_keys` asserts the 15 keys; `test_cli_json` runs the CLI on the fixture and parses its stdout.
  - `measure.test.mjs`: `prose_text unit tests pass` runs `python3 -m unittest test_prose_text` (then `python`, then
    `py -3`; the test is skipped when none starts) in the script folder; `measure tests pass in the prose environment`
    runs `<CONFIG>/flows-prose/<bin/python | Scripts/python.exe> -m unittest test_measure` and is skipped when that
    file doesn't exist.

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test plugins/flows/skills/copyedit/scripts/measure.test.mjs`
  Expected: FAIL, `No module named 'prose_text'`.

- [ ] **Step 3: Write `prose_text.py` and the phrase data.** `phrases.tsv` has a header
      `kind\tphrase\treplacement\tsource`; its rows come from plainlanguage.gov's "Use simple words and phrases",
      "Avoid hidden verbs" and "Use positive language" (CC0, `github.com/GSA/plainlanguage.gov`,
      `_pages/guidelines/words/`) and Strunk's rules 11 and 13 (1920, Gutenberg 37134), each row naming its source;
      `metadiscourse` and `filler` rows are ours (source `writing-style`). The prototype's tables
      (`docs/features/writing-style/editor-test/scripts/prototype/parse_check.py:35-85`) show which entries the test
      used; single-word substitutions are left out, as there.

- [ ] **Step 4: Write `gen_nominalizations.py` and generate `nominalizations.txt`.** It lists every WordNet 3.0 noun
      ending in -tion, -sion, -ment, -ance, -ence, -ancy or -ency that has a derivationally related verb sharing its
      first four letters (the prototype's `wn_verbs`, `parse_check.py:93-102`), one per line, sorted, under a header
      comment with WordNet's license notice. Run it once with `uv run --with nltk python gen_nominalizations.py`
      (it downloads the `wordnet` corpus into a temporary folder) and commit the output.

- [ ] **Step 5: Write `measure.py`.** Port `docs/features/writing-style/editor-test/scripts/metrics.py`'s measures and
      thresholds and the prototype's passive and nominalization rules onto `prose_text`; nominalizations come from
      `nominalizations.txt`, not NLTK. `spacy.load('en_core_web_trf')` once, `n_process=1`.

- [ ] **Step 6: Wire the tests in** (`package.json:9`, `flake.nix:47,75`) and run them

  Run: `node --test plugins/flows/skills/copyedit/scripts/measure.test.mjs && npm test`
  Expected: the unit test passes; the spaCy test is skipped here unless the environment exists (it runs in Task 12);
  "repo checks passed".

- [ ] **Step 7: Run the spaCy tests in a throwaway environment** to prove them before the installer exists:
      `uv venv --managed-python --python 3.13 <scratchpad>/prose-venv`, then install torch from the CPU index and the
      pinned spaCy and model wheel into it, then `<scratchpad>/prose-venv/bin/python -m unittest test_measure` in the
      script folder.

  Expected: 3 tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/copyedit/scripts plugins/flows/skills/copyedit/data
  git commit -m "Add the prose measures, a spaCy script that lists candidate problems by the book's lessons."
  ```

### Task 6: A pinned uv

**Files:**

- Create: `installer/assets/uv.json` (`{"upstream": "0.13.6", "sha256": {"win32-x64": …, "linux-x64": …}}`, the hashes
  from the release's `.sha256` files)
- Modify: `installer/core/binaries.ts` (rename `agentBrowserAction` → `pinAction`, `agentBrowserPlan` → `pinPlan`,
  `agentBrowserVersion` → `versionIn`, `AgentBrowserPin` → `Pin`; add `UV_FILES` and `uvAsset`)
- Modify: `installer/steps/agent-browser.ts` (the renamed imports)
- Test: `installer/core/binaries.test.ts`
- Create: `.github/workflows/sync-uv.yml`

**Interfaces:**

- Produces:
  - `pinAction`, `pinPlan`, `versionIn`, `Pin`: the renamed helpers, unchanged in behaviour.
  - `UV_FILES: Record<string, string>` = `{'win32-x64': 'uv-x86_64-pc-windows-msvc.zip', 'linux-x64':
'uv-x86_64-unknown-linux-musl.tar.gz'}`.
  - `uvAsset(platform: string, arch: string, pin: Pin): { file, url, digest, exe } | undefined`, the shape
    `agentBrowserAsset` returns without `raw`: the release URL, `digest` from the pin, `exe` the binary's path inside
    the archive (`uv-x86_64-unknown-linux-musl/uv` on Linux, `uv.exe` on Windows),
    undefined for another platform, a non-semver version or a hash that isn't 64 hex characters.

- [ ] **Step 1: Write the failing tests** in `binaries.test.ts`: rename the agent-browser cases to the new names;
      `uvAsset builds the pinned release asset` (Linux and Windows URLs and `exe`; undefined for `darwin-arm64`, a bad
      version and a short hash); `versionIn reads uv's version line` (`'uv 0.13.6 (x86_64-unknown-linux-musl)\n'` →
      `'0.13.6'`).

- [ ] **Step 2: Run them to verify they fail** (CI or Node 26: `node --test installer/core/binaries.test.ts`).
      Expected: FAIL, `uvAsset` and `versionIn` undefined.

- [ ] **Step 3: Implement** the renames and `uvAsset`. Check the Windows zip's layout with `tar -tf` on the downloaded
      asset before fixing `exe` (the Linux tarball holds `uv-x86_64-unknown-linux-musl/uv`, checked 2026-10-28).

- [ ] **Step 4: Write `sync-uv.yml`** on `sync-agent-browser.yml`'s model: weekly, `gh api repos/astral-sh/uv/releases/latest`,
      the tag is the bare version (no `v`), each `UV_FILES` asset's `digest`, written to `installer/assets/uv.json`, a PR
      on `sync/uv` adding only that file.

- [ ] **Step 5: Run the checks**

  Run: `npm run typecheck && npm test` (Node 26; in this sandbox, `npx tsc --noEmit -p installer` and `node
scripts/check-repo.mjs` only)
  Expected: no type errors; "repo checks passed"; every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add installer/assets/uv.json .github/workflows/sync-uv.yml
  git commit -m "Pin uv for the installer and generalize the pinned-download helpers agent-browser uses."
  ```

### Task 7: The prose environment in the installer

**Files:**

- Create: `installer/assets/prose/pyproject.toml`, `installer/assets/prose/uv.lock`
- Create: `installer/core/prose.ts`, `installer/core/prose.test.ts`
- Create: `installer/steps/prose.ts`
- Modify: `installer/core/options.ts:32` (`TOGGLES` gains `prose`), `:70` (the tools page lists it), `HINTS`,
  `unavailable` (only `linux-x64` and `win32-x64`)
- Modify: `installer/install.ts` (`current`, `chosen`, the step call after the plugins)
- Test: `installer/core/options.test.ts`

**Interfaces:**

- Consumes: `pinPlan`, `versionIn`, `uvAsset` and `Pin` from Task 6; `downloadBin` (`system/net.ts:36`); `startSync`
  and `which` (`system/proc.ts`).
- Produces, from `core/prose.ts`:
  - `proseDir(config: string): string` → `join(config, 'flows-prose')`.
  - `prosePython(config: string, platform: string): string` → `<dir>/bin/python`, or `<dir>\Scripts\python.exe` on
    `win32`.
  - `proseSync(uv: string, assets: string, config: string): [string, string[], Record<string, string>]`: the command,
    `['sync', '--frozen', '--managed-python', '--no-dev', '--project', join(assets, 'prose')]`, and the env
    `{UV_PROJECT_ENVIRONMENT: proseDir(config)}`.
  - `proseDecision({ toggle, flows, exists }): 'sync' | 'remove' | 'none'`: `sync` when the toggle is on and flows is
    selected; `remove` when the folder exists and either is off; else `none`.
  - `proseDefault({ exists, optedOut }): boolean` → `exists || !optedOut`. `optedOut` is whether
    `<CONFIG>/flows-prose.off` exists: the step writes that marker when it removes the folder and deletes it after a
    sync, so the toggle starts on everywhere until the user turns it off once.
- `steps/prose.ts` exports `applyProse(toggle: boolean, flows: boolean): Promise<void>`.

- [ ] **Step 1: Write the project files.** `pyproject.toml`:

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

  Run `uv lock --project installer/assets/prose`. Expected: `uv.lock` resolves torch to a `+cpu` version for both
  environments, and lists the model wheel with sha256 `272a31e9…5bf5`. Confirm no `nvidia-*` package is in it.

- [ ] **Step 2: Write the failing tests.** `core/prose.test.ts`: `prosePython per platform`; `proseSync runs a frozen
    sync into the flows-prose folder` (the exact array and env above); `proseDecision` over its six combinations; `proseDefault` over its four.
      `options.test.ts`: `prose is a tools toggle, unavailable off linux-x64 and win32-x64`.

- [ ] **Step 3: Run them to verify they fail** (Node 26). Expected: FAIL, `core/prose.ts` not found.

- [ ] **Step 4: Implement `core/prose.ts`, the toggle and `steps/prose.ts`.** The step, when `proseDecision` says
      `sync`: find uv as `steps/agent-browser.ts:21-69` does for agent-browser (`pinPlan` over `which('uv')` and
      `<BIN_DIR>/uv[.exe]`, a download through `downloadBin` after `ask`, a bad pin or missing build as a failure line);
      ask once, default yes, "Set up the prose measures for /copyedit (Python 3.13, spaCy and its model, about 1.5 GB
      in <dir>)?"; run `proseSync` through `startSync` with `stdio: 'inherit'` (the env merged over `process.env`);
      then smoke-test `<python> -c "import spacy; spacy.load('en_core_web_trf')"`. Each outcome is one `done` or
      `failures` line. When it says `remove`: `rmSync(dir, {recursive: true, force: true})`, write the `flows-prose.off` marker, and a
      `done` line; after a sync, delete the marker. In `install.ts`: `current.prose` is
      `existsSync(proseDir(CONFIG))`; `chosen.prose` is `proseDefault` over that and the marker; call `applyProse` after
      `applyPlugins` with `on('prose')` and whether flows is selected.

- [ ] **Step 5: Run the checks** (Node 26): `npm run typecheck && npm test`. Expected: no type errors, every test
      passes, coverage at or above the floor. In this sandbox: `npx tsc --noEmit -p installer` and the Step 6 run.

- [ ] **Step 6: Run the step for real on Linux** against a scratchpad config folder: `CLAUDE_CONFIG_DIR=<scratchpad>/cfg
    node --input-type=module -e "import('./installer/steps/prose.ts').then(m => m.applyProse(true, true))"` on Node 26 if
      available; otherwise run `proseSync`'s command by hand with the pinned uv and the same env.

  Expected: `<scratchpad>/cfg/flows-prose/bin/python` exists, the smoke test loads the model, and a second run
  downloads nothing.

- [ ] **Step 7: Commit**

  ```bash
  git add -u && git add installer/assets/prose installer/core/prose.ts installer/core/prose.test.ts installer/steps/prose.ts
  git commit -m "Add the installer's prose toggle, which syncs a locked spaCy environment for /copyedit with a pinned uv."
  ```

### Task 8: The `/copyedit` skill

**Files:**

- Create: `plugins/flows/skills/copyedit/SKILL.md`, `plugins/flows/skills/copyedit/uses.json`
- Create: `plugins/flows/skills/copyedit/references/edit.md`
- Modify: `plugins/flows/README.md` (the generated tree, via `node scripts/flows-uses.mjs`)
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Consumes: `measure.py`'s CLI from Task 5; the environment's path from Task 7 (`<CONFIG>/flows-prose/`, with `CONFIG`
  = `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`).
- Produces: `/copyedit <file.md>`, a conductor (`disable-model-invocation: true`), callable by the other conductors by
  reading its `SKILL.md`.

- [ ] **Step 1: Extend `writing-skill.test.mjs`** with `copyedit runs the measures, the Opus editor and the diff`:
      `copyedit/SKILL.md` has `disable-model-invocation: true`; it names `scripts/measure.py`, `flows-prose`,
      `Scripts/python.exe`, `references/edit.md`, `git diff --no-index`, `=====BEGIN=====` and `Removed:`; it contains
      the editor prompt from Global Constraints verbatim; it says the measures are "skipped" when the environment's
      Python is missing or exits 1 or 3, and that a reply without both markers "writes nothing" (Review Focus 2 and
      3); `edit.md` covers Lessons 3–10 and 12 by name.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: FAIL on the new test.

- [ ] **Step 3: Write `edit.md`** from `docs/features/writing-style/editor-test/book.md`, the guide the test used,
      with one change: its last section tells the editor to leave conversation labels alone, not to replace them. The
      source-check agent of Task 4 Step 6 also checks it (spec criterion 2, the guide's half): dispatch it again with
      `edit.md` and the same sources.

- [ ] **Step 4: Write `SKILL.md`**, in three steps as the spec's **The editor** states them:
  1. Measure: when the environment's Python exists, run it on `${CLAUDE_SKILL_DIR}/scripts/measure.py <file>` and save
     the JSON in the scratchpad; format its candidates as `line N: <kind>: "<text>" (<note>)` lines in a candidates
     file. Missing Python, or exit 3 or 1: one line saying why the measures were skipped, and go on without candidates.
  2. Edit: the Agent tool with `subagent_type: "general-purpose"`, `model: "opus"` and the editor prompt. A reply
     without both markers writes nothing: say so and stop.
  3. Show: save the current file to the scratchpad, write the text between the markers over it, settle any check
     findings on that write, run the measures again when step 1 ran, and show `git diff --no-index <saved copy>
<file>`, the `Removed:` list, and the totals before and after as a table. Commit nothing.

  `uses.json`: `{"claude-code": ["Agent"]}`. Run `node scripts/flows-uses.mjs`.

- [ ] **Step 5: Run the tests**

  Run: `node --test scripts/writing-skill.test.mjs scripts/flows-uses.test.mjs && node scripts/check-repo.mjs`
  Expected: PASS, then "repo checks passed".

- [ ] **Step 6: Try it once** on a scratchpad copy of `docs/features/web-mcp-search/spec.md` with the Task 5
      throwaway environment linked at `<config>/flows-prose` (or without it, to see the skip line). Expected: a diff,
      a `Removed:` line, a totals table; the original file unchanged.

- [ ] **Step 7: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/copyedit/SKILL.md plugins/flows/skills/copyedit/uses.json plugins/flows/skills/copyedit/references/edit.md
  git commit -m "Add /copyedit, which measures a document with spaCy and has an Opus editor apply the book to it."
  ```

### Task 9: The copyedit pass and the conductors

**Files:**

- Modify: `plugins/flows/references/flow-rules.md` (a **Copyedit pass** subsection under **Running a flow**, `:24`;
  **Loading skills**, `:106`)
- Modify: `plugins/flows/skills/doc-audit/SKILL.md:19,73-74`, `plugins/flows/skills/doc-audit/uses.json:5`
- Modify: `plugins/flows/skills/integrate/SKILL.md:16,39-41`, `plugins/flows/skills/integrate/uses.json:3`
- Modify: `plugins/flows/README.md` (the generated tree; the `/integrate` row at `:19`)
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Consumes: `flows:writing` (Task 4) and `/copyedit` (Task 8).

- [ ] **Step 1: Extend `writing-skill.test.mjs`** with `flow-rules runs /copyedit before gates and the conductors use
    the writing skill`: `flow-rules.md` names `copyedit/SKILL.md`, `spec.md`, `plan.md` and "audit report" in its
      copyedit subsection; doc-audit's and integrate's `SKILL.md` and `uses.json` don't match `/\bunslop\b/` or
      `/\btechnical-writing\b(?!-density)/`; both `uses.json` list `"flows": ["writing"]`.

- [ ] **Step 2: Run it to verify it fails.** Run: `node --test scripts/writing-skill.test.mjs`. Expected: FAIL on the
      new test.

- [ ] **Step 3: Edit flow-rules.md**: before a gate shows the user a `spec.md`, a `plan.md` or an audit report, the
      conductor runs `/copyedit` on it (reading `${CLAUDE_SKILL_DIR}/../copyedit/SKILL.md`), each time it goes to a
      gate, and the gate message says it was copyedited; flow.md gets only the check. In **Loading skills**: `flows:writing`
      is model-invocable and loads through the Skill tool.

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

### Task 10: Retire the pstack copies

**Files:**

- Modify: `scripts/sync-pstack.mjs` (move `unslop` and `technical-writing` from `SKILLS` to `SKIPPED`; extend `GUARD`;
  new `REWRITES`; `SKILL_NOTE`'s example list)
- Modify (by running the sync): `plugins/flows/packs/pstack-picks/` (deletes `skills/unslop/` and
  `skills/technical-writing/`; rewrites `skills/blast-radius/SKILL.md:50`, `skills/recall/SKILL.md:35`,
  `skills/show-me-your-work/SKILL.md:38` and every file's port note)
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
      **recall**. Upstream HEAD was `519d36a`, the vendored commit, on 2026-10-27; if `UPSTREAM` changes when the sync
      runs, upstream moved: stop and report it as a deviation.

- [ ] **Step 3: Run the sync**

  Run: `node scripts/sync-pstack.mjs && git status --short plugins/flows/packs/pstack-picks`
  Expected: "pstack-picks synced to 519d36a… (changed)", and only the two deletions and the rewritten files.

- [ ] **Step 4: Edit by hand** the pstack-picks `plugin.json` description (drop `unslop`), the count in
      `sync-pstack.yml:54` (16), and THIRD_PARTY.md's pstack-picks section (the two writing skills aren't vendored,
      replaced by flows' writing skill, and the sync rewrites the references to them).

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: "repo checks passed", every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add scripts/sync-pstack.mjs
  git commit -m "Stop vendoring pstack's technical-writing and unslop and point their references at the writing skill."
  ```

### Task 11: Docs and descriptions

**Files:**

- Modify: `plugins/flows/README.md` (a section on the writing skill, the check, `/copyedit` and the prose environment:
  what the check flags, that it costs no model call, how to turn it off (disable flows, or set `disableAllHooks`), and
  that `/copyedit` measures only with the installer's prose toggle)
- Modify: `plugins/flows/.claude-plugin/plugin.json:4` and flows' entry in `.claude-plugin/marketplace.json`
- Modify: `README.md` (the flows paragraph at `:18-24`; the installer's tools page)
- Modify: `CLAUDE.md` (the `plugins/flows/` bullet: the writing skill, the check, `/copyedit` and the Opus editor; a
  line on the prose environment and its pins in the installer bullet; the `plugins/flows/packs/` bullet: pstack's two
  writing skills aren't vendored; **Vendored content**: pstack-picks' `plugin.json` is hand-written; **Checks**: the new
  test glob and the Python tests; CI: `sync-uv.yml`)
- Modify: `THIRD_PARTY.md` (technical-writing-density, MIT, paraphrased; plainlanguage.gov, CC0; Strunk, public
  domain; WordNet 3.0, its license, for `nominalizations.txt`; downloaded at install, not vendored: uv, CPython,
  spaCy, `en_core_web_trf`, PyTorch, with their licenses)
- Modify: `GLOSSARY.md` (prose check: code only; copyedit pass: run by `/copyedit`; add "prose measures")

**Interfaces:** none.

- [ ] **Step 1: Write the docs** with the writing skill, then run the check over each changed Markdown file by piping
      a `Write`-shaped input naming it to `node plugins/flows/hooks/prose-check.mjs`.

  Expected: exit 0, or findings that are fixed or judged wrong.

- [ ] **Step 2: Run `npm test`.** Expected: "repo checks passed", every test passes.

- [ ] **Step 3: Commit**

  ```bash
  git add -u
  git commit -m "Describe the writing skill, the prose check, /copyedit and its Python environment in the docs, descriptions and credits."
  ```

### Task 12: Acceptance

**Files:**

- Modify: `docs/features/writing-style/flow.md` (results)
- Create: `docs/features/writing-style/editor-test/acceptance/` (the re-run's versions and rankings)

**Interfaces:** none.

- [ ] **Step 1: Spec success criterion 3.** With the environment from Task 7 Step 6, run
      `node --test plugins/flows/skills/copyedit/scripts/measure.test.mjs` with `CLAUDE_CONFIG_DIR` pointing at it.
      Expected: both tests pass, none skipped. Record Windows as untested until the user runs the installer there.

- [ ] **Step 2: Spec success criterion 4.** Run `/copyedit` as Task 8 ships it on scratchpad copies of
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
