// What Claude is told about the open review with each prompt: which diff, and where the person's cursor is. Claude
// never sees the pane, so this is how "this line" or "the file I'm on" means something. Plain data, no engine calls.

import type { ReviewComment } from '../types'
import { anchor } from './comments'

export type ReviewInfo = {
  headName: string
  baseName: string
  headSha: string
  mergeBaseSha: string
}

/** The note added to a prompt while a branch review is open; `at` is the cursor's place, or why there is none. */
export function reviewContext(review: ReviewInfo, at: ReviewComment | string): string {
  const range = `${review.mergeBaseSha.slice(0, 12)}..${review.headSha.slice(0, 12)}`
  const where = typeof at === 'string' ? '' : ` Their cursor is on ${anchor(at)}.`
  return (
    `The user has the tui-review pane open beside this conversation, reviewing ${review.headName} against ` +
    `${review.baseName} (git diff ${range}).${where} The pane is not visible to you; read the code with git when needed.`
  )
}
