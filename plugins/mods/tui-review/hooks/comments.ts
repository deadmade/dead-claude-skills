// Comments written in the pane, and the one message they are sent to Claude in. Plain data: the hooks module keeps
// them in $.state and submits the message.

import type { ReviewComment } from '../types';

/** `comments` with the one on `at`'s line replaced by `at`, or dropped when its text is empty. */
export function upsert(comments: readonly ReviewComment[], at: ReviewComment): ReviewComment[] {
  const rest = comments.filter((c) => c.dir !== at.dir || c.line !== at.line);
  if (at.text.trim() === '') return rest;
  return [...rest, at].sort((a, b) => (a.dir === b.dir ? a.line - b.line : a.dir < b.dir ? -1 : 1));
}

/** Where a comment points, as `path:line (side)` or `path (whole file)`. */
export const anchor = (c: ReviewComment) =>
  c.lineNo === null ? `${c.path} (whole file)` : `${c.path}:${c.lineNo} (${c.side === 'old' ? 'removed line' : 'new'})`;

/** The message the comments go to Claude in: each one's place, the diff lines it is about, and its text. */
export function message(title: string | undefined, comments: readonly ReviewComment[]): string {
  const parts = [`Review comments${title === undefined ? '' : ` on ${title}`}:`];
  for (const c of comments) {
    const quote = c.quote.length === 0 ? '' : `${fence(c.quote)}diff\n${c.quote.join('\n')}\n${fence(c.quote)}\n`;
    parts.push(`${anchor(c)}\n${quote}${c.text.trim()}`);
  }
  return parts.join('\n\n');
}

/** A code fence longer than any run of backticks in the quoted lines, so code holding one cannot close it. */
function fence(lines: readonly string[]): string {
  let longest = 0;
  for (const line of lines) for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Breaks `text` into rows of at most `width` columns, at spaces where it can. */
export function wrap(text: string, width: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.trim().split('\n')) {
    let rest = paragraph.trim();
    while (rest.length > width) {
      const space = rest.lastIndexOf(' ', width);
      const cut = space > 0 ? space : width;
      rows.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    rows.push(rest);
  }
  return rows;
}
