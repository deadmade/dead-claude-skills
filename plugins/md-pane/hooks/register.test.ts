import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import type { Engine } from 'claude-code/testing';

type Files = Record<string, string>;

// Fakes the host beneath the plugin: a file system of `files` (absolute paths) and `dirs`, the session's cwd, and a
// bottom render hook standing for the engine that records the props it was handed.
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
  on('session.cwd', () => ({ value: cwd }));
  on('fs.stat', (_$, e) => {
    stats[e.path] = (stats[e.path] ?? 0) + 1;
    if (dirs.includes(e.path)) return { value: { kind: 'directory', size: 0, mtimeMs: 1, isLink: false } } as never;
    const text = files[e.path];
    if (text === undefined) return { deny: 'ENOENT' };
    return { value: { kind: 'file', size: text.length, mtimeMs: mtimes[e.path] ?? 1, isLink: false } } as never;
  });
  on('fs.read', (_$, e) => {
    reads[e.path] = (reads[e.path] ?? 0) + 1;
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
  return { clock, files, mtimes, stats, reads, opens, closes, toasts, states, seen };
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

test('pressing a link reaches the plugin', async ($, on) => {
  const h = host(on, { files: { '/proj/docs/s.md': '# S' } });
  const m = await reply($, 'Spec: docs/s.md');
  await m.press({ key: 'reply', link: { href: 'file:///proj/docs/s.md' } });
  expect(h.toasts).toEqual(['file:///proj/docs/s.md']);
});
