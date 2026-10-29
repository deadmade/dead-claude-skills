// The view interface. A view file `export default`s a `View`; it takes only types, from the module `flow-cockpit`
// (`import type { View } from 'flow-cockpit'`), and gets everything else through `ctx`. In this repository that module
// is this file (a `paths` entry in the extensions' tsconfig.json); `flow-cockpit --print-types` prints it and the data
// types as one declaration file of that module.
import type { Activity } from '../../bindings/Activity';
import type { DocName } from '../../bindings/DocName';
import type { Entry } from '../../bindings/Entry';
import type { FlowRun } from '../../bindings/FlowRun';
import type { PhaseState } from '../../bindings/PhaseState';
import type { Project } from '../../bindings/Project';
import type { ToolDetail } from '../../bindings/ToolDetail';
import type { ViewInfo } from '../../bindings/ViewInfo';

// Every data type, so a view takes them all from `flow-cockpit` too.
export type * from '../../bindings/Activity';
export type * from '../../bindings/AgentInfo';
export type * from '../../bindings/AuditDoc';
export type * from '../../bindings/AuditSummary';
export type * from '../../bindings/Changed';
export type * from '../../bindings/Decision';
export type * from '../../bindings/Deviation';
export type * from '../../bindings/DeviationStatus';
export type * from '../../bindings/DocName';
export type * from '../../bindings/Entry';
export type * from '../../bindings/Extensions';
export type * from '../../bindings/Finding';
export type * from '../../bindings/FlowDoc';
export type * from '../../bindings/FlowRun';
export type * from '../../bindings/FlowRunSummary';
export type * from '../../bindings/Gate';
export type * from '../../bindings/Ledger';
export type * from '../../bindings/LedgerTask';
export type * from '../../bindings/Live';
export type * from '../../bindings/Phase';
export type * from '../../bindings/PhaseState';
export type * from '../../bindings/PlanDoc';
export type * from '../../bindings/PlanTask';
export type * from '../../bindings/Project';
export type * from '../../bindings/Ruling';
export type * from '../../bindings/Section';
export type * from '../../bindings/SessionSummary';
export type * from '../../bindings/Status';
export type * from '../../bindings/Style';
export type * from '../../bindings/TaskState';
export type * from '../../bindings/Text';
export type * from '../../bindings/ToolCall';
export type * from '../../bindings/ToolDetail';
export type * from '../../bindings/Turn';
export type * from '../../bindings/ViewInfo';
export type * from '../../bindings/ViewSource';

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

/**
 * Which of a session's turns to read. Turn indexes count from the session's oldest turn (0), so a turn keeps its
 * index as newer ones arrive.
 */
export interface SessionPage {
  /** Read the turns before this index; the newest when left out. */
  before?: number;
  /** How many turns at most; 20 when left out. */
  limit?: number;
}

/** The core's read-only data. Each call asks the app afresh; nothing is cached. */
export interface DataApi {
  projects(): Promise<Project[]>;
  entries(project: string): Promise<Entry[]>;
  flowRun(project: string, slug: string): Promise<FlowRun | null>;
  /** The document's raw Markdown. */
  doc(project: string, slug: string, name: DocName): Promise<string | null>;
  /**
   * A page of the session's turns, oldest first: the newest `limit` before `before`, with the session's turn count
   * (`total`), the page's first index (`start`), its agents and what it waits for. Its tool calls come without their
   * input: `toolInput` reads one.
   */
  session(id: string, page?: SessionPage): Promise<Activity | null>;
  /** The input of the session's tool call `id`; null when the transcript no longer holds it. */
  toolInput(session: string, id: string): Promise<ToolDetail | null>;
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
   *
   * A `run-tab` view fills the run view's lower row, laid onto the run's two-column grid (the slot and the view's
   * section don't box their children): its render returns a `DocumentFragment` holding an `aside.left` (the rail) and
   * a `div.content`, in that order. A single element lands in the rail column only.
   */
  slot: Slot | readonly Slot[];
  render(ctx: ViewContext): Node | Promise<Node>;
}
