process.env.FORCE_COLOR = '1';
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { stripVTControlCharacters: plain } = await import('node:util');
const { changeList, frame, initial, move, wrap } = await import('./view.mjs');

const M = 'dead-claude-skills';
const azure = `mcp-azure@${M}`;
const github = `mcp-github@${M}`;
const atlassian = `atlassian@${M}`;
const pages = [
  { id: 'mcp', title: 'Integrations', blurb: 'MCP servers for the services you work with.', keys: [azure, github, atlassian] },
  { id: 'system', title: 'System', blurb: 'Status line, sandbox and command guard.', keys: ['sandbox', 'ccstatusline'] },
];
const current = { [azure]: false, [github]: false, [atlassian]: true, sandbox: true, ccstatusline: false };
const chosen = { ...current };
const data = {
  version: '0.1.1', platform: 'linux-x64', pages, current,
  versions: { [atlassian]: '0.1.0' }, disabled: {}, tokens: [github],
  describe: (k) => ({ label: k.split('@')[0], detail: `About ${k.split('@')[0]}.` }),
  updates: [{ id: atlassian, from: '0.1.0', to: '0.1.1' }],
  core: 'dead-skills + 7, always installed', hidden: [{ key: `nix-lsp@${M}`, why: 'nixd is not available' }],
};
const press = (s, ...keys) => keys.reduce((st, k) => move(st, k, data), s);

test('changeList groups changes and drops updates of removed plugins', () => {
  const s = { ...initial(chosen), chosen: { ...chosen, [azure]: true, [atlassian]: false, ccstatusline: true } };
  const r = changeList(s, data);
  assert.deepEqual([r.install, r.remove, r.on, r.off, r.danger, r.update], [[azure], [atlassian], ['ccstatusline'], [], [], []]);
  assert.equal(r.count, 3);
  assert.deepEqual(r.unchanged, { installed: 1, notInstalled: 1 });
});

test('changeList respects skip and counts the pending update', () => {
  assert.equal(changeList({ ...initial(chosen), skip: { [atlassian]: true } }, data).count, 0);
  assert.equal(changeList(initial(chosen), data).count, 1);
});

test('down/up wrap over start rows: pages, Updates, Apply, Quit', () => {
  const s = press(initial(chosen), 'up');
  assert.equal(s.cursor, 4);
  assert.equal(move(s, 'down', data).cursor, 0);
});

test('enter on a page opens it, esc returns with the page row focused', () => {
  const s = press(initial(chosen), 'down', 'return');
  assert.deepEqual([s.screen, s.page, s.cursor], ['category', 1, 0]);
  const back = move(s, 'escape', data);
  assert.deepEqual([back.screen, back.cursor], ['start', 1]);
});

test('enter on an item toggles it, again undoes it; enter on ← Back returns', () => {
  const on = press(initial(chosen), 'return', 'down', 'return');
  assert.equal(on.chosen[azure], true);
  assert.equal(move(on, 'return', data).chosen[azure], false);
  const back = press(on, 'up', 'return');
  assert.deepEqual([back.screen, back.cursor, back.chosen[azure]], ['start', 0, true]);
});

test('updates rows toggle skip; removing the plugin hides the Updates row', () => {
  const s = press(initial(chosen), 'down', 'down', 'return', 'down', 'return');
  assert.equal(s.screen, 'updates');
  assert.equal(s.skip[atlassian], true);
  const removed = { ...initial(chosen), chosen: { ...chosen, [atlassian]: false } };
  // pages, then Apply, then Quit: no Updates row.
  assert.equal(press(removed, 'up').cursor, 3);
});

test('esc on start: quit when idle, ask-quit with changes', () => {
  assert.equal(move({ ...initial(chosen), skip: { [atlassian]: true } }, 'escape', data).result, 'quit');
  assert.equal(move(initial(chosen), 'escape', data).result, 'ask-quit');
});

test('Apply opens review; review Apply/Back/Quit', () => {
  const review = press(initial(chosen), 'up', 'up', 'return');
  assert.deepEqual([review.screen, review.cursor], ['review', 0]);
  assert.equal(move(review, 'return', data).result, 'apply');
  const back = press({ ...review, chosen: { ...chosen, [azure]: true } }, 'right', 'return');
  assert.deepEqual([back.screen, back.chosen[azure], back.result], ['start', true, undefined]);
  assert.equal(press(review, 'right', 'right', 'return').result, 'quit');
  assert.equal(press(review, 'escape').screen, 'start');
});

test('frame cuts long lines and stays one under the width; wrap never cuts', () => {
  const out = frame('T', ['x'.repeat(100), 'short'], { columns: 30 });
  assert.ok(out.every((l) => plain(l).length === 29), out.map(plain).join('\n'));
  assert.ok(plain(out[1]).includes('…'));
  const url = 'https://github.com/settings/personal-access-tokens/new';
  assert.equal(wrap(url, 20).join(''), url);
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
});
