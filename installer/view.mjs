// The installer's screens as pure functions: state + data in, next state or lines to draw out. ui.mjs runs them.
import { stripVTControlCharacters, styleText } from 'node:util';
import { TOGGLES } from './core.mjs';

const width = (s) => stripVTControlCharacters(s).length;
const DANGER = ['strip-defaults', 'clean'];

// A rounded box columns - 1 wide (a full-width line makes some terminals wrap). Lines wider than the inside are cut
// to their plain text plus …; text the user must copy goes through wrap() first.
export function frame(title, lines, { columns, color = 'magenta' }) {
  const w = Math.max(columns - 1, 8);
  const inner = w - 4;
  const border = (s) => styleText(color, s);
  const t = width(title) > w - 6 ? `${stripVTControlCharacters(title).slice(0, w - 7)}…` : title;
  const fit = (l) => (width(l) > inner ? `${stripVTControlCharacters(l).slice(0, inner - 1)}…` : l);
  return [
    `${border('╭─')} ${t} ${border(`${'─'.repeat(w - 5 - width(t))}╮`)}`,
    ...lines.map(fit).map((l) => `${border('│')} ${l}${' '.repeat(inner - width(l))} ${border('│')}`),
    border(`╰${'─'.repeat(w - 2)}╯`),
  ];
}

// Word-wraps text to width; words longer than width are broken, never cut. A line that fits keeps its color.
export function wrap(text, w) {
  if (width(text) <= w) return [text];
  const out = [];
  let line = '';
  for (let word of stripVTControlCharacters(text).split(' ')) {
    while (word.length > w) {
      if (line) out.push(line);
      line = '';
      out.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= w) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

export const initial = (chosen) => ({ screen: 'start', cursor: 0, page: 0, chosen, skip: {} });

// Updates of plugins that stay installed; skipped ones included, so the Updates screen can untick them.
const liveUpdates = (s, data) => data.updates.filter((u) => s.chosen[u.id] ?? true);

export function changeList(s, data) {
  const keys = data.pages.flatMap((p) => p.keys);
  const diff = (k) => !!s.chosen[k] !== !!data.current[k];
  const plugin = (k) => !TOGGLES.includes(k);
  const toggle = (k) => TOGGLES.includes(k) && !DANGER.includes(k);
  const r = {
    install: keys.filter((k) => plugin(k) && diff(k) && s.chosen[k]),
    remove: keys.filter((k) => plugin(k) && diff(k) && !s.chosen[k]),
    on: keys.filter((k) => toggle(k) && diff(k) && s.chosen[k]),
    off: keys.filter((k) => toggle(k) && diff(k) && !s.chosen[k]),
    danger: keys.filter((k) => DANGER.includes(k) && s.chosen[k] && !data.current[k]),
    update: liveUpdates(s, data).filter((u) => !s.skip[u.id]),
  };
  const changed = keys.filter(diff);
  return {
    ...r,
    count: Object.values(r).reduce((n, l) => n + l.length, 0),
    unchanged: {
      installed: keys.filter((k) => !changed.includes(k) && data.current[k]).length,
      notInstalled: keys.filter((k) => !changed.includes(k) && !data.current[k]).length,
    },
  };
}

// The rows the cursor walks on each screen.
export function rowsOf(s, data) {
  if (s.screen === 'start') {
    return [
      ...data.pages.map((p, i) => ({ kind: 'page', i })),
      ...(liveUpdates(s, data).length ? [{ kind: 'updates' }] : []),
      { kind: 'apply' }, { kind: 'quit' },
    ];
  }
  if (s.screen === 'category') return [{ kind: 'back' }, ...data.pages[s.page].keys.map((key) => ({ kind: 'item', key }))];
  if (s.screen === 'updates') return [{ kind: 'back' }, ...liveUpdates(s, data).map((u) => ({ kind: 'update', ...u }))];
  return [{ kind: 'apply' }, { kind: 'back' }, { kind: 'quit' }];
}

const toStart = (s, data, kind, i) => {
  const cursor = rowsOf({ ...s, screen: 'start' }, data).findIndex((r) => r.kind === kind && (i === undefined || r.i === i));
  return { ...s, screen: 'start', cursor: Math.max(cursor, 0) };
};

// key: a keypress name. Sets result ('apply' | 'quit' | 'ask-quit') when the screen should end.
export function move(s, key, data) {
  const rows = rowsOf(s, data);
  const n = rows.length;
  const step = { up: -1, down: 1, ...(s.screen === 'review' && { left: -1, right: 1 }) }[key];
  if (step) return { ...s, cursor: (s.cursor + step + n) % n };
  const back = s.screen === 'updates' ? toStart(s, data, 'updates') : toStart(s, data, 'page', s.page);
  if (key === 'escape') {
    if (s.screen === 'start') return { ...s, result: changeList(s, data).count ? 'ask-quit' : 'quit' };
    return s.screen === 'review' ? toStart(s, data, 'apply') : back;
  }
  if (key !== 'return') return s;
  const row = rows[s.cursor];
  if (s.screen === 'review') {
    if (row.kind === 'back') return toStart(s, data, 'apply');
    return { ...s, result: row.kind };
  }
  switch (row.kind) {
    case 'page': return { ...s, screen: 'category', page: row.i, cursor: 0 };
    case 'updates': return { ...s, screen: 'updates', cursor: 0 };
    case 'apply': return { ...s, screen: 'review', cursor: 0 };
    case 'quit': return { ...s, result: 'quit' };
    case 'back': return back;
    case 'item': return { ...s, chosen: { ...s.chosen, [row.key]: !s.chosen[row.key] } };
    case 'update': return { ...s, skip: { ...s.skip, [row.id]: !s.skip[row.id] } };
    default: return s;
  }
}
