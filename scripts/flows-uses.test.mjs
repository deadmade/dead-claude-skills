import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkOverrides,
  checkPackPaths,
  checkUses,
  expectedDeps,
  packs,
  readUses,
  renderTree,
  withTree,
} from './flows-uses.mjs';

const ROOT = join(import.meta.dirname, '..');

// A repo with one conductor `fix` using `uses`, local plugins picks (a skill, an agent, an MCP server) and web (an
// MCP server), and the pack superpowers (a skill, no marketplace entry).
function fixture(uses, skillText = 'how reviewer docs search general-purpose deep') {
  const fx = mkdtempSync(join(tmpdir(), 'fu-'));
  const put = (p, s) => (mkdirSync(dirname(join(fx, p)), { recursive: true }), writeFileSync(join(fx, p), s));
  put('plugins/flows/skills/fix/SKILL.md', skillText);
  if (uses !== undefined) put('plugins/flows/skills/fix/uses.json', JSON.stringify(uses));
  put('plugins/picks/skills/how/SKILL.md', '');
  put('plugins/picks/agents/reviewer.md', '');
  put('plugins/picks/.mcp.json', JSON.stringify({ docs: { type: 'http' } }));
  put('plugins/web/.mcp.json', '{}');
  put('plugins/flows/packs/superpowers/skills/writing-plans/SKILL.md', '');
  const marketplace = {
    plugins: [
      { name: 'picks', source: './plugins/picks' },
      { name: 'web', source: './plugins/web' },
      { name: 'remote', source: { source: 'url', url: 'https://example.invalid/remote.git' } },
    ],
  };
  return checkUses(fx, marketplace);
}

test('a valid map has no problems: local skill and agent, MCP tool, url plugin, official, builtin', () => {
  const uses = {
    picks: ['how', 'reviewer'],
    web: ['search'],
    remote: ['deep'],
    'claude-security@claude-plugins-official': ['deep'],
    'claude-code': ['general-purpose'],
  };
  assert.deepEqual(fixture(uses), []);
});

test('a pack resolves to its folder under plugins/flows/packs, with no marketplace entry', () => {
  assert.deepEqual(fixture({ superpowers: ['writing-plans'] }, 'writing-plans'), []);
  assert.deepEqual(fixture({ superpowers: ['nope'] }, 'nope'), [
    'plugins/flows/skills/fix/uses.json: superpowers has no skill, agent or workflow nope',
  ]);
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

test('expectedDeps: every plugin once, sorted, builtins and packs left out', () => {
  const all = { a: { z: ['x'], 'claude-code': ['y'], superpowers: ['p'] }, b: { m: ['x'], z: ['q'] } };
  assert.deepEqual(expectedDeps(all, ['superpowers']), ['m', 'z']);
});

test('packs lists the folders under plugins/flows/packs', () => {
  const fx = mkdtempSync(join(tmpdir(), 'fu-'));
  mkdirSync(join(fx, 'plugins/flows/packs/b'), { recursive: true });
  mkdirSync(join(fx, 'plugins/flows/packs/a'), { recursive: true });
  writeFileSync(join(fx, 'plugins/flows/packs/notes.txt'), '');
  assert.deepEqual(packs(fx), ['a', 'b']);
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
  assert.deepEqual(deps, expectedDeps(readUses(ROOT), packs(ROOT)));
  assert.deepEqual(checkOverrides(ROOT), []);
  assert.deepEqual(checkPackPaths(ROOT), []);
});

// A repo whose conductor quotes `quote` from a pack file that reads `pack`.
function overrides(quote, pack = 'Always **write the\nplan** first.\n') {
  const fx = mkdtempSync(join(tmpdir(), 'ov-'));
  const put = (f, s) => (mkdirSync(dirname(join(fx, f)), { recursive: true }), writeFileSync(join(fx, f), s));
  put('plugins/flows/packs/p/skills/s/SKILL.md', pack);
  put('plugins/flows/skills/fix/SKILL.md', `intro\n<!-- overrides p/skills/s/SKILL.md: "${quote}" -->\n`);
  return checkOverrides(fx);
}

test('checkOverrides: a found sentence passes, also across a wrap and bold in the pack', () => {
  assert.deepEqual(overrides('Always write the plan first.'), []);
});

test('checkOverrides: a changed sentence fails, naming file and line', () => {
  assert.deepEqual(overrides('Never write the plan.'), [
    'plugins/flows/skills/fix/SKILL.md:2: p/skills/s/SKILL.md no longer contains "Never write the plan."',
  ]);
});

test('checkOverrides: *emphasis*, _emphasis_ and __strong__ in the pack are ignored', () => {
  assert.deepEqual(overrides('Write the plan now.', 'Write *the* _plan_ __now__.\n'), []);
});

test('checkOverrides: a marker naming a directory is a problem, not a crash', () => {
  const fx = mkdtempSync(join(tmpdir(), 'ov-'));
  mkdirSync(join(fx, 'plugins/flows/packs/p/skills'), { recursive: true });
  mkdirSync(join(fx, 'plugins/flows/skills/fix'), { recursive: true });
  writeFileSync(join(fx, 'plugins/flows/skills/fix/SKILL.md'), '<!-- overrides p/skills: "x" -->');
  assert.equal(checkOverrides(fx).length, 1);
});

test('checkOverrides: a missing pack file fails', () => {
  const fx = mkdtempSync(join(tmpdir(), 'ov-'));
  mkdirSync(join(fx, 'plugins/flows/skills/fix'), { recursive: true });
  writeFileSync(join(fx, 'plugins/flows/skills/fix/SKILL.md'), '<!-- overrides p/gone.md: "x" -->');
  assert.equal(checkOverrides(fx).length, 1);
});

// A repo whose conductor reads `text`, with one pack file p/skills/s/SKILL.md; packs/ and agents/ name a missing path.
function packPaths(text) {
  const fx = mkdtempSync(join(tmpdir(), 'pp-'));
  const put = (f, s) => (mkdirSync(dirname(join(fx, f)), { recursive: true }), writeFileSync(join(fx, f), s));
  put('plugins/flows/packs/p/skills/s/SKILL.md', '`<packs>/p/gone.md`');
  put('plugins/flows/agents/a.md', '`${CLAUDE_PLUGIN_ROOT}/packs/p/gone.md`');
  put('plugins/flows/skills/fix/SKILL.md', text);
  return checkPackPaths(fx);
}

test('checkPackPaths: existing paths in both spellings pass, placeholders are skipped', () => {
  const text =
    'Read `<packs>/p/skills/s/SKILL.md`, then ${CLAUDE_PLUGIN_ROOT}/packs/p/skills/s/SKILL.md.\n' +
    '`<packs>/<pack>/skills/<name>/SKILL.md` and `<packs>/…` are not paths.';
  assert.deepEqual(packPaths(text), []);
});

test('checkPackPaths: a missing path fails, naming file and line', () => {
  assert.deepEqual(packPaths('intro\nby `<packs>/p/skills/gone.md` and ${CLAUDE_PLUGIN_ROOT}/packs/q/x.md.'), [
    'plugins/flows/skills/fix/SKILL.md:2: <packs>/p/skills/gone.md does not exist',
    'plugins/flows/skills/fix/SKILL.md:2: <packs>/q/x.md does not exist',
  ]);
});
