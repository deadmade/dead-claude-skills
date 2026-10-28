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

// A conductor's SKILL.md: only skills with `disable-model-invocation: true` are conductors.
const conductor = (body) => `---\nname: fix\ndisable-model-invocation: true\n---\n${body}`;

// A repo with one conductor `fix` using `uses`, local plugins picks (a skill, an agent, an MCP server) and web (an
// MCP server), and the pack superpowers (a skill, no marketplace entry). `files` adds more ({ path: text }).
function repo(uses, skillText = conductor('how reviewer docs search general-purpose deep'), files = {}) {
  const fx = mkdtempSync(join(tmpdir(), 'fu-'));
  const put = (p, s) => (mkdirSync(dirname(join(fx, p)), { recursive: true }), writeFileSync(join(fx, p), s));
  put('plugins/flows/skills/fix/SKILL.md', skillText);
  for (const [p, s] of Object.entries(files)) put(p, s);
  if (uses !== undefined) put('plugins/flows/skills/fix/uses.json', JSON.stringify(uses));
  put('plugins/picks/skills/how/SKILL.md', '');
  put('plugins/picks/agents/reviewer.md', '');
  put('plugins/picks/.mcp.json', JSON.stringify({ docs: { type: 'http' } }));
  put('plugins/web/.mcp.json', '{}');
  put('plugins/flows/packs/superpowers/skills/writing-plans/SKILL.md', '');
  return fx;
}

function fixture(uses, skillText, files) {
  const marketplace = {
    plugins: [
      { name: 'picks', source: './plugins/picks' },
      { name: 'web', source: './plugins/web' },
      { name: 'remote', source: { source: 'url', url: 'https://example.invalid/remote.git' } },
    ],
  };
  return checkUses(repo(uses, skillText, files), marketplace);
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
  assert.deepEqual(fixture({ superpowers: ['writing-plans'] }, conductor('writing-plans')), []);
  assert.deepEqual(fixture({ superpowers: ['nope'] }, conductor('nope')), [
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
  assert.match(fixture({ flows: ['fix'] })[0], /fix is a conductor/);
  assert.match(fixture({ picks: ['gone'] }, conductor('gone'))[0], /picks has no skill, agent or workflow gone/);
  assert.match(fixture({ picks: ['how'] }, conductor('nothing here'))[0], /how isn't mentioned in fix\/SKILL.md/);
});

test('a model-invocable skill is not a conductor', () => {
  // The plain skill's frontmatter is CRLF, as a Windows checkout writes it.
  const plain = '---\r\nname: writing\r\ndescription: x\r\n---\r\nbody\r\n';
  const fx = repo({ picks: ['how'] }, conductor('how'), { 'plugins/flows/skills/writing/SKILL.md': plain });
  const all = readUses(fx);
  assert.deepEqual(Object.keys(all), ['fix']);
  assert.doesNotMatch(renderTree(all), /writing/);
  // A conductor's own frontmatter in CRLF still counts.
  const crlf = repo({ picks: ['how'] }, conductor('how').replaceAll('\n', '\r\n'));
  assert.deepEqual(Object.keys(readUses(crlf)), ['fix']);
});

test("uses.json may list flows' non-conductor skills", () => {
  const files = { 'plugins/flows/skills/writing/SKILL.md': '---\nname: writing\n---\n' };
  assert.deepEqual(fixture({ flows: ['writing'] }, conductor('writing'), files), []);
  assert.match(fixture({ flows: ['fix'] }, conductor('fix'), files)[0], /fix is a conductor/);
  assert.match(fixture({ flows: ['nope'] }, conductor('nope'), files)[0], /flows has no skill nope/);
  assert.ok(!expectedDeps({ fix: { flows: ['writing'], picks: ['how'] } }, []).includes('flows'));
  assert.match(fixture({ flows: ['writing'] }, conductor('nothing here'), files)[0], /writing isn't mentioned/);
});

test('a uses.json beside a skill that is not a conductor is reported', () => {
  const files = {
    'plugins/flows/skills/writing/SKILL.md': '---\r\nname: writing\r\n---\r\n',
    'plugins/flows/skills/writing/uses.json': '{"picks":["how"]}',
  };
  assert.deepEqual(fixture({ picks: ['how'] }, conductor('how'), files), [
    "plugins/flows/skills/writing/uses.json: writing isn't a conductor (no disable-model-invocation: true)",
  ]);
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
