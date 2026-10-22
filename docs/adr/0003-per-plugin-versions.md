# Each plugin carries its own version; a release only sets the repo's

Every release used to copy one number into every plugin, both crates, package.json and the marketplace. Claude Code
offers a plugin update only when its version changes, so every plugin looked outdated after every release, whether it
changed or not.

**Plugin numbers.**

- Each plugin's `plugin.json` now holds its own number. A Rust crate shares the number of the plugin it ships with.
- The number is raised by hand in the change that touches the plugin. `npm test` fails when a plugin's files changed
  since the last release but its number didn't.
- The plugins we wrote restarted at 0.1.0.

**Repo number.** `npm run release` sets only the repo's number: package.json, the marketplace's `metadata.version`
and the `vX.Y.Z` tag. That is still what the installer pins the marketplace to and downloads binaries from.

**Vendored plugins.** ponytail stays vendored in this repo, as ADR 0002 decided. It now carries upstream's release
number again, and its sync sets it. Other vendored plugins copy an upstream branch, not a release, so they get our own
number, and their syncs bump it.

## Considered options

- **The release bumps only the plugins that changed** (lerna's independent mode). Rejected: the user wants to choose
  each number while making the change.
- **Intent files per change** (changesets) and **a release-PR bot** (release-please, release-plz). Rejected: both add
  dependencies or conventions this single-author repo doesn't need.
- **No versions, so every commit counts as an update.** Rejected: it contradicts "only on release".

## Consequences

- **The switch moves numbers down.** The installer offers the lower number to installs that still carry a shared-era
  number (0.5.0 or below). Claude Code's update replaces a plugin whenever its version differs (ADR 0002).
- **Exemptions from the bump check.** A `Cargo.lock`-only change ships with the tool's next real change. A change to
  ponytail that comes from our sync script alone, without a new upstream release, waits for upstream's next release.
- **Supersedes** ADR 0002's "Our version number" cost.
