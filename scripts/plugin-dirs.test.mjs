import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDirs } from './plugin-dirs.mjs';

const ROOT = join(import.meta.dirname, '..');

test('a GROUPS folder is replaced by its subfolders', () => {
  const fx = mkdtempSync(join(tmpdir(), 'pd-'));
  for (const d of ['a', 'default/z', 'opt-in/x', 'opt-in/y', 'shared/w']) {
    mkdirSync(join(fx, 'plugins', d, '.claude-plugin'), { recursive: true });
    writeFileSync(join(fx, 'plugins', d, '.claude-plugin', 'plugin.json'), '{}');
  }
  assert.deepEqual(pluginDirs(fx), [
    'plugins/a',
    'plugins/default/z',
    'plugins/opt-in/x',
    'plugins/opt-in/y',
    'plugins/shared/w',
  ]);
});

test('the real repo lists cswap but not the grouping folder', () => {
  const dirs = pluginDirs(ROOT);
  assert.ok(dirs.includes('plugins/opt-in/cswap'));
  assert.ok(!dirs.includes('plugins/opt-in'));
});

test('a folder without a plugin manifest is skipped, like an old group left behind by ignored build output', () => {
  const fx = mkdtempSync(join(tmpdir(), 'pd-'));
  mkdirSync(join(fx, 'plugins', 'a', '.claude-plugin'), { recursive: true });
  writeFileSync(join(fx, 'plugins', 'a', '.claude-plugin', 'plugin.json'), '{}');
  mkdirSync(join(fx, 'plugins', 'mods', 'tui-review', 'brv', 'target'), { recursive: true });
  mkdirSync(join(fx, 'plugins', 'shared', 'gone'), { recursive: true });
  assert.deepEqual(pluginDirs(fx), ['plugins/a']);
});
