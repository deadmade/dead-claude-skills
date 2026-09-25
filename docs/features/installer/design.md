# Installer: design

> Drafted by Claude at the developer's request (notes D0); the developer reviews and edits it before `approve design`.

## Scope
Replace `INSTALL.md` with `npx github:deadmade/dead-claude-skills`: an interactive checklist that installs or
uninstalls the opt-in plugins, keeps `dead-skills` installed, removes same-named plugins from other marketplaces,
merges the owned keys into `settings.json`, and toggles the ccstatusline config and a global rules file. Targets:
Windows and NixOS.

Doesn't: collect PATs (D1), install binaries (A15, it prints the commands), write backups or logs (D2, A10),
publish to npm (A7), mirror `~/.claude.json` (A17), support macOS (A5), touch `CLAUDE.md` (M14).

## Touched code
- `INSTALL.md`: deleted.
- `scripts/check-repo.sh`: drop the INSTALL.md opt-in table check (lines 42-55) and its mention in the header
  comment; the bundle ⊂ marketplace and plugins/ checks stay.
- `flake.nix`: drop `INSTALL\.md$` from `plugin-validate.files`; add an `installer-test` hook
  (`node --test installer/`, runtimeInputs `nodejs`, files `^(installer/|package\.json$)`).
- `README.md` "Quick setup": replaced by `npx github:deadmade/dead-claude-skills` (needs `git`, `node` 20+ and
  `claude` on PATH).

## New code
- `package.json` (root): `name: dead-claude-skills`, `private: true`, `type: module`, one `bin`
  (`dead-claude-skills: installer/install.mjs`, M1), `engines.node >=20`, `files` listing `installer/`,
  `.claude-plugin/marketplace.json`, `plugins/*/.claude-plugin/plugin.json` (M16). No dependencies, no scripts (M2).
- `installer/install.mjs`: all I/O (TTY guard, spawning `claude`, checklist, file writes, summary).
- `installer/core.mjs`: pure decision functions, the unit under test.
- `installer/core.test.mjs`: `node:test` tests.
- `installer/ccstatusline.json`: the shipped ccstatusline config (from this machine, NixOS paths scrubbed, Q15).
- `installer/rules.md`: global instructions: commit messages are one sentence; never add co-author lines (A21).

## Public interface
- CLI: `npx github:deadmade/dead-claude-skills`, no flags.
- `core.mjs`:
  - `optIns(marketplace, bundle) -> string[]`: marketplace names − `dead-skills` − `bundle.dependencies`.
  - `needsToken(pluginJson) -> bool`: any `userConfig` entry with `sensitive: true`.
  - `planPlugins(selected, installedIds, tokenPlugins) -> {install, uninstall, handoff}`.
  - `duplicates(installedIds, ourNames) -> string[]`: ids with our name from another marketplace.
  - `mergeSettings(settings, {statusLine}) -> settings`: owned keys only, idempotent.
  - `safeArg(s) -> s`: throws unless `/^[a-z0-9@.:=\/_-]+$/i`.
  - `missingBinaries(platform, installedNames, onPath) -> {binary, command}[]`.

## External calls
All via `spawnSync`, piped stdio, args passed through `safeArg`. On `win32` a single command string with
`shell: true` (covers `claude.cmd` and `claude.exe`, M5); elsewhere an args array without a shell.
- `claude plugin marketplace list --json`; then `marketplace add deadmade/dead-claude-skills` or
  `marketplace update dead-claude-skills`.
- `claude plugin list --json`.
- `claude plugin install <name>@dead-claude-skills --scope user --json`.
- `claude plugin uninstall <id> --json`, then one `claude plugin prune -y` after any uninstall (M9, Q8).
- Files: `<config>/settings.json`, `<config>/plugins/known_marketplaces.json` (read only),
  `<config>/rules/dead-claude-skills.md`, `~/.config/ccstatusline/settings.json`, where
  `<config>` = `$CLAUDE_CONFIG_DIR` or `~/.claude`. (ccstatusline's `CLAUDE_CONFIG_DIR` behaviour: verify against
  S11 during implementation.)

## Libraries
Node ≥ 20 stdlib only: `readline` (keypress + raw mode for the checklist, `question` for yes/no),
`child_process`, `fs`, `os`, `path`, `node:test`. No third-party packages.

## Data flow
1. Exit 1 with "run this in a terminal" unless stdin and stdout are TTYs (M3).
2. Add or update the marketplace.
3. Read the installed plugin list and the manifests shipped in the package (same git ref).
4. Show the checklist, pre-selected to what's present: `dead-skills` (fixed on, deps shown as "required by
   dead-skills", M10), each opt-in (token plugins marked "token entered in Claude Code"), `ccstatusline`,
   `global instructions`.
5. List duplicates; on one yes, uninstall them (A16).
6. Install/uninstall per `planPlugins`; prune once if anything was uninstalled.
7. `settings.json`: if it's a symlink, print the snippet. Otherwise merge, show the diff of owned keys, ask, write
   atomically (temp in same dir + rename), keeping EOL and 2-space indent. Read back `known_marketplaces.json`
   and report the effective `autoUpdate` (M12, report only).
8. ccstatusline: on → write if missing; if it differs ask first; if the existing `version` is higher than the
   shipped one, warn and default to keep (M15). Off → delete the file; the `statusLine` block goes in step 7 (A22).
9. Rules: on → write `rules.md` to `<config>/rules/dead-claude-skills.md`; off → delete it.
10. Print missing binaries with a copy-paste command for this OS (A15).
11. Summary: changes, failures, handoff lines for token plugins (`/plugin install mcp-x@dead-claude-skills` plus
    the prep info from INSTALL.md §4), then "restart Claude Code or `/reload-plugins`" (M13).

## Failure paths
- Not a TTY → message, exit 1, nothing changed.
- `claude` not found / spawn error → message naming the prerequisite, exit 1.
- Marketplace add/update fails → report and exit 1 (nothing else can work).
- A single install/uninstall/prune fails → collect its stderr/json error, continue, list it in the summary,
  exit code 1 at the end.
- `settings.json` has invalid JSON → don't write; report it and print the snippet.
- `settings.json` is a symlink → don't write; print the snippet.
- User says no to a diff/replace → skip that file, note it in the summary.
- An arg fails `safeArg` → throw before spawning (manifest was tampered with).
- Ctrl-C in the checklist → restore the terminal mode, exit 130, nothing changed.

## Tests
- opt-ins from the real manifests are exactly mcp-github, mcp-azure, mattpocock-picks, pstack-picks, graphify
- mcp-github and mcp-azure need a token; graphify doesn't
- selecting an uninstalled opt-in installs it; deselecting an installed one uninstalls it
- a selected, uninstalled token plugin goes to handoff, not install
- a plugin with our name from another marketplace is a duplicate; ours is not
- merging adds the permission and marketplace, keeps foreign keys and existing allow entries
- merging twice gives the same result
- statusLine off removes a ccstatusline block but keeps a foreign one
- safeArg rejects `&`, `%`, `"` and spaces
- missing binaries: Windows gets no nixd row but a disable hint; NixOS gets nix package names
- check-repo.sh passes without INSTALL.md
