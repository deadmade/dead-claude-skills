import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optIns, needsToken, planPlugins, duplicates, mergeSettings, safeArg, missingBinaries } from './core.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const marketplace = json('.claude-plugin/marketplace.json');
const bundle = json('plugins/dead-skills/.claude-plugin/plugin.json');
const M = 'dead-claude-skills';

test('opt-ins from the real manifests', () => {
  assert.deepEqual(optIns(marketplace, bundle).sort(),
    ['graphify', 'mattpocock-picks', 'mcp-azure', 'mcp-github', 'pstack-picks']);
});

test('token plugins', () => {
  assert.equal(needsToken(json('plugins/mcp-github/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/mcp-azure/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/graphify/.claude-plugin/plugin.json')), false);
});

test('select installs, deselect uninstalls, token plugins hand off', () => {
  const plan = planPlugins(
    ['graphify', 'mcp-github', 'pstack-picks'],
    [`pstack-picks@${M}`, `mattpocock-picks@${M}`, `mcp-azure@${M}`],
    ['mcp-github', 'mcp-azure'],
  );
  assert.deepEqual(plan.install, ['graphify']);
  assert.deepEqual(plan.handoff, ['mcp-github']);
  assert.deepEqual(plan.uninstall.sort(), [`mattpocock-picks@${M}`, `mcp-azure@${M}`]);
});

test('duplicates are our names from another marketplace', () => {
  assert.deepEqual(
    duplicates(['ponytail@ponytail', `ponytail@${M}`, 'code-review@claude-plugins-official', 'other@x'],
      ['ponytail', 'code-review']),
    ['ponytail@ponytail', 'code-review@claude-plugins-official']);
});

test('merge adds owned keys and keeps foreign ones', () => {
  const out = mergeSettings({ model: 'x', permissions: { allow: ['Bash(ls)'] } }, { statusLine: true });
  assert.equal(out.model, 'x');
  assert.deepEqual(out.permissions.allow, ['Bash(ls)', 'Read(~/.claude/plugins/**)']);
  assert.equal(out.extraKnownMarketplaces[M].autoUpdate, true);
  assert.match(out.statusLine.command, /ccstatusline/);
});

test('merge is idempotent', () => {
  const once = mergeSettings({}, { statusLine: true });
  assert.deepEqual(mergeSettings(once, { statusLine: true }), once);
});

test('statusLine off removes ours, keeps a foreign one', () => {
  assert.equal(mergeSettings({ statusLine: { type: 'command', command: 'ccstatusline' } }, { statusLine: false }).statusLine, undefined);
  const foreign = { type: 'command', command: 'my-line.sh' };
  assert.deepEqual(mergeSettings({ statusLine: foreign }, { statusLine: false }).statusLine, foreign);
});

test('safeArg rejects shell metacharacters', () => {
  assert.equal(safeArg(`graphify@${M}`), `graphify@${M}`);
  for (const bad of ['a&b', '%PATH%', 'a"b', 'a b']) assert.throws(() => safeArg(bad));
});

test('missing binaries per OS', () => {
  const none = () => false;
  const win = missingBinaries('win32', ['dead-skills'], none);
  assert.ok(!win.some((r) => r.binary === 'nixd' && !/disable/.test(r.command)));
  assert.ok(win.some((r) => r.binary === 'nixd' && /disable/.test(r.command)));
  const nix = missingBinaries('linux', ['dead-skills', 'graphify'], none);
  assert.ok(nix.some((r) => r.binary === 'nixd' && /nixd/.test(r.command)));
  assert.ok(nix.some((r) => r.binary === 'graphify'));
  assert.deepEqual(missingBinaries('linux', ['dead-skills'], () => true), []);
});
