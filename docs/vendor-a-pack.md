# Vendoring a pack

A checklist of the places a new vendored source touches. Tick each or say why not.

## Sync

- [ ] `scripts/sync-<name>.mjs` using `scripts/sync-lib.mjs`; the transform is where upstream is changed, never the
      copied files. Add a `sync-<name>.test.mjs` when the transform has logic.
- [ ] An entry in `SOURCES` (`scripts/sync-sources.mjs`): the script, the paths its PR adds, its checks (skill
      counts and the like) and its PR text. The weekly `.github/workflows/sync.yml` runs it with check-repo and the
      skill scan before opening its PR; a script that reports new upstream skills (`reportNew`) gets `newSkills`.

## Where it lives

- [ ] Packs the conductors read live at `plugins/flows/packs/<pack>/`, not as a marketplace entry. Only a pack that
      brings tools (a binary, an MCP server, hooks) is its own plugin under `plugins/shared/` or `plugins/opt-in/`,
      with a marketplace entry and `plugin.json`.
- [ ] A pack under `packs/` still carries its `.claude-plugin/plugin.json`: check-repo's version loop reads it, and
      the installer's pack list comes from it (the installer tarball ships only `plugin.json` files).
- [ ] A pack skill is read by path (`<packs>/<pack>/skills/<name>/SKILL.md`), so name the pack in `flow-rules.md`'s
      **Loading skills** list.

## Docs and config

- [ ] `THIRD_PARTY.md`: source, license, what is vendored.
- [ ] `CLAUDE.md`: add the path to "Vendored content: don't edit".
- [ ] `flake.nix`'s `vendored` list and `treefmt.toml`: exclude the vendored path from formatters and hooks.
      `.pre-commit-config.yaml` is generated from that list, so don't edit it.

## Checks and wiring

- [ ] `scripts/check-repo.mjs`: it must pass; extend it if the pack adds a new kind of file.
- [ ] Where a conductor overrides or pastes a pack sentence, quote it with a marker,
      `<!-- overrides <pack>/<path inside the pack>: "<sentence>" -->`. `checkOverrides` in `scripts/flows-uses.mjs`
      fails when the pack no longer holds the sentence.
- [ ] Each conductor's `uses.json` lists the pack skills it runs; then `node scripts/flows-uses.mjs` regenerates
      flows' `dependencies` and README tree.
- [ ] READMEs (root, flows, the plugin's) and the plugin/marketplace `description`s say what the code now does.
- [ ] `npm test`.
