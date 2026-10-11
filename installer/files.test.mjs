import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, clearTargets } from './files.mjs';

// A config dir with a skill, settings.json, a symlinked rules dir (home-manager) and a file clean never touches.
function config() {
  const root = mkdtempSync(join(tmpdir(), 'dcs-files-'));
  const cfg = join(root, '.claude');
  mkdirSync(join(cfg, 'skills', 'x'), { recursive: true });
  writeFileSync(join(cfg, 'skills', 'x', 'SKILL.md'), 'mine');
  writeFileSync(join(cfg, 'settings.json'), '{}');
  writeFileSync(join(cfg, '.credentials.json'), 'secret');
  mkdirSync(join(root, 'managed-rules'));
  symlinkSync(join(root, 'managed-rules'), join(cfg, 'rules'), 'dir');
  return { root, cfg };
}

test('clean slate: backup copies the targets, clear deletes them but keeps symlinks and credentials', () => {
  const { root, cfg } = config();
  const dest = join(root, 'backup');
  backup(cfg, dest);
  assert.equal(readFileSync(join(dest, 'skills', 'x', 'SKILL.md'), 'utf8'), 'mine');
  assert.ok(existsSync(join(dest, 'settings.json')));
  assert.ok(lstatSync(join(dest, 'rules')).isSymbolicLink());

  const out = clearTargets(cfg);
  assert.ok(!existsSync(join(cfg, 'skills')));
  assert.ok(lstatSync(join(cfg, 'rules')).isSymbolicLink());
  assert.ok(existsSync(join(root, 'managed-rules')));
  assert.ok(existsSync(join(cfg, '.credentials.json')));
  assert.ok(existsSync(join(cfg, 'settings.json')));
  assert.ok(out.some((l) => l.startsWith('deleted') && l.endsWith('skills')));
  assert.ok(out.some((l) => l.startsWith('kept') && l.includes('rules')));
});

test(
  'a failed backup throws, so nothing gets deleted',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  () => {
    const { root, cfg } = config();
    chmodSync(join(cfg, 'skills', 'x', 'SKILL.md'), 0o000);
    assert.throws(() => backup(cfg, join(root, 'backup')));
    chmodSync(join(cfg, 'skills', 'x', 'SKILL.md'), 0o644);
  },
);
