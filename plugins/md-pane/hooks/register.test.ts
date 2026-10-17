import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import type { Engine } from 'claude-code/testing';

type Files = Record<string, string>;

// Fakes the host beneath the plugin: a file system of `files` (absolute paths) and `dirs`, the session's cwd, and a
// bottom render hook standing for the engine that records the props it was handed. A read of a path in `gates` waits
// for that promise (and first calls `started`'s callback for it); `sizes` overrides a file's reported size.
function host(on: On, { files = {}, dirs = [], cwd = '/proj' }: { files?: Files; dirs?: string[]; cwd?: string } = {}) {
  const clock = mock.clock(on);
  mock.env(on, { HOME: '/home/u' });
  const stats: Record<string, number> = {};
  const reads: Record<string, number> = {};
  const opens: unknown[] = [];
  const closes: unknown[] = [];
  const toasts: string[] = [];
  const states: unknown[] = [];
  const seen: Record<string, unknown>[] = [];
  const mtimes: Record<string, number> = {};
  const sizes: Record<string, number> = {};
  const gates: Record<string, Promise<void>> = {};
  const started: Record<string, () => void> = {};
  on('session.cwd', () => ({ value: cwd }));
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }));
  // On a Linux host the kit resolves `C:/…` against its own cwd; keep from the drive letter on.
  const at = (path: string) => path.replace(/^.*?(?=[A-Za-z]:\/)/, '');
  on('fs.stat', (_$, ev) => {
    const e = { path: at(ev.path) };
    stats[e.path] = (stats[e.path] ?? 0) + 1;
    if (dirs.includes(e.path)) return { value: { kind: 'directory', size: 0, mtimeMs: 1, isLink: false } } as never;
    const text = files[e.path];
    if (text === undefined) return { deny: 'ENOENT' };
    const size = sizes[e.path] ?? text.length;
    return { value: { kind: 'file', size, mtimeMs: mtimes[e.path] ?? 1, isLink: false } } as never;
  });
  on('fs.read', async (_$, ev) => {
    const e = { path: at(ev.path) };
    reads[e.path] = (reads[e.path] ?? 0) + 1;
    started[e.path]?.();
    await gates[e.path];
    const text = files[e.path];
    return text === undefined ? { deny: 'ENOENT' } : { value: text };
  });
  on('ui.open', (_$, e) => {
    opens.push(e);
    return { value: { isPlaced: true as const } };
  });
  on('ui.close', (_$, e) => {
    closes.push(e);
    return { value: undefined } as never;
  });
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('state.set', (_$, e, next) => {
    states.push(e.value);
    return next(e);
  });
  on('ui.render', ($, e) => {
    seen.push(e.props as Record<string, unknown>);
    return $.ui.resolve(e).Text({ children: 'engine' }) as never;
  });
  return { clock, files, mtimes, sizes, gates, started, stats, reads, opens, closes, toasts, states, seen };
}

const FULL = { columns: 120, rows: 40, isFullscreen: true };

const reply = ($: Engine, text: string, extra: object = {}) =>
  $.ui.mount({
    plugin: 'md-pane',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: FULL,
    ...extra,
  } as never);

test('a reply naming an existing md file is redrawn with a pressable link', async ($, on) => {
  host(on, { files: { '/proj/docs/s.md': '# S' } });
  const m = await reply($, 'Spec: docs/s.md');
  const md = await m.find({ type: 'Markdown', key: 'reply' });
  expect(md?.text).toBe('Spec: [docs/s.md](file:///proj/docs/s.md)');
  expect((md?.props as { pressableLinks?: string[] }).pressableLinks).toEqual(['file:///proj/docs/s.md']);
});

test("a reply naming only missing files or folders is the engine's own", async ($, on) => {
  const h = host(on, { dirs: ['/proj/x.md'] });
  await reply($, 'See gone.md and x.md');
  expect(h.seen.at(-1)?.text).toBe('See gone.md and x.md');
});

test('the main-screen terminal, other surfaces and summaries are left alone', async ($, on) => {
  const h = host(on, { files: { '/proj/docs/s.md': '# S' } });
  await reply($, 'Spec: docs/s.md', { viewport: { ...FULL, isFullscreen: false } });
  expect(h.seen.at(-1)?.text).toBe('Spec: docs/s.md');
  await reply($, 'Spec: docs/s.md', { surface: 'desktop' });
  expect(h.seen.at(-1)?.text).toBe('Spec: docs/s.md');
  await reply($, 'Spec: docs/s.md', { props: { text: 'Spec: docs/s.md', isFirstOfReply: true, isSummary: true } });
  expect(h.seen.at(-1)?.text).toBe('Spec: docs/s.md');
});

test('an existing file is statted once', async ($, on) => {
  const h = host(on, { files: { '/proj/docs/s.md': '# S' } });
  await reply($, 'Spec: docs/s.md');
  await reply($, 'Spec: docs/s.md');
  expect(h.stats['/proj/docs/s.md']).toBe(1);
});

test('a missing file is statted once within 2 s, again after', async ($, on) => {
  const h = host(on);
  for (let i = 0; i < 3; i++) await reply($, 'Plan: later.md');
  expect(h.stats['/proj/later.md']).toBe(1);
  await h.clock.advance(2001);
  await reply($, 'Plan: later.md');
  expect(h.stats['/proj/later.md']).toBe(2);
});

test('a file created after a miss is linked once the miss expires', async ($, on) => {
  const h = host(on);
  await reply($, 'Plan: later.md');
  h.files['/proj/later.md'] = '# L';
  await h.clock.advance(2001);
  const m = await reply($, 'Plan: later.md');
  expect((await m.find({ type: 'Markdown', key: 'reply' }))?.text).toBe('Plan: [later.md](file:///proj/later.md)');
});

test('repeated mentions give one pressable link', async ($, on) => {
  host(on, { files: { '/proj/docs/s.md': '# S' } });
  const m = await reply($, 'docs/s.md, again `docs/s.md` and [it](docs/s.md)');
  const md = await m.find({ type: 'Markdown', key: 'reply' });
  expect((md?.props as { pressableLinks?: string[] }).pressableLinks).toEqual(['file:///proj/docs/s.md']);
});

test("an over-long reply is the engine's own", async ($, on) => {
  const h = host(on, { files: { '/proj/docs/s.md': '# S' } });
  const text = `${'x'.repeat(100_000)} docs/s.md`;
  await reply($, text);
  expect(h.seen.at(-1)?.text).toBe(text);
});

const PANE_TARGET = {
  plugin: 'md-pane',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'md-pane',
  viewport: FULL,
  props: {
    title: 'md-pane',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 38 },
    view: {},
  },
} as const;

type Node = { type?: string; children?: unknown[] };
type Drawn = {
  drawn: () => Promise<unknown>;
  find: (q: object) => Promise<{ text?: string; props: Record<string, unknown> } | undefined>;
};
// The kit keeps keys only on pressable elements, so the pane's Text lines are read from the drawn tree, in order.
const texts = async (p: Drawn) =>
  (((await p.drawn()) as Node).children ?? [])
    .filter((c): c is Node => (c as Node).type === 'Text')
    .map((c) => String(c.children?.[0]));
const header = async (p: Drawn) => (await texts(p))[0];
const message = async (p: Drawn) => (await texts(p))[1];
const docText = async (p: Drawn) => (await p.find({ type: 'Markdown', key: 'doc' }))?.text;
const press = async ($: Engine, text: string, href: string) =>
  (await reply($, text)).press({ key: 'reply', link: { href } });
// Holds the next read of `path` until `release()`; `reading` settles once that read has begun.
const hold = (h: ReturnType<typeof host>, path: string) => {
  let release!: () => void;
  h.gates[path] = new Promise<void>((r) => (release = r));
  const reading = new Promise<void>((r) => (h.started[path] = r));
  return { release, reading };
};

test('pressing a reply link opens the document', async ($, on) => {
  const h = host(on, { files: { '/proj/docs/s.md': '# Spec' } });
  await press($, 'Spec: docs/s.md', 'file:///proj/docs/s.md');
  expect(h.opens).toEqual([{ id: 'md-pane', title: 's.md', focus: true, closeOnEscape: true }]);
  const p = await $.ui.mount(PANE_TARGET);
  expect(await header(p)).toBe('s.md');
  expect(await docText(p)).toBe('# Spec');
});

test('pressing another link swaps the document', async ($, on) => {
  host(on, { files: { '/proj/a.md': 'A', '/proj/b.md': 'B' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await press($, 'b.md', 'file:///proj/b.md');
  const p = await $.ui.mount(PANE_TARGET);
  expect(await header(p)).toBe('b.md');
  expect(await docText(p)).toBe('B');
});

test('pressing the open one reads nothing', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await press($, 'a.md', 'file:///proj/a.md');
  expect(h.reads['/proj/a.md']).toBe(1);
  expect(h.opens.length).toBe(2);
});

test('a link inside the document opens relative to it', async ($, on) => {
  host(on, { files: { '/proj/docs/s.md': 'See [flow](flow.md).', '/proj/docs/flow.md': 'F' } });
  await press($, 'docs/s.md', 'file:///proj/docs/s.md');
  const p = await $.ui.mount(PANE_TARGET);
  expect(await docText(p)).toBe('See [flow](file:///proj/docs/flow.md).');
  await p.press({ key: 'doc', link: { href: 'file:///proj/docs/flow.md' } });
  expect(await header(p)).toBe('flow.md');
});

test('a repo-relative path inside the document falls back to the cwd', async ($, on) => {
  host(on, { files: { '/proj/docs/s.md': 'Flow: docs/features/x/flow.md', '/proj/docs/features/x/flow.md': 'F' } });
  await press($, 'docs/s.md', 'file:///proj/docs/s.md');
  const md = await (await $.ui.mount(PANE_TARGET)).find({ type: 'Markdown', key: 'doc' });
  expect(md?.text).toBe('Flow: [docs/features/x/flow.md](file:///proj/docs/features/x/flow.md)');
  expect(md?.props.pressableLinks).toEqual(['file:///proj/docs/features/x/flow.md']);
});

test('a missing file shows a message', async ($, on) => {
  const h = host(on, { files: { '/proj/gone.md': 'G' } });
  const m = await reply($, 'gone.md');
  delete h.files['/proj/gone.md'];
  await m.press({ key: 'reply', link: { href: 'file:///proj/gone.md' } });
  const p = await $.ui.mount(PANE_TARGET);
  expect(await message(p)).toBe("Can't show gone.md: not found.");
  expect(await docText(p)).toBe(undefined);
});

test('a file over 4 MiB is not read', async ($, on) => {
  const h = host(on, { files: { '/proj/big.md': 'B' } });
  h.sizes['/proj/big.md'] = 4 * 1024 * 1024 + 1;
  await press($, 'big.md', 'file:///proj/big.md');
  expect(await message(await $.ui.mount(PANE_TARGET))).toBe("Can't show big.md: larger than 4 MiB.");
  expect(h.reads['/proj/big.md']).toBe(undefined);
});

test('a long, link-heavy document is cut at a line with its links kept', async ($, on) => {
  const lines = Array.from({ length: 3000 }, (_, i) => `line ${i} names docs/f.md here`).join('\n');
  host(on, { files: { '/proj/long.md': lines, '/proj/docs/f.md': 'F' } });
  await press($, 'long.md', 'file:///proj/long.md');
  const md = await (await $.ui.mount(PANE_TARGET)).find({ type: 'Markdown', key: 'doc' });
  expect(md?.text?.endsWith('_Cut at 99 000 characters; open the file elsewhere for the rest._')).toBe(true);
  expect(md!.text!.length).toBeLessThanOrEqual(99_100);
  expect(md?.text).toContain('here\n\n_Cut');
  expect(md?.props.pressableLinks).toEqual(['file:///proj/docs/f.md']);
});

test('the later of two quick presses wins', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A', '/proj/b.md': 'B' } });
  const a = hold(h, '/proj/a.md');
  const first = press($, 'a.md', 'file:///proj/a.md');
  await a.reading;
  await press($, 'b.md', 'file:///proj/b.md');
  a.release();
  await first;
  expect(await header(await $.ui.mount(PANE_TARGET))).toBe('b.md');
});

test('a close during a load keeps the pane closed', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A', '/proj/b.md': 'B' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const b = hold(h, '/proj/b.md');
  const pending = press($, 'b.md', 'file:///proj/b.md');
  await b.reading;
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } } as never);
  b.release();
  await pending;
  expect(h.states.at(-1)).toBe(null);
  expect(h.opens.length).toBe(1);
});

test('q closes the pane', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await (await $.ui.mount(PANE_TARGET)).press({ key: 'q' });
  expect(h.closes.map((c) => (c as { id: string }).id)).toEqual(['md-pane']);
  expect(h.states.at(-1)).toBe(null);
});

test('session end closes the pane', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } } as never);
  expect(h.closes.map((c) => (c as { id: string }).id)).toEqual(['md-pane']);
  expect(h.states.at(-1)).toBe(null);
});

test('a Windows path opens', async ($, on) => {
  const h = host(on, { files: { 'C:/proj/docs/a.md': 'A' }, cwd: 'C:\\proj' });
  const m = await reply($, 'see docs\\a.md');
  const href = ((await m.find({ type: 'Markdown', key: 'reply' }))?.props.pressableLinks as string[])[0]!;
  expect(href).toBe('file:///C:/proj/docs/a.md');
  await m.press({ key: 'reply', link: { href } });
  expect(h.reads['C:/proj/docs/a.md']).toBe(1);
});

const statCount = (h: ReturnType<typeof host>) => Object.values(h.stats).reduce((a, b) => a + b, 0);

test('an edit to the open file redraws the pane', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'old' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const p = await $.ui.mount(PANE_TARGET);
  h.files['/proj/a.md'] = 'new';
  h.mtimes['/proj/a.md'] = 2;
  await h.clock.advance(1000);
  expect(await docText(p)).toBe('new');
});

test('an edit that keeps the mtime but changes the size redraws too', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'old' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const p = await $.ui.mount(PANE_TARGET);
  h.files['/proj/a.md'] = 'longer';
  await h.clock.advance(1000);
  expect(await docText(p)).toBe('longer');
});

test('an unchanged file is not re-read', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await $.ui.mount(PANE_TARGET);
  await h.clock.advance(3000);
  expect(h.reads['/proj/a.md']).toBe(1);
});

test('a deleted then recreated file recovers', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const p = await $.ui.mount(PANE_TARGET);
  delete h.files['/proj/a.md'];
  await h.clock.advance(1000);
  expect(await message(p)).toBe("Can't show a.md: not found.");
  h.files['/proj/a.md'] = 'again';
  await h.clock.advance(1000);
  expect(await docText(p)).toBe('again');
});

test('nothing polls once the pane is closed by q', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const p = await $.ui.mount(PANE_TARGET);
  await h.clock.advance(1000);
  await p.press({ key: 'q' });
  const before = statCount(h);
  await h.clock.advance(3000);
  expect(statCount(h)).toBe(before);
});

test('nothing polls once the session ends', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await $.ui.mount(PANE_TARGET);
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } } as never);
  const before = statCount(h);
  await h.clock.advance(3000);
  expect(statCount(h)).toBe(before);
});

test('a pane opened on a missing file recovers', async ($, on) => {
  const h = host(on, { files: { '/proj/gone.md': 'G' } });
  const m = await reply($, 'gone.md');
  delete h.files['/proj/gone.md'];
  await m.press({ key: 'reply', link: { href: 'file:///proj/gone.md' } });
  const p = await $.ui.mount(PANE_TARGET);
  expect(await message(p)).toBe("Can't show gone.md: not found.");
  h.files['/proj/gone.md'] = 'back';
  await h.clock.advance(1000);
  expect(await docText(p)).toBe('back');
});

test('a swap during a refresh keeps the new document', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A', '/proj/b.md': 'B' } });
  await press($, 'a.md', 'file:///proj/a.md');
  const p = await $.ui.mount(PANE_TARGET);
  h.mtimes['/proj/a.md'] = 2;
  const a = hold(h, '/proj/a.md');
  const ticking = h.clock.advance(1000);
  await a.reading;
  await press($, 'b.md', 'file:///proj/b.md');
  a.release();
  await ticking;
  expect(await header(p)).toBe('b.md');
  expect(await docText(p)).toBe('B');
});

test('a slow refresh is not overlapped by the next ticks', async ($, on) => {
  const h = host(on, { files: { '/proj/a.md': 'A' } });
  await press($, 'a.md', 'file:///proj/a.md');
  await $.ui.mount(PANE_TARGET);
  h.mtimes['/proj/a.md'] = 2;
  const a = hold(h, '/proj/a.md');
  await h.clock.advance(3000);
  await a.reading;
  a.release();
  // Let every started refresh finish inside the test, then count the reads they made.
  for (let i = 0; i < 20; i++) await h.clock.advance(0);
  expect(h.reads['/proj/a.md']).toBe(2);
});
