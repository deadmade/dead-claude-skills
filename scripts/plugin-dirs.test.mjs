import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDirs } from './plugin-dirs.mjs';

const ROOT = join(import.meta.dirname, '..');

test('a GROUPS folder is replaced by its subfolders', () => {
  const fx = mkdtempSync(join(tmpdir(), 'pd-'));
  for (const d of ['a', 'languages/x', 'languages/y']) mkdirSync(join(fx, 'plugins', d), { recursive: true });
  assert.deepEqual(pluginDirs(fx), ['plugins/a', 'plugins/languages/x', 'plugins/languages/y']);
});

test('the real repo lists cswap but not the grouping folder', () => {
  const dirs = pluginDirs(ROOT);
  assert.ok(dirs.includes('plugins/cswap'));
  assert.ok(!dirs.includes('plugins/languages'));
});
