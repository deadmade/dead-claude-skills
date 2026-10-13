// Flavor text: swaps the spinner and turn-line words for Night City ones. Changes only `word`.
// The intro: about four seconds of the animated skyline in the band above the prompt at a fresh session start; any
// key ends it.
import type { EngineInterface as $, Register, Timer } from 'claude-code';

import { BAND_ROWS, INTRO_MS, frame } from './scene';
import { SPINNER_WORDS, TURN_WORDS, pick } from './words';

const KEY = 'scene';

export const GLITCH_MS = 400;
export const FLARE_MS = 600;
// Reactions go in the plugin's own status line, which sits beside the user's statusLine command, not over it. Plain
// text: the status line takes no colors without escape sequences, which a mod doesn't write.
const GLITCH = '▚▞ FLATLINE ▞▚';
const FLARE = '◢◤ JACKED OUT ◢◤';

let glitched = false; // one glitch per main turn
let reaction: Timer | undefined;

function react($: $, text: string, ms: number) {
  reaction?.cancel();
  $.ui.status(text);
  const mine = $.clock.after(ms, () => {
    if (reaction === mine) $.ui.status(undefined);
  });
  reaction = mine;
}

type Intro = {
  startedAt: number;
  site?: { requestId: string; columns: number; rows: number };
  timer?: Timer;
};

// Module state, not $.state: the intro lives four seconds and a reload need not keep it.
let isFresh = false;
let isPending = false; // the intro is starting: a key now must still skip it
let intro: Intro | undefined;

const clamp = (n: number, max: number) => Math.max(1, Math.min(max, Math.floor(n)));

async function play($: $) {
  const startedAt = await $.clock.now();
  if (!isPending) return;
  isPending = false;
  const playing: Intro = { startedAt };
  intro = playing;
  $.ui.invalidate('ui.render');
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
  isPending = false;
  intro = undefined;
  glitched = false;
  reaction = undefined;

  on('turn.start', (_$, e, next) => {
    glitched = false;
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    const ran = await next(e);
    if (ran.isError === true && !glitched && e.agentId === undefined) {
      glitched = true;
      react($, GLITCH, GLITCH_MS);
    }
    return ran;
  }).catch((_$, e, next) => next(e));
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) react($, FLARE, FLARE_MS);
    return next(e);
  });

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
    isPending = isFresh && e.isInteractive && e.surface === 'terminal';
    isFresh = false;
    const started = await next(e);
    if (isPending) void play($);
    return started;
  });

  on('prompt.edit', ($, e, next) => {
    if (e.key !== undefined) {
      isPending = false;
      end($);
    }
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || intro === undefined || e.surface !== 'terminal') return next(e);
    // As tall as the band shows without scrolling, but at most half the terminal (outside fullscreen maxRows is all
    // of it, which would push the prompt off screen), and at least BAND_ROWS where there is room for them.
    const room = e.props.maxRows > 0 ? e.props.maxRows : BAND_ROWS;
    const half = e.viewport ? Math.floor(e.viewport.rows / 2) : room;
    const { Raster } = $.ui.resolve(e);
    return (
      <Raster {...await scene($, intro, e.requestId, e.props.bodyColumns, Math.min(room, Math.max(BAND_ROWS, half)))} />
    );
  });
};
