import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DONE, WAITING, shouldNotify, tmuxFocused, nightCityEnabled, message } from './lib.mjs';

const first = (l) => l[0];
const plain = { nightCity: false, pick: first };

test('skips continuations, subagents and headless runs', () => {
  assert.equal(shouldNotify({ stop_hook_active: true }, {}), false);
  assert.equal(shouldNotify({ agent_id: 'a1' }, {}), false);
  for (const ep of ['sdk-cli', 'sdk-ts', 'sdk-py']) assert.equal(shouldNotify({}, { CLAUDE_CODE_ENTRYPOINT: ep }), false);
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
