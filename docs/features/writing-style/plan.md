# Writing style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one writing skill based on Williams and Bizup's _Style_ inside flows, check every Markdown file Claude
writes with a code check and a Haiku check, copyedit specs and audit reports before their gates, and retire pstack's
`technical-writing` and `unslop`.

**Architecture:** Everything lives in the flows plugin. A dependency-free Node script (`hooks/prose.mjs` for the logic,
`hooks/prose-check.mjs` as the entry) and a prompt hook run on `PostToolUse` for `Write` and `Edit` of `*.md`, both
declared in `hooks/hooks.json`. The skill is `skills/writing/SKILL.md`, which `scripts/flows-uses.mjs` learns to tell
apart from a conductor; `references/flow-rules.md` gains the copyedit pass; the pstack sync stops vendoring the two old
skills and points the three references to them at the new skill.

**Tech Stack:** Node's standard library (`node:test`, `node:fs`, `node:path`), Claude Code plugin hooks (command and
prompt types), `claude -p` for the probe and the sample run.

**Spec:** [spec.md](spec.md), approved 2026-10-27, revised after plan review round 1 the same day.

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
- The copyedit prompt, verbatim: "Copyedit this document for a reader who wasn't in the conversation. Don't change its
  decisions, requirements, quotes or code. Return the edited document." The pass commits nothing.
- Both checks judge only the new text (a `Write`'s `content`, an `Edit`'s `new_string`), never look inside code (fenced
  or inline), front matter, link targets or block quotes, and report at most 10 findings, each with the place, the
  problem and a replacement. The model check's prompt says to ignore `tool_response`, which carries the old file.
- The shorthand rule is off in files named `flow.md`.
- The model check uses `"model": "claude-haiku-5-5"` and `"continueOnBlock": true`. The `haiku` alias is rejected in
  hook prompts on Claude Code 2.1.311 (checked 2026-10-27: the hook logs `unrecognized_model` and passes silently).
- The code check uses Node's standard library only and runs in exec form (`"command": "node"`, `"args"`). With
  findings it prints them to stderr and exits 2; with none, or on any error, it exits 0 and prints nothing.
- The writing skill is loaded as `flows:writing` through the Skill tool, by conductors and by the rewritten pstack
  lines alike.
- No length limits, no banned-word lists, no grammar or spelling checks. No crate, binary, installer step or release
  workflow.
- Vendored content is never edited by hand: `plugins/flows/packs/pstack-picks/` changes only through
  `scripts/sync-pstack.mjs`, except its hand-written `.claude-plugin/plugin.json`.
- Commit messages are one sentence, with no co-author lines. Stage with `git add -u` plus new paths by name, never
  `git add -A`.
- The sandbox runs Node 22.22; `npm test`'s pieces pass on it (checked 2026-10-27), and CI runs Node 26 on Linux and
  Windows.
- Before you write (ponytail, verbatim): "Read the task and the code it touches. List every place your change must
  reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would
  destroy or expose, callers that stop working. That is scope. Extra features are not."
- TDD wins here: every change, trivial ones too, gets its failing test first.

## Review Focus

1. An `Edit` whose `new_string` occurs several times, or is empty (a deletion): every occurrence is checked, nothing
   else is, and an empty `new_string` checks nothing. Pinned in Task 1.
2. A file with Windows line endings: `newRanges` still finds a multi-line `new_string`, and positions stay right.
   Pinned in Task 1.
3. Capitals that aren't abbreviations in real docs (PASS, FAIL, HEAD, `SKILL.md`, NOT, MB) and definitions in a table
   row or code font: none flagged. Pinned in Task 1 with a fixture of real lines.
4. A missing, unreadable or non-Markdown file, or malformed hook JSON: the code check exits 0 silently. Pinned in
   Task 1.
5. An `Edit` of a long existing file, whose hook input carries the old file: the model check flags only new text and
   answers within its 30 s timeout. Measured in Task 3.

---

### Task 1: The code check

**Files:**

- Create: `plugins/flows/hooks/prose.mjs`
- Create: `plugins/flows/hooks/prose-check.mjs`
- Create: `plugins/flows/hooks/common-terms.txt`
- Test: `plugins/flows/hooks/prose.test.mjs`, `plugins/flows/hooks/fixtures/clean.md`
- Modify: `package.json:9` (the `test` script), `flake.nix:47` (the same glob) and `flake.nix:75` (the hook's `files`
  regex gains `plugins/flows/hooks/`)

**Interfaces:**

- Produces, from `prose.mjs`:
  - `mask(text: string): string`: same length as `text`, with code (fenced and inline), front matter, link targets
    (`](...)` and reference definitions) and block-quote lines replaced by spaces; newlines kept.
  - `newRanges(fullText: string, input: { tool_name: string, tool_input: object }): Array<[number, number]>`: `Write`
    → the whole file; `Edit` → every occurrence of `new_string`, matched with the file's line endings; an empty
    `new_string` or any other tool → `[]`.
  - `check(fullText: string, ranges: Array<[number, number]>, opts: { file: string, terms: Set<string> }): Finding[]`,
    where `Finding = { line: number, col: number, rule: 'shorthand' | 'undefined', match: string, message: string }`,
    1-based, sorted by position.
  - `report(file: string, findings: Finding[]): string`: at most 10 lines `path:line:col rule: "match" → replacement`,
    then the closing line from Global Constraints. `''` when there are no findings.
  - `main({ stdin: string, readFile: (p: string) => string, terms: Set<string> }): { code: 0 | 2, stderr: string }`.
- `prose-check.mjs` reads stdin and `common-terms.txt`, calls `main`, writes `stderr`, exits with `code`.

- [ ] **Step 1: Write the failing tests** in `prose.test.mjs`, one `test()` each:
  - `shorthand flags conversation labels`: "Decided in grill Q11 and round 2 (D4, my call)." gives four `shorthand`
    findings: `Q11`, `round 2`, `D4`, `my call`.
  - `shorthand skips quarters, defined labels and flow.md`: "ships in Q1 2027" gives none; a `Q1` after a line
    `- Q1 (reliability): …` gives none; the first test's text with `file: 'docs/features/x/flow.md'` gives none.
  - `undefined flags abbreviations used before their definition`: "The CMP answers. … Consent Management Platform
    (CMP)" flags the first `CMP`; "BM25 ranks" flags `BM25`; "CMPs" counts as `CMP`; each abbreviation once.
  - `undefined accepts every definition form`: `ADR (Architecture Decision Record)`, `Architecture Decision Record (ADR)`,
    a table row `| ADR | Architecture Decision Record |` and `` `ADR` (Architecture Decision Record) `` each make a later
    `ADR` pass.
  - `real docs stay clean`: `check` over `fixtures/clean.md` gives no `undefined` finding. The fixture holds real lines
    from `docs/features/web-mcp-search/plan.md` and this plan with "Expected: PASS", "FAIL", `SKILL.md` outside code
    font, "git HEAD", "do NOT", "50 MB" and "PNG".
  - `masking leaves code, front matter, link targets and quotes alone`: `Q7` and `XYZ` inside a fenced block, an inline
    code span, front matter, a link target and a `>` line give no findings; `mask(t).length === t.length`.
  - `edit checks every occurrence of new_string and nothing else`: two occurrences give two ranges; a `Q3` elsewhere
    in the file is not reported; an empty `new_string` gives `[]`.
  - `CRLF keeps positions and finds edits`: a finding in `\r\n` text has the same line and column as in `\n` text, and
    a two-line `new_string` with `\n` is found in a `\r\n` file.
  - `report caps at 10 and ends with the closing line`: 12 findings give 10 lines plus the closing line.
  - `main fails open`: malformed JSON, a `.txt` path, and a `readFile` that throws each give `{ code: 0, stderr: '' }`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test plugins/flows/hooks/prose.test.mjs`
  Expected: FAIL, `Cannot find module './prose.mjs'`.

- [ ] **Step 3: Implement `prose.mjs` and `prose-check.mjs`**

  Shorthand: `\b[QD]-?\d+\b` unless a `Q` number is followed by a space and four digits, `\bround \d+\b` and
  `\bmy call\b` (both case-insensitive). A label is defined when a line starts with it after list, heading or bold
  markers. Abbreviations: `\b[A-Z][A-Z0-9]{1,5}s?\b` with at least two capitals, skipped when followed by `.` and one to
  four lowercase letters (a file name). Definitions are looked up in the file with only fenced code and front matter
  masked, so code-font definitions count. `common-terms.txt` holds one term per line, `#` comments allowed. Seed it
  with: API, URL, JSON, CLI, MCP, PR, CI, HTTP, HTTPS, HTML, CSS, PDF, OS, UI, ID, SQL, CPU, RAM, SDK, IDE, LLM, AI, OK,
  TODO, README, YAML, TOML, UTF, ASCII, SSH, DNS, IP, TCP, UDP, TLS, MIT, BSD, GPL, ISO, UTC, PATH, ENV, PASS, FAIL,
  HEAD, NOT, ALL, AND, OR, MUST, ONLY, NEVER, ALWAYS, NOTE, USE, MB, KB, GB, PNG, JPEG, SVG, TXT, JS, TS, TSX, XML, LF,
  CRLF, TTY, ESM, SHA, RFC, DOI, CC, BY, SA, ARM, LSP, TDD.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test plugins/flows/hooks/prose.test.mjs`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Wire the tests in.** Add `"plugins/flows/hooks/*.test.mjs"` next to `"plugins/default/hooks/*.test.mjs"`
      in `package.json`'s `test` script and at `flake.nix:47`, and add `plugins/flows/hooks/` to the `files` regex at
      `flake.nix:75`. Run `npm test`.

  Expected: "repo checks passed", and every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add plugins/flows/hooks/prose.mjs plugins/flows/hooks/prose-check.mjs plugins/flows/hooks/common-terms.txt plugins/flows/hooks/prose.test.mjs plugins/flows/hooks/fixtures/clean.md
  git commit -m "Add the prose code check that flags conversation shorthand and undefined abbreviations in new Markdown text."
  ```

### Task 2: The hooks

**Files:**

- Create: `plugins/flows/hooks/hooks.json`
- Test: `plugins/flows/hooks/hooks.test.mjs`

**Interfaces:**

- Consumes: `prose-check.mjs` from Task 1.
- Produces: one `PostToolUse` entry with matcher `Write|Edit` and four handlers, because `if` takes one rule: a command
  handler (`"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/prose-check.mjs"]`) and a prompt handler, each
  once with `"if": "Write(**/*.md)"` and once with `"if": "Edit(**/*.md)"`. Both prompt handlers carry the same prompt,
  `"model": "claude-haiku-5-5"`, `"continueOnBlock": true` and `"timeout": 30`.

- [ ] **Step 1: Write the failing test** `hooks.json declares both checks for Write and Edit of Markdown` in
      `hooks.test.mjs`: parse `hooks.json`; assert the four handlers above; assert the two prompts are equal and contain
      the closing line verbatim and `$ARGUMENTS`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test plugins/flows/hooks/hooks.test.mjs`
  Expected: FAIL, `ENOENT` for `hooks.json`.

- [ ] **Step 3: Write `hooks.json`.** The prompt states the six rules of the spec's model-check table with one example
      each; says to judge only the new text in `tool_input` (`content` for `Write`, `new_string` for `Edit`) and to
      ignore `tool_response`, which holds the old file; to skip code, front matter, link targets and block quotes; to
      leave shorthand and abbreviations alone; not to flag a passive that keeps the paragraph's topic or a long sentence
      that reads easily; to answer `{"ok": true}` when nothing is worth fixing, and otherwise `{"ok": false, "reason":
      "..."}` with at most 10 findings as `rule: "match" → replacement`, followed by the closing line.

- [ ] **Step 4: Run the test and the plugin validator**

  Run: `node --test plugins/flows/hooks/hooks.test.mjs && claude plugin validate plugins/flows`
  Expected: PASS, then "Validation passed" (plugin-directory warnings about README, licence or icon are fine; errors
  are not).

- [ ] **Step 5: Probe the whole flows plugin in a real session.** In a scratchpad folder, run
      `claude -p "Use the Write tool to create docs/note.md with exactly this content: <content>. Then quote every hook
      message you received, verbatim." --plugin-dir <repo>/plugins/flows --permission-mode acceptEdits --output-format
      stream-json --verbose < /dev/null > probe.jsonl`, where the content is one paragraph with "grill Q4", an undefined
      "CMP" and "a decision was made by the team to perform an analysis of", plus a fenced block containing "Q9".

  Expected: the session starts with flows loaded from the folder (its dependencies unresolved is fine); a
  `hook_response` with exit code 2 whose stderr names `Q4` and `CMP` but not `Q9`; and a model-check reason that names
  the nominalization and ends with the closing line. Record in flow.md where the model reason appears in the stream.

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

- [ ] **Step 1: The code check over both samples.** For `docs/features/web-mcp-search/plan.md` and `spec.md`, pipe a
      `Write`-shaped hook input naming a scratchpad copy of the file to `node plugins/flows/hooks/prose-check.mjs`, and
      an `Edit`-shaped one for one paragraph of the plan. Time the plan run once (Review Focus 5's code half).

- [ ] **Step 2: The model check over both samples.** For each sample, run in a scratchpad folder
      `claude -p "Read <repo>/<sample> and use the Write tool to create docs/sample.md with exactly the same content.
      Then quote every hook message you received, verbatim." --plugin-dir <repo>/plugins/flows --permission-mode
      acceptEdits --output-format stream-json --verbose < /dev/null`. Then one run that copies the plan into the folder
      first and asks for an `Edit` of one paragraph. Take the findings from the stream where Task 2 found them, and
      from Claude's quote only where the stream has none; record which. Diff the written copy against the sample and
      record any drift. Record each run's wall time.

- [ ] **Step 3: Collect the findings** into `<scratchpad>/sample/findings.md`: one numbered row per finding with the
      check, the quoted text, the rule and the replacement. Mark each code finding no model finding covers, and each
      model finding in the `Edit` run that quotes text outside the new paragraph.

- [ ] **Step 4: Draw 20 findings** at random (fixed seed, both checks in proportion) and show them to the user with
      their context lines. **Stop here: this is the spec's gate.** The user judges each one worth fixing or not.

- [ ] **Step 5: Record the verdict in flow.md**: the count worth fixing, the wall times, the code findings the model
      check missed, and any old-text findings. At 15 or more, continue with Task 4. Below 15, tune or drop the rules
      with the most wrong findings (each a user decision under **Deviations**) and rerun Steps 1–4. Old-text findings
      in the `Edit` run trigger the spec's fallback (a command hook that sends Haiku only `new_string`), which goes to
      the user under **Deviations** first. If no code finding is worth fixing and uncovered by the model check, ask the
      user whether to drop the code check, as the spec says.

- [ ] **Step 6: Commit**

  ```bash
  git add -u
  git commit -m "Record the prose checks' sample review in the writing-style flow."
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
      no `disable-model-invocation`, and the rule verbatim in the first paragraph of the body).

- [ ] **Step 2: Run them to verify they fail**

  Run: `node --test scripts/flows-uses.test.mjs scripts/writing-skill.test.mjs`
  Expected: FAIL on the three new tests.

- [ ] **Step 3: Change `flows-uses.mjs`** to the interfaces above.

- [ ] **Step 4: Write the skill** from the spec's section **The skill**: the rule; the lesson table's lines in our own
      words, each with a before/after example taken from `docs/features/*/` (cite the file); Lesson 9's six operations;
      the density test with a link to `https://github.com/mlwelles/technical-writing-density`; lists for lists; no
      conversation shorthand; the kept rules from `technical-writing` and `unslop`; the credits to Gopen and Swan,
      Strunk and Pinker. Lesson 12 is titled "The Ethics of Style". About three pages. Check wording only against the
      free sources in flow.md **Prior art**, never the book's text.

- [ ] **Step 5: Run the tests and the repo checks**

  Run: `node --test scripts/flows-uses.test.mjs scripts/writing-skill.test.mjs && node scripts/check-repo.mjs`
  Expected: PASS, then "repo checks passed".

- [ ] **Step 6: Source check (spec success criterion 2).** Dispatch a fresh `general-purpose` agent with the skill, the
      spec's skill section, flow.md **Prior art**, and `plugins/flows/packs/pstack-picks/skills/technical-writing/SKILL.md`
      and `unslop/SKILL.md` (still present until Task 6). It reports any lesson stated unfaithfully against the cited
      free sources (with the source link), any sentence that copies a source, and any kept rule of the old skills that
      is missing. Fix each finding or record why not under **Rulings**.

- [ ] **Step 7: Run the skill scanner if `pipx` is available** (`npm run scan-skills`); otherwise record that CI runs
      it. Expected: no high or critical finding for `writing`.

- [ ] **Step 8: Commit**

  ```bash
  git add -u && git add plugins/flows/skills/writing/SKILL.md scripts/writing-skill.test.mjs
  git commit -m "Add the writing skill, Williams and Bizup's Style in our own words, as flows' one prose standard."
  ```

### Task 5: The copyedit pass and the conductors

**Files:**

- Modify: `plugins/flows/references/flow-rules.md` (a **Copyedit pass** subsection under **Running a flow**)
- Modify: `plugins/flows/skills/doc-audit/SKILL.md:19,73-74`, `plugins/flows/skills/doc-audit/uses.json`
- Modify: `plugins/flows/skills/integrate/SKILL.md:16,39-41`, `plugins/flows/skills/integrate/uses.json`
- Modify: `plugins/flows/README.md` (the generated tree via `node scripts/flows-uses.mjs`; the `/integrate` row at
  `:19`)
- Test: `scripts/writing-skill.test.mjs`

**Interfaces:**

- Consumes: `flows:writing` from Task 4.

- [ ] **Step 1: Extend `writing-skill.test.mjs`** with `flow-rules has the copyedit pass and the conductors use the
      writing skill`: `flow-rules.md` contains the copyedit prompt verbatim (Global Constraints) and `git diff
      --no-index`; doc-audit's and integrate's `SKILL.md` and `uses.json` don't match `/\bunslop\b/` or
      `/\btechnical-writing\b(?!-density)/`, and both `uses.json` list `"flows": ["writing"]`.

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test scripts/writing-skill.test.mjs`
  Expected: FAIL on the new test.

- [ ] **Step 3: Edit flow-rules.md** per the spec's **The copyedit pass**: it runs before a gate shows a `spec.md` or
      an audit report, each time; a fresh `general-purpose` agent gets the writing skill's text and the copyedit prompt
      and returns the edited text plus a list of anything it removed rather than reworded; the conductor saves the
      current document to the scratchpad, writes the edited text over it once, settles any hook findings on that write,
      and shows `git diff --no-index <saved copy> <document>` and the removed-content list at the gate; nothing is
      committed; plans and flow.md get only the hooks. In **Loading skills**, say that `flows:writing` is model-invocable
      and loads through the Skill tool.

- [ ] **Step 4: Edit the conductors.** doc-audit Phase 5 runs `flows:writing` over the changed docs; integrate Phase 2
      passes title and body through it. In both `uses.json`, replace the pstack writing entries with `"flows":
      ["writing"]` (integrate keeps `"pstack-picks": ["blast-radius"]`). Run `node scripts/flows-uses.mjs`, then update
      the `/integrate` row's text in flows' README by hand.

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

- [ ] **Step 5: Run the tests**

  Run: `npm test`
  Expected: "repo checks passed", every test passes.

- [ ] **Step 6: Commit**

  ```bash
  git add -u && git add scripts/sync-pstack.mjs
  git commit -m "Stop vendoring pstack's technical-writing and unslop and point their references at the writing skill."
  ```

### Task 7: Docs and descriptions

**Files:**

- Modify: `plugins/flows/README.md` (a section on the writing skill and the hooks: what they check, the cost of a Haiku
  call per Markdown write, and how to turn them off: disable flows, or set `disableAllHooks`)
- Modify: `plugins/flows/.claude-plugin/plugin.json:4` and flows' entry in `.claude-plugin/marketplace.json` (the
  descriptions name the writing skill and the per-write checks)
- Modify: `README.md` (the flows paragraph at `:18-24`)
- Modify: `CLAUDE.md` (the `plugins/flows/` bullet: the writing skill, the hooks, the copyedit pass and the model ID;
  the `plugins/flows/packs/` bullet: pstack's two writing skills aren't vendored; **Vendored content**: pstack-picks'
  `plugin.json` is hand-written; **Checks**: the new test glob)
- Modify: `THIRD_PARTY.md` (the credit to technical-writing-density, MIT, paraphrased)

**Interfaces:** none.

- [ ] **Step 1: Write the docs** with the writing skill, then run the code check over each changed Markdown file by
      piping a `Write`-shaped input naming it to `node plugins/flows/hooks/prose-check.mjs`.

  Expected: exit 0, or findings that are fixed or judged wrong.

- [ ] **Step 2: Run `npm test`**

  Expected: "repo checks passed", every test passes.

- [ ] **Step 3: Commit**

  ```bash
  git add -u
  git commit -m "Describe the writing skill, the prose checks and the retired pstack skills in the READMEs, descriptions, CLAUDE.md and THIRD_PARTY.md."
  ```

### Task 8: Acceptance in a real session

**Files:**

- Modify: `docs/features/writing-style/flow.md` (results)

**Interfaces:** none.

- [ ] **Step 1: Spec success criterion 4.** In a scratchpad folder, run
      `claude -p "Write a short spec for adding a --json flag to a CLI tool, as docs/spec.md, in the style a long design
      session would leave: refer to decisions as grill Q3 and D2. Revise the file after any hook feedback." --plugin-dir
      <repo>/plugins/flows --permission-mode acceptEdits --output-format stream-json --verbose < /dev/null`.

  Expected: hook findings appear, Claude revises, and the run ends with no more than three rounds of findings on the
  same file. More than three is looping: record it under **Deviations** for a counter.

- [ ] **Step 2: Spec success criterion 5.** Run the copyedit pass as flow-rules now states it on a scratchpad copy of
      `docs/features/web-mcp-search/spec.md` (the original stays unchanged). Show the user the `git diff --no-index`
      output and the removed-content list. The user judges whether it reads easier and whether anything was lost.

- [ ] **Step 3: Record both results in flow.md and commit**

  ```bash
  git add -u
  git commit -m "Record the writing-style acceptance runs in its flow."
  ```
