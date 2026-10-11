process.env.FORCE_COLOR = '1';
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { move } = await import('./tabs.mjs');

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
