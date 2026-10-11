// The installer's tabbed chooser: pure state and render, plus the clack prompt that runs them.

const wrap = (i, n) => (i + n) % n;

// state: { tab, cursor, chosen }; pages: categorize() output. Returns a new state.
export function move(state, action, pages) {
  const { tab, cursor, chosen } = state;
  const keys = pages[tab].keys;
  switch (action) {
    case 'left':
    case 'right': {
      const next = wrap(tab + (action === 'left' ? -1 : 1), pages.length);
      return { ...state, tab: next, cursor: Math.min(cursor, pages[next].keys.length - 1) };
    }
    case 'up':
    case 'down':
      return { ...state, cursor: wrap(cursor + (action === 'up' ? -1 : 1), keys.length) };
    case 'space':
      return { ...state, chosen: { ...chosen, [keys[cursor]]: !chosen[keys[cursor]] } };
    case 'all': {
      if (pages[tab].bulk === false) return state;
      const on = !keys.every((k) => chosen[k]);
      return { ...state, chosen: { ...chosen, ...Object.fromEntries(keys.map((k) => [k, on])) } };
    }
    default:
      return state;
  }
}
