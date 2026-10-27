# Writing style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one writing skill based on Williams and Bizup's _Style_ inside flows, check every Markdown file Claude
writes with a code check and a Haiku check, copyedit specs and audit reports before their gates, and retire pstack's
`technical-writing` and `unslop`.

**Architecture:** Everything lives in the flows plugin. A dependency-free Node script (`hooks/prose.mjs` for the logic,
`hooks/prose-check.mjs` as the entry) and a prompt hook run on `PostToolUse` for `Write` and `Edit` of `*.md`, both
declared in `hooks/hooks.json`. The skill is `skills/writing/SKILL.md`; `references/flow-rules.md` gains the copyedit
pass; the pstack sync stops vendoring the two old skills and points the three references to them at the new skill.

**Tech Stack:** Node's standard library (`node:test`, `node:fs`, `node:path`), Claude Code plugin hooks (command and
prompt types), `claude -p` for the sample run.

**Spec:** [spec.md](spec.md), approved 2026-10-27.

## Global Constraints

- The rule, verbatim: _write for a smart reader who wasn't there, and omit needless words._
- Which files are checked: resolved in flows' `hooks/hooks.json` (matchers and `if` filters) and in `check.mjs` (the
  flow.md exception); never seen by the skill, the copyedit pass or the conductors. (`check.mjs` is
  `hooks/prose-check.mjs` with its logic in `hooks/prose.mjs`.)
- The model and its settings: resolved in `hooks/hooks.json`; never seen by `check.mjs` or the skill.
- When a document is copyedited: resolved in `flow-rules.md`; never seen by the hooks or by each conductor's own gate
  text.
- What the writing standard says: resolved in the `writing` skill; the conductors and the copyedit pass name the skill
  and never restate its rules.
- The closing line of every check report, verbatim: "Fix what makes the prose worse for a reader. Leave a sentence as
  is when the finding is wrong."
- Both checks see only the new text (a `Write`'s `content`, an `Edit`'s `new_string`), never look inside code (fenced
  or inline), front matter, link targets or block quotes, and report at most 10 findings, each with the place, the
  problem and a replacement.
- The shorthand rule is off in files named `flow.md`.
- The model check uses `"model": "claude-haiku-5-5"` and `"continueOnBlock": true`. The `haiku` alias is rejected in
  hook prompts on Claude Code 2.1.311 (checked 2026-10-27: the hook logs `unrecognized_model` and passes silently).
- The code check uses Node's standard library only. With findings it prints them to stderr and exits 2; with none, or
  on any error, it exits 0 and prints nothing.
- No length limits, no banned-word lists, no grammar or spelling checks. No crate, binary, installer step or release
  workflow.
- Vendored content is never edited by hand: `plugins/flows/packs/pstack-picks/` changes only through
  `scripts/sync-pstack.mjs`.
- Commit messages are one sentence, with no co-author lines. Stage with `git add -u` plus new paths by name, never
  `git add -A`.
- The sandbox runs Node 22.22; `npm test`'s pieces pass on it (checked 2026-10-27), and CI runs Node 26.
- Before you write (ponytail, verbatim): "Read the task and the code it touches. List every place your change must
  reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would
  destroy or expose, callers that stop working. That is scope. Extra features are not."
- TDD wins here: every change, trivial ones too, gets its failing test first.

## Review Focus

1. An `Edit` whose `new_string` occurs several times in the file (`replace_all`, or a repeated phrase): every
   occurrence is checked, and nothing outside them is. Pinned in Task 1.
2. A file with Windows line endings: line and column numbers stay right, and masking still works. Pinned in Task 1.
3. Abbreviations with digits or a plural `s` ("BM25", "CMPs"), defined later in the same file or in a table: flagged
   only when no definition comes before. Pinned in Task 1.
4. A missing, unreadable or non-Markdown file, or malformed hook JSON: the code check exits 0 silently. Pinned in
   Task 1.
5. A 10,000-word `Write`: the code check finishes in under a second; the model check either answers within its 30 s
   timeout or passes silently. Pinned in Task 1 (code) and Task 3 (model, measured).

---

### Task 1: The code check

**Files:**

- Create: `plugins/flows/hooks/prose.mjs`
- Create: `plugins/flows/hooks/prose-check.mjs`
- Create: `plugins/flows/hooks/common-terms.txt`
- Test: `plugins/flows/hooks/prose.test.mjs`
- Modify: `package.json:9` (the `test` script) and `flake.nix:47` (the same test glob)

**Interfaces:**

- Produces, from `prose.mjs`:
  - `mask(text: string): string`: same length as `text`, with code (fenced and inline), front matter, link targets
    (`](...)` and reference definitions) and block-quote lines replaced by spaces; newlines kept.
  - `newRanges(fullText: string, input: { tool_name: string, tool_input: object }): Array<[number, number]>`: `Write`
    → the whole file; `Edit` → every occurrence of `new_string`; anything else → `[]`.
  - `check(fullText: string, ranges: Array<[number, number]>, opts: { file: string, terms: Set<string> }): Finding[]`,
    where `Finding = { line: number, col: number, rule: 'shorthand' | 'undefined', match: string, message: string }`,
    1-based, sorted by position.
  - `report(file: string, findings: Finding[]): string`: at most 10 lines `path:line:col rule: "match" → replacement`,
    then the closing line from Global Constraints. `''` when there are no findings.
  - `main({ stdin: string, readFile: (p: string) => string, terms: Set<string> }): { code: 0 | 2, stderr: string }`.
- `prose-check.mjs` reads stdin and `common-terms.txt`, calls `main`, writes `stderr`, exits with `code`.

- [ ] **Step 1: Write the failing tests** in `prose.test.mjs`, one `test()` each:
  - `shorthand flags conversation labels`: `check` on "Decided in grill Q11 and round 2 (D4, my call)." returns four
    `shorthand` findings, matches `Q11`, `round 2`, `D4`, `my call`.
  - `shorthand skips labels the file defines`: with a line `- Q1 (reliability): …` earlier in the file, a later `Q1`
    yields no finding.
  - `shorthand is off in flow.md`: the same text with `file: 'docs/features/x/flow.md'` yields none.
  - `undefined flags abbreviations used before their definition`: "The CMP answers. … Consent Management Platform
    (CMP)" flags the first `CMP`; "BM25 ranks" flags `BM25`; "CMPs" counts as `CMP`.
  - `undefined accepts both definition forms and common terms`: "Architecture Decision Record (ADR)" and "ADR
    (Architecture Decision Record)" before use → none; `API`, `JSON`, `PR` → none.
  - `masking leaves code, front matter, link targets and quotes alone`: Q7 and `XYZ` inside a fenced block, an inline
    code span, front matter, a link target and a `>` line → no findings; `mask(t).length === t.length`.
  - `edit checks every occurrence of new_string and nothing else`: `newRanges` for an `Edit` whose `new_string` occurs
    twice returns two ranges; a `Q3` elsewhere in the file is not reported.
  - `CRLF keeps positions`: the same finding in `\r\n` text has the same line and column as in `\n` text.
  - `report caps at 10 and ends with the closing line`: 12 findings → 10 lines plus the closing line.
  - `main fails open`: malformed JSON, a `.txt` path, and a `readFile` that throws each return `{ code: 0, stderr: '' }`.
  - `large input stays fast`: `check` on 10,000 words with 50 abbreviations finishes in under 1,000 ms.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test plugins/flows/hooks/prose.test.mjs`
  Expected: FAIL, `Cannot find module './prose.mjs'`.

- [ ] **Step 3: Implement `prose.mjs` and `prose-check.mjs`**

  Shorthand patterns: `\b[QD]-?\d+\b`, `\bround \d+\b` (case-insensitive), `\bmy call\b` (case-insensitive). A label
  counts as defined when a line starts with it after list, heading or bold markers. Abbreviations: `\b[A-Z][A-Z0-9]{1,5}s?\b`
  with at least two capitals; defined when `(ABBR)` or `ABBR (` occurs before the use in the masked file. Each
  abbreviation is reported once, at its first use in the new text. `common-terms.txt` holds one term per line, `#`
  comments allowed; start it with API, URL, JSON, CLI, MCP, PR, CI, HTTP, HTTPS, HTML, CSS, PDF, OS, UI, ID, SQL, CPU,
  RAM, SDK, IDE, LLM, AI, OK, TODO, README, YAML, TOML, UTF, ASCII, SSH, DNS, IP, TCP, UDP, TLS, CLAUDE, MIT, BSD, GPL,
  ADR, ISO, UTC, PATH, ENV.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test plugins/flows/hooks/prose.test.mjs`
  Expected: PASS, 11 tests.

- [ ] **Step 5: Add `"plugins/flows/hooks/*.test.mjs"` next to `"plugins/default/hooks/*.test.mjs"` in `package.json`'s
      `test` script and in `flake.nix:47`, then run `npm test`**

  Expected: "repo checks passed", and every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add plugins/flows/hooks/prose.mjs plugins/flows/hooks/prose-check.mjs plugins/flows/hooks/common-terms.txt plugins/flows/hooks/prose.test.mjs
  git commit -m "Add the prose code check that flags conversation shorthand and undefined abbreviations in new Markdown text."
  ```

### Task 2: The hooks

**Files:**

- Create: `plugins/flows/hooks/hooks.json`
- Test: `plugins/flows/hooks/hooks.test.mjs`

**Interfaces:**

- Consumes: `prose-check.mjs` from Task 1, run as `node "${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs"`.
- Produces: one `PostToolUse` entry with matcher `Write|Edit` and four handlers, because `if` takes one rule: the
  command and the prompt each with `"if": "Write(**/*.md)"` and with `"if": "Edit(**/*.md)"`. Both prompt handlers
  carry the same prompt, `"model": "claude-haiku-5-5"`, `"continueOnBlock": true`, `"timeout": 30`.

- [ ] **Step 1: Write the failing test** `hooks.json declares both checks for Write and Edit of Markdown` in
      `hooks.test.mjs`: parse `hooks.json`; assert the four handlers above; assert each prompt contains the closing line
      verbatim, the rule names `nominalization`, `hidden actor`, `wordy`, `list`, `sprawl`, `unclear`, the phrase "at most
      10", `$ARGUMENTS`, and tells the model to leave shorthand and abbreviations alone and to skip code, front matter,
      link targets and block quotes.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test plugins/flows/hooks/hooks.test.mjs`
  Expected: FAIL, `ENOENT` for `hooks.json`.

- [ ] **Step 3: Write `hooks.json`.** The prompt states the six rules of the spec's model-check table with one example
      each, says to judge only the new text in `tool_input` (`content` for `Write`, `new_string` for `Edit`), to answer
      `{"ok": true}` when nothing is worth fixing, and otherwise `{"ok": false, "reason": "..."}` with at most 10 findings
      in the form `rule: "match" → replacement` followed by the closing line. It must not flag a passive that keeps the
      paragraph's topic or a long sentence that reads easily.

- [ ] **Step 4: Run the test and the plugin validator**

  Run: `node --test plugins/flows/hooks/hooks.test.mjs && claude plugin validate plugins/flows`
  Expected: PASS, then "Validation passed" (warnings about the plugin directory's README, licence or icon checks are
  fine; errors are not).

- [ ] **Step 5: Probe both checks in a real session**

  In the scratchpad, create `probe/docs/note.md`'s intended content: one paragraph with "grill Q4", an undefined
  "CMP", "a decision was made by the team to perform an analysis of", and a fenced block containing "Q9". Run from
  `probe/`: `claude -p "Use the Write tool to create docs/note.md with exactly this content: <content>. Then quote
  every hook message you received, verbatim." --plugin-dir <repo>/plugins/flows --permission-mode acceptEdits
  --output-format stream-json --verbose > probe.jsonl`.
  Expected: a `hook_response` with exit code 2 whose stderr names `Q4` and `CMP` but not `Q9`, and Claude's quote of a
  model-check reason that names the nominalization and ends with the closing line.

- [ ] **Step 6: Commit**

  ```bash
  git add plugins/flows/hooks/hooks.json plugins/flows/hooks/hooks.test.mjs
  git commit -m "Run the prose code check and a Haiku prose check after every Markdown write or edit."
  ```

### Task 3: The sample review (gate)

**Files:**

- Modify: `docs/features/writing-style/flow.md` (results under **Tasks**)

**Interfaces:**

- Consumes: `hooks.json` and `prose-check.mjs` from Tasks 1 and 2.

The hooks are committed on the branch in Task 2, but the branch isn't merged or released before this gate passes, so
no installed flows runs them before the user's review.

- [ ] **Step 1: Run both checks over the two samples, in hook shape.** For each of
      `docs/features/web-mcp-search/plan.md` and `docs/features/web-mcp-search/spec.md`, run in a scratchpad folder:
      `claude -p "Read <repo>/<sample> and use the Write tool to create docs/sample.md with exactly the same content.
      Then quote every hook message you received, verbatim." --plugin-dir <repo>/plugins/flows --permission-mode
      acceptEdits --output-format stream-json --verbose`. Record each run's wall time from the stream's `result`.

- [ ] **Step 2: Collect the findings** into `<scratchpad>/sample/findings.md`: one numbered row per finding with the
      check (code or model), the quoted text, the rule and the replacement. Mark each code finding whose text no model
      finding covers.

- [ ] **Step 3: Draw 20 findings** at random (fixed seed, both checks in proportion) and show them to the user with
      their context lines. **Stop here: this is the spec's gate.** The user judges each one worth fixing or not.

- [ ] **Step 4: Record the verdict in flow.md**: the count worth fixing, the wall times, and how many code findings
      the model check missed. At 15 or more, continue with Task 4. Below 15, tune or drop the rules with the most wrong
      findings (each a user decision under **Deviations**), and rerun Steps 1–3. If no code finding is worth fixing and
      uncovered by the model check, ask the user whether to drop the code check, as the spec says.

- [ ] **Step 5: Commit**

  ```bash
  git add -u
  git commit -m "Record the prose checks' sample review in the writing-style flow."
  ```

### Task 4: The writing skill

**Files:**

- Create: `plugins/flows/skills/writing/SKILL.md`
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Produces: the skill `flows:writing`, model-invocable (no `disable-model-invocation`), read by path as
  `${CLAUDE_SKILL_DIR}/../writing/SKILL.md` from conductors and as `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` by the
  pstack rewrites in Task 6.

- [ ] **Step 1: Write the failing test** `the writing skill states the rule and the lessons` in
      `scripts/writing-skill.test.mjs`: frontmatter has `name: writing` and a `description` naming specs, plans,
      reports, READMEs, PR descriptions and commit messages, and no `disable-model-invocation`; the body's first
      paragraph contains the rule verbatim; it has a section for each of Lessons 1, 3–10 and 12 (by the 12th edition's
      titles, Lesson 12 as "The Ethics of Style"); it contains "matters to the topic" and links
      `https://github.com/mlwelles/technical-writing-density`; it credits Gopen and Swan, Strunk and Pinker.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: FAIL, `ENOENT`.

- [ ] **Step 3: Write the skill** from the spec's section **The skill**: the rule; the lesson table's lines in our own
      words, each with a before/after example taken from `docs/features/*/` (cite the file); Lesson 9's six operations;
      the density test; lists for lists; no conversation shorthand; the kept rules from `technical-writing` and `unslop`;
      the credits. About three pages. Use only the free sources in flow.md **Prior art** for wording checks, never the
      book's text.

- [ ] **Step 4: Run the test**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Source check (spec success criterion 2).** Dispatch a fresh `general-purpose` agent with the skill,
      the spec's skill section, flow.md **Prior art**, and `plugins/flows/packs/pstack-picks/skills/technical-writing/SKILL.md`
      and `unslop/SKILL.md` (still present until Task 6). It reports: any lesson stated unfaithfully against the cited
      free sources (with the source link), any sentence that copies a source, and any kept rule of the old skills that
      is missing. Fix each finding or record why not under **Rulings**.

- [ ] **Step 6: Run the skill scanner if `pipx` is available** (`npm run scan-skills`); otherwise record that it runs in
      CI. Expected: no high or critical finding for `writing`.

- [ ] **Step 7: Commit**

  ```bash
  git add plugins/flows/skills/writing/SKILL.md scripts/writing-skill.test.mjs
  git commit -m "Add the writing skill, Williams and Bizup's Style in our own words, as flows' one prose standard."
  ```

### Task 5: The copyedit pass and the conductors

**Files:**

- Modify: `plugins/flows/references/flow-rules.md` (a **Copyedit pass** subsection under **Running a flow**; the
  commit exception under **Homes and commits**)
- Modify: `plugins/flows/skills/doc-audit/SKILL.md:19,73-74`, `plugins/flows/skills/doc-audit/uses.json`
- Modify: `plugins/flows/skills/integrate/SKILL.md:16,39-41`, `plugins/flows/skills/integrate/uses.json`
- Modify: `plugins/flows/README.md` (generated tree via `node scripts/flows-uses.mjs`, plus the `/integrate` row at
  `:19`)
- Test: `scripts/flows-uses.test.mjs` (existing) and `scripts/writing-skill.test.mjs` (extended)

**Interfaces:**

- Consumes: the skill path from Task 4.

- [ ] **Step 1: Extend `writing-skill.test.mjs`** with `flow-rules has the copyedit pass and no conductor names the old
      skills`: `flow-rules.md` contains "Copyedit this document for a reader who wasn't in the conversation. Don't change
      its decisions, requirements, quotes or code. Return the edited document.", `git diff HEAD~1`, and names the commit
      exception; no file under `plugins/flows/skills/` contains `technical-writing` or `unslop`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: FAIL on the new test.

- [ ] **Step 3: Edit flow-rules.md** per the spec's **The copyedit pass**: when it runs (before a gate shows a
      `spec.md` or an audit report, each time), the agent (`general-purpose`, the skill's text plus the quoted prompt),
      the two commits and the gate message with `git diff HEAD~1`, the removed-content list, and that plans and flow.md
      get only the hooks. Under **Homes and commits**, add that the copyedit pass's two commits are the exception to
      "Commit or push only when the user asks". **A missing piece** gets no row: the skill ships in flows.

- [ ] **Step 4: Edit the conductors.** doc-audit Phase 5 runs the `writing` skill
      (`${CLAUDE_SKILL_DIR}/../writing/SKILL.md`) over the changed docs; integrate Phase 2 passes title and body through
      it. Remove `technical-writing` and `unslop` from both `uses.json` files (integrate keeps `blast-radius`). Run
      `node scripts/flows-uses.mjs` to regenerate flows' dependencies and README tree; update the `/integrate` row's
      text by hand.

- [ ] **Step 5: Run the tests**

  Run: `node --test scripts/writing-skill.test.mjs scripts/flows-uses.test.mjs && node scripts/check-repo.mjs`
  Expected: PASS, then "repo checks passed".

- [ ] **Step 6: Commit**

  ```bash
  git add -u
  git commit -m "Copyedit specs and audit reports before their gates and switch doc-audit and integrate to the writing skill."
  ```

### Task 6: Retire the pstack copies

**Files:**

- Modify: `scripts/sync-pstack.mjs` (move `unslop` and `technical-writing` from `SKILLS` to `SKIPPED`; new `REWRITES`;
  `SKILL_NOTE`'s example list; a guard for the dropped names)
- Modify (by running the sync): `plugins/flows/packs/pstack-picks/` (deletes `skills/unslop/`,
  `skills/technical-writing/`; rewrites `skills/blast-radius/SKILL.md:50`, `skills/recall/SKILL.md:35`,
  `skills/show-me-your-work/SKILL.md:38`, and every file's port note)
- Modify: `plugins/flows/packs/pstack-picks/.claude-plugin/plugin.json` (the description names `unslop`; check whether
  the sync writes it before editing)
- Modify: `THIRD_PARTY.md:39-45`
- Test: `scripts/writing-skill.test.mjs` (extended)

**Interfaces:**

- Consumes: the skill path `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` from Task 4.

- [ ] **Step 1: Extend the test** with `no vendored pstack file names the retired skills`: no file under
      `plugins/flows/packs/pstack-picks/` contains `unslop` or `technical-writing`, and the three rewritten lines name
      the writing skill.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: FAIL on the new test.

- [ ] **Step 3: Edit `sync-pstack.mjs`.** `REWRITES` turn "Write the brief through the **unslop** skill", "Write it
      through `unslop`" and "(the **unslop** skill applies to log text too)" into references to flows' writing skill at
      `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md`. In `SKILL_NOTE`, replace **unslop** in the example list with
      **recall**. Add a check after the rewrite that fails the sync when `unslop` or `technical-writing` survives in a
      staged file, with a message naming the file and line.

- [ ] **Step 4: Run the sync** (`node scripts/sync-pstack.mjs`). Upstream HEAD was `519d36a`, the vendored commit, on
      2026-10-27; if `UPSTREAM` changes, upstream moved: stop and report it as a deviation.

  Expected: "pstack-picks synced to 519d36a… (changed)", and `git status` shows only the deletions and rewrites above.

- [ ] **Step 5: Update THIRD_PARTY.md's pstack-picks section** to say the two writing skills are not vendored and why
      (replaced by flows' writing skill), and that the sync rewrites the references to them.

- [ ] **Step 6: Run the tests**

  Run: `node --test scripts/writing-skill.test.mjs && npm test`
  Expected: PASS, "repo checks passed".

- [ ] **Step 7: Commit**

  ```bash
  git add -u && git add scripts/sync-pstack.mjs
  git commit -m "Stop vendoring pstack's technical-writing and unslop and point their references at the writing skill."
  ```

### Task 7: Docs

**Files:**

- Modify: `plugins/flows/README.md` (a short section on the writing skill and the two hooks, with their cost: a Haiku
  call on each Markdown write)
- Modify: `README.md` (the flows paragraph at `:18-24`)
- Modify: `CLAUDE.md` (the `plugins/flows/` bullet: the writing skill, the hooks and the copyedit pass; the
  `plugins/flows/packs/` bullet: pstack's two writing skills are not vendored; **Checks**: the new test glob)
- Modify: `THIRD_PARTY.md` (the credit to technical-writing-density, MIT, paraphrased)

**Interfaces:** none.

- [ ] **Step 1: Write the docs** through the writing skill, then run the code check over each changed file:
      `printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"<abs path>"}}' | node plugins/flows/hooks/prose-check.mjs`.

  Expected: exit 0, or findings that are fixed or judged wrong.

- [ ] **Step 2: Run `npm test`**

  Expected: "repo checks passed", every test passes.

- [ ] **Step 3: Commit**

  ```bash
  git add -u
  git commit -m "Describe the writing skill, the prose checks and the retired pstack skills in the READMEs, CLAUDE.md and THIRD_PARTY.md."
  ```

### Task 8: Acceptance in a real session

**Files:**

- Modify: `docs/features/writing-style/flow.md` (results)

**Interfaces:** none.

- [ ] **Step 1: Spec success criterion 4.** In a scratchpad folder, run
      `claude -p "Write a short spec for adding a --json flag to a CLI tool, as docs/spec.md, in the style a long design
      session would leave: refer to decisions as grill Q3 and D2. Revise the file after any hook feedback." --plugin-dir
      <repo>/plugins/flows --permission-mode acceptEdits --output-format stream-json --verbose`.
  Expected: hook findings appear, Claude revises, and the run ends with no more than three rounds of findings on the
  same file. More than three is looping: record it under **Deviations** for a counter.

- [ ] **Step 2: Spec success criterion 5.** Run the copyedit pass as flow-rules now states it on a copy of
      `docs/features/web-mcp-search/spec.md` in the scratchpad (the original stays unchanged), and show the user the
      diff and the removed-content list. The user judges whether it reads easier and whether anything was lost.

- [ ] **Step 3: Record both results in flow.md and commit**

  ```bash
  git add -u
  git commit -m "Record the writing-style acceptance runs in its flow."
  ```
