# dead-claude-skills

My Claude Code setup as a plugin marketplace, so every machine (Linux, Windows) gets the same skills.

## Install

```
/plugin marketplace add deadmade/dead-claude-skills
/plugin install dead-skills@dead-claude-skills
```

`dead-skills` is the default bundle: it contains my own skills and declares every other plugin in
this marketplace as a dependency, so that single install pulls in:

frontend-design · code-review · skill-creator · claude-code-setup · rust-analyzer-lsp · superpowers · ponytail

Update later with `/plugin marketplace update dead-claude-skills`.

> If a machine already has any of these installed from `claude-plugins-official` or `ponytail`,
> uninstall those copies so they don't load twice.

## Layout

```
.claude-plugin/marketplace.json     # marketplace + re-listed upstream plugins
plugins/dead-skills/
  .claude-plugin/plugin.json        # bundle manifest (version, dependencies)
  skills/<name>/SKILL.md            # own skills
  agents/<name>.md                  # own subagents
```

## Adding a skill

1. Create `plugins/dead-skills/skills/<name>/SKILL.md` (e.g. with `/skill-creator`).
2. Keep it project-agnostic and cross-platform (no bash-only scripts; Windows may lack WSL).
3. Bump `version` in `plugins/dead-skills/.claude-plugin/plugin.json`, then commit and push.
4. Validate: `claude plugin validate .` and `claude plugin validate plugins/dead-skills`.

## Adding another upstream plugin

Add an entry to `.claude-plugin/marketplace.json` and its name to `dependencies` in the bundle's
`plugin.json`.
