# Vendor the language skills behind router skills instead of pointing at upstream marketplaces

The C# skills come from `dotnet/skills` and the Rust skill from `apollographql/skills`. Both are published as Claude
Code marketplaces, but we copy them into `plugins/languages/` with sync scripts. That costs a sync script per upstream
and a weekly PR. We pay it because a direct `url`-sourced entry can't do either of these:

- **Keep the listing small.** Claude Code lists every plugin skill in every project. `paths` frontmatter only gates
  project skills: it was ignored for plugin skills on 2.1.272 and again on 2.1.296. So the sync moves Microsoft's 101
  skills into an unscanned `library/` folder, behind six generated router skills that index them.
- **Drop parts.** The `dotnet` plugin bundles its own C# language server, which would run next to `csharp-lsp`.
  Microsoft's agents would be listed in every project.

Re-check this decision if Claude Code starts honoring `paths` for plugin skills, or if upstream ships an LSP-free
plugin. Either could make the routers, or the vendoring itself, unnecessary.
