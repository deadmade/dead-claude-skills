---
name: views
description: 'Write, change or restore a view of the flow cockpit, the window that shows flow runs, audits and Claude sessions: a TypeScript file in its views folder that the open window reloads on save. Use when the user asks for a new screen, tab or panel in the flow cockpit, or to change, fix or reset one of its views (list, run, docs, activity).'
---

# views

The flow cockpit (`flow-cockpit`, a desktop window) draws every screen through **views**: TypeScript files, each
`export default`ing one `View`. The built-in views are `list` (projects, flow runs, audits, loose sessions), `run` (one
flow run: Build and Decisions), `docs` (the run's Docs tab) and `activity` (a run's Activity tab and a session's own
screen). The window reads views and data and writes nothing; it reloads a view within a few seconds of its file
changing, so the user sees your change without a restart.

Linux only for now: the app comes from this repository's flake (`nix run github:deadmade/dead-claude-skills#flow-cockpit`,
or its `flow-cockpit` package in a system config). Windows comes later. Check `flow-cockpit --version` runs before you
start; if it doesn't, tell the user how to get it and stop.

## Where views live

- **The views folder:** `$XDG_CONFIG_HOME/flow-cockpit/views/` (default `~/.config/flow-cockpit/views/`). Write every
  view here. A file `<id>.ts` is the view `<id>`: a new id adds a view, the id of a built-in replaces it. A name with
  another dot (`flow-cockpit.d.ts`, `x.test.ts`) is not a view, and neither is anything that isn't `.ts`.
- **`config.toml`**, next to the folder (`~/.config/flow-cockpit/config.toml`): the user's own settings, edited by
  hand. `hidden = ["<project id or name>", ...]` leaves projects out of the list. `trusted = ["/path/to/repo", ...]`
  names repositories whose own `.flow-cockpit/views/` may load; those folders aren't read yet, so don't put views
  there. Change `config.toml` only when the user asks you to.

## Before you write

1. Save the types next to the views: `flow-cockpit --print-types > ~/.config/flow-cockpit/views/flow-cockpit.d.ts`.
   It holds the view interface (`View`, `ViewContext`, `Route`, `Slot`, `Blocks`, `DataApi`) and every data type.
   Print it again after an app update. Read it: it documents the routes, the slots and what each data call returns.
2. **To change a built-in**, copy it first: `flow-cockpit --print-view <id> > ~/.config/flow-cockpit/views/<id>.ts`,
   then edit the copy. The copy imports its types from `../../shell/api` and `../../../bindings/*`; point every one of
   those imports at `./flow-cockpit` in the copy. The window marks the view as replaced. **Deleting the copy restores
   the built-in.** App updates never touch the copy, so it keeps the old built-in's code until it is printed again.
3. Look at a built-in (`--print-view run`, `list`, `docs`, `activity`) before writing a new view: its helpers, classes
   and wording are the house style.

## The view

```ts
import type { View, ViewContext } from './flow-cockpit';

const view: View = {
  id: 'open-deviations', // the file name without .ts
  title: 'Open deviations', // the tab label for a run-tab view
  slot: 'list',
  async render(ctx: ViewContext) {
    const root = document.createElement('div');
    // ... build nodes from ctx.data, text through ctx.blocks ...
    return root;
  },
};
export default view;
```

- `slot` says where it draws: `list`, `run`, `run-tab`, `doc` or `session` (a route of the same name; see `Route`), or
  a list of them for a view that serves several, telling them apart by `ctx.route.to` (the built-in activity view is
  `['run-tab', 'session']`). Several views on one route stack, in id order, each in its own
  `<section class="view" data-view="<id>">`.
- A **`run-tab`** view is a tab of the run view: `ctx.tabs` lists them and a tab navigates to
  `{ to: 'run', project, slug, tab: id }`. Its render returns a `DocumentFragment` holding an `aside.left` (the rail)
  and then a `div.content`, laid onto the run's two-column grid. A single element lands in the rail column only.
- `render(ctx)` returns a DOM node (or a promise of one) and runs again on every change of the data or the views. It
  gets everything through `ctx`: `ctx.data` (projects, entries, flow runs, raw documents, sessions, views),
  `ctx.blocks`, `ctx.navigate(route)`, `ctx.route` and `ctx.tabs`. State that should survive a redraw (a picked row,
  a filter) lives in a module-level variable, as the built-ins do.

## Rules

- **Types only from outside.** Only `import type` is allowed; a value `import`, a dynamic `import()` or `require` is a
  load error naming the line. Use erasable TypeScript only (no `enum`, `namespace` or parameter properties).
- **No network.** No `fetch`, `XMLHttpRequest`, `WebSocket` or remote images, fonts or scripts; data comes only from
  `ctx.data`.
- **Text from data is untrusted.** Transcripts and documents carry text from web pages and tools. Show it through
  `ctx.blocks.markdown(text)` (sanitised Markdown; a fenced `mermaid` block becomes a diagram), `ctx.blocks.card` or
  `textContent`. Never set `innerHTML`, `outerHTML` or `insertAdjacentHTML`, and never set an `href` or `src` from
  data yourself: links in data go through `markdown`. `ctx.blocks` also has `mermaid`, `diff` (a line diff) and `stepper` (the
  phase track).
- **No timers or global listeners in `render`.** A view has no teardown, so an interval or a listener on `window` or
  `document` would pile up with every redraw. Put listeners on the view's own nodes.
- **Redraws keep what the user did** (scroll, open folds, focus and typed text) when the nodes let the window find
  them again:
  - a field that keeps focus or typed text across redraws needs an `id` or a `data-keep="<name>"`;
  - repeated items whose open state should survive (a `<details>` fold, an expanded row) need a stable `data-keep`,
    such as the item's slug or number, not its position;
  - put `aria-expanded` only on plain toggles: the window clicks an element whose `aria-expanded` changed to restore
    it, so a button that also navigates or loads must not carry it.
- **Styling.** The window's `tokens.css` classes are the house vocabulary: `.left`, `.content`, `.group`, `.group-h`,
  `.rows`, `.row` (with `.k`, `.ttl`, `.mark`), `.status` with `.st-Waiting`/`.st-Working`/`.st-Idle`/`.st-Done`,
  `.quiet`, `.num`, `.tab` and the others the built-ins use. Reuse them before adding CSS. When a view needs its own,
  it appends a `<style>` element to its output whose every rule is scoped under `section[data-view="<id>"]`, and
  uses the tokens' variables (`var(--color-ink)`, `var(--color-muted)`, `var(--space-3)`, `var(--text-sm)`, ...)
  rather than its own colours and sizes.

## Check it

- If `tsc` is at hand, type-check the file from the views folder:
  `tsc --noEmit --strict --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler --verbatimModuleSyntax --erasableSyntaxOnly flow-cockpit.d.ts <id>.ts`.
- Save, and ask the user to look at the window. A view that fails to load or draw shows its error, with the line, in
  its own place; the other views keep working, and a broken copy of a built-in shows the built-in below its error.
  Fix the file and save again; no restart is needed.
