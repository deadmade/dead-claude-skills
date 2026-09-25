import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  optIns, needsToken, planPlugins, duplicates, mergeSettings, safeArg, missingBinaries, SECRET_DENIES, isSandboxOn,
  hasDcgHook, dcgCommand,
} from './core.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const marketplace = json('.claude-plugin/marketplace.json');
const bundle = json('plugins/dead-skills/.claude-plugin/plugin.json');
const M = 'dead-claude-skills';

test('opt-ins from the real manifests', () => {
  assert.deepEqual(optIns(marketplace, bundle).sort(),
    ['atlassian', 'csharp-lsp', 'dev-feature', 'graphify', 'hallmark', 'mattpocock-picks', 'mcp-azure', 'mcp-github', 'nix-lsp', 'pstack-picks',
     'pyright-lsp', 'rust-analyzer-lsp', 'typescript-lsp']);
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
  assert.ok(!missingBinaries('linux', ['dead-skills'], none).some((r) => r.binary === 'nixd'));
  const win = missingBinaries('win32', ['nix-lsp'], none);
  assert.ok(win.some((r) => r.binary === 'nixd' && /deselect/.test(r.command)));
  const nix = missingBinaries('linux', ['nix-lsp', 'graphify'], none);
  assert.ok(nix.some((r) => r.binary === 'nixd' && /nixd/.test(r.command)));
  assert.ok(nix.some((r) => r.binary === 'graphify'));
  assert.deepEqual(missingBinaries('linux', ['dead-skills'], () => true), []);
});

test('secret denies are added once and keep existing ones', () => {
  const out = mergeSettings({ permissions: { deny: ['Bash(sudo:*)', 'Read(~/.ssh/**)'] } }, {});
  assert.deepEqual(out.permissions.deny, ['Bash(sudo:*)', 'Read(~/.ssh/**)', ...SECRET_DENIES.filter((d) => d !== 'Read(~/.ssh/**)')]);
  assert.deepEqual(mergeSettings(out, {}), out);
});

test('sandbox on merges our keys, off removes only ours', () => {
  const on = mergeSettings({ sandbox: { excludedCommands: ['docker'] } }, { sandbox: true });
  assert.deepEqual(on.sandbox, { excludedCommands: ['docker'], enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false });
  assert.ok(isSandboxOn(on));
  assert.deepEqual(mergeSettings(on, { sandbox: true }), on);
  assert.deepEqual(mergeSettings(on, { sandbox: false }).sandbox, { excludedCommands: ['docker'] });
  assert.equal(mergeSettings(mergeSettings({}, { sandbox: true }), { sandbox: false }).sandbox, undefined);
  assert.ok(!isSandboxOn({}));
});

test('dcg hook detection', () => {
  const hook = (command) => ({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command }] }] } });
  assert.ok(hasDcgHook(hook('/home/me/.local/bin/dcg')));
  assert.ok(hasDcgHook(hook('"C:\\Users\\me\\.local\\bin\\dcg.exe"')));
  assert.ok(!hasDcgHook(hook('node guard.mjs')));
  assert.ok(!hasDcgHook({}));
});

test('dcg runs its own installer per OS', () => {
  const [win, winArgs] = dcgCommand('win32', 'install');
  assert.equal(win, 'powershell');
  assert.match(winArgs.at(-1), /install\.ps1'\)\)\) -EasyMode -Verify$/);
  assert.match(dcgCommand('win32', 'uninstall')[1].at(-1), /uninstall\.ps1/);
  const [sh, shArgs] = dcgCommand('linux', 'install');
  assert.equal(sh, 'bash');
  assert.match(shArgs[1], /install\.sh' \| bash -s -- --verify$/);
  assert.match(dcgCommand('linux', 'uninstall')[1][1], /uninstall\.sh' \| bash -s -- --yes$/);
});

test('sandbox needs bubblewrap and socat', () => {
  const rows = missingBinaries('linux', ['sandbox'], () => false);
  assert.deepEqual(rows.map((r) => r.binary), ['bwrap', 'socat']);
  assert.match(rows[0].command, /home\.packages: bubblewrap/);
});
