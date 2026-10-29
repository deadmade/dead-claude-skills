// The list: what ran in one project's checkouts and worktrees, in the run view's language. The rail holds only the
// projects. The content switches between two tabs: Flow runs (a table of runs, then a table of audits) and Loose
// sessions (the Claude sessions of the last 7 days that belong to no run), each under a filter bar that shows only the
// controls its rows have fields for. A row names its state only when it is the exception; a finished run is quiet.
import type {
  View,
  ViewContext,
  AuditSummary,
  Entry,
  FlowRunSummary,
  Gate,
  Project,
  SessionSummary,
  Status,
} from 'flow-cockpit';

type Sort = 'activity' | 'needs' | 'furthest' | 'name';
type Tab = 'runs' | 'loose';
/** The tab, filters and sort, kept while the window is open so a redraw with fresh data keeps them. */
const state = {
  /** The project the filters were picked in. */
  project: '',
  /** `''` is Any. */
  status: '' as Status | '',
  conductor: '',
  sort: 'activity' as Sort,
  query: '',
  /** The tab picked per project. */
  tabs: new Map<string, Tab>(),
};

const TABS: [Tab, string][] = [
  ['runs', 'Flow runs'],
  ['loose', 'Loose sessions'],
];
const PANEL = 'list-panel';
const STATUSES: [Status, string][] = [
  ['Waiting', 'Waiting on you'],
  ['Working', 'Working'],
  ['Idle', 'Idle'],
  ['Stale', 'Stale'],
  ['Done', 'Done'],
];
const SORTS: [Sort, string][] = [
  ['activity', 'Latest activity'],
  ['needs', 'Needs you first'],
  ['furthest', 'Furthest along'],
  ['name', 'Name'],
];
const NEEDS: Record<Status, number> = { Waiting: 0, Working: 1, Idle: 2, Stale: 3, Done: 4 };

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
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** `flow-observability` as `Flow observability`, `test-audit` as `Test audit`. */
const words = (slug: string) => capital(slug.replace(/[-_]+/g, ' '));
const joined = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};
/** Today as `14:05`, another day as `28 Oct`. */
const when = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length > 10 && d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(iso.length === 10 ? { timeZone: 'UTC' } : {}),
  });
};

function gateWords(gates: Gate[]): string {
  if (!gates.length) return 'No gates written';
  const open = gates.filter((g) => !g.approved).map((g) => `gate ${g.n}`);
  if (!open.length) return gates.length === 1 ? 'The gate passed' : `All ${gates.length} gates passed`;
  return `${capital(joined(open))} ${open.length === 1 ? 'is' : 'are'} open`;
}

/** One mark at most: the state when it is the exception; none for a run that is as expected. */
function runMark(r: FlowRunSummary): HTMLElement | null {
  if (r.status === 'Waiting') return el('span', 'mark Waiting', 'Needs you');
  if (r.status === 'Working') return el('span', 'mark Building', 'Working');
  if (r.open_deviations) return el('span', 'mark Waiting', plural(r.open_deviations, 'deviation') + ' open');
  if (r.status === 'Stale') return el('span', 'mark fix', 'Stale');
  return null;
}

/** How far a run is: done runs first, then by tasks done, then runs without a build log. */
function along(r: FlowRunSummary): number {
  if (r.status === 'Done') return 2;
  if (r.progress && r.progress[1]) return r.progress[0] / r.progress[1];
  return -1;
}

const SORTERS: Record<Sort, (a: FlowRunSummary, b: FlowRunSummary) => number> = {
  activity: (a, b) => time(b.last_activity) - time(a.last_activity),
  needs: (a, b) => NEEDS[a.status] - NEEDS[b.status] || time(b.last_activity) - time(a.last_activity),
  furthest: (a, b) => along(b) - along(a) || time(b.last_activity) - time(a.last_activity),
  name: (a, b) => a.slug.localeCompare(b.slug),
};

const matches = (fields: (string | null)[]) => {
  const q = state.query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
};

/** A cell of column `key`: the class its heading has too, so the two share a width. */
const td = (key: string, ...kids: (Node | string)[]) => el('td', key === 'name' ? 'name' : `col-${key}`, ...kids);

/**
 * A table with column headings. `cols` are [key, heading] pairs; a heading in `hidden` is read out but not drawn.
 * The caption names the table for a screen reader when no visible heading does.
 */
function table(kind: string, caption: string, cols: [string, string][], rows: HTMLTableRowElement[], hidden = '') {
  const head = el(
    'tr',
    '',
    ...cols.map(([key, label]) => {
      const th = el(
        'th',
        key === 'name' ? 'name' : `col-${key}`,
        label === hidden ? el('span', 'visually-hidden', label) : label,
      );
      th.scope = 'col';
      return th;
    }),
  );
  const t = el('table', `list-table ${kind}`);
  if (caption) t.append(el('caption', 'visually-hidden', caption));
  t.append(el('thead', '', head), el('tbody', '', ...rows));
  return t;
}

/**
 * A row that opens something: the whole row takes the click, and its name is the one real button. `keep` names the
 * button for the runtime, so focus stays on this row when a redraw sorts others in above it.
 */
function opener(className: string, name: string, keep: string, cells: HTMLTableCellElement[], open: () => void) {
  const b = button('', name);
  b.dataset.keep = keep;
  const tr = el('tr', `opens ${className}`.trim(), td('name', b), ...cells);
  tr.addEventListener('click', open);
  return tr;
}

const RUN_COLS: [string, string][] = [
  ['name', 'Name'],
  ['kind', 'Conductor'],
  ['now', 'Now or phase'],
  ['gates', 'Gates'],
  ['tasks', 'Tasks'],
  ['mark', 'State'],
  ['when', 'Last activity'],
];
const AUDIT_COLS: [string, string][] = [
  ['name', 'Audit'],
  ['scope', 'Scope'],
  ['findings', 'Findings'],
  ['picks', 'Picks'],
  ['mark', 'State'],
  ['when', 'Date'],
];
const LOOSE_COLS: [string, string][] = [
  ['name', 'First prompt'],
  ['started', 'Started'],
  ['when', 'Last activity'],
];

/** A run's row; the State cell only when the table has that column. */
function runRow(ctx: ViewContext, project: string, r: FlowRunSummary, withMark: boolean) {
  const ticks = el('span', 'gate-ticks', ...r.gates.map((g) => el('span', g.approved ? 'tick passed' : 'tick')));
  ticks.title = gateWords(r.gates);
  ticks.setAttribute('aria-label', `${gateWords(r.gates)}.`);
  const where = r.now ?? (r.phase === 'done' ? 'Done.' : `In ${r.phase}.`);
  const mark = runMark(r);
  const row = opener(
    r.status === 'Done' ? 'done' : '',
    words(r.slug),
    `run-${r.slug}`,
    [
      td('kind', words(r.conductor)),
      td('now', where),
      td('gates', ticks),
      td('tasks', r.progress ? `${r.progress[0]} of ${r.progress[1]}` : ''),
      ...(withMark ? [td('mark', ...(mark ? [mark] : []))] : []),
      td('when', when(r.last_activity)),
    ],
    () => ctx.navigate({ to: 'run', project, slug: r.slug }),
  );
  row.title = `${words(r.slug)}, ${words(r.conductor)} flow. ${where}${r.progress ? ` ${r.progress[0]} of ${r.progress[1]} tasks done.` : ''}`;
  return row;
}

function auditRow(a: AuditSummary) {
  const findings = a.findings_by_severity.length
    ? a.findings_by_severity.map(([s, n]) => `${n} ${s}`).join(', ')
    : 'No findings';
  const mark =
    a.open === null
      ? el('span', 'mark', 'State unknown')
      : a.open
        ? el('span', 'mark Waiting', 'Open')
        : el('span', 'mark');
  const row = el(
    'tr',
    '',
    td('name', words(a.conductor)),
    td('scope', a.scope ?? a.file),
    td('findings', findings),
    td('picks', a.picks === null ? '' : `${a.picks} picked, ${a.fixed} fixed`),
    td('mark', mark),
    td('when', when(a.date)),
  );
  row.title = a.file;
  return row;
}

function looseRow(ctx: ViewContext, project: string, s: SessionSummary) {
  const prompt = s.first_prompt?.trim() || `Session ${s.id.slice(0, 8)}`;
  const row = opener(
    '',
    prompt,
    `session-${s.id}`,
    [td('started', when(s.started)), td('when', when(s.last_activity))],
    () => ctx.navigate({ to: 'session', project, id: s.id }),
  );
  row.title = prompt;
  return row;
}

/**
 * Projects that share a name, told apart by the end of their first folder's path, its own name included: `in
 * src/app` and `in src/app-upstream` for a fork beside its upstream. The roots come sorted, so a checkout comes before
 * its own worktrees. Folders are added from the end until the places differ.
 */
function placesOf(projects: Project[]): Map<string, string> {
  const places = new Map<string, string>();
  const byName = new Map<string, Project[]>();
  for (const p of projects) byName.set(p.name, [...(byName.get(p.name) ?? []), p]);
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    const paths = same.map((p) => (p.roots[0] ?? '').split(/[\\/]+/).filter(Boolean));
    let depth = 2;
    const tail = (parts: string[]) => parts.slice(-depth).join('/');
    const deepest = Math.max(...paths.map((x) => x.length));
    while (depth < deepest && new Set(paths.map(tail)).size < same.length) depth++;
    same.forEach((p, i) => places.set(p.id, paths[i].length ? `in ${tail(paths[i])}` : ''));
  }
  return places;
}

/** A native select with its visible label; `choices` are [value, label] pairs. */
function picker(id: string, label: string, choices: [string, string][], value: string, onPick: (v: string) => void) {
  const select = el('select', '', ...choices.map(([v, text]) => Object.assign(el('option', '', text), { value: v })));
  select.id = id;
  select.value = value;
  select.addEventListener('change', () => onPick(select.value));
  return el('div', 'field', Object.assign(el('label', '', label), { htmlFor: id }), select);
}

function empty(first: string, second = ''): HTMLElement {
  return el('div', 'empty', el('p', '', first), ...(second ? [el('p', '', second)] : []));
}

function frame(ctx: ViewContext, projects: Project[], project: Project | undefined, entries: Entry[]): HTMLElement {
  const win = el('div', 'window');
  const left = el('aside', 'left');
  left.setAttribute('aria-label', 'Projects');
  const content = el('div', 'content');
  const bar = el('div', 'tabs-bar');
  win.append(
    el('div', 'brand', el('span', 'app', 'Flow cockpit'), el('h1', '', project?.name ?? 'No project')),
    bar,
    left,
    content,
  );
  if (!project) {
    content.append(empty('No projects yet.', 'A project shows here once Claude Code has run in one of its folders.'));
    return win;
  }
  const id = project.id;

  const runs = entries.flatMap((e) => (e.kind === 'FlowRun' ? [e] : []));
  const audits = entries.flatMap((e) => (e.kind === 'Audit' ? [e] : []));
  const loose = entries.flatMap((e) => (e.kind === 'Loose' ? [e] : []));

  // Moving to another project drops a filter it has no row for, which could not be picked there.
  if (state.project !== id) {
    state.project = id;
    if (state.status && !runs.some((r) => r.status === state.status)) state.status = '';
    if (state.conductor && ![...runs, ...audits].some((x) => x.conductor === state.conductor)) state.conductor = '';
  }
  // A project opens on its flow runs, or on its loose sessions when it has nothing else.
  if (!state.tabs.has(id)) state.tabs.set(id, runs.length || audits.length || !loose.length ? 'runs' : 'loose');

  // The rail: the projects, nothing else. A same-named project's place sits under its name.
  const places = placesOf(projects);
  const projectRows = projects.map((p) => {
    const place = places.get(p.id);
    const b = button('row plain', el('span', 'ttl', p.name), ...(place ? [el('span', 'mark', place)] : []));
    b.setAttribute('aria-current', String(p.id === id));
    b.title = p.roots.join('\n');
    b.addEventListener('click', () => {
      if (p.id !== id) ctx.navigate({ to: 'list', project: p.id });
    });
    return el('li', '', b);
  });
  const projectsGroup = el(
    'section',
    'group projects',
    el('h2', 'group-h', 'Projects'),
    el('ol', 'rows', ...projectRows),
  );
  projectsGroup.setAttribute('aria-label', 'Projects');
  left.append(projectsGroup);

  // The switch: the run view's tab bar, as a tablist over the content.
  const tablist = el('div', 'tabs list-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'What the list shows');
  const counts: Record<Tab, number> = { runs: runs.length, loose: loose.length };
  const tabButtons = TABS.map(([tab, label]) => {
    const b = button('tab', el('span', 'label', label), el('span', 'count num', String(counts[tab])));
    b.setAttribute('role', 'tab');
    b.id = `list-tab-${tab}`;
    b.dataset.tab = tab;
    b.setAttribute('aria-controls', PANEL);
    b.addEventListener('click', () => show(tab));
    tablist.append(b);
    return b;
  });
  // Left and right move between the tabs.
  tablist.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const at = TABS.findIndex(([tab]) => tab === state.tabs.get(id));
    const next = (at + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    show(TABS[next][0]);
    tabButtons[next].focus();
  });
  bar.append(tablist);

  content.id = PANEL;
  content.setAttribute('role', 'tabpanel');
  const filters = el('div', 'filters');
  const body = el('div', 'list-body');
  content.append(filters, body);

  const search = el('input', 'search');
  search.type = 'search';
  search.id = 'list-search';
  search.autocomplete = 'off';
  search.value = state.query;
  search.addEventListener('input', () => {
    state.query = search.value;
    paint();
  });
  const searchField = el(
    'div',
    'field field-search',
    Object.assign(el('label', '', 'Search'), { htmlFor: search.id }),
    search,
  );

  /** Selects the tab and draws its filter bar and rows. */
  function show(tab: Tab) {
    state.tabs.set(id, tab);
    for (const b of tabButtons) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    content.setAttribute('aria-labelledby', `list-tab-${tab}`);
    filters.replaceChildren();
    const has = tab === 'runs' ? runs.length + audits.length > 0 : loose.length > 0;
    if (has && tab === 'runs') {
      // Only the values this project has, with their counts; Sort has no Any. A value picked earlier stays (count 0)
      // when live data drops it, so the select still shows what filters the table.
      if (runs.length || state.status)
        filters.append(
          picker(
            'list-status',
            'Status',
            [
              ['', 'Any'],
              ...STATUSES.filter(([s]) => s === state.status || runs.some((r) => r.status === s)).map(
                ([s, label]): [string, string] => [s, `${label} (${runs.filter((r) => r.status === s).length})`],
              ),
            ],
            state.status,
            (v) => {
              state.status = v as Status | '';
              paint();
            },
          ),
        );
      const both = [...runs, ...audits];
      const conductors = [
        ...new Set([...both.map((x) => x.conductor), ...(state.conductor ? [state.conductor] : [])]),
      ].sort();
      filters.append(
        picker(
          'list-conductor',
          'Conductor',
          [
            ['', 'Any'],
            ...conductors.map((c): [string, string] => [
              c,
              `${words(c) || 'Not named'} (${both.filter((x) => x.conductor === c).length})`,
            ]),
          ],
          state.conductor,
          (v) => {
            state.conductor = v;
            paint();
          },
        ),
      );
      if (runs.length)
        filters.append(
          picker('list-sort', 'Sort', SORTS, state.sort, (v) => {
            state.sort = v as Sort;
            paint();
          }),
        );
    }
    // Loose sessions come in one order, latest first, so their bar holds only the search.
    if (has) filters.append(searchField);
    filters.hidden = !has;
    content.scrollTop = 0;
    paint();
  }

  /** Clears the search, and with `filters` the Status and Conductor picks too. */
  function clearButton(label: string, filters: boolean) {
    const clear = button('row plain', el('span', 'ttl', label));
    clear.addEventListener('click', () => {
      if (filters) {
        state.status = '';
        state.conductor = '';
      }
      state.query = '';
      search.value = '';
      show(state.tabs.get(id) ?? 'runs');
    });
    return clear;
  }

  /** Draws the shown tab's rows under the filter bar. */
  function paint() {
    const tab = state.tabs.get(id) ?? 'runs';
    if (tab === 'loose') {
      const shown = loose.filter((s) => matches([s.first_prompt, s.id]));
      if (shown.length)
        body.replaceChildren(
          table(
            'loose',
            'Loose sessions of the last 7 days',
            LOOSE_COLS,
            shown.map((s) => looseRow(ctx, id, s)),
          ),
        );
      else if (loose.length)
        body.replaceChildren(
          empty('No loose session matches this search.', 'Try fewer words.'),
          clearButton('Clear the search', false),
        );
      else
        body.replaceChildren(
          empty(
            'No loose session in the last 7 days.',
            'A Claude session that belongs to no flow run shows here for a week.',
          ),
        );
      return;
    }

    if (!runs.length && !audits.length) {
      body.replaceChildren(
        empty('No flow run or audit in this project yet.', 'They show here once a conductor runs in it.'),
      );
      return;
    }
    const shownRuns = runs
      .filter((r) => !state.status || r.status === state.status)
      .filter((r) => !state.conductor || r.conductor === state.conductor)
      .filter((r) => matches([r.slug, words(r.slug), r.conductor, r.phase, r.now]))
      .sort(SORTERS[state.sort]);
    // Only runs have a status.
    const shownAudits = state.status
      ? []
      : audits
          .filter((a) => !state.conductor || a.conductor === state.conductor)
          .filter((a) => matches([a.conductor, words(a.conductor), a.scope, a.file]));

    const parts: HTMLElement[] = [];
    // The State column only when a shown run has a mark, so a quiet list gives its room to Now or phase.
    const withMark = shownRuns.some((r) => runMark(r));
    if (shownRuns.length)
      parts.push(
        table(
          'runs',
          'Flow runs',
          RUN_COLS.filter(([key]) => withMark || key !== 'mark'),
          shownRuns.map((r) => runRow(ctx, id, r, withMark)),
          'State',
        ),
      );
    else if (runs.length)
      parts.push(
        empty('No flow run matches these filters.', 'Try fewer words or filters.'),
        clearButton('Clear the search and filters', true),
      );
    else parts.push(empty('No flow run in this project yet.'));
    if (shownAudits.length) {
      const open = shownAudits.filter((a) => a.open).length;
      const section = el(
        'section',
        'group list-audits',
        el(
          'h2',
          'group-h',
          el('span', '', 'Audits'),
          el('span', 'aside', open ? `${open} open` : plural(shownAudits.length, 'audit')),
        ),
        table('audits', '', AUDIT_COLS, shownAudits.map(auditRow), 'State'),
      );
      section.setAttribute('aria-label', 'Audits');
      parts.push(section);
    } else if (!runs.length)
      parts.push(
        empty('No audit matches these filters.', 'Try fewer words or filters.'),
        clearButton('Clear the search and filters', true),
      );
    body.replaceChildren(...parts);
  }

  show(state.tabs.get(id) ?? 'runs');
  return win;
}

const view: View = {
  id: 'list',
  title: 'Flow runs',
  slot: 'list',
  async render(ctx) {
    const projects = await ctx.data.projects();
    const route = ctx.route;
    const wanted = route.to === 'list' ? route.project : undefined;
    const project = projects.find((p) => p.id === wanted) ?? projects[0];
    const entries = project ? await ctx.data.entries(project.id) : [];
    return frame(ctx, projects, project, entries);
  },
};

export default view;
