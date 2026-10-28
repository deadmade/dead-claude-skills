# Every merge to main releases a patch, and the marketplace follows the newest release

The user is the only one installing from this marketplace and wants each merged PR on their machines without cutting
a release by hand, while still choosing when a bigger version goes out. Claude Code only offers a plugin update when
its version changes, and the installer pinned the marketplace to a release tag, so tracking `main` without a version
change gets nothing.

`release.yml` now runs on every push to `main` (docs and root `*.md` files aside) and cuts a patch with
`npm run release -- patch --detach`: the bump is committed off `main` and only its tag is pushed, with the workflow's
token, which starts no other run, so the same run builds the binaries from that tag and publishes the release. A
release the user chooses is still `npm run release -- minor` (or `major`) pushed with its tag; the push to `main` that
carries it finds `HEAD` already tagged and releases that tag. `release.yml` has no tag trigger, so releases only come
from pushes to `main`, which only takes merged PRs (admins aside).

The installer used to pin the marketplace to its own `vX.Y.Z` tag, so a release only reached a machine when the
installer ran again. It now points the marketplace at a `release` branch that `release.yml` moves to each release once
it is published, and never back to an older one. Claude Code's marketplace auto-update follows the branch and offers
the new plugin versions by itself. tui-review's and web-mcp's binaries still come from the installer, at its own
version; tui-review's cache-format check names the fix when the two drift apart. This supersedes ADR 0003's "that is
still what the installer pins the marketplace to".

## Considered options

- **A stable and an edge channel** (prereleases on every merge, `latest/` only on chosen releases). Rejected: nobody
  else depends on the stable link, so the second channel and the installer's prerelease handling would buy nothing.
- **Pinning the marketplace to `main`.** Rejected: `main`'s plugin versions only change on a release cut by hand,
  so Claude Code would see nothing new between them.
- **The workflow pushes the bump commit to `main`.** Rejected: it needs push rights past any branch protection and
  makes every open branch pull a version commit after each merge.

## Consequences

- `main`'s `package.json` holds the last release cut by hand, not the newest. `scripts/next-version.mjs` counts from
  the highest `vX.Y.Z` tag, so a local `npm run release` needs the tags fetched.
- Every release bumps every plugin, so each merge shows every plugin as updatable (ADR 0003 would fix that).
- Each merge builds tui-review and web-mcp on Windows and Linux.
- With every machine following `release`, `release.yml` is the only workflow whose token may write; the sync
  workflows push with a GitHub App's token instead.
