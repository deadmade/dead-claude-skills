// Vendor ponytail's Claude Code plugin into plugins/shared/ponytail/ at upstream's newest stable vX.Y.Z tag, unchanged
// but for plugin.json's version (ours: everything ships as one version). Upstream also ships adapters for other hosts;
// only what Claude Code loads is copied. Idempotent: re-running against the same tag gives no diff.
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

// The hook config files plugin.json names (a path, or a list of paths and inline objects).
const hookFiles = (hooks) => [hooks ?? []].flat().filter((h) => typeof h === 'string');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const latest = stableTags(git('ls-remote', '--tags', `https://github.com/${REPO}.git`)).at(-1);
  if (!latest) fail(`${REPO} has no vX.Y.Z tag`);
  const dest = join(ROOT, DEST);
  const upstreamFile = join(dest, 'UPSTREAM');
  const oldSha = existsSync(upstreamFile) ? readFileSync(upstreamFile, 'utf8').trim() : undefined;

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
  for (const f of hookFiles(manifest.hooks))
    if (!existsSync(join(up, f))) fail(`plugin.json names ${f}, which upstream doesn't have`);
  if (!existsSync(join(up, 'skills', 'ponytail', 'SKILL.md'))) fail('upstream skills/ponytail/SKILL.md not found');
  const unknown = unknownParts(manifest, git('-C', up, 'ls-tree', '--name-only', 'HEAD').split('\n'));
  if (unknown.length)
    fail(`upstream has parts this sync doesn't handle: ${unknown.join(', ')}; decide, then update KEYS/SKIPPED`);

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
  finish('ponytail', latest.sha, upstreamFile, dest);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${latest.tag}\nsha=${latest.sha}\n`);
}
