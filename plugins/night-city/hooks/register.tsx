// Flavor text: swaps the spinner and turn-line words for Night City ones. Changes only `word`.
import type { Register } from 'claude-code';

import { SPINNER_WORDS, TURN_WORDS, pick } from './words';

// Seeded by the engine's own word, so a line keeps its word across redraws.
export const register: Register = (on) => {
  on('ui.render', { component: 'Spinner' }, (_$, e, next) =>
    next({ ...e, props: { ...e.props, word: pick(SPINNER_WORDS, e.props.word) } }),
  );
  on('ui.render', { component: 'TurnDuration' }, (_$, e, next) =>
    next({ ...e, props: { ...e.props, word: pick(TURN_WORDS, e.props.word) } }),
  );
};
