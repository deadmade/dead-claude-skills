# Language skills for C# and Rust: spec

## Intent

When Claude writes C# or Rust for the user, the code is rarely wrong. The problem is drift: one session recommends one
approach and the next session recommends another. The user wants Claude grounded in a stable "base truth" for best
practices and for how specific tools and libraries are used. That should make answers consistent across sessions and,
the user hopes, better overall. They haven't used skills like this before, so a before/after test is part of the work
to find out whether the skills actually help.

The base truth comes from the people who maintain each ecosystem: Microsoft's .NET team (`dotnet/skills`) for C#, and
Apollo GraphQL's Rust handbook (`apollographql/skills`, skill `rust-best-practices`) for Rust. Neither is written by
us.

## Goals

1. Two new opt-in plugins in this marketplace, under a new `plugins/languages/` folder:
   - `plugins/languages/csharp-skills` holds every skill from every plugin in `dotnet/skills`' public marketplace.
   - `plugins/languages/rust-skills` holds Apollo's `rust-best-practices` with its reference chapters.
2. The C# plugin costs almost nothing outside C# work. It uses **router skills**, because `paths` doesn't gate
   plugin skills (see Facts checked).
   - Microsoft's 102 skills go into a **library** folder that Claude Code doesn't scan:
     `plugins/languages/csharp-skills/library/<skill>/`, with each skill's folder copied whole.
   - Six generated router skills under `skills/` are the only skills listed. Each router has a short "C#/.NET only"
     description, and its body indexes its area's library skills: name, a short summary, and the path
     `${CLAUDE_PLUGIN_ROOT}/library/<skill>/SKILL.md`. Claude opens a router, picks from the index, and reads that
     SKILL.md. Skill bodies get `${CLAUDE_PLUGIN_ROOT}` substituted
     ([plugins reference](https://code.claude.com/docs/en/plugins-reference), "Where each variable resolves").
   - Each router body also says that when a library skill names another skill, Claude finds it at
     `${CLAUDE_PLUGIN_ROOT}/library/<name>/SKILL.md`.
   - The routers and the Rust skill also get `paths` frontmatter. If Claude Code ever honors `paths` for plugin
     skills, they gate themselves with no further change.
     - C#: `**/*.cs`, `**/*.csproj`, `**/*.sln`, `**/*.slnx`, `**/*.props`, `**/*.targets`, `**/*.razor`,
       `**/*.xaml`, `**/global.json`
     - Rust: `**/*.rs`, `**/Cargo.toml`, `**/Cargo.lock`
   - Rust stays one normal skill. A single description is cheap anywhere.
3. Weekly sync. Sync scripts vendor both plugins, and weekly workflows refresh them through PRs, the same way as
   tob-picks, mattpocock-picks and pstack-picks. Both syncs follow upstream `main` and record the commit in
   `UPSTREAM`. Release tags were rejected because dotnet/skills has only `v1.0.0` (2026-04-21), which lacks Blazor,
   WinForms, .NET 11 and others.
4. New upstream skills arrive automatically, because the user wants "everything".
   - The C# sync copies the skills of every plugin listed in upstream's `.claude-plugin/marketplace.json`, not a
     fixed list, and regenerates the router indexes.
   - An upstream plugin missing from the router mapping goes to `core`, and the sync output names it.
   - The sync fails loudly if upstream's layout changes, for example a renamed `plugins/` folder or a missing
     SKILL.md.
5. A before/after consistency test. It asks the same fixed set of C# and Rust questions several times without the
   skills and several times with them, then compares how consistent and how good the answers are. The result is
   written down so the user can decide whether to keep the plugins.
6. The installer's "Language servers" page becomes "Languages". It lists the LSP opt-ins plus `csharp-skills` and
   `rust-skills`.
7. Repo tooling supports plugins one level down, under `plugins/languages/`, which is a grouping folder, not a
   plugin. Today three places assume `plugins/<name>/`:
   - `scripts/check-repo.mjs` (unlisted plugin dirs, version check)
   - `scripts/release.mjs:41` (version bump)
   - `installer/install.mjs:418` (manifest lookup), with the matching `files` glob in `package.json`
8. README, THIRD_PARTY.md, CLAUDE.md (layout and vendored list), GLOSSARY.md and the installer cover the two new
   plugins, per the checklist in `docs/features/language-skills/flow.md` → Grounding.

## Non-goals

- Writing our own C# or Rust guidance. The content is upstream's. The only changes are the generated routers (an
  index, not guidance), the `paths` line on the Rust skill, and the rewrites the sync needs.
- Microsoft's bundled C# language server from the `dotnet` plugin (`.lsp.json` / `lspServers`). The existing
  `csharp-lsp` opt-in stays the only C# language server.
- Trail of Bits' `rust-review`, generic "Rust/C# expert" persona agents, Copilot instruction files and actionbook's
  rust-skills. These were rejected during brainstorming; flow.md → Options has the reasons.
- The rest of `apollographql/skills`, which is GraphQL tooling.
- Adding the plugins to the default `dead-skills` bundle. Both are opt-in.
- Microsoft's agents and `dotnet-msbuild`'s `binlog` MCP server.
  - There are 16 agents: `dotnet-test` 10, `dotnet-msbuild` 3, and one each in `dotnet-diag`,
    `dotnet-template-engine` and `dotnet-test-migration`.
  - Agents would be listed in every project, and the user wants to look at them later.
  - The sync reports them (see Left to the builder) but doesn't vendor them.
- `dotnet-experimental`, an upstream folder its marketplace doesn't list.
- Moving existing plugins (nix-lsp, for example) into `plugins/languages/`. Only the two new plugins go there.
- Enabling plugins per project through `.claude/settings.json`.

## Anti-goals

- 102 .NET skill descriptions in every project's skill listing. Outside C# work the cost must stay at the six router
  descriptions.
- Two C# language servers running side by side.
- A sync that silently drops an upstream skill, or copies one only partly.
- A router index pointing at a library path that doesn't exist.

## Constraints

- Follow the repo's existing vendoring pattern:
  - `scripts/sync-<x>.mjs` using `scripts/sync-lib.mjs`
  - an `UPSTREAM` file and upstream's `LICENSE`
  - a `.github/workflows/sync-<x>.yml`
  - entries in THIRD_PARTY.md and in the CLAUDE.md vendored list
  - the `flake.nix` and `treefmt.toml` excludes
  - Vendored output, routers included, is never edited by hand.
- Both upstreams are MIT.
- One version for everything: each new `plugin.json` carries the repo version. `check-repo.mjs` enforces this.
- Installer logic goes in `installer/core.mjs` with tests. No npm dependencies.
- The work goes on its own branch off `main`. The current checkout is `feat/tob-picks` with unrelated staged changes.

## Decided with the user (2026-10-13)

- **Sources:** Microsoft `dotnet/skills` for C#, Apollo `rust-best-practices` for Rust.
- **Scope to C#/Rust:** first decided as `paths` frontmatter (option 1). **Superseded the same day:** `paths` is
  ignored for plugin skills. The user then picked router skills (option D) over enabling per repo, splitting by
  area, or a hook ("go with D").
- **Vendor vs pointing at upstream:** vendor through sync scripts rather than url-sourced marketplace entries.
  Pointing directly can't put the skills behind routers, and it would bring the duplicate LSP.
- **Scope of the C# sync:** everything from `dotnet/skills`, all 16 plugins, minus the bundled LSP.
- **Before/after consistency test:** included.
- **Upstream branch:** both syncs follow `main`, not release tags.
- **Agents:** Microsoft's agents are skipped for now.
- **Layout:** `plugins/languages/csharp-skills` and `plugins/languages/rust-skills`, plus a "Languages" page in the
  installer.

## Calls I made (the user can override)

- **Plugin names:** `csharp-skills` and `rust-skills`, matching how the user named them. This breaks the
  `<source>-picks` naming of the other vendored plugins, which is fine: "picks" means a curated subset, and these
  are everything.
- **One plugin for all of dotnet/skills,** not 16 mirrored plugins: one opt-in and one sync.
- **Router mapping** (router skill → upstream plugins):

  | router    | upstream plugins                                                        |
  | --------- | ----------------------------------------------------------------------- |
  | `core`    | dotnet (skills only), dotnet-advanced, dotnet11, dotnet-diag, dotnet-ai |
  | `testing` | dotnet-test, dotnet-test-migration                                      |
  | `build`   | dotnet-msbuild, dotnet-nuget, dotnet-upgrade, dotnet-template-engine    |
  | `web`     | dotnet-aspnetcore, dotnet-blazor                                        |
  | `data`    | dotnet-data                                                             |
  | `desktop` | dotnet-maui, dotnet-winforms                                            |

  In the listing they show up as `csharp-skills:testing` and so on. Each description starts with "C#/.NET only."
  and names the area's topics.
- **Index entries:** the skill name, the first sentence of its upstream description (capped at 200 characters), and
  its path, sorted by name.
- **Hidden skills** (decided in plan review, 2026-10-13): skills upstream marks `disable-model-invocation: true` stay
  in `library/` but are left out of the router indexes. Today these are 4 dotnet-test helpers.

## Before/after test (decided 2026-10-13)

- **One-off.** Run by hand, not part of `npm test` or CI, and re-runnable after big upstream changes.
  - Built on `claude plugin eval`: cases in each plugin's `evals/`, with eval's no-plugin baseline arm.
  - A small script on top scores how well the repeated answers agree.
  - Results go to `docs/features/language-skills/eval-results.md`.
- **Questions** (Claude's draft, accepted by the user 2026-10-13 and frozen). Runs start in an empty workspace. The
  scratch `.cs`/`.rs` file was dropped in plan review, because it only mattered for `paths`.
  - **Rust**
    1. I'm writing a Rust library crate that parses config files. How should I define and return its errors?
    2. Should `fn greet(name: ???) -> String` take `String`, `&str` or `impl AsRef<str>`, and why?
    3. Set up linting for a new Rust workspace: what clippy configuration and what CI command?
    4. Where do unit and integration tests go in a Rust crate, and how should they be named?
    5. I need a `Vec` of different shape types that I call `area()` on. Generics or trait objects?
    6. When is `unwrap()` or `expect()` acceptable in Rust code?
  - **C#**
    7. Which test framework for a new .NET 10 library, and what exact command runs only the tests of one class?
    8. How should a new C# service class handle nullable reference types and async methods?
    9. Load orders with their customers through EF Core for a read-only report: how should the query look?
    10. A new ASP.NET Core API with about 10 endpoints: minimal APIs or controllers?
    11. How should 8 projects in one solution share build settings (target framework, warnings as errors,
        analyzers)?
    12. How should NuGet package versions be managed across those projects?
- **Keep bar** (revised in plan review, 2026-10-13):
  - Each question runs 3 times with and 3 times without the skills. Agreement is scored per pair of answers: 3
    pairs, so 0–3 per arm.
  - Only questions where the without-arm has fewer than 3 agreeing pairs count.
  - Keep the plugins if "with" scores higher on at least 8 of those, or on all of them if fewer than 8 qualify, and
    the user judges none of them worse.
  - Otherwise the user decides whether to drop them.
- See [ADR 0001](../../adr/0001-vendor-language-skills.md) for why the skills are vendored.

## Facts checked (2026-10-13, dotnet/skills@b0bf173, apollographql/skills@5f02fcf)

- **`paths` gates project skills but not plugin skills.**
  - A project skill (in `.claude/skills/`) with `paths: "**/*.cs"` stayed out of the listing until `A.cs` was read.
  - A plugin skill (loaded with `--plugin-dir`, Claude Code 2.1.296) with the same `paths` was listed from the start
    of the session, before any file was read.
  - `scripts/sync-hallmark.mjs:9-10` recorded the same behavior on 2.1.272.
  - The [plugins reference](https://code.claude.com/docs/en/plugins-reference) has no conditional-activation field.
    The nearest is `defaultEnabled`.
- **dotnet/skills:**
  - 102 skills across the 16 marketplace plugins, each at `plugins/<p>/skills/<name>/SKILL.md`, with the frontmatter
    `name` matching its folder.
  - No name collisions. None sets `paths`. The descriptions total 67 KB.
  - Non-skill components, all declared in each plugin's `plugin.json`:
    - `dotnet`: `lspServers`
    - `dotnet-msbuild`: 3 agents and the `binlog` MCP server
    - `dotnet-diag`, `dotnet-template-engine` and `dotnet-test-migration`: 1 agent each
    - `dotnet-test`: 10 agents
- **Namespaced references in dotnet/skills:**
  - One `<plugin>:<name>` reference, `dotnet-test:test-engineer`. It points at an agent.
  - `csharp-expert` tells users to `/plugin install <plugin>@dotnet-agent-skills`: at `SKILL.md:217` and twice in
    `references/dotnet-skills-marketplace.md`.
  - Several test and msbuild skills name skipped agents. The agent name `msbuild` is also a common word, so
    detecting mentions of it needs a strict pattern.
- **Cross-skill links:** only one, from `code-testing-extensions` to `../../code-testing/…`. It survives flattening
  into `library/`.
- **Apollo:** `rust-best-practices` is self-contained: a SKILL.md and 9 chapters, about 103 KB, with `allowed-tools`
  in its frontmatter. The repo root has an MIT LICENSE.
- **`claude plugin eval`:**
  - It runs `evals/**/case.yaml` cases against a plugin, with a built-in no-plugin baseline arm, and saves the
    answers to JSON.
  - Its graders score quality. Agreement across runs needs a small script over the JSON.
  - Whether it supports repeats per case is unverified.

## More decided in grilling (2026-10-13)

- No GitHub issues for new upstream skills. The weekly sync PR lists added and removed skills.
- The sync rewrites `csharp-expert`'s `/plugin install <x>@dotnet-agent-skills` advice, in `SKILL.md` and
  `references/dotnet-skills-marketplace.md`. The new text says every skill is already installed in `csharp-skills`,
  reached through its routers. The rewrite must match or the sync fails.

## Left to the builder

- **Verify early:**
  - Claude Code doesn't list `library/*/SKILL.md` as skills (it scans only `skills/`).
  - `${CLAUDE_PLUGIN_ROOT}` is substituted in a router body.

  Check both with `--plugin-dir` on a small sample before generating all six routers. If either fails, stop and
  report.
- **Flattening the 16 upstream plugins into `library/`:**
  - Fail on a skill name collision across upstream plugins.
  - Only skills are vendored. The sync output reports agents, MCP servers (`dotnet-msbuild`'s `binlog`), hooks and
    commands.
  - Flag vendored skills that mention a skipped agent, so the later look at the agents has a list to start from.
- **Rewrites** of upstream references to its own plugin namespaces (for example `csharp-expert`'s "how do I add the
  skill" routing to dotnet marketplace plugins), so they point at the routers and the library. The rewrites must
  match or the sync fails, as in `sync-tob.mjs`.
- **The before/after test's mechanics:** how the questions become `claude plugin eval` cases, how repeats run, and
  the small agreement script over eval's JSON output. The questions and the keep bar are fixed above.
