// The installer's screens as pure functions: state + data in, next state or lines to draw out. ui.ts runs them.
import { stripVTControlCharacters, styleText } from 'node:util';
import { HINTS, TOGGLES, nameOf, withDependencies, type Page } from './core.ts';

type Style = Parameters<typeof styleText>[0];
type Color = Exclude<Style, readonly unknown[]>;
type Size = { columns: number; rows: number };

// The installer's choices: the screen it shows, where the cursor is, and what is ticked.
export interface State {
  screen: 'start' | 'category' | 'updates' | 'review';
  cursor: number;
  page: number;
  chosen: Record<string, boolean>;
  skip: Record<string, boolean>;
  result?: 'apply' | 'quit' | 'ask-quit';
}
export interface Update {
  id: string;
  from?: string;
  to: string;
}
// What install.ts found on this machine: everything the screens show besides the choices.
export interface Data {
  version: string;
  platform: string;
  pages: Page[];
  current: Record<string, boolean>;
  versions: Record<string, string>;
  disabled: Record<string, boolean>;
  tokens: string[];
  deps?: Record<string, string[]>;
  describe: (key: string) => { label: string; detail: string };
  updates: Update[];
  core: string;
  hidden: { key: string; why?: string }[];
  retired?: string[];
  sweep?: string[];
}
type Row =
  | { kind: 'page'; i: number }
  | { kind: 'updates' | 'apply' | 'quit' | 'back' }
  | { kind: 'item'; key: string }
  | ({ kind: 'update' } & Update);

const width = (s: string) => stripVTControlCharacters(s).length;

// The named colours in Night City's palette (plugins/default/themes/night-city.json).
const NIGHT_CITY = {
  magenta: [240, 139, 180],
  cyan: [124, 207, 224],
  blue: [122, 167, 240],
  green: [143, 221, 176],
  yellow: [245, 208, 122],
  red: [242, 120, 140],
  white: [230, 220, 247],
};

// styleText with its named colours in Night City where the terminal has 24-bit colour; elsewhere (16 colours,
// NO_COLOR, a pipe) styleText decides.
export function paint(format: Style, text: string, stream: { hasColors?(depth: number): boolean } = process.stdout) {
  const all = [format].flat();
  const color = all.find((f): f is keyof typeof NIGHT_CITY => f in NIGHT_CITY);
  if (!color || !stream.hasColors?.(2 ** 24)) return styleText(format, text);
  const rest = all.filter((f) => f !== color);
  return `\x1b[38;2;${NIGHT_CITY[color].join(';')}m${rest.length ? styleText(rest, text) : text}\x1b[39m`;
}
const DANGER = ['strip-defaults', 'clean'];

// A rounded box columns - 1 wide (a full-width line makes some terminals wrap). Lines wider than the inside are cut
// to their plain text plus …; text the user must copy goes through wrap() first.
export function frame(
  title: string,
  lines: string[],
  { columns, color = 'magenta' }: { columns: number; color?: Style },
) {
  const w = Math.max(columns - 1, 8);
  const inner = w - 4;
  const border = (s: string) => paint(color, s);
  const t = width(title) > w - 6 ? `${stripVTControlCharacters(title).slice(0, w - 7)}…` : title;
  const fit = (l: string) => (width(l) > inner ? `${stripVTControlCharacters(l).slice(0, inner - 1)}…` : l);
  return [
    `${border('╭─')} ${t} ${border(`${'─'.repeat(w - 5 - width(t))}╮`)}`,
    ...lines.map(fit).map((l) => `${border('│')} ${l}${' '.repeat(inner - width(l))} ${border('│')}`),
    border(`╰${'─'.repeat(w - 2)}╯`),
  ];
}

// Word-wraps text to width; words longer than width are broken, never cut. A line that fits keeps its color.
export function wrap(text: string, w: number) {
  if (width(text) <= w) return [text];
  const out: string[] = [];
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

export const initial = (chosen: Record<string, boolean>): State => ({
  screen: 'start',
  cursor: 0,
  page: 0,
  chosen,
  skip: {},
});

// Updates of plugins that stay installed (bundle plugins aren't on any page and always do); skipped ones included,
// so the Updates screen can untick them.
const liveUpdates = (s: State, data: Data) => {
  const keys = data.pages.flatMap((p) => p.keys);
  return data.updates.filter((u) => !keys.includes(u.id) || s.chosen[u.id]);
};

export function changeList(s: State, data: Data) {
  const keys = data.pages.flatMap((p) => p.keys);
  const diff = (k: string) => !!s.chosen[k] !== !!data.current[k];
  const plugin = (k: string) => !TOGGLES.includes(k);
  const toggle = (k: string) => TOGGLES.includes(k) && !DANGER.includes(k);
  // data.deps: { id: dependency ids }. Dependencies of a chosen plugin are installed whatever their own row says.
  const deps = data.deps ?? {};
  const all = [...new Set([...keys.filter(plugin), ...Object.keys(deps), ...Object.values(deps).flat()])];
  const wanted = withDependencies(
    keys.filter((k) => plugin(k) && s.chosen[k]),
    (k) => deps[k],
    all,
  );
  const r = {
    install: all.filter((k) => wanted.includes(k) && !data.current[k]),
    remove: all.filter((k) => !wanted.includes(k) && data.current[k]),
    on: keys.filter((k) => toggle(k) && diff(k) && s.chosen[k]),
    off: keys.filter((k) => toggle(k) && diff(k) && !s.chosen[k]),
    danger: keys.filter((k) => DANGER.includes(k) && s.chosen[k] && !data.current[k]),
    update: liveUpdates(s, data).filter((u) => !s.skip[u.id]),
    retired: data.retired ?? [],
    // strip-defaults and clean remove every foreign plugin and marketplace on each run they're on.
    sweep: s.chosen['strip-defaults'] || s.chosen.clean ? (data.sweep ?? []) : [],
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
export function rowsOf(s: State, data: Data): Row[] {
  if (s.screen === 'start') {
    return [
      ...data.pages.map((_, i) => ({ kind: 'page' as const, i })),
      ...(liveUpdates(s, data).length ? [{ kind: 'updates' as const }] : []),
      { kind: 'apply' },
      { kind: 'quit' },
    ];
  }
  if (s.screen === 'category')
    return [{ kind: 'back' }, ...data.pages[s.page].keys.map((key) => ({ kind: 'item' as const, key }))];
  if (s.screen === 'updates')
    return [{ kind: 'back' }, ...liveUpdates(s, data).map((u) => ({ kind: 'update' as const, ...u }))];
  return [{ kind: 'apply' }, { kind: 'back' }, { kind: 'quit' }];
}

// The start screen's row of that kind (and page i).
const isRow = (r: Row | undefined, kind: Row['kind'], i?: number) =>
  r?.kind === kind && (i === undefined || (r.kind === 'page' && r.i === i));

const toStart = (s: State, data: Data, kind: Row['kind'], i?: number): State => {
  const cursor = rowsOf({ ...s, screen: 'start' }, data).findIndex((r) => isRow(r, kind, i));
  return { ...s, screen: 'start', cursor: Math.max(cursor, 0) };
};

// key: a keypress name. Sets result ('apply' | 'quit' | 'ask-quit') when the screen should end.
export function move(s: State, key: string, data: Data): State {
  const rows = rowsOf(s, data);
  const n = rows.length;
  const step = ({ up: -1, down: 1, ...(s.screen === 'review' && { left: -1, right: 1 }) } as Record<string, number>)[
    key
  ];
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
    return row.kind === 'apply' || row.kind === 'quit' ? { ...s, result: row.kind } : s;
  }
  switch (row.kind) {
    case 'page':
      return { ...s, screen: 'category', page: row.i, cursor: 0 };
    case 'updates':
      return { ...s, screen: 'updates', cursor: 0 };
    case 'apply':
      return { ...s, screen: 'review', cursor: 0 };
    case 'quit':
      return { ...s, result: 'quit' };
    case 'back':
      return back;
    case 'item':
      return { ...s, chosen: { ...s.chosen, [row.key]: !s.chosen[row.key] } };
    case 'update':
      return { ...s, skip: { ...s.skip, [row.id]: !s.skip[row.id] } };
    default:
      return s;
  }
}

const COLORS: Record<string, Color> = {
  workflow: 'cyan',
  lsp: 'yellow',
  mcp: 'blue',
  tools: 'green',
  system: 'magenta',
  danger: 'red',
  other: 'white',
};
const LABELS: Record<string, string> = { ccstatusline: 'status line' };
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const pointer = (on: boolean) => (on ? paint(['bold', 'magenta'], '❯') : ' ');
// Lines outside the frame obey the same width rule as the frame.
const fitLine = (l: string, columns: number) =>
  width(l) > columns - 1 ? `${stripVTControlCharacters(l).slice(0, Math.max(columns - 2, 0))}…` : l;

// What the start screen says a page holds after the pending changes.
function pageValue(page: Page, s: State, data: Data) {
  const parts = page.keys.flatMap((k) => {
    const [want, has] = [!!s.chosen[k], !!data.current[k]];
    if (page.id === 'danger') return want ? [paint('red', nameOf(k))] : [];
    if (TOGGLES.includes(k)) {
      const text = `${LABELS[k] ?? k} ${want ? 'on' : 'off'}`;
      return [want === has ? text : paint(want ? 'green' : 'red', text)];
    }
    if (want && has) return [nameOf(k)];
    if (want) return [paint('green', `+ ${nameOf(k)}`)];
    if (has) return [paint('red', `− ${nameOf(k)}`)];
    return [];
  });
  if (parts.length) return parts.join(parts.some((p) => /^[+−]/.test(stripVTControlCharacters(p))) ? '  ' : ', ');
  return page.id === 'danger' ? 'off' : 'none';
}

// The state word for one item on a category screen.
function stateOf(k: string, s: State, data: Data) {
  const [want, has] = [!!s.chosen[k], !!data.current[k]];
  if (TOGGLES.includes(k)) {
    if (want !== has) return paint(['bold', want ? 'green' : 'red'], want ? 'will turn on' : 'will turn off');
    return want ? paint('green', 'on') : 'off';
  }
  const v = data.versions[k];
  if (want && !has) return paint(['bold', 'green'], 'will install');
  if (!want && has) return paint(['bold', 'red'], v ? `will remove (installed ${v})` : 'will remove');
  if (!has) return 'not installed';
  const u = data.updates.find((x) => x.id === k);
  if (u) return paint('yellow', `outdated ${u.from} → ${u.to}`);
  return paint('green', `installed${v ? ` ${v}` : ''}${data.disabled[k] ? ', disabled' : ''}`);
}

// A window of `size` rows around the cursor.
function scroll(lines: string[], cursor: number, size: number) {
  if (lines.length <= size) return lines;
  const start = Math.min(Math.max(0, cursor - size + 1), lines.length - size);
  return lines.slice(start, start + size);
}

// At most n lines; a cut ends in …. For the wrapped blurb and description.
const cap = (lines: string[], n: number) =>
  lines.length <= n ? lines : [...lines.slice(0, n - 1), `${stripVTControlCharacters(lines[n - 1])}…`].slice(0, n);
// At most n lines, the rest summed up as "… N more". For the review's groups.
const more = (lines: string[], n: number) =>
  lines.length <= n
    ? lines
    : [...lines.slice(0, Math.max(n - 1, 0)), `… ${lines.length - Math.max(n - 1, 0)} more`].slice(0, Math.max(n, 1));

function startScreen(s: State, data: Data, { columns, rows: height }: Size) {
  const rows = rowsOf(s, data);
  const focused = rows[s.cursor];
  const at = (kind: Row['kind'], i?: number) => isRow(focused, kind, i);
  const titleW = Math.max(...data.pages.map((p) => width(p.title)));
  const ups = changeList(s, data);
  const body = [
    `    ${pad('Core', titleW)}  ${data.core}`,
    ...data.pages.map((p, i) => {
      const c = COLORS[p.id] ?? 'white';
      return `${pointer(at('page', i))} ${paint(c, '●')} ${paint(['bold', c], pad(p.title, titleW))}  ${pageValue(p, s, data)}`;
    }),
    ...(rows.some((r) => r.kind === 'updates')
      ? [
          '',
          `${pointer(at('updates'))} ${paint('yellow', ups.update.length ? `↑ ${ups.update.length} updates` : '↑ updates skipped')}`,
        ]
      : []),
  ];
  const apply = ups.count ? paint(['bold', 'green', 'inverse'], ` Apply ${ups.count} changes `) : 'Nothing to change';
  // Frame top and bottom plus the two lines under it; the body scrolls around the focused row.
  const focus = at('updates') ? body.length - 1 : 1 + (focused?.kind === 'page' ? focused.i : 0);
  return [
    ...frame(
      `${paint(['bold', 'magenta'], 'dead-claude-skills')} ${data.version}`,
      scroll(body, focus, Math.max(1, height - 4)),
      { columns },
    ),
    `${pointer(at('apply'))} ${apply}   ${pointer(at('quit'))} Quit`,
    '↑↓ move  enter open  esc quit',
  ];
}

function listScreen(s: State, data: Data, { columns, rows: height }: Size) {
  const inner = Math.max(columns - 1, 8) - 4;
  const list = rowsOf(s, data);
  const page = data.pages[s.page];
  const updates = s.screen === 'updates';
  const labelW = Math.max(
    6,
    ...list
      .flatMap((r) => (r.kind === 'item' ? [r.key] : r.kind === 'update' ? [r.id] : []))
      .map((k) => width(nameOf(k))),
  );
  const lines = list.map((r, i) => {
    const p = pointer(i === s.cursor);
    if (r.kind !== 'item' && r.kind !== 'update') return `${p} ← Back`;
    if (r.kind === 'update') {
      const what = s.skip[r.id] ? 'skip' : paint('yellow', 'will update');
      return `${p} ${pad(nameOf(r.id), labelW)}  ${r.from} → ${r.to}  ${what}`;
    }
    const name = pad(data.describe(r.key).label, labelW);
    return `${p} ${page.id === 'danger' ? paint('red', name) : name}  ${stateOf(r.key, s, data)}`;
  });
  const focused = list[s.cursor];
  const detail =
    focused?.kind === 'item'
      ? [data.describe(focused.key).detail, focused.key === 'strip-defaults' && 'one-way, nothing to undo']
          .filter(Boolean)
          .join(' · ')
      : '';
  let head = updates ? [] : [...cap(wrap(page.blurb, inner), 1), ''];
  let tail = detail ? ['', ...cap(wrap(detail, inner), 2)] : [];
  // Frame top and bottom plus the hint line under it; on tiny terminals the list wins over blurb and description.
  if (head.length + tail.length + 4 > height) tail = [];
  if (head.length + tail.length + 4 > height) head = [];
  const size = Math.max(1, height - head.length - tail.length - 3);
  const title = updates ? 'Updates' : paint(['bold', COLORS[page.id] ?? 'white'], page.title);
  const hint = updates ? '↑↓ move  enter update/skip  esc back' : '↑↓ move  enter install/remove  esc back';
  return [...frame(title, [...head, ...scroll(lines, s.cursor, size), ...tail], { columns }), hint];
}

function reviewScreen(s: State, data: Data, { columns, rows: height }: Size) {
  const inner = Math.max(columns - 1, 8) - 4;
  const c = changeList(s, data);
  const name = (k: string) => `${nameOf(k)}${data.tokens.includes(k) ? ' (finish in Claude Code)' : ''}`;
  const nameW = Math.max(0, ...c.update.map((u) => width(nameOf(u.id))));
  const groups = (
    [
      ['Install', 'green', c.install.map(name)],
      ['Remove', 'red', [...c.remove.map(name), ...c.retired.map(name), ...c.sweep]],
      ['Update', 'yellow', c.update.map((u) => `${pad(nameOf(u.id), nameW)}  ${u.from} → ${u.to}`)],
      ['Turn on', 'green', c.on.map((k) => LABELS[k] ?? k)],
      ['Turn off', 'red', c.off.map((k) => LABELS[k] ?? k)],
      ['Danger', ['bold', 'red'], c.danger.map((k) => `${k}: ${HINTS[k]}`)],
    ] satisfies [string, Style, string[]][]
  ).filter(([, , items]) => items.length);
  const body = groups.length
    ? groups.flatMap(([label, color, items]) =>
        items.flatMap((item, i) =>
          wrap(item, Math.max(inner - 10, 4)).map((l, j) => `${pad(i || j ? '' : paint(color, label), 10)}${l}`),
        ),
      )
    : ['Nothing to change.'];
  const hidden = data.hidden.length
    ? wrap(
        `Not available on ${data.platform}: ${data.hidden.map((h) => `${nameOf(h.key)} (${h.why})`).join(', ')}`,
        inner,
      )
    : [];
  // Frame top and bottom, the blank and Unchanged lines, and the choices row.
  const room = Math.max(1, height - 5 - hidden.length);
  const choices = [c.count ? `Apply ${c.count} changes` : 'Apply', 'Back', 'Quit']
    .map((t, i) => `${pointer(i === s.cursor)} ${i === 0 && c.count ? paint(['bold', 'green'], t) : t}`)
    .join('   ');
  return [
    ...frame(
      paint('bold', 'This will change'),
      [
        ...more(body, room),
        '',
        `Unchanged: ${c.unchanged.installed} installed, ${c.unchanged.notInstalled} not installed`,
        ...hidden,
      ],
      { columns },
    ),
    choices,
  ];
}

// The lines for state's screen, each at most columns - 1 wide.
export function render(s: State, data: Data, { columns, rows }: Size) {
  const size = { columns, rows };
  const lines =
    s.screen === 'start'
      ? startScreen(s, data, size)
      : s.screen === 'review'
        ? reviewScreen(s, data, size)
        : listScreen(s, data, size);
  return lines.map((l) => fitLine(l, columns));
}
