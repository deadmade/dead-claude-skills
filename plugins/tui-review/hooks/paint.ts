// Paints one frame of the review into Raster cells: `[codePoint, fg, bg]` u32 triplets, row-major. Pure and
// synchronous: the caller loads the chunks the window needs first, so a frame costs only the cells it fills.

import { Kind, type Highlights, type Lines, type Manifest, spanCol, spanLen, spanStyle } from './chunks'
import { DEFAULT, styleFg, theme } from './theme'

export type Loaded = { lines: Lines; hl?: Highlights }

export type Source = {
  manifest: Manifest
  /** 1 per file index marked viewed, and how many are. */
  viewed?: { files: Uint8Array; count: number }
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

  recolor(row: number, from: number, to: number, fg: number) {
    const cells = this.cells
    const stop = Math.min(to, this.cols)
    for (let col = from, i = (row * this.cols + from) * 3 + 1; col < stop; col++, i += 3) cells[i] = fg
  }
}

/** The header bar's text for the window starting at `top`. */
export function title(manifest: Manifest, top: number, viewed?: Source['viewed']): string {
  if (manifest.files === 0) return ` ${manifest.headName} ← ${manifest.baseName} │ no changes`
  const index = manifest.fileAt(top)
  const file = manifest.file(index)
  const at = manifest.totalLines > 0 ? Math.floor(((top + 1) / manifest.totalLines) * 100) : 100
  const mark = viewed?.files[index] === 1 ? '✓ ' : ''
  const count = viewed === undefined ? '' : ` │ ✓ ${viewed.count}/${manifest.files} viewed`
  return ` ${manifest.headName} ← ${manifest.baseName} │ ${index + 1}/${manifest.files} ${mark}${file.path} +${file.added} −${file.removed} │ ${at}%${count}`
}

/**
 * Fills `cells` (cols × rows triplets) with the bar on row 0 and the diff from global line `top` below it. Returns how
 * many rows were drawn as placeholders because their chunk was not loaded.
 */
export function paint(cells: Uint32Array, cols: number, rows: number, top: number, src: Source): number {
  const canvas = new Canvas(cells, cols)
  const { manifest } = src
  canvas.fill(0, theme.barFg, theme.barBg)
  canvas.text(0, 0, title(manifest, top, src.viewed), theme.barFg)

  let missing = 0
  for (let row = 1; row < rows; row++) {
    const line = top + row - 1
    if (line >= manifest.totalLines) {
      canvas.fill(row, DEFAULT, DEFAULT)
      continue
    }
    const chunk = src.chunk(Math.floor(line / manifest.chunkLines))
    if (chunk === undefined) {
      canvas.fill(row, DEFAULT, DEFAULT)
      canvas.text(row, GUTTER, '…', theme.dimFg)
      missing++
      continue
    }
    const i = line % manifest.chunkLines
    const { lines, hl } = chunk
    const kind = lines.kind[i]!
    const start = lines.start[i]!
    const end = lines.start[i + 1]!

    switch (kind) {
      case Kind.File:
        if (src.viewed?.files[manifest.fileAt(line)] === 1) {
          canvas.fill(row, theme.dimFg, theme.viewedBg)
          canvas.text(row, 0, ' ✓', theme.viewedFg)
          canvas.units(row, 3, lines.text, start, end, theme.dimFg)
        } else {
          canvas.fill(row, theme.fileFg, theme.fileBg)
          canvas.text(row, 0, ' ▍', theme.hunkFg)
          canvas.units(row, 3, lines.text, start, end, theme.fileFg)
        }
        continue
      case Kind.Hunk:
        canvas.fill(row, DEFAULT, DEFAULT)
        canvas.units(row, 2, lines.text, start, end, theme.hunkFg)
        continue
      case Kind.Note:
        canvas.fill(row, DEFAULT, DEFAULT)
        canvas.units(row, GUTTER, lines.text, start, end, theme.dimFg)
        continue
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
  }
  return missing
}
