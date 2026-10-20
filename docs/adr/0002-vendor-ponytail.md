# Vendor ponytail as it ships instead of pointing at its repository

ponytail was a url-sourced marketplace entry pinned to a release tag. Its v5 releases added a mod (the band above the
prompt), hooks that run in every session and subagent, settings and a local task ledger, and the weekly sync PR showed
none of it: two changed lines, a tag and a commit, merged after a glance. Nothing in this repository showed what
ponytail runs, so agents working here had to guess or read whatever copy their machine had cached.

`scripts/sync-ponytail.mjs` copies the Claude Code parts of upstream's newest stable release into
`plugins/shared/ponytail/` unchanged, except for `plugin.json`'s `version`, which becomes ours. Each sync PR is the real
diff, with upstream's release notes (or, without any, its commit subjects) in the PR body. ADR 0001 vendors to keep the
listing small and to drop parts; this one vendors so the code that runs can be read here and every upstream change is
reviewed as a diff. Nothing is dropped or changed.

It costs:

- **Our version number.** ponytail ships as our version, like every local plugin. Installs from before the switch
  carry upstream's 5.x; Claude Code's update replaces a plugin whenever the version differs, so they move to the
  vendored copy on their next update, settings and data kept (checked on 2.1.304, `docs/features/ponytail-v5/flow.md`).
- **Upstream fixes ship with our releases.** That was already true of the pin.
- **The sync fails on parts it doesn't know.** A new `plugin.json` component or default component folder upstream stops
  the sync until someone decides how it fits.

Re-check this decision if superpowers needs the same treatment, or if upstream splits its other hosts' adapters out,
which would make a plain url entry of the Claude Code plugin readable enough.
