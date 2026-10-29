// The view runtime. It loads every view the app lists as code (`view_source` → a `text/javascript` Blob → `import()`,
// the Blob URL revoked right after), adds each loaded extension's `style.css` as one `<style>`, draws the views of the
// current route, each in its own section, and loads them again on `views-changed`. A view that fails to load or to
// draw shows its error card in its own section, with the default of that id drawn below it when one of the user's
// extensions replaced it; the other views never see it.
import { card } from './blocks/card.js';
import { diff } from './blocks/diff.js';
import { markdown, mermaidSources } from './blocks/markdown.js';
import { ahead, mermaid, taskGraph, taskGraphSource } from './blocks/mermaid.js';
import { stepper } from './blocks/stepper.js';

/**
 * @typedef {import('./api').View} View
 * @typedef {import('./api').Route} Route
 * @typedef {import('./api').DataApi} DataApi
 * @typedef {import('./api').ViewContext} ViewContext
 * @typedef {import('../../bindings/ViewInfo').ViewInfo} ViewInfo
 * @typedef {import('../../bindings/Extensions').Extensions} Extensions
 * @typedef {import('../../bindings/DocName').DocName} DocName
 * @typedef {(cmd: string, args?: Record<string, unknown>) => Promise<any>} Invoke
 * @typedef {(event: string, handler: (event: { payload: any }) => void) => Promise<unknown>} Listen
 * @typedef {{ view: View | null, error: unknown }} Loaded
 * @typedef {Loaded & { info: ViewInfo, fallback: Loaded | null }} Entry
 */

const SLOTS = ['list', 'run', 'run-tab', 'doc', 'session'];
const blocks = Object.freeze({ markdown, mermaid, diff, stepper, card, taskGraph });
/** @type {DocName[]} */
const DOCS = ['Spec', 'Plan', 'Flow'];

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

/**
 * Each view's first section, with the first element of each `id` and `data-keep` name in it (nested sections'
 * included), so a redraw finds every kept place without searching the section again: a long session has thousands.
 * @typedef {Map<string, { section: Element, names: Map<string, Element> }>} Places
 * @param {HTMLElement} root @returns {Places}
 */
function places(root) {
  /** @type {Places} */
  const views = new Map();
  for (const section of root.querySelectorAll('section.view')) {
    const view = section instanceof window.HTMLElement ? section.dataset.view : undefined;
    if (!view || views.has(view)) continue;
    /** @type {Map<string, Element>} */
    const names = new Map();
    for (const el of section.querySelectorAll('[id], [data-keep]')) {
      for (const name of [el.id, el.getAttribute('data-keep')]) if (name && !names.has(name)) names.set(name, el);
    }
    views.set(view, { section, names });
  }
  return views;
}

/** A place's element: a name is always the path's first step (see `placeOf`). @param {Places} index @param {Place} place */
function find(index, place) {
  const at = index.get(place.view);
  /** @type {Element | null | undefined} */
  let node = at?.section;
  for (const step of place.path) {
    if (!node || !at) return null;
    node = step.startsWith('#') ? at.names.get(step.slice(1)) : node.children[Number(step)];
  }
  return node ?? null;
}

/**
 * What the user did to the drawn views: scrolled panes, open folds, expanded disclosures, and the focused field with
 * its text and selection.
 * @typedef {{ place: Place, top: number, left: number }} Scrolled
 * @typedef {{ place: Place, value: string | null, start: number | null, end: number | null, direction: string | null }} Focused
 * @typedef {{ scrolled: Scrolled[], folds: { place: Place, open: boolean }[], expanded: { place: Place, value: string }[], focused: Focused | null }} Kept
 * `moved` holds the elements that have scrolled (from `scroll` events): only those are measured, since reading the
 * scroll position of every element of a long session takes seconds. The ones no longer drawn are dropped from it.
 * @param {HTMLElement} root @param {Set<Element>} moved @returns {Kept}
 */
function snapshot(root, moved) {
  /** @type {Kept} */
  const kept = { scrolled: [], folds: [], expanded: [], focused: null };
  for (const el of moved) {
    if (!root.contains(el)) {
      moved.delete(el);
      continue;
    }
    const at = el.scrollTop || el.scrollLeft ? placeOf(el) : null;
    if (at) kept.scrolled.push({ place: at, top: el.scrollTop, left: el.scrollLeft });
  }
  for (const el of root.querySelectorAll('details')) {
    const at = placeOf(el);
    if (at) kept.folds.push({ place: at, open: el.open });
  }
  for (const el of root.querySelectorAll('[aria-expanded]')) {
    const at = placeOf(el);
    if (at) kept.expanded.push({ place: at, value: el.getAttribute('aria-expanded') ?? '' });
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

/**
 * Puts back what `snapshot` saw, on the elements in the same places; the panes it scrolls join `moved`.
 * @param {HTMLElement} root @param {Kept} kept @param {Set<Element>} moved
 */
function restore(root, kept, moved) {
  /** @type {Places | null} */
  let index = null;
  /** @param {Place} place */
  const lookup = (place) => find((index ??= places(root)), place);
  for (const { place, open } of kept.folds) {
    const el = lookup(place);
    if (el instanceof window.HTMLDetailsElement) el.open = open;
  }
  // A disclosure opens and closes through its own handler: the view's state follows the click. The handler may
  // draw part of the view again, so the places are looked up afresh after it.
  for (const { place, value } of kept.expanded) {
    const el = lookup(place);
    if (el instanceof window.HTMLElement && el.getAttribute('aria-expanded') !== value) {
      el.click();
      index = null;
    }
  }
  const focus = kept.focused;
  const el = focus && lookup(focus.place);
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
    // The restored text reaches the view as typed (`input`), which may draw part of it again.
    index = null;
  }
  for (const { place, top, left } of kept.scrolled) {
    const el = lookup(place);
    if (el) {
      el.scrollTop = top;
      el.scrollLeft = left;
      moved.add(el);
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
    session: (/** @type {string} */ id, /** @type {import('./api').SessionPage} */ page = {}) =>
      invoke('session', { id, before: page.before ?? null, limit: page.limit ?? null }),
    toolInput: (/** @type {string} */ session, /** @type {string} */ tool) => invoke('tool_input', { session, tool }),
    views: () => invoke('views'),
    viewSource: (/** @type {string} */ id) => invoke('view_source', { id }),
  });

  /** @type {Route} */
  let route = { to: 'list' };
  /** @type {Entry[]} */
  let entries = [];
  /** @type {unknown} */
  let listError = null;
  /** @type {Extensions} */
  let extensions = { styles: [], disabled: [], looked: [] };
  /** The route last drawn, as JSON. */
  let drawnAt = '';
  /** @type {Promise<void>} */
  let last = Promise.resolve();
  /** The drawn elements that have scrolled, for `snapshot`. `scroll` doesn't bubble, so it is caught on its way down. */
  /** @type {Set<Element>} */
  const moved = new Set();
  root.addEventListener(
    'scroll',
    (event) => {
      if (event.target instanceof window.Element) moved.add(event.target);
    },
    true,
  );

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
    /** @type {unknown[]} */
    const slots = Array.isArray(view.slot) ? view.slot : [view.slot];
    if (!slots.length) throw new Error('its slot list is empty');
    const odd = slots.findIndex((s) => typeof s !== 'string' || !SLOTS.includes(s));
    if (odd >= 0) throw new Error(`its slot "${slots[odd]}" isn't one of ${SLOTS.join(', ')}`);
    return view;
  }

  /** @param {string} id @param {boolean} builtin @returns {Promise<Loaded>} */
  const loaded = (id, builtin) =>
    load(id, builtin).then(
      (view) => ({ view, error: null }),
      (error) => ({ view: null, error }),
    );

  /** Each extension's `style.css` as one `<style>`; the ones from the last load go. */
  function applyStyles() {
    for (const old of document.head.querySelectorAll('style[data-extension]')) old.remove();
    for (const { extension, css } of extensions.styles) {
      const style = document.createElement('style');
      style.dataset.extension = extension;
      style.textContent = css;
      document.head.append(style);
    }
  }

  async function loadAll() {
    try {
      /** @type {[ViewInfo[], Extensions | null]} */
      const [infos, ext] = await Promise.all([invoke('views'), invoke('extensions')]);
      extensions = ext ?? { styles: [], disabled: [], looked: [] };
      applyStyles();
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

  /** The slots a view serves; empty while it never loaded. @param {Entry} entry @returns {readonly string[]} */
  const slotsOf = (entry) => {
    const slot = entry.view?.slot ?? entry.fallback?.view?.slot;
    return slot === undefined ? [] : typeof slot === 'string' ? [slot] : slot;
  };

  /** @param {string} id @param {unknown} err @param {boolean} replaced */
  const errorCard = (id, err, replaced) =>
    card({
      title: `The ${id} view couldn't be drawn.`,
      meta: replaced ? 'Your copy failed, so the default one is drawn below.' : undefined,
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
        card({ title: `The default ${entry.info.id} view couldn't be drawn either.`, body: reason(err), error: true }),
      );
    }
    return box;
  }

  async function draw() {
    const at = Object.freeze({ ...route });
    const tabs = Object.freeze(
      entries
        .filter((e) => slotsOf(e).includes('run-tab'))
        .map((e) => {
          const view = /** @type {View} */ (e.view ?? e.fallback?.view);
          return Object.freeze({ id: e.info.id, title: view.title || e.info.id });
        }),
    );
    /** @type {ViewContext} */
    const ctx = Object.freeze({ data, blocks, navigate, route: at, tabs });
    // A view that never loaded has no known slot: its error shows on every route.
    const shown = entries.filter((e) => slotsOf(e).includes(at.to) || !slotsOf(e).length);
    const wanted = at.to === 'run' ? at.tab : undefined;
    const tab = wanted ? entries.find((e) => e.info.id === wanted && slotsOf(e).includes('run-tab')) : undefined;
    const [sections, tabSection] = await Promise.all([
      Promise.all(shown.map((e) => section(e, ctx))),
      tab ? section(tab, ctx) : wanted ? missingTab(wanted) : null,
    ]);
    if (listError !== null) {
      root.replaceChildren(card({ title: "The views couldn't be listed.", body: reason(listError), error: true }));
      return;
    }
    if (!sections.length) {
      // `list` and `run` are both a slot and the default extension that fills it.
      const lines = extensions.disabled.includes(at.to)
        ? [`The ${at.to} extension is switched off in config.toml.`]
        : ['No view draws this screen.', `Add an extension with a view for the "${at.to}" slot.`];
      if (extensions.looked.length)
        lines.push(`The default extensions weren't found. Looked in ${extensions.looked.join(', ')}.`);
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.append(
        ...lines.map((text) => {
          const line = document.createElement('p');
          line.textContent = text;
          return line;
        }),
      );
      root.replaceChildren(empty);
      return;
    }
    // The same route drawn again (fresh data, a reloaded view) keeps what the user did to it; a new route starts fresh.
    const where = JSON.stringify(at);
    const kept = where === drawnAt ? snapshot(root, moved) : null;
    root.replaceChildren(...sections);
    if (tabSection) {
      const host = sections.map((s) => s.querySelector('[data-slot="run-tab"]')).find(Boolean);
      (host ?? root).append(tabSection);
    }
    drawnAt = where;
    if (kept) restore(root, kept, moved);
    drawAhead(at, !kept);
  }

  // Drawing ahead: the diagrams the next pages show, queued to draw in idle time (blocks/mermaid.js). After the list,
  // the task graph and document diagrams of the shown project's unfinished runs; when a run opens, the rest of that
  // run's, first in line. One pass at a time; a route drawn meanwhile is taken up after it.
  /** @type {Route | null} */
  let aheadNext = null;
  let aheadBusy = false;
  // What each run (`project/slug`) was last read for, from its list entry: a redraw reads a run's documents again only
  // when its phase, status or last activity changed, and its task graph only when its progress did.
  /** @type {Map<string, { docs: string, graph: string }>} */
  const looked = new Map();

  /** @param {Route} at @param {boolean} opened a new route, not a redraw of the one shown */
  async function drawAhead(at, opened) {
    // On a run, the view draws the live graph itself: only opening it draws ahead.
    if (at.to !== 'list' && !(at.to === 'run' && opened)) return;
    aheadNext = at;
    if (aheadBusy) return;
    aheadBusy = true;
    for (let next = /** @type {Route | null} */ (at); next; next = aheadNext) {
      aheadNext = null;
      try {
        await aheadFor(next);
      } catch (err) {
        console.warn('flow-cockpit: drawing ahead:', err);
      }
    }
    aheadBusy = false;
  }

  /** @param {Route} at */
  async function aheadFor(at) {
    if (at.to === 'run') return aheadRun(at.project, at.slug, true, true, true);
    if (at.to !== 'list') return;
    /** @type {import('../../bindings/Project').Project[]} */
    const projects = (await data.projects()) ?? [];
    // The project the list shows.
    const project = projects.find((p) => p.id === at.project) ?? projects[0];
    if (!project) return;
    /** @type {import('../../bindings/Entry').Entry[]} */
    const listed = (await data.entries(project.id)) ?? [];
    for (const e of listed) {
      if (e.kind !== 'FlowRun' || e.status === 'Done') continue;
      const key = `${project.id}/${e.slug}`;
      const was = looked.get(key);
      const now = { docs: JSON.stringify([e.phase, e.status, e.last_activity]), graph: JSON.stringify([e.progress]) };
      if (was?.docs === now.docs && was.graph === now.graph) continue;
      await aheadRun(project.id, e.slug, false, !was || was.graph !== now.graph, !was || was.docs !== now.docs);
      looked.set(key, now);
    }
  }

  /**
   * Queues a run's task graph (`graph`) and its documents' diagrams (`docs`).
   * @param {string} project @param {string} slug @param {boolean} first @param {boolean} graph @param {boolean} docs
   */
  async function aheadRun(project, slug, first, graph, docs) {
    const [run, ...texts] = await Promise.all([
      graph ? data.flowRun(project, slug) : null,
      ...(docs ? DOCS.map((name) => data.doc(project, slug, name)) : []),
    ]);
    const source = run ? taskGraphSource(run) : null;
    ahead([...(source === null ? [] : [source]), ...texts.flatMap((t) => (t ? mermaidSources(t) : []))], first);
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
