/** The review the pane shows: brv's cache directory, and the title naming head and base. */
export type TuiReviewOpen = { dir: string; title: string }

declare module 'claude-code' {
  interface PluginState {
    'tui-review': { review: TuiReviewOpen | null }
  }
}
