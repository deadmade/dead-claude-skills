import { expect, mock, test } from 'claude-code/testing';
import type { On, PromptEditInput, PromptEditResult } from 'claude-code';
import type { Engine } from 'claude-code/testing';

import { INTRO_MS } from './scene';
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

const PANE = 'night-city-intro';
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const;
const SCROLL = { offset: 0, bodyRows: 30 };

// Fakes the host beneath the plugin: places the pane or not, records opens, closes and blits.
function host(on: On, { placed = true, deny = 0 } = {}) {
  const clock = mock.clock(on);
  const h = { clock, opens: [] as { id: string; focus?: true }[], closed: [] as string[], blits: [] as string[] };
  on('session.start', () => ({ cwd: '/' }));
  on('classic.SessionStart', () => ({}));
  on('ui.open', (_$, e) => {
    h.opens.push({ id: e.id, focus: e.focus });
    return { value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'narrow' } };
  });
  on('ui.close', (_$, e) => {
    h.closed.push(e.id);
    return { value: undefined };
  });
  on('ui.blit', (_$, e) => {
    if (deny-- > 0) return { value: { deny: 'another size' } };
    h.blits.push(e.requestId);
    return { value: {} };
  });
  on('ui.invalidate', () => ({ value: undefined }));
  return h;
}

const pane = (columns: number) =>
  ({
    plugin: 'night-city',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Night City', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: SCROLL, view: {} },
  }) as const;

const band = (hasSurvey = false) =>
  ({
    plugin: 'night-city',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: SCROLL, view: {} },
  }) as const;

async function startup($: Engine, h: ReturnType<typeof host>, source = 'startup' as const) {
  await $.classic.SessionStart({ source });
  await $.session.start(START);
  await h.clock.settle(); // lets the unawaited intro open its pane
}

test('a placed pane plays and closes after INTRO_MS', async ($, on) => {
  const h = host(on);
  await startup($, h);
  expect(h.opens).toEqual([{ id: PANE, focus: undefined }]);
  const ui = await $.ui.mount(pane(144));
  expect((await ui.find({ key: 'scene' }))?.type).toBe('Raster');
  await h.clock.advance(1000);
  expect(h.blits.length).toBeGreaterThan(5);
  expect(new Set(h.blits)).toEqual(new Set([PANE]));
  expect(h.closed).toEqual([]);
  await h.clock.advance(INTRO_MS);
  expect(h.closed).toEqual([PANE]);
  const after = h.blits.length;
  await h.clock.advance(1000);
  expect(h.blits.length).toBe(after);
});

test('an unplaced pane falls back to the band, and the pane id is still closed', async ($, on) => {
  const h = host(on, { placed: false });
  await startup($, h);
  const ui = await $.ui.mount(band());
  expect((await ui.find({ key: 'scene' }))?.type).toBe('Raster');
  await h.clock.advance(500);
  expect(h.blits.length).toBeGreaterThan(3);
  expect(new Set(h.blits)).toEqual(new Set(['band']));
  await h.clock.advance(INTRO_MS);
  expect(h.closed).toEqual([PANE]);
});

test('the first keypress ends the intro and reaches the prompt', async ($, on) => {
  const h = host(on);
  on('prompt.edit', () => ({ text: 'from next', cursor: 9 }));
  await startup($, h);
  await $.ui.mount(pane(144));
  await h.clock.advance(300);
  const edit = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' } as const;
  // The surface raises prompt.edit; the kit runs it but its typings leave it out.
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<PromptEditResult> };
  const r = await prompt.edit({ ...edit, key: { key: 'h' } });
  expect(r).toEqual({ text: 'from next', cursor: 9 });
  expect(h.closed).toEqual([PANE]);
  const after = h.blits.length;
  await h.clock.advance(500);
  expect(h.blits.length).toBe(after);
});

test('a keypress while the intro is starting skips it', async ($, on) => {
  const h = host(on);
  on('prompt.edit', () => ({ text: 'h', cursor: 1 }));
  await $.classic.SessionStart({ source: 'startup' });
  await $.session.start(START);
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<PromptEditResult> };
  const edit = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' } as const;
  expect(await prompt.edit({ ...edit, key: { key: 'h' } })).toEqual({ text: 'h', cursor: 1 });
  await h.clock.settle();
  await $.ui.mount(pane(144));
  await h.clock.advance(INTRO_MS);
  expect(h.blits).toEqual([]);
  expect(h.closed).toEqual([PANE]);
});

test('clear, resume, compact and fork play no intro', async ($, on) => {
  const h = host(on);
  for (const source of ['clear', 'resume', 'compact', 'fork'] as const) await startup($, h, source as never);
  await h.clock.advance(INTRO_MS);
  expect(h.opens).toEqual([]);
  expect(h.blits).toEqual([]);
});

test('a -p run plays no intro', async ($, on) => {
  const h = host(on);
  await $.classic.SessionStart({ source: 'startup' });
  await $.session.start({ cwd: '/', surface: null, isInteractive: false });
  await h.clock.advance(INTRO_MS);
  expect(h.opens).toEqual([]);
  expect(h.blits).toEqual([]);
});

test('a denied blit after a resize does not stop or throw', async ($, on) => {
  const h = host(on, { deny: 3 });
  await startup($, h);
  await $.ui.mount(pane(144));
  await h.clock.advance(1000);
  expect(h.blits.length).toBeGreaterThan(3);
  await h.clock.advance(INTRO_MS);
  expect(h.closed).toEqual([PANE]);
});

test('the band yields to a survey', async ($, on) => {
  const seen = engine(on);
  const h = host(on, { placed: false });
  await startup($, h);
  await $.ui.render(band(true) as never);
  expect(seen.at(-1)?.hasSurvey).toBe(true);
});
