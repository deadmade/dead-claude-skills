// Vendor an upstream Claude Code plugin into plugins/flows/packs/<name>/ at upstream's newest stable vX.Y.Z tag, unchanged
// but for plugin.json's version (ours: everything ships as one version). Upstreams also ship adapters for other hosts;
// only what Claude Code loads is copied. Idempotent: re-running against the same tag gives no diff.
// Usage: node scripts/sync-release.mjs <name>
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, git, sparseClone, stableTags } from './sync-lib.mjs';

// repo: upstream on GitHub. skipped: default component folders upstream has but we leave out. otherHosts: other hosts'
// hook configs in hooks/, next to the Claude Code ones. entry: a file the plugin can't work without.
export const PLUGINS = {
  ponytail: {
    repo: 'DietrichGebert/ponytail',
    // shortcut: commands/ holds Gemini's .toml commands at v5.3.2 and is skipped whole; check its contents if upstream adds Claude .md commands.
    skipped: ['commands'],
    otherHosts: ['copilot-hooks.json', 'cursor-hooks.json', 'qoder-hooks.json'],
    entry: 'skills/ponytail/SKILL.md',
  },
  superpowers: {
    repo: 'obra/superpowers',
    skipped: [],
    otherHosts: ['hooks-cursor.json'],
    entry: 'skills/using-superpowers/SKILL.md', // hooks/session-start reads it
  },
};

// plugin.json keys we copy as they are. Any other key is a component we haven't decided on.
const KEYS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
const COPIED = ['hooks', 'types', 'userConfig'];
// Folders and files Claude Code loads from a plugin root by default.
const DEFAULTS = ['agents', 'bin', 'commands', 'hooks', 'monitors', 'output-styles', 'skills', 'themes', 'workflows'];
const DEFAULT_FILES = ['.mcp.json', '.lsp.json', 'settings.json'];

// The plugin.json keys and top-level paths that Claude Code would load but this sync neither copies nor skips.
export function unknownParts(pluginJson, topLevel, skipped) {
  const keys = Object.keys(pluginJson).filter((k) => !KEYS.includes(k) && !COPIED.includes(k));
  const paths = topLevel.filter(
    (p) => [...DEFAULTS, ...DEFAULT_FILES].includes(p) && !['hooks', 'skills', ...skipped].includes(p),
  );
  return [...keys, ...paths];
}

// The tags a sync from `oldSha` to `newTag` brings, newest first, and the old tag when `oldSha` is one. tags:
// stableTags(), oldest first.
export function tagRange(tags, oldSha, newTag) {
  const to = tags.findIndex((t) => t.tag === newTag);
  const from = tags.findIndex((t) => t.sha === oldSha);
  if (from > to) throw new Error(`${newTag} is older than the vendored ${tags[from].tag}`);
  if (from < 0) return { tags: [newTag] };
  return {
    old: tags[from].tag,
    tags: tags
      .slice(from + 1, to + 1)
      .map((t) => t.tag)
      .reverse(),
  };
}

// Upstream text pasted into our PR: its #123 would link to our issues, a link to upstream would put this PR on that
// issue's timeline (redirect.github.com doesn't, as in Renovate's PRs), and its @name would ping from our repo.
const inert = (text, repo) =>
  text
    .replaceAll('https://github.com/', 'https://redirect.github.com/')
    .replace(/(^|[^\w/&`[])#(\d+)\b/g, `$1[#$2](https://redirect.github.com/${repo}/issues/$2)`)
    .replace(/(^|[^\w/`])@([\w-]+)/g, '$1`@$2`');

const LIMIT = 60_000; // GitHub refuses PR bodies over 65,536 characters

// The sync PR's body: each tag's release notes (or, without any, its commit subjects), newest first, then the
// compare link. entries: { tag, body: string | null, subjects: string[] }, newest first.
export function releaseNotes(repo, entries, compare) {
  const sections = entries.map(({ tag, body, subjects }) => {
    if (body) return `## ${tag}\n\n${inert(body.trim(), repo)}\n`;
    const lines = subjects.filter((s) => !/^chore: release /.test(s)).map((s) => `- ${inert(s, repo)}`);
    return `## ${tag} (no release notes, commit subjects)\n\n${lines.length ? lines.join('\n') : '(no changes)'}\n`;
  });
  const tail = `${compare ? `\nAll changes: ${compare}\n` : ''}\ncc @deadmade\n`;
  let cut = '';
  while (sections.length > 1 && sections.join('\n').length + tail.length > LIMIT) {
    sections.pop();
    cut = `\n_The older releases are cut to fit the PR body; ${compare ?? 'see upstream'}._\n`;
  }
  return sections.join('\n') + cut + tail;
}

// What the copy needs from the clone `up` and the clone lacks, so nothing is deleted before the sync knows it can finish.
export function missingParts(up, manifest, entry) {
  const needed = ['hooks', ...hookFiles(manifest.hooks), ...(manifest.types ? [manifest.types] : [])];
  return [...needed, entry, 'LICENSE'].filter((f) => !existsSync(join(up, f)));
}

// The hook config files plugin.json names (a path, or a list of paths and inline objects).
const hookFiles = (hooks) => [hooks ?? []].flat().filter((h) => typeof h === 'string');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2];
  if (!Object.hasOwn(PLUGINS, name)) fail(`usage: node scripts/sync-release.mjs <${Object.keys(PLUGINS).join('|')}>`);
  const { repo, skipped, otherHosts, entry } = PLUGINS[name];
  const tags = stableTags(git('ls-remote', '--tags', `https://github.com/${repo}.git`));
  const latest = tags.at(-1);
  if (!latest) fail(`${repo} has no vX.Y.Z tag`);
  const dest = join(ROOT, 'plugins', 'flows', 'packs', name);
  const upstreamFile = join(dest, 'UPSTREAM');
  const oldSha = existsSync(upstreamFile) ? readFileSync(upstreamFile, 'utf8').trim() || undefined : undefined;
  let range;
  try {
    range = tagRange(tags, oldSha, latest.tag);
  } catch (e) {
    fail(e.message);
  }

  const up = sparseClone(`https://github.com/${repo}.git`, ['/.claude-plugin/', '/hooks/', '/skills/', '/LICENSE'], {
    noCone: true,
    ref: latest.tag,
    depth: 0,
  });
  if (git('-C', up, 'rev-parse', 'HEAD') !== latest.sha) fail(`clone of ${latest.tag} is not at ${latest.sha}`);

  // Everything is checked against the clone before the vendored folder is touched.
  const manifestPath = join(up, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) fail('upstream .claude-plugin/plugin.json not found');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const missing = missingParts(up, manifest, entry);
  if (missing.length) fail(`upstream lacks what the copy needs: ${missing.join(', ')}`);
  const unknown = unknownParts(manifest, git('-C', up, 'ls-tree', '--name-only', 'HEAD').split('\n'), skipped);
  if (unknown.length)
    fail(`upstream has parts this sync doesn't handle: ${unknown.join(', ')}; decide, then update KEYS/PLUGINS`);

  const notesOf = (tag) => {
    try {
      const out = execFileSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`, '--jq', '.body'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const body = out.trim();
      return body && body !== 'null' ? body : null; // jq prints null for a release without notes
    } catch {
      return null; // no release for this tag, or no gh
    }
  };
  const prevOf = (tag) => tags[tags.findIndex((t) => t.tag === tag) - 1]?.tag;
  const entries = range.tags.map((tag) => ({
    tag,
    body: notesOf(tag),
    subjects: git('-C', up, 'log', '--format=%s', ...(prevOf(tag) ? [`${prevOf(tag)}..${tag}`] : ['-1', tag]))
      .split('\n')
      .filter(Boolean),
  }));
  const compare = range.old && `https://github.com/${repo}/compare/${range.old}...${latest.tag}`;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, '.claude-plugin'), { recursive: true });
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(join(dest, '.claude-plugin', 'plugin.json'), JSON.stringify({ ...manifest, version }, null, 2) + '\n');
  cpSync(join(up, 'hooks'), join(dest, 'hooks'), {
    recursive: true,
    filter: (src) => !otherHosts.some((f) => src === join(up, 'hooks', f)),
  });
  for (const skill of git('-C', up, 'ls-tree', '--name-only', 'HEAD', 'skills/').split('\n')) {
    if (existsSync(join(up, skill, 'SKILL.md'))) cpSync(join(up, skill), join(dest, skill), { recursive: true });
  }
  cpSync(join(up, 'LICENSE'), join(dest, 'LICENSE'));
  if (oldSha) writeFileSync(upstreamFile, oldSha + '\n'); // so finish() sees only real changes

  if (process.env.PR_BODY_FILE) writeFileSync(process.env.PR_BODY_FILE, releaseNotes(repo, entries, compare));
  finish(name, latest.sha, upstreamFile, dest);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${latest.tag}\nsha=${latest.sha}\n`);
}
