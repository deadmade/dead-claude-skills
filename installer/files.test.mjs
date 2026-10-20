import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, clearTargets, replaceFile, writeSearxng } from './files.mjs';

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

test('searxng settings are written once, the first secret stays', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sx-')), 'searxng');
  assert.equal(writeSearxng(dir, 'secret_key: "x"\n', 'one'), true);
  assert.equal(writeSearxng(dir, 'secret_key: "x"\n', 'two'), false);
  assert.equal(readFileSync(join(dir, 'settings.yml'), 'utf8'), 'secret_key: "one"\n');
});

test('replaceFile replaces or creates the target, and puts the old one back when the rename fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-replace-'));
  const [target, staged] = [join(dir, 'tool.exe'), join(dir, 'staged')];
  for (const win of [false, true]) {
    writeFileSync(target, 'old');
    writeFileSync(staged, 'new');
    replaceFile(staged, target, win);
    assert.equal(readFileSync(target, 'utf8'), 'new');
    assert.throws(() => replaceFile(join(dir, 'missing'), target, win));
    assert.equal(readFileSync(target, 'utf8'), 'new');
  }
  rmSync(target);
  writeFileSync(staged, 'first');
  replaceFile(staged, target, true);
  assert.equal(readFileSync(target, 'utf8'), 'first');
  assert.deepEqual(readdirSync(dir), ['tool.exe']);
});
