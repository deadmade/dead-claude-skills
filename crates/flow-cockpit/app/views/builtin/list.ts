// The list: what ran in one project's checkouts and worktrees, in the run view's language. The rail holds the projects
// and the filters and sorts; the content holds three groups of one-line rows: flow runs, audits, and the loose Claude
// sessions of the last 7 days. A row names its state only when it is the exception; a finished run is quiet.
import type { View, ViewContext } from '../../shell/api';
import type { AuditSummary } from '../../../bindings/AuditSummary';
import type { Entry } from '../../../bindings/Entry';
import type { FlowRunSummary } from '../../../bindings/FlowRunSummary';
import type { Gate } from '../../../bindings/Gate';
import type { Project } from '../../../bindings/Project';
import type { SessionSummary } from '../../../bindings/SessionSummary';
import type { Status } from '../../../bindings/Status';

type Sort = 'activity' | 'needs' | 'furthest' | 'name';
/** The filters and sort, kept while the window is open so a redraw with fresh data keeps them. */
const state = {
  statuses: new Set<Status>(),
  conductors: new Set<string>(),
  sort: 'activity' as Sort,
  query: '',
};

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

/** One mark at most: the state when it is the exception. */
function runMark(r: FlowRunSummary): HTMLElement | string {
  if (r.status === 'Waiting') return el('span', 'mark Waiting', 'Needs you');
  if (r.status === 'Working') return el('span', 'mark Building', 'Working');
  if (r.open_deviations) return el('span', 'mark Waiting', plural(r.open_deviations, 'deviation') + ' open');
  if (r.status === 'Stale') return el('span', 'mark fix', 'Stale');
  return el('span', 'mark');
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

function runRow(ctx: ViewContext, project: string, r: FlowRunSummary): HTMLLIElement {
  const ticks = el('span', 'gate-ticks', ...r.gates.map((g) => el('span', g.approved ? 'tick passed' : 'tick')));
  ticks.title = gateWords(r.gates);
  ticks.setAttribute('aria-label', `${gateWords(r.gates)}.`);
  const where = r.now ?? (r.phase === 'done' ? 'Done.' : `In ${r.phase}.`);
  const row = button(
    r.status === 'Done' ? 'row done' : 'row',
    el('span', 'ttl', words(r.slug)),
    el('span', 'col-kind', words(r.conductor)),
    el('span', 'col-now', where),
    ticks,
    el('span', 'col-tasks num', r.progress ? `${r.progress[0]} of ${r.progress[1]}` : ''),
    runMark(r),
    el('span', 'col-when num', when(r.last_activity)),
  );
  row.title = `${words(r.slug)}, ${words(r.conductor)} flow. ${where}${r.progress ? ` ${r.progress[0]} of ${r.progress[1]} tasks done.` : ''}`;
  row.addEventListener('click', () => ctx.navigate({ to: 'run', project, slug: r.slug }));
  return el('li', '', row);
}

function auditRow(a: AuditSummary): HTMLLIElement {
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
    'div',
    'row',
    el('span', 'ttl', words(a.conductor)),
    el('span', 'col-kind num', when(a.date)),
    el('span', 'col-now', a.scope ?? a.file),
    el('span', 'col-findings', findings),
    el('span', 'col-picks', a.picks === null ? '' : `${a.picks} picked, ${a.fixed} fixed`),
    mark,
  );
  row.title = a.file;
  return el('li', '', row);
}

function looseRow(ctx: ViewContext, project: string, s: SessionSummary): HTMLLIElement {
  const prompt = s.first_prompt?.trim() || `Session ${s.id.slice(0, 8)}`;
  const row = button(
    'row',
    el('span', 'ttl', prompt),
    el('span', 'col-kind num', when(s.started)),
    el('span', 'col-when num', when(s.last_activity)),
  );
  row.title = prompt;
  row.addEventListener('click', () => ctx.navigate({ to: 'session', project, id: s.id }));
  return el('li', '', row);
}

function group(title: string, aside: string, className: string, rows: HTMLLIElement[]): HTMLElement {
  const g = el(
    'section',
    'group',
    el('h2', 'group-h', el('span', '', title), el('span', 'aside', aside)),
    el('ol', `rows entries ${className}`, ...rows),
  );
  g.setAttribute('aria-label', title);
  return g;
}

function railGroup(title: string, rows: HTMLElement[]): HTMLElement {
  const g = el('section', 'group', el('h2', 'group-h', title), el('ol', 'rows', ...rows.map((r) => el('li', '', r))));
  g.setAttribute('aria-label', title);
  return g;
}

function frame(ctx: ViewContext, projects: Project[], project: Project | undefined, entries: Entry[]): HTMLElement {
  const win = el('div', 'window');
  const left = el('aside', 'left');
  left.setAttribute('aria-label', 'Projects, filters and sort');
  const content = el('div', 'content');
  const bar = el('div', 'tabs-bar');
  win.append(
    el('div', 'brand', el('span', 'app', 'Flow cockpit'), el('h1', '', project?.name ?? 'No project')),
    bar,
    left,
    content,
  );
  if (!project) {
    content.append(
      el(
        'div',
        'empty',
        el('p', '', 'No projects yet.'),
        el('p', '', 'A project shows here once Claude Code has run in one of its folders.'),
      ),
    );
    return win;
  }

  const runs = entries.flatMap((e) => (e.kind === 'FlowRun' ? [e] : []));
  const audits = entries.flatMap((e) => (e.kind === 'Audit' ? [e] : []));
  const loose = entries.flatMap((e) => (e.kind === 'Loose' ? [e] : []));

  const search = el('input');
  search.type = 'search';
  search.id = 'list-search';
  search.className = 'search';
  search.placeholder = 'Search';
  search.autocomplete = 'off';
  search.value = state.query;
  search.setAttribute('aria-label', 'Search flow runs, audits and sessions');
  search.addEventListener('input', () => {
    state.query = search.value;
    paint();
  });
  bar.append(
    search,
    el(
      'p',
      'where',
      `${plural(runs.length, 'flow run')}, ${plural(audits.length, 'audit')}, ${plural(loose.length, 'session')}`,
    ),
  );

  // The rail: projects, then the filters (a press toggles one; none pressed shows all), then the sort.
  const projectRows = projects.map((p) => {
    const b = button('row plain', el('span', 'ttl', p.name));
    b.setAttribute('aria-current', String(p.id === project.id));
    b.title = p.roots.join('\n');
    b.addEventListener('click', () => {
      if (p.id !== project.id) ctx.navigate({ to: 'list', project: p.id });
    });
    return b;
  });
  const toggle = <T>(set: Set<T>, value: T, label: string, count: number) => {
    const b = button('row plain', el('span', 'ttl', label), el('span', 'mark num', String(count)));
    b.setAttribute('aria-pressed', String(set.has(value)));
    b.addEventListener('click', () => {
      if (set.has(value)) set.delete(value);
      else set.add(value);
      b.setAttribute('aria-pressed', String(set.has(value)));
      paint();
    });
    return b;
  };
  const statusRows = STATUSES.filter(([s]) => state.statuses.has(s) || runs.some((r) => r.status === s)).map(
    ([s, label]) => toggle(state.statuses, s, label, runs.filter((r) => r.status === s).length),
  );
  const conductors = [...new Set([...runs.map((r) => r.conductor), ...audits.map((a) => a.conductor)])].sort();
  const conductorRows = conductors.map((c) =>
    toggle(state.conductors, c, words(c) || 'Not named', [...runs, ...audits].filter((x) => x.conductor === c).length),
  );
  const sortRows = SORTS.map(([s, label]) => {
    const b = button('row plain', el('span', 'ttl', label));
    b.dataset.sort = s;
    b.setAttribute('aria-pressed', String(state.sort === s));
    b.addEventListener('click', () => {
      state.sort = s;
      for (const x of left.querySelectorAll<HTMLElement>('[data-sort]'))
        x.setAttribute('aria-pressed', String(x.dataset.sort === s));
      paint();
    });
    return b;
  });
  left.append(railGroup('Projects', projectRows));
  if (statusRows.length) left.append(railGroup('Status', statusRows));
  if (conductorRows.length) left.append(railGroup('Conductor', conductorRows));
  if (runs.length) left.append(railGroup('Sort runs by', sortRows));

  function paint() {
    const byStatus = state.statuses.size > 0;
    const byConductor = state.conductors.size > 0;
    const shownRuns = runs
      .filter((r) => !byStatus || state.statuses.has(r.status))
      .filter((r) => !byConductor || state.conductors.has(r.conductor))
      .filter((r) => matches([r.slug, words(r.slug), r.conductor, r.phase, r.now]))
      .sort(SORTERS[state.sort]);
    // Only runs have a status; sessions have no conductor either.
    const shownAudits = byStatus
      ? []
      : audits
          .filter((a) => !byConductor || state.conductors.has(a.conductor))
          .filter((a) => matches([a.conductor, words(a.conductor), a.scope, a.file]));
    const shownLoose = byStatus || byConductor ? [] : loose.filter((s) => matches([s.first_prompt, s.id]));

    const groups: HTMLElement[] = [];
    if (shownRuns.length) {
      const open = shownRuns.filter((r) => r.status !== 'Done').length;
      groups.push(
        group(
          'Flow runs',
          open ? `${open} not done` : 'All done',
          'runs',
          shownRuns.map((r) => runRow(ctx, project!.id, r)),
        ),
      );
    }
    if (shownAudits.length) {
      const open = shownAudits.filter((a) => a.open).length;
      groups.push(
        group(
          'Audits',
          open ? `${open} open` : plural(shownAudits.length, 'audit'),
          'audits',
          shownAudits.map(auditRow),
        ),
      );
    }
    if (shownLoose.length)
      groups.push(
        group(
          'Loose sessions',
          'Last 7 days',
          'loose',
          shownLoose.map((s) => looseRow(ctx, project!.id, s)),
        ),
      );

    if (!groups.length) {
      const filtered = byStatus || byConductor || state.query.trim() !== '';
      if (filtered) {
        const clear = button('row plain', el('span', 'ttl', 'Clear the search and filters'));
        clear.addEventListener('click', () => {
          state.statuses.clear();
          state.conductors.clear();
          state.query = '';
          search.value = '';
          for (const x of left.querySelectorAll('[aria-pressed]'))
            if (!(x instanceof window.HTMLElement && x.dataset.sort)) x.setAttribute('aria-pressed', 'false');
          paint();
        });
        groups.push(
          el('div', 'empty', el('p', '', 'Nothing matches.'), el('p', '', 'Try fewer words or filters.')),
          clear,
        );
      } else {
        groups.push(
          el(
            'div',
            'empty',
            el('p', '', 'Nothing ran in this project yet.'),
            el('p', '', 'Flow runs, audits and Claude sessions show here once Claude Code works in it.'),
          ),
        );
      }
    }
    content.replaceChildren(...groups);
  }
  paint();
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
