import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  optIns,
  needsToken,
  planPlugins,
  duplicates,
  bundleIds,
  foreignPlugins,
  retiredPlugins,
  foreignMarketplaces,
  outdated,
  shippedVersions,
  manifestPath,
  INCLUDED,
  idOf,
  withDependencies,
  BUNDLE,
  type Marketplace,
  type PluginJson,
} from './plugins.ts';

const json = (p: string) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const marketplace: Marketplace = json('.claude-plugin/marketplace.json');
const bundle: PluginJson & { dependencies: string[] } = json(manifestPath(marketplace, BUNDLE)!);
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
        'flows',
        'graphify',
        'hallmark',
        'mattpocock-picks',
        'mcp-azure',
        'mcp-github',
        'md-pane',
        'nix-lsp',
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
  assert.equal(needsToken(json('plugins/opt-in/mcp/mcp-github/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/opt-in/mcp/mcp-azure/.claude-plugin/plugin.json')), true);
  assert.equal(needsToken(json('plugins/shared/graphify/.claude-plugin/plugin.json')), false);
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

test('install.ts finds plugin folders through the marketplace, never by a literal plugins/ path', () => {
  const src = readFileSync(new URL('../install.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /join\(PKG, 'plugins'/);
});

test('withDependencies adds opt-in dependencies transitively, once, and nothing for unselected plugins', () => {
  const deps: Record<string, string[]> = { a: ['b', 'bundled'], b: ['c', 'a'], x: ['y'] };
  const opts = ['a', 'b', 'c', 'x', 'y'];
  assert.deepEqual(
    withDependencies(['a'], (id) => deps[id], opts),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    withDependencies([], (id) => deps[id], opts),
    [],
  );
});

test('flows brings every INCLUDED plugin, and its dependencies are marketplace or official plugins', () => {
  const flows = json('plugins/flows/.claude-plugin/plugin.json').dependencies.map(idOf);
  for (const n of INCLUDED) assert.ok(flows.includes(`${n}@${M}`), `${n} comes with flows`);
  for (const id of flows) {
    const [name, from] = id.split('@');
    assert.ok(from === O || marketplace.plugins.some((p) => p.name === name), id);
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
      { name: 'rust-skills', source: './plugins/opt-in/implementation/rust-skills' },
      { name: 'superpowers', source: { source: 'url' } },
    ],
  };
  assert.equal(
    manifestPath(m, 'rust-skills@dead-claude-skills'),
    'plugins/opt-in/implementation/rust-skills/.claude-plugin/plugin.json',
  );
  assert.equal(manifestPath(m, 'superpowers@dead-claude-skills'), null);
  assert.equal(manifestPath(m, 'nope@dead-claude-skills'), null);
});
