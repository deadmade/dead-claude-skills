# Vendoring a pack

A checklist of the places a new vendored source touches. Tick each or say why not.

## Sync

- [ ] `scripts/sync-<name>.mjs` using `scripts/sync-lib.mjs`; the transform is where upstream is changed, never the
      copied files. Add a `sync-<name>.test.mjs` when the transform has logic.
- [ ] `.github/workflows/sync-<name>.yml`, weekly. It runs `check-repo` before opening its PR.

## Where it lives

- [ ] Packs the conductors read live at `plugins/flows/packs/<pack>/`, not as a marketplace entry. Only a pack that
      brings tools (a binary, an MCP server, hooks) is its own plugin under `plugins/shared/` or `plugins/opt-in/`,
      with a marketplace entry and `plugin.json`.
- [ ] A pack skill is read by path (`<packs>/<pack>/skills/<name>/SKILL.md`), so name the pack in `flow-rules.md`'s
      **Loading skills** list.

## Docs and config

- [ ] `THIRD_PARTY.md`: source, license, what is vendored.
- [ ] `CLAUDE.md`: add the path to "Vendored content: don't edit".
- [ ] `flake.nix`, `treefmt.toml` and `.pre-commit-config.yaml`: exclude the vendored path from formatters and hooks.

## Checks and wiring

- [ ] `scripts/check-repo.mjs`: it must pass; extend it if the pack adds a new kind of file.
- [ ] Where a conductor overrides or pastes a pack sentence, quote it with a marker,
      `<!-- overrides <pack>/<path inside the pack>: "<sentence>" -->`. `checkOverrides` in `scripts/flows-uses.mjs`
      fails when the pack no longer holds the sentence.
- [ ] Each conductor's `uses.json` lists the pack skills it runs; then `node scripts/flows-uses.mjs` regenerates
      flows' `dependencies` and README tree.
- [ ] READMEs (root, flows, the plugin's) and the plugin/marketplace `description`s say what the code now does.
- [ ] `npm test`.
