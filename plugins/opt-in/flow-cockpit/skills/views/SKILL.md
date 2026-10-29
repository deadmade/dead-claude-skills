---
name: views
description: 'Write, change, restore or switch off a view of the flow cockpit, the window that shows flow runs, audits and Claude sessions: a TypeScript file in an extension folder that the open window reloads on save. Use when the user asks for a new screen, tab or panel in the flow cockpit, or to change, fix, reset or turn off one of its views (list, run, docs, activity).'
---

# views

The flow cockpit (`flow-cockpit`, a desktop window) draws every screen through **views**: TypeScript files, each
`export default`ing one `View`. Views come in **extensions**, folders the app loads from disk. Four default extensions
ship with the app: `list` (projects, flow runs, audits, loose sessions), `run` (one flow run: Build and Decisions),
`docs` (the run's Docs tab) and `activity` (a run's Activity tab and a session's own screen). The window reads views and
data and writes nothing. It reloads the views a few seconds after a file in either extensions folder changes, so the
user sees your change without a restart.

Linux only for now: the app comes from this repository's flake (`nix run github:deadmade/dead-claude-skills#flow-cockpit`,
or its `flow-cockpit` package in a system config). Windows comes later. Check that `flow-cockpit --version` runs before
you start; if it doesn't, tell the user how to get it and stop.

## Where views live

`flow-cockpit --print-paths` prints the three places, one per line with a label: `default extensions:`,
`user extensions:` and `config:`.

- **An extension** is a folder `<name>/` holding one or more view files and an optional `style.css`. The folder name
  is the extension's name. A file `<id>.ts` in it is the view `<id>`. A name with a second dot (`flow-cockpit.d.ts`,
  `x.test.ts`) is not a view, and neither is a file that isn't `.ts`. A folder without a view is not an extension.
- **Links are ignored**, with no error: a symlinked extension folder, view file or `style.css` doesn't load. Put real
  folders and files there, copies rather than links.
- **The default extensions** ship with the app (in the Nix package, `share/flow-cockpit/extensions/`). Never write
  there: an update replaces them.
- **The user's extensions folder** is `$XDG_CONFIG_HOME/flow-cockpit/extensions/`. When `XDG_CONFIG_HOME` is unset or
  empty, it is `$HOME/.config/flow-cockpit/extensions/`. Write every extension there.
  - An extension with a new name adds its views.
  - An extension with a default's name replaces that whole default. Deleting it brings the default back.
  - A view id that a default also has replaces that default view, whichever extension it is in.
  - Two of the user's extensions with the same view id are an error that names both.
- The old `flow-cockpit/views/` folder is no longer read. Move a view from there into an extension folder of its own.
- **`config.toml`** sits next to the user's extensions folder. It holds the user's own settings, edited by hand:
  - `disabled = ["<extension name>", ...]` switches extensions off, defaults or the user's own. When `list` or
    `run` is off and nothing else draws that screen, the window says so there.
  - `hidden = ["<project id or name>", ...]` leaves projects out of the list.
  - `trusted = ["/path/to/repo", ...]` names repositories whose own `.flow-cockpit/views/` may load. Those folders
    aren't read yet, so don't put views there.
  - A change takes effect within a few seconds, without a restart. A file that doesn't parse is ignored, and the
    settings stay as they were.
  - Change it only when the user asks you to, for example to switch an extension off.

## Before you write

Run this as one command: a variable set in one shell call is gone in the next, so every command block here starts
by setting `dir`.

```sh
dir="${XDG_CONFIG_HOME:-$HOME/.config}/flow-cockpit/extensions"
mkdir -p "$dir"
flow-cockpit --print-types > "$dir/flow-cockpit.d.ts"
```

`flow-cockpit.d.ts` declares the module `flow-cockpit`: the view interface (`View`, `ViewContext`, `Route`, `Slot`,
`Blocks`, `DataApi`) and every data type. A view imports its types from it by that bare name, never by a path:
`import type { View, ViewContext, FlowRun } from 'flow-cockpit';`. Read the file: it documents the routes, the slots
and what each data call returns. Print it again after an app update. Look at a default view (`run/run.ts`, or
`list`, `docs`, `activity`, in the default extensions folder) before writing one: its helpers, classes and wording are
the house style.

## Where a view shows up

The `list`, `run` and `activity` defaults each fill the whole window. A view you add for the `list`, `run` or
`session` route is drawn **below** that full-height screen, so the user only finds it by scrolling. Pick the place
like this:

- **Something about one flow run:** write a `run-tab` view in an extension of its own. It becomes a tab of the run
  view, next to Docs and Activity.
- **Something inside the list or the run view:** copy that default extension (`run` instead of `list` for the run
  view) into the user's folder, then edit the copy:

  ```sh
  dir="${XDG_CONFIG_HOME:-$HOME/.config}/flow-cockpit/extensions"
  defaults=$(flow-cockpit --print-paths | sed -n 's/^default extensions: //p')
  mkdir -p "$dir" && cp -r "$defaults/list" "$dir/" && chmod -R u+w "$dir/list"
  ```

  The copy keeps the name, so it replaces the default; its imports from `flow-cockpit` work as they are. Deleting the
  copy restores the default. If the copy breaks, the window shows its error with the default drawn below it. App
  updates never touch the copy, so it keeps the old default's code until you copy it again.

- A `doc` view (one document of a run) has the screen to itself, but no default leads there. It shows only when
  another view calls `ctx.navigate({ to: 'doc', project, slug, name })`, with `name` one of `'Spec'`, `'Plan'` or
  `'Flow'`, for example from a link in a changed copy of `run`.
- **To turn a view off**, switch its extension off in `config.toml` (`disabled`) rather than deleting anything. Only
  when the user asks.

## The view

A `run-tab` view returns a `DocumentFragment` holding an `aside.left` (the rail) and then a `div.content`. They are
laid onto the run view's two-column grid. A single element lands in the rail column only. This one lives in
`$dir/open-deviations/open-deviations.ts`:

```ts
import type { View, ViewContext } from 'flow-cockpit';

const view: View = {
  id: 'open-deviations', // the file name without .ts
  title: 'Deviations', // the tab's label
  slot: 'run-tab',
  async render(ctx: ViewContext) {
    const rail = document.createElement('aside');
    rail.className = 'left';
    const content = document.createElement('div');
    content.className = 'content';
    const route = ctx.route;
    if (route.to === 'run') {
      const run = await ctx.data.flowRun(route.project, route.slug);
      // ... fill rail and content from run; text from data goes through ctx.blocks ...
    }
    const out = document.createDocumentFragment();
    out.append(rail, content);
    return out;
  },
};
export default view;
```

- `slot` is one of `list`, `run`, `run-tab`, `doc` or `session`, or a list of them for a view that serves several.
  The default activity view is `['run-tab', 'session']`. A view tells its places apart by `ctx.route.to`. Drawn as a
  tab, a view sees `ctx.route.to === 'run'` with `ctx.route.tab` set to its id, never `'run-tab'`.
- Several views on one route are drawn in id order, each in its own `<section class="view" data-view="<id>">`.
- `render(ctx)` returns a DOM node, or a promise of one. It runs again on every change of the data. A render that
  takes longer than 5 seconds shows as an error.
- A view gets everything through `ctx`:
  - `ctx.data`: projects, entries, flow runs, raw documents, sessions and views;
  - `ctx.blocks`;
  - `ctx.navigate(route)`;
  - `ctx.route`;
  - `ctx.tabs`, the run tabs.
- State that should survive a redraw, such as a picked row or a filter, can live in a module-level variable, as in
  the defaults. But every view file is imported afresh whenever any file in either extensions folder changes, or
  `disabled` in `config.toml` does. That resets module state and runs top-level code again.

## Rules

- **Types only from outside.** Only `import type` is allowed, from `'flow-cockpit'`. A value `import`, a dynamic
  `import()` or `import x =` is a load error that names the line. `require` doesn't exist in the window: the view
  fails when it runs, and the error has no line. Use erasable TypeScript only: no `enum`, `namespace` or parameter
  properties.
- **No network.** No `fetch`, `XMLHttpRequest`, `WebSocket`, and no remote images, fonts or scripts. Data comes only
  from `ctx.data`.
- **Text from data is untrusted.** Transcripts and documents carry text from web pages and tools.
  - Show it through `ctx.blocks.markdown(text)`, `ctx.blocks.card` or `textContent`. `markdown` is sanitised, and a
    fenced `mermaid` block becomes a diagram.
  - Never set `innerHTML`, `outerHTML` or `insertAdjacentHTML`.
  - Never set an `href` or `src` from data yourself; links in data go through `markdown`.
  - `ctx.blocks` also has `mermaid`, `diff` (a line diff) and `stepper` (the phase track).
- **No timers or global listeners**, neither in `render` nor at the top of the module. A view has no teardown, so an
  interval, or a listener on `window` or `document`, piles up with every redraw and every reload. Put listeners on
  the view's own nodes.
- **Redraws keep what the user did**, such as scroll, open folds, focus and typed text, when the window can find the
  same nodes again:
  - A field that should keep focus or typed text needs a `data-keep="<name>"` that is unique within the view. Prefer
    `data-keep` to `id`: an `id` is page-wide and can clash with another view's.
  - Repeated items whose open state should survive, such as a `<details>` fold or an expanded row, need a stable
    `data-keep`. Use the item's slug or number, not its position.
  - Put `aria-expanded` only on plain toggles. The window restores state by clicking an element whose
    `aria-expanded` changed, so a button that also navigates or loads must not carry it.
- **Styling.**
  - The window's `tokens.css` classes are the house vocabulary. They include `.left`, `.content`, `.group`,
    `.group-h`, `.rows`, `.row` (with `.k`, `.ttl` and `.mark`), `.status` with `.st-Waiting`, `.st-Working`,
    `.st-Idle` and `.st-Done`, `.quiet`, `.num` and `.tab`. Reuse them before adding CSS.
  - An extension's own CSS goes in its `style.css`. The window adds it while the extension is loaded and takes it
    away when the extension is switched off or removed. It applies to the whole window, so scope every rule under
    `section[data-view="<id>"]` of one of the extension's views.
  - Use the tokens' variables, such as `var(--color-ink)`, `var(--color-muted)`, `var(--space-3)` and
    `var(--text-sm)`, not your own colours and sizes.

## Check it

- If `tsc` is at hand, type-check the extension's views next to the printed types:

  ```sh
  cd "${XDG_CONFIG_HOME:-$HOME/.config}/flow-cockpit/extensions" &&
    tsc --noEmit --strict --target es2023 --lib es2023,dom,dom.iterable --module esnext --moduleResolution bundler \
      --verbatimModuleSyntax --erasableSyntaxOnly flow-cockpit.d.ts <name>/*.ts
  ```

- Save, and tell the user where to look: the run's new tab, or the screen whose copy you changed.
- A view that fails to load or draw shows its error in its own place, and the other views keep working. Fix the file
  and save again; the window needs no restart.
