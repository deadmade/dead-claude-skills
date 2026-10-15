import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import type { Engine } from 'claude-code/testing';

import { FLARE_MS, GLITCH_MS } from './register';
import { SPINNER_WORDS, TURN_WORDS, pick } from './words';

// The bottom hook stands for the engine and records the props the plugin passed on.
function engine(on: On) {
  const seen: Record<string, unknown>[] = [];
  on('ui.render', ($, e) => {
    seen.push(e.props as Record<string, unknown>);
    return $.ui.resolve(e).Text({ children: '' }) as never;
  });
  return seen;
}

test('the spinner shows a Night City word', async ($, on) => {
  const seen = engine(on);
  await $.ui.render({
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
  } as never);
  const p = seen.at(-1)!;
  expect(SPINNER_WORDS).toContain(p.word as string);
  expect(p.message).toBe(null);
  expect(p.suffix).toBe('…');
});

test('the turn line shows a Night City verb', async ($, on) => {
  const seen = engine(on);
  const onScreen = { first: 0, last: 1, of: 2 };
  await $.ui.render({
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 3000, onScreen },
  } as never);
  const p = seen.at(-1)!;
  expect(TURN_WORDS).toContain(p.word as string);
  expect(p.durationMs).toBe(3000);
  expect(p.onScreen).toEqual(onScreen);
});

test('pick is stable for one seed', () => {
  expect(pick(SPINNER_WORDS, 'abc')).toBe(pick(SPINNER_WORDS, 'abc'));
  expect(SPINNER_WORDS.length).toBeGreaterThanOrEqual(12);
});

// Fakes the host beneath the plugin: tool calls fail when their command says so; the status line is recorded.
function reactions(on: On) {
  const clock = mock.clock(on);
  const status: (string | undefined)[] = [];
  on(
    'tool.call',
    (_$, e) =>
      ((e as { command?: string }).command === 'fail' ? { isError: true, result: 'x' } : { result: 'ok' }) as never,
  );
  on('ui.status', (_$, e) => {
    status.push(e.text);
    return { value: undefined };
  });
  on('turn.complete', () => ({ text: '' }));
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  return { clock, status };
}

const fail = ($: Engine, agentId?: string) => $.tool.call({ tool: 'Bash', command: 'fail', agentId } as never);
const begin = ($: Engine) => $.turn.start({ text: 'go', turnId: 't' });
const complete = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId, reason: 'answer' } as never);

test('ten failing tool calls in one turn glitch once', async ($, on) => {
  const r = reactions(on);
  await begin($);
  for (let i = 0; i < 10; i++) await fail($);
  expect(r.status.filter((t) => t !== undefined)).toHaveLength(1);
});

test('the next turn can glitch again', async ($, on) => {
  const r = reactions(on);
  await begin($);
  await fail($);
  await begin($);
  await fail($);
  expect(r.status.filter((t) => t !== undefined)).toHaveLength(2);
});

test('a subagent failure does not glitch', async ($, on) => {
  const r = reactions(on);
  await begin($);
  await fail($, 'agent-1');
  expect(r.status).toEqual([]);
});

test('a main turn end flares, a subagent end does not', async ($, on) => {
  const r = reactions(on);
  await complete($, 'agent-1');
  expect(r.status).toEqual([]);
  await complete($);
  expect(r.status.filter((t) => t !== undefined)).toHaveLength(1);
});

test('reactions clear themselves', async ($, on) => {
  const r = reactions(on);
  await begin($);
  await fail($);
  await r.clock.advance(GLITCH_MS - 1);
  expect(r.status.at(-1)).toBeDefined();
  await r.clock.advance(1);
  expect(r.status.at(-1)).toBeUndefined();
  await complete($);
  await r.clock.advance(FLARE_MS);
  expect(r.status.at(-1)).toBeUndefined();
  expect(r.status.filter((t) => t !== undefined)).toHaveLength(2);
});
