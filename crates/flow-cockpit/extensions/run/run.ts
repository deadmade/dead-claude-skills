// The flow run view, ported from the approved design (crates/flow-cockpit/design/run-view.html). Build: the phases and
// tasks in the rail, the selected task as the one focal point. Decisions: deviations, decisions and the build's own
// calls as master and detail. The run's other tabs (Docs, Activity) are views of their own, drawn by the runtime into
// this view's `data-slot="run-tab"` element across the window's lower row.
import type {
  View,
  ViewContext,
  Decision,
  Deviation,
  FlowDoc,
  FlowRun,
  Gate,
  LedgerTask,
  PlanTask,
  Ruling,
  Status,
  TaskState,
} from 'flow-cockpit';

type Pair = { p: PlanTask; t: LedgerTask | undefined };
type Item =
  | { id: string; kind: 'dev'; d: Deviation }
  | { id: string; kind: 'dec'; d: Decision }
  | { id: string; kind: 'rul'; d: Ruling };
/** What the user picked in this run, kept while the window is open so a redraw with fresh data keeps it. */
type Memory = { tab: 'build' | 'decisions'; task: string | null; item: string | null };

const memory = new Map<string, Memory>();

const OWN_TABS: [string, string][] = [
  ['build', 'Build'],
  ['decisions', 'Decisions'],
];
const TAB_ORDER = ['docs', 'activity'];
/** The element the tabs control: this view's content, or the slot another view's tab draws in. */
const PANEL = 'run-panel';
const STATUS_LABEL: Record<Status, string> = {
  Waiting: 'Waiting on you',
  Working: 'Working',
  Idle: 'Idle',
  Stale: 'Stale',
  Done: 'Done',
};
// The rail names a state only when it is the exception.
const MARK: Partial<Record<TaskState, string>> = { Building: 'Now', Review: 'Review', Waiting: 'Needs you' };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...kids);
  return node;
}

function button(className: string, ...kids: (Node | string)[]): HTMLButtonElement {
  const b = el('button', className, ...kids);
  b.type = 'button';
  return b;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
// Capitalises a plain first word only; an identifier such as `list_items` keeps its case.
const capital = (s: string) => (/^[a-z]+(\s|$)/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const joined = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const day = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
/** `flow-observability` as `Flow observability`. */
const runName = (slug: string) => capital(slug.replace(/[-_]+/g, ' '));

/**
 * A line of Markdown as inline content, through the shared Markdown block: its one paragraph unwrapped, and links kept
 * as their text, since a row or a heading is not a place to follow one.
 */
function inline(ctx: ViewContext, text: string): HTMLSpanElement {
  const box = ctx.blocks.markdown(text);
  const first = box instanceof window.Element ? box.firstElementChild : null;
  // marked ends a paragraph with a newline: only elements count.
  const only =
    first && first.tagName === 'P' && box instanceof window.Element && box.children.length === 1 ? first : box;
  const out = el('span');
  out.append(...only.childNodes);
  for (const a of out.querySelectorAll('a')) a.replaceWith(...a.childNodes);
  return out;
}

/** A block of Markdown at the reading measure. */
const md = (ctx: ViewContext, text: string) => ctx.blocks.markdown(text);

function fold(label: string, count: string, body: Node): HTMLDetailsElement {
  const details = el('details', 'unfold');
  details.append(el('summary', '', el('span', '', label), el('span', 'count', count)), el('div', 'unfold-body', body));
  return details;
}

/** `node`, named by the element with id `id`. */
function labelled<T extends Element>(node: T, id: string): T {
  node.setAttribute('aria-labelledby', id);
  return node;
}

/** A section of the content, named by its heading as in the design. */
function part(id: string, title: string, ...body: Node[]): HTMLElement {
  const head = el('h3', 'part-h', title);
  head.id = id;
  const section = el('section', 'part', head, ...body);
  section.setAttribute('aria-labelledby', id);
  return section;
}

function empty(first: string, second?: string): HTMLDivElement {
  const box = el('div', 'empty', el('p', '', first));
  if (second) box.append(el('p', '', second));
  return box;
}

const phaseName = (flow: FlowDoc) => flow.phases.find((p) => p.key === flow.phase)?.name ?? capital(flow.phase ?? '');

function taskState(t: LedgerTask | undefined): { cls: string; text: string } {
  if (!t) return { cls: 'NotStarted', text: 'Not started' };
  if (t.state === 'Done')
    return { cls: 'Done', text: t.fix_rounds ? `Done after ${plural(t.fix_rounds, 'fix round')}` : 'Done' };
  if (t.state === 'Review')
    return { cls: 'Review', text: t.fix_rounds ? `In review, fix round ${t.fix_rounds + 1}` : 'In review' };
  const text = { Building: 'Being built', Waiting: 'Waiting on you', NotStarted: 'Not started' }[t.state];
  return { cls: t.state, text };
}

// What happened, in sentences built from typed fields only; the build log's own lines are one click away.
function happened(t: LedgerTask | undefined): string {
  if (!t) return 'Nothing has happened on this task yet.';
  const by = t.model ? ` by ${t.model}` : '';
  const sent = t.fix_rounds ? `review sent it back ${times(t.fix_rounds)}` : '';
  if (t.state === 'Done')
    return `Built${by}${sent ? `; ${sent}, and the fix ${t.fix_rounds === 1 ? 'round' : 'rounds'} closed every finding` : ' and approved in the first review'}.`;
  if (t.state === 'Review') return `Built${by} and now in review${sent ? `; ${sent} so far` : ''}.`;
  if (t.state === 'Waiting') return `Built${by}, and waiting for your decision before it goes on.`;
  if (t.state === 'Building') return `Being built${by}${sent ? `; ${sent} so far` : ''}.`;
  return 'Nothing has happened on this task yet.';
}

/** A gate's verdict, from its typed fields. */
function verdict(g: Gate): string {
  return g.approved
    ? `${capital(g.what)} on ${day(g.approved)}${g.reopened ? ', after it was reopened once and approved again' : ''}.`
    : `${capital(g.what)}: not yet${g.reopened ? '; it was reopened and waits for approval again' : ''}.`;
}

function gateLine(gates: Gate[]): string {
  if (!gates.length) return '';
  const passed = gates.filter((g) => g.approved);
  if (passed.length === gates.length) {
    const dates = [...new Set(passed.map((g) => g.approved))];
    const all = gates.length === 2 ? 'Both gates' : gates.length === 1 ? 'The gate' : `All ${gates.length} gates`;
    return `${all} passed${dates.length === 1 && dates[0] ? ` ${day(dates[0])}` : ''}.`;
  }
  const open = gates.filter((g) => !g.approved);
  const names = joined(open.map((g) => `gate ${g.n}`));
  return `${names.charAt(0).toUpperCase()}${names.slice(1)} ${open.length === 1 ? 'is' : 'are'} open.`;
}

/** A gate row that opens to its verdict. */
function gateRow(g: Gate): HTMLLIElement {
  const row = button(
    `row gate ${g.approved ? 'passed' : 'open'}`,
    el('span', 'k num', `G${g.n}`),
    el('span', 'ttl', `Gate ${g.n}, ${g.what}`),
    el('span', 'mark', g.approved ? `Passed ${day(g.approved)}` : 'Open'),
  );
  const note = el('span', 'gate-note', el('span', 'verdict', verdict(g)));
  note.hidden = true;
  row.append(note);
  row.setAttribute('aria-expanded', 'false');
  row.addEventListener('click', () => {
    const open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', String(!open));
    note.hidden = open;
  });
  return el('li', '', row);
}

/** The phase track: one line of segments with gate ticks, the full list of phases and gates on demand. */
function track(flow: FlowDoc): Node[] {
  const gates = flow.gates;
  const line = gateLine(gates);
  if (!flow.phases.length) {
    const nodes: Node[] = [el('p', 'track-text', `${flow.phase ? `${phaseName(flow)}. ` : ''}${line}`)];
    if (gates.length) nodes.push(el('ol', 'rows phase-list', ...gates.map(gateRow)));
    return nodes;
  }
  const segs = el('span', 'segs');
  segs.setAttribute('aria-hidden', 'true');
  const list = el('ol', 'rows phase-list');
  list.id = 'phase-list';
  list.hidden = true;
  flow.phases.forEach((p, i) => {
    const cls = p.state === 'Done' ? 'done' : p.state === 'Now' ? 'current' : '';
    segs.append(el('span', `seg ${cls}`.trim()));
    const row = el(
      'li',
      `row phase ${cls}`.trim(),
      el('span', 'k num', String(i + 1)),
      el('span', 'ttl', p.name),
      el('span', 'mark', p.state === 'Done' ? 'Done' : p.state === 'Now' ? 'Now' : ''),
    );
    if (p.state === 'Now') row.setAttribute('aria-current', 'step');
    list.append(row);
    if (p.gate_after !== null) {
      const g = gates.find((x) => x.n === p.gate_after);
      segs.append(el('span', g?.approved ? 'tick passed' : 'tick'));
      list.append(
        g
          ? gateRow(g)
          : el(
              'li',
              'row gate open',
              el('span', 'k num', `G${p.gate_after}`),
              el('span', 'ttl', `Gate ${p.gate_after}`),
              el('span', 'mark', 'Not written'),
            ),
      );
    }
  });
  const now = flow.phases.findIndex((p) => p.state === 'Now');
  const where = el('span', 'track-text');
  if (flow.phase === 'done' || flow.phases.every((p) => p.state === 'Done'))
    where.textContent = 'Done, every phase passed.';
  else if (now >= 0) where.append(el('b', '', flow.phases[now].name), `, phase ${now + 1} of ${flow.phases.length}.`);
  else where.textContent = 'No phase is under way.';
  const toggle = button('track', segs, where);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'phase-list');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    list.hidden = open;
  });
  const nodes: Node[] = [toggle];
  if (line) nodes.push(el('p', 'track-gates', line));
  nodes.push(list);
  return nodes;
}

/**
 * The plan's tasks as a graph (the shell's task graph, one drawing for every task, which the window draws ahead); a
 * node selects its task, and the selected one is ringed on the drawing.
 */
function graph(
  ctx: ViewContext,
  drawing: Node,
  all: Pair[],
  selected: string,
  select: (id: string) => void,
): HTMLElement {
  const box = el('div', 'graph', drawing);
  const taskOf = (node: Element) => /T(\d+[a-z]?)/.exec(node.id)?.[1];
  // The ring: a heavier outline and full-contrast text, over the state's own colours.
  const ring = (g: Element) => {
    g.setAttribute('aria-current', 'true');
    for (const shape of g.querySelectorAll<SVGElement>('circle')) {
      shape.style.setProperty('fill', 'var(--color-paper-4)', 'important');
      shape.style.setProperty('stroke-width', '3px', 'important');
    }
    for (const label of g.querySelectorAll<SVGElement>('text, tspan'))
      label.style.setProperty('fill', 'var(--color-ink)', 'important');
  };
  // A drawing not made yet draws after this returns: its nodes get their names and keys once they exist.
  const wire = () => {
    // The drawing's full height, which the stylesheet shrinks it from to fit the window, down to a floor.
    const full = Number(box.querySelector('svg')?.getAttribute('viewBox')?.split(/\s+/)[3]);
    if (full > 0) box.style.setProperty('--full-h', `${full}px`);
    for (const g of box.querySelectorAll('g.node')) {
      const id = taskOf(g);
      const x = all.find((y) => y.p.id === id);
      if (!x || g.hasAttribute('tabindex')) continue;
      const words = `Task ${id}, ${inline(ctx, x.p.title).textContent}: ${taskState(x.t).text.toLowerCase()}`;
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'link');
      g.setAttribute('aria-label', words);
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tip.textContent = words;
      g.prepend(tip);
      if (id === selected) ring(g);
    }
  };
  // Watched until the drawing is in (or failed), or the box has left the page; a drawing made earlier is in already.
  const watch = new window.MutationObserver(() => {
    wire();
    if (box.querySelector('svg, .diagram > .quiet') || !box.isConnected) watch.disconnect();
  });
  wire();
  if (!box.querySelector('svg')) watch.observe(box, { childList: true, subtree: true });
  const go = (event: Event) => {
    const node = event.target instanceof window.Element ? event.target.closest('g.node') : null;
    const id = node ? taskOf(node) : undefined;
    if (id === undefined || !all.some((x) => x.p.id === id)) return false;
    select(id);
    return true;
  };
  box.addEventListener('click', go);
  box.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && go(event)) event.preventDefault();
  });
  return box;
}

function taskView(ctx: ViewContext, all: Pair[], id: string | null, select: (id: string) => void): Node {
  const x = all.find((y) => y.p.id === id);
  if (!x)
    return empty(
      'This run has no plan with tasks yet.',
      'Task cards show once plan.md holds its tasks under task headings.',
    );
  const { p, t } = x;
  const st = taskState(t);
  const facts: string[] = [];
  if (p.depends_on?.length) facts.push(`Needs ${joined(p.depends_on.map((d) => `task ${d}`))} first.`);
  else if (p.depends_on) facts.push('Needs nothing else first.');
  const after = all.filter((y) => y.p.depends_on?.includes(p.id)).map((y) => `task ${y.p.id}`);
  if (after.length) facts.push(`${capital(joined(after))} ${after.length === 1 ? 'waits' : 'wait'} for it.`);
  const items = (tag: 'ol' | 'ul', xs: string[]) =>
    el(tag, 'items', ...xs.map((s) => el('li', '', inline(ctx, capital(s)))));

  const title = el('h2', '', el('span', 'n num', p.id), inline(ctx, p.title));
  title.id = 'task-title';
  const main = el('div', '', el('div', 'task-h', title, el('span', `state ${st.cls}`, st.text)));
  main.append(
    p.does ? el('p', 'does', inline(ctx, p.does)) : el('p', 'does quiet', "The plan doesn't say what this task does."),
  );
  if (facts.length) main.append(el('p', 'facts', facts.join(' ')));

  const hap = part('hap-h', 'What happened', el('p', '', happened(t)));
  if (t?.security.length)
    hap.append(el('p', 'sec', `${capital(plural(t.security.length, 'security note'))} came up in review.`));
  // Short content shows as it is; longer content folds behind a row in the page's own style.
  if (t?.story.length)
    hap.append(
      t.story.length <= 2
        ? items('ol', t.story)
        : fold('Build log', plural(t.story.length, 'entry', 'entries'), items('ol', t.story)),
    );
  main.append(hap);
  if (t?.later.length)
    main.append(
      part(
        'later-h',
        'Left for later',
        t.later.length <= 3
          ? items('ul', t.later)
          : fold('As the reviews wrote them', plural(t.later.length, 'small issue'), items('ul', t.later)),
      ),
    );
  main.append(part('plan-h', 'In the plan', fold('Files, steps and tests', '', md(ctx, p.markdown))));

  const card = el('article', 'task', main);
  card.setAttribute('aria-labelledby', 'task-title');
  return card;
}

/** The selected task's place in the plan: the legend over the graph, in a column of its own; null without a graph. */
function whereGraph(
  ctx: ViewContext,
  run: FlowRun,
  all: Pair[],
  id: string | null,
  select: (id: string) => void,
): HTMLElement | null {
  if (id === null || !all.some((x) => x.p.id === id)) return null;
  const drawing = ctx.blocks.taskGraph(run);
  if (!drawing) return null;
  const head = el('h2', 'visually-hidden', 'Where it sits in the plan');
  head.id = 'graph-h';
  const where = el('section', 'where-graph', head);
  where.setAttribute('aria-labelledby', 'graph-h');
  where.append(
    el(
      'p',
      'key',
      el('span', 'k-done', 'Done'),
      ', ',
      el('span', 'k-now', 'being built'),
      ', ',
      el('span', 'k-wait', 'waiting on you'),
      ', not started; ',
      el('span', 'ring', 'ringed is this task.'),
    ),
    graph(ctx, drawing, all, id, select),
  );
  return where;
}

/** The Build tab's content: where the run stands and the selected task, with its place in the plan beside them. */
function buildPanel(ctx: ViewContext, run: FlowRun, all: Pair[], id: string | null, select: (id: string) => void) {
  const where = whereGraph(ctx, run, all, id, select);
  const main = el('div', 'build-main', nowBlock(ctx, run, all), taskView(ctx, all, id, select));
  return el('div', 'build', main, ...(where ? [where] : []));
}

function nowBlock(ctx: ViewContext, run: FlowRun, all: Pair[]): HTMLElement {
  const { flow, ledger } = run;
  const done = all.filter((x) => x.t?.state === 'Done').length;
  const sentence =
    flow.now ??
    (flow.phase === 'done'
      ? 'This run is done.'
      : flow.phase
        ? `In ${phaseName(flow)}. This run doesn't say what comes next.`
        : "This run doesn't say where it stands.");
  const rounds = ledger ? ledger.tasks.reduce((a, t) => a + t.fix_rounds, 0) : 0;
  const sec = ledger ? ledger.tasks.reduce((a, t) => a + t.security.length, 0) : 0;
  const open = flow.deviations.filter((d) => d.status === 'Open').length;
  const summary = [
    ledger && all.length ? `${done} of ${all.length} tasks done.` : '',
    rounds ? `Reviews sent work back ${times(rounds)}.` : '',
    sec ? `${plural(sec, 'security note')}.` : '',
    open ? `${plural(open, 'deviation')} ${open === 1 ? 'waits' : 'wait'} for you.` : 'No deviation is open.',
  ]
    .filter(Boolean)
    .join(' ');
  const box = el(
    'section',
    run.summary.status === 'Waiting' ? 'now waiting' : 'now',
    el('p', 'sentence', inline(ctx, sentence)),
    el('p', 'summary', summary),
  );
  box.setAttribute('aria-label', 'Where this run stands');
  return box;
}

/** Every item of the Decisions tab: open deviations first, then decided ones, decisions, then the build's calls. */
function decisionItems(run: FlowRun) {
  const flow = run.flow;
  const rank = (d: Deviation) => (d.status === 'Open' ? 0 : d.status === 'Unknown' ? 2 : 1);
  const devs: Item[] = flow.deviations
    .map((d, i) => ({ id: `dev-${i}`, kind: 'dev' as const, d }))
    .sort((a, b) => rank(a.d) - rank(b.d));
  const decs: Item[] = flow.decisions.map((d, i) => ({ id: `dec-${i}`, kind: 'dec' as const, d }));
  // flow.md's own calls, as the approved design lists them.
  const calls = flow.rulings;
  const rules: Item[] = calls.map((d, i) => ({ id: `rul-${i}`, kind: 'rul' as const, d }));
  return { devs, decs, rules };
}

/** The selected item's heading, which names its article. */
function itemHead(title: Node): HTMLHeadingElement {
  const head = el('h2', 'item-h', title);
  head.id = 'item-h';
  return head;
}

function itemDetail(ctx: ViewContext, x: Item): Node[] {
  if (x.kind === 'dec') {
    const d = x.d;
    const lead = d.picked
      ? el('p', 'item-lead', el('span', 'tag', 'Picked'), inline(ctx, capital(d.picked)))
      : el('p', 'item-lead', el('span', 'tag open', 'Not picked yet'), 'It waits for your choice.');
    const nodes: Node[] = [itemHead(inline(ctx, d.title)), el('p', 'item-meta', 'A decision in Options'), lead];
    if (d.body) nodes.push(part('why-h', 'Why, and what else was offered', md(ctx, d.body)));
    return nodes;
  }
  if (x.kind === 'dev') {
    const d = x.d;
    const s = d.status;
    const meta = el('p', 'item-meta');
    if (s === 'Open') meta.append(el('span', 'tag open', 'Open'), 'It needs your decision before the build goes on.');
    else if (s === 'Unknown') meta.append('Written before the format had a status line.');
    else meta.append(el('span', 'tag', `Decided${s.Decided.date ? ` ${day(s.Decided.date)}` : ''}`));
    const nodes: Node[] = [itemHead(inline(ctx, d.title)), meta];
    if (d.body) nodes.push(part('hap-h', 'What happened', md(ctx, d.body)));
    if (s !== 'Open' && s !== 'Unknown')
      nodes.push(part('how-h', 'How it was decided', el('p', 'item-lead', inline(ctx, `${capital(s.Decided.what)}.`))));
    return nodes;
  }
  const d = x.d;
  const nodes: Node[] = [
    itemHead(inline(ctx, capital(d.call))),
    el(
      'p',
      'item-meta',
      `A call the build made on its own${d.scope ? `, ${d.scope}` : ''}${d.date ? `, ${day(d.date)}` : ''}.`,
    ),
  ];
  if (d.why) nodes.push(part('why-h', 'Why', md(ctx, `${capital(d.why).replace(/\.$/, '')}.`)));
  if (d.cost) nodes.push(part('cost-h', 'If it was the wrong call', md(ctx, `It costs ${d.cost.replace(/\.$/, '')}.`)));
  return nodes;
}

function frame(
  ctx: ViewContext,
  project: string,
  slug: string,
  tab: string | undefined,
  run: FlowRun | null,
  mem: Memory,
) {
  const win = el('div', 'window');
  const home = button('app', 'Flow cockpit');
  home.title = 'Back to the list';
  home.addEventListener('click', () => ctx.navigate({ to: 'list', project }));
  win.append(el('div', 'brand', home, el('h1', '', runName(slug))));

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Parts of this run');
  const where = el('p', 'where');
  const left = el('aside', 'left');
  const content = el('div', 'content');
  content.id = PANEL;
  content.setAttribute('role', 'tabpanel');

  if (!run) {
    win.append(el('div', 'tabs-bar', tabs, where), left, content);
    const error = el(
      'div',
      'error',
      el('h2', '', "This run can't be shown."),
      el('p', '', `No flow run named ${slug} is in this project now.`),
      el('p', '', 'Go back to the list to pick another.'),
    );
    error.setAttribute('role', 'alert');
    content.append(error);
    return win;
  }

  const { flow, summary } = run;
  const st = summary.status;
  const kind = flow.flow || summary.conductor;
  where.append(
    `${kind ? `${capital(kind)} flow` : 'Flow run'}${flow.phase ? `, in ${phaseName(flow)}` : ''}`,
    el('span', `status st-${st}`, STATUS_LABEL[st]),
  );
  const selected = tab ?? mem.tab;
  // The design's order: Build, Decisions, Docs; then Activity and any other run-tab view.
  const rank = (id: string) => (TAB_ORDER.includes(id) ? TAB_ORDER.indexOf(id) : TAB_ORDER.length);
  const others = [...ctx.tabs].sort((a, b) => rank(a.id) - rank(b.id));
  const all: [string, string][] = [...OWN_TABS, ...others.map((t): [string, string] => [t.id, t.title])];
  for (const [id, label] of all) {
    const b = button('tab', label);
    b.setAttribute('role', 'tab');
    b.id = `run-tab-${id}`;
    b.setAttribute('aria-controls', PANEL);
    b.dataset.tab = id;
    b.setAttribute('aria-selected', String(id === selected));
    b.addEventListener('click', () => {
      if (id === 'build' || id === 'decisions') {
        mem.tab = id;
        if (tab !== undefined) ctx.navigate({ to: 'run', project, slug });
        else paint();
      } else if (id !== tab) {
        ctx.navigate({ to: 'run', project, slug, tab: id });
      }
    });
    tabs.append(b);
  }
  win.append(el('div', 'tabs-bar', tabs, where));

  if (tab !== undefined) {
    // Another view draws this tab, across both columns.
    const slot = el('div');
    slot.dataset.slot = 'run-tab';
    slot.id = PANEL;
    slot.setAttribute('role', 'tabpanel');
    // A tab that isn't loaded has no button to name the panel.
    if (all.some(([id]) => id === tab)) slot.setAttribute('aria-labelledby', `run-tab-${tab}`);
    win.append(slot);
    return win;
  }
  win.append(left, content);

  const pairs: Pair[] = (run.plan?.tasks ?? []).map((p) => ({ p, t: run.ledger?.tasks.find((t) => t.id === p.id) }));
  const defaultTask = () =>
    (
      pairs.find((x) => x.t && x.t.state !== 'Done' && x.t.state !== 'NotStarted') ??
      pairs.find((x) => x.t?.state !== 'Done') ??
      pairs[0]
    )?.p.id ?? null;

  function build() {
    left.setAttribute('aria-label', 'Phases and tasks');
    if (!pairs.some((x) => x.p.id === mem.task)) mem.task = defaultTask();
    const phases = el('section', 'group', ...track(flow));
    phases.setAttribute('aria-label', 'Phases');
    left.append(phases);

    const select = (id: string) => {
      mem.task = id;
      for (const row of left.querySelectorAll<HTMLElement>('[data-task]'))
        row.setAttribute('aria-current', String(row.dataset.task === id));
      content.replaceChildren(buildPanel(ctx, run!, pairs, id, select));
      content.scrollTop = 0;
    };

    const group = labelled(el('section', 'group'), 'tk-h');
    if (!pairs.length) {
      group.append(
        Object.assign(el('h2', 'group-h', 'Tasks'), { id: 'tk-h' }),
        empty('No plan with tasks yet.', 'They show once plan.md holds its tasks under task headings.'),
      );
    } else {
      const done = pairs.filter((x) => x.t?.state === 'Done').length;
      const head = el(
        'h2',
        'group-h',
        el('span', '', 'Tasks'),
        el('span', 'aside', run!.ledger ? `${done} of ${pairs.length} done` : 'Not started in this checkout'),
      );
      head.id = 'tk-h';
      group.append(head);
      const rows = el('ol', 'rows');
      for (const { p, t } of pairs) {
        const state = t?.state ?? 'NotStarted';
        // One mark at most: the state when it is the exception, else a count that carries meaning.
        let mark: HTMLElement | null = null;
        if (MARK[state]) mark = el('span', `mark ${state}`, MARK[state]);
        else if (t?.security.length) mark = el('span', 'mark sec', plural(t.security.length, 'security note'));
        else if (t?.fix_rounds) mark = el('span', 'mark fix', plural(t.fix_rounds, 'fix', 'fixes'));
        const title = inline(ctx, p.title);
        const row = button(state === 'Done' ? 'row done' : 'row', el('span', 'k num', p.id));
        row.append(el('span', 'ttl', title), ...(mark ? [mark] : []));
        row.dataset.task = p.id;
        row.title = `Task ${p.id}, ${title.textContent}: ${taskState(t).text.toLowerCase()}`;
        row.setAttribute('aria-current', String(mem.task === p.id));
        row.addEventListener('click', () => select(p.id));
        rows.append(el('li', '', row));
      }
      group.append(rows);
    }
    left.append(group);
    content.append(buildPanel(ctx, run!, pairs, mem.task, select));
  }

  function decisions() {
    const { devs, decs, rules } = decisionItems(run!);
    const items = [...devs, ...decs, ...rules];
    const pick = () =>
      items.find((x) => x.id === mem.item) ??
      devs.find((x) => x.kind === 'dev' && x.d.status === 'Open') ??
      decs[0] ??
      items[0];
    const show = (x: Item | undefined) => {
      content.replaceChildren(
        x
          ? labelled(el('article', 'reading item', ...itemDetail(ctx, x)), 'item-h')
          : el(
              'div',
              'reading empty',
              el('p', '', 'No deviations, decisions or calls recorded yet.'),
              el('p', '', 'They show once flow.md holds them under Options, Deviations and Rulings.'),
            ),
      );
      content.scrollTop = 0;
    };
    const select = (id: string) => {
      mem.item = id;
      for (const row of left.querySelectorAll<HTMLElement>('[data-item]'))
        row.setAttribute('aria-current', String(row.dataset.item === id));
      show(items.find((x) => x.id === id));
    };
    const current = pick();
    const row = (x: Item, title: string, mark: string, markCls = 'mark', cls = '') => {
      const label = inline(ctx, title);
      const b = button(`row plain ${cls}`.trim(), el('span', 'ttl', capital(label.textContent ?? '')));
      if (mark) b.append(el('span', markCls, mark));
      b.dataset.item = x.id;
      b.title = label.textContent ?? '';
      b.setAttribute('aria-current', String(x === current));
      b.addEventListener('click', () => select(x.id));
      return el('li', '', b);
    };
    const group = (id: string, title: string, aside: string, body: Node) => {
      const head = el('h2', 'group-h', el('span', '', title), el('span', 'aside', aside));
      head.id = id;
      return labelled(el('section', 'group', head, body), id);
    };
    const open = devs.filter((x) => x.kind === 'dev' && x.d.status === 'Open').length;
    const unpicked = decs.filter((x) => x.kind === 'dec' && !x.d.picked).length;
    left.setAttribute('aria-label', "Deviations, decisions and the build's own calls");
    left.append(
      group(
        'dev-h',
        'Deviations',
        open ? `${open} open` : 'None open',
        devs.length
          ? el(
              'ol',
              'rows',
              ...devs.map((x) => {
                const s = (x.d as Deviation).status;
                if (s === 'Open') return row(x, (x.d as Deviation).title, 'Open', 'mark', 'open-dev');
                const date = s !== 'Unknown' && s.Decided.date ? day(s.Decided.date) : '';
                return row(x, (x.d as Deviation).title, date, 'mark', 'quiet-row');
              }),
            )
          : el('p', 'quiet', 'None so far. The plan has held.'),
      ),
      group(
        'dec-h',
        'Decisions',
        unpicked ? `${unpicked} not picked` : plural(decs.length, 'decision'),
        decs.length
          ? el(
              'ol',
              'rows',
              ...decs.map((x) => {
                const d = x.d as Decision;
                return row(x, d.title, d.picked ? '' : 'Not picked', 'mark Open');
              }),
            )
          : el('p', 'quiet', 'None recorded yet.'),
      ),
    );
    if (rules.length)
      left.append(
        group(
          'rul-h',
          'Calls the build made',
          String(rules.length),
          el(
            'ol',
            'rows',
            ...rules.map((x) => {
              const d = x.d as Ruling;
              return row(x, d.call, d.scope ?? '', 'mark', 'quiet-row');
            }),
          ),
        ),
      );
    show(current);
  }

  function paint() {
    for (const b of tabs.querySelectorAll<HTMLElement>('[data-tab]'))
      b.setAttribute('aria-selected', String(b.dataset.tab === mem.tab));
    content.setAttribute('aria-labelledby', `run-tab-${mem.tab}`);
    left.replaceChildren();
    content.replaceChildren();
    left.scrollTop = 0;
    content.scrollTop = 0;
    if (mem.tab === 'build') build();
    else decisions();
  }

  // Up and down move through the Decisions list.
  win.addEventListener('keydown', (e) => {
    if (mem.tab !== 'decisions' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.ctrlKey || e.metaKey)
      return;
    if (e.target instanceof window.Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const rows = [...left.querySelectorAll<HTMLButtonElement>('button.row[data-item]')];
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.getAttribute('aria-current') === 'true');
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    e.preventDefault();
    if (next !== rows[at]) next.click();
    next.focus();
  });

  paint();
  return win;
}

const view: View = {
  id: 'run',
  title: 'Flow run',
  slot: 'run',
  async render(ctx) {
    const route = ctx.route;
    if (route.to !== 'run') return el('div');
    const run = await ctx.data.flowRun(route.project, route.slug);
    const key = `${route.project}/${route.slug}`;
    const mem = memory.get(key) ?? { tab: 'build', task: null, item: null };
    memory.set(key, mem);
    return frame(ctx, route.project, route.slug, route.tab, run, mem);
  },
};

export default view;
