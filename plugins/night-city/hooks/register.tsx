// Flavor text: swaps the spinner and turn-line words for Night City ones. Changes only `word`.
// The intro: about four seconds of the animated skyline at a fresh session start, in a pane where Claude Code places
// one, else in the band above the prompt; any key ends it.
import type { EngineInterface as $, Register, Timer } from 'claude-code';

import { BAND_ROWS, INTRO_MS, frame } from './scene';
import { SPINNER_WORDS, TURN_WORDS, pick } from './words';

const PANE = 'night-city-intro';
const KEY = 'scene';

type Intro = {
  form: 'pane' | 'band';
  startedAt: number;
  site?: { requestId: string; columns: number; rows: number };
  timer?: Timer;
};

// Module state, not $.state: the intro lives four seconds and a reload need not keep it.
let isFresh = false;
let intro: Intro | undefined;

const clamp = (n: number, max: number) => Math.max(1, Math.min(max, Math.floor(n)));

async function play($: $) {
  const startedAt = await $.clock.now();
  const opened = await $.ui.open({ id: PANE, title: 'Night City', rows: 24 });
  const playing: Intro = { form: opened.isPlaced ? 'pane' : 'band', startedAt };
  intro = playing;
  if (!opened.isPlaced) $.ui.invalidate('ui.render');
  playing.timer = $.clock.every(66, async () => {
    const t = (await $.clock.now()) - startedAt;
    if (intro !== playing) return;
    if (t >= INTRO_MS) return end($);
    const site = playing.site;
    // A deny is a resize between frames; the redraw it brings mounts the new size.
    if (site !== undefined) {
      await $.ui.blit({ requestId: site.requestId, key: KEY, cells: frame(site.columns, site.rows, t) });
    }
  });
}

function end($: $) {
  if (intro === undefined) return;
  intro.timer?.cancel();
  intro = undefined;
  void $.ui.close({ id: PANE });
  $.ui.invalidate('ui.render');
}

// Sizes the scene to the site drawing it, and remembers that site for the blits.
async function scene($: $, playing: Intro, requestId: string, width: number, height: number) {
  const columns = clamp(width, 512);
  const rows = clamp(height, 256);
  playing.site = { requestId, columns, rows };
  return { key: KEY, columns, rows, cells: frame(columns, rows, (await $.clock.now()) - playing.startedAt) };
}

export const register: Register = (on) => {
  isFresh = false;
  intro = undefined;

  on('ui.render', { component: 'Spinner' }, (_$, e, next) =>
    next({ ...e, props: { ...e.props, word: pick(SPINNER_WORDS, e.props.word) } }),
  );
  on('ui.render', { component: 'TurnDuration' }, (_$, e, next) =>
    next({ ...e, props: { ...e.props, word: pick(TURN_WORDS, e.props.word) } }),
  );

  // SessionStart's source says startup before session.start says whether a person is there.
  on('classic.SessionStart', (_$, e, next) => {
    isFresh = e.source === 'startup';
    return next(e);
  }).catch((_$, e, next) => next(e));
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    if (isFresh && e.isInteractive && e.surface === 'terminal') void play($);
    isFresh = false;
    return started;
  });

  on('prompt.edit', ($, e, next) => {
    if (e.key !== undefined) end($);
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (intro?.form !== 'pane' || e.surface !== 'terminal') return $.ui.resolve(e).Box({});
    const { Raster } = $.ui.resolve(e);
    return <Raster {...await scene($, intro, e.requestId, e.props.bodyColumns, e.props.scroll.bodyRows)} />;
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || intro?.form !== 'band' || e.surface !== 'terminal') return next(e);
    const { Raster } = $.ui.resolve(e);
    return (
      <Raster {...await scene($, intro, e.requestId, e.props.bodyColumns, Math.min(BAND_ROWS, e.props.maxRows))} />
    );
  });
};
