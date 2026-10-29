// The view runtime. It loads every view the app lists as code (`view_source` → a `text/javascript` Blob → `import()`,
// the Blob URL revoked right after), draws the views of the current route, each in its own section, and loads them
// again on `views-changed`. A view that fails to load or to draw shows its error card in its own section, with the
// built-in of that id drawn below it when a views folder replaced one; the other views never see it.
import { card } from './blocks/card.js';
import { diff } from './blocks/diff.js';
import { markdown } from './blocks/markdown.js';
import { mermaid } from './blocks/mermaid.js';
import { stepper } from './blocks/stepper.js';

/**
 * @typedef {import('./api').View} View
 * @typedef {import('./api').Route} Route
 * @typedef {import('./api').DataApi} DataApi
 * @typedef {import('./api').ViewContext} ViewContext
 * @typedef {import('../../bindings/ViewInfo').ViewInfo} ViewInfo
 * @typedef {import('../../bindings/DocName').DocName} DocName
 * @typedef {(cmd: string, args?: Record<string, unknown>) => Promise<any>} Invoke
 * @typedef {(event: string, handler: (event: { payload: any }) => void) => Promise<unknown>} Listen
 * @typedef {{ view: View | null, error: unknown }} Loaded
 * @typedef {Loaded & { info: ViewInfo, fallback: Loaded | null }} Entry
 */

const SLOTS = ['list', 'run', 'run-tab', 'doc'];
const blocks = Object.freeze({ markdown, mermaid, diff, stepper, card });

/** @param {unknown} err */
const reason = (err) => (err instanceof Error ? err.message : String(err));

/**
 * @param {{ root: HTMLElement, invoke: Invoke, listen: Listen, importModule?: (url: string) => Promise<any> }} app
 */
export function createRuntime({ root, invoke, listen, importModule = (url) => import(url) }) {
  /** @type {DataApi} */
  const data = Object.freeze({
    projects: () => invoke('projects'),
    entries: (/** @type {string} */ project) => invoke('entries', { project }),
    flowRun: (/** @type {string} */ project, /** @type {string} */ slug) => invoke('flow_run', { project, slug }),
    doc: (/** @type {string} */ project, /** @type {string} */ slug, /** @type {DocName} */ name) =>
      invoke('doc', { project, slug, name }),
    session: (/** @type {string} */ id) => invoke('session', { id }),
    views: () => invoke('views'),
    viewSource: (/** @type {string} */ id) => invoke('view_source', { id }),
  });

  /** @type {Route} */
  let route = { to: 'list' };
  /** @type {Entry[]} */
  let entries = [];
  /** @type {unknown} */
  let listError = null;
  /** @type {Promise<void>} */
  let last = Promise.resolve();

  /** @param {string} id @param {boolean} builtin @returns {Promise<View>} */
  async function load(id, builtin) {
    /** @type {string} */
    const source = await invoke('view_source', builtin ? { id, builtin: true } : { id });
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let module;
    try {
      module = await importModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const view = module?.default;
    if (!view || typeof view.render !== 'function') throw new Error('it has no default export with a render function');
    if (!SLOTS.includes(view.slot)) throw new Error(`its slot "${view.slot}" isn't one of ${SLOTS.join(', ')}`);
    return view;
  }

  /** @param {string} id @param {boolean} builtin @returns {Promise<Loaded>} */
  const loaded = (id, builtin) =>
    load(id, builtin).then(
      (view) => ({ view, error: null }),
      (error) => ({ view: null, error }),
    );

  async function loadAll() {
    try {
      /** @type {ViewInfo[]} */
      const infos = await invoke('views');
      entries = await Promise.all(
        infos.map(async (info) => {
          const own = await loaded(info.id, false);
          // A broken replacement's slot comes from the built-in behind it.
          const fallback = own.view || !info.replaced ? null : await loaded(info.id, true);
          return { info, ...own, fallback };
        }),
      );
      listError = null;
    } catch (err) {
      entries = [];
      listError = err;
    }
  }

  /** @param {Entry} entry */
  const slotOf = (entry) => entry.view?.slot ?? entry.fallback?.view?.slot ?? null;

  /** @param {string} id @param {unknown} err @param {boolean} replaced */
  const errorCard = (id, err, replaced) =>
    card({
      title: `The ${id} view couldn't be drawn.`,
      meta: replaced ? 'Its copy in the views folder failed, so the built-in one is drawn below.' : undefined,
      body: reason(err),
      error: true,
    });

  /** @param {View} view @param {ViewContext} ctx @returns {Promise<Node>} */
  async function render(view, ctx) {
    const node = await view.render(ctx);
    if (!(node instanceof window.Node)) throw new Error('its render returned no DOM node');
    return node;
  }

  /** One view in its own section; a failure stays inside it. @param {Entry} entry @param {ViewContext} ctx */
  async function section(entry, ctx) {
    const box = document.createElement('section');
    box.className = 'view';
    box.dataset.view = entry.info.id;
    let error = entry.error;
    if (entry.view) {
      try {
        box.append(await render(entry.view, ctx));
        return box;
      } catch (err) {
        error = err;
      }
    }
    box.append(errorCard(entry.info.id, error, entry.info.replaced));
    if (!entry.info.replaced) return box;
    entry.fallback ??= await loaded(entry.info.id, true);
    const builtin = entry.fallback.view;
    try {
      if (!builtin) throw entry.fallback.error;
      box.append(await render(builtin, ctx));
    } catch (err) {
      box.append(
        card({ title: `The built-in ${entry.info.id} view couldn't be drawn either.`, body: reason(err), error: true }),
      );
    }
    return box;
  }

  async function draw() {
    const at = Object.freeze({ ...route });
    const tabs = Object.freeze(
      entries
        .filter((e) => slotOf(e) === 'run-tab')
        .map((e) => {
          const view = /** @type {View} */ (e.view ?? e.fallback?.view);
          return Object.freeze({ id: e.info.id, title: view.title || e.info.id });
        }),
    );
    /** @type {ViewContext} */
    const ctx = Object.freeze({ data, blocks, navigate, route: at, tabs });
    // A view that never loaded has no known slot: its error shows on every route.
    const shown = entries.filter((e) => slotOf(e) === at.to || slotOf(e) === null);
    const tab =
      at.to === 'run' && at.tab ? entries.find((e) => e.info.id === at.tab && slotOf(e) === 'run-tab') : undefined;
    const [sections, tabSection] = await Promise.all([
      Promise.all(shown.map((e) => section(e, ctx))),
      tab ? section(tab, ctx) : null,
    ]);
    if (listError !== null) {
      root.replaceChildren(card({ title: "The views couldn't be listed.", body: reason(listError), error: true }));
      return;
    }
    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const first = document.createElement('p');
      first.textContent = 'No view draws this screen.';
      const second = document.createElement('p');
      second.textContent = `Add a view with slot "${at.to}" to the views folder.`;
      empty.append(first, second);
      root.replaceChildren(empty);
      return;
    }
    root.replaceChildren(...sections);
    if (tabSection) {
      const host = sections.map((s) => s.querySelector('[data-slot="run-tab"]')).find(Boolean);
      (host ?? root).append(tabSection);
    }
  }

  /** @param {() => Promise<void>} step */
  function queue(step) {
    last = last.then(step).catch((err) => {
      console.error('flow-cockpit:', err);
      root.replaceChildren(card({ title: "The window couldn't be drawn.", body: reason(err), error: true }));
    });
    return last;
  }

  /** @param {Route} to */
  function navigate(to) {
    route = to;
    queue(draw);
  }

  return {
    /** Loads the views, draws `start` (the list by default) and follows the app's events. @param {Route} [start] */
    async start(start) {
      if (start) route = start;
      await listen('views-changed', () => queue(() => loadAll().then(draw)));
      await listen('changed', (event) => {
        const project = event.payload?.project ?? null;
        const mine = 'project' in route ? route.project : undefined;
        if (project === null || mine === undefined || project === mine) queue(draw);
      });
      return queue(() => loadAll().then(draw));
    },
    navigate,
    /** Resolves once every draw asked for so far is done. */
    idle: () => last,
  };
}
