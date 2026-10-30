import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide, findUv, identityOf, main, openServerLog, pluginVersion, serverEnv, startArgs } from './launcher.mjs';

const json = (body) => ({ ok: true, json: async () => body });
const never = () => new Promise(() => {});

test('decide: off switch, no answer, same identity, other identity by version', () => {
  const at = (lock, version) => ({ ok: true, lock, version });
  const d = (health) => decide({ env: {}, health, identity: 'a', version: '0.6.0' });
  assert.equal(
    decide({ env: { HEADROOM_TRIM: 'off' }, health: at('a', '0.6.0'), identity: 'a', version: '0.6.0' }),
    'off',
  );
  assert.equal(d(undefined), 'start');
  assert.equal(d(at('a', '0.6.0')), 'running');
  assert.equal(d(at('a', '0.7.0')), 'running');
  for (const [server, want] of [
    ['0.6.0', 'replace'], // same version, other code: a dev checkout
    ['0.5.9', 'replace'],
    ['0.5.10', 'replace'],
    [undefined, 'replace'], // a server from before /health reported a version
    ['0.6.1', 'running'], // a session started before a plugin update leaves the newer server alone
    ['0.10.0', 'running'],
    ['1.0.0', 'running'],
  ])
    assert.equal(d(at('b', server)), want, `server ${server}`);
});

function serverDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-srv-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test('identityOf hashes uv.lock, pyproject.toml and *.py by name, nothing else', () => {
  const base = { 'uv.lock': 'l', 'pyproject.toml': 'p', 'server.py': 's', 'trim.py': 't', 'guard.py': 'g' };
  const id = identityOf(serverDir(base));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(identityOf(serverDir(base)), id, 'deterministic');
  assert.equal(identityOf(serverDir({ ...base, 'README.md': 'x', 'notes.txt': 'y' })), id, 'other files ignored');
  for (const name of Object.keys(base)) assert.notEqual(identityOf(serverDir({ ...base, [name]: 'changed' })), id, name);
  assert.notEqual(identityOf(serverDir({ ...base, 'new.py': '' })), id, 'a new module counts');
  assert.notEqual(identityOf(serverDir({ ...base, 'guard.py': 'gs', 'server.py': '' })), id, 'bytes moved between files');
});

test('pluginVersion reads .claude-plugin/plugin.json, 0.0.0 without one', () => {
  const root = mkdtempSync(join(tmpdir(), 'ht-root-'));
  assert.equal(pluginVersion(root), '0.0.0');
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'headroom-trim', version: '1.2.3' }));
  assert.equal(pluginVersion(root), '1.2.3');
});

test('serverEnv drops UV_*, PYTHON* and VIRTUAL_ENV from the session, then adds ours', () => {
  const env = {
    PATH: '/bin',
    HOME: '/h',
    UV_PYTHON: '3.9',
    uv_index_url: 'x',
    UV_PROJECT_ENVIRONMENT: '/elsewhere',
    PYTHONPATH: '/p',
    PYTHONHOME: '/ph',
    PythonUtf8: '0',
    VIRTUAL_ENV: '/v',
    VIRTUAL_ENV_PROMPT: 'kept',
    MYUV_X: 'kept',
  };
  assert.deepEqual(serverEnv(env, { UV_PROJECT_ENVIRONMENT: '/d/venv' }), {
    PATH: '/bin',
    HOME: '/h',
    VIRTUAL_ENV_PROMPT: 'kept',
    MYUV_X: 'kept',
    UV_PROJECT_ENVIRONMENT: '/d/venv',
  });
});

test('findUv: config bin first, then the first absolute PATH entry, never a relative one', () => {
  const have =
    (...files) =>
    (p) =>
      files.includes(p);
  const config = 'C:\\cfg';
  assert.equal(
    findUv({ config, path: 'C:\\x', platform: 'win32', isFile: have('C:\\cfg\\bin\\uv.exe', 'C:\\x\\uv.exe') }),
    'C:\\cfg\\bin\\uv.exe',
  );
  assert.equal(
    findUv({
      config,
      path: '.;C:\\y;C:\\x',
      platform: 'win32',
      isFile: have('.\\uv.exe', 'C:\\x\\uv.exe', 'C:\\y\\uv.exe'),
    }),
    'C:\\y\\uv.exe',
  );
  assert.equal(findUv({ config, path: '.', platform: 'win32', isFile: () => true }), 'C:\\cfg\\bin\\uv.exe');
  assert.equal(findUv({ config, path: '.;rel', platform: 'win32', isFile: have('.\\uv.exe', 'rel\\uv.exe') }), undefined);
  assert.equal(findUv({ config: '/c', path: '/a:/b', platform: 'linux', isFile: have('/b/uv') }), '/b/uv');
});

test('startArgs builds uv run --locked with an absolute script, the identity and version, and the venv in data', () => {
  const r = startArgs({ uv: '/u/uv', serverDir: '/p/server', port: 47811, data: '/d', identity: 'hh', version: '0.6.0' });
  assert.equal(r.cmd, '/u/uv');
  assert.deepEqual(r.args, [
    'run',
    '--locked',
    '--project',
    '/p/server',
    'python',
    join('/p/server', 'server.py'),
    '--port',
    '47811',
    '--data',
    '/d',
    '--lock-hash',
    'hh',
    '--version',
    '0.6.0',
  ]);
  assert.deepEqual(r.env, { UV_PROJECT_ENVIRONMENT: join('/d', 'venv'), PYTHONDONTWRITEBYTECODE: '1' });
});

test('openServerLog appends, and starts over once the log passes the limit', () => {
  const data = mkdtempSync(join(tmpdir(), 'ht-log-'));
  const file = join(data, 'server.log');
  writeFileSync(file, 'x'.repeat(10));
  closeSync(openServerLog(data, 100));
  assert.equal(statSync(file).size, 10, 'under the limit: kept');
  writeFileSync(file, 'x'.repeat(101));
  closeSync(openServerLog(data, 100));
  assert.equal(statSync(file).size, 0, 'over the limit: cut');
  const fresh = mkdtempSync(join(tmpdir(), 'ht-log-'));
  closeSync(openServerLog(fresh));
  assert.ok(existsSync(join(fresh, 'server.log')));
});

function setup(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ht-root-'));
  mkdirSync(join(root, 'server'));
  writeFileSync(join(root, 'server', 'uv.lock'), 'lockfile text');
  writeFileSync(join(root, 'server', 'server.py'), 'print()');
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.6.0' }));
  const data = join(mkdtempSync(join(tmpdir(), 'ht-data-')), 'data');
  const calls = [];
  const spawned = [];
  const opts = {
    argv: ['47811'],
    env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: '/cfg', PATH: '', PYTHONPATH: '/p' },
    fetch: async (url, init) => {
      calls.push([url, init?.method ?? 'GET']);
      throw new Error('down');
    },
    spawn: (cmd, args, o) => {
      const child = {
        pid: 4242,
        unrefd: false,
        unref() {
          this.unrefd = true;
        },
        on() {},
      };
      spawned.push({ cmd, args, o, child });
      return child;
    },
    isFile: () => true,
    ...over,
  };
  return { opts, calls, spawned, data, root };
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

test('main spawns detached and hidden into server.log, logs the start, and unrefs', async () => {
  const { opts, spawned, data, root } = setup();
  await main(opts);
  assert.equal(spawned.length, 1);
  const { o, child, cmd, args } = spawned[0];
  const uv = join('/cfg', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  assert.equal(cmd, uv);
  assert.equal(o.detached, true);
  assert.equal(o.windowsHide, true);
  assert.equal(o.cwd, data);
  assert.equal(o.stdio[0], 'ignore');
  assert.equal(typeof o.stdio[1], 'number');
  assert.equal(o.stdio[2], o.stdio[1]);
  assert.throws(() => closeSync(o.stdio[1]), 'the launcher closed its copy of the log fd');
  assert.ok(existsSync(join(data, 'server.log')));
  assert.equal(o.env.UV_PROJECT_ENVIRONMENT, join(data, 'venv'));
  assert.equal(o.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(o.env.PYTHONPATH, undefined);
  assert.deepEqual(args.slice(-4), ['--lock-hash', identityOf(join(root, 'server')), '--version', '0.6.0']);
  assert.equal(child.unrefd, true);
  const log = readFileSync(join(data, 'launcher.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  assert.ok(log[0].includes(uv) && log[0].includes('4242'), log[0]);
});

test('main does nothing when off, when the right server runs, or when a newer one does', async () => {
  const off = setup();
  off.opts.env.HEADROOM_TRIM = 'off';
  await main(off.opts);
  assert.equal(off.spawned.length, 0);
  assert.equal(off.calls.length, 0);
  const same = setup();
  same.opts.fetch = async () => json({ ok: true, lock: identityOf(join(same.root, 'server')), version: '0.6.0' });
  await main(same.opts);
  assert.equal(same.spawned.length, 0);
  const posts = [];
  const newer = setup({
    fetch: async (url, init) => {
      if (init?.method === 'POST') posts.push(url);
      return json({ ok: true, lock: 'other', version: '0.7.0' });
    },
  });
  await main(newer.opts);
  assert.equal(newer.spawned.length, 0);
  assert.deepEqual(posts, []);
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
  assert.match(readFileSync(join(data, 'launcher.log'), 'utf8'), /boom/);
  await main({ argv: [], env: {} });
});
