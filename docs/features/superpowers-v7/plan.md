# Superpowers v7 and Pinned Imported Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin superpowers to v7.0.0 and ponytail to v5.1.0 by tag and commit. Add a weekly workflow that opens one
PR per plugin when upstream tags a newer release. Patch feature-flow for v7 brainstorming's skip and spike paths.

**Architecture:**

- The pins are two fields (`ref`, `sha`) on each url `source` in `.claude-plugin/marketplace.json`.
- `scripts/sync-plugins.mjs <name> <repo>` resolves the newest stable tag to its commit and regex-edits the pin in
  place, like `release.mjs` does with versions.
- `.github/workflows/sync-plugins.yml` is `sync-cswap.yml` turned into a two-entry matrix that runs the script and
  opens a PR on `sync/<name>`.
- The installer counts pinned url plugins as shipped, so re-running it updates them.
- feature-flow and the docs only change text.

**Tech Stack:** GitHub Actions, Node (stdlib only), `node:test`, `peter-evans/create-pull-request@v8`.

**Spec:** `docs/features/superpowers-v7/spec.md`

## Global Constraints

- superpowers pin: `"ref": "v7.0.0"`, `"sha": "bb92a77741419a4ab5f06e711a283343f1ada0c3"`.
- ponytail pin: `"ref": "v5.1.0"`, `"sha": "9cc65d03aa2da1db7121b912d03596409ee340b8"`.
- atlassian stays unpinned.
- Stable tag filter: `^v[0-9]+\.[0-9]+\.[0-9]+$`. The newest one is picked by numeric version compare in `newestTag`.
- Annotated tags resolve to the peeled `^{}` commit. Each sha is 40 lowercase hex characters.
- `marketplace.json` is edited in place by regex and never re-serialized, so its formatting is kept.
- `npm test` (check-repo + installer and scripts tests) is the check: test.yml, release.yml and release.mjs all run it.
- Commit messages are one sentence with no co-author lines. Commit only with the user's agreement.
- No version bumps. `npm run release` bumps every version together.

## Review Focus

1. **An annotated upstream tag.** The pin must be the commit, not the tag object. Task 2's dry run checks
   superpowers, whose v7.0.0 tag is annotated.
2. **A lightweight upstream tag.** It has no `^{}` line, so the plain line is the commit. Task 2's dry run checks
   ponytail.
3. **Upstream unchanged.** The workflow must leave `marketplace.json` byte-identical, so no PR opens. Task 2 checks
   this.
4. **Formatting drift.** The diff touches only the two pin lines of one entry. Task 2 checks this.
5. **A repo with no stable tag, a failed ls-remote, or no entry with that repo's url.** The script fails loudly and
   writes nothing. Task 2 tests the unknown-repo case. The matrix `name` is only used for the branch and the title.

---

### Task 1: Pin superpowers and ponytail

**Files:**

- Modify: `.claude-plugin/marketplace.json:21-37`

**Interfaces:**

- Produces: `.plugins[] | select(.name == "superpowers" or .name == "ponytail") | .source` with `ref` and `sha`
  set. Task 2 rewrites those same two fields.

- [ ] **Step 1: Add the fields.** Add `"ref"` and `"sha"` after `"url"` in both `source` objects, with the values
      from Global Constraints. Don't touch the atlassian entry.
- [ ] **Step 2: Verify.** Run `node scripts/check-repo.mjs`. Expected: exit 0. If `claude` is on PATH, this also
      runs `claude plugin validate .`, which must accept `ref` and `sha`.
- [ ] **Step 4: Commit.**
      `git commit -m "Pin superpowers to v7.0.0 and ponytail to v5.1.0 by tag and commit."`

### Task 2: Sync script, workflow and docs

**Files:**

- Create: `scripts/sync-plugins.mjs`, `scripts/sync-plugins.test.mjs`, `.github/workflows/sync-plugins.yml`
- Modify: `README.md:87`, `THIRD_PARTY.md:60`, `package.json` (`test` script), `flake.nix` (`installer-test` hook)

**Interfaces:**

- Consumes: the `ref` and `sha` lines from Task 1, plus `git` and `fail` from `scripts/sync-lib.mjs`.
- Produces two pure functions that the CLI wraps:
  - `export function newestTag(lsRemote: string): { tag: string, sha: string } | undefined`
  - `export function pin(text: string, repo: string, tag: string, sha: string): { text: string, old: string } | undefined`

  The CLI is `node scripts/sync-plugins.mjs <name> <repo>`. It calls `fail` when either function returns undefined.
  When `GITHUB_OUTPUT` is set it appends `tag=`, `old=` and `sha=` to it. It only runs its main code when it is
  executed directly, so the test can import it (`import.meta.url === pathToFileURL(process.argv[1]).href`).

- [ ] **Step 1: Write the failing tests** in `scripts/sync-plugins.test.mjs` with `node:test`:
  - `newestTag picks the peeled commit of an annotated tag`. Input lines, tab-separated:
    - `7f04… refs/tags/v7.0.0`
    - `bb92… refs/tags/v7.0.0^{}`
    - `aaaa… refs/tags/v6.4.2`
    - `cccc… refs/tags/v8.0.0-beta.1`

    Expect `{tag: 'v7.0.0', sha: 'bb92…'}`. Use full 40-hex values.
  - `newestTag takes the plain line of a lightweight tag and orders v5.10.0 above v5.9.0`.
  - `newestTag returns undefined without a stable tag`.
  - `pin rewrites only the matching entry`. Run it on the real `.claude-plugin/marketplace.json` with repo
    `DietrichGebert/ponytail`, tag `v999.0.0` and a fake sha.
    - Expect `old` to equal ponytail's `source.ref` read through `JSON.parse`, so the test survives future sync PRs.
    - Expect the line diff against the input to be exactly ponytail's `ref` and `sha` lines.
  - `pin returns undefined for an unknown repo`.
- [ ] **Step 2: Run** `node --test scripts/`. Expected: FAIL, because the module doesn't exist yet.
- [ ] **Step 3: Implement** `scripts/sync-plugins.mjs`.
  - `newestTag`: keep the refs matching `refs/tags/(v\d+\.\d+\.\d+)(\^\{\})?$`, take the max version by numeric
    compare, and prefer that tag's `^{}` sha.
  - `pin`: one regex, multiline, built from the escaped url, in the shape
    `("url": "<url>",\n\s*"ref": )"([^"]*)"(,\n\s*"sha": )"[^"]*"`.
  - The CLI fetches with `git('ls-remote', '--tags', url)` and writes the file back only when the text changed.
- [ ] **Step 4: Run** `node --test scripts/`. Expected: PASS.
- [ ] **Step 5: Live dry run.**
  1. Edit ponytail's pin in `marketplace.json` back to `v5.0.0` and its sha, which you get with
     `git ls-remote https://github.com/DietrichGebert/ponytail.git refs/tags/v5.0.0`.
  2. Run `node scripts/sync-plugins.mjs ponytail DietrichGebert/ponytail`. Expected: `git diff` against Task 1's
     commit is empty.
  3. Run `node scripts/sync-plugins.mjs superpowers obra/superpowers`. Expected: no change.
- [ ] **Step 6: Write the workflow** by copying `sync-cswap.yml`'s header, permissions and checkout.
  - Name it `Sync pinned plugins`. Cron `0 7 * * 1` plus `workflow_dispatch`.
  - `strategy: { fail-fast: false, matrix: { plugin: [{name: superpowers, repo: obra/superpowers}, {name: ponytail, repo: DietrichGebert/ponytail}] } }`.
  - Step `pin` (`id: pin`): `node scripts/sync-plugins.mjs ${{ matrix.plugin.name }} ${{ matrix.plugin.repo }}`.
  - Step `peter-evans/create-pull-request@v8`:
    - `branch: sync/${{ matrix.plugin.name }}`, `delete-branch: true`
    - `add-paths: .claude-plugin/marketplace.json`
    - commit message and title: `Pin <name> to ${{ steps.pin.outputs.tag }}`
    - body:
      - the release link and the `compare/<old>...<tag>` link
      - "Ships with the next release. To decline, leave this PR open."
      - `cc @deadmade`
- [ ] **Step 7: Run the new test automatically.**
  - In `package.json`, set `test` to `node scripts/check-repo.mjs && node --test "installer/*.test.mjs" "scripts/*.test.mjs"`.
  - In `flake.nix`, change the `installer-test` script to `exec node --test 'installer/*.test.mjs' 'scripts/*.test.mjs'`.
  - Widen its `files` to `^(installer/|scripts/|\.claude-plugin/marketplace\.json$|package\.json$)`.
- [ ] **Step 8: Docs.**
  - In `README.md:87`, replace "Superpowers, ponytail and atlassian come from their own repos and keep their own
    versions." with: superpowers and ponytail are pinned to a release tag and commit in `marketplace.json`; the weekly
    `sync-plugins.yml` opens a PR when upstream tags a new release (to decline, leave the PR open); atlassian follows
    upstream main.
  - In `THIRD_PARTY.md:60`, add that both entries are pinned to an upstream release commit.
- [ ] **Step 9: Verify.** `npm test` passes.
- [ ] **Step 10: Commit.**
      `git commit -m "Add a weekly workflow that opens a PR when superpowers or ponytail tag a new release."`

### Task 3: The installer updates pinned url plugins

**Files:**

- Modify: `installer/core.mjs` (next to `outdated`, around `:320`), `installer/install.mjs:366-368`
- Test: `installer/core.test.mjs`

**Interfaces:**

- Produces `export function shippedVersions(plugins, localVersion)` in core.mjs. Its arguments:
  - `plugins`: the marketplace's `plugins` array;
  - `localVersion(source)`: returns the version from a local plugin's plugin.json, or undefined.

  It returns `{ [name]: version }`:
  - for a string source, the result of `localVersion`, or nothing when that is undefined;
  - for an object source with `ref` matching `^v\d+\.\d+\.\d+$`, the ref without its `v`;
  - nothing for any other entry (atlassian, for example).

  `install.mjs` replaces its inline `shipped` builder with this call.

- [ ] **Step 1: Write the failing test** `shippedVersions counts pinned url plugins and skips unpinned ones`.
  - Input:
    - `[{name:'feature-flow', source:'./plugins/feature-flow'}, {name:'superpowers', source:{source:'url', url:'…', ref:'v7.0.0', sha:'…'}}, {name:'atlassian', source:{source:'url', url:'…'}}]`
    - `localVersion = (src) => src === './plugins/feature-flow' ? '0.1.1' : undefined`, plus a fourth entry
      `{name:'nover', source:'./plugins/nover'}`
  - Expected: `{ 'feature-flow': '0.1.1', superpowers: '7.0.0' }`.
  - Also: `` outdated([{ id: `superpowers@${M}`, version: '6.4.2' }], that) `` deep-equals
    `` [{ id: `superpowers@${M}`, from: '6.4.2', to: '7.0.0' }] ``.
- [ ] **Step 2: Run** `node --test installer/`. Expected: FAIL, because `shippedVersions` isn't exported.
- [ ] **Step 3: Implement** `shippedVersions` and use it in `install.mjs`.
- [ ] **Step 4: Run** `node --test installer/`. Expected: PASS, including the existing `outdated` test.
- [ ] **Step 5: Commit.**
      `git commit -m "Let the installer update superpowers and ponytail when their pinned release changes."`

### Task 4: feature-flow Phase 2 for v7 brainstorming

**Files:**

- Modify: `plugins/feature-flow/skills/feature-flow/SKILL.md`, the Phase 2 bullets **Size** and **Exit**

- [ ] **Step 1: Rewrite Size and Exit** for v7. Main wrote them for 6.4.2's Spike/Bounded/Architectural paths
      (deviation D3).
  - **Size:** brainstorming sizes the work as a quick task, a small change, or a project with a written design. A
    quick task or small change makes this flow overkill: say so and offer to drop out. If the user agrees, set
    `phase: done` with a note and let brainstorming finish its own way. Only a project continues here.
  - **Exit:** stop once the spec is written and the builder check is folded in. Gate 1 is the user's review of the
    spec after the grill. Don't invoke `writing-plans`, even though brainstorming's hard gate says to. Link the spec
    in flow.md and go to Phase 3.
- [ ] **Step 2: Add the two bullets** from the spec's "feature-flow" section, between **Size** and **Exit**:
  - **Skip:** Claude writes the spec from the request and the grounding, marks its own calls, then goes to Phase 3.
    Gate 1 still applies, and there is no builder check.
  - **Spike:** allowed and logged in flow.md as throwaway. It never passes Gate 2, and keeping its code goes through
    the plan.
- [ ] **Step 3: Verify.** `npm test` passes, and `grep -n "Bounded\|Architectural"` on the SKILL.md finds nothing.
- [ ] **Step 4: Commit.**
      `git commit -m "Update feature-flow's brainstorm phase for superpowers v7 sizing, builder check, skip and spikes."`

### After the tasks (Phase 7)

- After the next marketplace release, re-run the installer. Expected: it offers superpowers 6.4.2 → 7.0.0, and
  `~/.claude/plugins/cache/dead-claude-skills/superpowers/7.0.0` exists afterwards.
- Once merged to `main`, trigger the workflow with `workflow_dispatch`. Expected: both jobs green and no PR, because
  the pins are current.
- Update CLAUDE.md: add `sync-plugins.mjs` under `scripts/`, and mention the pins next to the `sync-*.yml` line.
