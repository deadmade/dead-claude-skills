import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The step reads CONFIG when it loads, so each case runs it in its own node, with an empty PATH (no uv).
function applyProse(config: string, args: { toggle: boolean; flows: boolean; unticked: boolean }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
  const step = new URL('./prose.ts', import.meta.url).href;
  const script = `const m = await import(${JSON.stringify(step)}); await m.applyProse(${JSON.stringify(args)});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...env, PATH: '', CLAUDE_CONFIG_DIR: config },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
}

test('a sync decision removes the opt-out marker, even with uv missing', () => {
  const config = mkdtempSync(join(tmpdir(), 'dcs-prose-'));
  writeFileSync(join(config, 'flows-prose.off'), '');
  applyProse(config, { toggle: true, flows: true, unticked: false });
  assert.ok(!existsSync(join(config, 'flows-prose.off')));
});

test('turning prose off removes a flows-prose folder that has no Python yet, and unticking writes the marker', () => {
  const config = mkdtempSync(join(tmpdir(), 'dcs-prose-'));
  mkdirSync(join(config, 'flows-prose', 'cache'), { recursive: true });
  applyProse(config, { toggle: false, flows: true, unticked: true });
  assert.ok(!existsSync(join(config, 'flows-prose')));
  assert.ok(existsSync(join(config, 'flows-prose.off')));
});
