import { expect, mock, test } from 'claude-code/testing';
import type { On, PromptEditInput, PromptEditResult } from 'claude-code';
import type { Engine } from 'claude-code/testing';

import { BAND_ROWS, INTRO_MS } from './scene';
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

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const;
const EDIT = { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' } as const;

type Blit = { requestId: string; size: number };

// Fakes the host beneath the plugin and records each blit's site and cell count.
function host(on: On, { deny = 0 } = {}) {
  const clock = mock.clock(on);
  const blits: Blit[] = [];
  on('session.start', () => ({ cwd: '/' }));
  on('classic.SessionStart', () => ({}));
  on('ui.blit', (_$, e) => {
    if (deny-- > 0) return { value: { deny: 'another size' } };
    if ('cells' in e) blits.push({ requestId: e.requestId, size: Uint8Array.fromBase64(e.cells).length / 12 });
    return { value: {} };
  });
  on('ui.invalidate', () => ({ value: undefined }));
  on('prompt.edit', () => ({ text: 'from next', cursor: 9 }));
  return { clock, blits, seen: engine(on) };
}

const band = ({ hasSurvey = false, maxRows = 12, bodyColumns = 100 } = {}) =>
  ({
    plugin: 'night-city',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { offset: 0, bodyRows: maxRows - 1 },
      view: {},
    },
  }) as const;

async function startup($: Engine, h: ReturnType<typeof host>, source = 'startup' as const) {
  await $.classic.SessionStart({ source });
  await $.session.start(START);
  await h.clock.settle(); // lets the unawaited intro start
}

// The surface raises prompt.edit; the kit runs it but its typings leave it out.
const edit = ($: Engine, e: PromptEditInput) =>
  ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<PromptEditResult> }).edit(e);

test('the band plays the scene at its full height and stops after INTRO_MS', async ($, on) => {
  const h = host(on);
  await startup($, h);
  const ui = await $.ui.mount(band());
  expect(await ui.find({ key: 'scene' })).toMatchObject({ type: 'Raster', props: { columns: 100, rows: 12 } });
  await h.clock.advance(1000);
  expect(h.blits.length).toBeGreaterThan(5);
  expect(h.blits.every((b) => b.requestId === 'band' && b.size === 100 * 12)).toBe(true);
  await h.clock.advance(INTRO_MS);
  const after = h.blits.length;
  await h.clock.advance(1000);
  expect(h.blits.length).toBe(after);
  await $.ui.render(band() as never);
  expect(h.seen.length).toBe(1); // over: the band is the engine's again
});

test('the band keeps at least BAND_ROWS and never takes more than maxRows', async ($, on) => {
  const h = host(on);
  await startup($, h);
  const short = await $.ui.mount({ ...band({ maxRows: 30 }), viewport: { columns: 100, rows: 8 } });
  expect((await short.find({ key: 'scene' }))?.props).toMatchObject({ rows: BAND_ROWS });
  const tiny = await $.ui.mount({ ...band({ maxRows: 4 }), requestId: 'band-2' });
  expect((await tiny.find({ key: 'scene' }))?.props).toMatchObject({ rows: 4 });
});

test('the first keypress ends the intro and reaches the prompt', async ($, on) => {
  const h = host(on);
  await startup($, h);
  await $.ui.mount(band());
  await h.clock.advance(300);
  expect(await edit($, { ...EDIT, key: { key: 'h' } })).toEqual({ text: 'from next', cursor: 9 });
  const after = h.blits.length;
  await h.clock.advance(500);
  expect(h.blits.length).toBe(after);
});

test('a keypress while the intro is starting skips it', async ($, on) => {
  const h = host(on);
  await $.classic.SessionStart({ source: 'startup' });
  await $.session.start(START);
  expect(await edit($, { ...EDIT, key: { key: 'h' } })).toEqual({ text: 'from next', cursor: 9 });
  await h.clock.settle();
  await $.ui.render(band() as never);
  await h.clock.advance(INTRO_MS);
  expect(h.seen.length).toBe(1);
  expect(h.blits).toEqual([]);
});

test('clear, resume, compact and fork play no intro', async ($, on) => {
  const h = host(on);
  for (const source of ['clear', 'resume', 'compact', 'fork'] as const) await startup($, h, source as never);
  await $.ui.render(band() as never);
  await h.clock.advance(INTRO_MS);
  expect(h.seen.length).toBe(1);
  expect(h.blits).toEqual([]);
});

test('a -p run plays no intro', async ($, on) => {
  const h = host(on);
  await $.classic.SessionStart({ source: 'startup' });
  await $.session.start({ cwd: '/', surface: null, isInteractive: false });
  await h.clock.advance(INTRO_MS);
  expect(h.blits).toEqual([]);
});

test('a resize changes the blitted size, and a denied blit does not stop the intro', async ($, on) => {
  const h = host(on, { deny: 3 });
  await startup($, h);
  await $.ui.mount(band());
  await h.clock.advance(500);
  expect(h.blits.length).toBeGreaterThan(2);
  await $.ui.render(band({ maxRows: 16, bodyColumns: 80 }) as never);
  await h.clock.advance(500);
  expect(h.blits.at(-1)?.size).toBe(80 * 16);
});

test('the band yields to a survey', async ($, on) => {
  const h = host(on);
  await startup($, h);
  const ui = await $.ui.mount(band());
  expect((await ui.find({ key: 'scene' }))?.type).toBe('Raster');
  await $.ui.render(band({ hasSurvey: true }) as never);
  expect(h.seen.at(-1)?.hasSurvey).toBe(true);
});
