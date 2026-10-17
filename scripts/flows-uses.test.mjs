import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkUses, expectedDeps, readUses, renderTree, withTree } from './flows-uses.mjs';

const ROOT = join(import.meta.dirname, '..');

// A repo with one conductor `fix` using `uses`, and local plugins picks (a skill, an agent, an MCP server) and web (an
// MCP server).
function fixture(uses, skillText = 'how reviewer docs search general-purpose deep') {
  const fx = mkdtempSync(join(tmpdir(), 'fu-'));
  const put = (p, s) => (mkdirSync(dirname(join(fx, p)), { recursive: true }), writeFileSync(join(fx, p), s));
  put('plugins/flows/skills/fix/SKILL.md', skillText);
  if (uses !== undefined) put('plugins/flows/skills/fix/uses.json', JSON.stringify(uses));
  put('plugins/picks/skills/how/SKILL.md', '');
  put('plugins/picks/agents/reviewer.md', '');
  put('plugins/picks/.mcp.json', JSON.stringify({ docs: { type: 'http' } }));
  put('plugins/web/.mcp.json', '{}');
  const marketplace = {
    plugins: [
      { name: 'picks', source: './plugins/picks' },
      { name: 'web', source: './plugins/web' },
      { name: 'superpowers', source: { source: 'url', url: 'https://example.invalid/sp.git' } },
    ],
  };
  return checkUses(fx, marketplace);
}

test('a valid map has no problems: local skill and agent, MCP tool, url plugin, official, builtin', () => {
  const uses = {
    picks: ['how', 'reviewer'],
    web: ['search'],
    superpowers: ['deep'],
    'claude-security@claude-plugins-official': ['deep'],
    'claude-code': ['general-purpose'],
  };
  assert.deepEqual(fixture(uses), []);
});

test("an MCP server of a plugin that also has skills counts as that plugin's", () => {
  assert.deepEqual(fixture({ picks: ['how', 'docs'] }), []);
});

test('each kind of problem is reported', () => {
  assert.match(fixture(undefined)[0], /missing, or not/);
  assert.match(fixture({ picks: 'how' })[0], /missing, or not/);
  assert.match(fixture({ picks: [] })[0], /missing, or not/);
  assert.match(fixture({ nope: ['how'] })[0], /nope is not a plugin/);
  assert.match(fixture({ flows: ['verify'] })[0], /other conductors/);
  assert.match(fixture({ picks: ['gone'] }, 'gone')[0], /picks has no skill, agent or workflow gone/);
  assert.match(fixture({ picks: ['how'] }, 'nothing here')[0], /how isn't mentioned in fix\/SKILL.md/);
});

test('expectedDeps: every plugin once, sorted, builtins left out', () => {
  const all = { a: { z: ['x'], 'claude-code': ['y'] }, b: { m: ['x'], z: ['q'] } };
  assert.deepEqual(expectedDeps(all), ['m', 'z']);
});

test('renderTree draws one block per conductor', () => {
  const tree = renderTree({ fix: { picks: ['how', 'why'], web: ['search'] }, learn: { picks: ['recall'] } });
  assert.equal(
    tree,
    ['```text', 'fix', '├ picks: how, why', '└ web: search', '', 'learn', '└ picks: recall', '```'].join('\n'),
  );
});

test('withTree replaces only the marked block, and refuses a README without one', () => {
  const readme = 'top\n<!-- uses:start -->\nold\n<!-- uses:end -->\nbottom\n';
  assert.equal(withTree(readme, 'NEW'), 'top\n<!-- uses:start -->\n\nNEW\n\n<!-- uses:end -->\nbottom\n');
  assert.equal(withTree('no markers', 'NEW'), undefined);
});

test('the real conductors pass, and flows depends on exactly what they use', () => {
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.deepEqual(checkUses(ROOT, marketplace), []);
  const deps = JSON.parse(readFileSync(join(ROOT, 'plugins/flows/.claude-plugin/plugin.json'), 'utf8')).dependencies;
  assert.deepEqual(deps, expectedDeps(readUses(ROOT)));
});
