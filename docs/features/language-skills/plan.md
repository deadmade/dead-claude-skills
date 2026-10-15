# Language skills (C#, Rust) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two opt-in vendored plugins:

- `plugins/languages/csharp-skills`: Microsoft's dotnet/skills behind six router skills.
- `plugins/languages/rust-skills`: Apollo's rust-best-practices.

They come with weekly syncs, a "Languages" page in the installer, and a one-off before/after consistency test.

**Architecture:**

- Two new sync scripts follow the existing `scripts/sync-*.mjs` pattern, with `sync-tob.mjs` as the template.
- `scripts/sync-lib.mjs` gets two shared, tested helpers: frontmatter description parsing and summaries.
- `scripts/plugin-dirs.mjs` teaches check-repo and release about the `plugins/languages/` grouping folder.
- The installer finds plugin manifests through the marketplace `source`, using one helper in `core.mjs`.

**Tech Stack:** Node ≥20.12, standard library only, `node:test`; GitHub Actions; `claude plugin eval`.

**Spec:** `docs/features/language-skills/spec.md`. Read it first. The router mapping, globs, questions and keep bar
are there. Also read `docs/adr/0001-vendor-language-skills.md` and `GLOSSARY.md` (router skill, library skill).

## Global Constraints

- Node standard library only, no npm dependencies. New shared logic gets a test in `scripts/*.test.mjs` or
  `installer/*.test.mjs`.
- Plugin names: `csharp-skills` and `rust-skills`. Folders: `plugins/languages/csharp-skills` and
  `plugins/languages/rust-skills`. `plugins/languages/` has no `plugin.json`.
- Every new `plugin.json` has `"version"` equal to `package.json`'s. Never bump it by hand.
- Both syncs clone upstream `main` and write the commit to `UPSTREAM` through `finish()`.
- C# `paths`: `**/*.cs`, `**/*.csproj`, `**/*.sln`, `**/*.slnx`, `**/*.props`, `**/*.targets`, `**/*.razor`,
  `**/*.xaml`, `**/global.json`.
- Rust `paths`: `**/*.rs`, `**/Cargo.toml`, `**/Cargo.lock`.
- Generated, only ever written by the sync scripts, in each language plugin: `library/`, `skills/`, `LICENSE`,
  `UPSTREAM`. Hand-written: `.claude-plugin/plugin.json`, `evals/`.
- Vendored: Microsoft's skills only. No agents, no `binlog` MCP server, no LSP, no `dotnet-experimental`.
- Repo-relative paths in new code are built with `/` (template strings), not `path.join`, because CI also runs on
  Windows.
- Commit messages are one sentence, with no co-author lines.
- **Branching** (decided 2026-10-13):
  1. Merge `feat/tob-picks` to `main` first.
  2. Then create `feat/language-skills` from the updated `main`.
  3. Bring the untracked docs across: `docs/features/language-skills/`, `docs/adr/0001-vendor-language-skills.md`
     and `GLOSSARY.md`.

  Line numbers below are from the `feat/tob-picks` tree, which is what `main` looks like after that merge.

## Review Focus

1. **Upstream layout drift.** A skill folder without SKILL.md, or a frontmatter `name` that doesn't match its folder.
   The C# sync must fail, never index a dead path or drop a skill silently. Task 6 step 3, inline checks.
2. **Description forms upstream doesn't use yet.** A folded (`>`/`>-`) or quoted description must give the right
   summary, and a form we don't handle must fail rather than produce `>-`. Task 3 tests.
3. **A new upstream plugin missing from the mapping.** It goes to `core` and is named in the PR body; it doesn't
   crash or vanish. Task 6 `assignRouter` test.
4. **Read access to library files.** A normal session and eval runs must both be able to read the library. If
   either blocks it, routers load but library skills never do. Task 1 spike, Task 8 `library-read` grader.
5. **Skills upstream marks hidden** (`disable-model-invocation: true`). They must stay out of router indexes but
   stay in `library/` for the skills that reference them. Task 6 router test.

---

### Task 1: Spike: verify router mechanics before building

Nothing from this task is committed except a note in flow.md.

**Files:**

- Scratch only: `$TMPDIR/router-spike/`. Use `mktemp -d`, no `rm -rf`.
- Modify: `docs/features/language-skills/flow.md` (Grounding: the result).

- [ ] **Step 1: Build a scratch plugin.**
  - `.claude-plugin/plugin.json`: `{"name":"rprobe","version":"0.0.1"}`.
  - `skills/area/SKILL.md`: description "C#/.NET only. Probe router."; body "To answer, read
    `${CLAUDE_PLUGIN_ROOT}/library/zebra-lib/SKILL.md` and follow it."
  - `library/zebra-lib/SKILL.md`: frontmatter `name: zebra-lib`; body "Reply with the word OKAPI."
  - `skills/area/lib/yak-lib/SKILL.md`: an alternative layout, for step 4.
- [ ] **Step 2: Listing check.** In an empty git dir, run:

  ```bash
  claude -p "Without tools: list every skill whose name contains zebra, yak or area." --plugin-dir <plugin>
  ```

  Pass: only `rprobe:area` appears.

- [ ] **Step 3: Substitution and read access.** Run this twice and record both results:

  ```bash
  claude -p "Use the rprobe:area skill." --plugin-dir <plugin>
  ```

  - **(a)** No `--allowedTools`.
  - **(b)** With `--allowedTools "Read(<plugin>/**)"`. This mirrors the installer's `Read(~/.claude/plugins/**)`
    rule.

  Pass: the reply contains OKAPI.

- [ ] **Step 4: Decide.**
  - **(a) passes:** keep `library/` at the plugin root.
  - **Only (b) passes:** keep `library/`, and note in flow.md that it relies on the installer's Read rule. Check
    whether the in-skill layout (`skills/<router>/lib/<skill>/`) passes (a) and stays unlisted. If it does, use it
    instead and record that as a deviation.
  - **Neither passes:** stop and report to the user.

---

### Task 2: Plugins one folder down (`plugins/languages/`)

**Files:**

- Create: `scripts/plugin-dirs.mjs`, `scripts/plugin-dirs.test.mjs`.
- Modify:
  - `scripts/check-repo.mjs:12-14`: `pluginDirs()`.
  - `scripts/release.mjs:41`: `pluginDirs()`.
  - `installer/core.mjs`: add `manifestPath`.
  - `installer/install.mjs`: the token-plugin lookup at `:417-419` and the `shippedVersions` lookup, which builds
    `join(PKG, src, '.claude-plugin/plugin.json')`. Both use `manifestPath`.
  - `installer/core.test.mjs`.
  - `package.json` `files`: add `"plugins/languages/*/.claude-plugin/plugin.json"`.

**Interfaces:**

- Produces:
  - `export const GROUPS = ['languages']`.
  - `export function pluginDirs(root = '.'): string[]`:
    - Returns `/`-joined repo-relative paths such as `plugins/cswap` and `plugins/languages/rust-skills`, sorted.
    - A `GROUPS` folder is replaced by its subfolders.
    - Every other folder counts as a plugin, even without a manifest, so check-repo still flags it.
  - In `installer/core.mjs`, `export function manifestPath(manifest, id): string | null`:
    - Finds the marketplace entry named `nameOf(id)` and returns its string `source`, without the leading `./`,
      plus `/.claude-plugin/plugin.json`.
    - Returns `null` for url sources and unknown names.

- [ ] **Step 1: Failing tests.**

  `scripts/plugin-dirs.test.mjs`. On a `mkdtempSync` fixture with `plugins/a/`, `plugins/languages/x/` and
  `plugins/languages/y/`:

  ```js
  assert.deepEqual(pluginDirs(fx), ['plugins/a', 'plugins/languages/x', 'plugins/languages/y']);
  ```

  Against the real repo: `pluginDirs(ROOT)` contains `plugins/cswap` and not `plugins/languages`.

  `installer/core.test.mjs`:

  ```js
  const m = {
    plugins: [
      { name: 'rust-skills', source: './plugins/languages/rust-skills' },
      { name: 'superpowers', source: { source: 'url' } },
    ],
  };
  assert.equal(
    manifestPath(m, 'rust-skills@dead-claude-skills'),
    'plugins/languages/rust-skills/.claude-plugin/plugin.json',
  );
  assert.equal(manifestPath(m, 'superpowers@dead-claude-skills'), null);
  assert.equal(manifestPath(m, 'nope@dead-claude-skills'), null);
  ```

- [ ] **Step 2: Run, expect FAIL.**

  ```bash
  node --test scripts/plugin-dirs.test.mjs installer/core.test.mjs
  ```

- [ ] **Step 3: Implement.**
  - check-repo uses `pluginDirs()` for its validate loop and its version loop.
  - release builds its bump list as `pluginDirs().map((p) => [`${p}/.claude-plugin/plugin.json`, json])`.
  - Both install.mjs lookups use `manifestPath`. A `null` result means "no manifest".
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "Let check-repo, release and the installer find plugins under plugins/languages."
  ```

---

### Task 3: Shared description helpers in `scripts/sync-lib.mjs`

**Files:**

- Modify: `scripts/sync-lib.mjs`.
- Create: `scripts/sync-lib.test.mjs`.

**Interfaces:**

- Produces:
  - `frontmatterDescription(text: string): string | null`. Reads the description from the first `---` block. It
    handles only the forms upstream uses:
    - plain single-line
    - `"double-quoted"` and `'single-quoted'` single-line
    - folded `>` and `>-`, whose indented continuation lines are joined with single spaces

    It returns `''` when there is no description and `null` for any other form, such as `|`. Callers `fail` on
    `null`.

  - `summary(desc: string, max = 200): string`. Returns the text up to and including the first `. `, or the whole
    text. If that is longer than `max`, it cuts at the last space before `max` and appends `…`.
  - The existing `description(skillMd)` keeps its signature. It now returns
    `frontmatterDescription(readFileSync(skillMd)) ?? ''`.

- [ ] **Step 1: Failing tests.**

  ```js
  assert.equal(
    frontmatterDescription('---\nname: a\ndescription: >-\n  Route C# and\n  .NET requests.\nlicense: MIT\n---\nb'),
    'Route C# and .NET requests.',
  );
  assert.equal(frontmatterDescription('---\ndescription: >\n  Guide for\n  Rust.\n---'), 'Guide for Rust.');
  assert.equal(frontmatterDescription('---\ndescription: "x: y"\n---'), 'x: y');
  assert.equal(frontmatterDescription('---\ndescription: |\n  a\n---'), null);
  assert.equal(frontmatterDescription('no frontmatter'), '');
  assert.equal(summary('ALWAYS USE before running tests. Trigger on x.'), 'ALWAYS USE before running tests.');
  const long = summary('word '.repeat(60).trim());
  assert.ok(long.length <= 201 && long.endsWith('…'));
  ```

- [ ] **Step 2: Run, expect FAIL.**

  ```bash
  node --test scripts/sync-lib.test.mjs
  ```

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, expect PASS.** The existing syncs' use of `description()` is unchanged.
- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "Parse folded and quoted SKILL.md descriptions in sync-lib."
  ```

---

### Task 4: Installer "Languages" page

This lands before the plugins, because `installer/core.test.mjs` requires every real opt-in to sit on a page:
`assert.ok(!pages.some((p) => p.id === 'other'))`. `categorize` ignores keys that don't exist yet.

**Files:**

- Modify: `installer/core.mjs` (the `lsp` entry of `CATEGORIES`) and `installer/core.test.mjs`.

- [ ] **Step 1: Failing test.**

  ```js
  const lang = CATEGORIES.find((c) => c.id === 'lsp');
  assert.equal(lang.title, 'Languages');
  for (const k of ['csharp-skills', 'rust-skills', 'csharp-lsp', 'rust-analyzer-lsp']) assert.ok(lang.keys.includes(k));
  ```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Keep `id: 'lsp'` and set:
  - `title: 'Languages'`
  - `blurb: 'Per-language code intelligence (servers must be on PATH) and best-practice skills.'`
  - `keys: ['rust-analyzer-lsp', 'rust-skills', 'csharp-lsp', 'csharp-skills', 'typescript-lsp', 'pyright-lsp', 'nix-lsp']`
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "Rename the installer's language server page to Languages and list the language skill plugins on it."
  ```

---

### Task 5: `rust-skills` plugin and its sync

**Files:**

- Create:
  - `scripts/sync-rust.mjs`
  - `.github/workflows/sync-rust.yml`
  - `plugins/languages/rust-skills/.claude-plugin/plugin.json`
- Generated: `plugins/languages/rust-skills/{skills/rust-best-practices/**,LICENSE,UPSTREAM}`.
- Modify:
  - `.claude-plugin/marketplace.json`: an entry directly after `tob-picks`.
    - `"name": "rust-skills"`, `"source": "./plugins/languages/rust-skills"`, `"category": "development"`.
    - Description: "Rust best practices from Apollo GraphQL's handbook (rust-best-practices): ownership, errors, clippy, testing, dispatch. Vendored, synced weekly. Opt-in."
  - `installer/core.test.mjs` opt-ins list: add `rust-skills`.

**Interfaces:**

- Consumes: `sparseClone`, `fail`, `finish`, `git`, `ROOT` from sync-lib.

- [ ] **Step 1: `plugin.json`.**
  - Fields: `name`, the repo version, `license: "MIT"`, and the same author and repository as the other plugins.
  - Description: "Apollo GraphQL's Rust best practices handbook as a skill. Vendored from apollographql/skills, synced weekly."
- [ ] **Step 2: `scripts/sync-rust.mjs`.**
  - It defines a local `addPaths(text, globs): string | null`. This inserts `paths:` followed by `  - "<glob>"`
    lines before the closing `---` of the first frontmatter block. It returns `null` if there is no frontmatter or
    `paths:` is already present.
  - Flow:
    1. `sparseClone('https://github.com/apollographql/skills.git', ['skills/rust-best-practices'])`.
    2. `fail` if SKILL.md is missing.
    3. Remove and recreate `skills/`, then copy the skill folder and the root `LICENSE`.
    4. `addPaths` with the Rust globs. `fail` on `null`.
    5. `finish('rust-skills', sha, UPSTREAM, PLUGIN)`.
- [ ] **Step 3: Run.**

  ```bash
  node scripts/sync-rust.mjs
  ```

  Expect `skills/rust-best-practices/references/chapter_01.md` … `chapter_09.md`, and a `paths:` block in
  SKILL.md.

- [ ] **Step 4: `.github/workflows/sync-rust.yml`.** Copy of `sync-hallmark.yml` with:
  - cron `'15 6 * * 1'`, script `sync-rust.mjs`.
  - Sanity checks:

    ```bash
    jq empty .claude-plugin/marketplace.json plugins/languages/rust-skills/.claude-plugin/plugin.json
    grep -q '^paths:' plugins/languages/rust-skills/skills/rust-best-practices/SKILL.md
    ```

  - `sha` from `plugins/languages/rust-skills/UPSTREAM`.
  - Branch `sync/rust-skills`, `add-paths: plugins/languages/rust-skills`, and the upstream URL in the body.
- [ ] **Step 5: Run `npm test`, expect PASS.**
- [ ] **Step 6: Commit.**

  ```bash
  git commit -m "Add the rust-skills plugin, vendored from Apollo's rust-best-practices with a weekly sync."
  ```

- [ ] **Step 7: Idempotence.** Run `node scripts/sync-rust.mjs` again. Expect "unchanged" and an empty
      `git status --porcelain -- plugins/languages/rust-skills`.

---

### Task 6: `csharp-skills` plugin and its sync

**Files:**

- Create:
  - `scripts/sync-csharp.mjs`
  - `scripts/sync-csharp.test.mjs`
  - `.github/workflows/sync-csharp.yml`
  - `plugins/languages/csharp-skills/.claude-plugin/plugin.json`
- Generated: `plugins/languages/csharp-skills/{library/<skill>/**,skills/{core,testing,build,web,data,desktop}/SKILL.md,LICENSE,UPSTREAM}`.
- Modify:
  - `.claude-plugin/marketplace.json`: an entry directly after `rust-skills`.
    - `"name": "csharp-skills"`, `"source": "./plugins/languages/csharp-skills"`, `"category": "development"`.
    - Description: "Microsoft's .NET skills (dotnet/skills): C#, testing, MSBuild/NuGet, ASP.NET Core, Blazor, EF Core, MAUI, WinForms, behind six C#-only router skills. Vendored, synced weekly. Opt-in."
  - `installer/core.test.mjs` opt-ins list: add `csharp-skills`.

**Interfaces:**

- Consumes: `frontmatterDescription`, `summary` (Task 3), plus `sparseClone`, `fail`, `finish`, `git` and `ROOT`.
- Produces: exports for the test. The script body runs only when the file is executed directly
  (`import.meta.url === pathToFileURL(process.argv[1]).href`).
  - `ROUTERS: { name, description, plugins: string[] }[]`.
    - The mapping is in the spec, under "Calls I made".
    - The descriptions are fixed copy:
      - **core:** "C#/.NET only. C# language semantics and refactoring, runtime diagnostics and performance, .NET 11 APIs, advanced scenarios, AI/LLM integration in .NET. Index of Microsoft's .NET skills for these."
      - **testing:** "C#/.NET only. Running, writing, filtering and analyzing .NET tests (MSTest, xUnit, NUnit, TUnit), coverage, test smells, test framework migrations. Index of Microsoft's .NET skills for these."
      - **build:** "C#/.NET only. MSBuild and build failures, NuGet packages and central package management, upgrading .NET versions, dotnet new templates. Index of Microsoft's .NET skills for these."
      - **web:** "C#/.NET only. ASP.NET Core (middleware, endpoints, minimal APIs, real-time) and Blazor components and interactivity. Index of Microsoft's .NET skills for these."
      - **data:** "C#/.NET only. Entity Framework Core and .NET data access. Index of Microsoft's .NET skills for these."
      - **desktop:** "C#/.NET only. .NET MAUI and Windows Forms apps: setup, layout, data binding, navigation, diagnostics. Index of Microsoft's .NET skills for these."
  - `assignRouter(plugin: string): string`. The router whose `plugins` includes the plugin, otherwise `'core'`.
  - `renderRouter({ name, description, entries }): string`. `entries` is `{ name, summary }[]`, rendered sorted by
    name, with `|` escaped as `\|`. Output, where the body text is fixed copy:

    ```markdown
    ---
    name: <name>
    description: '<description>'
    paths:
      - '<each C# glob>'
    ---

    # C#/.NET skills: <name>

    Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its
    SKILL.md with the Read tool, and follow it. When a skill names another skill, read
    `${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.

    | Skill        | Use for         | Path                                                  |
    | ------------ | --------------- | ----------------------------------------------------- |
    | <entry.name> | <entry.summary> | `${CLAUDE_PLUGIN_ROOT}/library/<entry.name>/SKILL.md` |
    ```

    If Task 1 chose the in-skill layout, the paths change to match.

  - `isHidden(skillMdText: string): boolean`. True when the frontmatter has `disable-model-invocation: true`.

- [ ] **Step 1: Failing tests** in `scripts/sync-csharp.test.mjs`.
  - `assignRouter`:
    - `'dotnet-blazor'` → `'web'`
    - `'dotnet-test-migration'` → `'testing'`
    - `'dotnet-brand-new'` → `'core'`
  - No upstream plugin name appears in two routers.
  - `renderRouter` with entries `[{name:'b',summary:'x | y'},{name:'a',summary:'z'}]`:
    - Row `a` comes before row `b`.
    - The output contains `x \| y`, `` `${CLAUDE_PLUGIN_ROOT}/library/a/SKILL.md` `` and `name: testing`.
    - `frontmatterDescription(output)` equals the description given.
  - `isHidden`:
    - True for `'---\nname: f\ndisable-model-invocation: true\nuser-invocable: false\n---'`.
    - False without that line.

- [ ] **Step 2: Run, expect FAIL.**

  ```bash
  node --test scripts/sync-csharp.test.mjs
  ```

- [ ] **Step 3: Implement `scripts/sync-csharp.mjs`.** In order:
  1. **Clone.** Run `sparseClone('https://github.com/dotnet/skills.git', ['.claude-plugin', 'plugins'])`. Cone
     mode brings root files such as `LICENSE`, so don't list them. Read the marketplace `plugins[].name`, and
     `fail` if it's empty.
  2. **Collect skills.** For each listed plugin:
     - `fail` if it has no `skills/`.
     - For each folder under `skills/`, `fail` if `SKILL.md` is missing, if its frontmatter `name` ≠ the folder
       name, if `frontmatterDescription` is `null`, or if the name was already taken by an earlier plugin. The
       last check is inline, with an error naming both plugins.
  3. **Diff against the last sync.** Before deleting anything, compare the old `library/` folder names with the
     new set. Print `added: <name>` and `removed: <name>` lines.
  4. **Report what isn't vendored.** Read each plugin's `.claude-plugin/plugin.json`. For each plugin that declares
     `agents`, `mcpServers`, `lspServers`, `hooks` or `commands`, print `skipped: <plugin>: …`. Print
     `unmapped (→ core): <plugin>` for each plugin `assignRouter` doesn't map.
  5. **Copy.** Remove and recreate `library/` and `skills/`, then copy each skill folder to `library/<name>/`.
  6. **Rewrites.** Apply `REWRITES` as `sync-tob.mjs` does: each must match or the sync fails. Targets in
     `library/csharp-expert/`:
     - `SKILL.md`: the `/plugin install …@dotnet-agent-skills` line, and the line naming the marketplace (≈ l.244).
     - `references/dotnet-skills-marketplace.md`: the `/plugin install` lines, `/plugin update …` (≈ l.25), and
       the Codex marketplace lines (≈ l.105, 109).

     Replacement text: "All of these skills are already installed in the csharp-skills plugin, reached through its
     router skills (csharp-skills:core, :testing, :build, :web, :data, :desktop). Each one is at
     `../<skill>/SKILL.md` relative to this skill." Use the relative path because `${CLAUDE_PLUGIN_ROOT}` isn't
     substituted in files read with Read. Write the exact patterns after reading the cloned text.

  7. **Agent mentions.** Take agent names from each agent file's frontmatter `name`; the file names end in
     `.agent.md`. Print `mentions skipped agent <name>: <library file>` for word-boundary matches. For `msbuild`,
     match only `` `msbuild` agent `` and `dotnet-msbuild:msbuild`.
  8. **Routers.** Render each router from the folder names copied in sub-step 5. Each entry's summary is
     `summary(frontmatterDescription(...))`. Leave out `isHidden` skills.
  9. **Finish.** Copy `LICENSE`, then run `finish('csharp-skills', sha, UPSTREAM, PLUGIN)`.

  Print every report line, including the `added:`, `removed:`, `skipped:`, `unmapped` and `mentions` lines, to
  stdout and to `process.env.SYNC_REPORT` when that variable is set.

- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Run the sync.**

  ```bash
  node scripts/sync-csharp.mjs
  ```

  Expect:
  - `library/` has about 102 folders.
  - `skills/` holds exactly `build core data desktop testing web`.
  - `skipped:` lines for dotnet (lspServers), dotnet-msbuild, dotnet-diag, dotnet-template-engine, dotnet-test and
    dotnet-test-migration.
  - No `unmapped` lines.
  - The testing router doesn't list `code-testing-agent`, `code-testing-extensions`, `filter-syntax` or
    `test-analysis-extensions`.

- [ ] **Step 6: Listing check.** From an empty dir, run:

  ```bash
  claude -p "Without tools: list every skill from the csharp-skills plugin." --plugin-dir <abs path>/plugins/languages/csharp-skills
  ```

  Expect the six routers only.

- [ ] **Step 7: `plugin.json` and the workflow.**
  - `plugin.json`: `license: "MIT"`. Description: "Microsoft's .NET skills (dotnet/skills) behind six C#-only router skills. Vendored from dotnet/skills, synced weekly."
  - `.github/workflows/sync-csharp.yml`, like the Rust one, with:
    - cron `'30 6 * * 1'`.
    - The run step sets `SYNC_REPORT: /tmp/csharp-sync-report.txt`.
    - Sanity checks:

      ```bash
      test "$(ls plugins/languages/csharp-skills/skills | wc -l)" -eq 6
      test "$(find plugins/languages/csharp-skills/library -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l)" -ge 90
      ```

    - Build the PR body with a static intro, then the report file in a fenced block. Write it to a file and pass
      `body-path`.
    - Branch `sync/csharp-skills`.
- [ ] **Step 8: Run `npm test`, expect PASS.**
- [ ] **Step 9: Commit.**

  ```bash
  git commit -m "Add the csharp-skills plugin: Microsoft's dotnet/skills vendored behind six router skills with a weekly sync."
  ```

- [ ] **Step 10: Idempotence.** Rerun the sync. Expect "unchanged" and an empty
      `git status --porcelain -- plugins/languages/csharp-skills`.

---

### Task 7: Docs and tooling excludes

**Files:**

- Modify:
  - `README.md`: the opt-in list, plus one line on the router design.
  - `THIRD_PARTY.md`: a section for rust-skills and one for csharp-skills. Each covers:
    - the source, the MIT license and its LICENSE path
    - what the sync changes: `paths`; routers and `library/`; the csharp-expert rewrite; hidden skills left out of
      the indexes; skipped agents, MCP server and LSP
    - the weekly sync and `UPSTREAM`
  - `CLAUDE.md`:
    - Layout: `plugins/languages/` is a grouping folder that `scripts/plugin-dirs.mjs` knows.
    - Vendored list: add `plugins/languages/*/{library,skills}/`, `LICENSE` and `UPSTREAM`. `plugin.json` and
      `evals/` are hand-written.
    - Note that `paths` doesn't gate plugin skills.
  - `flake.nix` `vendored`: add `"^plugins/languages/[^/]+/(library/|skills/|LICENSE$|UPSTREAM$)"`.
  - `treefmt.toml` excludes: add `"plugins/languages/*/library/**"`, `"plugins/languages/*/skills/**"`,
    `"plugins/languages/*/LICENSE"` and `"plugins/languages/*/UPSTREAM"`.

- [ ] **Step 1: Edit.**
- [ ] **Step 2: Verify.**
  - `npm test` passes.
  - If `nix fmt` is available, run it. Afterwards `git status` shows no changes under `library/` or `skills/`.
- [ ] **Step 3: Commit.**

  ```bash
  git commit -m "Document the language plugins and exclude their generated files from formatting."
  ```

---

### Task 8: Before/after consistency test (one-off)

**Files:**

- Create:
  - `plugins/languages/rust-skills/evals/q01..q06/prompt.md` and `graders/*.md`.
  - `plugins/languages/csharp-skills/evals/q07..q12/prompt.md` and `graders/*.md`.
  - `docs/features/language-skills/agreement.mjs`.
  - `docs/features/language-skills/eval-results.md`.

**Interfaces:**

- Produces: `node docs/features/language-skills/agreement.mjs <result.json>…`. It prints, per question, the
  agreeing pairs in the with-arm (0–3) and in the without-arm (0–3).

- [ ] **Step 1: Write the 12 cases.**
  - Each `prompt.md` body is the spec's question verbatim. Frontmatter:

    ```yaml
    runs: 3
    max_turns: 15
    allowed_tools: [Read, Glob, Grep, Skill]
    ```

  - Graders:
    - `answers.md`, `type: llm`, `focus: last_message`: "PASS if the reply recommends one concrete approach and
      says why. FAIL if it only lists options without choosing."
    - `skill-fired.md`, `type: tool_used`, `tool: Skill`, `arm: with-only`. Its `input_match` is
      `rust-best-practices` for Rust, and the router for the question's area for C#.
    - C# only: `library-read.md`, `type: tool_used`, `tool: Read`, `input_match: 'library/'`, `arm: with-only`.
- [ ] **Step 2: Trial one case per plugin.**

  ```bash
  claude plugin eval plugins/languages/rust-skills --case q01 --runs 1 --trust-plugin --json $TMPDIR/q01.json
  ```

  Then the same for `csharp-skills` `q07`. Establish where each run's final reply text lives:
  - First choice: the `answers` grader's evidence under `cases[].arms.{with,without}[]`.
  - Fallback: the per-run transcripts in the eval's `results/<timestamp>/` directory.
  - If neither has it, stop and report.

  In `q07`, `library-read` must pass. If the library isn't readable in eval runs, stop and report.

- [ ] **Step 3: `agreement.mjs`.**
  - For each case and arm, take the 3 replies and judge the 3 pairs. For each pair, one `claude -p` call: "Do these
    two answers recommend the same approach? First line AGREE or DIFFER, second line the point of difference."
  - Print per-question with/without pair counts.
  - It's a one-off analysis script, so it has no test.
- [ ] **Step 4: Full run.** One per plugin:

  ```bash
  claude plugin eval <plugin dir> --trust-plugin -j 4 --json $TMPDIR/<plugin>.json
  ```

  Then run `agreement.mjs` over both outputs. Report the cost from the JSON.

- [ ] **Step 5: `eval-results.md`.**
  - The table: per question, with and without agreeing pairs, plus eval's WITH, W/OUT and Δ, and the cost.
  - The keep bar from the spec: count only questions where the without-arm has fewer than 3 agreeing pairs. "With"
    must score higher on at least 8 of those, or on all of them if fewer than 8 qualify, and none may be judged
    worse.
  - Show the user the table, ask for their judgment on "none worse", and record the decision in flow.md.
- [ ] **Step 6: Commit.**

  ```bash
  git commit -m "Add the one-off before/after consistency evals for the language plugins and record the results."
  ```
