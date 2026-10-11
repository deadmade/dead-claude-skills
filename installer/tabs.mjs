// The installer's tabbed chooser: pure state and render, plus the clack prompt that runs them.
import {
  S_BAR, S_BAR_H, S_CHECKBOX_ACTIVE, S_CHECKBOX_INACTIVE, S_CHECKBOX_SELECTED, limitOptions, symbol,
} from '@clack/prompts';
import { Prompt, isCancel, wrapTextWithPrefix } from '@clack/core';
import { stripVTControlCharacters, styleText } from 'node:util';

const TITLE = 'Choose what to install';
const KEYS = ['←/→ category', '↑/↓ move', 'space select', 'a all', 'enter review', 'esc quit'];

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

const dim = (s) => styleText('dim', s);
const width = (s) => stripVTControlCharacters(s).length;

// The frame for clack's state `status`: the one-line summary once submitted or cancelled, else the chooser.
// describe(key) -> { label, detail }.
export function render(state, pages, { columns, rows, describe, status }) {
  const { tab, cursor, chosen } = state;
  const picked = pages.flatMap((p) => p.keys).filter((k) => chosen[k]).length;
  if (status === 'submit' || status === 'cancel') {
    const line = `${TITLE} ${dim(`· ${picked} selected`)}`;
    return `${symbol(status)}  ${status === 'cancel' ? styleText(['strikethrough', 'dim'], stripVTControlCharacters(line)) : line}`;
  }
  const page = pages[tab];
  const bar = (short) => pages.map((p, i) => {
    const n = p.keys.filter((k) => chosen[k]).length;
    const text = `${short ? p.title.split(' ')[0] : p.title}${n ? ` ${n}` : ''}`;
    return i === tab ? styleText(['bold', 'inverse'], text) : text;
  }).join(dim(' │ '));
  const gutter = `${dim(S_BAR)}  `;
  const full = bar(false);
  const tabs = width(gutter + full) > columns - 2 ? bar(true) : full;
  const footer = KEYS.filter((k) => page.bulk !== false || k !== 'a all').join(dim(' · '));
  const head = [tabs, dim(S_BAR_H.repeat(Math.max(1, Math.min(width(tabs), columns - 3)))), page.blurb, ''];
  const tail = ['', describe(page.keys[cursor]).detail, '', footer];
  const style = (key, active) => {
    const box = chosen[key] ? styleText('green', S_CHECKBOX_SELECTED)
      : active ? styleText('cyan', S_CHECKBOX_ACTIVE) : dim(S_CHECKBOX_INACTIVE);
    const { label } = describe(key);
    return `${active ? styleText('cyan', '❯') : ' '} ${box} ${page.bulk === false ? styleText('red', label) : label}`;
  };
  // Wrapped here the way clack wraps the frame, so the line count is exact and wrapped lines keep the gutter.
  const fold = (ls) => ls.flatMap((l) => wrapTextWithPrefix({ columns: Math.max(columns - 3, 1) }, l, '').split('\n'));
  const [top, bottom] = [fold(head), fold(tail)];
  const list = limitOptions({
    cursor, options: page.keys, style, output: { columns, rows }, columnPadding: 3, rowPadding: 1 + top.length + bottom.length,
  });
  return [`${symbol(status)}  ${styleText('bold', TITLE)}`, ...[...top, ...list, ...bottom].map((l) => gutter + l)].join('\n');
}

const MOVES = ['left', 'right', 'up', 'down', 'space'];

// Runs the chooser starting on `tab` with `chosen`. Resolves { chosen, tab }, or clack's cancel symbol on esc/ctrl-c.
export async function chooseTabs({ pages, chosen, tab = 0, describe, input, output }) {
  let s = { tab, cursor: 0, chosen };
  const pr = new Prompt({
    ...(input && { input }),
    ...(output && { output }),
    render() {
      return render(s, pages, { columns: this.output.columns ?? 80, rows: this.output.rows ?? 24, describe, status: this.state });
    },
  }, false);
  pr.on('cursor', (a) => { if (MOVES.includes(a)) s = move(s, a, pages); });
  pr.on('key', (ch) => { if (ch === 'a') s = move(s, 'all', pages); });
  const r = await pr.prompt();
  return isCancel(r) ? r : { chosen: s.chosen, tab: s.tab };
}
