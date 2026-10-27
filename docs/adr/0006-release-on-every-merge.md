# Every merge to main releases a patch

The user is the only one installing from this marketplace and wants each merged PR on their machines without cutting
a release by hand, while still choosing when a bigger version goes out. Claude Code only offers a plugin update when
its version changes, and the installer pins the marketplace to a release tag, so tracking `main` without a version
change gets nothing.

`release.yml` now runs on every push to `main` (docs and root `*.md` files aside) and cuts a patch with
`npm run release -- patch --detach`: the bump is committed off `main` and only its tag is pushed. A tag pushed with
the workflow's token starts no other run, so the same run builds the binaries from that tag and publishes the
release. A release the user chooses is still `npm run release -- minor` (or `major`) pushed with its tag; the push to
`main` that carries it finds `HEAD` already tagged and leaves it to the tag's run.

## Considered options

- **A stable and an edge channel** (prereleases on every merge, `latest/` only on chosen releases). Rejected: nobody
  else depends on the stable link, so the second channel and the installer's prerelease handling would buy nothing.
- **The workflow pushes the bump commit to `main`.** Rejected: it needs push rights past any branch protection and
  makes every open branch pull a version commit after each merge.

## Consequences

- `main`'s `package.json` holds the last release cut by hand, not the newest. `scripts/next-version.mjs` counts from
  the highest `vX.Y.Z` tag, so a local `npm run release` needs the tags fetched.
- Every release bumps every plugin, so each merge shows every plugin as updatable (ADR 0003 would fix that).
- Each merge builds tui-review and web-mcp on Windows and Linux.
