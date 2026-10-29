// The view interface. A view file `export default`s a `View`; it takes only types from here (type-only imports) and gets
// everything else through `ctx`. `flow-cockpit --print-types` prints this file and the data types as one declaration file.
import type { Activity } from '../../bindings/Activity';
import type { DocName } from '../../bindings/DocName';
import type { Entry } from '../../bindings/Entry';
import type { FlowRun } from '../../bindings/FlowRun';
import type { PhaseState } from '../../bindings/PhaseState';
import type { Project } from '../../bindings/Project';
import type { ViewInfo } from '../../bindings/ViewInfo';

/**
 * Where the window is. `list` draws the `list` views, `run` the `run` views, `doc` the `doc` views, `session` the
 * `session` views. A `run` route whose `tab` names a `run-tab` view draws the run views too, and that view inside the
 * run view's `data-slot="run-tab"` element. `session` is one Claude session by its id, such as a loose session that
 * belongs to no flow run.
 */
export type Route =
  | { to: 'list'; project?: string }
  | { to: 'run'; project: string; slug: string; tab?: string }
  | { to: 'doc'; project: string; slug: string; name: DocName }
  | { to: 'session'; project: string; id: string };

/** Where a view draws: one of these, or a list of them for a view that serves several (see `View.slot`). */
export type Slot = 'list' | 'run' | 'run-tab' | 'doc' | 'session';

/** The core's read-only data. Each call asks the app afresh; nothing is cached. */
export interface DataApi {
  projects(): Promise<Project[]>;
  entries(project: string): Promise<Entry[]>;
  flowRun(project: string, slug: string): Promise<FlowRun | null>;
  /** The document's raw Markdown. */
  doc(project: string, slug: string, name: DocName): Promise<string | null>;
  session(id: string): Promise<Activity | null>;
  views(): Promise<ViewInfo[]>;
  /** A view's code, types stripped; rejects with the error, which names the line. */
  viewSource(id: string): Promise<string>;
}

/** One phase on a stepper; `gate` is the gate that follows it. */
export interface Step {
  label: string;
  state: PhaseState;
  gate?: { n: number; approved: string | null };
}

/** A quiet item between hairlines. A string `body` is always text, never HTML. `error` tints it as a failure. */
export interface CardOpts {
  title: string;
  meta?: string;
  body?: Node | string;
  error?: boolean;
}

/** The shared building blocks. Text from data goes through these; a view never sets `innerHTML`. */
export interface Blocks {
  /** Sanitised Markdown; a fenced `mermaid` block becomes a diagram. */
  markdown(text: string): Node;
  mermaid(source: string): Node;
  /** A line diff, unchanged runs folded. */
  diff(old: string, next: string): Node;
  /** The segmented phase track with gate ticks, which opens to the list. */
  stepper(steps: Step[]): Node;
  card(opts: CardOpts): Node;
}

export interface ViewContext {
  data: DataApi;
  blocks: Blocks;
  navigate(to: Route): void;
  /** The route this draw is for. */
  readonly route: Route;
  /** The loaded `run-tab` views, for a run view's tab bar; a tab navigates to `{ to: 'run', project, slug, tab: id }`. */
  readonly tabs: readonly { id: string; title: string }[];
}

export interface View {
  id: string;
  title: string;
  /**
   * Where it draws. A list serves each of its slots with the same render, which tells them apart by `ctx.route`: the
   * built-in activity view is `['run-tab', 'session']`, a run's Activity tab and a session's own screen.
   */
  slot: Slot | readonly Slot[];
  render(ctx: ViewContext): Node | Promise<Node>;
}
