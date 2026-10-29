// The view runtime and the shared blocks, in jsdom. Runs in flow-cockpit.yml after `npm ci`, not in `npm test`:
//   node --test crates/flow-cockpit/app/shell/runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

/** @type {{ initialize: unknown[], render: [string, string][] }} */
const mermaidCalls = { initialize: [], render: [] };
let mermaidFails = false;
dom.window.mermaid = {
  initialize: (config) => mermaidCalls.initialize.push(config),
  render: async (id, source) => {
    mermaidCalls.render.push([id, source]);
    if (mermaidFails) throw new Error('Parse error on line 1');
    return { svg: `<svg id="${id}"><g class="node"></g></svg>` };
  },
};

const { createRuntime } = await import('./runtime.js');
const { markdown } = await import('./blocks/markdown.js');
const { diff } = await import('./blocks/diff.js');
const { stepper } = await import('./blocks/stepper.js');
const { card } = await import('./blocks/card.js');

/** Lets the blocks' and the runtime's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Imports a blob URL the way the webview would, through a data: URL Node can import. */
async function importBlob(url) {
  const blob = resolveObjectURL(url);
  assert.ok(blob, `${url} was revoked before its import`);
  assert.equal(blob.type, 'text/javascript');
  const code = Buffer.from(await blob.text()).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}

/** A view module's source, as `view_source` returns it (types already stripped). */
const view = (id, slot, body, title = id) =>
  `export default { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, slot: ${JSON.stringify(slot)}, render(ctx) { ${body} } };`;
/** A render body that returns a paragraph with the text. */
const says = (text) => `const p = document.createElement('p'); p.textContent = ${JSON.stringify(text)}; return p;`;

/**
 * A stand-in for the app: `views` maps an id to `{ source, builtin, from }`, where `source` is what `view_source`
 * answers (a string, or `{ error }`), `builtin` what it answers with `builtin: true`, and `from` the ViewSource.
 */
function fakeApp(views) {
  const listeners = new Map();
  const calls = [];
  const answer = (value) => (value && typeof value === 'object' ? Promise.reject(value.error) : Promise.resolve(value));
  const app = {
    views,
    calls,
    invoke(cmd, args = {}) {
      calls.push([cmd, args]);
      if (cmd === 'views') {
        return Promise.resolve(
          Object.entries(app.views).map(([id, v]) => ({
            id,
            source: v.from ?? 'Builtin',
            replaced: (v.from ?? 'Builtin') !== 'Builtin' && v.builtin !== undefined,
          })),
        );
      }
      if (cmd === 'view_source') {
        const v = app.views[args.id];
        if (!v) return Promise.reject(`no view ${args.id}`);
        if (args.builtin)
          return v.builtin === undefined ? Promise.reject(`no built-in view ${args.id}`) : answer(v.builtin);
        return answer(v.source);
      }
      return Promise.resolve(null);
    },
    listen(name, callback) {
      listeners.set(name, callback);
      return Promise.resolve(() => listeners.delete(name));
    },
    async emit(name, payload) {
      await listeners.get(name)?.({ event: name, payload });
    },
  };
  return app;
}

function freshRoot() {
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  return root;
}

async function started(app, route, options = {}) {
  const root = freshRoot();
  const runtime = createRuntime({ root, invoke: app.invoke, listen: app.listen, importModule: importBlob, ...options });
  await runtime.start(route);
  return { root, runtime };
}

const section = (root, id) => root.querySelector(`section[data-view="${id}"]`);
const RUN = { to: 'run', project: 'p1', slug: 'flow-cockpit' };

/** A view module whose render is `render`, written here as a function: it may use only `ctx` and globals. */
const viewOf = (id, slot, render) =>
  `export default { id: ${JSON.stringify(id)}, title: ${JSON.stringify(id)}, slot: ${JSON.stringify(slot)}, render: ${render} };`;

/** A list view with the state a redraw must keep: scrolled panes, a fold, a stepper, a search box, a diagram. */
function stateful(ctx) {
  globalThis.statefulDraws = (globalThis.statefulDraws ?? 0) + 1;
  const box = document.createElement('div');
  const left = document.createElement('div');
  left.className = 'left';
  const content = document.createElement('div');
  content.className = 'content';
  const fold = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'More';
  fold.append(summary);
  content.append(fold);
  const search = document.createElement('input');
  search.dataset.keep = 'search';
  search.addEventListener('input', () => {
    globalThis.searched = search.value;
  });
  left.append(search, ctx.blocks.stepper([{ label: 'Build', state: 'Now' }]));
  content.append(ctx.blocks.markdown('```mermaid\ngraph TD; X-->Y\n```'));
  box.append(left, content);
  return box;
}

test('markdown_strips_script_and_handlers', () => {
  const node = markdown(
    [
      'Hello **there**. <script>window.pwned = 1</script>',
      '',
      '<img src="x.png" onerror="window.pwned = 2"> <svg><script>window.pwned = 3</script></svg>',
      '',
      '[md link](javascript:alert(1)) <a href="javascript:alert(2)">raw link</a> <a href="JaVaScRiPt:alert(3)">mixed</a>',
      '',
      '<a href="https://example.com/" onclick="window.pwned = 4" onmouseover="x()">fine</a>',
      '',
      '<form action="https://example.com/"><button formaction="javascript:alert(4)">go</button></form>',
      '<style>body { display: none }</style><p style="position: fixed">styled</p>',
    ].join('\n'),
  );
  document.body.replaceChildren(node);
  const html = node.outerHTML.toLowerCase();
  for (const bad of [
    '<script',
    'onerror',
    'onclick',
    'onmouseover',
    'javascript:',
    '<form',
    'formaction',
    '<style',
    'style=',
  ]) {
    assert.ok(!html.includes(bad), `${bad} survived: ${html}`);
  }
  assert.equal(window.pwned, undefined);
  assert.ok(node.querySelector('strong')?.textContent === 'there', 'Markdown still renders');
  assert.equal(node.querySelector('a[href="https://example.com/"]')?.textContent, 'fine');
  // A click on a link never navigates the window away.
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  node.querySelector('a[href="https://example.com/"]').dispatchEvent(click);
  assert.ok(click.defaultPrevented);
});

test('mermaid_fences_become_diagram_nodes', async () => {
  mermaidCalls.render.length = 0;
  const node = markdown('Before.\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nAfter.');
  const diagram = node.querySelector('.diagram');
  assert.ok(diagram, node.outerHTML);
  assert.equal(node.querySelector('code.language-mermaid'), null, 'the fence is replaced, not left as code');
  await settle();
  assert.equal(mermaidCalls.render.length, 1);
  assert.equal(mermaidCalls.render[0][1].trim(), 'graph TD\n  A-->B');
  assert.ok(mermaidCalls.initialize.length >= 1);
  assert.ok(mermaidCalls.initialize.every((c) => c.securityLevel === 'strict' && c.startOnLoad === false));
  assert.ok(diagram.querySelector('svg'), diagram.outerHTML);
});

test('mermaid_failure_keeps_the_source_with_the_reason', async () => {
  mermaidFails = true;
  try {
    const node = markdown('```mermaid\ngraph TD; A-->\n```');
    await settle();
    assert.equal(node.querySelector('.diagram pre')?.textContent.trim(), 'graph TD; A-->');
    assert.match(node.querySelector('.diagram .quiet')?.textContent ?? '', /Parse error on line 1/);
  } finally {
    mermaidFails = false;
  }
});

test('broken_view_falls_back', async () => {
  const app = fakeApp({
    // A global copy of the run view that throws while drawing.
    run: {
      from: 'Global',
      source: view('run', 'run', "throw new Error('boom in run')"),
      builtin: view('run', 'run', says('built-in run')),
    },
    // A global copy whose source doesn't strip.
    broken: {
      from: 'Global',
      source: { error: 'line 3: Unexpected token' },
      builtin: view('broken', 'run', says('built-in broken')),
    },
    // A global copy with no default export.
    nodefault: {
      from: 'Global',
      source: 'export const x = 1;',
      builtin: view('nodefault', 'run', says('built-in nodefault')),
    },
    // A new view (no built-in behind it) that fails to load.
    stray: { from: 'Global', source: { error: 'line 1: a view may only `import type`' } },
    // A view nothing is wrong with.
    fine: { source: view('fine', 'run', says('fine view')) },
  });
  const { root } = await started(app, RUN);

  const run = section(root, 'run');
  assert.match(run.querySelector('.card.error')?.textContent ?? '', /boom in run/);
  assert.ok(run.textContent.includes('built-in run'));
  assert.ok(
    run.querySelector('.card.error').compareDocumentPosition(run.querySelector('p:last-child')) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the built-in draws below the error card',
  );
  const broken = section(root, 'broken');
  assert.match(broken.querySelector('.card.error')?.textContent ?? '', /line 3: Unexpected token/);
  assert.ok(broken.textContent.includes('built-in broken'));
  const nodefault = section(root, 'nodefault');
  assert.match(nodefault.querySelector('.card.error')?.textContent ?? '', /default export/);
  assert.ok(nodefault.textContent.includes('built-in nodefault'));
  // No built-in behind it: the error card alone.
  const stray = section(root, 'stray');
  assert.match(stray.querySelector('.card.error')?.textContent ?? '', /import type/);
  assert.equal(stray.children.length, 1);
  // The others are untouched.
  const fine = section(root, 'fine');
  assert.equal(fine.querySelector('.card.error'), null);
  assert.equal(fine.textContent, 'fine view');
});

test('reload_replaces_view_on_change', async () => {
  const app = fakeApp({ list: { from: 'Global', source: view('list', 'list', says('first draft')) } });
  const { root, runtime } = await started(app, { to: 'list' });
  assert.equal(section(root, 'list').textContent, 'first draft');
  app.views.list.source = view('list', 'list', says('second draft'));
  await app.emit('views-changed', {});
  await runtime.idle();
  assert.equal(section(root, 'list').textContent, 'second draft');
  // A new file adds a view; deleting it takes it away again.
  app.views.extra = { from: 'Global', source: view('extra', 'list', says('extra view')) };
  await app.emit('views-changed', {});
  await runtime.idle();
  assert.equal(section(root, 'extra')?.textContent, 'extra view');
  delete app.views.extra;
  await app.emit('views-changed', {});
  await runtime.idle();
  assert.equal(section(root, 'extra'), null);
});

test('changed_redraws_the_route_of_that_project', async () => {
  let draws = 0;
  const app = fakeApp({
    run: {
      source: view(
        'run',
        'run',
        'globalThis.runDraws = (globalThis.runDraws ?? 0) + 1; return document.createElement("p");',
      ),
    },
  });
  globalThis.runDraws = 0;
  const { runtime } = await started(app, RUN);
  draws = globalThis.runDraws;
  await app.emit('changed', { project: 'another' });
  await runtime.idle();
  assert.equal(globalThis.runDraws, draws, 'another project changed: no redraw');
  await app.emit('changed', { project: 'p1' });
  await runtime.idle();
  assert.equal(globalThis.runDraws, draws + 1);
});

test('changed_redraw_keeps_scroll_folds_and_focus', async () => {
  const app = fakeApp({ list: { source: viewOf('list', 'list', stateful) } });
  const { root, runtime } = await started(app, { to: 'list' });
  await settle();
  const old = section(root, 'list');
  assert.ok(old.querySelector('.diagram svg'), 'the diagram drew before the redraw');
  old.querySelector('.left').scrollTop = 30;
  old.querySelector('.content').scrollTop = 50;
  old.querySelector('.content').scrollLeft = 7;
  old.querySelector('details').open = true;
  old.querySelector('button.track').click();
  const search = old.querySelector('input');
  search.focus();
  search.value = 'abc';
  search.setSelectionRange(1, 2);
  globalThis.searched = undefined;

  await app.emit('changed', { project: 'p1' });
  await runtime.idle();
  const now = section(root, 'list');
  assert.notEqual(now, old, 'the view drew again');
  assert.equal(now.querySelector('.left').scrollTop, 30);
  assert.equal(now.querySelector('.content').scrollTop, 50);
  assert.equal(now.querySelector('.content').scrollLeft, 7);
  assert.ok(now.querySelector('details').open);
  assert.equal(now.querySelector('button.track').getAttribute('aria-expanded'), 'true');
  assert.ok(!now.querySelector('.phase-list').hidden, 'the stepper list stays open');
  const input = now.querySelector('input');
  assert.equal(document.activeElement, input);
  assert.equal(input.value, 'abc');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 2]);
  assert.equal(globalThis.searched, 'abc', 'the view hears the restored text');
  // The diagram doesn't flash back to its source.
  assert.ok(now.querySelector('.diagram svg'));
  assert.equal(now.querySelector('.diagram pre'), null);

  // A new route starts fresh.
  runtime.navigate({ to: 'list', project: 'other' });
  await runtime.idle();
  assert.ok(!section(root, 'list').querySelector('details').open);
});

test('queued_changed_draws_collapse_into_one', async () => {
  const app = fakeApp({ list: { source: viewOf('list', 'list', stateful) } });
  const { runtime } = await started(app, { to: 'list' });
  const before = globalThis.statefulDraws;
  for (let i = 0; i < 5; i++) app.emit('changed', { project: null });
  await runtime.idle();
  assert.equal(globalThis.statefulDraws, before + 1);
});

test('a_render_that_never_settles_becomes_its_error_card', async () => {
  const app = fakeApp({
    stuck: { source: view('stuck', 'list', 'return new Promise(() => {});') },
    fine: { source: view('fine', 'list', says('fine view')) },
  });
  const { root } = await started(app, { to: 'list' }, { renderTimeout: 30 });
  assert.match(section(root, 'stuck').querySelector('.card.error')?.textContent ?? '', /didn't finish/);
  assert.equal(section(root, 'fine').textContent, 'fine view');
});

test('blob_urls_are_revoked', async (t) => {
  const created = [];
  const revoked = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    revoke(url);
  };
  t.after(() => {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  });
  const app = fakeApp({
    good: { source: view('good', 'list', says('good')) },
    throwsOnImport: { source: "throw new Error('at import');" },
    nodefault: { source: 'export const x = 1;' },
  });
  const { root } = await started(app, { to: 'list' });
  assert.equal(section(root, 'good').textContent, 'good');
  assert.equal(created.length, 3);
  assert.deepEqual([...revoked].sort(), [...created].sort());
  for (const url of created) assert.equal(resolveObjectURL(url), undefined);
});

test('views_get_their_route_tabs_and_blocks_through_ctx', async () => {
  const app = fakeApp({
    run: {
      source: view(
        'run',
        'run',
        `const p = document.createElement('p');
         p.textContent = [ctx.route.to, ctx.route.slug, ctx.tabs.map((t) => t.id + ':' + t.title).join(','), Object.keys(ctx.blocks).sort().join(',')].join('|');
         return p;`,
      ),
    },
    activity: { source: view('activity', 'run-tab', says('activity'), 'Activity') },
  });
  const { root } = await started(app, RUN);
  assert.equal(
    section(root, 'run').textContent,
    'run|flow-cockpit|activity:Activity|card,diff,markdown,mermaid,stepper',
  );
  assert.equal(section(root, 'activity'), null, 'a run-tab view draws only when its tab is selected');
});

/** A run view in the design's shape: a frame with a tab bar from ctx.tabs and the slot for a tab's view. */
const RUN_FRAME = `
  const frame = document.createElement('div');
  frame.className = 'window';
  const bar = document.createElement('div');
  bar.className = 'tabs-bar';
  for (const t of ctx.tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.dataset.tab = t.id;
    b.textContent = t.title;
    b.setAttribute('aria-selected', String(ctx.route.tab === t.id));
    b.addEventListener('click', () => ctx.navigate({ ...ctx.route, tab: t.id }));
    bar.append(b);
  }
  const content = document.createElement('div');
  content.className = 'content';
  content.dataset.slot = 'run-tab';
  frame.append(bar, content);
  return frame;`;

test('run_tab_view_lands_in_its_slot', async () => {
  const app = fakeApp({
    run: { source: view('run', 'run', RUN_FRAME) },
    activity: { source: view('activity', 'run-tab', says('activity drawn'), 'Activity') },
  });
  const { root, runtime } = await started(app, RUN);
  root.querySelector('button[data-tab="activity"]').click();
  await runtime.idle();
  const slot = root.querySelector('[data-slot="run-tab"]');
  assert.equal(section(slot, 'activity')?.textContent, 'activity drawn');
});

test('run_frame_and_bar_stay_when_a_tab_is_selected', async () => {
  const app = fakeApp({
    run: { source: view('run', 'run', RUN_FRAME) },
    activity: { source: view('activity', 'run-tab', says('activity drawn'), 'Activity') },
  });
  const { root } = await started(app, { ...RUN, tab: 'activity' });
  const run = section(root, 'run');
  assert.ok(run.querySelector('.window > .tabs-bar'), 'the run view keeps its frame and bar');
  assert.equal(run.querySelector('button[data-tab="activity"]').getAttribute('aria-selected'), 'true');
  assert.ok(run.querySelector('[data-slot="run-tab"] section[data-view="activity"]'));
});

test('broken_run_tab_view_shows_its_error_inside_the_slot', async () => {
  const app = fakeApp({
    run: { source: view('run', 'run', RUN_FRAME) },
    activity: { source: view('activity', 'run-tab', "throw new Error('activity broke')", 'Activity') },
  });
  const { root } = await started(app, { ...RUN, tab: 'activity' });
  const slot = section(root, 'run').querySelector('[data-slot="run-tab"]');
  assert.match(slot.querySelector('.card.error')?.textContent ?? '', /activity broke/);
  assert.ok(section(root, 'run').querySelector('.tabs-bar button[data-tab="activity"]'), 'the run view keeps working');
});

test('run_tab_view_is_appended_without_a_slot', async () => {
  const app = fakeApp({
    run: {
      from: 'Global',
      source: view('run', 'run', says('my own run view')),
      builtin: view('run', 'run', RUN_FRAME),
    },
    activity: { source: view('activity', 'run-tab', says('activity drawn'), 'Activity') },
  });
  const { root } = await started(app, { ...RUN, tab: 'activity' });
  assert.deepEqual(
    [...root.children].map((s) => s.dataset.view),
    ['run', 'activity'],
  );
});

test('a_tab_that_isnt_loaded_says_so_in_the_slot', async () => {
  const app = fakeApp({ run: { source: view('run', 'run', RUN_FRAME) } });
  const { root } = await started(app, { ...RUN, tab: 'nope' });
  const slot = section(root, 'run').querySelector('[data-slot="run-tab"]');
  assert.match(slot.textContent, /The nope tab isn't loaded/);
});

test('session_route_draws_the_session_view_not_the_run_view', async () => {
  const app = fakeApp({
    run: { source: view('run', 'run', RUN_FRAME) },
    activity: {
      source: viewOf(
        'activity',
        ['run-tab', 'session'],
        `(ctx) => {
        const p = document.createElement('p');
        p.textContent = ctx.route.to + ':' + ctx.route.id;
        return p;
      }`,
      ),
    },
  });
  const { root } = await started(app, { to: 'session', project: 'p1', id: 's-1' });
  assert.equal(section(root, 'run'), null, 'the run view is not drawn');
  assert.equal(section(root, 'activity')?.textContent, 'session:s-1');

  // The same view still serves as the run's Activity tab.
  const { root: runRoot } = await started(app, { ...RUN, tab: 'activity' });
  const slot = section(runRoot, 'run').querySelector('[data-slot="run-tab"]');
  assert.equal(section(slot, 'activity')?.textContent, 'run:undefined');
});

test('a_slot_list_with_an_unknown_slot_is_a_load_error', async () => {
  const app = fakeApp({ odd: { source: viewOf('odd', ['run-tab', 'nope'], '() => document.createElement("p")') } });
  const { root } = await started(app, { to: 'list' });
  assert.match(section(root, 'odd')?.textContent ?? '', /"nope" isn't one of/);
});

test('an_empty_slot_list_is_a_load_error', async () => {
  const app = fakeApp({ none: { source: viewOf('none', [], '() => document.createElement("p")') } });
  const { root } = await started(app, { to: 'list' });
  assert.match(section(root, 'none')?.textContent ?? '', /its slot list is empty/);
});

test('a_route_without_views_says_so', async () => {
  const app = fakeApp({});
  const { root } = await started(app, { to: 'list' });
  assert.match(root.querySelector('.empty')?.textContent ?? '', /No view draws this screen/);
});

test('card_string_body_is_text', () => {
  const node = card({ title: '<b>t</b>', meta: 'meta <i>m</i>', body: '<img src=x onerror="window.pwned = 5">' });
  assert.equal(node.querySelector('img'), null);
  assert.equal(node.querySelector('.card-h').textContent, '<b>t</b>');
  assert.equal(node.querySelector('.card-body').textContent, '<img src=x onerror="window.pwned = 5">');
  assert.ok(!node.classList.contains('error'));
  const error = card({ title: 'Broken', body: document.createTextNode('why'), error: true });
  assert.ok(error.classList.contains('error'));
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.querySelector('.card-body').textContent, 'why');
});

test('diff_marks_lines_and_folds_unchanged_runs', () => {
  const old = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
  const next = old.replace('line 2\n', 'line two\n').replace('line 15', 'line fifteen') + '\nline 20';
  const node = diff(old, next);
  const text = (sel) => [...node.querySelectorAll(sel)].map((n) => n.textContent.trim());
  assert.deepEqual(text('.ln.del'), ['- line 2', '- line 15']);
  assert.deepEqual(text('.ln.add'), ['+ line two', '+ line fifteen', '+ line 20']);
  const fold = node.querySelector('details.unfold');
  assert.ok(fold, 'the unchanged run between the changes folds');
  // The design's fold row: a label and a count.
  assert.equal(fold.querySelector('summary > span:first-child').textContent, 'Unchanged');
  assert.equal(fold.querySelector('summary > .count').textContent, '6 lines');
  assert.match(diff('same', 'same').textContent, /No change/);
  assert.equal(diff('<b>x</b>', '<i>y</i>').querySelector('b, i'), null);
});

test('stepper_marks_done_current_and_gates', () => {
  const node = stepper([
    { label: 'Research', state: 'Done', gate: { n: 1, approved: '2026-10-28' } },
    { label: 'Build', state: 'Now', gate: { n: 2, approved: null } },
    { label: 'Ship', state: 'Later' },
  ]);
  document.body.replaceChildren(node);
  assert.deepEqual(
    [...node.querySelectorAll('.segs > span')].map((s) => s.className.trim()),
    ['seg done', 'tick passed', 'seg current', 'tick', 'seg'],
  );
  assert.match(node.querySelector('.track-text').textContent, /Build, phase 2 of 3/);
  assert.match(node.querySelector('.track-gates').textContent, /Gate 2 is open/);
  const button = node.querySelector('button.track');
  const list = node.querySelector('.phase-list');
  assert.ok(list.hidden);
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.ok(!list.hidden);
  assert.deepEqual(
    [...list.querySelectorAll('.row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    ['1ResearchDone', 'G1Gate 1Passed 28 Oct', '2BuildNow', 'G2Gate 2Open', '3Ship'],
  );
  assert.equal(list.querySelector('[aria-current="step"] .ttl').textContent, 'Build');
});
