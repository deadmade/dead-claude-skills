// The view runtime and the shared blocks, in jsdom. Runs in flow-cockpit.yml after `npm ci`, not in `npm test`:
//   node --test crates/flow-cockpit/app/shell/runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

/**
 * The fake Mermaid counts its calls and how many renders run at once. A render takes `mermaidDelay` ms; a source
 * holding `FAIL` (or any while `mermaidFails`) fails, one holding `HANG` waits until a test calls `unhang()`, and one
 * holding `%% h=<n>` draws <n> px tall.
 * @type {{ initialize: unknown[], render: [string, string][], running: number, most: number }}
 */
const mermaidCalls = { initialize: [], render: [], running: 0, most: 0 };
let mermaidFails = false;
let mermaidDelay = 0;
/** @type {(() => void)[]} */
const hung = [];
const unhang = () => hung.splice(0).forEach((go) => go());
dom.window.mermaid = {
  initialize: (config) => mermaidCalls.initialize.push(config),
  render: async (id, source) => {
    mermaidCalls.render.push([id, source]);
    mermaidCalls.most = Math.max(mermaidCalls.most, ++mermaidCalls.running);
    try {
      if (mermaidDelay) await new Promise((resolve) => setTimeout(resolve, mermaidDelay));
      if (source.includes('HANG')) await new Promise((resolve) => hung.push(resolve));
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

test('changed_redraws_do_not_read_the_runs_again', async () => {
  const run = runWith(
    [
      ['1', []],
      ['2', ['1']],
      ['5', ['2']],
    ],
    { 1: 'Done', 2: 'Building' },
  );
  const entry = {
    kind: 'FlowRun',
    slug: 'tick',
    status: 'Working',
    phase: 'build',
    now: 'Building Task 2.',
    gates: [],
    open_deviations: 0,
    progress: [1, 3],
    last_activity: '2026-10-29T10:00:00Z',
  };
  let current = run;
  const app = fakeApp({ list: { source: view('list', 'list', says('list')) } });
  app.answers = {
    projects: () => [{ id: 'p1', name: 'one', roots: [] }],
    entries: () => [{ ...entry }],
    flow_run: () => current,
    doc: docWith,
  };
  const reads = (cmd) => app.calls.filter(([c]) => c === cmd).length;
  const { runtime } = await started(app, { to: 'list', project: 'p1' });
  /** A `changed` tick, its redraw and the drawing ahead after it. */
  const tick = async () => {
    await app.emit('changed', { project: 'p1' });
    await runtime.idle();
    await settle();
    await settle();
  };
  await runtime.idle();
  await until(() => drawsOf(taskGraphSource(run)) === 1 && !mermaidCalls.running, 'the first pass');
  await settle();
  assert.deepEqual([reads('flow_run'), reads('doc')], [1, 3]);
  // Two ticks with nothing new, and one where only the last activity moved (a live session writing): nothing is
  // read again.
  await tick();
  await tick();
  entry.last_activity = '2026-10-29T10:05:00Z';
  await tick();
  assert.deepEqual([reads('flow_run'), reads('doc')], [1, 3], 'a tick reads nothing again');
  // New progress or a new `now:` line reads the run (its graph) and its documents again.
  entry.progress = [2, 3];
  await tick();
  await until(() => reads('flow_run') === 2 && reads('doc') === 6, 'read again for new progress');
  // The run now waits on the user: a new graph source, drawn ahead again.
  current = runWith(
    [
      ['1', []],
      ['2', ['1']],
      ['5', ['2']],
    ],
    { 1: 'Done', 2: 'Waiting' },
  );
  entry.now = 'Waiting for you: the plan.';
  await tick();
  await until(() => drawsOf(taskGraphSource(current)) === 1, 'the waiting graph drawn ahead');
  assert.deepEqual([reads('flow_run'), reads('doc')], [3, 9]);
  // Status, phase, gates and open deviations read the documents again; the graph only follows progress and `now`.
  for (const change of [
    () => (entry.status = 'Waiting'),
    () => (entry.phase = 'review'),
    () => (entry.gates = [{ n: 1, what: 'spec', approved: '2026-10-29' }]),
    () => (entry.open_deviations = 1),
  ]) {
    const docs = reads('doc');
    change();
    await tick();
    await until(() => reads('doc') === docs + 3, 'the documents read again');
  }
  assert.equal(reads('flow_run'), 3);

  // On the run page, drawing ahead runs when the run opens, not on its redraws.
  const page = fakeApp({ run: { source: view('run', 'run', says('run')) } });
  page.answers = { flow_run: () => run, doc: docWith };
  const opened = await started(page, { ...RUN, slug: 'tick' });
  await opened.runtime.idle();
  await until(() => page.calls.filter(([c]) => c === 'doc').length === 3, 'the open run read');
  for (let i = 0; i < 2; i++) {
    await page.emit('changed', { project: 'p1' });
    await opened.runtime.idle();
    await settle();
  }
  assert.equal(page.calls.filter(([c]) => c === 'doc').length, 3);
  assert.equal(page.calls.filter(([c]) => c === 'flow_run').length, 1);
});

/** A fresh copy of the Mermaid block, with its own queue, cache and start time. */
let copies = 0;
const freshBlock = () => import(`./blocks/mermaid.js?copy=${++copies}`);

test('without_idle_callbacks_drawing_ahead_waits_for_a_quiet_moment', async () => {
  // The webview's path: no requestIdleCallback, so the queue runs on timers. Its timers are counted.
  const idle = window.requestIdleCallback;
  const timer = window.setTimeout;
  let timers = 0;
  delete window.requestIdleCallback;
  window.setTimeout = (...args) => {
    timers++;
    return timer.apply(window, args);
  };
  mermaidDelay = 10;
  mermaidCalls.most = 0;
  try {
    const started = performance.now();
    const block = await freshBlock();
    const first = 'graph TD; Quiet1-->B';
    block.ahead([first]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(drawsOf(first), 0, 'nothing draws ahead in the first second');
    await until(() => drawsOf(first) === 1, 'the first one drawn ahead');
    assert.ok(performance.now() - started >= 1000, 'drawn a second after start at the earliest');

    // Input holds the queue back until it has been quiet for a while; a diagram a page needs still draws at once.
    window.dispatchEvent(new window.Event('pointerdown'));
    const touched = performance.now();
    const queued = ['graph TD; Quiet2-->B', 'graph TD; Quiet3-->B'];
    block.ahead(queued);
    const needed = block.mermaid('graph TD; Quiet4-->B');
    await until(() => needed.querySelector('svg'), 'the needed one');
    assert.ok(performance.now() - touched < 300, 'the needed one did not wait');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(drawsOf(queued[0]), 0, 'held back by the click');
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
    const typed = performance.now();
    await until(() => queued.every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'the queue drawn');
    assert.ok(performance.now() - typed >= 400, 'drawn after 400 ms without input');
    assert.equal(mermaidCalls.most, 1, 'one at a time');
    assert.deepEqual(
      mermaidCalls.render.map(([, s]) => s).filter((s) => queued.includes(s)),
      queued,
    );
    // An empty queue sets no more timers.
    await settle();
    const after = timers;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(timers, after, 'no timers once the queue is empty');
  } finally {
    window.requestIdleCallback = idle;
    window.setTimeout = timer;
    mermaidDelay = 0;
  }
});

test('a_drawing_that_never_finishes_fails_and_the_queue_moves_on', async () => {
  // The 10 s deadline, shortened for the test.
  const timer = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => timer.call(window, fn, ms === 10000 ? 20 : ms, ...rest);
  try {
    const hang = 'graph TD; HANG-->B';
    const after = 'graph TD; AfterHang-->B';
    const box = mermaid(hang);
    const next = mermaid(after);
    await until(() => box.querySelector('pre') && next.querySelector('svg'), 'the deadline and the next drawing');
    assert.equal(box.querySelector('pre').textContent, hang);
    assert.match(box.querySelector('.quiet').textContent, /took too long/);
    assert.equal(box.hasAttribute('aria-busy'), false);
    // Kept as a failure: shown at once, not tried again.
    const again = mermaid(hang);
    assert.match(again.querySelector('.quiet')?.textContent ?? '', /took too long/);
    await settle();
    assert.equal(drawsOf(hang), 1);
  } finally {
    window.setTimeout = timer;
    // Lets the hung render end, late: the queue has moved on and ignores it.
    unhang();
    await settle();
  }
});

test('a_diagram_that_left_the_page_waits_behind_the_queue', async () => {
  mermaidDelay = 15;
  try {
    const [a, b, c, q] = ['Left1', 'Left2', 'Left3', 'Left4'].map((n) => `graph TD; ${n}-->B`);
    const boxA = mermaid(a);
    const boxB = mermaid(b);
    document.body.append(boxA, boxB);
    await until(() => drawsOf(a) === 1, 'the first one drawing');
    // The page moves on while A draws: B left it, C is on the new page, and Q was queued ahead.
    boxA.remove();
    boxB.remove();
    ahead([q]);
    const boxC = mermaid(c);
    document.body.append(boxC);
    await until(() => [b, c, q].every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'all drawn');
    const order = mermaidCalls.render.map(([, s]) => s).filter((s) => [a, b, c, q].includes(s));
    assert.deepEqual(order, [a, c, q, b]);
    boxC.remove();
  } finally {
    mermaidDelay = 0;
  }
});

test('the_page_shown_draws_before_pages_passed_through_during_a_render', async () => {
  mermaidDelay = 30;
  try {
    const [a, b, c, d] = ['Pass1', 'Pass2', 'Pass3', 'Pass4'].map((n) => `graph TD; ${n}-->B`);
    const boxA = mermaid(a);
    document.body.append(boxA);
    await until(() => drawsOf(a) === 1, 'the first one drawing');
    // While A draws, the user clicks through two pages (each box shown, then left) to the one now shown.
    const boxB = mermaid(b);
    document.body.append(boxB);
    boxB.remove();
    const boxC = mermaid(c);
    document.body.append(boxC);
    boxC.remove();
    const boxD = mermaid(d);
    document.body.append(boxD);
    await until(() => [b, c, d].every((s) => drawsOf(s) === 1) && !mermaidCalls.running, 'all drawn');
    const order = mermaidCalls.render.map(([, s]) => s).filter((s) => [a, b, c, d].includes(s));
    assert.equal(order[1], d, order.join(' | '));
    boxA.remove();
    boxD.remove();
  } finally {
    mermaidDelay = 0;
  }
});

test('a_placeholder_takes_the_height_the_drawing_had_on_the_page', async () => {
  // A diagram whose drawing scales to its column is shorter on the page than its viewBox (500).
  const proto = window.SVGElement.prototype;
  proto.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 222,
    width: 200,
    height: 222,
  });
  const source = 'sequenceDiagram\n  A->>B: Shown\n%% h=500';
  const root = document.documentElement;
  try {
    const box = mermaid(source);
    document.body.append(box);
    await until(() => box.querySelector('svg'), 'the drawing');
    box.remove();
    root.style.setProperty('--color-paper', '#202020');
    const again = mermaid(source);
    assert.equal(again.querySelector('.diagram-wait')?.style.getPropertyValue('--wait-h'), '222px');
    await until(() => again.querySelector('svg'), 'the drawing in the new theme');
  } finally {
    delete proto.getBoundingClientRect;
    root.style.removeProperty('--color-paper');
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

/**
 * Runs `work` in a window of its own at `url`, so its history starts with one entry and only the runtime started in
 * it follows that history: the runtimes earlier tests started keep listening on the shared window.
 */
async function inWindow(url, work) {
  // jsdom can't reload a page (and its `location.reload` can't be replaced): it reports each try on the console.
  const console = new VirtualConsole();
  const reloads = { count: 0, errors: [] };
  console.on('jsdomError', (err) => {
    if (/navigation/.test(err.message)) reloads.count++;
    else reloads.errors.push(err.message);
  });
  const own = new JSDOM('<!doctype html><html><body></body></html>', { url, virtualConsole: console });
  const shared = [globalThis.window, globalThis.document];
  globalThis.window = own.window;
  globalThis.document = own.window.document;
  try {
    return await work(own.window, reloads);
  } finally {
    [globalThis.window, globalThis.document] = shared;
  }
}

/** A view on every screen that shows the route it was drawn for, as JSON. */
const WHERE = {
  where: {
    source: view(
      'where',
      ['list', 'run', 'doc', 'session'],
      "const p = document.createElement('p'); p.textContent = JSON.stringify(ctx.route); return p;",
    ),
  },
};
const drawnRoute = (root) => JSON.parse(section(root, 'where').textContent);
/** Waits for a draw after a history move, which the window answers with `popstate`. */
const afterMove = async (root, runtime, want) => {
  await until(() => section(root, 'where')?.textContent === JSON.stringify(want), JSON.stringify(want));
  await runtime.idle();
};

test('navigate_writes_the_hash_and_one_history_entry', async () => {
  await inWindow('http://localhost/', async (win) => {
    const app = fakeApp(WHERE);
    const { root, runtime } = await started(app);
    assert.deepEqual(drawnRoute(root), { to: 'list' });
    assert.equal(win.location.hash, '#/list');
    assert.equal(win.history.length, 1, 'the start replaces the entry it opened on');
    runtime.navigate(RUN);
    await runtime.idle();
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit');
    assert.equal(win.history.length, 2);
    // The same route again, and a redraw for fresh data, write nothing.
    runtime.navigate({ ...RUN });
    await app.emit('changed', { project: 'p1' });
    await runtime.idle();
    assert.equal(win.history.length, 2);
    assert.deepEqual(drawnRoute(root), RUN);
  });
});

test('back_and_forward_draw_the_route_of_that_entry', async () => {
  await inWindow('http://localhost/', async (win) => {
    const app = fakeApp(WHERE);
    const { root, runtime } = await started(app, { to: 'list', project: 'p1' });
    runtime.navigate(RUN);
    await runtime.idle();
    runtime.navigate({ to: 'session', project: 'p1', id: 's-1' });
    await runtime.idle();
    win.history.back();
    await afterMove(root, runtime, RUN);
    win.history.back();
    await afterMove(root, runtime, { to: 'list', project: 'p1' });
    win.history.forward();
    await afterMove(root, runtime, RUN);
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit');
    assert.equal(win.history.length, 3, 'moving through history adds no entries');
  });
});

test('a_start_with_a_valid_hash_opens_it', async () => {
  await inWindow('http://localhost/#/run/p1/flow-cockpit/docs', async (win) => {
    const { root } = await started(fakeApp(WHERE));
    assert.deepEqual(drawnRoute(root), { ...RUN, tab: 'docs' });
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit/docs');
    assert.equal(win.history.length, 1);
  });
});

test('a_malformed_or_unknown_hash_opens_the_list_and_replaces_it', async () => {
  const bad = [
    '',
    '#',
    '#/',
    '#list',
    '#/nope/p1',
    '#/run/p1',
    '#/run/p1/s/t/extra',
    '#/run//s',
    '#/run/p1/%E0%A4%A',
    '#/doc/p1/s/Readme',
    '#/session/p1',
    '#/list/p1/more',
  ];
  for (const hash of bad) {
    await inWindow(`http://localhost/${hash}`, async (win) => {
      const { root } = await started(fakeApp(WHERE));
      assert.deepEqual(drawnRoute(root), { to: 'list' }, hash);
      assert.equal(win.location.hash, '#/list', hash);
      assert.equal(win.history.length, 1, hash);
    });
  }
});

test('a_run_tab_switch_is_one_entry_and_back_returns_to_the_tab_before', async () => {
  await inWindow('http://localhost/', async (win) => {
    const app = fakeApp({
      run: { source: view('run', 'run', RUN_FRAME) },
      activity: { source: view('activity', 'run-tab', says('activity drawn'), 'Activity') },
      docs: { source: view('docs', 'run-tab', says('docs drawn'), 'Docs') },
    });
    const { root, runtime } = await started(app, RUN);
    root.querySelector('button[data-tab="docs"]').click();
    await runtime.idle();
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit/docs');
    root.querySelector('button[data-tab="activity"]').click();
    await runtime.idle();
    assert.equal(win.history.length, 3);
    win.history.back();
    await until(() => section(root, 'docs')?.textContent === 'docs drawn', 'the docs tab');
    assert.equal(section(root, 'activity'), null);
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit/docs');
  });
});

test('every_route_kind_round_trips_through_the_hash', async () => {
  const odd = ['a b', 'x/y', 'c#d', 'ünï 字 🙂', '%41', '?q=1&r', "it's"];
  /** @type {object[]} */
  const routes = [{ to: 'list' }];
  for (const s of odd) {
    routes.push(
      { to: 'list', project: s },
      { to: 'run', project: s, slug: s },
      { to: 'run', project: s, slug: 'run', tab: s },
      { to: 'doc', project: s, slug: s, name: 'Plan' },
      { to: 'session', project: s, id: s },
    );
  }
  for (const route of routes) {
    const hash = await inWindow('http://localhost/', async (win) => {
      const { runtime } = await started(fakeApp(WHERE));
      runtime.navigate(route);
      await runtime.idle();
      return win.location.hash;
    });
    // One readable form: the kind first, every part encoded, so a `/` or `#` in an id never splits it.
    assert.match(hash, new RegExp(`^#/${route.to}(/[^/#?\\s]+)*$`), hash);
    await inWindow(`http://localhost/${hash}`, async (win) => {
      const { root } = await started(fakeApp(WHERE));
      assert.deepEqual(drawnRoute(root), route, hash);
      assert.equal(win.location.hash, hash);
    });
  }
});

test('back_restores_the_scroll_and_folds_of_the_page_it_returns_to', async () => {
  await inWindow('http://localhost/', async (win) => {
    win.mermaid = dom.window.mermaid;
    const app = fakeApp({
      list: { source: viewOf('list', 'list', stateful) },
      run: { source: view('run', 'run', says('a run')) },
    });
    const { root, runtime } = await started(app);
    const old = section(root, 'list');
    const pane = old.querySelector('.content');
    pane.scrollTop = 50;
    pane.dispatchEvent(new win.Event('scroll'));
    old.querySelector('details').open = true;
    runtime.navigate(RUN);
    await runtime.idle();
    win.history.back();
    await until(() => section(root, 'list'), 'the list again');
    await runtime.idle();
    const now = section(root, 'list');
    assert.notEqual(now, old);
    assert.equal(now.querySelector('.content').scrollTop, 50);
    assert.ok(now.querySelector('details').open);
    // Opening a page by a click still starts it fresh.
    runtime.navigate(RUN);
    await runtime.idle();
    runtime.navigate({ to: 'list' });
    await runtime.idle();
    assert.ok(!section(root, 'list').querySelector('details').open);
  });
});

test('the_mouse_side_buttons_go_back_and_forward_once', async () => {
  await inWindow('http://localhost/', async (win) => {
    const moves = [];
    win.history.back = () => moves.push('back');
    win.history.forward = () => moves.push('forward');
    await started(fakeApp(WHERE));
    const press = (button) => {
      for (const type of ['mousedown', 'mouseup', 'auxclick'])
        win.document.body.dispatchEvent(new win.MouseEvent(type, { button, bubbles: true, cancelable: true }));
    };
    press(3);
    press(4);
    press(1);
    press(0);
    assert.deepEqual(moves, ['back', 'forward']);
  });
});

test('f5_and_ctrl_r_reload_the_window_once_from_anywhere', async () => {
  await inWindow('http://localhost/', async (win, reloads) => {
    const app = fakeApp({
      list: {
        source: view('list', 'list', "const i = document.createElement('input'); i.dataset.keep = 'q'; return i;"),
      },
    });
    const { root } = await started(app);
    /** @returns {boolean} whether the window kept the key from the engine */
    const key = (target, init) => {
      const event = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.ok(key(win.document.body, { key: 'F5' }));
    assert.equal(reloads.count, 1);
    assert.ok(key(win.document.body, { key: 'r', ctrlKey: true }));
    assert.ok(key(win.document.body, { key: 'R', ctrlKey: true, shiftKey: true }));
    // In a text field too.
    assert.ok(key(root.querySelector('input'), { key: 'r', ctrlKey: true }));
    assert.equal(reloads.count, 4);
    // F5 held down: the reload already started, and the engine doesn't get the key either.
    assert.ok(key(win.document.body, { key: 'F5', repeat: true }));
    assert.equal(reloads.count, 4);
    // Ctrl+R on a layout whose R key types another letter: the physical key counts.
    assert.ok(key(win.document.body, { key: 'к', code: 'KeyR', ctrlKey: true }));
    assert.equal(reloads.count, 5);
    // A keydown without a key (Chromium's autofill sends such) is no error.
    win.document.body.dispatchEvent(new win.Event('keydown', { bubbles: true }));
    assert.deepEqual(reloads.errors, []);
    // Not a reload: a plain r, Alt+R, another F key.
    for (const init of [{ key: 'r' }, { key: 'r', ctrlKey: true, altKey: true }, { key: 'F6' }])
      assert.ok(!key(win.document.body, init), JSON.stringify(init));
    assert.equal(reloads.count, 5);
  });
});

/** A run view that draws its own Build and Decisions tabs, as the default one does: no slot for them. */
const OWN_TABS_RUN = {
  run: {
    source: view(
      'run',
      'run',
      `const p = document.createElement('p');
       p.className = 'own';
       p.textContent = ctx.route.tab ?? 'build';
       return p;`,
    ),
  },
};

test('back_and_forward_move_between_the_run_views_own_tabs', async () => {
  await inWindow('http://localhost/', async (win) => {
    const { root, runtime } = await started(fakeApp(OWN_TABS_RUN), RUN);
    const shown = () => root.querySelector('.own')?.textContent;
    runtime.navigate({ ...RUN, tab: 'decisions' });
    await runtime.idle();
    assert.equal(win.location.hash, '#/run/p1/flow-cockpit/decisions');
    assert.equal(shown(), 'decisions');
    // A tab the run view draws itself leaves no slot, so nothing says it isn't loaded.
    assert.doesNotMatch(root.textContent, /isn't loaded/);
    runtime.navigate(RUN);
    await runtime.idle();
    assert.equal(win.history.length, 3);
    win.history.back();
    await until(() => shown() === 'decisions', 'decisions again');
    win.history.back();
    await until(() => shown() === 'build', 'build again');
    win.history.forward();
    await until(() => shown() === 'decisions', 'forward to decisions');
  });
});

test('a_reload_on_decisions_opens_decisions', async () => {
  await inWindow('http://localhost/#/run/p1/flow-cockpit/decisions', async (win) => {
    const { root } = await started(fakeApp(OWN_TABS_RUN));
    assert.equal(root.querySelector('.own')?.textContent, 'decisions');
    assert.doesNotMatch(root.textContent, /isn't loaded/);
    assert.equal(win.history.length, 1);
  });
});

test('focus_stays_on_a_named_control_across_a_navigation', async () => {
  await inWindow('http://localhost/', async (win) => {
    const app = fakeApp({
      run: {
        source: viewOf(
          'run',
          'run',
          `(ctx) => {
            const box = document.createElement('div');
            for (const id of ['build', 'decisions']) {
              const b = document.createElement('button');
              b.id = 'tab-' + id;
              b.addEventListener('click', () => ctx.navigate({ ...ctx.route, tab: id }));
              box.append(b);
            }
            box.append(document.createElement('button'));
            // Known only by its position inside a named box: not a name of its own.
            const panel = document.createElement('div');
            panel.id = 'panel';
            panel.append(document.createElement('button'));
            box.append(panel);
            return box;
          }`,
        ),
      },
    });
    const { root, runtime } = await started(app, RUN);
    const tab = root.querySelector('#tab-decisions');
    tab.focus();
    tab.click();
    await runtime.idle();
    assert.notEqual(root.querySelector('#tab-decisions'), tab, 'drawn anew');
    assert.equal(win.document.activeElement, root.querySelector('#tab-decisions'));
    // A control known only by its position isn't followed onto the next page.
    const plain = root.querySelector('button:not([id])');
    plain.focus();
    runtime.navigate(RUN);
    await runtime.idle();
    assert.equal(win.document.activeElement, win.document.body);
    root.querySelector('#panel button').focus();
    runtime.navigate({ ...RUN, tab: 'build' });
    await runtime.idle();
    assert.equal(win.document.activeElement, win.document.body, 'a button inside a named box');
  });
});

/** A view on every screen with one fold, which shows its route. */
const FOLDED = {
  where: {
    source: view(
      'where',
      ['list', 'run', 'doc', 'session'],
      `const d = document.createElement('details');
       d.dataset.keep = 'fold';
       const s = document.createElement('summary');
       s.textContent = JSON.stringify(ctx.route);
       d.append(s);
       globalThis.foldedDraws = (globalThis.foldedDraws ?? 0) + 1;
       return d;`,
    ),
  },
};
const fold = (root) => root.querySelector('[data-keep="fold"]');
/** Moves the address the way back or forward does and tells the window, at once. */
const moveTo = (win, hash) => {
  win.history.replaceState(null, '', hash);
  win.dispatchEvent(new win.PopStateEvent('popstate'));
};

test('back_restores_at_most_the_50_pages_left_last', async () => {
  // Going back leaves the last page too: after 49 others the list is the 50th page left, after 50 the 51st.
  for (const [visited, restored] of [
    [49, true],
    [50, false],
  ]) {
    await inWindow('http://localhost/', async (win) => {
      const { root, runtime } = await started(fakeApp(FOLDED));
      fold(root).open = true;
      for (let i = 0; i < visited; i++) {
        runtime.navigate({ to: 'session', project: 'p1', id: `s${i}` });
        await runtime.idle();
      }
      moveTo(win, '#/list');
      await until(() => fold(root)?.textContent === '{"to":"list"}', 'the list');
      await runtime.idle();
      assert.equal(fold(root).open, restored, `after ${visited} other pages`);
    });
  }
});

test('one_back_draws_once_though_popstate_and_hashchange_both_come', async () => {
  await inWindow('http://localhost/', async (win) => {
    const { root, runtime } = await started(fakeApp(FOLDED));
    runtime.navigate(RUN);
    await runtime.idle();
    win.history.back();
    await until(() => fold(root)?.textContent === '{"to":"list"}', 'the list');
    await runtime.idle();
    const draws = globalThis.foldedDraws;
    // The same move announced again (a `hashchange` after its `popstate`) draws nothing.
    win.dispatchEvent(new win.HashChangeEvent('hashchange'));
    win.dispatchEvent(new win.PopStateEvent('popstate'));
    await runtime.idle();
    assert.equal(globalThis.foldedDraws, draws);
  });
});

test('a_click_right_after_back_opens_its_page_fresh', async () => {
  await inWindow('http://localhost/', async (win) => {
    const { root, runtime } = await started(fakeApp(FOLDED));
    fold(root).open = true;
    runtime.navigate(RUN);
    await runtime.idle();
    // Back is taken, and before its draw runs the user opens the list by a click.
    moveTo(win, '#/session/p1/s1');
    runtime.navigate({ to: 'list' });
    await runtime.idle();
    assert.equal(fold(root).textContent, '{"to":"list"}');
    assert.equal(fold(root).open, false, 'a page opened by a click starts fresh');
  });
});

test('navigate_draws_the_route_the_address_reads_back', async () => {
  await inWindow('http://localhost/', async (win) => {
    const { root, runtime } = await started(fakeApp(FOLDED));
    // Keys in another order, and one no route has.
    runtime.navigate({ slug: 'flow-cockpit', extra: 1, project: 'p1', to: 'run' });
    await runtime.idle();
    assert.equal(fold(root).textContent, JSON.stringify(RUN));
    // A route the address can't hold opens the list, as a reload of it would.
    runtime.navigate({ to: 'doc', project: 'p1', slug: 's', name: 'Readme' });
    await runtime.idle();
    assert.equal(fold(root).textContent, '{"to":"list"}');
    assert.equal(win.location.hash, '#/list');
  });
});

test('switching_a_runs_tabs_reads_nothing_ahead', async () => {
  await inWindow('http://localhost/', async (win) => {
    const app = fakeApp(OWN_TABS_RUN);
    const { runtime } = await started(app, RUN);
    const reads = () => app.calls.filter(([cmd]) => cmd === 'flow_run' || cmd === 'doc').length;
    await until(() => reads() === 4, 'the opened run read ahead');
    for (const to of [{ ...RUN, tab: 'decisions' }, RUN, { ...RUN, tab: 'docs' }]) {
      runtime.navigate(to);
      await runtime.idle();
    }
    win.history.back();
    await until(() => win.location.hash === '#/run/p1/flow-cockpit', 'back to build');
    await runtime.idle();
    await settle();
    assert.equal(reads(), 4);
    // Another run is read ahead again.
    runtime.navigate({ ...RUN, slug: 'other' });
    await runtime.idle();
    await until(() => reads() === 8, 'the other run read ahead');
  });
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
