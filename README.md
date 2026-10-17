# dead-claude-skills

<p align="center"><a href="plugins/mods/night-city/README.md"><img src="plugins/mods/night-city/assets/mascot-512.png" width="192" alt="Onibi, night-city's mascot: a hooded netrunner in a respirator, her chrome cybereye a glowing eight-point spark"></a></p>

My personal Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills. It's
built for me; use it if it fits, but expect it to change without notice.

The default bundle, **dead-skills**, pulls in code-review, claude-code-setup, claude-md-management, security-guidance,
claude-security, superpowers, ponytail, mcp-basic (context7), [night-city](plugins/mods/night-city/README.md) (a
toned-down synthwave theme that everything else here is painted in) and my global rules. Everything else is opt-in: language
servers, language and database skills (rust, csharp, postgres), integrations (GitHub, Azure, Atlassian), skill packs
like hallmark, paper-lookup, self-review, graphify and the mattpocock/pstack/Trail of Bits picks, and tools such as
[tui-review](plugins/mods/tui-review/README.md), [md-pane](plugins/mods/md-pane/README.md) for reading the `.md` files
Claude names in a pane beside the chat, cswap for multi-account switching, [notify](plugins/notify/README.md) for
desktop notifications when a turn ends, [web-mcp](plugins/mcp/web-mcp/README.md) for web search, page fetching,
passive lookups and a browser with an archive of everything it pulled.

The opt-in [flows](plugins/flows/README.md) plugin ties the rest together: conductor skills (`/feature-flow`,
`/fix-flow`, `/test-audit`, `/doc-audit`, `/verify`, `/learn` and more) that run the other plugins' skills in order,
with approval gates and a state file to resume from; a band above the prompt shows the current run's phase, gates and
deviations (`1` resumes it from an idle prompt). Picking flows installs every plugin its conductors use.

    npx --allow-git=root github:deadmade/dead-claude-skills#semver:*

The installer (Node standard library only) shows one page per category where you pick what to install, remove or
update, then applies only the changes. It pins the marketplace to its own release so plugins match the installer, and
it always denies Claude reading `.env` files and credential dirs and keeps session transcripts (Claude Code deletes them after 30 days unless `cleanupPeriodDays` is set). Optional toggles add ccstatusline, the Bash sandbox
and dcg; the danger zone can strip all foreign plugins or reset `~/.claude` to a clean slate (after a backup). Without
the installer, `/plugin marketplace add deadmade/dead-claude-skills` and `/plugin install dead-skills@dead-claude-skills`
work too, but track main.

Everything ships as one version, cut with `npm run release -- patch` and `git push --follow-tags origin main`; the
tag builds the binaries and publishes the GitHub release the installer downloads from.
