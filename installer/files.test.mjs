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
import { backup, clearTargets, replaceBin, writeSearxng } from './files.mjs';

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

test('replaceBin: swaps in the staged binary, sweeps old leftovers, and restores the old one when the swap fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-bin-'));
  const bin = join(dir, 'tool');
  writeFileSync(bin, 'v1');
  writeFileSync(`${bin}.old-1`, 'leftover');
  writeFileSync(`${bin}.tmp`, 'v2');
  replaceBin(`${bin}.tmp`, bin, true);
  assert.equal(readFileSync(bin, 'utf8'), 'v2');
  assert.ok(!existsSync(`${bin}.old-1`) && !existsSync(`${bin}.tmp`));
  // A staged file that can't be moved in (here: missing) must leave the old binary in place.
  assert.throws(() => replaceBin(`${bin}.gone`, bin, true));
  assert.equal(readFileSync(bin, 'utf8'), 'v2');
  assert.ok(!existsSync(`${bin}.old-${process.pid}`));
});

test('replaceBin: a first install, the in-place swap (Linux), and a sweep that keeps other files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-bin-'));
  const bin = join(dir, 'tool');
  writeFileSync(`${bin}.tmp`, 'v1');
  replaceBin(`${bin}.tmp`, bin, true);
  assert.equal(readFileSync(bin, 'utf8'), 'v1');
  writeFileSync(join(dir, 'toolbox.old-1'), 'other binary');
  writeFileSync(`${bin}.tmp-9`, 'staged by someone else');
  writeFileSync(`${bin}.tmp`, 'v2');
  replaceBin(`${bin}.tmp`, bin, false);
  assert.equal(readFileSync(bin, 'utf8'), 'v2');
  assert.ok(existsSync(join(dir, 'toolbox.old-1')) && existsSync(`${bin}.tmp-9`));
  assert.throws(() => replaceBin(`${bin}.gone`, bin, false));
  assert.equal(readFileSync(bin, 'utf8'), 'v2');
});

test('replaceBin: a failed swap reports its own error, not the cleanup of the staged copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-bin-'));
  const bin = join(dir, 'tool');
  writeFileSync(bin, 'v1');
  // A non-empty directory can't be renamed onto a file, and a plain rmSync of it throws too.
  const staged = join(dir, 'staged');
  mkdirSync(staged);
  writeFileSync(join(staged, 'x'), '');
  assert.throws(
    () => replaceBin(staged, bin, false),
    (e) => e.syscall === 'rename',
  );
  assert.equal(readFileSync(bin, 'utf8'), 'v1');
});
