// Each flows conductor lists the skills, agents and tools it runs in its uses.json ({ plugin: [names] }).
// From those lists come flows' plugin.json dependencies and the tree in its README; check-repo fails on drift.
// Run directly to rewrite both.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FLOWS = 'plugins/flows';
export const OFFICIAL = 'claude-plugins-official';
// Claude Code's own skills and agents (security-review, general-purpose): listed, never a dependency.
export const BUILTIN = 'claude-code';
const START = '<!-- uses:start -->';
const END = '<!-- uses:end -->';

export function readUses(root) {
  const dir = join(root, FLOWS, 'skills');
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
      .map((name) => {
        const file = join(dir, name, 'uses.json');
        return [name, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined];
      }),
  );
}

// marketplace: the parsed marketplace.json. Returns problems as strings.
export function checkUses(root, marketplace) {
  const problems = [];
  for (const [conductor, uses] of Object.entries(readUses(root))) {
    const at = `${FLOWS}/skills/${conductor}/uses.json`;
    const valid =
      uses &&
      typeof uses === 'object' &&
      !Array.isArray(uses) &&
      Object.values(uses).every((v) => Array.isArray(v) && v.length && v.every((n) => typeof n === 'string'));
    if (!valid) {
      problems.push(`${at}: missing, or not { plugin: [names] }`);
      continue;
    }
    const skill = readFileSync(join(root, FLOWS, 'skills', conductor, 'SKILL.md'), 'utf8');
    for (const [plugin, names] of Object.entries(uses)) {
      if (plugin === 'flows') {
        problems.push(`${at}: other conductors aren't listed`);
        continue;
      }
      const entry = marketplace.plugins.find((p) => p.name === plugin);
      if (!entry && plugin !== BUILTIN && !plugin.endsWith(`@${OFFICIAL}`)) {
        problems.push(`${at}: ${plugin} is not a plugin of this marketplace, …@${OFFICIAL} or ${BUILTIN}`);
        continue;
      }
      // Only local plugins with skills or agents can be checked offline; MCP servers and mods take tool names.
      const dir = typeof entry?.source === 'string' ? join(root, entry.source) : undefined;
      const checkable = dir && ['skills', 'agents', 'workflows'].some((d) => existsSync(join(dir, d)));
      const mcp =
        dir && existsSync(join(dir, '.mcp.json')) ? Object.keys(JSON.parse(readFileSync(join(dir, '.mcp.json')))) : [];
      for (const name of names) {
        const found =
          mcp.includes(name) ||
          ['skills/' + name + '/SKILL.md', 'agents/' + name + '.md', 'workflows/' + name + '.js'].some((f) =>
            existsSync(join(dir ?? '', f)),
          );
        if (checkable && !found) problems.push(`${at}: ${plugin} has no skill, agent or workflow ${name}`);
        if (!skill.includes(name)) problems.push(`${at}: ${name} isn't mentioned in ${conductor}/SKILL.md`);
      }
    }
  }
  return problems;
}

export const expectedDeps = (all) =>
  [...new Set(Object.values(all).flatMap((uses) => Object.keys(uses ?? {})))].filter((p) => p !== BUILTIN).sort();

export function renderTree(all) {
  const blocks = Object.entries(all).map(([conductor, uses]) => {
    const rows = Object.entries(uses ?? {});
    return [
      conductor,
      ...rows.map(([p, names], i) => `${i === rows.length - 1 ? '└' : '├'} ${p}: ${names.join(', ')}`),
    ];
  });
  return [
    '```text',
    ...blocks
      .map((b) => b.join('\n'))
      .join('\n\n')
      .split('\n'),
    '```',
  ].join('\n');
}

// The README with its uses block replaced, or undefined when the markers are missing.
export function withTree(readme, tree) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) return undefined;
  return `${readme.slice(0, a + START.length)}\n\n${tree}\n\n${readme.slice(b)}`;
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const root = join(import.meta.dirname, '..');
  const all = readUses(root);
  const manifest = join(root, FLOWS, '.claude-plugin', 'plugin.json');
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  json.dependencies = expectedDeps(all);
  writeFileSync(manifest, JSON.stringify(json, null, 2) + '\n');
  const readmePath = join(root, FLOWS, 'README.md');
  const readme = withTree(readFileSync(readmePath, 'utf8'), renderTree(all));
  if (!readme) throw new Error(`${readmePath}: no ${START} … ${END} block`);
  writeFileSync(readmePath, readme);
}
