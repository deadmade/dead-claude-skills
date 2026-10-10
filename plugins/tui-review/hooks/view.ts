// The pane's rows over the review's global lines. A collapsed file shows only its header row, so the rows the pane
// scrolls through skip lines: `top` and the cursor count rows, and this maps a row to its file and line.

import type { Manifest } from './chunks'

export class View {
  /** The row each file's header is on; one more entry holds the row count. */
  private readonly rowStart: Uint32Array

  constructor(
    readonly manifest: Manifest,
    /** 1 per file index shown as its header alone. Shared with the caller: `rebuild()` after changing it. */
    readonly collapsed: Uint8Array,
  ) {
    this.rowStart = new Uint32Array(manifest.files + 1)
    this.rebuild()
  }

  rebuild() {
    const { manifest, collapsed, rowStart } = this
    let row = 0
    for (let i = 0; i < manifest.files; i++) {
      rowStart[i] = row
      row += collapsed[i] === 1 ? 1 : manifest.lineCount(i)
    }
    rowStart[manifest.files] = row
  }

  get rows(): number {
    return this.rowStart[this.manifest.files]!
  }

  headerRow(file: number): number {
    return this.rowStart[file]!
  }

  /** The file a row belongs to: binary search over the files' header rows. */
  fileOfRow(row: number): number {
    let lo = 0
    let hi = this.manifest.files - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (this.rowStart[mid]! <= row) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** The global line a row shows; a collapsed file's one row is its header line. */
  lineOfRow(row: number): number {
    const file = this.fileOfRow(row)
    return this.manifest.firstLine(file) + (this.collapsed[file] === 1 ? 0 : row - this.rowStart[file]!)
  }
}
