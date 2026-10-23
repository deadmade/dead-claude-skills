import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeSettings,
  isShipped,
  SECRET_DENIES,
  isSandboxOn,
  hasDcgHook,
  stripDefaults,
  isStripped,
  resetSettings,
  restoreHint,
  CLEAN_TARGETS,
  settingsChange,
  settingsText,
  webBuiltinsDecision,
  isWebBuiltinsOff,
  type Settings,
} from './settings.ts';
import { missingBinaries } from './binaries.ts';
import { TOGGLES, HINTS } from './options.ts';

const V = { version: '1.0.0' };
const M = 'dead-claude-skills';
const O = 'claude-plugins-official';
const shippedText = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('merge adds owned keys and keeps foreign ones', () => {
  const out = mergeSettings(
    { model: 'x', permissions: { allow: ['Bash(ls)'] } },
    { statusLine: true, version: '1.2.3' },
  );
  assert.equal(out.model, 'x');
  assert.deepEqual(out.permissions!.allow, ['Bash(ls)', 'Read(~/.claude/plugins/**)']);
  assert.equal(out.extraKnownMarketplaces![M].autoUpdate, true);
  assert.equal(out.extraKnownMarketplaces![M].source!.ref, 'v1.2.3');
  assert.match(out.statusLine!.command!, /ccstatusline/);
  assert.equal(out.cleanupPeriodDays, 36500);
  assert.equal(mergeSettings({ cleanupPeriodDays: 7 }, V).cleanupPeriodDays, 7);
});

test('merge is idempotent', () => {
  const once = mergeSettings({}, { ...V, statusLine: true });
  assert.deepEqual(mergeSettings(once, { ...V, statusLine: true }), once);
});

test('statusLine off removes ours, keeps a foreign one', () => {
  assert.equal(
    mergeSettings({ ...V, statusLine: { type: 'command', command: 'ccstatusline' } }, { ...V, statusLine: false })
      .statusLine,
    undefined,
  );
  const foreign = { type: 'command', command: 'my-line.sh' };
  assert.deepEqual(mergeSettings({ ...V, statusLine: foreign }, { ...V, statusLine: false }).statusLine, foreign);
});

test('secret denies are added once and keep existing ones', () => {
  const out = mergeSettings({ permissions: { deny: ['Bash(sudo:*)', 'Read(~/.ssh/**)'] } }, V);
  assert.deepEqual(out.permissions!.deny, [
    'Bash(sudo:*)',
    'Read(~/.ssh/**)',
    ...SECRET_DENIES.filter((d) => d !== 'Read(~/.ssh/**)'),
  ]);
  assert.deepEqual(mergeSettings(out, V), out);
});

test('sandbox on merges our keys, off removes only ours', () => {
  const on = mergeSettings({ ...V, sandbox: { excludedCommands: ['make'] } }, { ...V, sandbox: true });
  assert.deepEqual(on.sandbox, {
    excludedCommands: ['make'],
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
  });
  assert.ok(isSandboxOn(on));
  assert.deepEqual(mergeSettings(on, { ...V, sandbox: true }), on);
  assert.deepEqual(mergeSettings(on, { ...V, sandbox: false }).sandbox, { excludedCommands: ['make'] });
  assert.equal(mergeSettings(mergeSettings({}, { ...V, sandbox: true }), { ...V, sandbox: false }).sandbox, undefined);
  assert.ok(!isSandboxOn({}));
});

test('dcg hook detection', () => {
  const hook = (command: string) => ({
    hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command }] }] },
  });
  assert.ok(hasDcgHook(hook('/home/me/.local/bin/dcg')));
  assert.ok(hasDcgHook(hook('"C:\\Users\\me\\.local\\bin\\dcg.exe"')));
  assert.ok(!hasDcgHook(hook('node guard.mjs')));
  assert.ok(!hasDcgHook({}));
});

// What dcg's own installers write, not the shapes we assume they write.
const dcgHooks: Record<string, Settings | string> = JSON.parse(
  readFileSync(new URL('./fixtures/dcg-hooks.json', import.meta.url), 'utf8'),
);
test('dcg hook detection reads every hook dcg writes, and a clean slate keeps it', () => {
  for (const [os, settings] of Object.entries(dcgHooks)) {
    if (typeof settings === 'string') continue;
    assert.ok(hasDcgHook(settings), os);
    assert.deepEqual(resetSettings(settings, { ...V, dcg: true }).hooks, settings.hooks, os);
  }
});

test('strip disables defaults, keeps foreign keys, drops other marketplaces', () => {
  const before: Settings = {
    model: 'x',
    env: { FOO: '1' },
    enabledPlugins: { 'a@b': true },
    extraKnownMarketplaces: { [M]: { autoUpdate: true }, [O]: { source: {} }, other: { source: {} } },
  };
  const out = stripDefaults(before);
  assert.ok(isStripped(out) && !isStripped(before));
  assert.equal(out.model, 'x');
  assert.deepEqual(out.env, { FOO: '1' });
  assert.equal(out.enabledPlugins!['a@b'], true);
  assert.equal(out.enabledPlugins!['agents-md@builtin'], false);
  assert.deepEqual(Object.keys(out.extraKnownMarketplaces!), [M, O]);
  assert.deepEqual(stripDefaults(out), out);
  assert.equal(before.enabledPlugins!['agents-md@builtin'], undefined);
});

test('reset keeps only our settings plus the dcg hook while dcg stays on', () => {
  const dcgEntry = { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: '/home/me/.local/bin/dcg' }] };
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] };
  const before: Settings = {
    model: 'x',
    permissions: { allow: ['Bash(ls)'] },
    hooks: { PreToolUse: [other, dcgEntry], Stop: [other] },
    enabledPlugins: { [`dead-skills@${M}`]: true, [`code-review@${O}`]: true, 'x@other': true },
    extraKnownMarketplaces: {
      [O]: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } },
      other: {},
    },
  };
  const out = resetSettings(before, { ...V, statusLine: true, sandbox: false, dcg: true });
  assert.equal(out.model, undefined);
  assert.deepEqual(out.permissions!.allow, ['Read(~/.claude/plugins/**)']);
  assert.deepEqual(out.hooks, { PreToolUse: [dcgEntry] });
  assert.equal(out.enabledPlugins![`dead-skills@${M}`], true);
  assert.equal(out.enabledPlugins![`code-review@${O}`], true);
  assert.deepEqual(Object.keys(out.extraKnownMarketplaces!), [M, O]);
  assert.equal(out.enabledPlugins!['x@other'], undefined);
  assert.ok(isStripped(out));
  assert.equal(resetSettings(before, { ...V, dcg: false }).hooks, undefined);
  assert.deepEqual(resetSettings(out, { ...V, statusLine: true, sandbox: false, dcg: true }), out);
});

test('settings changes: invalid JSON is never written, unchanged is null, line endings are kept', () => {
  const add = (s: Settings) => ({ ...s, a: 1 });
  assert.equal(settingsChange('{"model": "x",}', add), undefined);
  assert.equal(settingsChange('{"a": 1}', add), null);
  const crlf = settingsChange('{\r\n  "model": "x"\r\n}\r\n', add)!;
  assert.deepEqual(crlf.changed, ['a']);
  assert.equal(crlf.text, '{\r\n  "model": "x",\r\n  "a": 1\r\n}\r\n');
  assert.equal(settingsText('{}', { a: 1 }), '{\n  "a": 1\n}\n');
});

test('clean never targets credentials, plugins or project memory', () => {
  for (const keep of ['.credentials.json', 'plugins', 'projects', 'settings.json', 'keybindings.json']) {
    assert.ok(!CLEAN_TARGETS.includes(keep));
  }
});

test('isShipped matches shipped configs up to whitespace, not customized ones', () => {
  const stock = shippedText('../assets/ccstatusline.json');
  const nc = shippedText('../assets/ccstatusline-night-city.json');
  const all = [stock, nc];
  assert.equal(isShipped(stock, all), true);
  assert.equal(isShipped(nc, all), true);
  assert.equal(isShipped(JSON.stringify(JSON.parse(stock)), all), true);
  assert.equal(isShipped(JSON.stringify({ ...JSON.parse(stock), flexMode: 'full' }), all), false);
  assert.equal(isShipped('not json', all), false);
});

// Night City adds icons, a context bar and a sign, but shows every stock value, in the same order (git changes split
// into insertions and deletions).
test('Night City ccstatusline keeps the stock widgets in order', () => {
  const split: Record<string, string | null> = { 'git-insertions': 'git-changes', 'git-deletions': null };
  const types = (f: string): string[][] =>
    JSON.parse(shippedText(f)).lines.map((l: { type: string }[]) =>
      l.map((w) => (w.type in split ? split[w.type] : w.type)).filter((t) => t !== null),
    );
  const nc = types('../assets/ccstatusline-night-city.json');
  types('../assets/ccstatusline.json').forEach((stock, i) =>
    assert.deepEqual(
      nc[i].filter((t) => stock.includes(t)),
      stock.filter((t) => t !== 'separator'),
    ),
  );
});

test('Night City settings are always on, next to other env, and leave the theme alone', () => {
  const out = mergeSettings({ env: { FOO: 'x' }, theme: 'dark' }, V);
  assert.deepEqual(out.env, { FOO: 'x', CLAUDE_CODE_TMUX_TRUECOLOR: '1' });
  assert.equal(out.syntaxHighlightingDisabled, true);
  assert.equal(out.theme, 'dark');
});

test('Night City picked while it was its own plugin stays picked now that dead-skills ships it', () => {
  assert.equal(mergeSettings({ theme: 'custom:night-city:night-city' }, V).theme, 'custom:dead-skills:night-city');
});

test('the built-in notification is always off, since dead-skills raises its own', () => {
  assert.equal(mergeSettings({}, V).preferredNotifChannel, 'notifications_disabled');
  assert.equal(mergeSettings({ preferredNotifChannel: 'kitty' }, V).preferredNotifChannel, 'notifications_disabled');
});

test('web builtins: tri-state merge keeps other denies, toggle reads deny', () => {
  const base: Settings = { permissions: { deny: ['Bash(sudo:*)'] } };
  const off = mergeSettings(base, { ...V, webBuiltinsOff: true });
  assert.ok(['Bash(sudo:*)', 'WebFetch', 'WebSearch'].every((d) => off.permissions!.deny!.includes(d)));
  assert.ok(isWebBuiltinsOff(off));
  assert.deepEqual(mergeSettings(off, { ...V, webBuiltinsOff: true }), off);
  assert.deepEqual(mergeSettings(off, V).permissions!.deny, off.permissions!.deny);
  const back = mergeSettings(off, { ...V, webBuiltinsOff: false });
  const denied = back.permissions!.deny!;
  assert.ok(!denied.includes('WebFetch') && !denied.includes('WebSearch'));
  assert.ok(denied.includes('Bash(sudo:*)'));
  assert.ok(!isWebBuiltinsOff(back));
  assert.ok(!isWebBuiltinsOff({ permissions: { deny: ['WebFetch'] } }));
  assert.ok(TOGGLES.includes('web-builtins-off') && HINTS['web-builtins-off']);
});

test('web builtins decision table', () => {
  for (const was of [true, false]) {
    assert.equal(webBuiltinsDecision({ toggle: true, was, healthy: true, installed: true }), true);
    assert.equal(webBuiltinsDecision({ toggle: true, was, healthy: false }), undefined);
  }
  assert.equal(webBuiltinsDecision({ toggle: false, was: true, healthy: true, installed: true }), false);
  assert.equal(webBuiltinsDecision({ toggle: false, was: true, healthy: false, installed: true }), false);
  assert.equal(webBuiltinsDecision({ toggle: false, was: false, healthy: true }), undefined);
  assert.equal(webBuiltinsDecision({ toggle: false, was: false, healthy: false }), undefined);
  // Hand-added denies of someone who never had web-mcp stay.
  assert.equal(webBuiltinsDecision({ toggle: false, was: true, healthy: false, installed: false }), undefined);
});

test('the restore hint is a command for the shell of the platform', () => {
  assert.equal(
    restoreHint('linux', '/home/me/.claude.dead-backup-x', '/home/me/.claude'),
    "cp -a '/home/me/.claude.dead-backup-x/.' '/home/me/.claude/'",
  );
  assert.equal(
    restoreHint('win32', "C:\\Users\\O'Brien\\.claude.dead-backup-x", "C:\\Users\\O'Brien\\.claude"),
    "Copy-Item -Recurse -Force 'C:\\Users\\O''Brien\\.claude.dead-backup-x\\*' 'C:\\Users\\O''Brien\\.claude'",
  );
});
