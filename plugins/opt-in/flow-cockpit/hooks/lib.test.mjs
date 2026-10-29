import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  utimesSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureDir, toLine, prune, main, MAX_QUESTIONS } from './lib.mjs';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const scratch = () => mkdtempSync(join(tmpdir(), 'flow-cockpit-hook-'));
const base = { session_id: 's1', cwd: '/w', transcript_path: '/t/s1.jsonl' };

test('toLine maps PreToolUse AskUserQuestion with tool_use_id', () => {
  const questions = [{ question: 'Which DB?', options: [{ label: 'a' }] }];
  const line = toLine(
    {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tu1',
      tool_input: { questions },
    },
    NOW,
  );
  assert.ok(!line.includes('\n'));
  assert.deepEqual(JSON.parse(line), {
    v: 1,
    ts: '2026-10-29T12:00:00.000Z',
    session: 's1',
    cwd: '/w',
    event: 'PreToolUse',
    tool_use_id: 'tu1',
    questions,
    transcript: '/t/s1.jsonl',
  });
});

test('toLine cuts questions at 16 KiB', () => {
  const questions = [{ question: 'x'.repeat(40000) }];
  const got = JSON.parse(toLine({ ...base, hook_event_name: 'PreToolUse', tool_input: { questions } }, NOW));
  assert.equal(typeof got.questions, 'string');
  assert.equal(Buffer.byteLength(got.questions), MAX_QUESTIONS);
});

test('toLine maps PermissionRequest without deciding', () => {
  const got = JSON.parse(
    toLine(
      { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'secret' } },
      NOW,
    ),
  );
  assert.equal(got.event, 'PermissionRequest');
  assert.equal(got.permission_tool, 'Bash');
  assert.ok(!JSON.stringify(got).includes('secret'));
});

test('toLine maps SubagentStart with agent_type', () => {
  const got = JSON.parse(
    toLine({ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }, NOW),
  );
  assert.equal(got.agent, 'a1');
  assert.equal(got.agent_type, 'Explore');
  const stop = JSON.parse(
    toLine(
      {
        ...base,
        hook_event_name: 'SubagentStop',
        agent_id: 'a1',
        agent_type: 'Explore',
        agent_transcript_path: '/t/a.jsonl',
      },
      NOW,
    ),
  );
  assert.equal(stop.agent_transcript, '/t/a.jsonl');
});

test('toLine maps Notification and Stop', () => {
  const n = JSON.parse(
    toLine({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'm' }, NOW),
  );
  assert.deepEqual([n.notification_type, n.message], ['permission_prompt', 'm']);
  assert.equal(JSON.parse(toLine({ ...base, hook_event_name: 'Stop' }, NOW)).event, 'Stop');
});

test('toLine returns null for invalid JSON, missing or unsafe session, unknown events', () => {
  assert.equal(toLine('not json', NOW), null);
  assert.equal(toLine({ hook_event_name: 'Stop' }, NOW), null);
  assert.equal(toLine({ ...base, session_id: '../x', hook_event_name: 'Stop' }, NOW), null);
  assert.equal(toLine({ ...base, hook_event_name: 'Whatever' }, NOW), null);
  assert.equal(toLine(null, NOW), null);
});

test('captureDir follows XDG_STATE_HOME and LOCALAPPDATA', () => {
  const l = (env) => captureDir(env, 'linux');
  const w = (env) => captureDir(env, 'win32');
  assert.equal(l({ HOME: '/h', XDG_STATE_HOME: '/s' }), '/s/flow-cockpit/capture');
  assert.equal(l({ HOME: '/h' }), '/h/.local/state/flow-cockpit/capture');
  assert.equal(l({ HOME: '/h', XDG_STATE_HOME: '' }), '/h/.local/state/flow-cockpit/capture');
  assert.equal(
    w({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', XDG_STATE_HOME: '/s' }),
    'C:\\Users\\u\\AppData\\Local\\flow-cockpit\\capture',
  );
  assert.equal(w({ USERPROFILE: 'C:\\Users\\u' }), 'C:\\Users\\u\\AppData\\Local\\flow-cockpit\\capture');
  // Linux ignores LOCALAPPDATA, Windows ignores XDG_STATE_HOME.
  assert.equal(l({ HOME: '/h', LOCALAPPDATA: 'C:\\x' }), '/h/.local/state/flow-cockpit/capture');
  assert.equal(w({ USERPROFILE: 'C:\\U', XDG_STATE_HOME: '/s' }), 'C:\\U\\AppData\\Local\\flow-cockpit\\capture');
});

test('captureDir is null when it would need a missing home', () => {
  assert.equal(captureDir({}, 'linux'), null);
  assert.equal(captureDir({ HOME: '' }, 'linux'), null);
  assert.equal(captureDir({ HOME: '/h' }, 'win32'), null);
  assert.equal(captureDir({}, 'win32'), null);
});

test('prune deletes files older than 30 days only', () => {
  const dir = scratch();
  const old = join(dir, 'old.jsonl');
  const fresh = join(dir, 'fresh.jsonl');
  writeFileSync(old, 'x');
  writeFileSync(fresh, 'x');
  const t = (days) => new Date(NOW - days * 86400000);
  utimesSync(old, t(31), t(31));
  utimesSync(fresh, t(29), t(29));
  prune(dir, NOW);
  assert.deepEqual(readdirSync(dir), ['fresh.jsonl']);
  prune(join(dir, 'missing'), NOW);
  rmSync(dir, { recursive: true });
});

const run = async (stdin, env) => {
  const writes = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => (writes.push(String(c)), true);
  try {
    await main({ stdin, env, platform: process.platform, now: NOW });
  } finally {
    process.stdout.write = orig;
  }
  return writes;
};
const envFor = (state) => ({ HOME: state, USERPROFILE: state, XDG_STATE_HOME: state, LOCALAPPDATA: state });

test('main writes one line per event to <session>.jsonl, files 0600, and prints nothing', async () => {
  const state = scratch();
  const env = envFor(state);
  assert.deepEqual(await run(JSON.stringify({ ...base, hook_event_name: 'SessionStart' }), env), []);
  const file = join(state, 'flow-cockpit', 'capture', 's1.jsonl');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).event, 'SessionStart');
  await run(JSON.stringify({ ...base, hook_event_name: 'Stop' }), env);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(state, 'flow-cockpit', 'capture')).mode & 0o777, 0o700);
  }
  rmSync(state, { recursive: true });
});

test('main writes nothing without a home or on bad input', async () => {
  assert.deepEqual(await run(JSON.stringify({ ...base, hook_event_name: 'Stop' }), {}), []);
  const state = scratch();
  assert.deepEqual(await run('garbage', envFor(state)), []);
  assert.equal(existsSync(join(state, 'flow-cockpit')), false);
  rmSync(state, { recursive: true });
});

test('main exits 0 and prints nothing when the capture dir is a file', async () => {
  const state = scratch();
  writeFileSync(join(state, 'flow-cockpit'), 'a file');
  assert.deepEqual(await run(JSON.stringify({ ...base, hook_event_name: 'Stop' }), envFor(state)), []);
  rmSync(state, { recursive: true });
});

test('parallel_appends_stay_whole', async () => {
  const state = scratch();
  const env = { ...process.env, ...envFor(state) };
  const lib = pathToFileURL(join(import.meta.dirname, 'lib.mjs')).href;
  const questions = [{ question: 'q"\n\\'.repeat(2500) }]; // JSON-escaped, near 16 KiB
  const payload = JSON.stringify({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_use_id: 'x',
    tool_input: { questions },
  });
  const code = `import { main } from ${JSON.stringify(lib)};
for (let i = 0; i < 50; i++) await main({ stdin: process.argv[1], env: process.env, platform: process.platform, now: Date.now() });`;
  const writer = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', code, payload], { env, stdio: 'ignore' });
      p.on('close', resolve);
    });
  await Promise.all(Array.from({ length: 20 }, writer));
  const lines = readFileSync(join(state, 'flow-cockpit', 'capture', 's1.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean);
  assert.equal(lines.length, 1000);
  for (const l of lines) assert.equal(JSON.parse(l).tool_use_id, 'x');
  rmSync(state, { recursive: true });
});
