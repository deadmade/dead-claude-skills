// Views over brv's cache files (layout: brv/src/format.rs). Nothing is parsed: the bytes `$.fs.read` hands back
// get typed-array views laid over them, so any line is a direct lookup and no per-line objects are made.

export const VERSION = 1

export const Kind = { File: 0, Hunk: 1, Context: 2, Add: 3, Del: 4, Note: 5 } as const

export const FileFlag = { Collapsed: 1, Binary: 2 } as const

const HEADER = 16
const META_U32 = 12
const FILE_U32 = 9

type Bytes = Uint8Array<ArrayBuffer>

declare global {
  interface Uint8Array {
    toBase64(): string
  }
  interface Uint8ArrayConstructor {
    fromBase64(base64: string): Uint8Array<ArrayBuffer>
  }
}

export const fromBase64 = (base64: string): Bytes => Uint8Array.fromBase64(base64)
export const toBase64 = (bytes: Uint8Array): string => bytes.toBase64()

const align4 = (n: number) => (n + 3) & ~3

function header(bytes: Bytes, magic: string): { n: number; m: number } {
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (tag !== magic) throw new Error(`not a ${magic} file (${tag})`)
  const head = new DataView(bytes.buffer, bytes.byteOffset, HEADER)
  const version = head.getUint16(4, true)
  if (version !== VERSION) throw new Error(`cache format ${version}, this mod reads ${VERSION}: update brv or the mod`)
  return { n: head.getUint32(8, true), m: head.getUint32(12, true) }
}

const u32 = (bytes: Bytes, at: number, count: number) => new Uint32Array(bytes.buffer, bytes.byteOffset + at, count)
const u16 = (bytes: Bytes, at: number, count: number) => new Uint16Array(bytes.buffer, bytes.byteOffset + at, count)
const text = (units: Uint16Array, start: number, end: number) => String.fromCharCode(...units.subarray(start, end))

export type FileInfo = {
  path: string
  blob: string
  status: string
  flags: number
  added: number
  removed: number
  firstLine: number
  lineCount: number
}

export class Manifest {
  readonly files: number
  readonly totalLines: number
  readonly chunkLines: number
  readonly baseName: string
  readonly headName: string
  private readonly records: Uint32Array
  private readonly strings: Uint16Array

  constructor(bytes: Bytes) {
    const { n, m } = header(bytes, 'BRVM')
    const meta = u32(bytes, HEADER, META_U32)
    this.files = n
    this.records = u32(bytes, HEADER + META_U32 * 4, n * FILE_U32)
    this.strings = u16(bytes, HEADER + (META_U32 + n * FILE_U32) * 4, m)
    this.totalLines = meta[0]!
    this.chunkLines = meta[1]!
    this.baseName = this.str(meta, 2)
    this.headName = this.str(meta, 4)
  }

  private str(from: Uint32Array, at: number): string {
    const start = from[at]!
    return text(this.strings, start, start + from[at + 1]!)
  }

  file(index: number): FileInfo {
    const r = this.records.subarray(index * FILE_U32, (index + 1) * FILE_U32)
    return {
      path: this.str(r, 0),
      blob: this.str(r, 2),
      status: String.fromCharCode(r[4]! & 0xff),
      flags: r[4]! >>> 8,
      added: r[5]!,
      removed: r[6]!,
      firstLine: r[7]!,
      lineCount: r[8]!,
    }
  }

  /** The file's new blob id, what "viewed" marks are kept under. */
  blob(index: number): string {
    return this.str(this.records.subarray(index * FILE_U32, (index + 1) * FILE_U32), 2)
  }

  firstLine(index: number): number {
    return this.records[index * FILE_U32 + 7]!
  }

  lineCount(index: number): number {
    return this.records[index * FILE_U32 + 8]!
  }

  /** The file a global line belongs to: binary search over the files' first lines. */
  fileAt(line: number): number {
    let lo = 0
    let hi = this.files - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (this.firstLine(mid) <= line) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  get chunks(): number {
    return Math.ceil(this.totalLines / this.chunkLines)
  }
}

export class Lines {
  readonly n: number
  readonly kind: Uint8Array
  readonly oldNo: Uint32Array
  readonly newNo: Uint32Array
  readonly start: Uint32Array
  readonly text: Uint16Array

  constructor(bytes: Bytes) {
    const { n, m } = header(bytes, 'BRVL')
    let at = HEADER
    this.n = n
    this.kind = bytes.subarray(at, at + n)
    at += align4(n)
    this.oldNo = u32(bytes, at, n)
    at += n * 4
    this.newNo = u32(bytes, at, n)
    at += n * 4
    this.start = u32(bytes, at, n + 1)
    at += (n + 1) * 4
    this.text = u16(bytes, at, m)
  }

  line(i: number): string {
    return text(this.text, this.start[i]!, this.start[i + 1]!)
  }
}

export class Highlights {
  readonly start: Uint32Array
  readonly spans: Uint32Array

  constructor(bytes: Bytes) {
    const { n, m } = header(bytes, 'BRVH')
    this.start = u32(bytes, HEADER, n + 1)
    this.spans = u32(bytes, HEADER + (n + 1) * 4, m)
  }
}

export const spanCol = (s: number) => s & 0x1ff
export const spanLen = (s: number) => (s >>> 9) & 0x3ff
export const spanStyle = (s: number) => s >>> 19

export const chunkName = (index: number, ext: 'lines' | 'hl') => `${String(index).padStart(4, '0')}.${ext}`
