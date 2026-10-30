import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide, findUv, lockHashOf, main, startArgs } from './launcher.mjs';

const json = (body) => ({ ok: true, json: async () => body });
const never = () => new Promise(() => {});

test('decide: off switch, same lock, other lock, no answer', () => {
  assert.equal(decide({ env: { HEADROOM_TRIM: 'off' }, health: { lock: 'a' }, lockHash: 'a' }), 'off');
  assert.equal(decide({ env: {}, health: { lock: 'a' }, lockHash: 'a' }), 'running');
  assert.equal(decide({ env: {}, health: { lock: 'b' }, lockHash: 'a' }), 'replace');
  assert.equal(decide({ env: {}, health: undefined, lockHash: 'a' }), 'start');
});

test('lockHashOf is the sha256 hex of the text', () => {
  assert.equal(lockHashOf('abc'), createHash('sha256').update('abc').digest('hex'));
});

test('findUv: config bin first, then the first absolute PATH entry, never a relative one', () => {
  const have = (...files) => (p) => files.includes(p);
  const config = 'C:\\cfg';
  assert.equal(
    findUv({ config, path: 'C:\\x', platform: 'win32', isFile: have('C:\\cfg\\bin\\uv.exe', 'C:\\x\\uv.exe') }),
    'C:\\cfg\\bin\\uv.exe',
  );
  assert.equal(
    findUv({ config, path: '.;C:\\y;C:\\x', platform: 'win32', isFile: have('.\\uv.exe', 'C:\\x\\uv.exe', 'C:\\y\\uv.exe') }),
    'C:\\y\\uv.exe',
  );
  assert.equal(findUv({ config, path: '.', platform: 'win32', isFile: () => true }), 'C:\\cfg\\bin\\uv.exe');
  assert.equal(findUv({ config, path: '.;rel', platform: 'win32', isFile: have('.\\uv.exe', 'rel\\uv.exe') }), undefined);
  assert.equal(findUv({ config: '/c', path: '/a:/b', platform: 'linux', isFile: have('/b/uv') }), '/b/uv');
});

test('startArgs builds uv run --locked with an absolute script and the venv in the data folder', () => {
  const r = startArgs({ uv: '/u/uv', serverDir: '/p/server', port: 47811, data: '/d', lock: 'hh' });
  assert.equal(r.cmd, '/u/uv');
  assert.deepEqual(r.args, [
    'run', '--locked', '--project', '/p/server', 'python', join('/p/server', 'server.py'),
    '--port', '47811', '--data', '/d', '--lock-hash', 'hh',
  ]);
  assert.equal(r.env.UV_PROJECT_ENVIRONMENT, join('/d', 'venv'));
});

function setup(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ht-root-'));
  const data = join(mkdtempSync(join(tmpdir(), 'ht-data-')), 'data');
  const calls = [];
  const spawned = [];
  const opts = {
    argv: ['47811'],
    env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: '/cfg', PATH: '' },
    fetch: async (url, init) => {
      calls.push([url, init?.method ?? 'GET']);
      throw new Error('down');
    },
    spawn: (cmd, args, o) => {
      const child = { unrefd: false, unref() { this.unrefd = true; }, on() {} };
      spawned.push({ cmd, args, o, child });
      return child;
    },
    readFile: () => 'lockfile text',
    isFile: () => true,
    ...over,
  };
  return { opts, calls, spawned, data };
}

test('main without uv writes one line to launcher.log, creating the data folder', async () => {
  const { opts, data, spawned } = setup({ isFile: () => false });
  await main(opts);
  const log = readFileSync(join(data, 'launcher.log'), 'utf8');
  assert.equal(log.trim().split('\n').length, 1);
  assert.match(log, /uv/);
  assert.equal(spawned.length, 0);
});

test('main returns within 400 ms when /health never answers', async () => {
  const { opts } = setup({ fetch: never });
  const t = Date.now();
  await main(opts);
  assert.ok(Date.now() - t < 400, `${Date.now() - t} ms`);
});

test('main spawns detached and hidden, and unrefs', async () => {
  const { opts, spawned } = setup();
  await main(opts);
  assert.equal(spawned.length, 1);
  const { o, child, cmd } = spawned[0];
  assert.equal(cmd, join('/cfg', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'));
  assert.equal(o.detached, true);
  assert.equal(o.windowsHide, true);
  assert.equal(o.stdio, 'ignore');
  assert.ok(o.env.UV_PROJECT_ENVIRONMENT);
  assert.equal(child.unrefd, true);
});

test('main does nothing when off or when the right server runs', async () => {
  const off = setup();
  off.opts.env.HEADROOM_TRIM = 'off';
  await main(off.opts);
  assert.equal(off.spawned.length, 0);
  assert.equal(off.calls.length, 0);
  const lock = lockHashOf('lockfile text');
  const run = setup({ fetch: async () => json({ ok: true, lock }) });
  await main(run.opts);
  assert.equal(run.spawned.length, 0);
});

test('main replaces an outdated server: shutdown, poll until gone, spawn, under 1.4 s', async () => {
  let down = false;
  const posts = [];
  const { opts, spawned } = setup({
    fetch: async (url, init) => {
      if (init?.method === 'POST') {
        posts.push(url);
        setTimeout(() => (down = true), 100);
        return { ok: true };
      }
      if (down) throw new Error('gone');
      return json({ ok: true, lock: 'old' });
    },
  });
  const t = Date.now();
  await main(opts);
  assert.ok(Date.now() - t < 1400);
  assert.deepEqual(posts, ['http://127.0.0.1:47811/shutdown']);
  assert.equal(spawned.length, 1);
});

test('main still spawns when the old server never goes away', async () => {
  const { opts, spawned } = setup({ fetch: async () => json({ ok: true, lock: 'old' }) });
  const t = Date.now();
  await main(opts);
  assert.ok(Date.now() - t < 1400, `${Date.now() - t} ms`);
  assert.equal(spawned.length, 1);
});

test('main never throws, and logs a spawn failure', async () => {
  const { opts, data } = setup({
    spawn: () => {
      throw new Error('boom');
    },
  });
  await main(opts);
  assert.ok(existsSync(join(data, 'launcher.log')));
  await main({ argv: [], env: {} });
});
