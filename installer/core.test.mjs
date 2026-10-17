import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  optIns,
  needsToken,
  planPlugins,
  duplicates,
  mergeSettings,
  isShipped,
  NIGHT_CITY_THEME,
  safeArg,
  missingBinaries,
  agentBrowserAction,
  agentBrowserVersion,
  SECRET_DENIES,
  isSandboxOn,
  hasDcgHook,
  dcgCommand,
  bundleIds,
  foreignPlugins,
  retiredPlugins,
  foreignMarketplaces,
  stripDefaults,
  isStripped,
  resetSettings,
  CLEAN_TARGETS,
  marketplaceArg,
  pinMarketplace,
  settingsChange,
  settingsText,
  cswapDownload,
  cswapCurrent,
  pathWith,
  BIN_PLUGINS,
  binAsset,
  sha256Of,
  binAction,
  CATEGORIES,
  TOGGLES,
  categorize,
  unavailable,
  searxngRun,
  searxngSettings,
  webBuiltinsDecision,
  isWebBuiltinsOff,
  HINTS,
  outdated,
  shippedVersions,
  manifestPath,
} from './core.mjs';

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const marketplace = json('.claude-plugin/marketplace.json');
const bundle = json('plugins/dead-skills/.claude-plugin/plugin.json');
const M = 'dead-claude-skills';
const O = 'claude-plugins-official';

test('opt-ins from the real manifests', () => {
  assert.deepEqual(
    optIns(marketplace, bundle).sort(),
    [
      ...[
        'atlassian',
        'csharp-skills',
        'cswap',
        'feature-flow',
        'graphify',
        'hallmark',
        'mattpocock-picks',
        'mcp-azure',
        'mcp-github',
        'night-city',
        'nix-lsp',
        'notify',
        'paper-lookup',
        'postgres',
        'pstack-picks',
        'rust-skills',
        'self-review',
        'tob-picks',
        'tui-review',
        'web-mcp',
      ].map((n) => `${n}@${M}`),
      ...['csharp-lsp', 'hookify', 'pyright-lsp', 'rust-analyzer-lsp', 'skill-creator', 'typescript-lsp'].map(
        (n) => `${n}@${O}`,
      ),
    ].sort(),
  );
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
    duplicates(
      ['ponytail@ponytail', `ponytail@${M}`, `code-review@${O}`, `code-review@${M}`, 'other@x'],
      [`ponytail@${M}`, `code-review@${O}`],
    ),
    ['ponytail@ponytail', `code-review@${M}`],
  );
});

test('merge adds owned keys and keeps foreign ones', () => {
  const out = mergeSettings(
    { model: 'x', permissions: { allow: ['Bash(ls)'] } },
    { statusLine: true, version: '1.2.3' },
  );
  assert.equal(out.model, 'x');
  assert.deepEqual(out.permissions.allow, ['Bash(ls)', 'Read(~/.claude/plugins/**)']);
  assert.equal(out.extraKnownMarketplaces[M].autoUpdate, true);
  assert.equal(out.extraKnownMarketplaces[M].source.ref, 'v1.2.3');
  assert.match(out.statusLine.command, /ccstatusline/);
  assert.equal(out.cleanupPeriodDays, 36500);
  assert.equal(mergeSettings({ cleanupPeriodDays: 7 }, {}).cleanupPeriodDays, 7);
});

test('the marketplace is pinned to the installer version', () => {
  assert.equal(marketplaceArg('1.2.3'), 'deadmade/dead-claude-skills@v1.2.3');
  const pinned = { source: 'github', repo: 'deadmade/dead-claude-skills', ref: 'v1.2.3' };
  const before = {
    model: 'x',
    extraKnownMarketplaces: {
      [M]: { source: { source: 'github', repo: 'deadmade/dead-claude-skills' }, autoUpdate: true },
    },
  };
  const out = pinMarketplace(before, '1.2.3');
  assert.deepEqual(out.extraKnownMarketplaces[M], { source: pinned, autoUpdate: true });
  assert.equal(out.model, 'x');
  assert.equal(before.extraKnownMarketplaces[M].source.ref, undefined);
  // Unchanged settings come back as the same object, so nothing is written.
  assert.equal(pinMarketplace(out, '1.2.3'), out);
  assert.equal(pinMarketplace(out, '1.2.4').extraKnownMarketplaces[M].source.ref, 'v1.2.4');
  // No entry yet: the add writes it.
  const none = { model: 'x' };
  assert.equal(pinMarketplace(none, '1.2.3'), none);
});

test('merge is idempotent', () => {
  const once = mergeSettings({}, { statusLine: true });
  assert.deepEqual(mergeSettings(once, { statusLine: true }), once);
});

test('statusLine off removes ours, keeps a foreign one', () => {
  assert.equal(
    mergeSettings({ statusLine: { type: 'command', command: 'ccstatusline' } }, { statusLine: false }).statusLine,
    undefined,
  );
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
  assert.deepEqual(
    missingBinaries('linux', ['dead-skills'], () => true),
    [],
  );
});

test('secret denies are added once and keep existing ones', () => {
  const out = mergeSettings({ permissions: { deny: ['Bash(sudo:*)', 'Read(~/.ssh/**)'] } }, {});
  assert.deepEqual(out.permissions.deny, [
    'Bash(sudo:*)',
    'Read(~/.ssh/**)',
    ...SECRET_DENIES.filter((d) => d !== 'Read(~/.ssh/**)'),
  ]);
  assert.deepEqual(mergeSettings(out, {}), out);
});

test('sandbox on merges our keys, off removes only ours', () => {
  const on = mergeSettings({ sandbox: { excludedCommands: ['docker'] } }, { sandbox: true });
  assert.deepEqual(on.sandbox, {
    excludedCommands: ['docker'],
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
  });
  assert.ok(isSandboxOn(on));
  assert.deepEqual(mergeSettings(on, { sandbox: true }), on);
  assert.deepEqual(mergeSettings(on, { sandbox: false }).sandbox, { excludedCommands: ['docker'] });
  assert.equal(mergeSettings(mergeSettings({}, { sandbox: true }), { sandbox: false }).sandbox, undefined);
  assert.ok(!isSandboxOn({}));
});

test('dcg hook detection', () => {
  const hook = (command) => ({
    hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command }] }] },
  });
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
  assert.match(shArgs[1], /^set -o pipefail; curl /);
  assert.match(shArgs[1], /install\.sh' \| bash -s -- --verify$/);
  assert.match(dcgCommand('linux', 'uninstall')[1][1], /uninstall\.sh' \| bash -s -- --yes$/);
});

test('sandbox needs bubblewrap and socat', () => {
  const rows = missingBinaries('linux', ['sandbox'], () => false);
  assert.deepEqual(
    rows.map((r) => r.binary),
    ['bwrap', 'socat'],
  );
  assert.match(rows[0].command, /home\.packages: bubblewrap/);
});

test('foreign plugins and marketplaces spare ours and the official plugins we use', () => {
  assert.deepEqual(
    foreignPlugins([`ponytail@${M}`, `code-review@${O}`, `playwright@${O}`, 'x@y'], [`code-review@${O}`]),
    [`playwright@${O}`, 'x@y'],
  );
  assert.deepEqual(foreignMarketplaces([M, O, 'other']), ['other']);
});

test('retired plugins are ours but no longer in the marketplace', () => {
  const managed = [...bundleIds(bundle), ...optIns(marketplace, bundle)];
  assert.deepEqual(retiredPlugins([`dev-feature@${M}`, `cswap@${M}`, `code-review@${O}`, 'x@y'], managed), [
    `dev-feature@${M}`,
  ]);
});

test('strip disables defaults, keeps foreign keys, drops other marketplaces', () => {
  const before = {
    model: 'x',
    env: { FOO: '1' },
    enabledPlugins: { 'a@b': true },
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
    model: 'x',
    permissions: { allow: ['Bash(ls)'] },
    hooks: { PreToolUse: [other, dcgEntry], Stop: [other] },
    enabledPlugins: { [`dead-skills@${M}`]: true, [`code-review@${O}`]: true, 'x@other': true },
    extraKnownMarketplaces: {
      [O]: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } },
      other: {},
    },
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

test('settings changes: invalid JSON is never written, unchanged is null, line endings are kept', () => {
  const add = (s) => ({ ...s, a: 1 });
  assert.equal(settingsChange('{"model": "x",}', add), undefined);
  assert.equal(settingsChange('{"a": 1}', add), null);
  const crlf = settingsChange('{\r\n  "model": "x"\r\n}\r\n', add);
  assert.deepEqual(crlf.changed, ['a']);
  assert.equal(crlf.text, '{\r\n  "model": "x",\r\n  "a": 1\r\n}\r\n');
  assert.equal(settingsText('{}', { a: 1 }), '{\n  "a": 1\n}\n');
});

test('clean never targets credentials, plugins or project memory', () => {
  for (const keep of ['.credentials.json', 'plugins', 'projects', 'settings.json', 'keybindings.json']) {
    assert.ok(!CLEAN_TARGETS.includes(keep));
  }
});

test('cswap.exe download: Windows only, release asset of this version under LOCALAPPDATA', () => {
  const dl = cswapDownload('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, '1.2.3');
  assert.equal(dl.url, 'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/cswap.exe');
  assert.equal(dl.sha256Url, `${dl.url}.sha256`);
  assert.equal(dl.exe, 'C:\\Users\\me\\AppData\\Local\\Programs\\cswap\\cswap.exe');
  assert.equal(cswapDownload('linux', { LOCALAPPDATA: '/x' }, '1.2.3'), null);
  assert.equal(cswapDownload('win32', {}, '1.2.3'), null);
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
  assert.deepEqual(
    missingBinaries('linux', ['cswap'], () => false),
    [{ binary: 'cswap', command: 'uv tool install claude-swap' }],
  );
});

test('brv downloads the release archive built for this machine', () => {
  const win = binAsset('brv', 'win32', 'x64', '1.2.3');
  assert.equal(
    win.url,
    'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/brv-x86_64-pc-windows-msvc.zip',
  );
  assert.equal(win.sha256, `${win.url}.sha256`);
  assert.equal(win.exe, 'brv.exe');
  assert.equal(binAsset('brv', 'linux', 'x64', '1.0.0').file, 'brv-x86_64-unknown-linux-musl.tar.gz');
  assert.equal(binAsset('brv', 'linux', 'arm64', '1.0.0').file, 'brv-aarch64-unknown-linux-musl.tar.gz');
  assert.equal(binAsset('brv', 'darwin', 'arm64', '1.0.0').exe, 'brv');
  assert.equal(binAsset('brv', 'win32', 'arm64', '1.0.0'), undefined);
  assert.equal(binAsset('brv', 'freebsd', 'x64', '1.0.0'), undefined);
});

test('web-mcp downloads its own archive, and each plugin is configured under its own key', () => {
  const t = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
  };
  for (const [k, target] of Object.entries(t)) {
    const [platform, arch] = k.split('-');
    for (const name of ['brv', 'web-mcp']) {
      const a = binAsset(name, platform, arch, '1.2.3');
      assert.equal(a.file, `${name}-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`);
      assert.equal(a.exe, name + (platform === 'win32' ? '.exe' : ''));
    }
  }
  assert.equal(binAsset('web-mcp', 'linux', 'ia32', '1.0.0'), undefined);
  assert.deepEqual(BIN_PLUGINS['tui-review'], { name: 'brv', key: 'brvPath' });
  assert.deepEqual(BIN_PLUGINS['web-mcp'], { name: 'web-mcp', key: 'binPath' });
  for (const [plugin, { key }] of Object.entries(BIN_PLUGINS))
    assert.ok(json(`plugins/${plugin}/.claude-plugin/plugin.json`).userConfig[key], `${plugin} has userConfig ${key}`);
  assert.match(unavailable('web-mcp', 'linux', 'ia32', '1.0.0'), /no web-mcp build for linux-ia32/);
  assert.equal(unavailable('web-mcp', 'linux', 'x64', '1.0.0'), undefined);
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
  const at = (o) => binAction({ onPath: false, installed: undefined, version: '0.2.0', supported: true, ...o });
  assert.equal(at({ onPath: true }), 'skip');
  assert.equal(at({ installed: '0.2.0' }), 'configure');
  assert.equal(at({ installed: '0.1.0' }), 'download');
  assert.equal(at({}), 'download');
  assert.equal(at({ supported: false }), 'unsupported');
});

test('every opt-in and toggle is on exactly one page', () => {
  const keys = [...optIns(marketplace, bundle), ...TOGGLES];
  const pages = categorize(keys);
  assert.deepEqual(pages.flatMap((p) => p.keys).sort(), [...keys].sort());
  assert.ok(!pages.some((p) => p.id === 'other'), 'every real opt-in has a category');
  const listed = CATEGORIES.flatMap((c) => c.keys);
  assert.equal(new Set(listed).size, listed.length);
});

test('an uncategorized plugin lands in Other, empty pages are dropped', () => {
  const pages = categorize([`new-thing@${M}`, 'sandbox']);
  assert.deepEqual(
    pages.map((p) => [p.id, p.keys]),
    [
      ['system', ['sandbox']],
      ['other', [`new-thing@${M}`]],
    ],
  );
});

test('the language servers page is Languages and lists the language skills', () => {
  const lang = CATEGORIES.find((c) => c.id === 'lsp');
  assert.equal(lang.title, 'Languages');
  for (const k of ['csharp-skills', 'rust-skills', 'csharp-lsp', 'rust-analyzer-lsp']) assert.ok(lang.keys.includes(k));
});

test('the Databases page follows Languages and lists postgres', () => {
  const i = CATEGORIES.findIndex((c) => c.id === 'database');
  assert.ok(i > 0);
  assert.equal(CATEGORIES[i].title, 'Databases');
  assert.ok(CATEGORIES[i].keys.includes('postgres'));
  assert.equal(CATEGORIES[i - 1].id, 'lsp');
});

test('categorize keeps bulk:false on danger', () => {
  assert.equal(categorize(['strip-defaults', 'clean']).find((c) => c.id === 'danger').bulk, false);
});

test('options hidden per platform', () => {
  assert.equal(unavailable('sandbox', 'win32', 'x64', '1.0.0'), 'needs WSL2');
  assert.ok(unavailable(`nix-lsp@${M}`, 'win32', 'x64', '1.0.0'));
  assert.equal(unavailable(`tui-review@${M}`, 'win32', 'x64', '1.0.0'), undefined);
  assert.ok(unavailable(`tui-review@${M}`, 'win32', 'arm64', '1.0.0'));
  assert.equal(unavailable(`cswap@${M}`, 'win32', 'x64', '1.0.0'), undefined);
  assert.ok(unavailable(`cswap@${M}`, 'linux', 'x64', '1.0.0'));
  assert.ok(unavailable(`cswap@${M}`, 'darwin', 'arm64', '1.0.0'));
  for (const k of ['sandbox', `nix-lsp@${M}`, `tui-review@${M}`, 'dcg']) {
    assert.equal(unavailable(k, 'linux', 'x64', '1.0.0'), undefined);
    assert.equal(unavailable(k, 'darwin', 'arm64', '1.0.0'), undefined);
  }
});

test('outdated compares our shipped versions only, once per id, never downgrading', () => {
  const rows = [
    { id: `cswap@${M}`, version: '0.1.0', scope: 'user' },
    { id: `cswap@${M}`, version: '0.1.0', scope: 'project' },
    { id: `feature-flow@${M}`, version: '0.1.1' },
    { id: `graphify@${M}`, version: '29c78da38ecf' },
    { id: `hallmark@${M}`, version: '0.2.0' },
    { id: `superpowers@${M}`, version: '6.4.2' },
    { id: `code-review@${O}`, version: '1.0.0' },
  ];
  const shipped = {
    cswap: '0.1.1',
    'feature-flow': '0.1.1',
    graphify: '0.1.1',
    hallmark: '0.1.1',
    'code-review': '9.9.9',
  };
  assert.deepEqual(outdated(rows, shipped), [
    { id: `cswap@${M}`, from: '0.1.0', to: '0.1.1' },
    { id: `graphify@${M}`, from: '29c78da38ecf', to: '0.1.1' },
  ]);
});

test('shippedVersions counts pinned url plugins and skips unpinned ones', () => {
  const plugins = [
    { name: 'feature-flow', source: './plugins/feature-flow' },
    { name: 'nover', source: './plugins/nover' },
    {
      name: 'superpowers',
      source: { source: 'url', url: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0', sha: 'b'.repeat(40) },
    },
    { name: 'atlassian', source: { source: 'url', url: 'https://github.com/atlassian/atlassian-mcp-server.git' } },
  ];
  const shipped = shippedVersions(plugins, (src) => (src === './plugins/feature-flow' ? '0.1.1' : undefined));
  assert.deepEqual(shipped, { 'feature-flow': '0.1.1', superpowers: '7.0.0' });
  assert.deepEqual(outdated([{ id: `superpowers@${M}`, version: '6.4.2' }], shipped), [
    { id: `superpowers@${M}`, from: '6.4.2', to: '7.0.0' },
  ]);
});

test('manifestPath finds a local plugin manifest, null for url sources and unknown names', () => {
  const m = {
    plugins: [
      { name: 'rust-skills', source: './plugins/languages/rust-skills' },
      { name: 'superpowers', source: { source: 'url' } },
    ],
  };
  assert.equal(
    manifestPath(m, 'rust-skills@dead-claude-skills'),
    'plugins/languages/rust-skills/.claude-plugin/plugin.json',
  );
  assert.equal(manifestPath(m, 'superpowers@dead-claude-skills'), null);
  assert.equal(manifestPath(m, 'nope@dead-claude-skills'), null);
});

const shippedText = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('isShipped matches shipped configs up to whitespace, not customized ones', () => {
  const stock = shippedText('./ccstatusline.json');
  const nc = shippedText('./ccstatusline-night-city.json');
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
  const split = { 'git-insertions': 'git-changes', 'git-deletions': null };
  const types = (f) =>
    JSON.parse(shippedText(f)).lines.map((l) =>
      l.map((w) => (w.type in split ? split[w.type] : w.type)).filter((t) => t !== null),
    );
  const nc = types('./ccstatusline-night-city.json');
  types('./ccstatusline.json').forEach((stock, i) =>
    assert.deepEqual(
      nc[i].filter((t) => stock.includes(t)),
      stock.filter((t) => t !== 'separator'),
    ),
  );
});

test('nightCity false removes only the Night City theme', () => {
  const s = { theme: NIGHT_CITY_THEME };
  assert.equal(mergeSettings(s, { nightCity: false }).theme, undefined);
  assert.equal(mergeSettings({ theme: 'dark' }, { nightCity: false }).theme, 'dark');
  assert.equal(mergeSettings(s, { nightCity: true }).theme, NIGHT_CITY_THEME);
  assert.equal(mergeSettings(s, {}).theme, NIGHT_CITY_THEME);
});

test('nightCity turns tmux truecolor on next to other env, and deselecting it removes only that', () => {
  const on = mergeSettings({ env: { FOO: 'x' } }, { nightCity: true });
  assert.deepEqual(on.env, { FOO: 'x', CLAUDE_CODE_TMUX_TRUECOLOR: '1' });
  assert.deepEqual(mergeSettings(on, { nightCity: false }).env, { FOO: 'x' });
  assert.equal(mergeSettings({ env: { CLAUDE_CODE_TMUX_TRUECOLOR: '1' } }, { nightCity: false }).env, undefined);
  assert.deepEqual(mergeSettings({ env: { CLAUDE_CODE_TMUX_TRUECOLOR: '1' } }, {}).env, {
    CLAUDE_CODE_TMUX_TRUECOLOR: '1',
  });
});

test('nightCity turns syntax highlighting off, and deselecting it turns it back on', () => {
  assert.equal(mergeSettings({}, { nightCity: true }).syntaxHighlightingDisabled, true);
  assert.equal(
    mergeSettings({ syntaxHighlightingDisabled: true }, { nightCity: false }).syntaxHighlightingDisabled,
    undefined,
  );
  assert.equal(mergeSettings({ syntaxHighlightingDisabled: true }, {}).syntaxHighlightingDisabled, true);
  assert.equal(mergeSettings({}, {}).syntaxHighlightingDisabled, undefined);
});

test('notify turns the built-in notification off, and deselecting restores it', () => {
  const channel = (s, notify) => mergeSettings(s, { notify }).preferredNotifChannel;
  assert.equal(channel({}, true), 'notifications_disabled');
  assert.equal(channel({ preferredNotifChannel: 'notifications_disabled' }, false), undefined);
  assert.equal(channel({ preferredNotifChannel: 'kitty' }, false), 'kitty');
  assert.equal(channel({ preferredNotifChannel: 'kitty' }, true), 'notifications_disabled');
});

test('searxng binds loopback, mounts the config dir and takes the secret', () => {
  const args = searxngRun('/c/searxng');
  assert.ok(args.includes('127.0.0.1:8888:8080'));
  assert.ok(args.includes('/c/searxng:/etc/searxng/'));
  const tpl = readFileSync(new URL('./searxng.yml', import.meta.url), 'utf8');
  const out = searxngSettings(tpl, 'abc123');
  assert.match(out, /secret_key: "abc123"/);
  assert.doesNotMatch(out, /changeme/);
  assert.match(out, /- json/);
  assert.match(out, /name: bing\n\s+disabled: false/);
  for (const e of ['duckduckgo', 'brave', 'google cse'])
    assert.match(out, new RegExp(`name: ${e}\\n\\s+disabled: true`));
});

test('web builtins: tri-state merge keeps other denies, toggle reads deny', () => {
  const base = { permissions: { deny: ['Bash(sudo:*)'] } };
  const off = mergeSettings(base, { webBuiltinsOff: true });
  assert.ok(['Bash(sudo:*)', 'WebFetch', 'WebSearch'].every((d) => off.permissions.deny.includes(d)));
  assert.ok(isWebBuiltinsOff(off));
  assert.deepEqual(mergeSettings(off, { webBuiltinsOff: true }), off);
  assert.deepEqual(mergeSettings(off, {}).permissions.deny, off.permissions.deny);
  const back = mergeSettings(off, { webBuiltinsOff: false });
  assert.ok(!back.permissions.deny.includes('WebFetch') && !back.permissions.deny.includes('WebSearch'));
  assert.ok(back.permissions.deny.includes('Bash(sudo:*)'));
  assert.ok(!isWebBuiltinsOff(back));
  assert.ok(!isWebBuiltinsOff({ permissions: { deny: ['WebFetch'] } }));
  assert.ok(TOGGLES.includes('web-builtins-off') && HINTS['web-builtins-off']);
  assert.ok(missingBinaries('linux', ['web-mcp'], () => false).some((r) => r.binary === 'docker'));
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

test('agent-browser: install when missing, upgrade when older, keep when equal or newer', () => {
  const pinned = '0.39.1';
  assert.equal(agentBrowserAction({ installed: undefined, pinned }), 'install');
  assert.equal(agentBrowserAction({ installed: '0.38.0', pinned }), 'upgrade');
  assert.equal(agentBrowserAction({ installed: '0.39.1', pinned }), 'skip');
  assert.equal(agentBrowserAction({ installed: '0.40.0', pinned }), 'skip');
  assert.equal(agentBrowserVersion('agent-browser 0.39.1\n'), '0.39.1');
  assert.equal(agentBrowserVersion('nope'), undefined);
});
