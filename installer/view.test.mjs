process.env.FORCE_COLOR = '1';
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { stripVTControlCharacters: plain } = await import('node:util');
const { changeList, frame, initial, move, render, wrap } = await import('./view.mjs');

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

const text = (s, d = data, size = { columns: 80, rows: 30 }) => render(s, d, size).map(plain).join('\n');

test('start shows kept, pending + and −, toggles and the Apply count', () => {
  const s = { ...initial(chosen), chosen: { ...chosen, [azure]: true, [atlassian]: false } };
  const out = text(s);
  assert.match(out, /Integrations\s+\+ mcp-azure {2}− atlassian/);
  assert.match(out, /System\s+sandbox on, status line off/);
  assert.match(out, /dead-skills \+ 7, always installed/);
  assert.match(out, /Apply 2 changes/);
  assert.ok(render(s, data, { columns: 80, rows: 30 }).join('\n').includes('\x1b[32m+ mcp-azure'));
});

test('start lists updates; idle start reads Nothing to change and so does the review', () => {
  assert.match(text(initial(chosen)), /↑ 1 updates?/);
  const idle = { ...initial(chosen), skip: { [atlassian]: true } };
  assert.match(text(idle), /Nothing to change/);
  assert.match(text({ ...idle, screen: 'review' }), /Nothing to change\./);
});

test('empty categories read none', () => {
  const d = { ...data, pages: [...pages, { id: 'lsp', title: 'Language servers', blurb: 'b', keys: [`nix-lsp@${M}`] }] };
  assert.match(text(initial(chosen), d), /Language servers\s+none/);
});

test('category states are words', () => {
  const s = { ...initial(chosen), screen: 'category', page: 0, chosen: { ...chosen, [azure]: true, [atlassian]: false } };
  const out = text(s);
  assert.match(out, /mcp-azure\s+will install/);
  assert.match(out, /mcp-github\s+not installed/);
  assert.match(out, /atlassian\s+will remove \(installed 0\.1\.0\)/);
  assert.match(text({ ...s, chosen }), /atlassian\s+outdated 0\.1\.0 → 0\.1\.1/);
  const d = { ...data, updates: [], disabled: { [atlassian]: true } };
  assert.match(text({ ...s, chosen }, d), /atlassian\s+installed 0\.1\.0, disabled/);
  const sys = { ...s, page: 1, chosen: { ...chosen, ccstatusline: true } };
  assert.match(text(sys), /sandbox\s+on/);
  assert.match(text(sys), /ccstatusline\s+will turn on/);
});

test('category shows the focused item description, none on ← Back', () => {
  const s = { ...initial(chosen), screen: 'category', page: 0, cursor: 1 };
  assert.match(text(s), /About mcp-azure\./);
  assert.doesNotMatch(text({ ...s, cursor: 0 }), /About/);
});

test('updates screen shows from → to and skip', () => {
  const s = { ...initial(chosen), screen: 'updates' };
  assert.match(text(s), /atlassian\s+0\.1\.0 → 0\.1\.1\s+will update/);
  assert.match(text({ ...s, skip: { [atlassian]: true } }), /atlassian\s+0\.1\.0 → 0\.1\.1\s+skip/);
});

test('review lists only non-empty groups, token note and platform', () => {
  const s = { ...initial(chosen), screen: 'review', chosen: { ...chosen, [azure]: true, [github]: true, [atlassian]: false } };
  const out = text(s);
  assert.match(out, /Install\s+mcp-azure/);
  assert.match(out, /mcp-github \(finish in Claude Code\)/);
  assert.match(out, /Remove\s+atlassian/);
  assert.doesNotMatch(out, /Turn on|Update/);
  assert.match(out, /Unchanged: 1 installed, 1 not installed/);
  assert.match(out, /Not available on linux-x64: nix-lsp \(nixd is not available\)/);
  assert.match(out, /Apply 3 changes\s+Back\s+Quit/);
});

test('every line fits narrow terminals', () => {
  for (const columns of [20, 40]) {
    for (const screen of ['start', 'category', 'updates', 'review']) {
      const lines = render({ ...initial(chosen), screen, chosen: { ...chosen, [azure]: true } }, data, { columns, rows: 30 });
      assert.ok(lines.every((l) => plain(l).length <= columns - 1), `${screen}@${columns}\n${lines.map(plain).join('\n')}`);
    }
  }
});

test('short terminals scroll the list and keep the cursor row', () => {
  const keys = [1, 2, 3, 4, 5, 6, 7].map((i) => `p${i}@${M}`);
  const d = { ...data, pages: [{ id: 'workflow', title: 'Workflows & skills', blurb: 'x '.repeat(30), keys }] };
  const lines = render({ ...initial({}), screen: 'category', page: 0, cursor: 7 }, d, { columns: 40, rows: 12 });
  assert.ok(lines.length <= 12, lines.map(plain).join('\n'));
  assert.match(lines.map(plain).join('\n'), /❯ p7/);
});

test('every screen fits short, narrow terminals', () => {
  const keys = [1, 2, 3, 4, 5, 6, 7].map((i) => `p${i}@${M}`);
  const long = 'A long description that wraps over several lines on a narrow terminal. '.repeat(3);
  const d = { ...data, describe: () => ({ label: 'p', detail: long }),
    pages: [{ id: 'workflow', title: 'Workflows & skills', blurb: long, keys }, ...pages] };
  const many = { ...initial({}), chosen: Object.fromEntries(keys.map((k) => [k, true])) };
  for (const [columns, rows] of [[30, 12], [20, 12], [80, 10]]) {
    for (const s of [{ ...many, screen: 'category', cursor: 7 }, { ...many, screen: 'review' }, many]) {
      const lines = render(s, d, { columns, rows });
      assert.ok(lines.length <= rows, `${s.screen}@${columns}x${rows}: ${lines.length}\n${lines.map(plain).join('\n')}`);
    }
  }
  const review = render({ ...many, screen: 'review' }, d, { columns: 80, rows: 10 }).map(plain);
  assert.match(review.at(-1), /Apply 9 changes/);
  assert.ok(review.some((l) => /… \d+ more/.test(l)));
});

test('review lists what strip-defaults sweeps away and counts it', () => {
  const d = { ...data, sweep: [`foreign@other`, 'marketplace other'] };
  const s = { ...initial({ ...chosen, 'strip-defaults': true }), screen: 'review' };
  const out = text(s, d);
  assert.match(out, /Remove\s+foreign@other/);
  assert.match(out, /marketplace other/);
  assert.equal(changeList(s, d).count, 3); // 2 swept + the atlassian update (no danger page in the fixture)
  assert.equal(changeList({ ...s, chosen }, d).count, 1);
});

test('review always lists retired plugins for removal and counts them', () => {
  const d = { ...data, retired: ['dev-feature@dead-claude-skills'] };
  const s = { ...initial({ ...chosen }), screen: 'review' };
  assert.match(text(s, d), /Remove\s+dev-feature/);
  assert.equal(changeList(s, d).count, 2); // retired + the atlassian update
});
