import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceArg, installerUrl, newerInstaller, pinMarketplace } from './release.ts';
import { type Settings } from './settings.ts';

const M = 'dead-claude-skills';

test('the marketplace is pinned to the installer version', () => {
  assert.equal(marketplaceArg('1.2.3'), 'deadmade/dead-claude-skills@v1.2.3');
  assert.equal(
    installerUrl('1.2.3'),
    'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/installer.tgz',
  );
  assert.equal(newerInstaller(installerUrl('1.10.0'), '1.9.9'), '1.10.0');
  for (const location of [installerUrl('1.2.3'), installerUrl('1.2.2'), null, 'https://example.com/v9.0.0/x.tgz'])
    assert.equal(newerInstaller(location, '1.2.3'), undefined);
  const pinned = { source: 'github', repo: 'deadmade/dead-claude-skills', ref: 'v1.2.3' };
  const before: Settings = {
    model: 'x',
    extraKnownMarketplaces: {
      [M]: { source: { source: 'github', repo: 'deadmade/dead-claude-skills' }, autoUpdate: true },
    },
  };
  const out = pinMarketplace(before, '1.2.3');
  assert.deepEqual(out.extraKnownMarketplaces![M], { source: pinned, autoUpdate: true });
  assert.equal(out.model, 'x');
  assert.equal(before.extraKnownMarketplaces![M].source!.ref, undefined);
  // Unchanged settings come back as the same object, so nothing is written.
  assert.equal(pinMarketplace(out, '1.2.3'), out);
  assert.equal(pinMarketplace(out, '1.2.4').extraKnownMarketplaces![M].source!.ref, 'v1.2.4');
  // No entry yet: the add writes it.
  const none = { model: 'x' };
  assert.equal(pinMarketplace(none, '1.2.3'), none);
});
