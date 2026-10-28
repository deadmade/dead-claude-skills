import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prosePython } from '../core/prose.ts';

const WIN = process.platform === 'win32';
const NEEDS_UV = "prose: needs uv on PATH; /copyedit runs without spaCy's measures until then";

type Args = { toggle: boolean; flows: boolean; expected: boolean };

// The step reads CONFIG when it loads, so each case runs it in its own node with PATH set to path (empty: no uv), and
// returns the summary's done and failed lines.
function applyProse(config: string, args: Args, { path = '', env = {} }: { path?: string; env?: object } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
  const step = new URL('./prose.ts', import.meta.url).href;
  const context = new URL('../context.ts', import.meta.url).href;
  const script = [
    `const m = await import(${JSON.stringify(step)});`,
    `const c = await import(${JSON.stringify(context)});`,
    `await m.applyProse(${JSON.stringify(args)});`,
    `console.log('\\n' + JSON.stringify({ done: c.done, failures: c.failures }));`,
  ].join(' ');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...base, ...env, PATH: path, CLAUDE_CONFIG_DIR: config },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { done: string[]; failures: string[] };
}

// A uv that records its environment as JSON to $FAKE_UV_ENV and exits with $FAKE_UV_EXIT: a node script, started by its
// shebang on POSIX and by a .cmd (which() accepts .cmd) on Windows.
function fakeUv() {
  const bin = mkdtempSync(join(tmpdir(), 'dcs-uv-'));
  const js = [
    "process.getBuiltinModule('node:fs').writeFileSync(process.env.FAKE_UV_ENV, JSON.stringify(process.env));",
    'process.exit(Number(process.env.FAKE_UV_EXIT || 0));',
  ].join('\n');
  if (WIN) {
    writeFileSync(join(bin, 'uv.js'), js);
    writeFileSync(join(bin, 'uv.cmd'), `@"${process.execPath}" "${join(bin, 'uv.js')}" %*\r\n`);
  } else writeFileSync(join(bin, 'uv'), `#!${process.execPath}\n${js}\n`, { mode: 0o755 });
  return { bin, envFile: join(bin, 'env.json') };
}

const configDir = () => mkdtempSync(join(tmpdir(), 'dcs-prose-'));

test('a sync decision removes the opt-out marker and notes the missing uv', () => {
  const config = configDir();
  writeFileSync(join(config, 'flows-prose.off'), '');
  const r = applyProse(config, { toggle: true, flows: true, expected: false });
  assert.ok(!existsSync(join(config, 'flows-prose.off')));
  assert.deepEqual(r, { done: [NEEDS_UV], failures: [] });
});

test('turning prose off removes a flows-prose folder that has no Python yet, and unticking writes the marker', () => {
  const config = configDir();
  mkdirSync(join(config, 'flows-prose', 'cache'), { recursive: true });
  applyProse(config, { toggle: false, flows: true, expected: true });
  assert.ok(!existsSync(join(config, 'flows-prose')));
  assert.ok(existsSync(join(config, 'flows-prose.off')));
});

test('a toggle that stays on writes no marker', () => {
  const config = configDir();
  applyProse(config, { toggle: true, flows: true, expected: true });
  assert.ok(!existsSync(join(config, 'flows-prose.off')));
});

test("a marker that can't be written is a failure, not a crash", () => {
  const config = configDir();
  // A folder with a file in it where the marker goes: the rename onto it fails.
  mkdirSync(join(config, 'flows-prose.off', 'x'), { recursive: true });
  const r = applyProse(config, { toggle: false, flows: true, expected: true });
  assert.equal(r.failures.length, 1, JSON.stringify(r));
  assert.match(r.failures[0], /^prose: couldn't write .*flows-prose\.off: E[A-Z]+$/);
});

test('a failed uv sync is a failure with its exit code', () => {
  const config = configDir();
  const uv = fakeUv();
  const r = applyProse(
    config,
    { toggle: true, flows: true, expected: false },
    { path: uv.bin, env: { FAKE_UV_ENV: uv.envFile, FAKE_UV_EXIT: '3' } },
  );
  assert.deepEqual(r, { done: [], failures: ['prose: uv sync failed (exit 3)'] });
});

test("a sync that leaves no Python is the can't-load failure", () => {
  const config = configDir();
  const uv = fakeUv();
  const r = applyProse(
    config,
    { toggle: true, flows: true, expected: false },
    { path: uv.bin, env: { FAKE_UV_ENV: uv.envFile } },
  );
  assert.deepEqual(r.done, []);
  assert.equal(r.failures.length, 1, JSON.stringify(r));
  assert.match(r.failures[0], /^prose: spaCy can't load en_core_web_trf \(/);
});

test(
  "a sync whose Python loads the model is ready, with uv's files inside flows-prose",
  { skip: WIN && 'the fake Python would have to be an .exe' },
  () => {
    const config = configDir();
    const uv = fakeUv();
    const python = prosePython(config, process.platform);
    mkdirSync(dirname(python), { recursive: true });
    writeFileSync(python, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = applyProse(
      config,
      { toggle: true, flows: true, expected: false },
      { path: uv.bin, env: { FAKE_UV_ENV: uv.envFile } },
    );
    const dir = join(config, 'flows-prose');
    assert.deepEqual(r, { done: [`prose: spaCy and en_core_web_trf ready in ${dir}`], failures: [] });
    const env = JSON.parse(readFileSync(uv.envFile, 'utf8'));
    for (const k of ['UV_PROJECT_ENVIRONMENT', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR'])
      assert.ok(env[k]?.startsWith(dir), `${k}=${env[k]}`);
  },
);
