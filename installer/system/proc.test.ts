import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { claude, onPath, safeArg, startSync, which } from './proc.ts';

const M = 'dead-claude-skills';
const WIN = process.platform === 'win32';

test('safeArg rejects shell metacharacters', () => {
  assert.equal(safeArg(`graphify@${M}`), `graphify@${M}`);
  for (const bad of ['a&b', '%PATH%', 'a"b', 'a b']) assert.throws(() => safeArg(bad));
});

test(
  'claude() runs the claude on PATH, never one planted in the current folder',
  { skip: !onPath('claude') && 'claude is not on PATH' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcs-proc-'));
    writeFileSync(join(dir, WIN ? 'claude.cmd' : 'claude'), WIN ? '@echo planted\r\n' : '#!/bin/sh\necho planted\n', {
      mode: 0o755,
    });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const r = await claude(undefined, '--version');
      assert.ok(r.ok, r.err);
      assert.doesNotMatch(r.out, /planted/);
    } finally {
      process.chdir(cwd);
    }
  },
);

// A program that echoes its arguments, as Windows starts it (a .cmd, like npm's shims) or as a Linux script.
function echo(dir: string, name: string) {
  const file = join(dir, WIN ? `${name}.cmd` : name);
  writeFileSync(file, WIN ? '@echo %*\r\n' : '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
  return file;
}
function withPath<T>(path: string, f: () => T) {
  const before = process.env.PATH;
  process.env.PATH = path;
  try {
    return f();
  } finally {
    process.env.PATH = before;
  }
}

test('which finds programs on PATH only, never in the current folder or through a relative entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-which-'));
  const file = echo(dir, 'dcs-echo');
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.equal(
      withPath(['.', ''].join(delimiter), () => which('dcs-echo')),
      undefined,
    );
    assert.equal(
      withPath(dir, () => which('dcs-echo')),
      file,
    );
  } finally {
    process.chdir(cwd);
  }
});

test('which skips the extensionless sh script npm puts next to a .cmd shim', { skip: !WIN }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcs-which-'));
  writeFileSync(join(dir, 'dcs-echo'), '#!/bin/sh\n');
  const file = echo(dir, 'dcs-echo');
  assert.equal(
    withPath(dir, () => which('dcs-echo')),
    file,
  );
});

test('startSync runs a shim in a folder with spaces, passes its args, and warns about nothing', () => {
  const file = echo(mkdtempSync(join(tmpdir(), 'dcs proc ')), 'dcs-echo');
  const r = startSync(file, ['--allow-remote=root', 'https://example.com/v1.2.3/installer.tgz']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '--allow-remote=root https://example.com/v1.2.3/installer.tgz');
  assert.doesNotMatch(r.stderr, /DEP0190/);
});
