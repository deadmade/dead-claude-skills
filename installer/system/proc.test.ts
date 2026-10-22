import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claude, onPath, safeArg } from './proc.ts';

const M = 'dead-claude-skills';
const WIN = process.platform === 'win32';

test('safeArg rejects shell metacharacters', () => {
  assert.equal(safeArg(`graphify@${M}`), `graphify@${M}`);
  for (const bad of ['a&b', '%PATH%', 'a"b', 'a b']) assert.throws(() => safeArg(bad));
});

test(
  'claude() runs the claude on PATH, never one planted in the current folder',
  {
    skip: !onPath('claude') && 'claude is not on PATH',
    todo: WIN && 'fixed in step 3: cmd.exe looks in the current folder first',
  },
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
