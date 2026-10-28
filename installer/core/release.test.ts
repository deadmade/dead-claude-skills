import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceArg, installerUrl, newerInstaller, pinMarketplace } from './release.ts';
import { type Settings } from './settings.ts';

const M = 'dead-claude-skills';

test('the marketplace follows its release branch; the installer comes from its own release', () => {
  assert.equal(marketplaceArg(), 'deadmade/dead-claude-skills@release');
  assert.equal(
    installerUrl('1.2.3'),
    'https://github.com/deadmade/dead-claude-skills/releases/download/v1.2.3/installer.tgz',
  );
  assert.equal(newerInstaller(installerUrl('1.10.0'), '1.9.9'), '1.10.0');
  for (const location of [installerUrl('1.2.3'), installerUrl('1.2.2'), null, 'https://example.com/v9.0.0/x.tgz'])
    assert.equal(newerInstaller(location, '1.2.3'), undefined);
  const pinned = { source: 'github', repo: 'deadmade/dead-claude-skills', ref: 'release' };
  for (const source of [
    { source: 'github', repo: 'deadmade/dead-claude-skills' },
    { source: 'github', repo: 'deadmade/dead-claude-skills', ref: 'v1.2.3' },
  ]) {
    const before: Settings = { model: 'x', extraKnownMarketplaces: { [M]: { source, autoUpdate: true } } };
    const out = pinMarketplace(before);
    assert.deepEqual(out.extraKnownMarketplaces![M], { source: pinned, autoUpdate: true });
    assert.equal(out.model, 'x');
    assert.deepEqual(before.extraKnownMarketplaces![M].source, source);
    // Unchanged settings come back as the same object, so nothing is written.
    assert.equal(pinMarketplace(out), out);
  }
  // No entry yet: the add writes it.
  const none = { model: 'x' };
  assert.equal(pinMarketplace(none), none);
});
