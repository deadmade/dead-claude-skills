import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  optIns, needsToken, planPlugins, duplicates, mergeSettings, safeArg, missingBinaries, SECRET_DENIES, isSandboxOn,
  hasDcgHook, dcgCommand, bundleIds, foreignPlugins, foreignMarketplaces, stripDefaults, isStripped, resetSettings, CLEAN_TARGETS,
  cswapDownload, cswapCurrent, pathWith, brvAsset, sha256Of, brvAction,
} from './core.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const marketplace = json('.claude-plugin/marketplace.json');
const bundle = json('plugins/dead-skills/.claude-plugin/plugin.json');
const M = 'dead-claude-skills';
const O = 'claude-plugins-official';

test('opt-ins from the real manifests', () => {
  assert.deepEqual(optIns(marketplace, bundle).sort(), [
    ...['atlassian', 'cswap', 'dev-feature', 'graphify', 'hallmark', 'mattpocock-picks', 'mcp-azure', 'mcp-github', 'nix-lsp',
      'pstack-picks', 'tui-review']
      .map((n) => `${n}@${M}`),
    ...['csharp-lsp', 'pyright-lsp', 'rust-analyzer-lsp', 'skill-creator', 'typescript-lsp'].map((n) => `${n}@${O}`),
  ].sort());
});

test('bundle ids resolve bare names to our marketplace', () => {
  const ids = bundleIds(bundle);
  assert.ok(ids.includes(`dead-skills@${M}`) && ids.includes(`superpowers@${M}`) && ids.includes(`code-review@${O}`));
});

test('token plugins', () => {
  assert.equal(needsToken(json('plugins/mcp-github/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/mcp-azure/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/graphify/.claude-plugin/plugin.json')), false);
});

test('select installs, deselect uninstalls, token plugins hand off', () => {
  const plan = planPlugins(
    [`graphify@${M}`, `mcp-github@${M}`, `pstack-picks@${M}`, `pyright-lsp@${O}`],
    [`pstack-picks@${M}`, `mattpocock-picks@${M}`, `mcp-azure@${M}`],
    [`mcp-github@${M}`, `mcp-azure@${M}`],
  );
  assert.deepEqual(plan.install, [`graphify@${M}`, `pyright-lsp@${O}`]);
  assert.deepEqual(plan.handoff, [`mcp-github@${M}`]);
  assert.deepEqual(plan.uninstall.sort(), [`mattpocock-picks@${M}`, `mcp-azure@${M}`]);
});

test('duplicates are managed names from the wrong marketplace', () => {
  assert.deepEqual(
    duplicates(['ponytail@ponytail', `ponytail@${M}`, `code-review@${O}`, `code-review@${M}`, 'other@x'],
      [`ponytail@${M}`, `code-review@${O}`]),
    ['ponytail@ponytail', `code-review@${M}`]);
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

test('foreign plugins and marketplaces spare ours and the official plugins we use', () => {
  assert.deepEqual(foreignPlugins([`ponytail@${M}`, `code-review@${O}`, `playwright@${O}`, 'x@y'], [`code-review@${O}`]),
    [`playwright@${O}`, 'x@y']);
  assert.deepEqual(foreignMarketplaces([M, O, 'other']), ['other']);
});

test('strip disables defaults, keeps foreign keys, drops other marketplaces', () => {
  const before = {
    model: 'x', env: { FOO: '1' }, enabledPlugins: { 'a@b': true },
    extraKnownMarketplaces: { [M]: { autoUpdate: true }, [O]: { source: {} }, other: { source: {} } },
  };
  const out = stripDefaults(before);
  assert.ok(isStripped(out) && !isStripped(before));
  assert.equal(out.model, 'x');
  assert.deepEqual(out.env, { FOO: '1' });
  assert.equal(out.enabledPlugins['a@b'], true);
  assert.equal(out.enabledPlugins['agents-md@builtin'], false);
  assert.deepEqual(Object.keys(out.extraKnownMarketplaces), [M, O]);
  assert.deepEqual(stripDefaults(out), out);
  assert.equal(before.enabledPlugins['agents-md@builtin'], undefined);
});

test('reset keeps only our settings plus the dcg hook while dcg stays on', () => {
  const dcgEntry = { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: '/home/me/.local/bin/dcg' }] };
  const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt.sh' }] };
  const before = {
    model: 'x', permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [other, dcgEntry], Stop: [other] },
    enabledPlugins: { [`dead-skills@${M}`]: true, [`code-review@${O}`]: true, 'x@other': true },
    extraKnownMarketplaces: { [O]: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } }, other: {} },
  };
  const out = resetSettings(before, { statusLine: true, sandbox: false, dcg: true });
  assert.equal(out.model, undefined);
  assert.deepEqual(out.permissions.allow, ['Read(~/.claude/plugins/**)']);
  assert.deepEqual(out.hooks, { PreToolUse: [dcgEntry] });
  assert.equal(out.enabledPlugins[`dead-skills@${M}`], true);
  assert.equal(out.enabledPlugins[`code-review@${O}`], true);
  assert.deepEqual(Object.keys(out.extraKnownMarketplaces), [M, O]);
  assert.equal(out.enabledPlugins['x@other'], undefined);
  assert.ok(isStripped(out));
  assert.equal(resetSettings(before, { dcg: false }).hooks, undefined);
  assert.deepEqual(resetSettings(out, { statusLine: true, sandbox: false, dcg: true }), out);
});

test('clean never targets credentials, plugins or project memory', () => {
  for (const keep of ['.credentials.json', 'plugins', 'projects', 'settings.json', 'keybindings.json']) {
    assert.ok(!CLEAN_TARGETS.includes(keep));
  }
});

test('cswap.exe download: Windows only, pinned release asset under LOCALAPPDATA', () => {
  const dl = cswapDownload('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'v0.26.0');
  assert.equal(dl.url, 'https://github.com/deadmade/dead-claude-skills/releases/download/cswap-v0.26.0/cswap.exe');
  assert.equal(dl.sha256Url, `${dl.url}.sha256`);
  assert.equal(dl.exe, 'C:\\Users\\me\\AppData\\Local\\Programs\\cswap\\cswap.exe');
  assert.equal(cswapDownload('linux', { LOCALAPPDATA: '/x' }, 'v0.26.0'), null);
  assert.equal(cswapDownload('win32', {}, 'v0.26.0'), null);
});

test('cswap pin matches --version output and is a stable tag', () => {
  assert.equal(cswapCurrent('cswap 0.26.0\r\n', 'v0.26.0'), true);
  assert.equal(cswapCurrent('cswap 0.25.0', 'v0.26.0'), false);
  assert.match(json('installer/cswap.json').upstream, /^v\d+\.\d+\.\d+$/);
});

test('user PATH gains the cswap folder once', () => {
  const dir = 'C:\\Users\\me\\AppData\\Local\\Programs\\cswap';
  assert.equal(pathWith('C:\\a;C:\\b', dir), `C:\\a;C:\\b;${dir}`);
  assert.equal(pathWith(`C:\\a;${dir.toUpperCase()}\\`, dir), null);
  assert.equal(pathWith('', dir), dir);
  assert.equal(pathWith(undefined, dir), dir);
});

test('cswap missing on Linux points at uv', () => {
  assert.deepEqual(missingBinaries('linux', ['cswap'], () => false), [{ binary: 'cswap', command: 'uv tool install claude-swap' }]);
});

test('brv downloads the release archive built for this machine', () => {
  const win = brvAsset('win32', 'x64', '0.2.0');
  assert.equal(win.url, 'https://github.com/deadmade/dead-claude-skills/releases/download/brv-v0.2.0/brv-x86_64-pc-windows-msvc.zip');
  assert.equal(win.sha256, `${win.url}.sha256`);
  assert.equal(win.exe, 'brv.exe');
  assert.equal(brvAsset('linux', 'x64', '1.0.0').file, 'brv-x86_64-unknown-linux-musl.tar.gz');
  assert.equal(brvAsset('linux', 'arm64', '1.0.0').file, 'brv-aarch64-unknown-linux-musl.tar.gz');
  assert.equal(brvAsset('darwin', 'arm64', '1.0.0').exe, 'brv');
  assert.equal(brvAsset('win32', 'arm64', '1.0.0'), undefined);
  assert.equal(brvAsset('freebsd', 'x64', '1.0.0'), undefined);
});

test('brv versions match the release the installer fetches', () => {
  const cargo = readFileSync(new URL('../plugins/tui-review/brv/Cargo.toml', import.meta.url), 'utf8');
  assert.equal(/^version = "(.+)"/m.exec(cargo)[1], json('plugins/tui-review/.claude-plugin/plugin.json').version);
});

test('brv checksum lines and what to do about brv', () => {
  const hex = 'AB'.repeat(32);
  assert.equal(sha256Of(`${hex}  brv-x.tar.gz\n`), hex.toLowerCase());
  assert.equal(sha256Of(`${hex}`), hex.toLowerCase());
  assert.equal(sha256Of('Not Found'), undefined);
  assert.equal(sha256Of(`${hex}ff  x`), undefined);
  const at = (o) => brvAction({ onPath: false, installed: undefined, version: '0.2.0', supported: true, ...o });
  assert.equal(at({ onPath: true }), 'skip');
  assert.equal(at({ installed: '0.2.0' }), 'configure');
  assert.equal(at({ installed: '0.1.0' }), 'download');
  assert.equal(at({}), 'download');
  assert.equal(at({ supported: false }), 'unsupported');
});
