---
phase: done
verdict: ready
---

# Installer: notes

## Intent
<!-- Decisions from the intent grill; the confirmed summary. -->
Trigger: user is unhappy with `INSTALL.md` (a prose runbook executed by Claude Code) and wants
"a console application of some sorts to just run it that installs everything / walks the user through it".

**Round 1 (answered)**
- A1 Entry point: unsure of the mechanism; wants node/npm, ideally "paste a link to the package to run it".
  Interactive selection of plugins *and* of Claude settings to apply (names: remote config, ccstatusline).
- A2 Secrets: the installer prompts for the PAT itself and runs the commands; local execution is deemed
  acceptable. (-> What-matters, critical/security.) **Superseded by D1.**
- A3 `INSTALL.md` is deleted. (check-repo.sh coupling left unanswered -> round 2.)
- A4 Scope: "just touch the claude configs, asking me for installing on windows." (ambiguous -> round 2.)
- A5 Constraint: node + Claude Code may be assumed present. Primary targets Linux/NixOS and Windows;
  macOS explicitly not a target.
- A6 Done: leaves nothing behind; a second run detects what is installed, pre-selects it, and deselecting
  uninstalls it.

**Round 2 (answered)**
- A7 Distribution: `npx github:deadmade/dead-claude-skills`, same string on Windows and NixOS. No npm-registry publish.
- A8 Binaries: superseded by A15.
- A9 Settings: "match the settings of this claude code" + commit-message/co-author instructions (-> A13/A14).
- A10 Nothing behind = no log files; only Claude Code's own config/marketplace state. Deselect = plugin removed;
  leftover project dirs (e.g. `graphify-out/`) are the user's to clean.
- A11 Plugin list must be dynamic. (Fact given: marketplace.json minus dead-skills' `dependencies` = opt-ins;
  the INSTALL.md half of check-repo.sh:42-52 can be deleted.)
- A12 NixOS: settings files are no longer symlinked/home-manager-managed; Claude Code itself comes from
  nixpkgs/numtide flake. Editing `~/.claude` is fine there.

**Round 3 (answered)**
- A13 Ship ccstatusline + its config. Wants the "other settings file" (`/settings`) mirrored across machines too.
- A14 Commit-message-length + co-author instructions: currently nowhere; form undecided (global instructions
  vs. a git hook). -> slicing question.
- A15 Binaries: installer installs nothing. It prints the commands for the user to copy.
- A16 Duplicate plugins from other marketplaces: uninstalled by the installer.

**Facts gathered (not asked)**
- `~/.claude/settings.json`: permissions.allow, statusLine(ccstatusline), enabledPlugins(15), extraKnownMarketplaces,
  skipWorkflowUsageWarning.
- `~/.claude.json`: 132 KB, 98 keys, dominated by `projects` (49 KB), caches, migration flags, `userID`,
  `machineID`, `oauthAccount`. No `~/.claude/CLAUDE.md` exists.
- ccstatusline config: `~/.config/ccstatusline/settings.json` (1.4 KB), plus a `.bak`.

**Round 4-5 (answered)**
- A17 Mirroring `~/.claude.json` / `/settings` across machines: dropped.
- A18 ccstatusline config is committed into this repo and shipped; on a machine that already has one the
  installer asks before replacing.
- A19 All seven parts are this run. (Feasibility judged in Phase 4, not here.)
- A21 Form: a global instructions file, extensible later. Rules: commit messages are one sentence;
  never add co-author lines to commits.
- A22 ccstatusline is a separate toggle in the TUI; turning it off removes the `statusLine` block from
  `settings.json` *and* deletes `~/.config/ccstatusline/settings.json`.

**Confirmed summary (Phase 1 exit)**
Replace `INSTALL.md` with an interactive console installer run as `npx github:deadmade/dead-claude-skills` --
the same string on the work Windows box and the private NixOS box, the only two targets (macOS dropped). It reads
`marketplace.json` and `dead-skills`' `dependencies` at runtime, so a newly added plugin appears without code
changes. It presents the opt-in plugins as a checklist, pre-selected to what `claude plugin list` reports as
installed; selecting installs, deselecting uninstalls. It uninstalls same-named plugins coming from other
marketplaces. It owns `permissions.allow`, `extraKnownMarketplaces` and the `statusLine` block in
`~/.claude/settings.json`, and ships a committed ccstatusline config, asking before replacing an existing one;
ccstatusline is its own toggle, and turning it off removes both the `statusLine` block and the config file.
It writes a global instructions file with "commit messages are one sentence" and "never add co-author lines to
commits", extensible later. PATs for `mcp-github`/`mcp-azure` are typed into the installer itself, which runs the
install commands locally. It installs no system binaries -- it prints the commands to copy. It writes no logs and
leaves nothing behind beyond Claude Code's own config; project leftovers like `graphify-out/` are the user's to
clean. `INSTALL.md` is deleted and the `## 2.` table check in `scripts/check-repo.sh:42-52` goes with it.


## Later
<!-- Other slices, out-of-scope items, tangents. -->

## Sources
| id | source (title § section) | url or file:line | used for |
|---|---|---|---|
| S1 | npm CLI v11 § npm-exec, Description | https://docs.npmjs.com/cli/v11/commands/npm-exec | how npx picks the bin; prompt unless `--yes`; temp install into the npm cache |
| S2 | npm CLI v11 § npm-install, git/GitHub forms | https://docs.npmjs.com/cli/v11/commands/npm-install | git clone needs `git`; a `prepare` script means deps+devDeps are installed and it runs before packing |
| S3 | local probe (npm 11.17.0, node v24.19.0, git 2.55.0) | scratchpad/npxprobe, npxprobe2 | `npx -y git+file://…` works; `prepare` output ran even with `dist/` gitignored (gitignore-fallback warning) |
| S4 | Node.js § child_process, "Spawning .bat and .cmd files on Windows" | https://nodejs.org/api/child_process.html | `.cmd`/`.bat` are not launchable via execFile; `shell:true` is discouraged (DEP0190) and unsafe with unsanitized input |
| S5 | Node.js § readline (promises) | https://nodejs.org/api/readline.html | `rl.question` exists; no built-in masked input, no multi-select |
| S6 | Claude Code § Plugins reference, userConfig | https://code.claude.com/docs/en/plugins-reference.md | `sensitive:true` -> macOS Keychain else `~/.claude/.credentials.json` (~2 KB keychain limit shared with OAuth); non-sensitive -> `pluginConfigs` in user settings.json; `--config key=value` is the documented non-interactive path |
| S7 | Claude Code § Memory | https://code.claude.com/docs/en/memory.md | `~/.claude/CLAUDE.md` = user instructions, all projects; `~/.claude/rules/*.md` = user-level rules, loaded before project rules; `@path` imports, max 4 hops; target < 200 lines |
| S8 | Claude Code § plugin dependencies (via claude-code-guide agent) | https://code.claude.com/docs/en/plugin-dependencies.md | deps auto-install, are not removed on uninstall, `prune` removes orphans; disabling is blocked while a dependent is enabled |
| S9 | `claude plugin … --help`, CC 2.1.278 | local CLI | flags: install `--config/-y/--json/--scope`, uninstall `--keep-data/--prune/-y/--json`, list `--json/--available`, `prune`, `marketplace add/remove/update/list` |
| S10 | `claude plugin list --json [--available]`, `~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json` | local | shapes: `{installed:[{id,version,scope,enabled,installPath,…}], available:[{pluginId,name,description,marketplaceName,source}]}`; dependency installs carry `"auto": true`; marketplace `autoUpdate` also lives in known_marketplaces.json |
| S11 | ccstatusline README | https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/README.md | settings at `~/.config/ccstatusline/settings.json` (CLAUDE_CONFIG_DIR override); statusLine block shape incl. `refreshInterval` (CC >= 2.1.97) |
| S12 | this repo | `.claude-plugin/marketplace.json`, `plugins/dead-skills/.claude-plugin/plugin.json:9-21`, `scripts/check-repo.sh:42-55`, `flake.nix` pre-commit, `~/.config/ccstatusline/settings.json` (version 4), `~/.claude/settings.json` | 18 marketplace plugins, 11 bundle deps, the INSTALL.md check, hook wiring |

## What matters
| id | item | critical | source |
|---|---|---|---|
| M1 | `npx <git spec>` resolves the bin only if `package.json` has one `bin` entry or one matching the package name; otherwise it errors. A root `package.json` must exist in this marketplace repo. | yes | S1, S3 |
| M2 | A git install runs `prepare` and installs devDependencies to do it — every run pays for it unless npm's cache hits. A build step is therefore possible but not free, and committed output is the alternative. | yes | S2, S3 |
| M3 | `npx` prompts before fetching an uninstalled package unless `-y`/`--yes`; it assumes yes when stdin is not a TTY. | no | S1 |
| M4 | The git route requires `git` on PATH on every target machine, Windows included. | no | S2 |
| M5 | On Windows a `.cmd`/`.bat` shim cannot be started with `execFile`; `shell:true` works but is deprecated (DEP0190) and must never receive unsanitized input. | yes | S4 |
| M6 | A `sensitive` userConfig value is written to the macOS Keychain or, on Linux and Windows, to `~/.claude/.credentials.json`; the keychain path shares a ~2 KB budget with OAuth tokens. | yes | S6 |
| M7 | `--config ado_pat=<PAT>` puts the secret in the child process's argv, readable by other processes on the machine, and in shell history if a shell is involved. | yes | S6, S9 |
| M8 | `claude plugin install` picks a scope interactively unless `-y`/`--scope`; `uninstall --prune` and `prune` require `-y` when stdin/stdout is not a TTY. A TUI that owns the terminal and a child that wants to prompt collide. | yes | S8, S9 |
| M9 | Bundle dependencies install automatically and are marked `"auto": true`; uninstalling the bundle leaves them behind until `prune` runs. | yes | S8, S10 |
| M10 | Disabling or uninstalling a plugin another enabled plugin depends on is refused. Deselecting a bundle dependency cannot succeed while `dead-skills` is installed. | yes | S8 |
| M11 | Sensitive values never land in settings.json; non-sensitive ones land in `pluginConfigs` in user settings.json, and project-scope `pluginConfigs` are ignored. | no | S6 |
| M12 | Marketplace `autoUpdate` is stored in `~/.claude/plugins/known_marketplaces.json` as well as in `extraKnownMarketplaces` in settings.json — two places that can disagree. | no | S10, S12 |
| M13 | Nothing the installer changes takes effect in a running Claude Code session until a restart or `/reload-plugins`. | no | S8 |
| M14 | `~/.claude/CLAUDE.md` is a file the user owns and may already have; `~/.claude/rules/*.md` is a separate user-level location loaded for every project, and `@path` imports (max 4 hops) let one file pull in another. Overwriting the wrong one destroys the user's own instructions. | yes | S7 |
| M15 | ccstatusline's config carries a `version` field (4 on this machine, binary 2.2.30) and lives at `~/.config/ccstatusline/settings.json`, overridable by `CLAUDE_CONFIG_DIR`. A shipped config can be older or newer than the installed binary. | yes | S11, S12 |
| M16 | npm decides what to pack from a git checkout via `files`/`.npmignore`, falling back to `.gitignore` with a warning; relying on that fallback for build output is undocumented behaviour. | no | S2, S3 |
| M17 | `available[]` carries no dependency and no userConfig information, so opt-in-vs-dependency and "which PATs are needed" must come from the repo's own manifests. | no | S10 |

## Understanding grill
| Q | question | source | answer (summary) | grade |
|---|---|---|---|---|
| Q1 | how npx picks the bin, what the repo needs | S1 | single bin, or bin matching unscoped name, else "could not determine executable"; needs root package.json with name/version/bin, the target present in the pack, shebang for the Windows shim | answered |
| Q2 | what happens between enter and first line, and its cost | S2, S3 | ls-remote resolves the ref, clone, devDeps install, `prepare` (tsc), pack, install into the npx cache, link bin; every run pays the ref resolution, a cache miss pays clone+devDeps+compile | answered |
| Q3 | first contact, and non-TTY stdin | S1 | npm's "Need to install ... Ok to proceed?" prompt plus install noise; piped stdin skips the prompt and leaves the TUI without a TTY, so it must check `process.stdin.isTTY` instead of calling setRawMode | answered |
| Q4 | prerequisites on a fresh Windows box | S2 | `git` on PATH (npm shells out to it), `claude` on PATH to do anything useful, plus whatever proxy/credentials git needs | answered |
| Q5 | spawning claude on Windows | S4 | `claude.cmd` shim (npm install) vs real `claude.exe` (native installer); plain spawn gives ENOENT/EINVAL since the 2024 Node security releases; `shell:true` concatenates unescaped args, so a PAT containing `& \| ^ % ! "` breaks or injects, and `%VAR%` expands | answered |
| Q6 | where the PAT lands | S6 | only macOS gets the Keychain; NixOS and Windows both get plaintext `~/.claude/.credentials.json` guarded by file mode / profile ACLs; ~2 KB shared budget | answered |
| Q7 | the PAT in flight | S6, S9 | argv: readable via `/proc/<pid>/cmdline` on Linux and WMI on Windows, and very likely captured by work-laptop process auditing (4688/Sysmon/EDR), which persists and leaves the machine | answered |
| Q8 | TUI versus child process | S8, S9 | inherited stdio lets the child write into the frame, move the cursor, flip raw mode, eat keystrokes or block; use piped stdio and pass `-y`, `--config`, `--json`; noted `--json` is refused together with `--prune`, so uninstall and prune are two calls | answered |
| Q9 | what uninstall leaves | S8, S10 | install record and enabledPlugins entry go, data dir goes unless `--keep-data`, cache dir is swept later, dependencies stay; provenance of an auto-installed dependency lives in the install record (exact field not named) | answered |
| Q10 | deselecting a bundle dependency | S8 | refused while an enabled dependent exists, with a chained command in the error; so it must be shown as required-by, and removing it really means removing dead-skills + prune | answered |
| Q11 | which values are greppable | S6 | non-sensitive under `pluginConfigs[<id>].options` in settings.json; the PATs are also greppable, because on NixOS and Windows the secure store is a file under `~/.claude` | answered |
| Q12 | two sources of truth for autoUpdate | S10, S12 | named both places and proposed writing, reading back and reporting the effective state; the resolution mechanism (settings winning, `marketplace add` dropping the key) is asserted from GitHub issue reports, not from a source fetched here | partial |
| Q13 | the open Claude Code session | S8 | no new plugins until `/reload-plugins` or restart; memory/rules wait for a new session; the status line re-runs its command so a changed ccstatusline config shows up live; summary must say so | answered |
| Q14 | not destroying the user's own CLAUDE.md | S7 | own file at `~/.claude/rules/dead-claude-skills.md` (no `paths:`), rewritten on every run; fallback of a marker-delimited `@import` line in CLAUDE.md, stopping if a marker is missing or the block was edited; backup, atomic temp+rename, keep line endings; detect a read-only store symlink and print the snippet instead | answered |
| Q15 | ccstatusline version skew | S11, S12 | an older binary meeting `version: 4` can fail to parse, fall back to defaults, or migrate and overwrite; migrations only go forward; the file also carries machine specifics (powerline glyphs, NixOS paths); owes version detection, backup, a diff or confirmation, and a refusal/loud warning when the target is older | answered |
| Q16 | what gets packed | S2, S3 | prepare output lands in the tarball npx runs; not worth relying on: devDeps + compile per cache miss, `ignore-scripts=true` hardening on work machines leaves no bin, needs a toolchain and proxy, and failures show up as opaque npm errors; prefers a committed zero-dependency bundle with a CI freshness check | answered |
| Q17 | where the checklist's two facts come from | S10, S12 | `list --json --available` for what exists and what is installed; the bundling relationship only from the manifests' `dependencies` arrays, opt-ins being the entries nothing depends on | answered |

Score: 16 answered, 1 partial (M12, non-critical), 0 wrong or missing.

## Verdict
verdict: **ready**

- **Ready** (grilling.md grading rule): every critical item (M1, M2, M5, M6, M7, M8, M9, M10, M14, M15) is answered in the developer's own words including its consequence. The single partial is M12 (marketplace `autoUpdate` living in two places), which is non-critical, and the answer still lands on the right behaviour -- write, read both places back, report the effective state. Nothing is wrong or missing.
- **Makes sense** (S1-S12): the shape matches the sources. `npx <git spec>` does resolve and run a bin from this repo (S1, S3); the opt-in/dependency split is derivable from the two manifests because `available[]` does not carry it (S10); `claude plugin install/uninstall/prune` expose every flag the flow needs, including `--config` for userConfig (S6, S9); `~/.claude/rules/*.md` is a user-level location that leaves an existing `CLAUDE.md` untouched (S7). Two contradictions design.md has to resolve rather than inherit:
  1. Phase-1 A2 says the installer collects the PATs itself, but M7 (S6, S9) puts them in a child's argv and M6 puts them in plaintext `~/.claude/.credentials.json` on both target machines. The Q5/Q7 answers acknowledge this; design.md must state which way it goes and why. -> resolved by D1.
  2. A10 says "leaves nothing behind", while the Q14 and Q15 answers both promise backups before writing. A backup is a file left behind. Pick one. -> resolved by D2.
- **Feasible** within the stated constraints (node + claude + git present, Windows and NixOS only, no binary installs): yes. The two things that would have made it infeasible are both handled -- the non-TTY/child-process collision (M8, answered) and the blocked deselect of a bundle dependency (M10, answered).
- Design.md must not build on M12's resolution mechanism, which no fetched source confirms.

## Critique rounds

## Design grill

## Implementation
<!-- Slice list, then one report per slice. -->
Slices: 1 core decisions (`core.mjs` + tests) · 2 installer I/O + package + assets · 3 repo cleanup.

```
Slice 1/3 – core decisions
Design items: optIns → installer/core.mjs:10, needsToken → :13, planPlugins → :17, duplicates → :27,
  mergeSettings → :32, safeArg → :45, missingBinaries → :64
Tests: 9 passed (node --test 'installer/*.test.mjs')
Differences from the design: see D3, D4
```

```
Slice 2/3 – installer I/O
Design items: TTY guard → installer/install.mjs:25, claude spawn → :31, checklist → :81, settings merge/diff/atomic
  write → :117, ccstatusline → :145, rules → :162, PATH scan → :170, duplicates → :218, plugin plan → :225,
  autoUpdate read-back → :238, summary + handoff → :245; package.json bin/files; installer/ccstatusline.json
  (no NixOS paths to scrub); installer/rules.md
Tests: e2e in a sandbox (CLAUDE_CONFIG_DIR + HOME in scratchpad, `npx -y <repo dir>` driven through a pty):
  run 1 installed dead-skills + pstack-picks, handed off mcp-github, wrote settings/ccstatusline/rules;
  run 2 pre-selected exactly that, uninstalled pstack-picks, pruned, removed statusLine + ccstatusline config;
  no .bak / tmp files left.
Differences from the design: see D3, D5
```

```
Slice 3/3 – repo cleanup
Design items: INSTALL.md deleted; scripts/check-repo.sh INSTALL.md block + header removed; flake.nix
  plugin-validate files + installer-test hook; README quick setup, layout, hooks, "adding a plugin"
Tests: bash scripts/check-repo.sh ✓; nix flake check ✓ (all checks passed)
Differences from the design: see D4
```

Walkthrough (design test → code → evidence):
| design item | code | test |
|---|---|---|
| opt-ins from manifests | core.mjs:10 | core.test "opt-ins from the real manifests" |
| token plugins | core.mjs:13 | "token plugins" |
| install / uninstall / handoff | core.mjs:17, install.mjs:225 | "select installs, deselect uninstalls, token plugins hand off"; e2e run 1+2 |
| duplicates | core.mjs:27, install.mjs:218 | "duplicates are our names from another marketplace" |
| merge settings, idempotent, statusLine | core.mjs:32, install.mjs:117 | three merge tests; e2e |
| safeArg | core.mjs:45, install.mjs:31 | "safeArg rejects shell metacharacters" |
| missing binaries per OS | core.mjs:64, install.mjs:170 | "missing binaries per OS"; e2e summary |
| TTY guard, Ctrl-C, invalid/symlinked settings, user says no | install.mjs:25, :53, :117 | not automated (manual) |
| Windows spawn via shell | install.mjs:31 | **not run**: needs the Windows box |
| check-repo without INSTALL.md | scripts/check-repo.sh | check-repo ✓, nix flake check ✓ |

## Deviations
- **D0 (process, 2026-09-25):** at the developer's explicit request, Claude drafted `design.md` instead of the
  developer writing it (dev-feature Phase 5 rule overridden). The developer reviews and edits it before
  `approve design`.
- **D1 (decision, 2026-09-25):** PATs are handed off to Claude Code's own `/plugin install` prompt; the installer
  never collects a token. Reason: `--config` is the only non-interactive path and puts the token in argv (M7,
  S9 `claude plugin install --help`: no stdin option). Supersedes A2.
- **D2 (decision, 2026-09-25):** no backups. Owned keys are diffed, confirmed, and written atomically
  (temp + rename). Keeps A10; drops the backup parts of the Q14/Q15 answers.
- **Fact:** `notes.md` was missing on disk while the guard reported `installer` active; recreated from the
  developer's pasted copy on 2026-09-25.
- **D3 (implementation, needs ack):** `core.mjs` also exports `isOurStatusLine(statusLine)` (install.mjs uses it
  for the ccstatusline pre-selection) and the constants `MARKETPLACE`/`BUNDLE`. Not in design.md's Public interface.
- **D4 (implementation, needs ack):** the test command is `node --test 'installer/*.test.mjs'`, not
  `node --test installer/`: Node 24 treats a directory argument as a module path and fails.
- **D5 (implementation, needs ack):** `missingBinaries` gets the selected plugin names plus `ccstatusline` when that
  toggle is on, and its table has a `ccstatusline` row (`npm i -g ccstatusline` on Windows), since the shipped
  `statusLine` runs the bare `ccstatusline` command as on this machine. `package.json` also carries `version: 1.0.0`.
- **Finding (A10):** `npx` itself writes npm's debug logs to `~/.npm/_logs/` and the package into the npm cache.
  That's npm, not the installer; the installer writes no logs.
- **Fact (S11 check):** ccstatusline's `CLAUDE_CONFIG_DIR` support only locates Claude's config; its own settings
  stay at `~/.config/ccstatusline/settings.json` (README "Custom Claude Config" tip).
