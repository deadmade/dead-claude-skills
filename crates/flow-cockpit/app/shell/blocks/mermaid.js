// A Mermaid diagram from its source. Mermaid is the vendored classic script (`window.mermaid`), set up with
// `securityLevel: 'strict'`, which sanitises every label and turns off click handlers in diagrams.
//
// Drawings are kept in memory, keyed by source and theme, and drawn ahead in idle time (`ahead`), so a page usually
// opens with its diagrams drawn. A diagram not drawn yet is an empty quiet box, as tall as its last drawing when known,
// and jumps the queue. Only when drawing fails does the source show, with the reason. One render runs at a time, and
// the queue asks for no idle time once it is empty.

/**
 * @typedef {{
 *   initialize(config: Record<string, unknown>): void,
 *   render(id: string, source: string): Promise<{ svg: string }>,
 * }} Mermaid
 * @typedef {import('../../../bindings/FlowRun').FlowRun} FlowRun
 * @typedef {import('../../../bindings/LedgerTask').LedgerTask} LedgerTask
 * @typedef {{ svg: string } | { error: string }} Drawing
 * @typedef {{ source: string, boxes: HTMLElement[] }} Job
 */

// The drawings by theme and source, newest last. A project's diagrams fit with room to spare: each unfinished run's
// task graph and its documents' diagrams (a handful each), the runs opened since, and a live run's graph once more for
// each change of a task's state. At 20 to 60 KB of SVG each, that is a few megabytes at most.
const KEEP = 200;
/** @type {Map<string, Drawing>} */
const drawn = new Map();
// The last drawing's height per source (any theme), for a placeholder; kept longer than the drawings, being small.
/** @type {Map<string, number>} */
const heights = new Map();
// What waits to be drawn, by key: the diagrams a page shows now, then the ones drawn ahead, each in order.
/** @type {Map<string, Job>} */
const now = new Map();
/** @type {Map<string, Job>} */
const later = new Map();
/** The one render running, by key. @type {{ key: string, job: Job } | null} */
let running = null;
let soonAsked = false;
let idleAsked = false;
/** The theme Mermaid was last set up with. */
let setFor = '';
let next = 0;

/** @param {string} name */
const token = (name) => window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The theme tokens Mermaid takes its colours and face from (see `setUp`). */
const theme = () =>
  ['--color-paper', '--color-paper-2', '--color-paper-3', '--color-paper-4', '--color-ink', '--font-body']
    .map(token)
    .join('|');

/** @param {string} look the theme, as `theme()` gives it @param {string} source */
const keyOf = (look, source) => `${look}\n${source}`;

/** @param {Mermaid} lib @param {string} look */
function setUp(lib, look) {
  if (setFor === look) return;
  lib.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    // Mermaid 12's default "neo" look gives every node a 120px minimum; the classic look sizes nodes to their label.
    look: 'classic',
    htmlLabels: false,
    flowchart: { useMaxWidth: false, minNodeWidth: 0, rankSpacing: 26, nodeSpacing: 14, padding: 9, curve: 'basis' },
    themeVariables: {
      darkMode: true,
      background: token('--color-paper'),
      fontFamily: token('--font-body'),
      fontSize: '13px',
      primaryColor: token('--color-paper-3'),
      primaryTextColor: token('--color-ink'),
      primaryBorderColor: token('--color-paper-4'),
      lineColor: token('--color-paper-4'),
      secondaryColor: token('--color-paper-2'),
      tertiaryColor: token('--color-paper-2'),
    },
  });
  setFor = look;
}

/** A drawing, or the source with why it failed. @param {HTMLElement} box @param {string} source @param {Drawing} d */
function show(box, source, d) {
  box.removeAttribute('aria-busy');
  if ('svg' in d) {
    // Mermaid's own SVG: under strict security it runs DOMPurify over the whole SVG before returning it, and the
    // window's CSP blocks inline handlers besides.
    box.innerHTML = d.svg;
    return;
  }
  const code = document.createElement('pre');
  code.textContent = source;
  const note = document.createElement('p');
  note.className = 'quiet';
  note.textContent = `This diagram couldn't be drawn: ${d.error}`;
  box.replaceChildren(code, note);
}

/** @param {string} source @returns {HTMLElement} */
export function mermaid(source) {
  const box = document.createElement('div');
  box.className = 'diagram';
  const key = keyOf(theme(), source);
  const done = drawn.get(key);
  if (done) {
    drawn.delete(key);
    drawn.set(key, done);
    show(box, source, done);
    return box;
  }
  box.setAttribute('aria-busy', 'true');
  const wait = document.createElement('div');
  wait.className = 'diagram-wait';
  const h = heights.get(source);
  if (h) wait.style.setProperty('--wait-h', `${h}px`);
  box.append(wait);
  if (running?.key === key) {
    running.job.boxes.push(box);
    return box;
  }
  // A diagram a page shows jumps the queue.
  const job = now.get(key) ?? later.get(key) ?? { source, boxes: [] };
  job.boxes.push(box);
  later.delete(key);
  now.set(key, job);
  pump();
  return box;
}

/**
 * Queues diagrams to draw in idle time, skipping any drawn, drawing or queued already. `first` puts them before the
 * ones queued earlier (still after the ones a page shows now).
 * @param {readonly string[]} sources @param {boolean} [first]
 */
export function ahead(sources, first = false) {
  const look = theme();
  /** @type {Map<string, Job>} */
  const fresh = new Map();
  for (const source of sources) {
    const key = keyOf(look, source);
    if (drawn.has(key) || now.has(key) || running?.key === key || (!first && later.has(key))) continue;
    fresh.set(key, { source, boxes: [] });
  }
  if (first) {
    for (const [key, job] of later) if (!fresh.has(key)) fresh.set(key, job);
    later.clear();
  }
  for (const [key, job] of fresh) later.set(key, job);
  pump();
}

/** Asks for the next draw: right after this task when a page waits on one, else when the window is idle. */
function pump() {
  if (running) return;
  if (now.size) {
    if (soonAsked) return;
    soonAsked = true;
    setTimeout(() => {
      soonAsked = false;
      drawNext();
    }, 0);
  } else if (later.size && !idleAsked) {
    idleAsked = true;
    const go = () => {
      idleAsked = false;
      drawNext();
    };
    // Where the webview has no requestIdleCallback, a timer chain stands in.
    const idle = /** @type {any} */ (window).requestIdleCallback;
    if (typeof idle === 'function') idle.call(window, go);
    else setTimeout(go, 0);
  }
}

async function drawNext() {
  if (running) return;
  const queue = now.size ? now : later;
  const first = queue.entries().next();
  if (first.done) return;
  const [key, job] = first.value;
  queue.delete(key);
  running = { key, job };
  const lib = /** @type {Mermaid | undefined} */ (/** @type {any} */ (window).mermaid);
  const look = theme();
  /** @type {Drawing} */
  let d;
  try {
    if (!lib) throw new Error('Mermaid did not load.');
    setUp(lib, look);
    const { svg } = await lib.render(`diagram-${++next}`, job.source);
    d = { svg };
    const h = Number(/viewBox="[^"]*\s([\d.]+)"/.exec(svg)?.[1]);
    if (h > 0) {
      heights.delete(job.source);
      heights.set(job.source, h);
      if (heights.size > KEEP * 4) heights.delete(/** @type {string} */ (heights.keys().next().value));
    }
  } catch (err) {
    d = { error: err instanceof Error ? err.message : String(err) };
  }
  running = null;
  // Mermaid missing is no fault of the source's: the next page that shows it tries again.
  if (lib) {
    drawn.set(keyOf(look, job.source), d);
    if (drawn.size > KEEP) drawn.delete(/** @type {string} */ (drawn.keys().next().value));
  }
  for (const box of job.boxes) show(box, job.source, d);
  pump();
}

/**
 * The run's task graph as Mermaid source: the plan's tasks top to bottom, ids only (node `T8b` for task 8b), a class
 * per state; null when the run has no plan with tasks or a task doesn't say what it depends on. The run view rings the
 * picked task on the drawing, so one drawing serves every task and can be drawn ahead.
 * @param {Pick<FlowRun, 'plan' | 'ledger'>} run @returns {string | null}
 */
export function taskGraphSource(run) {
  const tasks = run.plan?.tasks ?? [];
  if (!tasks.length || !tasks.every((p) => Array.isArray(p.depends_on))) return null;
  /** @param {LedgerTask | undefined} t */
  const kind = (t) =>
    !t || t.state === 'NotStarted' ? 'todo' : t.state === 'Done' ? 'done' : t.state === 'Waiting' ? 'wait' : 'busy';
  const all = tasks.map((p) => ({ p, k: kind(run.ledger?.tasks.find((t) => t.id === p.id)) }));
  /** @param {string} v */
  const fill = (v) => `fill:${token('--color-paper-2')},stroke:${token(v)},color:${token('--color-ink-2')}`;
  // Top to bottom, so a long plan grows down the page instead of off its edge; roomier circles than the docs' diagrams
  // (Mermaid takes padding from the source, its font from the stylesheet).
  const lines = ['flowchart TB', '%%{init: {"flowchart": {"padding": 13}}}%%'];
  for (const { p } of all) lines.push(`  T${p.id}(("${p.id}"))`);
  for (const { p } of all) for (const d of p.depends_on ?? []) lines.push(`  T${d} --> T${p.id}`);
  for (const k of ['done', 'busy', 'wait', 'todo']) {
    const ids = all.filter((x) => x.k === k).map((x) => `T${x.p.id}`);
    if (ids.length) lines.push(`  class ${ids.join(',')} ${k}`);
  }
  lines.push(
    `  classDef done ${fill('--color-done')}`,
    `  classDef busy ${fill('--color-current')}`,
    `  classDef wait ${fill('--color-accent')}`,
    `  classDef todo fill:${token('--color-paper')},stroke:${token('--color-paper-4')},color:${token('--color-muted')}`,
  );
  return lines.join('\n');
}

/** The run's task graph as a diagram (see `taskGraphSource`); null when it has none. @param {Pick<FlowRun, 'plan' | 'ledger'>} run */
export function taskGraph(run) {
  const source = taskGraphSource(run);
  return source === null ? null : mermaid(source);
}
