// Repo checks for the pre-commit hook: every plugin manifest validates, the marketplace and the dead-skills
// bundle agree on the plugin list, and everything carries package.json's version. Skips `claude plugin validate` when claude isn't on PATH
// (nix flake check sandbox, CI).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUses, expectedDeps, FLOWS, readUses, renderTree, withTree } from './flows-uses.mjs';
import { pluginDirs as findPluginDirs } from './plugin-dirs.mjs';

process.chdir(join(import.meta.dirname, '..'));

const MARKETPLACE = '.claude-plugin/marketplace.json';
const BUNDLE = 'plugins/default/dead-skills/.claude-plugin/plugin.json';
const problems = [];
const pluginDirs = findPluginDirs();

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

// --- flows: each conductor's uses.json, and what is generated from them (scripts/flows-uses.mjs) ---
problems.push(...checkUses('.', { plugins: market }));
const uses = readUses('.');
const flowsManifest = `${FLOWS}/.claude-plugin/plugin.json`;
const regen = 'run node scripts/flows-uses.mjs';
if (JSON.stringify(JSON.parse(readFileSync(flowsManifest, 'utf8')).dependencies) !== JSON.stringify(expectedDeps(uses)))
  problems.push(`${flowsManifest}: dependencies differ from the conductors' uses.json: ${regen}`);
// A Windows checkout has CRLF; the generated tree is LF.
const flowsReadme = readFileSync(`${FLOWS}/README.md`, 'utf8').replace(/\r\n/g, '\n');
if (withTree(flowsReadme, renderTree(uses)) !== flowsReadme)
  problems.push(`${FLOWS}/README.md: uses tree is stale: ${regen}`);

// --- one version: package.json, marketplace metadata.version, every local plugin.json and each Rust crate (scripts/release.mjs) ---
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const marketVersion = JSON.parse(readFileSync(MARKETPLACE, 'utf8')).metadata?.version;
if (marketVersion !== version)
  problems.push(`${MARKETPLACE}: metadata.version is ${marketVersion}, package.json has ${version}`);
for (const dir of pluginDirs) {
  const manifest = join(dir, '.claude-plugin', 'plugin.json');
  const v = existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version;
  if (v !== version) problems.push(`${manifest}: version is ${v}, package.json has ${version}`);
}
const CRATES = [
  { cargo: 'crates/tui-review/Cargo.toml', lock: 'crates/tui-review/Cargo.lock', name: 'tui-review' },
  { cargo: 'crates/web-mcp/Cargo.toml', lock: 'crates/web-mcp/Cargo.lock', name: 'web-mcp' },
];
for (const { cargo, lock, name } of CRATES) {
  const crate = /^version = "(.*)"/m.exec(readFileSync(cargo, 'utf8'))?.[1];
  if (crate !== version) problems.push(`${cargo}: version is ${crate}, package.json has ${version}`);
  const locked = new RegExp(`^name = "${name}"\\r?\\nversion = "(.*)"`, 'm').exec(readFileSync(lock, 'utf8'))?.[1];
  if (locked !== version) problems.push(`${lock}: ${name} is ${locked}, package.json has ${version}`);
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ repo checks passed');
