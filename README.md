# dead-claude-skills

My personal Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills. It's
built for me; use it if it fits, but expect it to change without notice.

The default bundle, **dead-skills**, pulls in code-review, claude-code-setup, claude-md-management, security-guidance,
claude-security, superpowers, ponytail, mcp-basic (context7) and my global rules. Everything else is opt-in: language
servers, language and database skills (rust, csharp, postgres), integrations (GitHub, Azure, Atlassian), skill packs
like hallmark, paper-lookup, self-review, graphify and the mattpocock/pstack/Trail of Bits picks, plus tools such as
[tui-review](plugins/tui-review/README.md), cswap for multi-account switching and night-city, a toned-down synthwave theme.

    npx --allow-git=root github:deadmade/dead-claude-skills#semver:*

The installer (Node standard library only) shows one page per category where you pick what to install, remove or
update, then applies only the changes. It pins the marketplace to its own release so plugins match the installer, and
it always denies Claude reading `.env` files and credential dirs and keeps session transcripts (Claude Code deletes them after 30 days unless `cleanupPeriodDays` is set). Optional toggles add ccstatusline, the Bash sandbox
and dcg; the danger zone can strip all foreign plugins or reset `~/.claude` to a clean slate (after a backup). Without
the installer, `/plugin marketplace add deadmade/dead-claude-skills` and `/plugin install dead-skills@dead-claude-skills`
work too, but track main.

Everything ships as one version, cut with `npm run release -- patch` and `git push --follow-tags origin main`; the
tag builds the binaries and publishes the GitHub release the installer downloads from.
