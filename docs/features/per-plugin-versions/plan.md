# Per-plugin versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each plugin carries its own hand-set version. A release sets only the repo's number. `npm test` fails when
a plugin changed since the last release without a bump.

**Architecture:**

- A new `scripts/versions.mjs` holds the version rules: pure functions plus three small git readers.
- It imports `LAST_SHARED`, `semver`, `newer` and `BIN_PLUGINS` from `installer/core.mjs`, so each fact lives in one
  place. Scripts already import from the installer, as `sync-agent-browser.yml` does.
- `check-repo.mjs`, `release.mjs` and `sync-lib.mjs` use it.
- The installer gets two changes:
  - `outdated()` lets shared-era installs (0.5.0 or below) move down.
  - `applyBin` expects each binary to report its plugin's version.

**Tech Stack:** Node ≥ 20.12 standard library only, `node:test`, git, GitHub Actions YAML, Dependabot config.

**Spec:** [docs/superpowers/specs/2026-10-21-per-plugin-versions-design.md](../../superpowers/specs/2026-10-21-per-plugin-versions-design.md)
(approved 2026-10-21). ADR: [docs/adr/0003-per-plugin-versions.md](../../adr/0003-per-plugin-versions.md).

## Global Constraints

- **One PR.** Tasks 2–6 land in one PR. No release is cut and no sync PR is merged before it is on `main`. Any
  partial state breaks something:
  - renumbered without the new `release.mjs`, the next release overwrites the numbers;
  - without the installer change, the binaries are downloaded again on every run;
  - without the sync change, the sync PRs fail.
- No npm dependencies. Node standard library only. New logic goes into a module with a `*.test.mjs` next to it.
- The last shared-era version is `0.5.0`. The last shared-era tag is `v0.5.0`.
- The plugins the user wrote start at `0.1.0`: dead-skills, flows, cswap, md-pane, tui-review, web-mcp, nix-lsp,
  mcp-azure and mcp-github.
- The plugins vendored from an upstream branch also start at `0.1.0`: graphify, hallmark, mattpocock-picks,
  paper-lookup, pstack-picks, tob-picks, self-review, rust-skills, csharp-skills and postgres. Their `plugin.json`
  is ours: the syncs never copy it, apart from ponytail's.
- ponytail is `5.3.2`. Its `UPSTREAM` sha `16352ac…` is upstream's tag `v5.3.2` (checked with `git ls-remote`).
- `crates/tui-review` and `crates/web-mcp` carry their plugin's version, in `Cargo.toml` and in their own
  `Cargo.lock` entry. The plugin → crate map is `BIN_PLUGINS` (`installer/core.mjs`): crate dir
  `crates/${BIN_PLUGINS[name].name}`.
- Exempt from the bump check:
  - a plugin that didn't exist at the baseline tag;
  - a `crates/<name>/Cargo.lock`-only change;
  - ponytail while its `UPSTREAM` file is unchanged.
- "Lower than the baseline" is allowed only while the baseline tag is `v0.5.0` or older.
- With no reachable `v*` tag, check-repo prints a warning and skips the bump check. A sync on CI
  (`GITHUB_ACTIONS` set) fails instead.
- All paths that reach git or get compared with git's output are repo-relative with `/` separators. Never use a
  `join()` result.
- Only Windows and Linux x64. No macOS or ARM paths.
- Commit messages are one sentence and carry no co-author lines (user rule).
- Vendored content is never edited by hand. Change the sync script instead (CLAUDE.md).

## Review Focus

1. **Windows paths.** A backslash manifest path silently exempts every plugin, because `git show` misses and the
   plugin looks new. Task 2 tests `bumpProblem` with a backslash `dir`. Task 3 builds paths as template strings, and
   `test.yml` runs on `windows-latest`.
2. **No git, no tags.** A shallow checkout, the nix sandbox or a tarball must give a printed skip in check-repo, never
   a crash or a false failure. Task 2 tests the readers against a throwaway repo with and without a tag.
3. **A plugin added after the baseline.** It is exempt and must not crash on `git show`. Task 2 tests
   `then: undefined` and `versionAt` on a missing file.
4. **A malformed version** (missing, `1.0`, a sha) in a `plugin.json` is a problem, not a silent pass. A sync must
   never write `null` or `NaN` into one. Task 2 tests `isVersion` and `syncBump`, and Task 5 fails on a `setVersion`
   miss.
5. **Installed version is a sha, or newer than shipped.** The sha keeps being offered the update. A post-switch
   install above 0.5.0 is never offered a downgrade. Task 4 tests both.

---

### Task 1: Check that `claude plugin update` moves to a lower version (no code)

The spec relies on ADR 0002's check on 2.1.304. Re-check it on the CLI installed today, isolated from the user's own
config.

**Files:** none. Record the result in `docs/features/per-plugin-versions/flow.md` under **Grounding**.

- [ ] **Step 1: Build a throwaway marketplace in `$TMPDIR`**
  - Create `$TMPDIR/downgrade/m/.claude-plugin/marketplace.json` with one plugin `p`, source `./p`.
  - Create `$TMPDIR/downgrade/m/p/.claude-plugin/plugin.json` with `{"name":"p","version":"0.5.0"}`.
  - Run `git init`, then commit.
- [ ] **Step 2: Install, then lower the version**
  - With `CLAUDE_CONFIG_DIR=$TMPDIR/downgrade/cfg`, run `claude plugin marketplace add $TMPDIR/downgrade/m`, then
    `claude plugin install p@<marketplace name>`.
  - Change `plugin.json` to `0.1.0` and commit.
  - Run `claude plugin marketplace update <name>`, then `claude plugin update p@<name> --json`.
- [ ] **Step 3: Read the result**
  - Run `CLAUDE_CONFIG_DIR=… claude plugin list --json`.
  - Expected: `p` shows `0.1.0`.
  - If it still shows `0.5.0`, stop. This is a deviation: the spec's reinstall-with-warning fallback becomes an extra
    task for the user to approve before Task 4.
  - Note: the real path is a GitHub marketplace re-pinned to a new `ref`, not a local directory. If the result is
    surprising, say so rather than generalising.
- [ ] **Step 4: Note the CLI version and the result in flow.md**

### Task 2: Version rules module

**Files:**

- Create: `scripts/versions.mjs`, `scripts/versions.test.mjs`
- Modify: `installer/core.mjs`
  - export the existing `semver` and `newer` (~471-476);
  - add `export const LAST_SHARED = '0.5.0'` with a one-line comment: the last release where every plugin shared the
    repo's number (ADR 0003).
- Modify: `flake.nix:64`: add `scripts/versions\\.mjs$` to the check-repo hook's `files` regex, next to
  `scripts/check-repo\\.mjs$`.

**Interfaces:**

- Produces, in `scripts/versions.mjs` (`ROOT = join(import.meta.dirname, '..')`):
  - `export const isVersion = (v: unknown) => boolean`: `!!semver(v)`.
  - `export function bumpPatch(v: string): string`: `'0.1.9'` → `'0.1.10'`.
  - `export function setVersion(text: string, v: string): string | null`: replaces the first `^( {2,4}"version": )"…"`
    line and keeps the formatting. Returns `null` when there is none. This is the regex `release.mjs` uses today.
  - `export function syncBump(now: string, then: string | undefined): string | null`: the version a sync should write.
    It returns `bumpPatch(now)` when `now === then` (unbumped since the baseline), and `null` otherwise. It throws on a
    non-`X.Y.Z` `now`.
  - `export function bumpProblem({ name, dir, now, then, changed, tag }): string | undefined`:
    - `dir`: the plugin folder, with `\` normalised to `/` inside.
    - `changed`: every repo-relative path that differs from `tag`, repo-wide.
    - `then`: the version at `tag`, or `undefined`.
    - It keeps only the paths under `dir/`, plus `crates/<crate>/` for a `BIN_PLUGINS` entry. It drops
      `crates/<crate>/Cargo.lock`. It applies the ponytail rule.
    - Returns an error line, or `undefined` when fine.
  - `export function baselineTag(cwd = ROOT): string | null`: `git describe --tags --match v* --abbrev=0`.
  - `export function changedSince(tag: string, cwd = ROOT): string[]`: `git diff --name-only <tag>`, against the
    working tree, all paths.
  - `export function versionAt(tag: string, file: string, cwd = ROOT): string | undefined`: `git show <tag>:<file>`,
    then `.version`.
  - The git readers use `spawnSync('git', args, { cwd, encoding: 'utf8' })`. They return `null`/`[]`/`undefined` on
    a non-zero status and never throw. They don't reuse `sync-lib`'s `git`, because that throws and `sync-lib` will
    import this module.

- [ ] **Step 1: Write the failing tests in `scripts/versions.test.mjs`**

```js
test('isVersion accepts X.Y.Z only', () => {
  for (const v of ['0.1.0', '5.3.2', '10.0.12']) assert.ok(isVersion(v));
  for (const v of [undefined, '', '1.0', '29c78da38ecf', 'v1.0.0', '1.0.0-beta.1']) assert.ok(!isVersion(v));
});
test('bumpPatch, setVersion and syncBump', () => {
  assert.equal(bumpPatch('0.1.9'), '0.1.10');
  assert.equal(
    setVersion('{\n  "name": "p",\n  "version": "0.1.0",\n  "x": 1\n}\n', '0.1.1'),
    '{\n  "name": "p",\n  "version": "0.1.1",\n  "x": 1\n}\n',
  );
  assert.equal(setVersion('{\n  "name": "p"\n}\n', '0.1.1'), null);
  assert.equal(syncBump('0.1.0', '0.1.0'), '0.1.1');
  assert.equal(syncBump('0.1.1', '0.1.0'), null); // postgres' second finish(): already bumped
  assert.equal(syncBump('0.1.0', undefined), null); // new since the baseline
  assert.throws(() => syncBump('29c78da38ecf', '29c78da38ecf'));
});
const cswap = { name: 'cswap', dir: 'plugins/opt-in/cswap', tag: 'v0.6.0' };
test('bumpProblem: a changed plugin must move its version', () => {
  const changed = ['plugins/opt-in/cswap/hooks/register.tsx', 'plugins/opt-in/md-pane/x'];
  assert.match(bumpProblem({ ...cswap, now: '0.1.0', then: '0.1.0', changed }), /cswap.*v0\.6\.0.*bump/);
  assert.equal(bumpProblem({ ...cswap, now: '0.1.1', then: '0.1.0', changed }), undefined);
  assert.equal(
    bumpProblem({ ...cswap, now: '0.1.0', then: '0.1.0', changed: ['plugins/opt-in/md-pane/x'] }),
    undefined,
  );
  assert.equal(
    bumpProblem({ ...cswap, now: '0.1.0', then: '0.1.0', changed: ['plugins/opt-in/cswap-old/x'] }),
    undefined,
  );
  // Windows: pluginDirs() gives '/', but a join() result must not silently exempt the plugin
  assert.match(bumpProblem({ ...cswap, dir: 'plugins\\opt-in\\cswap', now: '0.1.0', then: '0.1.0', changed }), /bump/);
});
test('bumpProblem: lower than the baseline only fails after the shared era', () => {
  const changed = ['plugins/opt-in/cswap/x'];
  assert.match(bumpProblem({ ...cswap, now: '0.1.0', then: '0.2.0', changed }), /lower/);
  assert.equal(bumpProblem({ ...cswap, tag: 'v0.5.0', now: '0.1.0', then: '0.5.0', changed }), undefined);
});
test('bumpProblem exemptions: new plugin, Cargo.lock only, ponytail without a new UPSTREAM', () => {
  assert.equal(
    bumpProblem({ ...cswap, now: '0.1.0', then: undefined, changed: ['plugins/opt-in/cswap/x'] }),
    undefined,
  );
  const tui = { name: 'tui-review', dir: 'plugins/shared/tui-review', tag: 'v0.6.0', now: '0.1.0', then: '0.1.0' };
  assert.equal(bumpProblem({ ...tui, changed: ['crates/tui-review/Cargo.lock'] }), undefined);
  assert.match(
    bumpProblem({ ...tui, changed: ['crates/tui-review/Cargo.lock', 'crates/tui-review/src/main.rs'] }),
    /bump/,
  );
  const pony = { name: 'ponytail', dir: 'plugins/shared/ponytail', tag: 'v0.6.0', now: '5.3.2', then: '5.3.2' };
  assert.equal(bumpProblem({ ...pony, changed: ['plugins/shared/ponytail/hooks/x.ts'] }), undefined);
  assert.match(
    bumpProblem({ ...pony, changed: ['plugins/shared/ponytail/UPSTREAM', 'plugins/shared/ponytail/hooks/x.ts'] }),
    /bump/,
  );
});
test('git readers against a throwaway repo', () => {
  const repo = mkdtempSync(join(tmpdir(), 'versions-'));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a]);
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  assert.equal(baselineTag(repo), null);
  mkdirSync(join(repo, 'p/.claude-plugin'), { recursive: true });
  writeFileSync(join(repo, 'p/.claude-plugin/plugin.json'), '{\n  "version": "0.1.0"\n}\n');
  g('add', '.');
  g('commit', '-qm', 'one');
  g('tag', 'v0.0.1');
  writeFileSync(join(repo, 'p/x'), 'x');
  writeFileSync(join(repo, 'p/.claude-plugin/plugin.json'), '{\n  "version": "0.1.1"\n}\n');
  g('add', '.');
  assert.equal(baselineTag(repo), 'v0.0.1');
  assert.deepEqual(changedSince('v0.0.1', repo).sort(), ['p/.claude-plugin/plugin.json', 'p/x']);
  assert.equal(versionAt('v0.0.1', 'p/.claude-plugin/plugin.json', repo), '0.1.0');
  assert.equal(versionAt('v0.0.1', 'q/.claude-plugin/plugin.json', repo), undefined);
  rmSync(repo, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the tests and check they fail**
  - Run: `node --test scripts/versions.test.mjs`
  - Expected: FAIL, because `versions.mjs` does not exist.
- [ ] **Step 3: Implement `scripts/versions.mjs` and the `core.mjs` exports**
  - Messages:
    - `${dir}/.claude-plugin/plugin.json: changed since ${tag} but still ${now}: bump its version`
    - `${dir}/.claude-plugin/plugin.json: ${now} is lower than ${then} at ${tag}`
  - Shared era: `!newer(tag.slice(1), LAST_SHARED)`. Lower: `newer(then, now)`.
  - ponytail: `undefined` unless `changed` holds `${dir}/UPSTREAM`.
- [ ] **Step 4: Run the tests and check they pass**
  - Run: `npm test`
  - Expected: PASS. The existing `core.test.mjs` is unaffected by the new exports.
- [ ] **Step 5: Commit**
  - Run: `git add scripts/versions.mjs scripts/versions.test.mjs installer/core.mjs flake.nix`
  - Message: `git commit -m "Add the version rules the per-plugin bump check is built from."`

### Task 3: Renumber every plugin and both crates, and turn on the bump check

The renumbering and the check land in one commit. csharp-skills, graphify and web-mcp already changed since `v0.5.0`
while still at 0.5.0, so the check alone would fail, and the pre-commit hook would stop the commit.

**Files:**

- Modify: every `plugins/**/.claude-plugin/plugin.json` (20 files, listed in Global Constraints), plus
  `crates/{tui-review,web-mcp}/Cargo.toml` and `Cargo.lock`.
- Modify: `installer/core.test.mjs:406-409`.
- Modify: `scripts/check-repo.mjs`: header comment (1-3); replace the "one version" block (63-82).
- Modify: `.github/workflows/test.yml`: the checkout gets `with: fetch-depth: 0`.
- Modify: `.github/dependabot.yml`: the cargo entry gets `versioning-strategy: lockfile-only`. GitHub's options
  reference says cargo supports it and that it "only create[s] pull requests to update lockfiles"; checked
  2026-10-21.

**Interfaces:**

- Consumes: `isVersion`, `bumpProblem`, `baselineTag`, `changedSince`, `versionAt` (Task 2); `BIN_PLUGINS`,
  `manifestPath` (`installer/core.mjs`).

- [ ] **Step 1: Change the core.test test to the new rule (failing after Step 2's plugin edits)**

```js
test('each binary plugin ships the version its crate builds', () => {
  const market = json('.claude-plugin/marketplace.json');
  for (const [plugin, { name }] of Object.entries(BIN_PLUGINS)) {
    const cargo = readFileSync(new URL(`../crates/${name}/Cargo.toml`, import.meta.url), 'utf8');
    assert.equal(/^version = "(.+)"/m.exec(cargo)[1], json(manifestPath(market, plugin)).version, plugin);
  }
});
```

- [ ] **Step 2: Set the versions**
  - ponytail: `5.3.2`. Every other `plugin.json`: `0.1.0`.
  - Run `node --test installer/core.test.mjs`. Expected: FAIL on tui-review (crate 0.5.0, plugin 0.1.0).
  - Then set both `Cargo.toml` files and each crate's own `Cargo.lock` entry to `0.1.0`, with the regexes
    `release.mjs` uses today.
  - Hand edits, or a one-off `node -e` using `setVersion`. Don't add a script for this.
- [ ] **Step 3: Replace check-repo's "one version" block**
  - Keep: marketplace `metadata.version` === package.json `version`.
  - Per `pluginDirs` entry, with `manifest = \`${dir}/.claude-plugin/plugin.json\``, a template string, not `join`:
    - its version must pass `isVersion`;
    - for a `BIN_PLUGINS` entry, `crates/<name>/Cargo.toml`'s version and its `Cargo.lock` entry must equal it.
      Keep today's two regexes.
  - The bump check:
    - `tag = baselineTag()`. When it's `null`, print `no v* tag reachable: skipping the version bump check`.
    - Otherwise compute `changed = changedSince(tag)` once.
    - Per plugin, call `bumpProblem({ name, dir, now, then: versionAt(tag, manifest), changed, tag })`.
  - Update the header and section comments to say what is checked now.
- [ ] **Step 4: test.yml and dependabot.yml**
  - Edit both as listed under Files.
- [ ] **Step 5: Run everything**
  - Run: `npm test`
  - Expected: pass. The 0.5.0 → 0.1.0 drops are allowed because the baseline is `v0.5.0`.
  - Then run `cargo metadata --locked --format-version 1 >/dev/null` in each crate. Expected: exit 0, which proves
    the lock matches without a build.
- [ ] **Step 6: Prove that the check bites**
  - Every version moved in this task, so a real miss can only be staged against `v0.5.0`.
  - Temporarily set md-pane's `plugin.json` back to `0.5.0` and append a blank line to
    `plugins/opt-in/md-pane/README.md`. Then run `node scripts/check-repo.mjs`.
  - Expected: `✗ plugins/opt-in/md-pane/.claude-plugin/plugin.json: changed since v0.5.0 but still 0.5.0: bump its
version`.
  - Restore both files.
- [ ] **Step 7: Commit**
  - Message: `git commit -m "Give every plugin its own version: ours restart at 0.1.0, ponytail takes upstream's 5.3.2, and check that a changed plugin moves its version."`

### Task 4: Installer: shared-era downgrade and binary versions

**Files:**

- Modify: `installer/core.mjs` (`outdated`, ~522)
- Modify: `installer/install.mjs:327-345` (`applyBin`)
- Test: `installer/core.test.mjs:508-529`

**Interfaces:**

- Consumes: `LAST_SHARED`, `newer` (Task 2); `shipped` (`install.mjs:613`, `{ name: version }`).
- `outdated(rows, shipped)` keeps its signature.

- [ ] **Step 1: Update the outdated test (failing)**
  - In `outdated compares our shipped versions only…`, set hallmark's installed version to `'0.6.0'`. Expected: not
    offered, because a post-switch newer install is kept.
  - Add the row `{ id: \`md-pane@${M}\`, version: '0.5.0' }`, with shipped `'md-pane': '0.1.0'`. Expected entry:
`{ id: \`md-pane@${M}\`, from: '0.5.0', to: '0.1.0' }`.
  - Keep cswap (0.1.0 → 0.1.1) and graphify (sha → 0.1.1) as they are.
  - Rename the test to `…, never downgrading past the shared era`.
- [ ] **Step 2: Run it and check it fails**
  - Run: `node --test installer/core.test.mjs`
  - Expected: FAIL on the md-pane entry.
- [ ] **Step 3: Change `outdated`**
  - An install stays when `version === to`, or when `newer(version, to) && newer(version, LAST_SHARED)`.
  - Update its comment.
- [ ] **Step 4: Change `applyBin`**
  - `binAction`'s `version` and the progress label come from `shipped[pluginName]`.
  - `binAsset(…)` keeps `VERSION`, the repo tag the asset lives under.
  - Update its comment.
- [ ] **Step 5: Run the tests**
  - Run: `npm test`
  - Expected: pass.
- [ ] **Step 6: Commit**
  - Message: `git commit -m "Let the installer move shared-era installs to the new numbers and expect each binary at its plugin's version."`

### Task 5: Syncs: ponytail keeps upstream's version, the others bump the patch digit, every sync PR is checked

**Files:**

- Modify: `scripts/sync-lib.mjs` (`finish`, new `pluginRoot`), `scripts/sync-lib.test.mjs`
- Modify: `scripts/sync-ponytail.mjs`
  - header (1-3);
  - fail when `manifest.version !== latest.tag.slice(1)`, before anything is deleted: `upstream ${latest.tag} ships
plugin.json version ${manifest.version}`;
  - write `manifest` as is (140-141);
  - call `finish(…, { bump: false })` (153).
- Modify: `.github/workflows/sync-{csharp,graphify,hallmark,mattpocock,paper-lookup,postgres,pstack,rust,self-review,tob,ponytail}.yml`
  - checkout `with: fetch-depth: 0`;
  - a `Repo checks` step running `node scripts/check-repo.mjs` before `Open pull request` (ponytail has one
    already);
  - `add-paths` widened to the plugin root in `sync-paper-lookup.yml` (`plugins/shared/paper-lookup`) and
    `sync-hallmark.yml` (`plugins/opt-in/hallmark`).

**Interfaces:**

- Consumes: `baselineTag`, `versionAt`, `syncBump`, `setVersion`, `isVersion` (Task 2).
- Produces:
  - `export function pluginRoot(dir: string): string`: the nearest ancestor-or-self of `dir` holding
    `.claude-plugin/plugin.json`. It throws when there is none.
  - `finish(label, sha, upstreamFile, dir, { bump = true } = {})`.

- [ ] **Step 1: Failing test in `sync-lib.test.mjs`**

```js
test('pluginRoot walks up to the plugin that owns a vendored folder', () => {
  assert.equal(
    pluginRoot(join(ROOT, 'plugins/shared/paper-lookup/skills/paper-lookup')),
    join(ROOT, 'plugins/shared/paper-lookup'),
  );
  assert.equal(
    pluginRoot(join(ROOT, 'plugins/opt-in/implementation/postgres/skills/postgres-best-practices')),
    join(ROOT, 'plugins/opt-in/implementation/postgres'),
  );
  assert.equal(pluginRoot(join(ROOT, 'plugins/shared/graphify')), join(ROOT, 'plugins/shared/graphify'));
  assert.throws(() => pluginRoot(join(ROOT, 'scripts')));
});
```

- [ ] **Step 2: Run it and check it fails**
  - Run: `node --test scripts/sync-lib.test.mjs`
  - Expected: FAIL, because `pluginRoot` is not exported.
- [ ] **Step 3: Implement**
  - When `changed && bump`, `finish` does the following:
    - It finds `root = pluginRoot(dir)` and `rel = relative(ROOT, root).split(sep).join('/')`.
    - It finds `tag = baselineTag()`.
      - With no tag on CI (`process.env.GITHUB_ACTIONS`), it calls `fail('no v* tag: fetch-depth: 0 missing?')`.
      - Locally, it prints `no v* tag: not bumping <label>'s version` and goes on.
    - It computes `next = syncBump(now, versionAt(tag, \`${rel}/.claude-plugin/plugin.json\`))`.
      - `syncBump` throws on a bad `now`; let that end the sync.
    - When `next` is set, it writes `setVersion(text, next)`. A `null` result means no version line: it calls
      `fail(\`${rel}: no version line to bump\`)`.
    - It prints `<label>: version <now> → <next>`.
- [ ] **Step 4: Run the tests**
  - Run: `npm test`
  - Expected: pass. `sync-ponytail.test.mjs` must still pass.
- [ ] **Step 5: Smoke-test one sync with a throwaway tag**
  - Before the first new-scheme release, the baseline `v0.5.0` holds 0.5.0, so no sync would bump. Stage a
    new-scheme baseline instead:
    - `git tag v9.9.9`
    - `node scripts/sync-graphify.mjs`
  - Expected:
    - If upstream moved: `graphify: version 0.1.0 → 0.1.1`, and `node scripts/check-repo.mjs` passes.
    - If it didn't: `unchanged`.
  - Then: `git tag -d v9.9.9 && git checkout -- plugins/shared/graphify`.
  - This needs the network; the sandbox may need `github.com`.
- [ ] **Step 6: Commit**
  - Message: `git commit -m "Have the syncs bump their plugin's patch version, check every sync PR, and keep ponytail at upstream's version."`

### Task 6: Release sets only the repo number; docs

**Files:**

- Modify: `scripts/release.mjs`: header (1-4) and `bumps` (36-50); drop the `pluginDirs` import.
- Modify: `.github/workflows/release.yml:3-5` (comment).
- Modify: `CLAUDE.md`:
  - "Versions and releases";
  - the "Vendored content: don't edit" list;
  - the ponytail mention "its `plugin.json` version is set by the sync and bumped by `release.mjs`".
- Modify: `README.md:32`, `THIRD_PARTY.md:119`, `plugins/default/README.md:19`.

**Interfaces:**

- Consumes: `setVersion` (Task 2).

- [ ] **Step 1: Change `release.mjs`**
  - `bumps` becomes `package.json` and `.claude-plugin/marketplace.json` only, edited with `setVersion`. It still dies
    when that returns `null`.
  - The rest stays: main only, clean tree, no existing tag, `npm test`, revert on failure, commit, tag.
  - New header comment: it sets the repo's release number only; plugin versions are set by hand in the change that
    touches the plugin (ADR 0003).
- [ ] **Step 2: Check the guard without releasing**
  - Run: `node scripts/release.mjs patch` on the feature branch.
  - Expected: `✗ releases are cut from main, you are on <branch>`, and `git status` shows no file changed.
- [ ] **Step 3: Docs**
  - CLAUDE.md "Versions and releases" replaces "Everything ships as one version…" with:
    - The repo's release number lives in `package.json` and the marketplace's `metadata.version`. `npm run release`
      sets it and tags `vX.Y.Z`.
    - Each plugin's `plugin.json` holds its own version; a crate carries its plugin's.
    - The bump rule, verbatim from the spec's Docs section.
    - `npm test` fails on a missing bump. Exempt: a new plugin, a `Cargo.lock`-only change, ponytail without a new
      `UPSTREAM`.
    - Dependabot's cargo PRs are lockfile-only.
    - ponytail carries upstream's number. The other syncs bump the patch digit, and every sync PR runs check-repo.
  - CLAUDE.md vendored list: add "(their `plugin.json` is ours)" to hallmark, mattpocock-picks, pstack-picks,
    tob-picks, paper-lookup, graphify and self-review, as it already says for `implementation/*-skills` and postgres.
  - README.md:32, THIRD_PARTY.md:119 and plugins/default/README.md:19: reword to match.
    - plugins/default/README.md:19: an install still on upstream's url-sourced 5.3.2 now matches the shipped 5.3.2,
      so it no longer switches on its own.
  - Don't touch the CLAUDE.md Layout section beyond the lines above.
- [ ] **Step 4: Run everything**
  - Run: `npm test`
  - Expected: pass.
  - Then run `grep -rn "one version\|ships as one" CLAUDE.md README.md THIRD_PARTY.md scripts .github plugins/default/README.md`.
  - Expected: no hit that describes current behaviour.
- [ ] **Step 5: Commit**
  - Message: `git commit -m "Make the release set only the repo's number and document per-plugin versions."`

---

## Not in this plan (by the spec)

- Per-plugin tags or GitHub releases.
- Changelogs.
- Skipping the build of unchanged binaries.
- Moving branch syncs to upstream tags.
- The reinstall fallback. It only becomes a task if Task 1 finds that `claude plugin update` won't move down.
- Looking up a moved plugin by name at the baseline. This is a known risk instead.
