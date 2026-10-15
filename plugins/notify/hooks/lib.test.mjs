import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DONE, WAITING, shouldNotify, tmuxFocused, nightCityEnabled, message, notifiers, TMUX_ARGV } from './lib.mjs';

const first = (l) => l[0];
const plain = { nightCity: false, pick: first };

test('skips continuations, subagents and headless runs', () => {
  assert.equal(shouldNotify({ stop_hook_active: true }, {}), false);
  assert.equal(shouldNotify({ agent_id: 'a1' }, {}), false);
  for (const ep of ['sdk-cli', 'sdk-ts', 'sdk-py'])
    assert.equal(shouldNotify({}, { CLAUDE_CODE_ENTRYPOINT: ep }), false);
  assert.equal(shouldNotify({}, { CLAUDE_CODE_ENTRYPOINT: 'cli' }), true);
  assert.equal(shouldNotify({}, {}), true);
});

test('tmux focus needs active pane, active window and a focused client', () => {
  assert.equal(tmuxFocused('11\nattached,UTF-8\nattached,focused'), true);
  assert.equal(tmuxFocused('11\nattached,UTF-8'), false);
  assert.equal(tmuxFocused('01\nfocused'), false);
  assert.equal(tmuxFocused('10\nfocused'), false);
  assert.equal(tmuxFocused(''), false);
  assert.equal(tmuxFocused('11\nunfocused'), false);
});

test('night-city is on only when enabled in settings', () => {
  assert.equal(nightCityEnabled('{"enabledPlugins":{"night-city@dead-claude-skills":true}}'), true);
  assert.equal(nightCityEnabled('{"enabledPlugins":{"night-city@dead-claude-skills":false}}'), false);
  assert.equal(nightCityEnabled(undefined), false);
  assert.equal(nightCityEnabled('{oops'), false);
});

test('plain stop message', () => {
  const input = {
    hook_event_name: 'Stop',
    cwd: '/home/u/dead-claude-skills',
    last_assistant_message: '\nAll tests pass.\nDetails',
  };
  assert.deepEqual(message(input, plain), { title: 'Claude Code · dead-claude-skills', body: 'Done\nAll tests pass.' });
});

test('plain waiting message', () => {
  const input = { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' };
  assert.equal(message(input, plain).body, 'Needs your input\nClaude needs your permission to use Bash');
});

test('question message', () => {
  const ask = (tool_input) => ({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input });
  assert.equal(message(ask({ questions: [{ question: 'Which DB?' }] }), plain).body, 'Needs your input\nWhich DB?');
  assert.equal(message(ask({}), plain).body, 'Needs your input');
});

test('night-city wording', () => {
  const nc = { nightCity: true, pick: first };
  assert.equal(message({ hook_event_name: 'Stop' }, nc).body, DONE[0]);
  assert.equal(message({ hook_event_name: 'Notification', message: 'x' }, nc).body.split('\n')[0], WAITING[0]);
  assert.equal(message({ hook_event_name: 'PreToolUse', tool_input: {} }, nc).body, WAITING[0]);
});

test('empty answer gives the status line alone', () => {
  assert.equal(message({ hook_event_name: 'Stop' }, plain).body, 'Done');
  assert.equal(message({ hook_event_name: 'Stop', last_assistant_message: '\n\n' }, plain).body, 'Done');
});

test('truncation keeps whole characters', () => {
  const line = (s) => message({ hook_event_name: 'Stop', last_assistant_message: s }, plain).body.split('\n')[1];
  const long = line('x'.repeat(300));
  assert.equal([...long].length, 120);
  assert.ok(long.endsWith('…'));
  const emoji = line('x'.repeat(118) + '😀'.repeat(10));
  const lone = emoji.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  assert.ok(!/[\uD800-\uDFFF]/.test(lone));
});

test('linux tries busctl then notify-send and escapes markup', () => {
  const [busctl, notifySend, ...rest] = notifiers('linux', { title: 'T', body: 'a <b> & c' }, '/p/icon.png');
  assert.deepEqual(rest, []);
  assert.deepEqual(busctl.argv, [
    'busctl',
    '--user',
    'call',
    'org.freedesktop.Notifications',
    '/org/freedesktop/Notifications',
    'org.freedesktop.Notifications',
    'Notify',
    'susssasa{sv}i',
    'Claude Code',
    '0',
    '/p/icon.png',
    'T',
    'a &lt;b&gt; &amp; c',
    '0',
    '0',
    '-1',
  ]);
  assert.deepEqual(notifySend.argv, [
    'notify-send',
    '-a',
    'Claude Code',
    '-i',
    '/p/icon.png',
    'T',
    'a &lt;b&gt; &amp; c',
  ]);
});

test('windows passes text by env, never in the script', () => {
  const list = notifiers('win32', { title: '$(x)', body: '"; rm <b>' }, 'C:\\Users\\A B\\icon.png');
  assert.equal(list.length, 1);
  const [{ argv, env }] = list;
  assert.deepEqual(argv.slice(0, 6), [
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
  ]);
  assert.ok(!argv.some((a) => a.includes('$(x)') || a.includes('"; rm <b>')));
  assert.equal(env.NOTIFY_TITLE, '$(x)');
  assert.equal(env.NOTIFY_BODY, '"; rm <b>');
  assert.equal(env.NOTIFY_ICON, 'C:\\Users\\A B\\icon.png');
  assert.equal(env.PATH, process.env.PATH);
});

test('mac passes raw text as argv', () => {
  const [{ argv }, ...rest] = notifiers('darwin', { title: 'T', body: 'a <b> & c' }, '/p/icon.png');
  assert.deepEqual(rest, []);
  assert.equal(argv[0], 'osascript');
  assert.equal(argv[1], '-e');
  assert.deepEqual(argv.slice(3), ['T', 'a <b> & c']);
});

test('unknown platform gives nothing', () => {
  assert.deepEqual(notifiers('aix', { title: 'T', body: 'B' }, '/p/icon.png'), []);
});

test('tmux is asked for our pane and every client of its session', () => {
  assert.deepEqual(TMUX_ARGV('%3'), [
    'tmux',
    'display-message',
    '-p',
    '-t',
    '%3',
    '#{pane_active}#{window_active}',
    ';',
    'list-clients',
    '-t',
    '%3',
    '-F',
    '#{client_flags}',
  ]);
});

test('main exits quietly on bad input', () => {
  const script = fileURLToPath(new URL('./notify.mjs', import.meta.url));
  for (const input of ['not json', '{}']) {
    const r = spawnSync(process.execPath, [script], { input, env: { ...process.env, PATH: '' }, timeout: 10000 });
    assert.equal(r.status, 0, String(r.stderr));
  }
});
