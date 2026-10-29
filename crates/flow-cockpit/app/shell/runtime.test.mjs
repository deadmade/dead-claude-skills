// The view runtime and the shared blocks, in jsdom. Runs in flow-cockpit.yml after `npm ci`, not in `npm test`:
//   node --test crates/flow-cockpit/app/shell/runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

/**
 * The fake Mermaid counts its calls and how many renders run at once. A render takes `mermaidDelay` ms; a source
 * holding `FAIL` (or any while `mermaidFails`) fails, and one holding `%% h=<n>` draws <n> px tall.
 * @type {{ initialize: unknown[], render: [string, string][], running: number, most: number }}
 */
const mermaidCalls = { initialize: [], render: [], running: 0, most: 0 };
let mermaidFails = false;
let mermaidDelay = 0;
dom.window.mermaid = {
  initialize: (config) => mermaidCalls.initialize.push(config),
  render: async (id, source) => {
    mermaidCalls.render.push([id, source]);
    mermaidCalls.most = Math.max(mermaidCalls.most, ++mermaidCalls.running);
    try {
      if (mermaidDelay) await new Promise((resolve) => setTimeout(resolve, mermaidDelay));
      if (mermaidFails || source.includes('FAIL')) throw new Error('Parse error on line 1');
      const h = /%% h=(\d+)/.exec(source)?.[1] ?? '100';
      return { svg: `<svg id="${id}" viewBox="0 0 200 ${h}"><g class="node"></g></svg>` };
    } finally {
      mermaidCalls.running--;
    }
  },
};
// The window's idle callback, counted, so a test sees the draw-ahead queue stop asking for idle time once it is empty.
let idleAsks = 0;
dom.window.requestIdleCallback = (callback) => {
  idleAsks++;
  return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
};

const { createRuntime } = await import('./runtime.js');
const { markdown, mermaidSources } = await import('./blocks/markdown.js');
const { mermaid, ahead, taskGraph, taskGraphSource } = await import('./blocks/mermaid.js');
const { diff } = await import('./blocks/diff.js');
const { stepper } = await import('./blocks/stepper.js');
const { card } = await import('./blocks/card.js');

/** Lets the blocks' and the runtime's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Waits until `done()` holds, up to two seconds. */
async function until(done, what = 'the condition') {
  for (let i = 0; i < 400; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}
/** How many times the fake Mermaid drew `source`. */
const drawsOf = (source) => mermaidCalls.render.filter(([, s]) => s === source).length;

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
 * `extensions` is what the `extensions` command answers.
 */
function fakeApp(views, extensions = { styles: [], disabled: [], looked: [] }) {
  const listeners = new Map();
  const calls = [];
  const answer = (value) => (value && typeof value === 'object' ? Promise.reject(value.error) : Promise.resolve(value));
  const app = {
    views,
    extensions,
    calls,
    /** The data commands' answers, by command: a function of the call's arguments. Unlisted ones answer null. */
    answers: {},
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
      if (cmd === 'extensions') return Promise.resolve(app.extensions);
      if (app.answers[cmd]) return Promise.resolve(app.answers[cmd](args));
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
    assert.equal(node.querySelector('[aria-busy]'), null, 'no longer busy');
    // The same source again fails at once, without a second try.
    const again = markdown('```mermaid\ngraph TD; A-->\n```');
    assert.equal(again.querySelector('.diagram pre')?.textContent.trim(), 'graph TD; A-->');
    assert.match(again.querySelector('.diagram .quiet')?.textContent ?? '', /Parse error on line 1/);
    await settle();
    assert.equal(drawsOf('graph TD; A-->\n'), 1);
  } finally {
    mermaidFails = false;
  }
});

test('a_diagram_drawn_ahead_shows_at_once', async () => {
  // A fence at the top and one in a list item: the lexer's sources are the ones the page draws.
  const doc =
    'Text.\n\n```mermaid\ngraph TD; Ahead1-->B\n```\n\n- An item:\n\n  ```mermaid\n  graph TD; Ahead2-->B\n  ```\n';
  const sources = mermaidSources(doc);
  assert.deepEqual(sources, ['graph TD; Ahead1-->B\n', 'graph TD; Ahead2-->B\n']);
  assert.deepEqual(mermaidSources('```js\nlet a;\n```\n\n    indented\n'), []);
  ahead(sources);
  await until(() => sources.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'both drawn ahead');
  await settle();
  const node = markdown(doc);
  assert.equal(node.querySelectorAll('.diagram svg').length, 2, node.outerHTML);
  assert.equal(node.querySelector('.diagram pre, .diagram-wait, [aria-busy]'), null);
  await settle();
  assert.deepEqual(
    sources.map((s) => drawsOf(s)),
    [1, 1],
    'not drawn again',
  );
});

test('a_diagram_not_drawn_yet_shows_a_quiet_placeholder', async () => {
  mermaidDelay = 20;
  try {
    const node = markdown('```mermaid\ngraph TD; Wait1-->B\n```');
    const box = node.querySelector('.diagram');
    assert.equal(box.getAttribute('aria-busy'), 'true');
    assert.ok(box.querySelector('.diagram-wait'), box.outerHTML);
    assert.equal(box.querySelector('pre'), null, 'the source never shows while it draws');
    assert.doesNotMatch(box.textContent, /Wait1/);
    await until(() => box.querySelector('svg'), 'the drawing');
    assert.equal(box.hasAttribute('aria-busy'), false);
    assert.equal(box.querySelector('.diagram-wait'), null);
  } finally {
    mermaidDelay = 0;
  }
  // The stylesheet: an empty box as tall as the last drawing, else a modest default; in the task graph's column no
  // taller than the column.
  const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, s]) => s.trim() === sel)?.[2] ?? '';
  assert.match(rule('.diagram-wait'), /height:\s*var\(--wait-h,\s*\d+(\.\d+)?rem\)/);
  assert.match(rule('.where-graph .diagram-wait'), /max-height:\s*calc\(100vh/);
});

test('ahead_draws_one_at_a_time_and_stops_when_empty', async () => {
  mermaidDelay = 10;
  mermaidCalls.most = 0;
  try {
    const sources = ['graph TD; Q1-->B', 'graph TD; Q2-->B', 'graph TD; Q3-->B'];
    const asked = idleAsks;
    ahead(sources);
    assert.equal(drawsOf(sources[0]), 0, 'nothing draws until the window is idle');
    await until(() => sources.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'all three drawn');
    assert.equal(mermaidCalls.most, 1, 'never two renders at once');
    assert.deepEqual(
      mermaidCalls.render.map(([, s]) => s).filter((s) => sources.includes(s)),
      sources,
    );
    const after = idleAsks;
    assert.equal(after - asked, 3, 'one idle moment per diagram');
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(idleAsks, after, 'an empty queue stops asking for idle time');
  } finally {
    mermaidDelay = 0;
  }
});

test('a_needed_diagram_jumps_the_queue', async () => {
  mermaidDelay = 10;
  mermaidCalls.most = 0;
  try {
    const queued = ['graph TD; J1-->B', 'graph TD; J2-->B', 'graph TD; J3-->B'];
    const needed = 'graph TD; Now1-->B';
    ahead(queued);
    const box = mermaid(needed);
    await until(() => box.querySelector('svg'), 'the needed drawing');
    const order = mermaidCalls.render.map(([, s]) => s).filter((s) => [...queued, needed].includes(s));
    // At most the one already drawing goes first.
    assert.ok(order.indexOf(needed) <= 1, order.join(' | '));
    await until(() => queued.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'the queue drawn');
    assert.equal(mermaidCalls.most, 1);
  } finally {
    mermaidDelay = 0;
  }
});

test('a_source_is_drawn_once', async () => {
  mermaidDelay = 10;
  try {
    const source = 'graph TD; Once1-->B';
    ahead([source, source]);
    const a = mermaid(source);
    const b = mermaid(source);
    ahead([source]);
    await until(() => a.querySelector('svg') && b.querySelector('svg'), 'both boxes drawn');
    assert.ok(mermaid(source).querySelector('svg'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(drawsOf(source), 1);
  } finally {
    mermaidDelay = 0;
  }
});

test('the_cache_keys_on_the_theme_and_a_placeholder_keeps_the_last_size', async () => {
  const source = 'graph TD; Theme1-->B\n%% h=321';
  const first = mermaid(source);
  await until(() => first.querySelector('svg'), 'the first drawing');
  const root = document.documentElement;
  root.style.setProperty('--color-paper', '#101010');
  mermaidDelay = 10;
  try {
    assert.equal(window.getComputedStyle(root).getPropertyValue('--color-paper').trim(), '#101010');
    const again = mermaid(source);
    assert.equal(again.querySelector('svg'), null, 'a new theme draws it again');
    assert.equal(again.querySelector('.diagram-wait')?.style.getPropertyValue('--wait-h'), '321px');
    await until(() => again.querySelector('svg'), 'the drawing in the new theme');
    assert.equal(drawsOf(source), 2);
    assert.equal(mermaidCalls.initialize.at(-1).themeVariables.background, '#101010');
  } finally {
    root.style.removeProperty('--color-paper');
    mermaidDelay = 0;
  }
});

/** A run as the core gives it, with only what the task graph reads: the plan's tasks and the ledger's states. */
const runWith = (tasks, states = {}) => ({
  plan: {
    title: null,
    tasks: tasks.map(([id, deps]) => ({ id, title: `Task ${id}`, does: null, depends_on: deps, markdown: '' })),
  },
  ledger: {
    plan: null,
    rulings: [],
    tasks: Object.entries(states).map(([id, state]) => ({
      id,
      state,
      fix_rounds: 0,
      security: [],
      later: [],
      story: [],
      model: null,
    })),
  },
});

test('task_graph_is_the_plans_tasks_top_to_bottom_with_no_ring', () => {
  const source = taskGraphSource(
    runWith(
      [
        ['1', []],
        ['2b', ['1']],
        ['3', ['1', '2b']],
      ],
      { 1: 'Done', '2b': 'Building' },
    ),
  );
  assert.match(source, /^flowchart TB\n%%\{init: \{"flowchart": \{"padding": 13\}\}\}%%\n/);
  assert.match(source, /^ {2}T2b\(\("2b"\)\)$/m);
  assert.match(source, /^ {2}T1 --> T2b$/m);
  assert.match(source, /^ {2}T2b --> T3$/m);
  assert.match(source, /^ {2}class T1 done$/m);
  assert.match(source, /^ {2}class T2b busy$/m);
  assert.match(source, /^ {2}class T3 todo$/m);
  // The selected task is ringed on the drawing by the run view, so one drawing serves every task.
  assert.doesNotMatch(source, /^\s*style /m);
  assert.equal(
    taskGraphSource(
      runWith([
        ['1', []],
        ['2', null],
      ]),
    ),
    null,
    'a task that does not say what it needs',
  );
  assert.equal(taskGraphSource({ plan: null, ledger: null }), null);
  assert.equal(taskGraph({ plan: { title: null, tasks: [] }, ledger: null }), null);
});

/** A run's documents, each with one diagram naming the run and the document. */
const docWith = ({ slug, name }) => `# ${name}\n\n\`\`\`mermaid\ngraph TD; ${slug}${name}-->B\n\`\`\`\n`;
const docSources = (slug) => ['Spec', 'Plan', 'Flow'].map((name) => `graph TD; ${slug}${name}-->B\n`);

test('the_list_draws_its_unfinished_runs_diagrams_ahead', async () => {
  const open = runWith(
    [
      ['1', []],
      ['2', ['1']],
    ],
    { 1: 'Done', 2: 'Building' },
  );
  const shut = runWith(
    [
      ['1', []],
      ['2', ['1']],
      ['3', ['2']],
    ],
    { 1: 'Done', 2: 'Done', 3: 'Done' },
  );
  const entries = [
    { kind: 'FlowRun', slug: 'listopen', status: 'Working' },
    { kind: 'FlowRun', slug: 'listshut', status: 'Done' },
    { kind: 'Loose', id: 's1' },
  ];
  const app = fakeApp({ list: { source: view('list', 'list', says('list')) } });
  app.answers = {
    projects: () => [
      { id: 'p0', name: 'zero', roots: [] },
      { id: 'p1', name: 'one', roots: [] },
    ],
    entries: ({ project }) => (project === 'p1' ? entries : []),
    flow_run: ({ slug }) => (slug === 'listopen' ? open : shut),
    doc: docWith,
  };
  const { runtime } = await started(app, { to: 'list', project: 'p1' });
  await runtime.idle();
  const wanted = [taskGraphSource(open), ...docSources('listopen')];
  await until(() => wanted.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'the open run drawn ahead');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(drawsOf(taskGraphSource(shut)), 0, 'a finished run waits until it is opened');
  assert.ok(docSources('listshut').every((s) => drawsOf(s) === 0));
  assert.ok(!app.calls.some(([cmd, args]) => cmd === 'entries' && args.project === 'p0'), 'only the shown project');
  assert.ok(!app.calls.some(([cmd, args]) => cmd === 'flow_run' && args.slug === 'listshut'));

  // The list shows the first project when the route names none, and drawing ahead follows it.
  const first = fakeApp({ list: { source: view('list', 'list', says('list')) } });
  first.answers = { ...app.answers, entries: ({ project }) => (project === 'p0' ? entries : []) };
  const again = await started(first, { to: 'list' });
  await again.runtime.idle();
  await until(
    () => first.calls.some(([cmd, args]) => cmd === 'flow_run' && args.project === 'p0' && args.slug === 'listopen'),
    'p0 drawn ahead',
  );
});

test('opening_a_run_draws_the_rest_of_its_documents_ahead', async () => {
  const run = runWith(
    [
      ['1', []],
      ['2', ['1']],
      ['4', ['2']],
    ],
    { 1: 'Done', 2: 'Done', 4: 'Done' },
  );
  const app = fakeApp({ run: { source: view('run', 'run', says('run')) } });
  app.answers = { flow_run: () => run, doc: docWith };
  const { runtime } = await started(app, { ...RUN, slug: 'opened' });
  await runtime.idle();
  const wanted = [taskGraphSource(run), ...docSources('opened')];
  await until(() => wanted.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, "the run's diagrams drawn ahead");
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
  // jsdom keeps a scroll position but fires no `scroll`, as a browser does: the test fires it.
  const scroll = (selector, top, left = 0) => {
    const el = old.querySelector(selector);
    el.scrollTop = top;
    el.scrollLeft = left;
    el.dispatchEvent(new window.Event('scroll'));
  };
  scroll('.left', 30);
  scroll('.content', 50, 7);
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

/** A view of 2000 keyed folds and one pane that scrolls: a long session's tool calls. */
function manyFolds() {
  const box = document.createElement('div');
  const pane = document.createElement('div');
  pane.className = 'pane';
  for (let i = 0; i < 2000; i++) {
    const fold = document.createElement('details');
    fold.dataset.keep = `fold-${i}`;
    const summary = document.createElement('summary');
    summary.textContent = `Fold ${i}`;
    fold.append(summary, document.createElement('p'));
    pane.append(fold);
  }
  box.append(pane);
  return box;
}

/** Counts `querySelectorAll` calls and `scrollTop` reads on elements while `work` runs. */
async function counting(work) {
  const proto = window.Element.prototype;
  const query = proto.querySelectorAll;
  const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
  const counts = { queries: 0, scrollReads: 0 };
  proto.querySelectorAll = function (...args) {
    counts.queries++;
    return query.apply(this, args);
  };
  Object.defineProperty(proto, 'scrollTop', {
    ...scroll,
    get() {
      counts.scrollReads++;
      return scroll.get.call(this);
    },
  });
  try {
    await work();
  } finally {
    proto.querySelectorAll = query;
    Object.defineProperty(proto, 'scrollTop', scroll);
  }
  return counts;
}

test('a_redraw_does_not_search_or_measure_every_element', async () => {
  const app = fakeApp({ list: { source: viewOf('list', 'list', manyFolds) } });
  const { root, runtime } = await started(app, { to: 'list' });
  const old = section(root, 'list');
  const pane = old.querySelector('.pane');
  // The user scrolls the pane (a browser then fires `scroll`) and opens the last fold.
  pane.scrollTop = 40;
  pane.dispatchEvent(new window.Event('scroll'));
  old.querySelector('[data-keep="fold-1999"]').open = true;

  const counts = await counting(async () => {
    await app.emit('changed', { project: 'p1' });
    await runtime.idle();
  });
  const now = section(root, 'list');
  assert.notEqual(now, old, 'the view drew again');
  assert.equal(now.querySelector('.pane').scrollTop, 40);
  assert.ok(now.querySelector('[data-keep="fold-1999"]').open);
  assert.ok(!now.querySelector('[data-keep="fold-0"]').open);
  // Each fold is found without listing the section's keyed elements again, and only what scrolled is measured.
  assert.ok(counts.queries < 50, `${counts.queries} queries`);
  assert.ok(counts.scrollReads < 50, `${counts.scrollReads} scrollTop reads`);

  // A second redraw still finds the pane the first one scrolled back.
  await app.emit('changed', { project: 'p1' });
  await runtime.idle();
  assert.equal(section(root, 'list').querySelector('.pane').scrollTop, 40);
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
    'run|flow-cockpit|activity:Activity|card,diff,markdown,mermaid,stepper,taskGraph',
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

test('session_pages_and_tool_inputs_reach_the_app', async () => {
  const app = fakeApp({
    activity: {
      source: viewOf(
        'activity',
        'session',
        `async (ctx) => {
        await ctx.data.session('s-1');
        await ctx.data.session('s-1', { before: 40, limit: 20 });
        await ctx.data.toolInput('s-1', 'toolu_1');
        return document.createElement('p');
      }`,
      ),
    },
  });
  await started(app, { to: 'session', project: 'p1', id: 's-1' });
  assert.deepEqual(
    app.calls.filter(([cmd]) => cmd === 'session' || cmd === 'tool_input'),
    [
      ['session', { id: 's-1', before: null, limit: null }],
      ['session', { id: 's-1', before: 40, limit: 20 }],
      ['tool_input', { session: 's-1', tool: 'toolu_1' }],
    ],
  );
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

const extensionStyles = () => [...document.head.querySelectorAll('style')];

test('extension_style_is_added_once_and_removed_when_switched_off', async () => {
  const app = fakeApp(
    { list: { source: view('list', 'list', says('list')) } },
    { styles: [{ extension: 'list', css: 'section[data-view="list"] { color: red; }' }], disabled: [], looked: [] },
  );
  const { runtime } = await started(app, { to: 'list' });
  assert.deepEqual(
    extensionStyles().map((s) => [s.dataset.extension, s.textContent]),
    [['list', 'section[data-view="list"] { color: red; }']],
  );
  // A reload swaps it, never adds a second.
  app.extensions = { ...app.extensions, styles: [{ extension: 'list', css: 'p { color: blue; }' }] };
  await app.emit('views-changed', {});
  await runtime.idle();
  assert.deepEqual(
    extensionStyles().map((s) => s.textContent),
    ['p { color: blue; }'],
  );
  // Switched off in config.toml: its style goes with its views.
  app.extensions = { styles: [], disabled: ['list'], looked: [] };
  delete app.views.list;
  await app.emit('views-changed', {});
  await runtime.idle();
  assert.deepEqual(extensionStyles(), []);
});

test('a_switched_off_list_or_run_says_so', async () => {
  const app = fakeApp({}, { styles: [], disabled: ['list', 'run'], looked: [] });
  const { root, runtime } = await started(app, { to: 'list' });
  assert.equal(root.querySelector('.empty')?.textContent, 'The list extension is switched off in config.toml.');
  runtime.navigate(RUN);
  await runtime.idle();
  assert.equal(root.querySelector('.empty')?.textContent, 'The run extension is switched off in config.toml.');
});

test('missing_default_extensions_name_where_the_window_looked', async () => {
  const app = fakeApp({}, { styles: [], disabled: [], looked: ['/opt/a', '/opt/b'] });
  const { root } = await started(app, { to: 'list' });
  assert.match(
    root.querySelector('.empty')?.textContent ?? '',
    /The default extensions weren't found\. Looked in \/opt\/a, \/opt\/b\./,
  );
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
