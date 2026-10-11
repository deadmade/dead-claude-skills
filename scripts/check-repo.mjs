// Repo checks for the pre-commit hook: every plugin manifest validates, the marketplace and the dead-skills
// bundle agree on the plugin list, and everything carries package.json's version. Skips `claude plugin validate` when claude isn't on PATH
// (nix flake check sandbox, CI).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

process.chdir(join(import.meta.dirname, '..'));

const MARKETPLACE = '.claude-plugin/marketplace.json';
const BUNDLE = 'plugins/dead-skills/.claude-plugin/plugin.json';
const problems = [];
const pluginDirs = readdirSync('plugins', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `plugins/${d.name}`);

// --- claude plugin validate ---
for (const target of ['.', ...pluginDirs.map((d) => d + '/')]) {
  const r = spawnSync('claude', ['plugin', 'validate', target], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') {
    console.log('claude not on PATH: skipping claude plugin validate');
    break;
  }
  if (r.status !== 0) problems.push(`claude plugin validate ${target} failed:\n${r.stdout}${r.stderr}`);
}

// --- marketplace <-> bundle <-> plugins/ ---
const { plugins: market, allowCrossMarketplaceDependenciesOn: crossAllowed = [] } = JSON.parse(
  readFileSync(MARKETPLACE, 'utf8'),
);
const deps = JSON.parse(readFileSync(BUNDLE, 'utf8')).dependencies;

for (const dep of deps) {
  const [name, from] = dep.split('@');
  if (from) {
    // Anthropic's own plugins come straight from their marketplace, which must be allowlisted to auto-install.
    if (!crossAllowed.includes(from))
      problems.push(`${BUNDLE}: dependency ${dep} needs ${from} in allowCrossMarketplaceDependenciesOn`);
  } else if (!market.some((p) => p.name === name))
    problems.push(`${BUNDLE}: dependency ${dep} is not in ${MARKETPLACE}`);
}
for (const { source } of market) {
  if (typeof source === 'string' && !existsSync(join(source, '.claude-plugin', 'plugin.json'))) {
    problems.push(`${MARKETPLACE}: ${source} has no .claude-plugin/plugin.json`);
  }
}
for (const dir of pluginDirs) {
  if (!market.some((p) => p.source === `./${dir}`)) problems.push(`${dir} is not listed in ${MARKETPLACE}`);
}

// --- one version: package.json, marketplace metadata.version, every local plugin.json and brv (scripts/release.mjs) ---
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const marketVersion = JSON.parse(readFileSync(MARKETPLACE, 'utf8')).metadata?.version;
if (marketVersion !== version)
  problems.push(`${MARKETPLACE}: metadata.version is ${marketVersion}, package.json has ${version}`);
for (const dir of pluginDirs) {
  const manifest = join(dir, '.claude-plugin', 'plugin.json');
  const v = existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version;
  if (v !== version) problems.push(`${manifest}: version is ${v}, package.json has ${version}`);
}
const CARGO = 'plugins/tui-review/brv/Cargo.toml';
const brv = /^version = "(.*)"/m.exec(readFileSync(CARGO, 'utf8'))?.[1];
if (brv !== version) problems.push(`${CARGO}: version is ${brv}, package.json has ${version}`);

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ repo checks passed');
