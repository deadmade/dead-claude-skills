// Paints one frame of the review into Raster cells: `[codePoint, fg, bg]` u32 triplets, row-major. Pure and
// synchronous: the caller loads the chunks the window needs first, so a frame costs only the cells it fills.

import { Kind, type Highlights, type Lines, type Manifest, spanCol, spanLen, spanStyle } from './chunks'
import { DEFAULT, styleFg, theme } from './theme'
import type { View } from './view'

export type Loaded = { lines: Lines; hl?: Highlights }

export type Source = {
  view: View
  /** The cursor's row, highlighted. */
  cursor: number
  /** How many files are marked viewed; the marks themselves are the view's collapsed files. */
  viewed?: { count: number }
  /** Global lines carrying a comment, marked in the gutter, and how many comments are waiting to be sent. */
  comments?: { lines: ReadonlySet<number>; count: number }
  /** A chunk already in memory, or undefined while it is not (drawn as a placeholder, never awaited). */
  chunk(index: number): Loaded | undefined
}

/** Columns before the code: a 6-digit line number, a space, the sign, a space. */
export const GUTTER = 9
const SPACE = 0x20

class Canvas {
  constructor(
    readonly cells: Uint32Array,
    readonly cols: number,
  ) {}

  fill(row: number, fg: number, bg: number) {
    const cells = this.cells
    let i = row * this.cols * 3
    const end = i + this.cols * 3
    for (; i < end; i += 3) {
      cells[i] = SPACE
      cells[i + 1] = fg
      cells[i + 2] = bg
    }
  }

  /** Writes code points from `units[start, end)` at `col`, clipped to the row; returns the column after. */
  units(row: number, col: number, units: Uint16Array, start: number, end: number, fg: number): number {
    const cells = this.cells
    const stop = Math.min(end, start + this.cols - col)
    let i = (row * this.cols + col) * 3
    for (let u = start; u < stop; u++, i += 3) {
      cells[i] = units[u]!
      cells[i + 1] = fg
    }
    return col + Math.max(0, stop - start)
  }

  text(row: number, col: number, s: string, fg: number): number {
    const cells = this.cells
    const stop = Math.min(s.length, this.cols - col)
    let i = (row * this.cols + col) * 3
    for (let k = 0; k < stop; k++, i += 3) {
      cells[i] = s.charCodeAt(k)
      cells[i + 1] = fg
    }
    return col + Math.max(0, stop)
  }

  /** A line number right-aligned in 6 columns, no string made. */
  number(row: number, n: number, fg: number) {
    const cells = this.cells
    let col = 5
    do {
      if (col < this.cols) {
        const i = (row * this.cols + col) * 3
        cells[i] = 0x30 + (n % 10)
        cells[i + 1] = fg
      }
      n = Math.floor(n / 10)
      col--
    } while (n > 0 && col >= 0)
  }

  background(row: number, bg: number) {
    const cells = this.cells
    const end = (row + 1) * this.cols * 3
    for (let i = row * this.cols * 3 + 2; i < end; i += 3) cells[i] = bg
  }

  recolor(row: number, from: number, to: number, fg: number) {
    const cells = this.cells
    const stop = Math.min(to, this.cols)
    for (let col = from, i = (row * this.cols + from) * 3 + 1; col < stop; col++, i += 3) cells[i] = fg
  }
}

/** The header bar's text: the cursor's file and where the cursor is. */
export function title(src: Pick<Source, 'view' | 'cursor' | 'viewed' | 'comments'>): string {
  const { view, cursor, viewed, comments } = src
  const { manifest } = view
  if (manifest.files === 0) return ` ${manifest.headName} ← ${manifest.baseName} │ no changes`
  const index = view.fileOfRow(cursor)
  const file = manifest.file(index)
  const at = view.rows > 0 ? Math.floor(((cursor + 1) / view.rows) * 100) : 100
  const mark = view.collapsed[index] === 1 ? '✓ ' : ''
  const count = viewed === undefined ? '' : ` │ ✓ ${viewed.count}/${manifest.files} viewed`
  const drafts = comments === undefined || comments.count === 0 ? '' : ` │ ✎ ${comments.count}`
  return ` ${manifest.headName} ← ${manifest.baseName} │ ${index + 1}/${manifest.files} ${mark}${file.path} +${file.added} −${file.removed} │ ${at}%${count}${drafts}`
}

/**
 * Fills `cells` (cols × rows triplets) with the bar on row 0 and the view from row `top` below it. Returns how many
 * rows were drawn as placeholders because their chunk was not loaded.
 */
export function paint(cells: Uint32Array, cols: number, rows: number, top: number, src: Source): number {
  const canvas = new Canvas(cells, cols)
  const { view } = src
  canvas.fill(0, theme.barFg, theme.barBg)
  canvas.text(0, 0, title(src), theme.barFg)

  let missing = 0
  for (let row = 1; row < rows; row++) {
    const at = top + row - 1
    if (at >= view.rows) {
      canvas.fill(row, DEFAULT, DEFAULT)
      continue
    }
    const markCol = drawRow(canvas, row, at, src)
    if (markCol < 0) missing++
    else if (src.comments?.lines.has(view.lineOfRow(at))) canvas.text(row, markCol, '●', theme.commentFg)
    if (at === src.cursor) canvas.background(row, theme.cursorBg)
  }
  return missing
}

/** A row's comment mark goes in the gutter's free column; a file header's in place of its glyph. */
const MARK = 6
const HEADER_MARK = 1

/**
 * Draws view row `at` on canvas row `row`. Returns the column a comment mark goes in, or -1 for a placeholder drawn
 * because the row's chunk is not loaded.
 */
function drawRow(canvas: Canvas, row: number, at: number, src: Source): number {
  const { view } = src
  const { manifest } = view
  const file = view.fileOfRow(at)
  if (view.collapsed[file] === 1) {
    const info = manifest.file(file)
    canvas.fill(row, theme.dimFg, theme.viewedBg)
    canvas.text(row, 0, ' ✓', theme.viewedFg)
    const col = canvas.text(row, 3, info.path, theme.dimFg)
    canvas.text(row, col, `  +${info.added} −${info.removed}`, theme.gutterFg)
    return HEADER_MARK
  }
  const line = view.lineOfRow(at)
  const chunk = src.chunk(Math.floor(line / manifest.chunkLines))
  if (chunk === undefined) {
    canvas.fill(row, DEFAULT, DEFAULT)
    canvas.text(row, GUTTER, '…', theme.dimFg)
    return -1
  }
  const i = line % manifest.chunkLines
  const { lines, hl } = chunk
  const kind = lines.kind[i]!
  const start = lines.start[i]!
  const end = lines.start[i + 1]!

  switch (kind) {
    case Kind.File:
      canvas.fill(row, theme.fileFg, theme.fileBg)
      canvas.text(row, 0, ' ▍', theme.hunkFg)
      canvas.units(row, 3, lines.text, start, end, theme.fileFg)
      return HEADER_MARK
    case Kind.Hunk:
      canvas.fill(row, DEFAULT, DEFAULT)
      canvas.units(row, 2, lines.text, start, end, theme.hunkFg)
      return MARK
    case Kind.Note:
      canvas.fill(row, DEFAULT, DEFAULT)
      canvas.units(row, GUTTER, lines.text, start, end, theme.dimFg)
      return MARK
  }

  const isAdd = kind === Kind.Add
  const isDel = kind === Kind.Del
  canvas.fill(row, DEFAULT, isAdd ? theme.addBg : isDel ? theme.delBg : DEFAULT)
  canvas.number(row, isDel ? lines.oldNo[i]! : lines.newNo[i]!, theme.gutterFg)
  if (isAdd) canvas.text(row, 7, '+', theme.addSign)
  else if (isDel) canvas.text(row, 7, '-', theme.delSign)
  canvas.units(row, GUTTER, lines.text, start, end, DEFAULT)

  if (hl !== undefined) {
    for (let s = hl.start[i]!, last = hl.start[i + 1]!; s < last; s++) {
      const span = hl.spans[s]!
      const fg = styleFg[spanStyle(span)] ?? DEFAULT
      if (fg === DEFAULT) continue
      const col = GUTTER + spanCol(span)
      canvas.recolor(row, col, col + spanLen(span), fg)
    }
  }
  return MARK
}
