import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  missingBinaries,
  agentBrowserAction,
  agentBrowserAsset,
  agentBrowserPlan,
  agentBrowserVersion,
  cswapDownload,
  cswapCurrent,
  pathWith,
  BIN_PLUGINS,
  binAsset,
  sha256Of,
  sha256Matches,
  binAction,
} from './binaries.ts';
import { unavailable } from './options.ts';

const json = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

test('missing binaries per OS', () => {
  const none = () => false;
  assert.ok(!missingBinaries('linux', ['dead-skills'], none).some((r) => r.binary === 'nixd'));
  const win = missingBinaries('win32', ['nix-lsp'], none);
  assert.ok(win.some((r) => r.binary === 'nixd' && /deselect/.test(r.command)));
  const nix = missingBinaries('linux', ['nix-lsp', 'graphify'], none);
  assert.ok(nix.some((r) => r.binary === 'nixd' && /nixd/.test(r.command)));
  assert.ok(nix.some((r) => r.binary === 'graphify'));
  assert.deepEqual(
    missingBinaries('linux', ['dead-skills'], () => true),
    [],
  );
});

test('sandbox needs bubblewrap and socat', () => {
  const rows = missingBinaries('linux', ['sandbox'], () => false);
  assert.deepEqual(
    rows.map((r) => r.binary),
    ['bwrap', 'socat'],
  );
  assert.match(rows[0].command, /home\.packages: bubblewrap/);
});

test('cswap.exe download: Windows only, release asset of this version under LOCALAPPDATA', () => {
  const dl = cswapDownload('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, '1.2.3')!;
  assert.equal(dl.url, 'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/cswap.exe');
  assert.equal(dl.sha256Url, `${dl.url}.sha256`);
  assert.equal(dl.exe, 'C:\\Users\\me\\AppData\\Local\\Programs\\cswap\\cswap.exe');
  assert.equal(cswapDownload('linux', { LOCALAPPDATA: '/x' }, '1.2.3'), null);
  assert.equal(cswapDownload('win32', {}, '1.2.3'), null);
});

test('cswap pin matches --version output and is a stable tag', () => {
  assert.equal(cswapCurrent('cswap 0.26.0\r\n', 'v0.26.0'), true);
  assert.equal(cswapCurrent('cswap 0.25.0', 'v0.26.0'), false);
  assert.match(json('installer/assets/cswap.json').upstream, /^v\d+\.\d+\.\d+$/);
});

test('user PATH gains the cswap folder once', () => {
  const dir = 'C:\\Users\\me\\AppData\\Local\\Programs\\cswap';
  assert.equal(pathWith('C:\\a;C:\\b', dir), `C:\\a;C:\\b;${dir}`);
  assert.equal(pathWith(`C:\\a;${dir.toUpperCase()}\\`, dir), null);
  assert.equal(pathWith('', dir), dir);
  assert.equal(pathWith(undefined, dir), dir);
});

test('cswap missing on Linux points at uv', () => {
  assert.deepEqual(
    missingBinaries('linux', ['cswap'], () => false),
    [{ binary: 'cswap', command: 'uv tool install claude-swap' }],
  );
});

test('tui-review downloads the release archive built for this machine', () => {
  const win = binAsset('tui-review', 'win32', 'x64', '1.2.3')!;
  assert.equal(
    win.url,
    'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/tui-review-x86_64-pc-windows-msvc.zip',
  );
  assert.equal(win.sha256, `${win.url}.sha256`);
  assert.equal(win.exe, 'tui-review.exe');
  assert.equal(binAsset('tui-review', 'linux', 'x64', '1.0.0')!.file, 'tui-review-x86_64-unknown-linux-musl.tar.gz');
  for (const [platform, arch] of [
    ['linux', 'arm64'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'arm64'],
  ])
    assert.equal(binAsset('tui-review', platform, arch, '1.0.0'), undefined, `no build for ${platform}-${arch}`);
  assert.equal(binAsset('tui-review', 'freebsd', 'x64', '1.0.0'), undefined);
});

test('web-mcp downloads its own archive, and each plugin is configured under its own key', () => {
  const t = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-musl',
  };
  for (const [k, target] of Object.entries(t)) {
    const [platform, arch] = k.split('-');
    for (const name of ['tui-review', 'web-mcp']) {
      const a = binAsset(name, platform, arch, '1.2.3')!;
      assert.equal(a.file, `${name}-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`);
      assert.equal(a.exe, name + (platform === 'win32' ? '.exe' : ''));
    }
  }
  assert.equal(binAsset('web-mcp', 'linux', 'ia32', '1.0.0'), undefined);
  assert.deepEqual(BIN_PLUGINS['tui-review'], { name: 'tui-review', key: 'binPath' });
  assert.deepEqual(BIN_PLUGINS['web-mcp'], { name: 'web-mcp', key: 'binPath' });
  const dirs: Record<string, string> = {
    'tui-review': 'plugins/shared/tui-review',
    'web-mcp': 'plugins/shared/web-mcp',
  };
  for (const [plugin, { key }] of Object.entries(BIN_PLUGINS))
    assert.ok(json(`${dirs[plugin]}/.claude-plugin/plugin.json`).userConfig[key], `${plugin} has userConfig ${key}`);
  assert.match(unavailable('web-mcp', 'linux', 'ia32', '1.0.0')!, /no web-mcp build for linux-ia32/);
  assert.equal(unavailable('web-mcp', 'linux', 'x64', '1.0.0'), undefined);
  assert.match(unavailable('web-mcp', 'darwin', 'arm64', '1.0.0')!, /no web-mcp build for darwin-arm64/);
});

test('tui-review versions match the release the installer fetches', () => {
  const cargo = readFileSync(new URL('../../crates/tui-review/Cargo.toml', import.meta.url), 'utf8');
  assert.equal(/^version = "(.+)"/m.exec(cargo)![1], json('package.json').version);
});

test('tui-review checksum lines and what to do about tui-review', () => {
  const hex = 'AB'.repeat(32);
  assert.equal(sha256Of(`${hex}  tui-review-x.tar.gz\n`), hex.toLowerCase());
  assert.equal(sha256Of(`${hex}`), hex.toLowerCase());
  assert.equal(sha256Of('Not Found'), undefined);
  assert.equal(sha256Of(`${hex}ff  x`), undefined);
  // sha256('abc'), the FIPS 180-2 test vector.
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.ok(sha256Matches(Buffer.from('abc'), abc));
  assert.ok(!sha256Matches(Buffer.from('abd'), abc));
  assert.ok(!sha256Matches(Buffer.from('abc'), undefined));
  const at = (o: { onPath?: boolean; installed?: string; supported?: boolean }) =>
    binAction({ onPath: false, installed: undefined, version: '0.2.0', supported: true, ...o });
  assert.equal(at({ onPath: true }), 'skip');
  assert.equal(at({ installed: '0.2.0' }), 'configure');
  assert.equal(at({ installed: '0.1.0' }), 'download');
  assert.equal(at({}), 'download');
  assert.equal(at({ supported: false }), 'unsupported');
});

test('agent-browser: install when missing, upgrade when older, keep when equal or newer', () => {
  const pinned = '0.39.1';
  assert.equal(agentBrowserAction({ installed: undefined, pinned }), 'install');
  assert.equal(agentBrowserAction({ installed: '0.38.0', pinned }), 'upgrade');
  assert.equal(agentBrowserAction({ installed: '0.39.1', pinned }), 'skip');
  assert.equal(agentBrowserAction({ installed: '0.40.0', pinned }), 'skip');
  assert.equal(agentBrowserVersion('agent-browser 0.39.1\n'), '0.39.1');
  assert.equal(agentBrowserVersion('nope'), undefined);
});

test('agent-browser: the pinned upstream binary, only with a pinned hash', () => {
  const pin = JSON.parse(readFileSync(new URL('../assets/agent-browser.json', import.meta.url), 'utf8'));
  const linux = agentBrowserAsset('linux', 'x64', pin)!;
  assert.equal(
    linux.url,
    `https://github.com/vercel-labs/agent-browser/releases/download/v${pin.upstream}/agent-browser-linux-musl-x64`,
  );
  assert.equal(linux.digest, pin.sha256['linux-x64']);
  assert.equal(agentBrowserAsset('win32', 'x64', pin)!.exe, 'agent-browser.exe');
  assert.equal(agentBrowserAsset('darwin', 'arm64', pin), undefined);
  assert.equal(agentBrowserAsset('linux', 'x64', { ...pin, sha256: {} }), undefined);
  assert.equal(agentBrowserAsset('linux', 'x64', { ...pin, upstream: '1.0; rm' }), undefined);
  assert.ok(!missingBinaries('linux', ['web-mcp'], () => false).some((r) => r.binary === 'agent-browser'));
});

test('agent-browser plan: a current PATH copy wins, else ours, downloaded only when missing or older', () => {
  const pinned = '0.39.1';
  assert.deepEqual(agentBrowserPlan({ theirs: '0.39.1', ours: undefined, pinned }), { use: 'path' });
  assert.deepEqual(agentBrowserPlan({ theirs: '0.40.0', ours: '0.38.0', pinned }), { use: 'path' });
  assert.deepEqual(agentBrowserPlan({ theirs: '0.38.0', ours: '0.39.1', pinned }), { use: 'ours', download: 'skip' });
  assert.deepEqual(agentBrowserPlan({ theirs: undefined, ours: undefined, pinned }), {
    use: 'ours',
    download: 'install',
  });
  assert.deepEqual(agentBrowserPlan({ theirs: undefined, ours: '0.38.0', pinned }), {
    use: 'ours',
    download: 'upgrade',
  });
});
