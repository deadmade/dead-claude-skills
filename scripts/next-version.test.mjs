import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from './next-version.mjs';

test('bumps package.json when no tag is ahead of it', () => {
  assert.equal(nextVersion('0.6.0', ['v0.5.0', 'v0.6.0'], 'patch'), '0.6.1');
  assert.equal(nextVersion('0.6.0', [], 'minor'), '0.7.0');
  assert.equal(nextVersion('0.6.0', [], 'major'), '1.0.0');
});

test('counts from the highest tag when main lags behind it', () => {
  assert.equal(nextVersion('0.6.0', ['v0.6.9', 'v0.6.10', 'v0.6.2'], 'patch'), '0.6.11');
  assert.equal(nextVersion('0.6.0', ['v0.6.10'], 'minor'), '0.7.0');
});

test('ignores tags that are not vX.Y.Z', () => {
  assert.equal(nextVersion('0.6.0', ['v1.0.0-rc.1', 'latest', 'v9'], 'patch'), '0.6.1');
});

test('takes an exact version and rejects anything else', () => {
  assert.equal(nextVersion('0.6.0', [], '2.3.4'), '2.3.4');
  assert.equal(nextVersion('0.6.0', [], 'next'), undefined);
  assert.equal(nextVersion('0.6.0', [], undefined), undefined);
});
