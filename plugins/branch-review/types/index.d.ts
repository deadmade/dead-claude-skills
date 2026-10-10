/** The review the pane shows: brv's cache directory, and the title naming head and base. */
export type BranchReviewOpen = { dir: string; title: string }

declare module 'claude-code' {
  interface PluginState {
    'branch-review': { review: BranchReviewOpen | null }
  }
}
