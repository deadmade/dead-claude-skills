// The built-in views in jsdom, against the data the core gives for the fixture home (fixtures/*.json, written by
// `cargo test -p flow-cockpit-core --test dump_view_fixtures -- --ignored`). Runs in flow-cockpit.yml after `npm ci`,
// not in `npm test`:
//   node --test crates/flow-cockpit/app/views/builtin/views.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
// No Mermaid in jsdom: a diagram stays as its source with the reason, as in the window when Mermaid can't load.

const { markdown } = await import('../../shell/blocks/markdown.js');
const { mermaid } = await import('../../shell/blocks/mermaid.js');
const { diff } = await import('../../shell/blocks/diff.js');
const { stepper } = await import('../../shell/blocks/stepper.js');
const { card } = await import('../../shell/blocks/card.js');
const blocks = Object.freeze({ markdown, mermaid, diff, stepper, card });

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const DATA = {
  projects: fixture('projects'),
  entries: fixture('entries'),
  runs: fixture('runs'),
  docs: fixture('docs'),
  sessions: fixture('sessions'),
};
const ALPHA = 'github-com-acme-alpha';
// In the runtime's order (by id); the run view puts Docs first, as the design does.
const TABS = [
  { id: 'activity', title: 'Activity' },
  { id: 'docs', title: 'Docs' },
];

let fresh = 0;
/** Each test gets its own copy of the view module, so what one test picked doesn't carry into the next. */
const load = async (name: string) => (await import(`./${name}.ts?t=${++fresh}`)).default;

/** A ViewContext over the fixtures; `data` overrides parts of them, `api` replaces calls. */
function context(route: any, data: Partial<typeof DATA> = {}, api: Record<string, any> = {}) {
  const d = { ...DATA, ...data };
  const navigations: any[] = [];
  const ctx = {
    data: {
      projects: async () => d.projects,
      entries: async (p: string) => d.entries[p] ?? [],
      flowRun: async (p: string, s: string) => d.runs[`${p}/${s}`] ?? null,
      doc: async (p: string, s: string, n: string) => d.docs[`${p}/${s}`]?.[n] ?? null,
      session: async (id: string) => d.sessions[id] ?? null,
      views: async () => [],
      viewSource: async () => '',
      ...api,
    },
    blocks,
    navigate: (to: any) => navigations.push(to),
    route,
    tabs: TABS,
  };
  return { ctx, navigations };
}

/** Draws a view (by name, freshly loaded, or one already loaded) into the page, in a section as the runtime does. */
async function draw(name: string | any, route: any, data?: Partial<typeof DATA>, api?: Record<string, any>) {
  const view = typeof name === 'string' ? await load(name) : name;
  const { ctx, navigations } = context(route, data, api);
  const box = document.createElement('section');
  box.className = 'view';
  box.dataset.view = view.id;
  box.append(await view.render(ctx));
  document.body.replaceChildren(box);
  return { box, view, navigations };
}

const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const group = (box: Element, title: string) =>
  [...box.querySelectorAll('section.group')].find((s) => text(s.querySelector('.group-h')).startsWith(title));
const rowsOf = (box: Element, title: string) => [...(group(box, title)?.querySelectorAll('.rows > li > .row') ?? [])];
const names = (box: Element, title: string) => rowsOf(box, title).map((r) => text(r.querySelector('.ttl')));
const press = (box: Element, label: string) => {
  const b = [...box.querySelectorAll('button')].find((x) => text(x.querySelector('.ttl') ?? x) === label);
  assert.ok(b, `no button ${label}`);
  b.click();
};
const clone = (x: any) => JSON.parse(JSON.stringify(x));

test('views_import_types_only', () => {
  for (const name of ['list', 'run', 'docs', 'activity']) {
    const source = readFileSync(new URL(`${name}.ts`, import.meta.url), 'utf8');
    const values = source.split('\n').filter((l) => /^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l));
    assert.deepEqual(values, [], `${name}.ts has a value import`);
    assert.doesNotMatch(source, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/, `${name}.ts writes HTML`);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setTimeout|setInterval/, name);
  }
});

test('list_groups_runs_audits_loose', async () => {
  const { box, navigations } = await draw('list', { to: 'list', project: ALPHA });
  assert.deepEqual(names(box, 'Flow runs'), ['Login', 'Signup', 'Spiky']);
  assert.equal(rowsOf(box, 'Audits').length, 2);
  assert.deepEqual(names(box, 'Loose sessions'), [
    'Read docs/features/login/flow.md and summarise it.',
    'A quick question.',
  ]);
  // Unfinished runs stand out; a done one is quiet.
  assert.ok(rowsOf(box, 'Flow runs')[2].classList.contains('done'));
  assert.match(text(rowsOf(box, 'Flow runs')[1]), /Needs you/);

  (rowsOf(box, 'Flow runs')[0] as HTMLElement).click();
  (rowsOf(box, 'Loose sessions')[0] as HTMLElement).click();
  assert.deepEqual(navigations, [
    { to: 'run', project: ALPHA, slug: 'login' },
    { to: 'session', project: ALPHA, id: 's-mention' },
  ]);
  assert.ok(
    rowsOf(box, 'Audits').every((r) => r.tagName !== 'BUTTON'),
    'an audit row opens nothing',
  );

  // Without a project in the route, the first project shows; another project is one click away.
  const first = await draw('list', { to: 'list' });
  assert.equal(text(first.box.querySelector('.brand h1')), 'alpha');
  press(first.box, 'solo');
  assert.deepEqual(first.navigations, [{ to: 'list', project: 'folder-solo' }]);
});

test('list_filters_and_sorts', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const runs = () => names(box, 'Flow runs');
  assert.deepEqual(runs(), ['Login', 'Signup', 'Spiky'], 'latest activity first');
  press(box, 'Name');
  assert.deepEqual(runs(), ['Login', 'Signup', 'Spiky']);
  press(box, 'Furthest along');
  assert.deepEqual(runs(), ['Spiky', 'Login', 'Signup']);
  press(box, 'Needs you first');
  assert.deepEqual(runs(), ['Signup', 'Login', 'Spiky'], 'the waiting run first, though it is older');
  assert.equal(group(box, 'Flow runs')?.querySelector('[aria-pressed="true"]'), null);
  assert.equal(
    text([...box.querySelectorAll('button[aria-pressed="true"]')].find((b) => text(b).startsWith('Needs'))),
    'Needs you first',
  );

  // Status: only runs carry one, so audits and sessions step aside.
  press(box, 'Done');
  assert.deepEqual(runs(), ['Spiky']);
  assert.equal(group(box, 'Audits'), undefined);
  assert.equal(group(box, 'Loose sessions'), undefined);
  press(box, 'Done');
  assert.deepEqual(runs(), ['Signup', 'Login', 'Spiky'], 'still needs-you-first');

  // Conductor: runs and audits have one.
  press(box, 'Research');
  assert.deepEqual(runs(), ['Spiky']);
  assert.equal(group(box, 'Audits'), undefined);
  press(box, 'Research');
  press(box, 'Doc audit');
  assert.equal(group(box, 'Flow runs'), undefined);
  assert.equal(rowsOf(box, 'Audits').length, 1);
  press(box, 'Doc audit');

  // Search reads every group, and keeps its text and focus across a redraw (an id the runtime finds it by).
  const search = box.querySelector('input[type="search"]') as HTMLInputElement;
  assert.ok(search.id || search.dataset.keep);
  search.value = 'login';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(runs(), ['Login']);
  assert.deepEqual(names(box, 'Loose sessions'), ['Read docs/features/login/flow.md and summarise it.']);
  assert.equal(group(box, 'Audits'), undefined);
  search.value = 'nothing like this';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match(text(box.querySelector('.content')), /Nothing matches/);
});

test('audit_shows_unknown_without_picks', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const [picked, unknown] = rowsOf(box, 'Audits');
  assert.match(text(picked), /2 picked, 1 fixed/);
  assert.match(text(picked), /Open/);
  assert.match(text(picked), /1 high, 1 med, 1 low/);
  assert.match(text(unknown), /State unknown/);
  assert.doesNotMatch(text(unknown), /picked|Open/);
});

test('run_shows_now_or_phase', async () => {
  const login = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
  assert.equal(text(login.box.querySelector('.now .sentence')), 'Building task 2 of 2.');
  assert.ok(!login.box.querySelector('.now')?.classList.contains('waiting'));
  assert.equal(text(login.box.querySelector('.brand h1')), 'Login');
  assert.match(text(login.box.querySelector('.where')), /^Feature flow, in Build\s*Idle$/);
  // The run view hosts the tabs: its own two, then the loaded run-tab views.
  assert.deepEqual(
    [...login.box.querySelectorAll('.tabs .tab')].map((t) => text(t)),
    ['Build', 'Decisions', 'Docs', 'Activity'],
  );

  const waiting = await draw('run', { to: 'run', project: ALPHA, slug: 'signup' });
  assert.ok(waiting.box.querySelector('.now')?.classList.contains('waiting'));
  assert.match(text(waiting.box.querySelector('.track-text')), /^Grill, phase 3 of 7\.$/);
  assert.equal(text(waiting.box.querySelector('.track-gates')), 'Gate 1 and gate 2 are open.');

  // No `now:`: the phase stands in its place.
  const runs = clone(DATA.runs);
  runs[`${ALPHA}/login`].flow.now = null;
  const phase = await draw('run', { to: 'run', project: ALPHA, slug: 'login' }, { runs });
  assert.equal(text(phase.box.querySelector('.now .sentence')), "In Build. This run doesn't say what comes next.");

  // A gate opens to its verdict, built from its fields.
  const gate = login.box.querySelector('button.gate') as HTMLButtonElement;
  gate.click();
  assert.equal(gate.getAttribute('aria-expanded'), 'true');
  assert.equal(text(gate.querySelector('.verdict')), 'Spec approved on 10 Jan.');

  // A selected tab another view draws gets the slot, and the frame stays.
  const docs = await draw('run', { to: 'run', project: ALPHA, slug: 'login', tab: 'docs' });
  assert.ok(docs.box.querySelector('.window > [data-slot="run-tab"]'));
  assert.equal(docs.box.querySelector('.content'), null);
  assert.equal(docs.box.querySelector('.tab[aria-selected="true"]')?.textContent, 'Docs');
  press(docs.box, 'Decisions');
  assert.deepEqual(docs.navigations, [{ to: 'run', project: ALPHA, slug: 'login' }]);

  const gone = await draw('run', { to: 'run', project: ALPHA, slug: 'nope' });
  assert.match(text(gone.box.querySelector('.error')), /can't be shown/);
});

test('run_task_cards_use_does_and_graph_only_when_all_depends_written', async () => {
  const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
  // The task being built is selected first.
  assert.equal(box.querySelector('.row[aria-current="true"]')?.getAttribute('data-task'), '2');
  assert.equal(text(box.querySelector('.task .does')), 'Checks the password.');
  // Titles are inline: no paragraph breaks the heading or a one-line row.
  assert.equal(box.querySelector('.task-h h2 p, .rows .ttl p, .does p, .now .sentence p'), null);
  assert.match(text(box.querySelector('.task-h')), /2\s*The check\s*Being built/);
  assert.match(text(box.querySelector('.task .facts')), /Needs task 1 first\./);
  assert.ok(box.querySelector('.task .where-graph .graph'), 'every task says what it depends on: a graph');
  assert.match(
    text(box.querySelector('.now .summary')),
    /^1 of 2 tasks done\. Reviews sent work back once\. 1 deviation waits for you\.$/,
  );

  press(box, 'The form');
  assert.equal(text(box.querySelector('.task .does')), 'Draws the form.');
  assert.match(text(box.querySelector('.task-h .state')), /Done after 1 fix round/);
  assert.match(text(box.querySelector('.task')), /Left for later\s*The label wraps on a narrow window/);
  assert.match(text(box.querySelector('.task .facts')), /Needs nothing else first\. Task 2 waits for it\./);
  assert.equal(box.querySelector('.rows .row[data-task="1"] .mark')?.textContent, '1 fix');

  const runs = clone(DATA.runs);
  runs[`${ALPHA}/login`].plan.tasks[1].depends_on = null;
  const partial = await draw('run', { to: 'run', project: ALPHA, slug: 'login' }, { runs });
  assert.equal(partial.box.querySelector('.where-graph'), null, 'one task without Depends on: no graph');
  assert.equal(partial.box.querySelector('.task .facts'), null);
});

test('run_decisions_list_and_detail', async () => {
  const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
  press(box, 'Decisions');
  assert.deepEqual(names(box, 'Deviations'), ['The form needs a second field', 'Pick a hash']);
  assert.deepEqual(names(box, 'Decisions'), ['Where the form lives', 'Remember me']);
  assert.deepEqual(names(box, 'Calls the build made'), ["The form keeps the browser's own validation"]);

  // flow.md's own calls only, as the approved design lists them; the build log's are not merged in.
  const runs = clone(DATA.runs);
  runs[`${ALPHA}/login`].ledger.rulings = [
    { date: null, scope: null, call: 'the log keeps its own wording', why: null, cost: null, raw: 'x' },
  ];
  const merged = await draw('run', { to: 'run', project: ALPHA, slug: 'login' }, { runs });
  press(merged.box, 'Decisions');
  assert.deepEqual(names(merged.box, 'Calls the build made'), ["The form keeps the browser's own validation"]);
  // The open deviation is selected first.
  assert.equal(text(box.querySelector('.item-h')), 'The form needs a second field');
  press(box, 'Remember me');
  assert.match(text(box.querySelector('.item')), /Not picked yet/);
  press(box, "The form keeps the browser's own validation");
  assert.match(text(box.querySelector('.item')), /Why\s*Fewer moving parts\./);
  assert.match(text(box.querySelector('.item')), /It costs a plainer error text\./);
});

test('docs_enhances_known_parts', async () => {
  const signup = await draw('docs', { to: 'run', project: ALPHA, slug: 'signup', tab: 'docs' });
  // The documents on the left, the text in the middle, the chapters on the right.
  const left = signup.box.querySelector('aside.left');
  assert.deepEqual(names(signup.box, 'Documents'), ['Spec', 'Plan', 'Flow']);
  assert.ok(left && signup.box.querySelector('.content .docs-layout .reading'));
  // Signup has only flow.md: it is the one shown.
  assert.equal(left?.querySelector('[aria-current="true"] .ttl')?.textContent, 'Flow');
  const gates = signup.box.querySelector('.doc-section');
  assert.equal(text(gates?.querySelector('h2')), 'Gates');
  assert.ok(gates?.querySelector('.stepper .track'), 'Gates as a stepper');

  const login = await draw('docs', { to: 'run', project: ALPHA, slug: 'login', tab: 'docs' });
  press(login.box, 'Flow');
  const section = (title: string) =>
    [...login.box.querySelectorAll('.doc-section')].find((s) => text(s.querySelector('h2')) === title);
  const options = section('Options');
  assert.equal(options?.querySelectorAll('.card').length, 2, 'Options as decision cards');
  assert.match(text(options?.querySelector('.card')), /Where the form lives\s*Picked\s*Its own page/);
  assert.match(text(options?.querySelectorAll('.card')[1]), /Not picked yet/);
  assert.ok(section('Request')?.querySelector('.md'), 'the rest as Markdown');
  assert.match(text(section('Request')), /Let people sign in/);
  assert.ok(section('Deviations')?.querySelector('.devs details.dev.open'));
  assert.deepEqual(
    [...login.box.querySelectorAll('.chapters .toc a')].map((a) => text(a)),
    ['Request', 'Gates', 'Options', 'Rulings', 'Deviations'],
  );

  press(login.box, 'Plan');
  assert.match(text(login.box.querySelector('.reading .md')), /Login Implementation Plan/);
  press(login.box, 'Spec');
  assert.match(text(login.box.querySelector('.reading')), /This run has no spec\.md/);
});

test('activity_groups_turns_newest_first', async () => {
  const { box } = await draw('activity', { to: 'run', project: ALPHA, slug: 'login', tab: 'activity' });
  const turns = [...box.querySelectorAll('.turn')];
  assert.deepEqual(
    turns.map((t) => text(t.querySelector('.turn-h'))),
    ['Now run the tests.', 'Build the login form.'],
  );
  // Each turn holds what followed its prompt: the reply, and its tool calls one step away.
  assert.match(text(turns[0].querySelector('.turn-reply')), /All 12 tests pass\./);
  const tools = turns[0].querySelector('details.unfold');
  assert.match(text(tools?.querySelector('summary')), /1 tool call/);
  assert.match(text(tools), /Bash\s*Run the tests/);
  // A call's input is drawn when its fold opens: a long session has hundreds.
  assert.doesNotMatch(text(turns[0]), /npm test/);
  const open = async (turn: Element) => {
    const call = turn.querySelector('details.tool-call') as HTMLDetailsElement;
    const toggled = new Promise((resolve) => call.addEventListener('toggle', resolve, { once: true }));
    call.open = true;
    await toggled;
  };
  await open(turns[0]);
  assert.match(text(turns[0].querySelector('details.tool-call pre')), /^npm test$/);
  await open(turns[1]);
  assert.ok(turns[1].querySelector('details.tool-call .diff'), 'an edit shows as a diff');
  assert.deepEqual(names(box, 'Sessions'), ['Latest session']);

  // A loose session has a screen of its own.
  const loose = await draw('activity', { to: 'session', project: ALPHA, id: 's-mention' });
  assert.ok(loose.box.querySelector('.window > .brand'));
  assert.equal(text(loose.box.querySelector('.turn-h')), 'Read docs/features/login/flow.md and summarise it.');
  (loose.box.querySelector('.brand button') as HTMLElement).click();
  assert.deepEqual(loose.navigations, [{ to: 'list', project: ALPHA }]);

  const none = await draw('activity', { to: 'session', project: ALPHA, id: 'nope' });
  assert.match(text(none.box), /isn't there any more/);
});

/** A promise per call, settled by the test. */
function deferred() {
  const calls: { id: string; resolve: (v: any) => void; reject: (e: any) => void }[] = [];
  const session = (id: string) => new Promise((resolve, reject) => calls.push({ id, resolve, reject }));
  return { calls, session };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const twoSessions = () => {
  const runs = clone(DATA.runs);
  runs[`${ALPHA}/login`].sessions = ['s-link', 's-mention'];
  return runs;
};

test('activity_keeps_a_late_read_from_replacing_the_pick', async () => {
  const reads = deferred();
  const route = { to: 'run', project: ALPHA, slug: 'login', tab: 'activity' };
  const drawn = draw('activity', route, { runs: twoSessions() }, { session: reads.session });
  await tick();
  reads.calls[0].resolve(DATA.sessions['s-link']);
  const { box } = await drawn;
  const shown = () => text(box.querySelector('.turn-h'));
  assert.equal(shown(), 'Now run the tests.');

  // A slow read of the other session, then a pick back to the first, which answers first.
  press(box, 'Session s-mentio');
  press(box, 'Latest session');
  const [slow, fast] = reads.calls.slice(1);
  assert.deepEqual([slow.id, fast.id], ['s-mention', 's-link']);
  fast.resolve(DATA.sessions['s-link']);
  await tick();
  slow.resolve(DATA.sessions['s-mention']);
  await tick();
  assert.equal(shown(), 'Now run the tests.', 'the late read is dropped');
  assert.equal(box.querySelector('[aria-current="true"]')?.getAttribute('data-session'), 's-link');

  // A read that fails says so where the turns go.
  press(box, 'Session s-mentio');
  reads.calls.at(-1)!.reject(new Error('the transcript is gone'));
  await tick();
  assert.match(text(box.querySelector('.content')), /couldn't be read.*the transcript is gone/);
});

test('activity_reads_only_the_selected_session', async () => {
  const read: string[] = [];
  const session = async (id: string) => {
    read.push(id);
    return DATA.sessions[id] ?? null;
  };
  await draw(
    'activity',
    { to: 'run', project: ALPHA, slug: 'login', tab: 'activity' },
    { runs: twoSessions() },
    { session },
  );
  assert.deepEqual(read, ['s-link']);
});

test('activity_folds_stay_on_their_turn_across_a_redraw', async () => {
  const { createRuntime } = await import('../../shell/runtime.js');
  const sessions = clone(DATA.sessions);
  const handlers = new Map<string, (event: any) => void>();
  const invoke = async (cmd: string, args: any = {}) => {
    if (cmd === 'views') return [{ id: 'activity', source: 'Builtin', replaced: false }];
    if (cmd === 'view_source') return '';
    if (cmd === 'session') return sessions[args.id] ?? null;
    return null;
  };
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const runtime = createRuntime({
    root,
    invoke,
    listen: async (name: string, handler: any) => handlers.set(name, handler),
    importModule: () => import(`./activity.ts?t=${++fresh}`),
  });
  await runtime.start({ to: 'session', project: ALPHA, id: 's-link' });
  const fold = (prompt: string) =>
    [...root.querySelectorAll('.turn')]
      .find((t) => text(t.querySelector('.turn-h')) === prompt)
      ?.querySelector('details') as HTMLDetailsElement;
  fold('Build the login form.').open = true;

  // A new prompt arrives and a question waits: both move every turn down.
  const prompt = { at: '2026-01-19T10:09:00.000Z', text: 'One more.', agent: null };
  sessions['s-link'].turns.push({ prompt, replies: [], tools: [] });
  sessions['s-link'].live.waiting = 'A question';
  handlers.get('changed')!({ payload: { project: ALPHA } });
  await runtime.idle();
  assert.equal(text(root.querySelector('.turn-h')), 'One more.');
  assert.equal(fold('Build the login form.').open, true, 'the fold stays on its turn');
  assert.equal(fold('Now run the tests.').open, false);
});

test('list_clears_filters_the_new_project_has_no_row_for', async () => {
  const list = await load('list');
  const alpha = await draw(list, { to: 'list', project: ALPHA });
  press(alpha.box, 'Research');
  press(alpha.box, 'Done');
  const solo = await draw(list, { to: 'list', project: 'folder-solo' });
  assert.equal(solo.box.querySelector('[aria-pressed="true"]:not([data-sort])'), null);
  assert.deepEqual(names(solo.box, 'Loose sessions'), ['Solo A.', 'Solo B.']);
});

test('run_wires_accessibility_like_the_design', async () => {
  const resolves = (box: Element) => {
    for (const el of box.querySelectorAll('[aria-labelledby], [aria-controls]')) {
      for (const attr of ['aria-labelledby', 'aria-controls']) {
        const id = el.getAttribute(attr);
        if (id) assert.ok(box.querySelector(`#${id}`), `${attr}="${id}" names nothing`);
      }
    }
  };
  const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'signup' });
  const tab = box.querySelector('.tab[aria-selected="true"]');
  assert.equal(tab?.id, 'run-tab-build');
  assert.equal(tab?.getAttribute('aria-controls'), 'run-panel');
  assert.equal(box.querySelector('#run-panel')?.getAttribute('aria-labelledby'), 'run-tab-build');
  assert.equal(box.querySelector('#run-panel')?.getAttribute('role'), 'tabpanel');
  assert.ok(box.querySelector('.track')?.getAttribute('aria-controls'));
  resolves(box);

  const login = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
  assert.equal(login.box.querySelector('article.task')?.getAttribute('aria-labelledby'), 'task-title');
  resolves(login.box);
  press(login.box, 'Decisions');
  assert.equal(login.box.querySelector('article.item')?.getAttribute('aria-labelledby'), 'item-h');
  resolves(login.box);

  const gone = await draw('run', { to: 'run', project: ALPHA, slug: 'nope' });
  assert.equal(gone.box.querySelector('.error')?.getAttribute('role'), 'alert');
  const docs = await draw('docs', { to: 'run', project: ALPHA, slug: 'login', tab: 'docs' });
  resolves(docs.box);
});

test('run_graph_nodes_select_their_task', async () => {
  const w = window as any;
  w.mermaid = {
    initialize() {},
    render: async (id: string) => ({
      svg: `<svg id="${id}"><g class="node" id="flowchart-T1-0"></g><g class="node" id="flowchart-T2-1"></g></svg>`,
    }),
  };
  try {
    const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
    await tick();
    const node = box.querySelector('#flowchart-T1-0') as Element;
    assert.equal(node.getAttribute('role'), 'link');
    assert.match(node.getAttribute('aria-label') ?? '', /^Task 1, The form: done after 1 fix round$/);
    // Wired once: later changes to the drawing aren't watched.
    const late = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    late.setAttribute('class', 'node');
    late.id = 'flowchart-T2-9';
    box.querySelector('.graph svg')?.append(late);
    await tick();
    assert.equal(late.getAttribute('tabindex'), null);
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(text(box.querySelector('.task .does')), 'Draws the form.');
  } finally {
    delete w.mermaid;
  }
});
