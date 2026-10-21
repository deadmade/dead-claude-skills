// Flavor: Night City spinner and turn-line words, status-line reactions, the terminal background.
import type { EngineInterface as $, Register, Timer } from 'claude-code';

import { RESET, SET, isNightCity, paint } from './background';
import { SPINNER_WORDS, TURN_WORDS, pick } from './words';

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

// The terminal background follows the theme: Night City selected paints it, anything else resets it.
let isTerminal = false;
let isPainted = false;

async function background($: $, on: boolean) {
  if (on !== isPainted && (await paint($, on ? SET : RESET))) isPainted = on;
}

export const register: Register = (on) => {
  glitched = false;
  reaction = undefined;
  isTerminal = false;
  isPainted = false;

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

  on('session.start', async ($, e, next) => {
    const started = await next(e);
    isTerminal = e.isInteractive && e.surface === 'terminal';
    if (isTerminal) {
      void $.config.list().then(
        (rows) => background($, isNightCity(rows.find((row) => row.key === 'theme')?.value)),
        () => {},
      );
    }
    return started;
  });
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const set = await next(e);
    if (isTerminal && set.deny === undefined) void background($, isNightCity(set.value));
    return set;
  }).catch((_$, e, next) => next(e));
  // After a /clear or a resume the process, and the terminal, go on.
  on('session.end', async ($, e, next) => {
    if (isPainted && e.reason !== 'clear' && e.reason !== 'resume') await background($, false);
    return next(e);
  });
};
