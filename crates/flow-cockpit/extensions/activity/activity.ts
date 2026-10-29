// What a Claude session did, turn by turn, newest first: each prompt with the reply that answered it, and its tool
// calls (edits as diffs, commands, other input) one fold away. It serves two slots:
// - `run-tab`, a run's Activity tab: the run's sessions in the rail, the selected one's turns beside it;
// - `session`, one session's own screen, such as a loose session opened from the list.
// A long session comes a page at a time: the newest 20 turns, and 20 older ones for each "Show older turns". A tool
// call's input is read when its fold opens.
import type { View, ViewContext, Activity, AgentInfo, Text, ToolCall, ToolDetail, Turn } from 'flow-cockpit';

/** How many turns a page holds. */
const PAGE = 20;

/** The session picked in each run, kept while the window is open. */
const picked = new Map<string, string>();
/**
 * Per session, the turns loaded so far by index (0 is the oldest turn): always the newest ones, with no gap. A redraw
 * reads the newest page again and keeps the older turns the user loaded.
 */
const loaded = new Map<string, Map<number, Turn>>();
/** Per session, its first prompt, for the session screen's title. */
const firsts = new Map<string, Text | null>();
/** Tool inputs read, by session and call id: an input never changes, and a redraw opens the same folds again. */
const inputs = new Map<string, ToolDetail>();

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
/** `2026-01-19T10:05:00Z` as `19 Jan, 10:05`, in the viewer's time zone. */
const when = (iso: string | null) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fold(label: Node | string, count: string, body: Node, className = 'unfold'): HTMLDetailsElement {
  const details = el('details', className);
  details.append(el('summary', '', el('span', '', label), el('span', 'count', count)), el('div', 'unfold-body', body));
  return details;
}

function empty(first: string, second?: string): HTMLDivElement {
  const box = el('div', 'empty', el('p', '', first));
  if (second) box.append(el('p', '', second));
  return box;
}

function failure(title: string, err: unknown): HTMLDivElement {
  const box = el('div', 'error', el('h2', '', title), el('p', '', reason(err)));
  box.setAttribute('role', 'alert');
  return box;
}

const agentName = (agents: AgentInfo[], id: string | null) =>
  id === null ? 'Main session' : (agents.find((a) => a.id === id)?.description ?? 'A subagent');

/** A tool call's input, as what it is: an edit as a diff, a written file or a command as code, the rest as JSON. */
function detail(ctx: ViewContext, d: ToolDetail): Node {
  if (d.kind === 'Edit') return ctx.blocks.diff(d.old, d.new);
  const pre = el('pre');
  pre.textContent = d.kind === 'Write' ? d.content : d.kind === 'Command' ? d.command : d.json;
  return pre;
}

function toolRow(ctx: ViewContext, session: string, agents: AgentInfo[], call: ToolCall, key: string): HTMLLIElement {
  const label = el('span', 'tool', el('span', 'tool-name', call.tool), ' ', call.summary);
  const marks = [call.agent !== null ? agentName(agents, call.agent) : '', call.failed ? 'Failed' : '']
    .filter(Boolean)
    .join(', ');
  const body = el('div');
  const row = fold(label, marks, body, call.failed ? 'unfold tool-call failed' : 'unfold tool-call');
  row.title = `${call.tool}: ${call.summary}`;
  row.dataset.keep = key;
  // Read and drawn when it opens: a long session holds hundreds of calls, and their inputs can be large.
  row.addEventListener('toggle', () => {
    if (!row.open || body.childNodes.length) return;
    const id = `${session}\n${call.id}`;
    const known = inputs.get(id);
    if (known) {
      body.append(detail(ctx, known));
      return;
    }
    body.append(el('p', 'quiet', 'Loading…'));
    ctx.data.toolInput(session, call.id).then(
      (d) => {
        if (d) inputs.set(id, d);
        body.replaceChildren(
          d ? detail(ctx, d) : el('p', 'quiet', "This call's input isn't in its transcript any more."),
        );
      },
      (err) => body.replaceChildren(failure("This call's input couldn't be read.", err)),
    );
  });
  return el('li', '', row);
}

function reply(ctx: ViewContext, agents: AgentInfo[], text: Text, labelled: boolean): HTMLElement {
  const box = el('div', 'reply');
  if (labelled) box.append(el('p', 'reply-by', `${agentName(agents, text.agent)}, ${when(text.at)}`));
  box.append(ctx.blocks.markdown(text.text));
  return box;
}

/**
 * One turn: the prompt, the main session's last reply at full contrast, everything else folded. `n` counts from the
 * oldest turn, so the keys a redraw restores open folds by stay on this turn when newer turns arrive.
 */
function turn(ctx: ViewContext, session: string, agents: AgentInfo[], t: Turn, n: number): HTMLLIElement {
  const key = `turn-${n}`;
  const head = el(
    'div',
    'turn-head',
    el('h2', 'turn-h', t.prompt?.text.trim() || 'Before the first prompt'),
    el('span', 'count', when(t.prompt?.at ?? t.replies[0]?.at ?? t.tools[0]?.at ?? null)),
  );
  // The prompt and its answer at the reading measure; beside them on wide windows, what else happened.
  const main = el('div', 'turn-main', head);
  const side = el('div', 'turn-side');
  const mine = t.replies.filter((r) => r.agent === null);
  const last = mine.at(-1);
  if (last) main.append(el('div', 'turn-reply', ctx.blocks.markdown(last.text)));
  else if (!t.tools.length) main.append(el('p', 'quiet', 'No reply yet.'));
  if (t.tools.length) {
    const tools = fold(
      'Tool calls',
      plural(t.tools.length, 'tool call'),
      el('ol', 'tool-list', ...t.tools.map((c, i) => toolRow(ctx, session, agents, c, `${key}-call-${i}`))),
    );
    tools.dataset.keep = `${key}-tools`;
    side.append(tools);
  }
  const rest = t.replies.filter((r) => r !== last);
  if (rest.length) {
    const others = fold(
      'Other replies',
      plural(rest.length, 'reply', 'replies'),
      el('div', '', ...rest.map((r) => reply(ctx, agents, r, true))),
    );
    others.dataset.keep = `${key}-replies`;
    side.append(others);
  }
  const box = el('li', 'turn', main, ...(side.childNodes.length ? [side] : []));
  box.dataset.keep = key;
  return box;
}

/** The session's newest page, merged into the turns loaded before. */
async function newest(ctx: ViewContext, id: string): Promise<{ page: Activity; kept: Map<number, Turn> } | null> {
  const page = await ctx.data.session(id);
  if (!page) return null;
  let kept = loaded.get(id) ?? new Map<number, Turn>();
  const top = Math.max(-1, ...kept.keys());
  // Fewer turns than were loaded: the transcript was replaced, and its indexes name other turns now.
  if (page.total <= top) kept = new Map();
  // More new turns than a page since the last read: the ones between are read too, so the loaded turns stay one run.
  const gap = kept.size ? page.start - top - 1 : 0;
  if (gap > 0) {
    const between = await ctx.data.session(id, { before: page.start, limit: gap });
    between?.turns.forEach((t, i) => kept.set(between.start + i, t));
  }
  page.turns.forEach((t, i) => kept.set(page.start + i, t));
  loaded.set(id, kept);
  return { page, kept };
}

/** The loaded turns, newest first, and below them "Show older turns" while older ones are left. */
function turns(ctx: ViewContext, id: string, page: Activity | null, kept: Map<number, Turn>): Node {
  if (!page) return empty("This session isn't there any more.", 'Its transcript was moved or deleted.');
  const box = el('div', 'activity');
  if (page.live.waiting) box.append(el('p', 'live-wait', `Waiting on you: ${page.live.waiting}`));
  if (!page.total) {
    box.append(empty('Nothing happened in this session yet.', 'Its turns show once a prompt is sent.'));
    return box;
  }
  const drawn = (from: number[]) => from.sort((a, b) => b - a).map((n) => turn(ctx, id, page.agents, kept.get(n)!, n));
  const list = el('ol', 'turns', ...drawn([...kept.keys()]));
  box.append(list);
  const lowest = Math.min(...kept.keys());
  if (lowest <= 0) return box;

  const label = el('span', 'ttl', 'Show older turns');
  const more = button('row plain', label);
  more.dataset.keep = 'older-turns';
  const status = el('div');
  status.setAttribute('role', 'status');
  const footer = el('div', 'turns-older', more, status);
  more.addEventListener('click', async () => {
    const before = Math.min(...kept.keys());
    more.disabled = true;
    label.textContent = 'Loading…';
    status.replaceChildren();
    try {
      const older = await ctx.data.session(id, { before, limit: PAGE });
      if (!older) throw new Error("This session isn't there any more.");
      older.turns.forEach((t, i) => kept.set(older.start + i, t));
      list.append(...drawn(older.turns.map((_, i) => older.start + i)));
      if (older.start <= 0 || !older.turns.length) {
        footer.remove();
        return;
      }
    } catch (err) {
      status.replaceChildren(failure("The older turns couldn't be read.", err));
    }
    more.disabled = false;
    label.textContent = 'Show older turns';
  });
  box.append(footer);
  return box;
}

/** The session's subagents, a running one marked. */
function agentsGroup(activity: Activity | null): HTMLElement | null {
  if (!activity?.agents.length) return null;
  const rows = activity.agents.map((a) =>
    el(
      'li',
      'row plain',
      el('span', 'ttl', a.description ?? a.kind ?? 'A subagent'),
      el('span', a.ended ? 'mark' : 'mark Building', a.ended ? (a.model ?? '') : 'Running'),
    ),
  );
  const g = el(
    'section',
    'group',
    el('h2', 'group-h', el('span', '', 'Agents'), el('span', 'aside', String(rows.length))),
    el('ol', 'rows', ...rows),
  );
  g.setAttribute('aria-label', 'Agents');
  return g;
}

/** A run's Activity tab: its sessions in the rail, newest first, the selected one's turns beside them. */
async function runTab(ctx: ViewContext, project: string, slug: string): Promise<Node> {
  const left = el('aside', 'left');
  left.setAttribute('aria-label', 'Sessions and agents');
  const content = el('div', 'content');
  content.setAttribute('role', 'tabpanel');
  const out = document.createDocumentFragment();
  out.append(left, content);

  const run = await ctx.data.flowRun(project, slug);
  const sessions = run?.sessions ?? [];
  if (!sessions.length) {
    left.append(el('section', 'group', el('h2', 'group-h', 'Sessions'), el('p', 'quiet', 'None linked yet.')));
    content.append(
      empty(
        "No Claude session has written this run's flow.md yet.",
        'Its sessions show here once one writes or edits it.',
      ),
    );
    return out;
  }
  const key = `${project}/${slug}`;
  const wanted = picked.get(key);
  let current = wanted && sessions.includes(wanted) ? wanted : sessions[0];
  const rows = el('ol', 'rows');
  const sessionsGroup = el(
    'section',
    'group',
    el('h2', 'group-h', el('span', '', 'Sessions'), el('span', 'aside', 'Newest first')),
    rows,
  );
  sessionsGroup.setAttribute('aria-label', 'Sessions');
  sessions.forEach((id, i) => {
    const b = button('row plain', el('span', 'ttl', i === 0 ? 'Latest session' : `Session ${id.slice(0, 8)}`));
    b.dataset.session = id;
    b.title = id;
    b.addEventListener('click', async () => {
      current = id;
      picked.set(key, id);
      await paint();
      content.scrollTop = 0;
    });
    rows.append(el('li', '', b));
  });

  async function paint() {
    const id = current;
    for (const b of rows.querySelectorAll<HTMLElement>('[data-session]'))
      b.setAttribute('aria-current', String(b.dataset.session === id));
    let read: Awaited<ReturnType<typeof newest>>;
    try {
      read = await newest(ctx, id);
    } catch (err) {
      if (id !== current) return;
      left.replaceChildren(sessionsGroup);
      content.replaceChildren(failure("This session couldn't be read.", err));
      return;
    }
    // A read that answers after the user picked another session is dropped.
    if (id !== current) return;
    const agents = agentsGroup(read?.page ?? null);
    left.replaceChildren(sessionsGroup, ...(agents ? [agents] : []));
    content.replaceChildren(turns(ctx, id, read?.page ?? null, read?.kept ?? new Map()));
  }
  await paint();
  return out;
}

/** The session's first prompt: from the loaded turns once the oldest is loaded, else read once and kept. */
async function firstPrompt(ctx: ViewContext, id: string, kept: Map<number, Turn>): Promise<Text | null> {
  if (kept.has(0)) return [kept.get(0), kept.get(1)].find((t) => t?.prompt)?.prompt ?? null;
  if (!firsts.has(id)) {
    const head = await ctx.data.session(id, { before: 2, limit: 2 });
    firsts.set(id, head?.turns.find((t) => t.prompt)?.prompt ?? null);
  }
  return firsts.get(id) ?? null;
}

/** One session's own screen: the app's frame, its agents in the rail, its turns beside them. */
async function sessionScreen(ctx: ViewContext, project: string, id: string): Promise<Node> {
  const read = await newest(ctx, id);
  const kept = read?.kept ?? new Map<number, Turn>();
  const first = read ? await firstPrompt(ctx, id, kept) : null;
  const win = el('div', 'window');
  const home = button('app', 'Flow cockpit');
  home.title = 'Back to the list';
  home.addEventListener('click', () => ctx.navigate({ to: 'list', project }));
  const title = el('h1', '', first?.text.trim() || 'Claude session');
  title.title = title.textContent ?? '';
  const where = el('p', 'where', first ? `Claude session, started ${when(first.at)}` : 'Claude session');
  const left = el('aside', 'left');
  left.setAttribute('aria-label', 'Agents');
  const agents = agentsGroup(read?.page ?? null);
  if (agents) left.append(agents);
  else left.append(el('p', 'quiet', 'No subagents in this session.'));
  const content = el('div', 'content', turns(ctx, id, read?.page ?? null, kept));
  win.append(el('div', 'brand', home, title), el('div', 'tabs-bar', where), left, content);
  return win;
}

const view: View = {
  id: 'activity',
  title: 'Activity',
  slot: ['run-tab', 'session'],
  render(ctx) {
    const route = ctx.route;
    if (route.to === 'session') return sessionScreen(ctx, route.project, route.id);
    if (route.to === 'run') return runTab(ctx, route.project, route.slug);
    return el('div');
  },
};

export default view;
