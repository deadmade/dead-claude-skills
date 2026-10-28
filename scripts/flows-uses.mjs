// Each flows conductor lists the skills, agents and tools it runs in its uses.json ({ plugin: [names] }).
// From those lists come flows' plugin.json dependencies and the tree in its README; check-repo fails on drift.
// Run directly to rewrite both.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FLOWS = 'plugins/flows';
// The skill packs flows carries, one synced folder each: no marketplace entry, read by path, never loaded on their own.
export const PACKS = `${FLOWS}/packs`;
export const OFFICIAL = 'claude-plugins-official';
// Claude Code's own skills and agents (security-review, general-purpose): listed, never a dependency.
export const BUILTIN = 'claude-code';
const START = '<!-- uses:start -->';
const END = '<!-- uses:end -->';

// flows' skills, split by frontmatter: conductors carry `disable-model-invocation: true`; the rest (writing) Claude
// may load on its own.
const flowsSkills = (root) => {
  const dir = join(root, FLOWS, 'skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(dir, name, 'SKILL.md'), 'utf8'))?.[1] ?? '';
      return { name, conductor: /^disable-model-invocation:\s*true\s*$/m.test(front) };
    });
};

export function readUses(root) {
  const dir = join(root, FLOWS, 'skills');
  return Object.fromEntries(
    flowsSkills(root)
      .filter((s) => s.conductor)
      .map(({ name }) => {
        const file = join(dir, name, 'uses.json');
        return [name, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined];
      }),
  );
}

// The pack names: the folders under PACKS.
export const packs = (root) =>
  existsSync(join(root, PACKS))
    ? readdirSync(join(root, PACKS), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

// marketplace: the parsed marketplace.json. Returns problems as strings.
export function checkUses(root, marketplace) {
  const problems = [];
  const packNames = packs(root);
  const skills = flowsSkills(root);
  for (const { name, conductor } of skills)
    if (!conductor && existsSync(join(root, FLOWS, 'skills', name, 'uses.json')))
      problems.push(`${FLOWS}/skills/${name}/uses.json: ${name} isn't a conductor (no disable-model-invocation: true)`);
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
      // flows' own non-conductor skills (writing) are listed under flows; other conductors aren't listed at all.
      if (plugin === 'flows') {
        for (const name of names) {
          const own = skills.find((s) => s.name === name);
          if (!own) problems.push(`${at}: flows has no skill ${name}`);
          else if (own.conductor) problems.push(`${at}: ${name} is a conductor; other conductors aren't listed`);
          else if (!skill.includes(name)) problems.push(`${at}: ${name} isn't mentioned in ${conductor}/SKILL.md`);
        }
        continue;
      }
      const pack = packNames.includes(plugin);
      const entry = marketplace.plugins.find((p) => p.name === plugin);
      if (!pack && !entry && plugin !== BUILTIN && !plugin.endsWith(`@${OFFICIAL}`)) {
        problems.push(`${at}: ${plugin} is not a plugin of this marketplace, a pack, …@${OFFICIAL} or ${BUILTIN}`);
        continue;
      }
      // Only packs and local plugins with skills or agents can be checked offline; MCP servers and mods take tool names.
      const dir = pack
        ? join(root, PACKS, plugin)
        : typeof entry?.source === 'string'
          ? join(root, entry.source)
          : undefined;
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

// Conductors quote the pack sentence they override: <!-- overrides <pack>/<path in pack>: "<sentence>" -->.
// Returns one problem per marker whose pack file is missing or no longer holds the sentence.
// Bold marks and line wraps in the pack don't matter; the vendored packs/ and agents/ are not scanned.
const MARKER = /<!--\s*overrides\s+(\S+?):\s*"(.*)"\s*-->/;
const flat = (t) => t.replace(/[*_]/g, '').replace(/\s+/g, ' ');
// flows' own .md files, the vendored packs/ and agents/ left out.
const conductorDocs = (root, dir = FLOWS) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return rel === PACKS || rel === `${FLOWS}/agents` ? [] : conductorDocs(root, rel);
    return e.name.endsWith('.md') ? [rel] : [];
  });
export function checkOverrides(root) {
  const problems = [];
  for (const file of conductorDocs(root)) {
    readFileSync(join(root, file), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const m = MARKER.exec(line);
        if (!m) return;
        const at = `${file}:${i + 1}`;
        const target = join(root, PACKS, m[1]);
        if (!existsSync(target) || !statSync(target).isFile())
          return problems.push(`${at}: overrides ${m[1]}, which is not a file`);
        if (!flat(readFileSync(target, 'utf8')).includes(flat(m[2])))
          problems.push(`${at}: ${m[1]} no longer contains "${m[2]}"`);
      });
  }
  return problems;
}

// Every `<packs>/…` or `${CLAUDE_PLUGIN_ROOT}/packs/…` path a conductor names must exist. A path ends at whitespace,
// a backtick, a quote or a bracket; one with a placeholder (`<pack>`, `…`, `*`) is skipped.
// shortcut: bare names (`references/x.md`) and paths broken across a line aren't seen; name the full pack path instead.
const PACK_PATH = /(?:\$\{CLAUDE_PLUGIN_ROOT\}\/packs|<packs>)\/([^\s`'"()[\]]+)/g;
export function checkPackPaths(root) {
  const problems = [];
  for (const file of conductorDocs(root)) {
    readFileSync(join(root, file), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const [, raw] of line.matchAll(PACK_PATH)) {
          const path = raw.replace(/[.,;:]+$/, '');
          if (/[<>…*]/.test(path) || existsSync(join(root, PACKS, path))) continue;
          problems.push(`${file}:${i + 1}: <packs>/${path} does not exist`);
        }
      });
  }
  return problems;
}

// packNames: packs(root); flows carries those and its own skills, so they are never a dependency.
export const expectedDeps = (all, packNames) =>
  [...new Set(Object.values(all).flatMap((uses) => Object.keys(uses ?? {})))]
    .filter((p) => p !== BUILTIN && p !== 'flows' && !packNames.includes(p))
    .sort();

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
  json.dependencies = expectedDeps(all, packs(root));
  writeFileSync(manifest, JSON.stringify(json, null, 2) + '\n');
  const readmePath = join(root, FLOWS, 'README.md');
  const readme = withTree(readFileSync(readmePath, 'utf8'), renderTree(all));
  if (!readme) throw new Error(`${readmePath}: no ${START} … ${END} block`);
  writeFileSync(readmePath, readme);
}
