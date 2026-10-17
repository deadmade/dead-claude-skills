// Cuts a release: one version for package.json, the marketplace, every local plugin and brv, committed and tagged
// vX.Y.Z on main. Pushing the tag runs .github/workflows/release.yml, which builds cswap.exe and brv and publishes the
// GitHub release. Claude Code only offers plugin updates when this version changes.
// Usage: npm run release -- patch|minor|major|X.Y.Z
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const bump = process.argv[2];
const [major, minor, patch] = current.split('.').map(Number);
const next =
  { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[bump] ??
  bump;
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) die('usage: npm run release -- patch|minor|major|X.Y.Z');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') die(`releases are cut from main, you are on ${branch}`);
if (git('status', '--porcelain')) die('working tree is not clean');
if (git('tag', '--list', `v${next}`)) die(`tag v${next} already exists`);

// Each file's own version line, edited in place so the rest of the file keeps its formatting. JSON: the top-level
// (or marketplace metadata) "version". Each Rust crate: its version, and its entry in Cargo.lock so --locked builds pass.
const json = /^( {2,4}"version": )"[^"]*"/m;
const bumps = [
  ['package.json', json],
  ['.claude-plugin/marketplace.json', json],
  ...pluginDirs().map((p) => [`${p}/.claude-plugin/plugin.json`, json]),
  ...[
    ['crates/brv', 'brv'],
    ['crates/web-mcp', 'web-mcp'],
  ].flatMap(([dir, name]) => [
    [`${dir}/Cargo.toml`, /^(version = )"[^"]*"/m],
    [`${dir}/Cargo.lock`, new RegExp(`^(name = "${name}"\\r?\\nversion = )"[^"]*"`, 'm')],
  ]),
];
const files = bumps.map(([f]) => f);
for (const [f, version] of bumps) {
  const text = readFileSync(f, 'utf8');
  if (!version.test(text)) die(`${f} has no version to bump`);
  writeFileSync(f, text.replace(version, `$1"${next}"`));
}

if (!run('npm', ['test'])) {
  git('checkout', '--', ...files);
  die('checks failed, versions reverted');
}

// Releasing the version already on main (the first release) only tags.
if (git('status', '--porcelain')) git('commit', '-m', `Release v${next}`, '--', ...files);
git('tag', '-a', `v${next}`, '-m', `v${next}`);
console.log(
  `\n✓ v${current} → v${next}, committed and tagged. Publish with:\n\n    git push --follow-tags origin main\n`,
);
