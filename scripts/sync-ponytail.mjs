// Vendor ponytail's Claude Code plugin into plugins/shared/ponytail/ at upstream's newest stable vX.Y.Z tag, unchanged
// but for plugin.json's version (ours: everything ships as one version). Upstream also ships adapters for other hosts;
// only what Claude Code loads is copied. Idempotent: re-running against the same tag gives no diff.
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';
import { stableTags } from './sync-plugins.mjs';

export const REPO = 'DietrichGebert/ponytail';
export const DEST = 'plugins/shared/ponytail';

// plugin.json keys we copy as they are. Any other key is a component we haven't decided on.
const KEYS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
const COPIED = ['hooks', 'types', 'userConfig'];
// Folders and files Claude Code loads from a plugin root by default.
const DEFAULTS = ['agents', 'bin', 'commands', 'hooks', 'monitors', 'output-styles', 'skills', 'themes', 'workflows'];
const DEFAULT_FILES = ['.mcp.json', '.lsp.json', 'settings.json'];
// shortcut: commands/ holds Gemini's .toml commands at v5.3.2 and is skipped whole; check its contents if upstream adds Claude .md commands.
const SKIPPED = ['commands'];
// Hook configs for other hosts, next to the two Claude Code ones.
const OTHER_HOSTS = ['copilot-hooks.json', 'cursor-hooks.json', 'qoder-hooks.json'];

// The plugin.json keys and top-level paths that Claude Code would load but this sync neither copies nor skips.
export function unknownParts(pluginJson, topLevel) {
  const keys = Object.keys(pluginJson).filter((k) => !KEYS.includes(k) && !COPIED.includes(k));
  const paths = topLevel.filter(
    (p) => [...DEFAULTS, ...DEFAULT_FILES].includes(p) && !['hooks', 'skills', ...SKIPPED].includes(p),
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
const inert = (text) =>
  text
    .replaceAll('https://github.com/', 'https://redirect.github.com/')
    .replace(/(^|[^\w/&`[])#(\d+)\b/g, `$1[#$2](https://redirect.github.com/${REPO}/issues/$2)`)
    .replace(/(^|[^\w/`])@([\w-]+)/g, '$1`@$2`');

const LIMIT = 60_000; // GitHub refuses PR bodies over 65,536 characters

// The sync PR's body: each tag's release notes (or, without any, its commit subjects), newest first, then the
// compare link. entries: { tag, body: string | null, subjects: string[] }, newest first.
export function releaseNotes(entries, compare) {
  const sections = entries.map(({ tag, body, subjects }) => {
    if (body) return `## ${tag}\n\n${inert(body.trim())}\n`;
    const lines = subjects.filter((s) => !/^chore: release /.test(s)).map((s) => `- ${inert(s)}`);
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
export function missingParts(up, manifest) {
  const needed = ['hooks', ...hookFiles(manifest.hooks), ...(manifest.types ? [manifest.types] : [])];
  return [...needed, 'skills/ponytail/SKILL.md', 'LICENSE'].filter((f) => !existsSync(join(up, f)));
}

// The hook config files plugin.json names (a path, or a list of paths and inline objects).
const hookFiles = (hooks) => [hooks ?? []].flat().filter((h) => typeof h === 'string');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tags = stableTags(git('ls-remote', '--tags', `https://github.com/${REPO}.git`));
  const latest = tags.at(-1);
  if (!latest) fail(`${REPO} has no vX.Y.Z tag`);
  const dest = join(ROOT, DEST);
  const upstreamFile = join(dest, 'UPSTREAM');
  const oldSha = existsSync(upstreamFile) ? readFileSync(upstreamFile, 'utf8').trim() || undefined : undefined;
  let range;
  try {
    range = tagRange(tags, oldSha, latest.tag);
  } catch (e) {
    fail(e.message);
  }

  const up = sparseClone(`https://github.com/${REPO}.git`, ['/.claude-plugin/', '/hooks/', '/skills/', '/LICENSE'], {
    noCone: true,
    ref: latest.tag,
    depth: 0,
  });
  if (git('-C', up, 'rev-parse', 'HEAD') !== latest.sha) fail(`clone of ${latest.tag} is not at ${latest.sha}`);

  // Everything is checked against the clone before the vendored folder is touched.
  const manifestPath = join(up, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) fail('upstream .claude-plugin/plugin.json not found');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const missing = missingParts(up, manifest);
  if (missing.length) fail(`upstream lacks what the copy needs: ${missing.join(', ')}`);
  const unknown = unknownParts(manifest, git('-C', up, 'ls-tree', '--name-only', 'HEAD').split('\n'));
  if (unknown.length)
    fail(`upstream has parts this sync doesn't handle: ${unknown.join(', ')}; decide, then update KEYS/SKIPPED`);

  const notesOf = (tag) => {
    try {
      const out = execFileSync('gh', ['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '.body'], {
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
  const compare = range.old && `https://github.com/${REPO}/compare/${range.old}...${latest.tag}`;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, '.claude-plugin'), { recursive: true });
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  writeFileSync(join(dest, '.claude-plugin', 'plugin.json'), JSON.stringify({ ...manifest, version }, null, 2) + '\n');
  cpSync(join(up, 'hooks'), join(dest, 'hooks'), {
    recursive: true,
    filter: (src) => !OTHER_HOSTS.some((f) => src === join(up, 'hooks', f)),
  });
  for (const name of git('-C', up, 'ls-tree', '--name-only', 'HEAD', 'skills/').split('\n')) {
    if (existsSync(join(up, name, 'SKILL.md'))) cpSync(join(up, name), join(dest, name), { recursive: true });
  }
  cpSync(join(up, 'LICENSE'), join(dest, 'LICENSE'));
  if (oldSha) writeFileSync(upstreamFile, oldSha + '\n'); // so finish() sees only real changes

  if (process.env.PR_BODY_FILE) writeFileSync(process.env.PR_BODY_FILE, releaseNotes(entries, compare));
  finish('ponytail', latest.sha, upstreamFile, dest);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${latest.tag}\nsha=${latest.sha}\n`);
}
