# dead-claude-skills

<p align="center"><a href="plugins/default/README.md"><img src="plugins/default/assets/mascot-512.png" width="192" alt="Onibi, Night City's mascot: a hooded netrunner in a respirator, her chrome cybereye a glowing eight-point spark"></a></p>

My personal Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills. It's
built for me; use it if it fits, but expect it to change without notice.

The default bundle, **[dead-skills](plugins/default/README.md)**, pulls in claude-code-setup, claude-md-management, security-guidance and
claude-security, and itself carries Context7, Night City (a
toned-down synthwave theme that everything else here is painted in), desktop notifications when a turn ends or Claude
waits for you, and my global rules. Everything else is opt-in: language
servers, language and database skills (rust, csharp, postgres), integrations (GitHub, Azure, Atlassian), skill packs
like hallmark and graphify, and tools such as
[tui-review](plugins/shared/tui-review/README.md), [md-pane](plugins/opt-in/md-pane/README.md) for reading the `.md` files
Claude names in a pane beside the chat, [web-mcp](plugins/shared/web-mcp/README.md) for web search read in its own browser, page fetching,
passive lookups and a browser with an archive of everything it pulled.

The opt-in [flows](plugins/flows/README.md) plugin ties the rest together: conductor skills (`/feature-flow`,
`/fix-flow`, `/test-audit`, `/doc-audit`, `/self-review`, `/verify`, `/learn` and more) that run the other plugins' skills in order,
with approval gates and a state file to resume from. Picking flows installs every plugin its conductors use.
flows also sets the house standard for prose: a `writing` skill (Williams and Bizup's _Style_ in our own words), a
code-only check on each Write or Edit of a Markdown file that flags conversation shorthand and undefined abbreviations
(`FLOWS_PROSE_CHECK=off` turns it off), and `/copyedit`, which has an Opus editor revise a spec, plan or report before
its gate and keeps the edit only when nothing was lost (otherwise the gate shows the original and says why).
flows also carries the skill packs they read by path from `plugins/flows/packs/` (superpowers, ponytail, paper-lookup
and the mattpocock, pstack and Trail of Bits picks). The packs are not plugins: nothing in them loads on its own, so
their skills, hooks and ponytail's band stay out of your sessions outside the conductors, and the installer removes
old installs of them.

    npx --allow-remote=root https://github.com/deadmade/dead-claude-skills/releases/latest/download/installer.tgz

The installer (Node standard library only, written in TypeScript and attached to each release built to JS) shows one page per category where you pick what to install, remove or
update, then applies only the changes. It pins the marketplace to its own release so plugins match the installer, and
it always denies Claude reading `.env` files and credential dirs and keeps session transcripts (Claude Code deletes them after 30 days unless `cleanupPeriodDays` is set). Optional toggles add ccstatusline,
dcg and, with flows, the spaCy environment that `/copyedit` measures documents with (about 1.7 GB in
`~/.claude/flows-prose/`, set up with uv from PATH; Linux and Windows x64, not NixOS yet). The danger zone can strip all foreign plugins or reset `~/.claude` to a clean slate (after a backup).
Everything ships as one version, cut with `npm run release -- patch` and `git push --follow-tags origin main`; the
tag builds the installer and the binaries and publishes the GitHub release they're downloaded from. From a checkout,
`npm ci` once, then `node installer/install.ts` runs the installer (Node 26 or newer) and `npm run typecheck` checks it.
