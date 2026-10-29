// What a Claude session did, turn by turn, newest first: each prompt with the reply that answered it, and its tool
// calls (edits as diffs, commands, other input) one fold away. It serves two slots:
// - `run-tab`, a run's Activity tab: the run's sessions in the rail, the selected one's turns beside it;
// - `session`, one session's own screen, such as a loose session opened from the list.
import type { View, ViewContext } from '../../shell/api';
import type { Activity } from '../../../bindings/Activity';
import type { AgentInfo } from '../../../bindings/AgentInfo';
import type { Text } from '../../../bindings/Text';
import type { ToolCall } from '../../../bindings/ToolCall';
import type { Turn } from '../../../bindings/Turn';

/** The session picked in each run, kept while the window is open. */
const picked = new Map<string, string>();

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

const agentName = (agents: AgentInfo[], id: string | null) =>
  id === null ? 'Main session' : (agents.find((a) => a.id === id)?.description ?? 'A subagent');

/** A tool call's input, as what it is: an edit as a diff, a written file or a command as code, the rest as JSON. */
function detail(ctx: ViewContext, call: ToolCall): Node {
  const d = call.detail;
  if (d.kind === 'Edit') return ctx.blocks.diff(d.old, d.new);
  const pre = el('pre');
  pre.textContent = d.kind === 'Write' ? d.content : d.kind === 'Command' ? d.command : d.json;
  return pre;
}

function toolRow(ctx: ViewContext, agents: AgentInfo[], call: ToolCall, key: string): HTMLLIElement {
  const label = el('span', 'tool', el('span', 'tool-name', call.tool), ' ', call.summary);
  const marks = [call.agent !== null ? agentName(agents, call.agent) : '', call.failed ? 'Failed' : '']
    .filter(Boolean)
    .join(', ');
  const body = el('div');
  const row = fold(label, marks, body, call.failed ? 'unfold tool-call failed' : 'unfold tool-call');
  row.title = `${call.tool}: ${call.summary}`;
  row.dataset.keep = key;
  // Drawn when it opens: a long session holds hundreds of calls, and a diff costs.
  row.addEventListener('toggle', () => {
    if (row.open && !body.childNodes.length) body.append(detail(ctx, call));
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
function turn(ctx: ViewContext, agents: AgentInfo[], t: Turn, n: number): HTMLLIElement {
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
      el('ol', 'tool-list', ...t.tools.map((c, i) => toolRow(ctx, agents, c, `${key}-call-${i}`))),
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

function turns(ctx: ViewContext, activity: Activity | null): Node {
  if (!activity) return empty("This session isn't there any more.", 'Its transcript was moved or deleted.');
  const box = el('div', 'activity');
  if (activity.live.waiting) box.append(el('p', 'live-wait', `Waiting on you: ${activity.live.waiting}`));
  if (!activity.turns.length) {
    box.append(empty('Nothing happened in this session yet.', 'Its turns show once a prompt is sent.'));
    return box;
  }
  const all = activity.turns.map((t, n) => turn(ctx, activity.agents, t, n));
  box.append(el('ol', 'turns', ...all.reverse()));
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
    let activity: Activity | null;
    try {
      activity = await ctx.data.session(id);
    } catch (err) {
      if (id !== current) return;
      left.replaceChildren(sessionsGroup);
      const box = el(
        'div',
        'error',
        el('h2', '', "This session couldn't be read."),
        el('p', '', err instanceof Error ? err.message : String(err)),
      );
      box.setAttribute('role', 'alert');
      content.replaceChildren(box);
      return;
    }
    // A read that answers after the user picked another session is dropped.
    if (id !== current) return;
    const agents = agentsGroup(activity);
    left.replaceChildren(sessionsGroup, ...(agents ? [agents] : []));
    content.replaceChildren(turns(ctx, activity));
  }
  await paint();
  return out;
}

/** One session's own screen: the app's frame, its agents in the rail, its turns beside them. */
async function sessionScreen(ctx: ViewContext, project: string, id: string): Promise<Node> {
  const activity = await ctx.data.session(id);
  const first = activity?.turns.find((t) => t.prompt)?.prompt ?? null;
  const win = el('div', 'window');
  const home = button('app', 'Flow cockpit');
  home.title = 'Back to the list';
  home.addEventListener('click', () => ctx.navigate({ to: 'list', project }));
  const title = el('h1', '', first?.text.trim() || 'Claude session');
  title.title = title.textContent ?? '';
  const where = el('p', 'where', first ? `Claude session, started ${when(first.at)}` : 'Claude session');
  const left = el('aside', 'left');
  left.setAttribute('aria-label', 'Agents');
  const agents = agentsGroup(activity);
  if (agents) left.append(agents);
  else left.append(el('p', 'quiet', 'No subagents in this session.'));
  const content = el('div', 'content', turns(ctx, activity));
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
