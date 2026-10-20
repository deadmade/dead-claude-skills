import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownParts } from './sync-ponytail.mjs';

const manifest = {
  name: 'ponytail',
  version: '5.3.2',
  description: '',
  author: {},
  hooks: [],
  types: '',
  userConfig: {},
};
const top = ['.claude-plugin', 'hooks', 'skills', 'LICENSE', 'README.md', 'assets'];

test('a manifest and tree like v5.3.2 have no unknown parts', () => {
  assert.deepEqual(unknownParts(manifest, top), []);
});

test('a new manifest key is an unknown part', () => {
  assert.deepEqual(unknownParts({ ...manifest, mcpServers: {} }, top), ['mcpServers']);
});

test('a new default component folder is an unknown part', () => {
  assert.deepEqual(unknownParts(manifest, [...top, 'agents']), ['agents']);
});
