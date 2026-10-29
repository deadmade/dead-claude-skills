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
 * An element's place in its view's section, which a redraw builds anew: from the nearest `id` or `data-keep` (the
 * section's own descendants only), else child indexes from the section.
 * @typedef {{ view: string, path: string[] }} Place
 * @param {Element} el @returns {Place | null}
 */
function placeOf(el) {
  const home = el.closest('section.view');
  if (!(home instanceof window.HTMLElement) || !home.dataset.view) return null;
  /** @type {string[]} */
  const path = [];
  for (let node = el; node !== home && node.parentElement; node = node.parentElement) {
    const name = node.id || node.getAttribute('data-keep');
    if (name) {
      path.unshift(`#${name}`);
      break;
    }
    path.unshift(String(Array.prototype.indexOf.call(node.parentElement.children, node)));
  }
  return { view: home.dataset.view, path };
}

/** @param {HTMLElement} root @param {Place} place @returns {Element | null} */
function find(root, place) {
  /** @type {Element | null | undefined} */
  let node = [...root.querySelectorAll('section.view')].find(
    (s) => s instanceof window.HTMLElement && s.dataset.view === place.view,
  );
  for (const step of place.path) {
    if (!node) return null;
    if (step.startsWith('#')) {
      const name = step.slice(1);
      node = [...node.querySelectorAll('[id], [data-keep]')].find(
        (e) => e.id === name || e.getAttribute('data-keep') === name,
      );
    } else {
      node = node.children[Number(step)];
    }
  }
  return node ?? null;
}

/**
 * What the user did to the drawn views: scrolled panes, open folds, expanded disclosures, and the focused field with
 * its text and selection.
 * @typedef {{ place: Place, top: number, left: number }} Scrolled
 * @typedef {{ place: Place, value: string | null, start: number | null, end: number | null, direction: string | null }} Focused
 * @typedef {{ scrolled: Scrolled[], folds: { place: Place, open: boolean }[], expanded: { place: Place, value: string }[], focused: Focused | null }} Kept
 * @param {HTMLElement} root @returns {Kept}
 */
function snapshot(root) {
  /** @type {Kept} */
  const kept = { scrolled: [], folds: [], expanded: [], focused: null };
  for (const el of root.querySelectorAll('*')) {
    const place = () => placeOf(el);
    if (el.scrollTop || el.scrollLeft) {
      const at = place();
      if (at) kept.scrolled.push({ place: at, top: el.scrollTop, left: el.scrollLeft });
    }
    if (el instanceof window.HTMLDetailsElement) {
      const at = place();
      if (at) kept.folds.push({ place: at, open: el.open });
    }
    const expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) {
      const at = place();
      if (at) kept.expanded.push({ place: at, value: expanded });
    }
  }
  const active = document.activeElement;
  const at = active && root.contains(active) ? placeOf(active) : null;
  if (active && at) {
    const field = active instanceof window.HTMLInputElement || active instanceof window.HTMLTextAreaElement;
    /** @param {() => number | string | null} read */
    const safe = (read) => {
      try {
        return read();
      } catch {
        return null; // An input type without a text selection.
      }
    };
    kept.focused = {
      place: at,
      value: field ? active.value : null,
      start: field ? /** @type {number | null} */ (safe(() => active.selectionStart)) : null,
      end: field ? /** @type {number | null} */ (safe(() => active.selectionEnd)) : null,
      direction: field ? /** @type {string | null} */ (safe(() => active.selectionDirection)) : null,
    };
  }
  return kept;
}

/** Puts back what `snapshot` saw, on the elements in the same places. @param {HTMLElement} root @param {Kept} kept */
function restore(root, kept) {
  for (const { place, open } of kept.folds) {
    const el = find(root, place);
    if (el instanceof window.HTMLDetailsElement) el.open = open;
  }
  // A disclosure opens and closes through its own handler: the view's state follows the click.
  for (const { place, value } of kept.expanded) {
    const el = find(root, place);
    if (el instanceof window.HTMLElement && el.getAttribute('aria-expanded') !== value) el.click();
  }
  const focus = kept.focused;
  const el = focus && find(root, focus.place);
  if (focus && el instanceof window.HTMLElement) {
    el.focus({ preventScroll: true });
    if ((el instanceof window.HTMLInputElement || el instanceof window.HTMLTextAreaElement) && focus.value !== null) {
      if (el.value !== focus.value) {
        el.value = focus.value;
        // The view filters on what was typed, as if it were typed again.
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      if (focus.start !== null && focus.end !== null) {
        try {
          el.setSelectionRange(focus.start, focus.end, /** @type {any} */ (focus.direction ?? undefined));
        } catch {
          // An input type without a text selection.
        }
      }
    }
  }
  for (const { place, top, left } of kept.scrolled) {
    const el = find(root, place);
    if (el) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  }
}

/** The run route names a tab no loaded view draws. @param {string} id */
function missingTab(id) {
  const line = document.createElement('p');
  line.className = 'quiet';
  line.textContent = `The ${id} tab isn't loaded.`;
  return line;
}

/**
 * @param {{ root: HTMLElement, invoke: Invoke, listen: Listen, importModule?: (url: string) => Promise<any>, renderTimeout?: number }} app
 *   `renderTimeout`: how long a view's render may take, in ms, before it shows as broken.
 */
export function createRuntime({ root, invoke, listen, importModule = (url) => import(url), renderTimeout = 5000 }) {
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
  /** The route last drawn, as JSON. */
  let drawnAt = '';
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

  /** A render that never settles becomes an error, so one view can't stall the window. */
  /** @param {View} view @param {ViewContext} ctx @returns {Promise<Node>} */
  async function render(view, ctx) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`its render didn't finish within ${renderTimeout / 1000} s`)),
        renderTimeout,
      );
    });
    try {
      const node = await Promise.race([Promise.resolve().then(() => view.render(ctx)), late]);
      if (!(node instanceof window.Node)) throw new Error('its render returned no DOM node');
      return node;
    } finally {
      clearTimeout(timer);
    }
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
    const wanted = at.to === 'run' ? at.tab : undefined;
    const tab = wanted ? entries.find((e) => e.info.id === wanted && slotOf(e) === 'run-tab') : undefined;
    const [sections, tabSection] = await Promise.all([
      Promise.all(shown.map((e) => section(e, ctx))),
      tab ? section(tab, ctx) : wanted ? missingTab(wanted) : null,
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
    // The same route drawn again (fresh data, a reloaded view) keeps what the user did to it; a new route starts fresh.
    const where = JSON.stringify(at);
    const kept = where === drawnAt ? snapshot(root) : null;
    root.replaceChildren(...sections);
    if (tabSection) {
      const host = sections.map((s) => s.querySelector('[data-slot="run-tab"]')).find(Boolean);
      (host ?? root).append(tabSection);
    }
    drawnAt = where;
    if (kept) restore(root, kept);
  }

  /** @param {() => Promise<void>} step */
  function queue(step) {
    last = last.then(step).catch((err) => {
      console.error('flow-cockpit:', err);
      root.replaceChildren(card({ title: "The window couldn't be drawn.", body: reason(err), error: true }));
    });
    return last;
  }

  // At most one draw and one reload wait in the queue: a burst of `changed` events draws once.
  let drawWaiting = false;
  let reloadWaiting = false;
  function requestDraw() {
    if (drawWaiting) return last;
    drawWaiting = true;
    return queue(() => {
      drawWaiting = false;
      return draw();
    });
  }
  function requestReload() {
    if (reloadWaiting) return last;
    reloadWaiting = true;
    return queue(() => {
      reloadWaiting = false;
      return loadAll().then(draw);
    });
  }

  /** @param {Route} to */
  function navigate(to) {
    route = to;
    requestDraw();
  }

  return {
    /** Loads the views, draws `start` (the list by default) and follows the app's events. @param {Route} [start] */
    async start(start) {
      if (start) route = start;
      await listen('views-changed', () => requestReload());
      await listen('changed', (event) => {
        const project = event.payload?.project ?? null;
        const mine = 'project' in route ? route.project : undefined;
        if (project === null || mine === undefined || project === mine) requestDraw();
      });
      return requestReload();
    },
    navigate,
    /** Resolves once every draw asked for so far is done. */
    idle: () => last,
  };
}
