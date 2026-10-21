# Spec: vendor ponytail, sync PR with release notes, ponytail's band only

## Intent

Ponytail v5 shipped a mod, hooks, settings and commands; we noticed only because its README said "v5 rewrite". The
sync PR is a two-line ref/sha bump the user merges after a glance, and nothing in the repo shows what ponytail runs, so
agents here guess (one research agent read a stale 5.1.0 cache this session). Goal: ponytail's code lives in the repo
as it ships, every upstream release arrives as a real diff with its release notes and a short "what changes in your
sessions" summary, and the three-band clash is gone.

## Goals

1. **Vendored ponytail, unchanged.** `plugins/shared/ponytail/` holds upstream's Claude Code parts at the newest
   stable `vX.Y.Z` tag: `.claude-plugin/plugin.json`, `hooks/` (everything the Claude manifest's two hook files reach:
   the `.js` hooks, both statusline scripts, `band/`), `skills/`, `LICENSE`, plus an `UPSTREAM` file (the synced sha, like the other syncs).
   Only transform: `plugin.json`'s `version` becomes ours (`package.json`). Nothing for other hosts, no assets, no
   upstream tests, no README.
2. **Marketplace entry** becomes local: `"source": "./plugins/shared/ponytail"`, name stays `ponytail` (installs,
   settings, `$.store`/`$.state` keyed on `ponytail` carry over). Description stays upstream's marketplace description.
3. **`scripts/sync-ponytail.mjs` + `.github/workflows/sync-ponytail.yml`** (weekly, Mondays like the others), using
   `sync-lib.mjs` (`sparseClone`, `fail`, `finish`) and `newestTag` from `sync-plugins.mjs`. ponytail leaves the
   `sync-plugins.yml` matrix; `sync-plugins.test.mjs` fixtures switch to superpowers.
   - A missing expected file (`.claude-plugin/plugin.json`, a hooks file it names, `skills/ponytail/SKILL.md`)
     `fail()`s, like the other syncs.
   - No PR when the tag is unchanged (`finish()`).
4. **PR body** (user, 2026-10-20: "the release notes they wrote would be awesome"), in this order:
   1. **Upstream's release notes** for every tag after the old one up to the new one, newest first: the GitHub release
      body (`gh api repos/DietrichGebert/ponytail/releases/tags/<tag>` with the workflow's `GITHUB_TOKEN`). A tag with
      no release or an empty body falls back to its commit subjects (`git log --format=%s prev..tag`, upstream writes
      conventional `feat(band): …`/`fix(hooks): …` subjects), labelled as such.
   2. Compare link and `cc @deadmade`, like today.
      The vendored diff itself shows what changed in the code. No computed surface summary and no title tag (my reading
      of the user's answer: their release notes are the summary).
      Unverified: whether upstream publishes GitHub release bodies (the API and release page were unreachable from this
      session; its `publish.yml` runs on `v*` tags). The fallback covers it either way.
      The release-notes assembly (tags in range, fallback) is a pure function with a test
      (`scripts/sync-ponytail.test.mjs`, run by `npm test`).
5. **Migration (revised in plan review round 1, reopens Gate 1 for this goal only).** An existing
   `ponytail@dead-claude-skills` install at 5.x moves to the vendored copy on its next update, by Claude Code's own
   `claude plugin update`/auto-update (it replaces a plugin whenever the computed version differs, per the plugin
   loading docs). Not skippable. No installer code; the installer's "never downgrade" rule stays as it is. Its
   `userConfig` values (`pluginConfigs`) and data directory must survive the move: verified, not assumed.
6. **Our bands off** (decided earlier): flows' mod removed (`plugins/flows/hooks/`, `types/`, its `types` field, the band
   sentence in descriptions, the "flows mod tests" CI step); Onibi's visits removed from the Night City mod (`onibi.ts`,
   the atom, the `AbovePrompt` hook, the `onibi` userConfig and state type) while the spinner/turn words, status
   reactions, background, mascot and notify sender stay. One commit, so `git revert` restores both.
7. **Docs true to what ships:**

   - `README.md`, `plugins/default/README.md`: ponytail is no longer prompt-only: band above the prompt (Claude Code
     2.1.290+, not in cloud sessions or `claude -p`), local task ledger in `~/.config/ponytail/band/` (on by default;
     webhook off unless set), session-start codebase map, rules injected into subagents.
   - `THIRD_PARTY.md`: ponytail moves from "url-only" to a vendored entry (MIT).
   - `CLAUDE.md`: ponytail in the vendored list and its layout line; `flake.nix` `vendored` and `treefmt.toml`
     excludes gain `plugins/shared/ponytail/`; the flows-band paragraph and Onibi-visits sentence go.

8. **ADR** `docs/adr/0002-vendor-ponytail.md`: vendored as shipped so agents and the user can read what runs and
   each release arrives as a diff with its notes; extends ADR 0001's reasons; revisit if superpowers needs the same.

## Grill decisions (2026-10-20, user)

- Q1 folder `plugins/shared/ponytail/`: yes.
- Q2 one branch, separate commits: yes. Branch changed in plan review round 1 to `feat/ponytail-v5` (the bot owns
  `sync/ponytail`).
- Q3 `/harden` wording and `/simplify` fallback fixes: **no**, think first, probably its own issue.
- Q4 vendor only what the Claude Code plugin needs (no upstream README, assets, other hosts, tests): yes.
- Q5 follow upstream's stable release tags only, never main: yes.
- Q6 cut a minor release after merge (user runs it): yes.
- Q7 ADR 0002: yes.
- Q8 no tests of our own for the vendored code: yes.

## Non-goals

- `/harden`'s description of ponytail's v5 review/audit and the `/simplify` fallback (Q3: separate issue).

- Vendoring superpowers or giving its sync PR the summary (user: only ponytail for now).
- Changing any ponytail behaviour: subagent rules, ledger default, codebase map, statusline nudge stay as upstream ships.
- `/harden` running `ponytail-debt`, a ccstatusline ponytail widget, a band-stacking fix.
- A computed "what changes in your sessions" surface diff or `[new surface]` title tag (superseded by upstream's
  release notes plus the vendored diff).

## Anti-goals

- A sync that edits upstream code (beyond `version`): it would break on every upstream reshuffle.
- A PR body where the release notes aren't the first thing seen.
- Losing users' ponytail level, band state or ledger in the migration.

## Constraints

- Node stdlib only; new logic in `core.mjs`/`files.mjs`/scripts with tests, not `install.mjs`.
- One version everywhere; `check-repo` must pass with the vendored `plugin.json`.
- Vendored files are never edited by hand; CLAUDE.md lists them.

## Left to the builder

- Exact clone flags and the release-notes markdown layout.
- Whether `claude plugin validate` / `checkUses` now check ponytail's skills offline (they should, since it's local).
