// The run's Docs tab, as the approved design draws it (crates/flow-cockpit/design/run-view.html): the documents in the
// rail, the text in the middle at a reading measure, its chapters on the right. flow.md goes through the enhancer: the
// parts the core recognised as UI (Gates as a stepper, Options as decision cards, Deviations as folds), every other
// section as Markdown. spec.md and plan.md are Markdown, Mermaid blocks drawn.
//
// A run-tab view: the run view draws the frame and this view's rail and content fill the window's lower row.
import type { View, ViewContext } from '../../shell/api';
import type { DocName } from '../../../bindings/DocName';
import type { FlowDoc } from '../../../bindings/FlowDoc';
import type { Gate } from '../../../bindings/Gate';

const DOCS: [DocName, string][] = [
  ['Spec', 'spec.md'],
  ['Plan', 'plan.md'],
  ['Flow', 'flow.md'],
];
/** The document picked in each run, kept while the window is open. */
const picked = new Map<string, DocName>();

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

const capital = (s: string) => (/^[a-z]+(\s|$)/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const day = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** A line of Markdown as inline content: its one paragraph unwrapped, links kept as their text. */
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

/** Gates on the conductor's phase track; without known phases, one row per gate. */
function gates(ctx: ViewContext, flow: FlowDoc): Node {
  if (flow.phases.length) {
    return ctx.blocks.stepper(
      flow.phases.map((p) => {
        const gate = p.gate_after === null ? undefined : flow.gates.find((g) => g.n === p.gate_after);
        return {
          label: p.name,
          state: p.state,
          gate: p.gate_after === null ? undefined : { n: p.gate_after, approved: gate?.approved ?? null },
        };
      }),
    );
  }
  const row = (g: Gate) =>
    el(
      'li',
      `row gate ${g.approved ? 'passed' : 'open'}`,
      el('span', 'k num', `G${g.n}`),
      el('span', 'ttl', `Gate ${g.n}, ${g.what}`),
      el('span', 'mark', g.approved ? `Passed ${day(g.approved)}` : 'Open'),
    );
  return el('ol', 'rows', ...flow.gates.map(row));
}

/** Each decision as a card: what was picked, then the reasons and the rest as Markdown. */
function options(ctx: ViewContext, flow: FlowDoc): Node {
  const box = el('div', 'decisions');
  for (const d of flow.decisions) {
    const body = el('div');
    body.append(
      d.picked
        ? el('p', 'item-lead', el('span', 'tag', 'Picked'), inline(ctx, capital(d.picked)))
        : el('p', 'item-lead', el('span', 'tag open', 'Not picked yet'), 'It waits for your choice.'),
    );
    if (d.body) body.append(ctx.blocks.markdown(d.body));
    box.append(ctx.blocks.card({ title: inline(ctx, d.title).textContent ?? '', body }));
  }
  return box;
}

/** Deviations as folds, open ones first. */
function deviations(ctx: ViewContext, flow: FlowDoc): Node {
  const order = (s: FlowDoc['deviations'][number]['status']) => (s === 'Open' ? 0 : s === 'Unknown' ? 2 : 1);
  const list = el('ol', 'devs');
  for (const d of [...flow.deviations].sort((a, b) => order(a.status) - order(b.status))) {
    const s = d.status;
    const v =
      s === 'Open'
        ? 'Open, needs your decision'
        : s === 'Unknown'
          ? 'No status line'
          : `Decided${s.Decided.date ? ` ${day(s.Decided.date)}` : ''}`;
    const details = el('details', s === 'Open' ? 'dev open' : 'dev');
    const body = el('div', 'dev-body');
    if (s !== 'Open' && s !== 'Unknown') body.append(el('p', 'what', inline(ctx, `${capital(s.Decided.what)}.`)));
    if (d.body) body.append(ctx.blocks.markdown(d.body));
    details.append(el('summary', '', inline(ctx, d.title), el('span', 'v', v)), body);
    list.append(el('li', '', details));
  }
  return list;
}

function flowDoc(ctx: ViewContext, flow: FlowDoc): Node[] {
  const nodes: Node[] = [el('h1', 'visually-hidden', flow.title ?? 'flow.md')];
  for (const s of flow.sections) {
    const h = s.heading.toLowerCase();
    let body: Node;
    if (h === 'gates' && flow.gates.length) body = gates(ctx, flow);
    else if (h === 'options' && flow.decisions.length) body = options(ctx, flow);
    else if (h.startsWith('deviations') && flow.deviations.length) body = deviations(ctx, flow);
    else if (s.markdown.trim()) body = ctx.blocks.markdown(s.markdown);
    else body = el('p', 'quiet', 'Nothing here yet.');
    nodes.push(el('section', 'doc-section', el('h2', '', inline(ctx, s.heading)), body));
  }
  return nodes;
}

const view: View = {
  id: 'docs',
  title: 'Docs',
  slot: 'run-tab',
  async render(ctx) {
    const route = ctx.route;
    const left = el('aside', 'left');
    left.setAttribute('aria-label', 'Documents');
    const content = el('div', 'content');
    content.setAttribute('role', 'tabpanel');
    const out = document.createDocumentFragment();
    out.append(left, content);
    if (route.to !== 'run') return out;

    const [run, ...texts] = await Promise.all([
      ctx.data.flowRun(route.project, route.slug),
      ...DOCS.map(([name]) => ctx.data.doc(route.project, route.slug, name)),
    ]);
    const text = new Map(DOCS.map(([name], i) => [name, texts[i]]));
    const key = `${route.project}/${route.slug}`;
    // The spec first, as in the design; a run without one opens at its first document that exists.
    let which = picked.get(key) ?? DOCS.find(([name]) => text.get(name))?.[0] ?? 'Spec';

    const rows = el('ol', 'rows');
    left.append(el('section', 'group', el('h2', 'group-h', 'Documents'), rows));
    for (const [name, file] of DOCS) {
      const b = el('button', 'row plain', el('span', 'ttl', name), el('span', 'mark', text.get(name) ? file : 'None'));
      b.type = 'button';
      b.dataset.doc = name;
      b.addEventListener('click', () => {
        which = name;
        picked.set(key, name);
        paint();
      });
      rows.append(el('li', '', b));
    }

    function paint() {
      for (const b of rows.querySelectorAll<HTMLElement>('[data-doc]'))
        b.setAttribute('aria-current', String(b.dataset.doc === which));
      const reading = el('article', 'reading');
      const raw = text.get(which);
      if (which === 'Flow' && run) reading.append(...flowDoc(ctx, run.flow));
      else if (raw) reading.append(ctx.blocks.markdown(raw));
      else reading.append(el('div', 'empty', el('p', '', `This run has no ${which.toLowerCase()}.md.`)));

      const heads = [
        ...reading.querySelectorAll<HTMLElement>(which === 'Flow' ? '.doc-section > h2' : '.md > h2, .md > h3'),
      ];
      const layout = el('div', 'docs-layout', reading);
      if (heads.length) {
        const toc = el('ol', 'toc');
        heads.forEach((head, i) => {
          if (!head.id) head.id = `doc-${which.toLowerCase()}-${i}`;
          const a = el('a', '', head.textContent ?? '');
          a.href = `#${head.id}`;
          a.addEventListener('click', (event) => {
            event.preventDefault();
            head.scrollIntoView({ block: 'start' });
          });
          toc.append(el('li', head.tagName === 'H3' ? 'h3' : '', a));
        });
        const chapters = el('nav', 'chapters', el('h2', 'group-h', 'Chapters'), toc);
        chapters.setAttribute('aria-label', 'Chapters');
        layout.append(chapters);
      }
      content.replaceChildren(layout);
      content.scrollTop = 0;
    }
    paint();
    return out;
  },
};

export default view;
