import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  utimesSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  openSync,
  closeSync,
  symlinkSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureDir, toLine, prune, main, MAX_QUESTIONS, MAX_MESSAGE } from './lib.mjs';

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

const ask = (questions) => ({ ...base, hook_event_name: 'PreToolUse', tool_input: { questions } });

test('toLine keeps questions an array and cuts a big one down to question and header', () => {
  const questions = Array.from({ length: 6 }, (_, i) => ({
    question: `Q${i} ` + 'x'.repeat(3000),
    header: `H${i}`,
    options: Array.from({ length: 4 }, () => ({ label: 'l', description: 'd'.repeat(500) })),
  }));
  const got = JSON.parse(toLine(ask(questions), NOW));
  assert.ok(Array.isArray(got.questions));
  assert.equal(got.questions_cut, true);
  assert.ok(Buffer.byteLength(JSON.stringify(got.questions)) <= MAX_QUESTIONS);
  assert.ok(got.questions.length >= 1);
  assert.deepEqual(Object.keys(got.questions[0]).sort(), ['header', 'question']);
  assert.ok(got.questions[0].question.startsWith('Q0 '));
});

test('toLine does not flag questions that fit', () => {
  assert.equal(JSON.parse(toLine(ask([{ question: 'a' }]), NOW)).questions_cut, undefined);
});

test('toLine cuts multi-byte questions by characters and stays valid and under the cap', () => {
  for (const ch of ['€', '\u{1F600}', 'q"\n\\']) {
    const line = toLine(ask([{ question: ch.repeat(30000), header: 'h' }]), NOW);
    const got = JSON.parse(line);
    assert.ok(Array.isArray(got.questions));
    assert.equal(got.questions_cut, true);
    assert.ok(Buffer.byteLength(JSON.stringify(got.questions)) <= MAX_QUESTIONS);
    const q = got.questions[0].question;
    assert.ok(q.length > 0);
    assert.ok(!q.includes('�'));
    assert.equal(q, ch.repeat(Array.from(q).length / Array.from(ch).length)); // whole characters only
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(q));
  }
});

test('toLine cuts a long Notification message by characters', () => {
  const got = JSON.parse(toLine({ ...base, hook_event_name: 'Notification', message: '\u{1F600}'.repeat(5000) }, NOW));
  assert.equal(got.message_cut, true);
  assert.equal(Array.from(got.message).length, MAX_MESSAGE);
  assert.equal(
    JSON.parse(toLine({ ...base, hook_event_name: 'Notification', message: 'short' }, NOW)).message_cut,
    undefined,
  );
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

test('a PermissionRequest prints nothing', async () => {
  const state = scratch();
  const input = { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } };
  assert.deepEqual(await run(JSON.stringify(input), envFor(state)), []);
  rmSync(state, { recursive: true });
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

test('prune deletes capture files older than 30 days only', () => {
  const dir = scratch();
  const t = (days) => new Date(NOW - days * 86400000);
  const put = (name, days) => {
    writeFileSync(join(dir, name), 'x');
    utimesSync(join(dir, name), t(days), t(days));
  };
  put('old.jsonl', 31);
  put('fresh.jsonl', 29);
  put('notes.txt', 90);
  mkdirSync(join(dir, 'dir.jsonl'));
  utimesSync(join(dir, 'dir.jsonl'), t(90), t(90));
  prune(dir, NOW);
  assert.deepEqual(readdirSync(dir).sort(), ['dir.jsonl', 'fresh.jsonl', 'notes.txt']);
  prune(join(dir, 'missing'), NOW);
  rmSync(dir, { recursive: true });
});

test('prune leaves a .jsonl link alone and never touches its target', { skip: process.platform === 'win32' }, () => {
  const dir = scratch();
  const target = join(dir, 'target.txt');
  writeFileSync(target, 'x');
  symlinkSync(target, join(dir, 'link.jsonl'));
  const old = new Date(NOW - 90 * 86400000);
  utimesSync(target, old, old);
  prune(dir, NOW);
  assert.ok(existsSync(target));
  assert.ok(readdirSync(dir).includes('link.jsonl'));
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

test('main tightens an existing capture folder to 0700', { skip: process.platform === 'win32' }, async () => {
  const state = scratch();
  const dir = join(state, 'flow-cockpit', 'capture');
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o755);
  await run(JSON.stringify({ ...base, hook_event_name: 'Stop' }), envFor(state));
  assert.equal(statSync(dir).mode & 0o777, 0o700);
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
  // Over 16 KiB before the cut, so the line takes the cut path and is about the largest the format allows (16 KiB of
  // JSON-escaped questions plus the fixed fields).
  const questions = Array.from({ length: 10 }, () => ({ question: 'q"\n\\'.repeat(400), header: 'h' }));
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

const script = join(import.meta.dirname, 'capture.mjs');

test('capture.mjs writes a line, exits 0 and prints nothing', () => {
  const state = scratch();
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ ...base, hook_event_name: 'Stop' }),
    env: { ...process.env, ...envFor(state) },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.length + r.stderr.length, 0);
  assert.equal(
    readFileSync(join(state, 'flow-cockpit', 'capture', 's1.jsonl'), 'utf8')
      .trim()
      .split('\n').length,
    1,
  );
  rmSync(state, { recursive: true });
});

test('capture.mjs exits 0 and prints nothing when stdin cannot be read', () => {
  const state = scratch();
  const fd = openSync(join(state, 'writeonly'), 'w'); // reading it fails with EBADF
  const r = spawnSync(process.execPath, [script], {
    stdio: [fd, 'pipe', 'pipe'],
    env: { ...process.env, ...envFor(state) },
  });
  closeSync(fd);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.length + r.stderr.length, 0);
  rmSync(state, { recursive: true });
});
