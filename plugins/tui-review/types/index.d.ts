/** The review the pane shows: brv's cache directory, and the title naming head and base. */
export type TuiReviewOpen = { dir: string; title: string }

/** A comment written in the pane, waiting to be sent to Claude. */
export type ReviewComment = {
  /** The review it was written in, and the global line there it is on. */
  dir: string
  line: number
  path: string
  /** The commented line's number in the file, on its side of the diff; null for a comment on the whole file. */
  lineNo: number | null
  side: 'old' | 'new' | null
  /** The diff lines the comment is about, each with its sign, the commented line last. */
  quote: string[]
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'tui-review': {
      review: TuiReviewOpen | null
      comments: ReviewComment[]
      /** The comment the pane is asking the text of, or null. */
      composing: ReviewComment | null
    }
  }
}
