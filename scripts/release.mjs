// Cuts a release: one version for package.json (and its lock), the marketplace, every local plugin, flows' packs and
// both crates, committed and tagged vX.Y.Z on main. Pushing the tag runs .github/workflows/release.yml, which
// builds the installer, tui-review and web-mcp and publishes the GitHub release. Claude Code only offers plugin
// updates when this version changes. --detach commits off main instead, leaving the branch where it was: release.yml
// does that for the patch it cuts on every merge to main.
// Usage: npm run release -- patch|minor|major|X.Y.Z [--detach]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKS, packs } from './flows-uses.mjs';
import { nextVersion } from './next-version.mjs';
import { pluginDirs } from './plugin-dirs.mjs';

process.chdir(join(import.meta.dirname, '..'));

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) die(`git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout.trim();
};
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status === 0;

const args = process.argv.slice(2);
const detach = args.includes('--detach');
const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const next = nextVersion(
  current,
  git('tag', '--list', 'v*').split('\n'),
  args.find((a) => a !== '--detach'),
);
if (!next) die('usage: npm run release -- patch|minor|major|X.Y.Z [--detach]');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') die(`releases are cut from main, you are on ${branch}`);
if (git('status', '--porcelain')) die('working tree is not clean');
if (git('tag', '--list', `v${next}`)) die(`tag v${next} already exists`);

// Each file's own version line, edited in place so the rest of the file keeps its formatting. JSON: the top-level
// (or marketplace metadata) "version"; package-lock.json also its root package's. Each Rust crate: its version, and its
// entry in Cargo.lock so --locked builds pass.
const json = /^( {2,4}"version": )"[^"]*"/m;
const bumps = [
  ['package.json', json],
  ['package-lock.json', json],
  ['package-lock.json', /^( {6}"version": )"[^"]*"/m],
  ['.claude-plugin/marketplace.json', json],
  ...[...pluginDirs(), ...packs('.').map((p) => `${PACKS}/${p}`)].map((p) => [`${p}/.claude-plugin/plugin.json`, json]),
  ...[
    ['crates/tui-review', 'tui-review'],
    ['crates/web-mcp', 'web-mcp'],
    ['crates/flow-cockpit', 'flow-cockpit-core'],
  ].flatMap(([dir, name]) => [
    [`${dir}/Cargo.toml`, /^(version = )"[^"]*"/m],
    [`${dir}/Cargo.lock`, new RegExp(`^(name = "${name}"\\r?\\nversion = )"[^"]*"`, 'm')],
  ]),
];
const files = [...new Set(bumps.map(([f]) => f))];
for (const [f, version] of bumps) {
  const text = readFileSync(f, 'utf8');
  if (!version.test(text)) die(`${f} has no version to bump`);
  writeFileSync(f, text.replace(version, `$1"${next}"`));
}

if (!run('npm', ['test'])) {
  git('checkout', '--', ...files);
  die('checks failed, versions reverted');
}

if (detach) git('checkout', '--detach');
// Releasing the version already on main (the first release) only tags.
if (git('status', '--porcelain')) git('commit', '-m', `Release v${next}`, '--', ...files);
git('tag', '-a', `v${next}`, '-m', `v${next}`);
const push = detach ? `git push origin v${next}` : 'git push --follow-tags origin main';
console.log(`\n✓ v${current} → v${next}, committed and tagged. Publish with:\n\n    ${push}\n`);
