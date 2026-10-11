// The pane's rows over the review's global lines. A collapsed file shows only its header row, and a line with notes
// (comments) is followed by a row per line of note text, so the rows the pane scrolls through are not the lines: `top`
// and the cursor count rows, and this maps a row to its file, line and note row.

import type { Manifest } from './chunks';

export class View {
  /** The row each file's header is on; one more entry holds the row count. */
  private readonly rowStart: Uint32Array;
  /** Per file with notes on lines it shows: `[local line, rows, ...]` in line order. */
  private notesByFile = new Map<number, number[]>();
  /** What `locate` found, reused so a frame allocates nothing. */
  readonly at = { file: 0, line: 0, note: 0 };

  constructor(
    readonly manifest: Manifest,
    /** 1 per file index shown as its header alone. Shared with the caller: `rebuild()` after changing it. */
    readonly collapsed: Uint8Array,
    /** The rows of text drawn under a global line, by line. */
    public notes: ReadonlyMap<number, readonly string[]> = new Map(),
  ) {
    this.rowStart = new Uint32Array(manifest.files + 1);
    this.rebuild();
  }

  rebuild() {
    const { manifest, collapsed, rowStart } = this;
    const byFile = new Map<number, number[]>();
    for (const [line, rows] of this.notes) {
      if (rows.length === 0 || line >= manifest.totalLines) continue;
      const file = manifest.fileAt(line);
      const local = line - manifest.firstLine(file);
      if (local >= this.shown(file)) continue;
      const list = byFile.get(file) ?? [];
      list.push(local, rows.length);
      byFile.set(file, list);
    }
    for (const list of byFile.values()) {
      const pairs: [number, number][] = [];
      for (let k = 0; k < list.length; k += 2) pairs.push([list[k]!, list[k + 1]!]);
      pairs.sort((a, b) => a[0] - b[0]);
      list.length = 0;
      for (const [local, rows] of pairs) list.push(local, rows);
    }
    this.notesByFile = byFile;
    let row = 0;
    for (let i = 0; i < manifest.files; i++) {
      rowStart[i] = row;
      row += this.shown(i);
      const list = byFile.get(i);
      if (list !== undefined) for (let k = 1; k < list.length; k += 2) row += list[k]!;
    }
    rowStart[manifest.files] = row;
  }

  /** Lines a file shows: its header alone when collapsed. */
  private shown(file: number): number {
    return this.collapsed[file] === 1 ? 1 : this.manifest.lineCount(file);
  }

  get rows(): number {
    return this.rowStart[this.manifest.files]!;
  }

  headerRow(file: number): number {
    return this.rowStart[file]!;
  }

  /** The file a row belongs to: binary search over the files' header rows. */
  fileOfRow(row: number): number {
    let lo = 0;
    let hi = this.manifest.files - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.rowStart[mid]! <= row) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** A row's file, global line, and note row: 0 for the line itself, 1 and on for the rows of its notes. */
  locate(row: number): View['at'] {
    const file = this.fileOfRow(row);
    const first = this.manifest.firstLine(file);
    let offset = row - this.rowStart[file]!;
    const at = this.at;
    at.file = file;
    at.note = 0;
    const list = this.notesByFile.get(file);
    if (list !== undefined) {
      for (let k = 0; k < list.length; k += 2) {
        const local = list[k]!;
        if (offset <= local) break;
        if (offset <= local + list[k + 1]!) {
          at.line = first + local;
          at.note = offset - local;
          return at;
        }
        offset -= list[k + 1]!;
      }
    }
    at.line = first + offset;
    return at;
  }

  /** The global line a row shows, or whose notes it shows; a collapsed file's header row is its header line. */
  lineOfRow(row: number): number {
    return this.locate(row).line;
  }

  /** The row a global line is on; a line inside a collapsed file is on its header row. */
  rowOfLine(line: number): number {
    const file = this.manifest.fileAt(line);
    const local = this.collapsed[file] === 1 ? 0 : line - this.manifest.firstLine(file);
    let row = this.rowStart[file]! + local;
    const list = this.notesByFile.get(file);
    if (list !== undefined) for (let k = 0; k < list.length && list[k]! < local; k += 2) row += list[k + 1]!;
    return row;
  }
}
