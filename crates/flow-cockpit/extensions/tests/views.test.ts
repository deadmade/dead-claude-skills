// The default extensions' views in jsdom, against the data the core gives for the fixture home (fixtures/*.json, written by
// `cargo test -p flow-cockpit-core --test dump_view_fixtures -- --ignored`). Runs in flow-cockpit.yml after `npm ci`,
// not in `npm test`:
//   node --test crates/flow-cockpit/extensions/tests/views.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
// No Mermaid in jsdom: a diagram stays as its source with the reason, as in the window when Mermaid can't load.

const { markdown } = await import('../../app/shell/blocks/markdown.js');
const { mermaid, taskGraph } = await import('../../app/shell/blocks/mermaid.js');
const { diff } = await import('../../app/shell/blocks/diff.js');
const { stepper } = await import('../../app/shell/blocks/stepper.js');
const { card } = await import('../../app/shell/blocks/card.js');
const blocks = Object.freeze({ markdown, mermaid, diff, stepper, card, taskGraph });

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const DATA = {
  projects: fixture('projects'),
  entries: fixture('entries'),
  runs: fixture('runs'),
  docs: fixture('docs'),
  sessions: fixture('sessions'),
  inputs: fixture('inputs'),
};

/**
 * The page the core answers `session` with, from a whole session: the newest `limit` turns (20 by default) before the
 * turn index `before`, indexes counting from the oldest turn.
 */
function pageOf(activity: any, opts: { before?: number | null; limit?: number | null } = {}) {
  if (!activity) return null;
  const total = activity.turns.length;
  const before = Math.min(opts.before ?? total, total);
  const start = Math.max(0, before - (opts.limit ?? 20));
  return { ...activity, turns: activity.turns.slice(start, before), start, total };
}
const ALPHA = 'github-com-acme-alpha';
// In the runtime's order (by id); the run view puts Docs first, as the design does.
const TABS = [
  { id: 'activity', title: 'Activity' },
  { id: 'docs', title: 'Docs' },
];

let fresh = 0;
/** Each test gets its own copy of the view module, so what one test picked doesn't carry into the next. */
const load = async (name: string) => (await import(`../${name}/${name}.ts?t=${++fresh}`)).default;

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
      session: async (id: string, opts?: any) => pageOf(d.sessions[id], opts),
      toolInput: async (session: string, id: string) => d.inputs[`${session}/${id}`] ?? null,
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
    const source = readFileSync(new URL(`../${name}/${name}.ts`, import.meta.url), 'utf8');
    const values = source.split('\n').filter((l) => /^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l));
    assert.deepEqual(values, [], `${name}.ts has a value import`);
    assert.doesNotMatch(source, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML/, `${name}.ts writes HTML`);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setTimeout|setInterval/, name);
  }
});

/** The list's table of a kind (`runs`, `audits` or `loose`), its body rows, and their name cells' text. */
const table = (box: Element, kind: string) => box.querySelector(`table.${kind}`);
const trs = (box: Element, kind: string) =>
  [...(table(box, kind)?.querySelectorAll('tbody > tr') ?? [])] as HTMLElement[];
const cells = (box: Element, kind: string) => trs(box, kind).map((tr) => text(tr.querySelector('.name')));
const heads = (box: Element, kind: string) =>
  [...(table(box, kind)?.querySelectorAll('thead th[scope="col"]') ?? [])].map((th) => text(th));
const tabOf = (box: Element, label: string) => {
  const tab = [...box.querySelectorAll('[role="tab"]')].find((t) => text(t.querySelector('.label')) === label);
  assert.ok(tab, `no tab ${label}`);
  return tab as HTMLElement;
};
/** Picks a value in one of the filter bar's selects, as the user would. */
const pick = (box: Element, id: string, value: string) => {
  const select = box.querySelector(`#${id}`) as HTMLSelectElement | null;
  assert.ok(select, `no select #${id}`);
  select.value = value;
  assert.equal(select.value, value, `#${id} has no option ${value}`);
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const options = (box: Element, id: string) =>
  [...box.querySelectorAll(`#${id} option`)].map((o) => [(o as HTMLOptionElement).value, text(o)]);
const typeIn = (box: Element, words: string) => {
  const search = box.querySelector('#list-search') as HTMLInputElement;
  search.value = words;
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const key = (target: Element, name: string) =>
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));

test('list_rail_holds_only_projects', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const rail = box.querySelector('aside.left') as Element;
  assert.deepEqual(
    [...rail.querySelectorAll('.group-h')].map((h) => text(h)),
    ['Projects'],
  );
  assert.equal(rail.querySelector('select, input, [aria-pressed], table'), null);
  assert.equal(text(rail.querySelector('[aria-current="true"] .ttl')), 'alpha');
});

test('list_switch_shows_counts_and_switches_the_table', async () => {
  const { box, navigations } = await draw('list', { to: 'list', project: ALPHA });
  const tabs = [...box.querySelectorAll('.tabs-bar [role="tablist"] [role="tab"]')];
  assert.deepEqual(
    tabs.map((t) => [text(t.querySelector('.label')), text(t.querySelector('.count'))]),
    [
      ['Flow runs', '3'],
      ['Loose sessions', '2'],
    ],
  );
  const runsTab = tabOf(box, 'Flow runs');
  const looseTab = tabOf(box, 'Loose sessions');
  const panel = box.querySelector('#list-panel');
  assert.equal(panel?.getAttribute('role'), 'tabpanel');
  for (const t of tabs) assert.equal(t.getAttribute('aria-controls'), 'list-panel');
  assert.equal(runsTab.getAttribute('aria-selected'), 'true');
  assert.equal(panel?.getAttribute('aria-labelledby'), runsTab.id);

  // Flow runs: the runs, unfinished ones standing out, then the audits; no loose sessions.
  assert.deepEqual(cells(box, 'runs'), ['Login', 'Signup', 'Spiky']);
  assert.ok(trs(box, 'runs')[2].classList.contains('done'));
  assert.ok(!trs(box, 'runs')[0].classList.contains('done'));
  assert.match(text(trs(box, 'runs')[1]), /Needs you/);
  assert.equal(trs(box, 'audits').length, 2);
  assert.equal(table(box, 'loose'), null);

  // Loose sessions: only them.
  looseTab.click();
  assert.equal(looseTab.getAttribute('aria-selected'), 'true');
  assert.equal(runsTab.getAttribute('aria-selected'), 'false');
  assert.equal(box.querySelector('#list-panel')?.getAttribute('aria-labelledby'), looseTab.id);
  assert.deepEqual(cells(box, 'loose'), ['Read docs/features/login/flow.md and summarise it.', 'A quick question.']);
  assert.equal(table(box, 'runs'), null);
  assert.equal(table(box, 'audits'), null);

  // Left and right move between the two tabs, and focus follows.
  key(looseTab, 'ArrowLeft');
  assert.equal(runsTab.getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, runsTab);
  key(runsTab, 'ArrowRight');
  assert.equal(looseTab.getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, looseTab);
  assert.equal(looseTab.tabIndex, 0);
  assert.equal(runsTab.tabIndex, -1);

  // A whole row opens its run or session; its name cell holds the one real button.
  trs(box, 'loose')[0].click();
  runsTab.click();
  trs(box, 'runs')[0].click();
  (trs(box, 'runs')[1].querySelector('.name button') as HTMLElement).click();
  assert.deepEqual(navigations, [
    { to: 'session', project: ALPHA, id: 's-mention' },
    { to: 'run', project: ALPHA, slug: 'login' },
    { to: 'run', project: ALPHA, slug: 'signup' },
  ]);
  for (const tr of trs(box, 'runs')) assert.equal(tr.querySelectorAll('button').length, 1);
  assert.equal(table(box, 'audits')?.querySelector('button'), null, 'an audit row opens nothing');

  // Without a project in the route, the first project shows; another project is one click away.
  const first = await draw('list', { to: 'list' });
  assert.equal(text(first.box.querySelector('.brand h1')), 'alpha');
  press(first.box, 'solo');
  assert.deepEqual(first.navigations, [{ to: 'list', project: 'folder-solo' }]);
});

test('list_tables_have_column_headings', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  assert.deepEqual(heads(box, 'runs'), [
    'Name',
    'Conductor',
    'Now or phase',
    'Gates',
    'Tasks',
    'State',
    'Last activity',
  ]);
  assert.deepEqual(heads(box, 'audits'), ['Audit', 'Scope', 'Findings', 'Picks', 'State', 'Date']);
  // The audits sit under the runs, under a heading of their own.
  const audits = table(box, 'audits') as Element;
  assert.ok(table(box, 'runs')!.compareDocumentPosition(audits) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(text(audits.closest('section')?.querySelector('h2')), /^Audits/);
  tabOf(box, 'Loose sessions').click();
  assert.deepEqual(heads(box, 'loose'), ['First prompt', 'Started', 'Last activity']);
});

test('list_filters_and_sorts', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const runs = () => cells(box, 'runs');
  // Each control has a visible label.
  for (const id of ['list-status', 'list-conductor', 'list-sort', 'list-search'])
    assert.ok(text(box.querySelector(`label[for="${id}"]`)), `#${id} has no label`);
  // Only values this project has, with counts; Sort has no "Any".
  assert.deepEqual(options(box, 'list-status'), [
    ['', 'Any'],
    ['Waiting', 'Waiting on you (1)'],
    ['Idle', 'Idle (1)'],
    ['Done', 'Done (1)'],
  ]);
  assert.deepEqual(options(box, 'list-conductor'), [
    ['', 'Any'],
    ['doc-audit', 'Doc audit (1)'],
    ['feature', 'Feature (2)'],
    ['research', 'Research (1)'],
    ['test-audit', 'Test audit (1)'],
  ]);
  assert.deepEqual(
    options(box, 'list-sort').map(([, label]) => label),
    ['Latest activity', 'Needs you first', 'Furthest along', 'Name'],
  );

  assert.deepEqual(runs(), ['Login', 'Signup', 'Spiky'], 'latest activity first');
  pick(box, 'list-sort', 'name');
  assert.deepEqual(runs(), ['Login', 'Signup', 'Spiky']);
  pick(box, 'list-sort', 'furthest');
  assert.deepEqual(runs(), ['Spiky', 'Login', 'Signup']);
  pick(box, 'list-sort', 'needs');
  assert.deepEqual(runs(), ['Signup', 'Login', 'Spiky'], 'the waiting run first, though it is older');

  // Status: only runs carry one, so the audits step aside.
  pick(box, 'list-status', 'Done');
  assert.deepEqual(runs(), ['Spiky']);
  assert.equal(table(box, 'audits'), null);
  pick(box, 'list-status', '');
  assert.deepEqual(runs(), ['Signup', 'Login', 'Spiky'], 'still needs-you-first');
  assert.equal(trs(box, 'audits').length, 2);

  // Conductor: runs and audits have one.
  pick(box, 'list-conductor', 'research');
  assert.deepEqual(runs(), ['Spiky']);
  assert.equal(table(box, 'audits'), null);
  pick(box, 'list-conductor', 'doc-audit');
  assert.equal(table(box, 'runs'), null);
  assert.match(text(box.querySelector('#list-panel')), /No flow run matches these filters\./);
  assert.equal(trs(box, 'audits').length, 1);
  pick(box, 'list-conductor', '');

  // Search reads the shown tab's rows; the loose tab shows only the search.
  typeIn(box, 'login');
  assert.deepEqual(runs(), ['Login']);
  assert.equal(table(box, 'audits'), null);
  tabOf(box, 'Loose sessions').click();
  assert.deepEqual(cells(box, 'loose'), ['Read docs/features/login/flow.md and summarise it.']);
  assert.equal(box.querySelector('#list-panel select'), null, 'no filters a session has no field for');
  assert.equal((box.querySelector('#list-search') as HTMLInputElement).value, 'login');
  typeIn(box, 'nothing like this');
  assert.match(text(box.querySelector('#list-panel')), /No loose session matches this search\./);
});

test('list_empty_filter_result_says_so', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  pick(box, 'list-status', 'Done');
  pick(box, 'list-conductor', 'feature');
  assert.equal(table(box, 'runs'), null);
  assert.match(text(box.querySelector('#list-panel')), /No flow run matches these filters\./);
  press(box, 'Clear the search and filters');
  assert.deepEqual(cells(box, 'runs'), ['Login', 'Signup', 'Spiky']);
  assert.equal((box.querySelector('#list-status') as HTMLSelectElement).value, '');
  assert.equal((box.querySelector('#list-conductor') as HTMLSelectElement).value, '');

  // A tab with no rows at all says that instead.
  const delta = await draw('list', { to: 'list', project: 'github-com-acme-delta' });
  assert.equal(tabOf(delta.box, 'Loose sessions').getAttribute('aria-selected'), 'true', 'the tab that has rows');
  tabOf(delta.box, 'Flow runs').click();
  assert.match(text(delta.box.querySelector('#list-panel')), /No flow run or audit in this project yet\./);
  assert.equal(delta.box.querySelector('#list-panel select'), null);
});

test('audit_shows_unknown_without_picks', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const [picked, unknown] = trs(box, 'audits');
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
  assert.ok(box.querySelector('.build > .where-graph .graph'), 'every task says what it depends on: a graph');
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Lets a click's or a toggle's reads answer and draw. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};
/** Opens the turn's first tool call fold, as the user would, and waits for its input to be drawn. */
async function openCall(turn: Element) {
  const call = turn.querySelector('details.tool-call') as HTMLDetailsElement;
  const toggled = new Promise((resolve) => call.addEventListener('toggle', resolve, { once: true }));
  call.open = true;
  await toggled;
  await settle();
  return call;
}
const olderButton = (box: Element) =>
  [...box.querySelectorAll('button')].find((b) => text(b) === 'Show older turns') as HTMLButtonElement | undefined;

/** An invented session of `n` turns, prompts `Prompt 0` (oldest) on, each with one command. */
function longSession(n: number) {
  const at = (i: number) =>
    `2026-01-19T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`;
  return {
    agents: [],
    live: { waiting: null },
    start: 0,
    total: n,
    turns: Array.from({ length: n }, (_, i) => ({
      prompt: { at: at(i), text: `Prompt ${i}`, agent: null },
      replies: [],
      tools: [{ id: `t${i}`, at: at(i), agent: null, tool: 'Bash', summary: `Step ${i}`, failed: false }],
    })),
  };
}

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
  // A call's input is fetched and drawn when its fold opens: a long session has hundreds.
  assert.doesNotMatch(text(turns[0]), /npm test/);
  await openCall(turns[0]);
  assert.match(text(turns[0].querySelector('details.tool-call pre')), /^npm test$/);
  await openCall(turns[1]);
  assert.ok(turns[1].querySelector('details.tool-call .diff'), 'an edit shows as a diff');
  assert.deepEqual(names(box, 'Sessions'), ['Latest session']);
  assert.equal(olderButton(box), undefined, 'a session with no older turns has no button');

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

/** The runtime drawing the activity view's screen for session `id`, over `invoke`. */
async function activityRuntime(invoke: (cmd: string, args?: any) => Promise<any>, id: string) {
  const { createRuntime } = await import('../../app/shell/runtime.js');
  const handlers = new Map<string, (event: any) => void>();
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const runtime = createRuntime({
    root,
    invoke,
    listen: async (name: string, handler: any) => handlers.set(name, handler),
    importModule: () => import(`../activity/activity.ts?t=${++fresh}`),
  });
  await runtime.start({ to: 'session', project: ALPHA, id });
  return { root, runtime, handlers };
}

test('activity_draws_the_newest_20_turns_and_loads_older_ones_on_click', async () => {
  const long = longSession(45);
  const asked: any[] = [];
  const session = async (id: string, opts?: any) => {
    asked.push(opts ?? {});
    return pageOf(long, opts);
  };
  const { box } = await draw('activity', { to: 'session', project: ALPHA, id: 's-long' }, {}, { session });
  const shown = () => [...box.querySelectorAll('.turn-h')].map((h) => text(h));
  assert.equal(shown().length, 20);
  assert.deepEqual([shown()[0], shown()[19]], ['Prompt 44', 'Prompt 25']);
  // The screen's title is the session's first prompt, though that turn isn't drawn yet.
  assert.equal(text(box.querySelector('h1')), 'Prompt 0');

  const more = olderButton(box);
  assert.ok(more, 'a real button loads older turns');
  more.click();
  await settle();
  assert.equal(shown().length, 40);
  assert.deepEqual([shown()[20], shown()[39]], ['Prompt 24', 'Prompt 5']);
  assert.deepEqual(asked.at(-1), { before: 25, limit: 20 });
  olderButton(box)!.click();
  await settle();
  assert.equal(shown().length, 45);
  assert.equal(shown().at(-1), 'Prompt 0');
  assert.equal(olderButton(box), undefined, 'none left to load');
});

test('activity_keeps_older_turns_across_a_redraw_and_fetches_only_the_newest', async () => {
  const long = longSession(45);
  const asked: any[] = [];
  const invoke = async (cmd: string, args: any = {}) => {
    if (cmd === 'views') return [{ id: 'activity', source: 'Builtin', replaced: false }];
    if (cmd === 'view_source') return '';
    if (cmd === 'session') {
      asked.push(args);
      return pageOf(long, args);
    }
    return null;
  };
  const { root, runtime, handlers } = await activityRuntime(invoke, 's-long');
  const shown = () => [...root.querySelectorAll('.turn-h')].map((h) => text(h));
  olderButton(root)!.click();
  await settle();
  assert.equal(shown().length, 40);

  // A new turn arrives: the redraw asks for the newest page only and keeps the older turns it loaded.
  const next = longSession(46).turns[45];
  long.turns.push(next);
  asked.length = 0;
  handlers.get('changed')!({ payload: { project: ALPHA } });
  await runtime.idle();
  assert.deepEqual(asked, [{ id: 's-long', before: null, limit: null }]);
  assert.equal(shown().length, 41);
  assert.deepEqual([shown()[0], shown().at(-1)], ['Prompt 45', 'Prompt 5']);
  assert.ok(olderButton(root));
});

test('activity_fetches_a_calls_input_when_its_fold_opens', async () => {
  const asked: string[][] = [];
  const answers: { resolve: (v: any) => void; reject: (e: any) => void }[] = [];
  const toolInput = (session: string, id: string) => {
    asked.push([session, id]);
    return new Promise((resolve, reject) => answers.push({ resolve, reject }));
  };
  const { box } = await draw('activity', { to: 'session', project: ALPHA, id: 's-link' }, {}, { toolInput });
  assert.deepEqual(asked, [], 'nothing is fetched before a fold opens');
  const [newer, older] = [...box.querySelectorAll('.turn')];
  const call = await openCall(newer);
  assert.deepEqual(asked, [['s-link', 't3']]);
  assert.equal(text(call.querySelector('.unfold-body')), 'Loading…');
  answers[0].resolve({ kind: 'Command', command: 'npm test', description: 'Run the tests' });
  await settle();
  assert.equal(text(call.querySelector('pre')), 'npm test');

  // An input that can't be read says so in its fold.
  const failing = await openCall(older);
  answers[1].reject(new Error('the transcript is gone'));
  await settle();
  assert.match(text(failing.querySelector('.unfold-body')), /couldn't be read.*the transcript is gone/);
});

test('activity_folds_stay_on_their_turn_across_a_redraw', async () => {
  const sessions = clone(DATA.sessions);
  const invoke = async (cmd: string, args: any = {}) => {
    if (cmd === 'views') return [{ id: 'activity', source: 'Builtin', replaced: false }];
    if (cmd === 'view_source') return '';
    if (cmd === 'session') return pageOf(sessions[args.id], args);
    return null;
  };
  const { root, runtime, handlers } = await activityRuntime(invoke, 's-link');
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
  pick(alpha.box, 'list-conductor', 'research');
  pick(alpha.box, 'list-status', 'Done');
  pick(alpha.box, 'list-sort', 'name');
  const gamma = await draw(list, { to: 'list', project: 'github-com-acme-gamma' });
  assert.equal((gamma.box.querySelector('#list-status') as HTMLSelectElement).value, '');
  assert.equal((gamma.box.querySelector('#list-conductor') as HTMLSelectElement).value, '');
  assert.equal((gamma.box.querySelector('#list-sort') as HTMLSelectElement).value, 'name', 'a sort fits any project');
  assert.deepEqual(cells(gamma.box, 'runs'), ['Dfeat']);
  // A project without flow runs opens on its loose sessions.
  const solo = await draw(list, { to: 'list', project: 'folder-solo' });
  assert.deepEqual(cells(solo.box, 'loose'), ['Solo A.', 'Solo B.']);
});

test('list_tells_apart_projects_with_one_name', async () => {
  // beta's old checkout folder (no git left) and the moved repository are two projects of one name.
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  const marks = (b: Element) =>
    rowsOf(b, 'Projects').map((r) => [text(r.querySelector('.ttl')), text(r.querySelector('.mark'))]);
  assert.deepEqual(marks(box), [
    ['alpha', ''],
    ['beta', 'in old/beta'],
    ['beta', 'in work/beta'],
    ['delta', ''],
    ['gamma', ''],
    ['solo', ''],
  ]);
  // The mark is there only for a project that needs one, in the list's own rail section (it sits under the name).
  assert.ok(group(box, 'Projects')?.classList.contains('projects'));
  assert.equal(rowsOf(box, 'Projects')[0].querySelector('.mark'), null);

  // A fork and its upstream cloned side by side: one parent folder, so the mark names the folder too.
  const projects = [
    { id: 'github-com-me-app', name: 'app', roots: ['/home/you/src/app'] },
    { id: 'github-com-upstream-app', name: 'app', roots: ['/home/you/src/app-upstream'] },
  ];
  const side = await draw('list', { to: 'list', project: 'github-com-me-app' }, { projects });
  assert.deepEqual(marks(side.box), [
    ['app', 'in src/app'],
    ['app', 'in src/app-upstream'],
  ]);
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

  // Another view's tab: the slot it draws in is the panel the tabs control.
  const docsTab = await draw('run', { to: 'run', project: ALPHA, slug: 'login', tab: 'docs' });
  const slot = docsTab.box.querySelector('[data-slot="run-tab"]');
  assert.equal(slot?.id, 'run-panel');
  assert.equal(slot?.getAttribute('role'), 'tabpanel');
  assert.equal(slot?.getAttribute('aria-labelledby'), 'run-tab-docs');
  resolves(docsTab.box);

  const gone = await draw('run', { to: 'run', project: ALPHA, slug: 'nope' });
  assert.equal(gone.box.querySelector('.error')?.getAttribute('role'), 'alert');
  const docs = await draw('docs', { to: 'run', project: ALPHA, slug: 'login', tab: 'docs' });
  resolves(docs.box);
});

test('run_graph_has_no_scrollbar_and_fits_its_column', () => {
  // The shell's stylesheet: the graph never scrolls on its own; from a 1200px window on it has its own column, as tall
  // as the visible content and pinned there, and its drawing only ever shrinks to fit it (never grows past full size).
  const css = readFileSync(new URL('../../app/shell/tokens.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const graphRules = rules.filter((r) => /(^|[\s,])\.graph\b/.test(r.sel));
  assert.ok(graphRules.length > 0, 'no .graph rules');
  for (const r of graphRules) assert.doesNotMatch(r.body, /overflow(-x|-y)?\s*:\s*(auto|scroll)/, r.sel);
  const svg = rules.find((r) => r.sel === '.graph svg')?.body ?? '';
  assert.match(svg, /max-width:\s*100%/);
  assert.doesNotMatch(svg, /min-(width|height)|(^|[\s;])(width|height):\s*\d/, 'the drawing never grows');
  // The shared Mermaid box scrolls (`.diagram { overflow-x: auto }`); in the graph column it is clipped and laid out
  // as a column, so a pending source never scrolls and a failure's reason stays visible under it.
  const box = rules.find((r) => r.sel === '.where-graph .diagram')?.body ?? '';
  assert.match(box, /overflow:\s*hidden/);
  assert.match(box, /display:\s*flex/);
  assert.match(box, /flex-direction:\s*column/);
  const pending = rules.find((r) => r.sel === '.where-graph .diagram > pre')?.body ?? '';
  assert.match(pending, /overflow:\s*hidden/);
  assert.match(pending, /max-height:\s*calc\(100vh/);
  const beside =
    /@media \(min-width: (\d+(?:\.\d+)?)rem\) \{ \.build \{ grid-template-columns: minmax\(0, 1fr\) [^;]+; \}([^@]*)\}/.exec(
      css,
    );
  assert.ok(beside, 'no two-column .build rule');
  assert.equal(Number(beside[1]) * 16, 1200, 'the graph goes beside the card from 1200px');
  assert.match(/\.where-graph \{([^}]*)\}/.exec(beside[2])?.[1] ?? '', /position:\s*sticky/);
  // Fit to the visible height, but never under 0.85 of full size and never past it.
  assert.match(
    /\.where-graph \.graph svg \{([^}]*)\}/.exec(beside[2])?.[1] ?? '',
    /height:\s*clamp\(calc\(var\(--full-h\) \* 0\.85\), calc\(100vh[^;]*\), var\(--full-h\)\)/,
  );
  // Wide windows give the graph a wider column.
  const wide =
    /@media \(min-width: (\d+(?:\.\d+)?)rem\) \{ \.build \{ grid-template-columns: minmax\(0, 1fr\) (\d+)rem; \} \}/.exec(
      css,
    );
  assert.ok(wide && Number(wide[2]) >= 26, 'no wider column on wide windows');
  // Its labels are larger than the docs' diagrams', for this graph only.
  assert.match(rules.find((r) => r.sel === '.where-graph .graph text')?.body ?? '', /font-size:\s*var\(--text-md\)/);
});

test('run_graph_draws_its_nodes_larger_and_knows_its_full_height', async () => {
  const w = window as any;
  let source = '';
  w.mermaid = {
    initialize() {},
    render: async (id: string, src: string) => {
      source = src;
      return { svg: `<svg id="${id}" viewBox="0 0 240 1180"><g class="node" id="flowchart-T1-0"></g></svg>` };
    },
  };
  try {
    const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
    await tick();
    // Larger circles for this graph only: its own source asks for more padding.
    assert.match(source, /^flowchart TB\n%%\{init: \{"flowchart": \{"padding": 13\}\}\}%%\n/);
    // The drawing's full height, for the stylesheet's fit-to-height floor.
    const graphBox = box.querySelector('.where-graph .graph') as HTMLElement;
    assert.equal(graphBox.style.getPropertyValue('--full-h'), '1180px');
  } finally {
    delete w.mermaid;
  }
});

test('run_graph_has_its_own_column_beside_now_and_card', async () => {
  const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' });
  const build = box.querySelector('.content > .build');
  assert.ok(build, 'no .build layout');
  const main = build.querySelector(':scope > .build-main');
  assert.ok(main?.querySelector(':scope > .now') && main.querySelector(':scope > article.task'));
  const where = build.querySelector(':scope > .where-graph');
  assert.ok(where, 'the graph is not its own column');
  assert.equal(box.querySelector('article.task .where-graph'), null, 'the graph left the card');
  // The legend sits above the graph, its ring sentence on a line of its own.
  assert.deepEqual(
    [...where.children].filter((c) => !c.classList.contains('visually-hidden')).map((c) => c.className),
    ['key', 'graph'],
  );
  assert.equal(
    text(where.querySelector('.key')),
    'Done, being built, waiting on you, not started; ringed is this task.',
  );
  assert.equal(text(where.querySelector('.key .ring')), 'ringed is this task.');
  // Picking another task redraws both columns in the same shape.
  press(box, 'The form');
  assert.ok(box.querySelector('.content > .build > .build-main > article.task'));
  assert.ok(box.querySelector('.content > .build > .where-graph .graph'));
  assert.equal(text(box.querySelector('.task .does')), 'Draws the form.');
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

test('run_draws_a_lettered_task_in_place', async () => {
  // A task added during the build, as the core gives it: after the task it follows, being built.
  const runs = clone(DATA.runs);
  const login = runs[`${ALPHA}/login`];
  login.plan.tasks.push({
    id: '2b',
    title: 'The lockout',
    does: 'Locks the form after five tries.',
    depends_on: ['2'],
    markdown: '',
  });
  login.ledger.tasks.find((t: any) => t.id === '2').state = 'Done';
  login.ledger.tasks.push({
    id: '2b',
    state: 'Building',
    fix_rounds: 0,
    security: [],
    later: [],
    story: ['dispatched (base def4567, implementer opus)'],
    model: 'opus',
  });
  const w = window as any;
  let source = '';
  w.mermaid = {
    initialize() {},
    render: async (id: string, src: string) => {
      source = src;
      return {
        svg: `<svg id="${id}"><g class="node" id="flowchart-T1-0"></g><g class="node" id="flowchart-T2b-2"></g></svg>`,
      };
    },
  };
  try {
    const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' }, { runs });
    await tick();
    // The rail lists it in its place, and the card follows the task being built.
    assert.deepEqual(
      rowsOf(box, 'Tasks').map((r) => r.getAttribute('data-task')),
      ['1', '2', '2b'],
    );
    assert.equal(box.querySelector('.row[aria-current="true"]')?.getAttribute('data-task'), '2b');
    assert.match(text(box.querySelector('.task-h')), /2b\s*The lockout\s*Being built/);
    assert.match(text(box.querySelector('.task .facts')), /^Needs task 2 first\.$/);
    assert.match(text(box.querySelector('.now .summary')), /^2 of 3 tasks done\./);
    // The graph names it with a valid Mermaid id, linked from the task it depends on and ringed.
    // Top to bottom: the first task at the top, dependencies flowing down.
    assert.match(source, /^flowchart TB\n/);
    assert.match(source, /^ {2}T2b\(\("2b"\)\)$/m);
    assert.match(source, /^ {2}T2 --> T2b$/m);
    const node = box.querySelector('#flowchart-T2b-2') as Element;
    assert.equal(node.getAttribute('aria-label'), 'Task 2b, The lockout: being built');
    assert.equal(node.getAttribute('aria-current'), 'true', 'the task being built is ringed');

    press(box, 'The form');
    assert.match(text(box.querySelector('.task .facts')), /Task 2 waits for it\./);
    await tick();
    box.querySelector('#flowchart-T2b-2')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(text(box.querySelector('.task .does')), 'Locks the form after five tries.');
    assert.equal(box.querySelector('.row[aria-current="true"]')?.getAttribute('data-task'), '2b');
  } finally {
    delete w.mermaid;
  }
});

test('run_graph_is_one_drawing_that_rings_the_picked_task', async () => {
  // Its own task states, so its source is one no other test drew (the shell keeps drawings while the page lives).
  const runs = clone(DATA.runs);
  runs[`${ALPHA}/login`].ledger.tasks.find((t: any) => t.id === '2').state = 'Waiting';
  const w = window as any;
  const sources: string[] = [];
  w.mermaid = {
    initialize() {},
    render: async (id: string, src: string) => {
      sources.push(src);
      const node = (n: string, i: number) =>
        `<g class="node" id="flowchart-T${n}-${i}"><circle r="20"></circle><g class="label"><text><tspan>${n}</tspan></text></g></g>`;
      return { svg: `<svg id="${id}" viewBox="0 0 120 300">${node('1', 0)}${node('2', 1)}</svg>` };
    },
  };
  try {
    const { box } = await draw('run', { to: 'run', project: ALPHA, slug: 'login' }, { runs });
    await tick();
    assert.equal(sources.length, 1);
    // No ring in the source: the drawing is the same whichever task is picked.
    assert.doesNotMatch(sources[0], /^\s*style /m);
    const ringed = () => [...box.querySelectorAll('.graph g.node[aria-current="true"]')].map((g) => g.id);
    assert.deepEqual(ringed(), ['flowchart-T2-1']);
    const circle = (id: string) => box.querySelector(`#${id} circle`) as SVGElement;
    assert.equal(circle('flowchart-T2-1').style.getPropertyValue('stroke-width'), '3px');
    assert.equal(circle('flowchart-T2-1').style.getPropertyPriority('fill'), 'important');
    assert.equal(circle('flowchart-T1-0').style.getPropertyValue('stroke-width'), '');

    press(box, 'The form');
    // Picking another task draws at once from the same drawing, the ring moved.
    assert.ok(box.querySelector('.where-graph .graph svg'), 'drawn at once, no placeholder');
    assert.deepEqual(ringed(), ['flowchart-T1-0']);
    assert.equal(circle('flowchart-T1-0').style.getPropertyValue('stroke-width'), '3px');
    assert.equal(circle('flowchart-T2-1').style.getPropertyValue('stroke-width'), '');
    await settle();
    assert.equal(sources.length, 1, 'not drawn again');
  } finally {
    delete w.mermaid;
  }
});

test('list_switch_and_filters_survive_a_redraw', async () => {
  const { createRuntime } = await import('../../app/shell/runtime.js');
  const entries = clone(DATA.entries);
  const handlers = new Map<string, (event: any) => void>();
  const invoke = async (cmd: string, args: any = {}) => {
    if (cmd === 'views') return [{ id: 'list', source: 'Builtin', replaced: false }];
    if (cmd === 'view_source') return '';
    if (cmd === 'projects') return DATA.projects;
    if (cmd === 'entries') return entries[args.project] ?? [];
    return null;
  };
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const runtime = createRuntime({
    root,
    invoke,
    listen: async (name: string, handler: any) => handlers.set(name, handler),
    importModule: () => import(`../list/list.ts?t=${++fresh}`),
  });
  await runtime.start({ to: 'list', project: ALPHA });
  const redraw = async () => {
    handlers.get('changed')!({ payload: { project: ALPHA } });
    await runtime.idle();
  };

  // Flow runs, by name, feature only; the conductor select keeps focus when a new run arrives.
  pick(root, 'list-sort', 'name');
  pick(root, 'list-conductor', 'feature');
  (root.querySelector('#list-conductor') as HTMLElement).focus();
  entries[ALPHA].unshift({ ...clone(entries[ALPHA][0]), slug: 'avatar', last_activity: '2026-01-20T12:00:00Z' });
  await redraw();
  assert.deepEqual(cells(root, 'runs'), ['Avatar', 'Login', 'Signup']);
  assert.equal((root.querySelector('#list-conductor') as HTMLSelectElement).value, 'feature');
  assert.equal((root.querySelector('#list-sort') as HTMLSelectElement).value, 'name');
  assert.equal(document.activeElement?.id, 'list-conductor');
  assert.equal(text(tabOf(root, 'Flow runs').querySelector('.count')), '4');

  // Loose sessions, searched, with the search focused: the tab, the text and the focus stay.
  tabOf(root, 'Loose sessions').click();
  const search = root.querySelector('#list-search') as HTMLInputElement;
  search.focus();
  typeIn(root, 'quick');
  await redraw();
  assert.equal(tabOf(root, 'Loose sessions').getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement?.id, 'list-search');
  assert.equal((root.querySelector('#list-search') as HTMLInputElement).value, 'quick');
  assert.deepEqual(cells(root, 'loose'), ['A quick question.']);
});

/** The list in the real runtime over a copy of the fixtures, which a test changes before `redraw`. */
async function listRuntime(project: string) {
  const { createRuntime } = await import('../../app/shell/runtime.js');
  const entries = clone(DATA.entries);
  const handlers = new Map<string, (event: any) => void>();
  const invoke = async (cmd: string, args: any = {}) => {
    if (cmd === 'views') return [{ id: 'list', source: 'Builtin', replaced: false }];
    if (cmd === 'view_source') return '';
    if (cmd === 'projects') return DATA.projects;
    if (cmd === 'entries') return entries[args.project] ?? [];
    return null;
  };
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const runtime = createRuntime({
    root,
    invoke,
    listen: async (name: string, handler: any) => handlers.set(name, handler),
    importModule: () => import(`../list/list.ts?t=${++fresh}`),
  });
  await runtime.start({ to: 'list', project });
  const redraw = async () => {
    handlers.get('changed')!({ payload: { project } });
    await runtime.idle();
  };
  return { root, entries, redraw };
}

test('list_keeps_a_picked_status_its_runs_left', async () => {
  const { root, entries, redraw } = await listRuntime(ALPHA);
  pick(root, 'list-status', 'Waiting');
  pick(root, 'list-conductor', 'research');
  // The user answers signup, and spiky's conductor is renamed: no row has either value any more.
  const signup = entries[ALPHA].find((e: any) => e.slug === 'signup');
  signup.status = 'Working';
  entries[ALPHA].find((e: any) => e.slug === 'spiky').conductor = 'study';
  await redraw();
  const status = root.querySelector('#list-status') as HTMLSelectElement;
  const conductor = root.querySelector('#list-conductor') as HTMLSelectElement;
  assert.equal(status.value, 'Waiting');
  assert.equal(text(status.selectedOptions[0]), 'Waiting on you (0)');
  assert.equal(conductor.value, 'research');
  assert.equal(text(conductor.selectedOptions[0]), 'Research (0)');
  assert.match(text(root.querySelector('#list-panel')), /No flow run matches these filters\./);
});

test('list_row_keeps_focus_across_a_resort', async () => {
  const { root, entries, redraw } = await listRuntime(ALPHA);
  const signup = () => trs(root, 'runs').find((tr) => text(tr.querySelector('.name')) === 'Signup')!;
  (signup().querySelector('button') as HTMLElement).focus();
  // A newer run sorts in above it.
  entries[ALPHA].unshift({ ...clone(entries[ALPHA][0]), slug: 'avatar', last_activity: '2026-01-20T12:00:00Z' });
  await redraw();
  assert.deepEqual(cells(root, 'runs'), ['Avatar', 'Login', 'Signup', 'Spiky']);
  assert.equal(document.activeElement, signup().querySelector('button'));
});

test('list_clear_the_search_leaves_the_run_filters', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  pick(box, 'list-conductor', 'research');
  tabOf(box, 'Loose sessions').click();
  typeIn(box, 'nothing like this');
  press(box, 'Clear the search');
  assert.equal(cells(box, 'loose').length, 2);
  tabOf(box, 'Flow runs').click();
  assert.equal((box.querySelector('#list-conductor') as HTMLSelectElement).value, 'research');
  assert.deepEqual(cells(box, 'runs'), ['Spiky']);
});

test('list_with_only_audits_says_it_has_no_flow_run', async () => {
  const entries = clone(DATA.entries);
  entries[ALPHA] = entries[ALPHA].filter((e: any) => e.kind === 'Audit');
  const { box } = await draw('list', { to: 'list', project: ALPHA }, { entries });
  assert.equal(tabOf(box, 'Flow runs').getAttribute('aria-selected'), 'true');
  assert.equal(text(tabOf(box, 'Flow runs').querySelector('.count')), '0');
  assert.equal(table(box, 'runs'), null);
  assert.match(text(box.querySelector('#list-panel')), /No flow run in this project yet\./);
  assert.equal(trs(box, 'audits').length, 2);
  assert.equal(box.querySelector('#list-status'), null);
  assert.ok(box.querySelector('#list-conductor'));
});

test('list_state_column_only_when_a_row_has_a_mark', async () => {
  const { box } = await draw('list', { to: 'list', project: ALPHA });
  assert.ok(heads(box, 'runs').includes('State'));
  pick(box, 'list-status', 'Done');
  assert.deepEqual(heads(box, 'runs'), ['Name', 'Conductor', 'Now or phase', 'Gates', 'Tasks', 'Last activity']);
  assert.equal(trs(box, 'runs')[0].children.length, 6);
});
