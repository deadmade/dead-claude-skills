# Superpowers v7 and pinned imported plugins: spec

## Intent

The user wants to know when the third-party skills they run change, and to have the same skills on every machine.
Today the url-sourced plugins in `.claude-plugin/marketplace.json` are unpinned, so each machine gets whatever upstream
HEAD was when it installed or updated. Superpowers moves to 7.0.0 as part of this.

## Goals

1. superpowers is pinned to v7.0.0 and ponytail to v5.1.0, each by `ref` (the tag) and `sha` (the commit the tag
   points to). A given marketplace release installs byte-identical copies of both on every machine.
2. A scheduled workflow opens one PR per pinned plugin when upstream publishes a newer stable `vX.Y.Z` tag. The PR
   links the release and the compare diff so the change can be reviewed before merging.
3. feature-flow Phase 2 handles the two v7 brainstorming behaviours it doesn't cover yet: skip-the-questions and
   spikes.
4. README and THIRD_PARTY say how the imported plugins are pinned and updated.

## Non-goals

- Pinning atlassian. The user decided it stays unpinned and follows upstream main.
- Pinning plugins from claude-plugins-official. That marketplace pins them itself.
- Running `claude plugin validate` in CI.
- Renovate or Dependabot.
- Auto-merging or auto-releasing. A merged sync PR reaches machines only through the next `npm run release`.

## Anti-goals

- An update that reaches a machine without the user having merged a PR for it.
- A PR every week when nothing changed upstream.

## Design

### Pins: `.claude-plugin/marketplace.json`

| plugin      | source fields added                                                   |
| ----------- | --------------------------------------------------------------------- |
| superpowers | `"ref": "v7.0.0"`, `"sha": "bb92a77741419a4ab5f06e711a283343f1ada0c3"` |
| ponytail    | `"ref": "v5.1.0"`, `"sha": "9cc65d03aa2da1db7121b912d03596409ee340b8"` |
| atlassian   | none                                                                  |

These shas were resolved on 2026-10-11 with `git ls-remote`. superpowers' v7.0.0 tag is annotated, so its pin uses the
peeled `^{}` commit and not the tag object `7f043e5…`. When both fields are set, Claude Code checks out `sha`
([docs](https://code.claude.com/docs/en/plugins/marketplace-reference#plugin-sources)).

### Workflow: `.github/workflows/sync-plugins.yml`

Shape copied from `sync-cswap.yml`:

- Triggers: Monday cron and `workflow_dispatch`.
- Permissions: `contents: write`, `pull-requests: write`.
- Matrix `plugin`, one entry each:
  - `{name: superpowers, repo: obra/superpowers}`
  - `{name: ponytail, repo: DietrichGebert/ponytail}`
- `fail-fast: false`, so one failing upstream doesn't cancel the other job.

Each job runs `node scripts/sync-plugins.mjs <name> <repo>`, then create-pull-request.

`scripts/sync-plugins.mjs` follows the sync-*.mjs pattern and reuses `git` and `fail` from `scripts/sync-lib.mjs`:

1. One `git ls-remote --tags https://github.com/<repo>.git`, without `--refs`. From that output it picks the newest
   tag matching `^v\d+\.\d+\.\d+$` by version order, and that tag's commit: the `^{}` line when the tag is
   annotated, otherwise the plain line. It fails if no tag matches.
2. It edits `.claude-plugin/marketplace.json` in place with a regex anchored on the entry's
   `"url": "https://github.com/<repo>.git"`, replacing the `ref` and `sha` values. That's the same technique as
   `scripts/release.mjs:35-49`, so the rest of the file keeps its formatting. It fails if the entry or its
   `ref`/`sha` lines aren't found.
3. It prints `tag=` and `old=` (the previous `ref`) to `$GITHUB_OUTPUT` when that variable is set.

create-pull-request settings:

- branch `sync/<name>`, with `delete-branch: true`
- `add-paths: .claude-plugin/marketplace.json`
- title and commit message "Pin <name> to <tag>"
- the body:
  - links `https://github.com/<repo>/releases/tag/<tag>` and `https://github.com/<repo>/compare/<old>...<tag>`
  - says the change ships with the next release once main is merged into master
  - ends with `cc @deadmade`

If upstream hasn't changed, the file comes out identical and create-pull-request opens no PR.

Builder's call: it's one matrix and not two workflows, so adding a plugin later is one line.

Formatting: the regex-in-place edit replaces the jq + prettier approach, decided in plan review on 2026-10-11. jq
re-flows arrays that prettier keeps on one line, and the repo already edits this file with regexes in `release.mjs`.

Declining a bump: leave its PR open. Each weekly run only updates the open PR. A PR that is closed without merging
comes back the next Monday.

Branches: scheduled runs and their PRs target the default branch, `main`, but `release.mjs` releases from `master`.
That mismatch existed before this feature and is out of scope. Follow-up: align them.

Major upstream bumps (for example v7 → v8) get no special handling. The tag in the PR title shows it's a major
bump, and the PR itself is the review step.

### feature-flow: `plugins/feature-flow/skills/feature-flow/SKILL.md`, Phase 2

Add two bullets next to **Size**:

- **Skip.** If the user takes brainstorming's offer to skip the questions, brainstorming ends without a spec. In
  that case Claude writes the spec itself from the request and the grounding, marks each choice it made as its own
  call, and goes to Phase 3. Gate 1 still applies.
- **Spike.** A spike the user agrees to is allowed. Record it in flow.md as throwaway. It doesn't count as building,
  doesn't pass Gate 2, and keeping its code goes through the plan like any other code.

The Skip spec gets no v7 builder check. Phase 3 grilling covers that (decided 2026-10-11).

Builder's call: no version bump here. `scripts/release.mjs` bumps every local plugin's version together.

### Installer: url-sourced plugins count as shipped

`installer/install.mjs:475-480` builds `shipped` from local plugins only, so `outdated()` never offers a superpowers or
ponytail update. Pinned url entries get added with version `ref` minus its leading `v`. Upstream `plugin.json`
versions match their tags: 7.0.0 and 5.1.0. Re-running the installer then updates them like the local plugins.

### Docs

- **README.md:85.** Today it says superpowers, ponytail and atlassian "keep their own versions". Replace that with:
  superpowers and ponytail are pinned to a release tag and commit in `marketplace.json`; the weekly
  `sync-plugins` workflow opens a PR when upstream releases; atlassian follows upstream main. To decline a bump, leave its PR open.
- **THIRD_PARTY.md:51.** Make the same point in one sentence.

## Testing

- `node scripts/check-repo.mjs` and `node --test installer/ scripts/` pass. `nix fmt` leaves no diff.
- `claude plugin validate .` passes locally with the new source fields.
- `node scripts/sync-plugins.mjs ponytail DietrichGebert/ponytail` against a file whose ponytail pin is set back to
  `v5.0.0`: `git diff` shows only ponytail's `ref` and `sha` lines changing, to v5.1.0 and `9cc65d0…`. Run against
  pins that are already current, it leaves the file unchanged.
- An installer test: a pinned url entry produces shipped version `7.0.0`, and installed 6.4.2 counts as outdated.
- After a release, re-running the installer updates superpowers to 7.0.0.

## Left to the builder

- Step names, cron minute, and the exact wording of the PR body.
