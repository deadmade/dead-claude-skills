import { expect, test } from 'claude-code/testing';
import type { On } from 'claude-code';

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
