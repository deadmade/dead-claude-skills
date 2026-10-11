process.env.FORCE_COLOR = '1';
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { move, render } = await import('./tabs.mjs');
const { stripVTControlCharacters: plain } = await import('node:util');

const pages = [
  { id: 'workflow', title: 'Workflows & skills', blurb: 'B1', keys: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] },
  { id: 'mcp', title: 'Integrations', blurb: 'B2', keys: ['m1', 'm2', 'm3'] },
  { id: 'danger', title: 'Danger zone', blurb: 'B3', keys: ['strip-defaults', 'clean'], bulk: false },
];
const at = (s) => ({ tab: 0, cursor: 0, chosen: {}, ...s });

test('move tabs wrap', () => {
  assert.equal(move(at({ tab: 0 }), 'left', pages).tab, 2);
  assert.equal(move(at({ tab: 2 }), 'right', pages).tab, 0);
});

test('move clamps cursor on tab switch', () => {
  const s = move(at({ tab: 0, cursor: 6 }), 'right', pages);
  assert.deepEqual([s.tab, s.cursor], [1, 2]);
});

test('move up/down wrap', () => {
  assert.equal(move(at({ tab: 1, cursor: 0 }), 'up', pages).cursor, 2);
  assert.equal(move(at({ tab: 1, cursor: 2 }), 'down', pages).cursor, 0);
});

test('move space toggles focused item', () => {
  const on = move(at({ tab: 1, cursor: 1 }), 'space', pages);
  assert.equal(on.chosen.m2, true);
  assert.equal(move(on, 'space', pages).chosen.m2, false);
});

test('move all selects all, then clears', () => {
  const on = move(at({ tab: 1, chosen: { m1: true } }), 'all', pages);
  assert.deepEqual([on.chosen.m1, on.chosen.m2, on.chosen.m3], [true, true, true]);
  const off = move(on, 'all', pages);
  assert.deepEqual([off.chosen.m1, off.chosen.m2, off.chosen.m3], [false, false, false]);
});

test('move all is a no-op without bulk', () => {
  assert.deepEqual(move(at({ tab: 2 }), 'all', pages).chosen, {});
});

const describe = (k) => ({ label: k, detail: `D-${k}` });
const draw = (s, o = {}) => render(at(s), pages, { columns: 200, rows: 40, describe, status: 'active', ...o });
const FOOTER = '←/→ category · ↑/↓ move · space select · a all · enter review · esc quit';

test('render shows full tab bar with counts', () => {
  assert.match(plain(draw({ chosen: { m1: true, m2: true } })), /Workflows & skills │ Integrations 2 │ Danger zone/);
});

test('render falls back to short labels', () => {
  const out = plain(draw({ chosen: { m1: true, m2: true } }, { columns: 40 }));
  assert.match(out, /Workflows │ Integrations 2 │ Danger/);
  assert.doesNotMatch(out, /Workflows & skills/);
  assert.doesNotThrow(() => draw({}, { columns: 10 }));
});

test('render shows blurb, detail and footer', () => {
  const out = plain(draw({ tab: 1, cursor: 1 }));
  for (const s of ['B2', 'D-m2', FOOTER]) assert.ok(out.includes(s), s);
});

test('render drops "a all" without bulk', () => {
  const out = plain(draw({ tab: 2 }));
  assert.ok(out.includes('enter review'));
  assert.ok(!out.includes('a all'));
});

test('render colors danger items red', () => {
  assert.ok(draw({ tab: 2 }).includes('\x1b[31mclean'));
});

test('render fits short terminals', () => {
  const columns = 40;
  const rows = 18;
  const long = (k) => ({ label: k, detail: 'x'.repeat(170) });
  const out = render(at({ tab: 0, cursor: 6 }), pages, { columns, rows, describe: long, status: 'active' });
  const lines = plain(out).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / columns)), 0);
  assert.ok(lines <= rows, `${lines} lines > ${rows}`);
  assert.match(plain(out), /a7/);
  assert.doesNotMatch(plain(out), /a1/);
});

test('render submit frame', () => {
  const out = plain(draw({ chosen: { a1: true, m1: true, clean: true } }, { status: 'submit' }));
  assert.equal(out.split('\n').length, 1);
  assert.match(out, /3 selected/);
});
